"""
PowerView Hub Gen 1/2 REST API client.

Position values: 0 = fully closed, 65535 = fully open.
"""

import logging
import socket
import ipaddress
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

log = logging.getLogger(__name__)

DISCOVERY_TIMEOUT = 2       # seconds per host when scanning
DISCOVERY_WORKERS = 64      # parallel scan threads
REQUEST_TIMEOUT   = 10      # seconds for normal API calls


class PowerViewHub:
    def __init__(self, host: str):
        self.host = host
        self._base = f"http://{host}/api"
        self._session = requests.Session()
        self._session.headers.update({
            "Content-Type": "application/json",
            "Accept":       "application/json",
        })

    # ------------------------------------------------------------------
    # Shade discovery
    # ------------------------------------------------------------------
    def get_shades(self) -> list[dict]:
        """Return a list of shade dicts with keys: id, name, positions."""
        resp = self._session.get(f"{self._base}/shades", timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        return data.get("shadeData", [])

    # ------------------------------------------------------------------
    # Shade control
    # ------------------------------------------------------------------
    def set_position(self, shade_id: int, position: int) -> None:
        """
        Set a shade's primary position.

        Args:
            shade_id: The integer shade ID from get_shades().
            position: 0 (fully closed) to 65535 (fully open).
        """
        payload = {
            "shade": {
                "positions": {
                    "posKind1": 1,
                    "position1": int(position),
                }
            }
        }
        url = f"{self._base}/shades/{shade_id}"
        resp = self._session.put(url, json=payload, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        log.debug("Shade %s → position %s", shade_id, position)

    def open_shade(self, shade_id: int) -> None:
        self.set_position(shade_id, 65535)

    def close_shade(self, shade_id: int) -> None:
        self.set_position(shade_id, 0)

    def open_shades(self, shade_ids: list[int]) -> None:
        for sid in shade_ids:
            try:
                self.open_shade(sid)
                log.info("Opened shade %s", sid)
            except Exception as exc:
                log.error("Failed to open shade %s: %s", sid, exc)

    def close_all_shades(self) -> None:
        shades = self.get_shades()
        for shade in shades:
            sid = shade["id"]
            try:
                self.close_shade(sid)
                log.info("Closed shade %s (%s)", sid, shade.get("name", ""))
            except Exception as exc:
                log.error("Failed to close shade %s: %s", sid, exc)

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------
    def ping(self) -> bool:
        try:
            resp = self._session.get(f"{self._base}/shades", timeout=DISCOVERY_TIMEOUT)
            return resp.status_code == 200 and "shadeData" in resp.json()
        except Exception:
            return False


# ------------------------------------------------------------------
# Network discovery
# ------------------------------------------------------------------

def _is_powerview_host(ip: str) -> str | None:
    """Return the IP string if it hosts a PowerView hub, else None."""
    try:
        r = requests.get(
            f"http://{ip}/api/shades",
            timeout=DISCOVERY_TIMEOUT,
            headers={"Accept": "application/json"},
        )
        if r.status_code == 200 and "shadeData" in r.json():
            return ip
    except Exception:
        pass
    return None


def _local_subnets() -> list[ipaddress.IPv4Network]:
    """Return /24 subnets for all local non-loopback IPv4 addresses."""
    subnets = []
    seen = set()
    try:
        # getaddrinfo for all interfaces via a dummy connect
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            # This doesn't actually send data; it just resolves the route.
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
        net = ipaddress.IPv4Network(f"{local_ip}/24", strict=False)
        if net not in seen:
            seen.add(net)
            subnets.append(net)
    except Exception:
        pass

    # Fallback: common home subnets
    if not subnets:
        for cidr in ["192.168.1.0/24", "192.168.0.0/24", "10.0.0.0/24"]:
            net = ipaddress.IPv4Network(cidr)
            if net not in seen:
                seen.add(net)
                subnets.append(net)

    return subnets


def discover_hub() -> str | None:
    """
    Scan the local network for a PowerView hub.

    Returns the hub's IP address string, or None if not found.
    """
    subnets = _local_subnets()
    log.info("Scanning %d subnet(s) for PowerView hub…", len(subnets))

    all_hosts = [str(h) for net in subnets for h in net.hosts()]
    log.info("Checking %d hosts…", len(all_hosts))

    with ThreadPoolExecutor(max_workers=DISCOVERY_WORKERS) as pool:
        futures = {pool.submit(_is_powerview_host, h): h for h in all_hosts}
        for future in as_completed(futures):
            result = future.result()
            if result:
                # Cancel remaining futures (best-effort)
                for f in futures:
                    f.cancel()
                log.info("Found PowerView hub at %s", result)
                return result

    return None
