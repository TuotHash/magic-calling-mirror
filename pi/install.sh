#!/usr/bin/env bash
# Turns a fresh Raspberry Pi OS Lite (64-bit, Bookworm) install into a
# magic mirror appliance: Chromium kiosk on tty1, optional PIR-based
# presence agent. Idempotent — re-run to change settings.
#
# Usage:  sudo ./install.sh
#
# Reverse with pi/uninstall.sh.

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
MIRROR_USER="mirror"
CONFIG_DIR="/etc/magic-mirror"
CONFIG_FILE="$CONFIG_DIR/config"

prompt() {
    local var="$1" question="$2" default="${3:-}"
    local answer
    if [ -n "$default" ]; then
        read -rp "$question [$default]: " answer || true
        answer="${answer:-$default}"
    else
        read -rp "$question: " answer
    fi
    printf -v "$var" "%s" "$answer"
}

prompt_bool() {
    local var="$1" question="$2" default="$3"  # "true" or "false"
    local hint="y/N"
    [ "$default" = "true" ] && hint="Y/n"
    local answer
    read -rp "$question [$hint]: " answer || true
    if [ -z "$answer" ]; then
        printf -v "$var" "%s" "$default"
        return
    fi
    case "$answer" in
        y|Y|yes|YES) printf -v "$var" "true" ;;
        n|N|no|NO)   printf -v "$var" "false" ;;
        *)           printf -v "$var" "%s" "$default" ;;
    esac
}

# Read existing config (if any) for sensible defaults on re-run.
EXIST_URL=""
EXIST_ROTATE="0"
EXIST_AGENT="false"
EXIST_PIN="17"
EXIST_PORT="8765"
if [ -r "$CONFIG_FILE" ]; then
    # shellcheck disable=SC1090
    . "$CONFIG_FILE" || true
    EXIST_URL="${MIRROR_URL:-}"
    EXIST_ROTATE="${DISPLAY_ROTATE:-0}"
    EXIST_AGENT="${AGENT_ENABLED:-false}"
    EXIST_PIN="${AGENT_GPIO_PIN:-17}"
    EXIST_PORT="${AGENT_WS_PORT:-8765}"
fi

prompt MIRROR_URL "Mirror web app URL" "${EXIST_URL:-https://example.com/mirror/}"
echo "    0=normal  1=90°cw  2=180°  3=90°ccw"
prompt DISPLAY_ROTATE "Rotate display? (0/1/2/3)" "$EXIST_ROTATE"
prompt_bool AGENT_ENABLED "Enable PIR motion-sensor presence agent?" "$EXIST_AGENT"
AGENT_GPIO_PIN="$EXIST_PIN"
AGENT_WS_PORT="$EXIST_PORT"
if [ "$AGENT_ENABLED" = "true" ]; then
    prompt AGENT_GPIO_PIN "PIR sensor BCM GPIO pin"      "$EXIST_PIN"
    prompt AGENT_WS_PORT  "WebSocket port (loopback only)" "$EXIST_PORT"
fi

echo "==> Installing kiosk packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    xserver-xorg \
    xserver-xorg-legacy \
    xinit \
    x11-xserver-utils \
    openbox \
    chromium-browser \
    unclutter \
    fonts-dejavu

if [ "$AGENT_ENABLED" = "true" ]; then
    echo "==> Installing agent packages"
    # python3-rpi.gpio is the gpiozero default backend on Pi 4 / Bookworm.
    # Pi 5 users will want python3-lgpio instead — install separately.
    apt-get install -y --no-install-recommends \
        python3-gpiozero \
        python3-websockets \
        python3-rpi.gpio
fi

# xserver-xorg-legacy ships Xwrapper.config restricted to console; allow
# anyone so our X session works without root.
if [ -f /etc/X11/Xwrapper.config ]; then
    sed -i 's/^allowed_users=.*/allowed_users=anybody/' /etc/X11/Xwrapper.config
    grep -q '^needs_root_rights' /etc/X11/Xwrapper.config \
        || echo 'needs_root_rights=yes' >> /etc/X11/Xwrapper.config
fi

echo "==> Creating $MIRROR_USER user"
if ! id "$MIRROR_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$MIRROR_USER"
fi
# video: framebuffer / GPU. audio: ALSA. input: dial / keyboard. tty: X on tty1.
for grp in video audio input tty render; do
    if getent group "$grp" >/dev/null; then
        usermod -aG "$grp" "$MIRROR_USER"
    fi
