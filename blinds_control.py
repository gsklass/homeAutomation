#!/usr/bin/env python3
"""
blinds_control.py — Daemon that opens/closes Bali PowerView blinds at sunrise/sunset.

Behavior:
  - At SUNSET  (+ offset): close ALL shades.
  - At SUNRISE (+ offset): open only the shades listed in config.yaml → sunrise_shades.
  - All other shades remain untouched at sunrise (controlled by their remotes).

Run continuously via systemd (see setup.sh).
"""

import logging
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from powerview import PowerViewHub, discover_hub

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_FILE = Path(__file__).parent / "blinds_control.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),          # → systemd journal
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CONFIG_FILE = Path(__file__).parent / "config.yaml"


def load_config() -> dict:
    with open(CONFIG_FILE) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Sun times
# ---------------------------------------------------------------------------
def get_sun_times(cfg: dict, for_date: date) -> tuple[datetime, datetime]:
    """
    Return (sunrise, sunset) as timezone-aware datetimes for for_date.

    Uses the astral library with either a city name or explicit lat/lon.
    """
    from astral import LocationInfo
    from astral.sun import sun

    loc_cfg = cfg.get("location", {})
    city_name = loc_cfg.get("city")

    if city_name:
        try:
            from astral.geocoder import database, lookup
            city = lookup(city_name, database())
            location = LocationInfo(
                city.name, city.region, city.timezone,
                city.latitude, city.longitude,
            )
        except KeyError:
            log.error(
                "City '%s' not found in astral database. "
                "Set latitude/longitude/timezone manually in config.yaml.",
                city_name,
            )
            sys.exit(1)
    else:
        lat  = loc_cfg["latitude"]
        lon  = loc_cfg["longitude"]
        tz   = loc_cfg["timezone"]
        location = LocationInfo("Custom", "", tz, lat, lon)

    s = sun(location.observer, date=for_date, tzinfo=ZoneInfo(location.timezone))
    return s["sunrise"], s["sunset"]


# ---------------------------------------------------------------------------
# Event scheduling helpers
# ---------------------------------------------------------------------------
def apply_offset(dt: datetime, offset_minutes: int) -> datetime:
    return dt + timedelta(minutes=offset_minutes)


def sleep_until(target: datetime) -> None:
    """Sleep until target (timezone-aware). Wakes every 30 s to handle clock changes."""
    while True:
        now  = datetime.now(timezone.utc)
        diff = (target - now).total_seconds()
        if diff <= 0:
            return
        # Wake up at most 30 s early to poll, or at the exact target
        time.sleep(min(diff, 30))


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------
def action_sunrise(hub: PowerViewHub, cfg: dict) -> None:
    shade_ids = cfg.get("sunrise_shades") or []
    if not shade_ids:
        log.info("SUNRISE: no shades configured for sunrise — skipping.")
        return
    log.info("SUNRISE: opening %d shade(s): %s", len(shade_ids), shade_ids)
    hub.open_shades(shade_ids)
    log.info("SUNRISE: done.")


def action_sunset(hub: PowerViewHub) -> None:
    log.info("SUNSET: closing all shades…")
    hub.close_all_shades()
    log.info("SUNSET: done.")


# ---------------------------------------------------------------------------
# Hub connection (with retry)
# ---------------------------------------------------------------------------
def connect_hub(cfg: dict) -> PowerViewHub:
    hub_ip = cfg.get("hub", {}).get("ip")

    while True:
        if not hub_ip:
            log.info("No hub IP in config — scanning network…")
            hub_ip = discover_hub()

        if hub_ip:
            hub = PowerViewHub(hub_ip)
            if hub.ping():
                log.info("Connected to PowerView hub at %s", hub_ip)
                return hub
            log.warning("Hub at %s not responding. Retrying in 60 s…", hub_ip)
            hub_ip = None   # force re-discover next loop
        else:
            log.warning("Hub not found on network. Retrying in 60 s…")

        time.sleep(60)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def main() -> None:
    log.info("=== Bali Blinds Automation starting ===")

    cfg = load_config()
    hub = connect_hub(cfg)

    offsets     = cfg.get("offsets", {})
    off_sunrise = int(offsets.get("sunrise", 0))
    off_sunset  = int(offsets.get("sunset",  0))

    while True:
        # Re-read config each cycle so changes take effect without a restart
        try:
            cfg = load_config()
        except Exception as exc:
            log.error("Failed to reload config: %s — using previous config", exc)

        today = date.today()
        try:
            sunrise_raw, sunset_raw = get_sun_times(cfg, today)
        except Exception as exc:
            log.error("Failed to calculate sun times: %s. Retrying in 60 s.", exc)
            time.sleep(60)
            continue

        sunrise = apply_offset(sunrise_raw, off_sunrise)
        sunset  = apply_offset(sunset_raw,  off_sunset)

        log.info(
            "Today %s — sunrise event: %s, sunset event: %s",
            today,
            sunrise.strftime("%H:%M %Z"),
            sunset.strftime("%H:%M %Z"),
        )

        now = datetime.now(timezone.utc)

        # Build list of upcoming events today, in chronological order
        events: list[tuple[str, datetime]] = []
        if sunrise > now:
            events.append(("sunrise", sunrise))
        if sunset > now:
            events.append(("sunset", sunset))

        if not events:
            # Both events have already passed today; sleep until tomorrow's sunrise
            tomorrow        = today + timedelta(days=1)
            sunrise_tomorrow, _ = get_sun_times(cfg, tomorrow)
            next_wake       = apply_offset(sunrise_tomorrow, off_sunrise)
            log.info(
                "All events done for today. Sleeping until tomorrow's sunrise: %s",
                next_wake.strftime("%Y-%m-%d %H:%M %Z"),
            )
            sleep_until(next_wake)
            continue

        for event_name, event_time in sorted(events, key=lambda e: e[1]):
            log.info("Waiting for %s at %s…", event_name, event_time.strftime("%H:%M %Z"))
            sleep_until(event_time)

            # Verify hub still reachable before acting
            if not hub.ping():
                log.warning("Hub lost — attempting reconnect…")
                hub = connect_hub(cfg)

            if event_name == "sunrise":
                action_sunrise(hub, cfg)
            else:
                action_sunset(hub)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Stopped by user.")
