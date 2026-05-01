#!/usr/bin/env bash
# Reverses what install.sh did. Removes the kiosk and the optional PIR
# agent if it was installed. Leaves the `mirror` user's home dir alone
# (in case there's a Chromium profile worth keeping); pass --purge to
# nuke that too.
#
# Usage:  sudo ./uninstall.sh [--purge]

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "uninstall.sh: must be run as root" >&2
    exit 1
fi

PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

if [ -f /etc/systemd/system/magic-mirror-agent.service ]; then
    echo "==> Removing PIR agent"
    systemctl disable --now magic-mirror-agent.service 2>/dev/null || true
    rm -f /etc/systemd/system/magic-mirror-agent.service
    rm -f /usr/local/bin/magic_mirror_agent.py
    if id -u magic-mirror-agent >/dev/null 2>&1; then
        userdel magic-mirror-agent || true
    fi
fi

echo "==> Disabling autologin"
rm -f /etc/systemd/system/getty@tty1.service.d/override.conf
rmdir /etc/systemd/system/getty@tty1.service.d 2>/dev/null || true
systemctl daemon-reload

echo "==> Removing kiosk launcher and config"
rm -f /usr/local/bin/start-mirror.sh
rm -rf /etc/magic-mirror

echo "==> Removing rotation block from config.txt"
for f in /boot/firmware/config.txt /boot/config.txt; do
    [ -f "$f" ] && sed -i '/^# >>> magic-mirror >>>/,/^# <<< magic-mirror <<</d' "$f"
done

if [ "$PURGE" -eq 1 ] && id mirror >/dev/null 2>&1; then
    echo "==> Removing mirror user (--purge)"
    userdel -r mirror || true
fi

echo "Done. Reboot to drop back to normal text login."
