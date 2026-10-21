#!/bin/sh
# Runs inside the X session as the `mirror` user. Disables screen
# blanking, hides the cursor, then launches Chromium in kiosk mode.

set -eu

CONFIG_FILE="/etc/magic-mirror/config"
if [ ! -r "$CONFIG_FILE" ]; then
    echo "start-mirror: $CONFIG_FILE missing — re-run pi/install.sh" >&2
    exec xterm -e "echo 'Configure $CONFIG_FILE then reboot'; sleep 30"
fi

# shellcheck disable=SC1090
. "$CONFIG_FILE"

URL="$MIRROR_URL"
if [ "${AGENT_ENABLED:-false}" = "true" ]; then
    sep="?"
    case "$URL" in *\?*) sep="&" ;; esac
    URL="${URL}${sep}presenceAgentUrl=ws://127.0.0.1:${AGENT_WS_PORT:-8765}"
fi

xset s off
xset s noblank
xset -dpms

# The Pi agent runs as its own system user and cuts/restores the HDMI
# signal with xset, so let it talk to this X server.
if [ "${AGENT_ENABLED:-false}" = "true" ]; then
    xhost +SI:localuser:magic-mirror-agent >/dev/null || true
fi

unclutter -idle 0 -root >/dev/null 2>&1 &

# Pi OS / Debian renamed the binary from `chromium-browser` to `chromium`
# around Trixie. Pick whichever exists.
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROMIUM" ]; then
    echo "start-mirror: no chromium binary found — re-run pi/install.sh" >&2
    exec xterm -e "echo 'Install chromium then reboot'; sleep 30"
fi

# --use-fake-ui-for-media-stream auto-grants camera + mic without a prompt.
# This is safe here because the kiosk only ever loads the configured URL.
# WebRtcPipeWireCamera is disabled because newer Chromium tries the
# xdg-desktop-portal camera path, which doesn't exist on Pi OS Lite, and
# getUserMedia then hangs forever instead of falling back to V4L2.
# Chromium honours only the last --disable-features, so keep them in one flag.
exec "$CHROMIUM" \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --no-first-run \
    --disable-translate \
    --disable-features=TranslateUI,WebRtcPipeWireCamera \
    --use-fake-ui-for-media-stream \
    --autoplay-policy=no-user-gesture-required \
    --user-data-dir=/home/mirror/.chromium-mirror \
    --app="$URL"
