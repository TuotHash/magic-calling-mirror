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

unclutter -idle 0 -root >/dev/null 2>&1 &

# --use-fake-ui-for-media-stream auto-grants camera + mic without a prompt.
# This is safe here because the kiosk only ever loads the configured URL.
exec chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --no-first-run \
    --disable-translate \
    --disable-features=TranslateUI \
    --use-fake-ui-for-media-stream \
    --autoplay-policy=no-user-gesture-required \
    --user-data-dir=/home/mirror/.chromium-mirror \
    --app="$URL"
