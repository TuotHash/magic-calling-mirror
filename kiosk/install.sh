#!/usr/bin/env bash
# Turns a fresh Raspberry Pi OS Lite (64-bit, Bookworm) install into a
# kiosk that boots straight into the magic mirror web app. Idempotent:
# you can re-run it to update the URL or re-apply rotation.
#
# Usage:  sudo ./install.sh
#
# What it does:
#   - installs Xorg, openbox, Chromium, unclutter
#   - creates a `mirror` user with access to video/audio/input
#   - autologins `mirror` on tty1 and starts X via .bash_profile
#   - writes /etc/magic-mirror/url with the kiosk URL
#   - optionally rotates the display via /boot/firmware/config.txt
#
# Reverse with kiosk/uninstall.sh (TODO) or by hand — see README.md.

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

echo "==> Installing packages"
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

# xserver-xorg-legacy ships Xwrapper.config restricted to console; allow
# anyone so our systemd-launched X session works without root.
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

echo "==> Installing start-mirror.sh"
install -m 0755 "$SCRIPT_DIR/start-mirror.sh" /usr/local/bin/start-mirror.sh

echo "==> Configuring URL"
mkdir -p /etc/magic-mirror
EXISTING_URL=""
if [ -r /etc/magic-mirror/url ]; then
    EXISTING_URL="$(cat /etc/magic-mirror/url)"
fi
prompt MIRROR_URL "Mirror web app URL" "${EXISTING_URL:-https://example.com/mirror/}"
echo "$MIRROR_URL" > /etc/magic-mirror/url
chmod 0644 /etc/magic-mirror/url

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
echo "    0=normal  1=90°cw  2=180°  3=90°ccw"
prompt ROTATION "Rotate display? (0/1/2/3)" "0"
CONFIG_TXT="/boot/firmware/config.txt"
[ -f /boot/config.txt ] && CONFIG_TXT="/boot/config.txt"
if [ -f "$CONFIG_TXT" ]; then
    # Strip prior magic-mirror block, then append a fresh one.
    sed -i '/^# >>> magic-mirror >>>/,/^# <<< magic-mirror <<</d' "$CONFIG_TXT"
    if [ "$ROTATION" != "0" ]; then
        cat >> "$CONFIG_TXT" <<EOF
# >>> magic-mirror >>>
display_rotate=$ROTATION
# <<< magic-mirror <<<
EOF
        echo "    config.txt updated — reboot required for rotation."
    fi
else
    echo "    $CONFIG_TXT not found — skipping (non-Pi system?)."
fi

echo
echo "Done. Reboot to enter kiosk mode:"
echo "    sudo reboot"
echo
echo "To change the URL later:  sudo \$EDITOR /etc/magic-mirror/url && sudo reboot"
echo "To bail out of the kiosk: switch to tty2 with Ctrl+Alt+F2 and log in normally."