done

echo "==> Writing $CONFIG_FILE"
mkdir -p "$CONFIG_DIR"
# Quoted shell-style KEY=VALUE — readable by both `.` (start-mirror.sh)
# and systemd's EnvironmentFile= (magic-mirror-agent.service).
cat > "$CONFIG_FILE" <<EOF
MIRROR_URL="$MIRROR_URL"
DISPLAY_ROTATE=$DISPLAY_ROTATE
AGENT_ENABLED=$AGENT_ENABLED
AGENT_GPIO_PIN=$AGENT_GPIO_PIN
AGENT_WS_PORT=$AGENT_WS_PORT
EOF
chmod 0644 "$CONFIG_FILE"

echo "==> Installing kiosk launcher"
install -m 0755 "$SCRIPT_DIR/start-mirror.sh" /usr/local/bin/start-mirror.sh

echo "==> Writing $MIRROR_USER's .xinitrc and .bash_profile"
cat > "/home/$MIRROR_USER/.xinitrc" <<'EOF'
#!/bin/sh
# Launched by `startx` from .bash_profile.
openbox-session &
exec /usr/local/bin/start-mirror.sh
EOF
chmod 0755 "/home/$MIRROR_USER/.xinitrc"

cat > "/home/$MIRROR_USER/.bash_profile" <<'EOF'
# Auto-start X on tty1 only — leaves other VTs available for debugging.
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec startx -- -nocursor
fi
EOF
chown -R "$MIRROR_USER:$MIRROR_USER" "/home/$MIRROR_USER"

echo "==> Enabling autologin for $MIRROR_USER on tty1"
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/override.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $MIRROR_USER --noclear %I \$TERM
EOF
systemctl daemon-reload
systemctl enable getty@tty1.service >/dev/null

echo "==> Display rotation"
CONFIG_TXT="/boot/firmware/config.txt"
[ -f /boot/config.txt ] && CONFIG_TXT="/boot/config.txt"
if [ -f "$CONFIG_TXT" ]; then
    # Strip prior magic-mirror block, then append a fresh one (only if non-zero).
    sed -i '/^# >>> magic-mirror >>>/,/^# <<< magic-mirror <<</d' "$CONFIG_TXT"
    if [ "$DISPLAY_ROTATE" != "0" ]; then
        cat >> "$CONFIG_TXT" <<EOF
# >>> magic-mirror >>>
display_rotate=$DISPLAY_ROTATE
# <<< magic-mirror <<<
EOF
        echo "    config.txt updated — reboot required for rotation."
    fi
else
    echo "    $CONFIG_TXT not found — skipping (non-Pi system?)."
fi

if [ "$AGENT_ENABLED" = "true" ]; then
    echo "==> Installing PIR agent"
    if ! id -u magic-mirror-agent >/dev/null 2>&1; then
        useradd --system --no-create-home --shell /usr/sbin/nologin \
            --groups gpio magic-mirror-agent
    else
        usermod -aG gpio magic-mirror-agent
    fi
    install -m 0755 "$SCRIPT_DIR/magic_mirror_agent.py" /usr/local/bin/magic_mirror_agent.py
    install -m 0644 "$SCRIPT_DIR/magic-mirror-agent.service" \
        /etc/systemd/system/magic-mirror-agent.service
    systemctl daemon-reload
    systemctl enable --now magic-mirror-agent.service
    echo
    systemctl --no-pager status magic-mirror-agent.service | head -8 || true
else
    # Agent was previously enabled but now disabled — tear it down.
    if systemctl list-unit-files magic-mirror-agent.service >/dev/null 2>&1; then
        if systemctl is-enabled --quiet magic-mirror-agent.service 2>/dev/null \
           || systemctl is-active --quiet magic-mirror-agent.service 2>/dev/null; then
            echo "==> Disabling previously-installed PIR agent"
            systemctl disable --now magic-mirror-agent.service || true
        fi
    fi
fi

echo
echo "Done. Reboot to enter kiosk mode:"
echo "    sudo reboot"
echo
echo "To change settings later:  sudo \$EDITOR $CONFIG_FILE && sudo reboot"
echo "                       or: sudo $SCRIPT_DIR/install.sh  (re-prompts)"
echo "To bail out of the kiosk:  switch to tty2 with Ctrl+Alt+F2 and log in normally."
