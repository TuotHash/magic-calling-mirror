# Kiosk install (Raspberry Pi / Pi-like)

Turns a fresh Raspberry Pi OS Lite (64-bit, Bookworm) install into a
single-purpose mirror that boots straight into the web app.

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
   keyboard) you intend to use.
4. Host the web app somewhere reachable from the Pi (HTTPS strongly
   recommended — Chromium will refuse `getUserMedia` on plain HTTP
   origins other than `localhost`).

## Install

```sh
git clone <this repo> ~/magic-video-call-mirror
cd ~/magic-video-call-mirror/kiosk
sudo ./install.sh
```

You'll be asked for:

- **Mirror web app URL** — e.g. `https://mirror.example.com/`
- **Display rotation** — `0` for landscape, `1` for 90° clockwise
  (typical for a portrait mirror), `2` for upside-down, `3` for 90°
  counter-clockwise. Applied via `display_rotate=` in
  `/boot/firmware/config.txt`.

When it finishes:

```sh
sudo reboot
```

The Pi comes back up logged in as `mirror` on tty1, runs
`startx -- -nocursor`, and Chromium opens the web app in kiosk mode
with camera/mic auto-granted.

## Day-2 stuff

| You want to…                    | Do this                                                   |
|---------------------------------|-----------------------------------------------------------|
| Change the URL                  | `sudo nano /etc/magic-mirror/url && sudo reboot`          |
| Re-rotate the display           | Re-run `sudo ./install.sh` (it's idempotent)              |
| Get out of the kiosk            | Switch to tty2 with `Ctrl+Alt+F2`, log in as your admin user |
| Tail Chromium logs              | tty2 → `sudo journalctl -u getty@tty1 -f`                 |
| Reset Chromium state            | `sudo rm -rf /home/mirror/.chromium-mirror && sudo reboot`|
| Uninstall everything            | `sudo ./uninstall.sh` (add `--purge` to also delete the user) |

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

## Hardware notes

- 1080p USB webcams work out of the box (UVC). Check with
  `v4l2-ctl --list-devices`.
- A USB rotary encoder that emulates a keyboard (arrow keys + Enter)
  is the simplest "dial". The `mirror` user is in the `input` group so
  raw `/dev/input/event*` access also works if you wire something up
  later.
- The Pi 4 has enough oomph for 1:1 WebRTC at 720p. Don't expect 1080p
  encode to keep up.
