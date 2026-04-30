#!/usr/bin/env bash
# Installs the magic mirror PIR agent as a systemd service. Idempotent:
# re-run to change the pin/port.
#
# Usage:  sudo ./install.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "install.sh: must be run as root (try: sudo $0)" >&2
    exit 1
fi

if ! command -v apt-get >/dev/null; then
    echo "install.sh: apt-get not found — this script targets Debian/Raspberry Pi OS." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

prompt() {
    local var="$1" question="$2" default="$3"
    local answer
    read -rp "$question [$default]: " answer || true
    answer="${answer:-$default}"
    printf -v "$var" "%s" "$answer"
}

echo "==> Installing apt packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# python3-rpi.gpio is the gpiozero default backend on Pi 4 / Bookworm.
# Pi 5 users will want python3-lgpio instead — install separately.
apt-get install -y --no-install-recommends \
    python3-gpiozero \
    python3-websockets \
    python3-rpi.gpio

echo "==> Creating service user"
# System user with no shell, no home — only needs gpio group for /dev/gpiomem.
if ! id -u magic-mirror-agent >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin \
        --groups gpio magic-mirror-agent
else
    # Ensure gpio membership in case the user pre-exists from an older install.
    usermod -aG gpio magic-mirror-agent
fi

echo "==> Installing agent script"
install -m 0755 "$SCRIPT_DIR/magic_mirror_agent.py" /usr/local/bin/magic_mirror_agent.py

echo "==> Configuring agent"
mkdir -p /etc/magic-mirror
ENV_FILE=/etc/magic-mirror/agent.env
EXIST_PIN="17"
EXIST_PORT="8765"
if [ -r "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    . "$ENV_FILE" || true
    EXIST_PIN="${MIRROR_AGENT_PIN:-17}"
    EXIST_PORT="${MIRROR_AGENT_PORT:-8765}"
fi
prompt PIN  "PIR sensor BCM GPIO pin"      "$EXIST_PIN"
prompt PORT "WebSocket port (loopback only)" "$EXIST_PORT"
cat > "$ENV_FILE" <<EOF
MIRROR_AGENT_PIN=$PIN
MIRROR_AGENT_PORT=$PORT
EOF
chmod 0644 "$ENV_FILE"

echo "==> Installing systemd unit"
install -m 0644 "$SCRIPT_DIR/magic-mirror-agent.service" \
    /etc/systemd/system/magic-mirror-agent.service
systemctl daemon-reload
systemctl enable --now magic-mirror-agent.service

echo
systemctl --no-pager status magic-mirror-agent.service | head -8 || true
echo
echo "To enable in the web client, open the kiosk URL once with:"
echo "    ?presenceAgentUrl=ws://127.0.0.1:$PORT"
echo "appended. The setting is saved and the parameter can be dropped after."
echo
echo "View live logs:  journalctl -u magic-mirror-agent.service -f"
