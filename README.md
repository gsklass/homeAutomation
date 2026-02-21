# Bali Blinds Automation

Automatically controls Bali PowerView blinds based on sunrise and sunset times.

- **Sunset**: closes **all** blinds
- **Sunrise**: opens a **configurable subset** of blinds (e.g. east-facing rooms)
- All other blinds remain remote-only at sunrise

## Requirements

- Linux machine (Raspberry Pi, home server, etc.) on the same network as the hub
- Python 3.11+
- Bali PowerView Hub (Gen 1 or Gen 2)

## Quick Start

### 1. Install dependencies

```bash
pip3 install -r requirements.txt
```

### 2. Discover your hub and shade IDs

```bash
python3 discover.py
```

This scans your local network, finds the PowerView hub, and prints all shade names and IDs.

### 3. Edit `config.yaml`

```yaml
hub:
  ip: "192.168.1.100"      # set from discover.py output (or leave null to auto-discover)

location:
  city: "Denver"            # your city for sunrise/sunset calculation

sunrise_shades:
  - 12345                   # paste IDs of shades that should open at sunrise
  - 67890

offsets:
  sunrise: 0                # minutes after sunrise (negative = before)
  sunset: -15               # close 15 minutes before sunset
```

### 4. Test manually

```bash
python3 blinds_control.py   # runs the daemon; Ctrl-C to stop
```

### 5. Install as a systemd service

```bash
sudo ./setup.sh
```

The daemon will now start automatically on boot and run forever.

## Useful commands

```bash
systemctl status  blinds-automation    # is it running?
journalctl -fu    blinds-automation    # live log output
systemctl restart blinds-automation    # pick up config changes
systemctl stop    blinds-automation    # stop
```

## File layout

```
homeAutomation/
├── config.yaml          ← edit this
├── discover.py          ← run once to find shade IDs
├── blinds_control.py    ← the daemon
├── powerview.py         ← PowerView API client
├── requirements.txt
└── setup.sh             ← systemd install
```

## How it works

`blinds_control.py` runs as a persistent daemon. On each cycle it:

1. Calculates today's sunrise and sunset using the [`astral`](https://astral.readthedocs.io/) library (offline, no API key needed)
2. Applies your configured time offsets
3. Sleeps until the next event
4. Calls the PowerView local REST API to open/close shades
5. Loops for the next day

If the hub is unreachable at startup or after a network hiccup, the daemon retries every 60 seconds.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `discover.py` finds no hub | Check hub is powered and on the same subnet; or set `hub.ip` manually |
| City not found | Use `latitude`/`longitude`/`timezone` in config instead of `city` |
| Shade doesn't move | Check the ID with `discover.py`; ensure hub is paired to the shade |
| Wrong open/close direction | Some shade types have inverted positions; swap open=0/close=65535 in `powerview.py` |
