# Magic Video Call Mirror

A Matrix-powered video call mirror — a "magic mirror" that lets anyone (including
folks who don't want to fiddle with apps and menus) start and receive video calls
effortlessly. Built for kiosk-style installs in a hallway, kitchen, or living room.

## What it is

- **Web client** (Svelte 5 + TypeScript): a full-screen, kiosk-friendly Matrix
  call client. Auto-answers calls, exposes a contact wheel for outgoing calls,
  detects presence via the webcam, and dims when no one is around.
- **Optional Pi Agent** (Python): adds GPIO PIR-sensor presence to the mix.
- **Kiosk scripts**: turn a Raspberry Pi 4 (or a mini PC) into a mirror.

The web client runs entirely in the browser, so it works on any computer with
a webcam — Raspberry Pi 4, mini PC, or your laptop for testing.

## Architecture

```
[Mirror device]                       [Your VPS]
  Chromium kiosk ──────────► Matrix Web Client (this repo)
                                          │
  [Optional] Pi Agent ──ws──┘             │
                                          ▼
                                    Synapse + TURN
                                          │
                                          ▼
                                    [Family clients]
                                    Element X / Element Web / etc.
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Web framework | Svelte 5 + Vite | Tiny runtime, snappy on Pi 4 |
| Matrix client | matrix-js-sdk | Apache-2.0, official Element SDK |
| Calls | matrix-js-sdk WebRTC + your TURN | No LiveKit needed for 1:1 |
| Auth | Standard Matrix SSO via OIDC | Works with Authentik out of the box |
| Presence | MediaPipe FaceLandmarker (browser) | No agent required by default |
| Optional agent | Python + gpiozero | PIR sensor for hardware presence |

## Quick start (development)

```bash
cd web
pnpm install
pnpm dev
```

Open the printed URL, enter your Synapse homeserver URL, log in.

## Project layout

```
web/      — Svelte web client (deployable to any static host)
agent/    — Optional Pi Agent (Python, PIR sensor)
kiosk/    — Pi kiosk setup scripts (Chromium + systemd)
docs/     — Architecture notes
```

## Licensing

This project is licensed under **Apache License 2.0** — see [LICENSE](./LICENSE)
and [NOTICE](./NOTICE).

This project is **inspired by** [Element Call](https://github.com/element-hq/element-call)
(AGPL-3.0) but contains no code copied from it. We use the Apache-2.0-licensed
[matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk) directly.

## Status

Milestone 1 in progress: core call experience (auto-answer + simple UI).
