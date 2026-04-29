#!/bin/sh
# Runs inside the X session as the `mirror` user. Disables screen
# blanking, hides the cursor, then launches Chromium in kiosk mode.

set -eu

URL_FILE="/etc/magic-mirror/url"
if [ ! -r "$URL_FILE" ]; then
    echo "start-mirror: $URL_FILE missing — re-run kiosk/install.sh" >&2
    exec xterm -e "echo 'Configure $URL_FILE then reboot'; sleep 30"
fi

MIRROR_URL=$(cat "$URL_FILE")

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
    --app="$MIRROR_URL"
