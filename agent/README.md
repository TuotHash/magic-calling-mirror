# Pi Agent — PIR-based presence

Hardware-accelerated presence detection for the Magic Mirror, using a
cheap PIR motion sensor instead of the in-browser face detector. Useful
when you want lower CPU load on a Pi 4, or when you don't want a camera
permanently aimed at the room.

The agent runs as a systemd service on the same Pi as the kiosk, reads
a PIR sensor on a GPIO pin, and exposes presence events to the web
client over a localhost WebSocket. The web app picks these up and uses
them to drive its dim/wake behaviour, replacing the MediaPipe pipeline.

## Hardware

A 3-pin PIR module (HC-SR501 or similar) wired to the Pi:

| PIR pin | Pi pin                               |
|---------|--------------------------------------|
| VCC     | 5V (e.g. physical pin 2)             |
| GND     | GND (e.g. physical pin 6)            |
| OUT     | BCM 17 (physical pin 11) — configurable |

If your module has on-board potentiometers, set:

- **Time delay (Tx)** — how long OUT stays HIGH after the last detected
  motion. 5–30 s works well; the web client's dim animation is driven
  directly by this signal, so think of it as "how long the screen
  stays bright after the room goes still".
- **Sensitivity (Sx)** — start mid-range and tune to your room.

## Install

On the Pi (over SSH):

```sh
git clone https://github.com/TuotHash/magic-calling-mirror ~/magic-calling-mirror
cd ~/magic-calling-mirror/agent
sudo ./install.sh
```

You'll be asked for the GPIO pin and the WebSocket port. The defaults
(BCM 17, port 8765) match the rest of this README. The script installs
`python3-gpiozero` + `python3-websockets`, deploys
`/usr/local/bin/magic_mirror_agent.py`, and enables a systemd unit that
restarts on failure.

> **Pi 5:** `python3-rpi.gpio` doesn't work; install `python3-lgpio`
> after running this script. gpiozero will pick it up automatically.

## Wire it up to the web app

The web client only switches over once it knows the agent's URL. Open
the kiosk URL once with `?presenceAgentUrl=ws://127.0.0.1:8765`
appended:

```
https://mirror.example.com/?presenceAgentUrl=ws://127.0.0.1:8765
```

The web app saves the URL to `localStorage` and the parameter can be
dropped from the URL after the first load. From then on, the in-browser
MediaPipe detector is no longer started — the Pi Agent drives presence.

To revert to webcam-based presence, load the page once with an empty
value: `?presenceAgentUrl=`.

## Verify

```sh
systemctl status magic-mirror-agent.service
journalctl -u magic-mirror-agent.service -f
```

You should see a "client connected" line once the kiosk Chromium loads
the page, and "presence active/idle" updates as you move in front of
the sensor.

## Uninstall

```sh
sudo ./uninstall.sh
```

## Why this shape

A few non-obvious choices, in case you go rummaging:

- **PIR over WebSocket, not GPIO straight into the browser.** The web
  client runs in a sandboxed Chromium and can't read `/dev/gpiomem`.
  A small WS server is the simplest bridge.
- **Loopback bind (`127.0.0.1`).** The agent has no auth — keeping it
  off the network is cheaper than adding one. Chromium permits
  `ws://localhost` from HTTPS pages, so no certificate dance.
- **systemd `Restart=on-failure`.** PIR wiring can be flaky; if the
  script ever panics we want it back without a reboot.
- **Apt packages, not pip/venv.** Bookworm has both `python3-gpiozero`
  and `python3-websockets` packaged, which avoids dragging Python
  build tooling onto the Pi.
