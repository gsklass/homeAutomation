#!/usr/bin/env bash
# setup.sh — Install dependencies and register the blinds daemon with systemd.
# Run as root:  sudo ./setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="blinds-automation"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
PYTHON="$(command -v python3)"
CURRENT_USER="${SUDO_USER:-$USER}"

echo "=== Bali Blinds Automation Setup ==="
echo "Project dir : $SCRIPT_DIR"
echo "Running as  : $CURRENT_USER"
echo

# ---------------------------------------------------------------------------
# 1. Install Python dependencies
# ---------------------------------------------------------------------------
echo "[1/3] Installing Python dependencies…"
"$PYTHON" -m pip install --quiet -r "$SCRIPT_DIR/requirements.txt"
echo "      Done."

# ---------------------------------------------------------------------------
# 2. Write systemd service unit
# ---------------------------------------------------------------------------
echo "[2/3] Writing systemd service to $SERVICE_FILE…"
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Bali Blinds Automation (PowerView sunrise/sunset)
Documentation=file://$SCRIPT_DIR/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$PYTHON $SCRIPT_DIR/blinds_control.py
Restart=on-failure
RestartSec=30
# Give the network time to come up after boot before first attempt
ExecStartPre=/bin/sleep 10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
echo "      Done."

# ---------------------------------------------------------------------------
# 3. Enable and start the service
# ---------------------------------------------------------------------------
echo "[3/3] Enabling and starting ${SERVICE_NAME}…"
systemctl daemon-reload
systemctl enable  "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo
echo "=== Setup complete ==="
echo
echo "Useful commands:"
echo "  systemctl status  $SERVICE_NAME   # check if running"
echo "  journalctl -fu    $SERVICE_NAME   # live logs"
echo "  systemctl restart $SERVICE_NAME   # restart after config changes"
echo "  systemctl stop    $SERVICE_NAME   # stop"
