#!/usr/bin/env python3
"""
discover.py — Run this once to find your PowerView hub and list all shade IDs.

Usage:
    python3 discover.py
    python3 discover.py --ip 192.168.1.100   # skip network scan
"""

import argparse
import sys
import yaml

from powerview import PowerViewHub, discover_hub

CONFIG_FILE = "config.yaml"


def load_config_ip() -> str | None:
    try:
        with open(CONFIG_FILE) as f:
            cfg = yaml.safe_load(f)
        return cfg.get("hub", {}).get("ip")
    except FileNotFoundError:
        return None


def main():
    parser = argparse.ArgumentParser(description="Discover PowerView hub and list shades.")
    parser.add_argument("--ip", help="Hub IP address (skips network scan)")
    args = parser.parse_args()

    hub_ip = args.ip or load_config_ip()

    if hub_ip:
        print(f"Using hub IP from config/argument: {hub_ip}")
    else:
        print("Scanning network for PowerView hub (this may take ~15 seconds)…")
        hub_ip = discover_hub()
        if not hub_ip:
            print("\nERROR: No PowerView hub found on the network.")
            print("  • Make sure the hub is powered on and connected to the same network.")
            print("  • Or set the IP manually in config.yaml under hub.ip")
            sys.exit(1)
        print(f"\nFound hub at: {hub_ip}")
        print(f"  → Update config.yaml:  hub:\n                           ip: \"{hub_ip}\"")

    hub = PowerViewHub(hub_ip)

    if not hub.ping():
        print(f"\nERROR: Hub at {hub_ip} is not responding to the PowerView API.")
        print("  This script supports PowerView Gen 1/2 hubs.")
        sys.exit(1)

    print(f"\nConnected to PowerView hub at {hub_ip}\n")
    print(f"{'ID':<10} {'Name':<40} {'Current Position'}")
    print("-" * 70)

    shades = hub.get_shades()
    if not shades:
        print("  (no shades found — check hub pairing)")
        sys.exit(0)

    for shade in sorted(shades, key=lambda s: s.get("name", "")):
        sid   = shade.get("id", "?")
        name  = shade.get("name", "(unnamed)")
        pos   = shade.get("positions", {})
        p1    = pos.get("position1", "?")
        pct   = f"{round(p1 / 65535 * 100)}%" if isinstance(p1, int) else "?"
        print(f"{sid:<10} {name:<40} {pct}")

    print()
    print("Paste the IDs of shades that should OPEN at sunrise into config.yaml")
    print("under the 'sunrise_shades' key.  All shades will close at sunset.")


if __name__ == "__main__":
    main()
