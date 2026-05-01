# Pi setup — kiosk + optional PIR agent

Turns a fresh Raspberry Pi OS Lite (64-bit, Bookworm) install into a
single-purpose mirror that boots straight into the web app, with an
optional PIR motion-sensor presence agent that replaces the in-browser
face detector.

The kiosk is mandatory; the agent is opt-in. One `install.sh`, one
`/etc/magic-mirror/config`, one `uninstall.sh`.

## Pre-requisites

1. Flash **Raspberry Pi OS Lite (64-bit)** to the SD card. In the
   imager's advanced options, set:
   - hostname (e.g. `mirror`)
   - a non-`mirror` admin user (the install script creates a separate
     `mirror` user for the kiosk session)
   - your Wi-Fi credentials
   - SSH enabled
2. Boot the Pi, SSH in, and `sudo apt update && sudo apt full-upgrade -y`
   followed by a reboot.
3. Plug in the USB webcam and any input device (rotary encoder /
   keyboard) you intend to use. If you're enabling the PIR agent, wire
   the sensor too — see [Hardware](#hardware) below.
4. Host the web app somewhere reachable from the Pi (HTTPS strongly
   recommended — Chromium will refuse `getUserMedia` on plain HTTP
   origins other than `localhost`).

## Install

```sh
git clone https://github.com/TuotHash/magic-calling-mirror ~/magic-calling-mirror
cd ~/magic-calling-mirror/pi
sudo ./install.sh
```

You'll be asked for:

- **Mirror web app URL** — e.g. `https://mirror.example.com/`
- **Display rotation** — `0` for landscape, `1` for 90° clockwise
  (typical for a portrait mirror), `2` for upside-down, `3` for 90°
  counter-clockwise. Applied via `display_rotate=` in
  `/boot/firmware/config.txt`.
- **Enable PIR agent?** — `y` to wire up the motion sensor; `n` (default)
  to keep using the in-browser MediaPipe face detector.
  - If yes: **GPIO pin** (BCM, default 17) and **WebSocket port**
    (default 8765, loopback-only).

Re-running `install.sh` is safe and idempotent — it pulls existing values
from `/etc/magic-mirror/config` as defaults, so you can flip the agent
on/off or change the URL without surprise.

When it finishes:

```sh
sudo reboot
```

The Pi comes back up logged in as `mirror` on tty1, runs
`startx -- -nocursor`, and Chromium opens the web app in kiosk mode with
camera/mic auto-granted. If the agent is enabled, `start-mirror.sh`
automatically appends `?presenceAgentUrl=ws://127.0.0.1:<port>` so the
web client picks up PIR presence on first load — no manual URL fiddling.

## Day-2 stuff

| You want to…                    | Do this                                                   |
|---------------------------------|-----------------------------------------------------------|
| Change any setting              | `sudo ./install.sh` (re-prompts) **or** `sudo $EDITOR /etc/magic-mirror/config && sudo reboot` |
| Get out of the kiosk            | Switch to tty2 with `Ctrl+Alt+F2`, log in as your admin user |
| Tail Chromium logs              | tty2 → `sudo journalctl -u getty@tty1 -f`                 |
| Tail agent logs                 | `journalctl -u magic-mirror-agent.service -f`             |
| Reset Chromium state            | `sudo rm -rf /home/mirror/.chromium-mirror && sudo reboot`|
| Uninstall everything            | `sudo ./uninstall.sh` (add `--purge` to also delete the user) |

## Hardware

### Display & input

- 1080p USB webcams work out of the box (UVC). Check with
  `v4l2-ctl --list-devices`.
- A USB rotary encoder that emulates a keyboard (arrow keys + Enter)
  is the simplest "dial". The `mirror` user is in the `input` group so
  raw `/dev/input/event*` access also works if you wire something up
  later.
- The Pi 4 has enough oomph for 1:1 WebRTC at 720p. Don't expect 1080p
  encode to keep up.

### PIR sensor (optional, only if agent enabled)

A 3-pin PIR module (HC-SR501 or similar) wired to the Pi:

| PIR pin | Pi pin                                  |
|---------|-----------------------------------------|
| VCC     | 5V (e.g. physical pin 2)                |
| GND     | GND (e.g. physical pin 6)               |
| OUT     | BCM 17 (physical pin 11) — configurable |

If your module has on-board potentiometers, set:

- **Time delay (Tx)** — how long OUT stays HIGH after the last detected
  motion. 5–30 s works well; the web client's dim animation is driven
  directly by this signal, so think of it as "how long the screen
  stays bright after the room goes still".
- **Sensitivity (Sx)** — start mid-range and tune to your room.

> **Pi 5:** `python3-rpi.gpio` doesn't work; install `python3-lgpio`
> after running `install.sh`. gpiozero will pick it up automatically.

## Why this shape

A few non-obvious choices, in case you go rummaging:

- **Autologin + `.bash_profile` startx** instead of a systemd unit
  running `xinit`. It's the plainest Raspberry Pi pattern, easier to
  debug from another VT, and `Xwrapper.config` doesn't need elevated
  rights to launch under a real login session.
- **`--use-fake-ui-for-media-stream`** auto-grants camera + mic without
  ever showing a permission prompt. Safe here because the kiosk only
  ever loads the configured URL — but don't repurpose this Chromium
  profile for general browsing.
- **`unclutter -idle 0`** hides the cursor immediately. There's also a
  `C` keybind in the web app that toggles cursor visibility (per
  browser, persisted in `localStorage`) for live debugging.
- **No screen blanking** (`xset s off; xset -dpms`). Presence-based
  dimming happens inside the web app itself.
- **PIR over WebSocket, not GPIO straight into the browser.** The web
  client runs in a sandboxed Chromium and can't read `/dev/gpiomem`.
  A small WS server is the simplest bridge.
- **Loopback bind (`127.0.0.1`).** The agent has no auth — keeping it
  off the network is cheaper than adding one. Chromium permits
  `ws://localhost` from HTTPS pages, so no certificate dance.
- **systemd `Restart=on-failure`** for the agent. PIR wiring can be
  flaky; if the script ever panics we want it back without a reboot.
- **Apt packages, not pip/venv.** Bookworm has both `python3-gpiozero`
  and `python3-websockets` packaged, which avoids dragging Python
  build tooling onto the Pi.
