#!/usr/bin/env bash
# Uninstalls the magic mirror PIR agent.
# Usage:  sudo ./uninstall.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "uninstall.sh: must be run as root" >&2
    exit 1
fi

echo "==> Stopping service"
systemctl disable --now magic-mirror-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/magic-mirror-agent.service
systemctl daemon-reload

echo "==> Removing files"
rm -f /usr/local/bin/magic_mirror_agent.py
rm -f /etc/magic-mirror/agent.env
rmdir /etc/magic-mirror 2>/dev/null || true

echo "==> Removing service user"
if id -u magic-mirror-agent >/dev/null 2>&1; then
    userdel magic-mirror-agent || true
fi

echo "Done."
