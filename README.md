# Magic Video Call Mirror

A Matrix-powered video call client for magic mirrors that lets anyone
(including folks who don't want to fiddle with apps and menus) start and
receive video calls effortlessly. Built for kiosk-style installs in a
hallway, kitchen, or living room.

> **Disclaimer:** This project contains code written by AI.
> I don't really like to code.
> I can't say anything about it's security.

## What it is

- **Web client** (Svelte 5 + TypeScript): a full-screen, kiosk-friendly
  Matrix call client. Rings through only your configured contacts, shows
  a contact wheel for outgoing calls, detects presence via webcam, and
  dims when no one is around.
- **Pi setup**: turns a Raspberry Pi 4 (or any mini PC) into a dedicated
  mirror with a single install script. Optional PIR motion-sensor
  presence agent for lower CPU and a camera-free dim/wake. See
  [`pi/README.md`](pi/README.md).

The web client runs entirely in the browser — no custom server required
beyond your existing Synapse homeserver.

## Architecture

```
[Mirror device]                    [Your VPS]
  Chromium kiosk ──────────►  Magic Mirror web client
                                        │
                              (served as static files)
                                        │
                                   Synapse + TURN
                                        │
                              [Contacts' Matrix clients]
                              Element X / Element Web / etc.
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Web framework | Svelte 5 + Vite | Tiny runtime, snappy on Pi 4 |
| Matrix client | matrix-js-sdk | Apache-2.0, official SDK |
| Calls | matrix-js-sdk WebRTC + TURN | No LiveKit needed for 1:1 |
| Crypto | matrix-sdk-crypto-wasm | Rust-based E2EE, required for encrypted DMs |
| Auth | Matrix SSO (OIDC), with username/password fallback | Works with any standards-compliant OIDC provider |
| Presence | MediaPipe FaceDetector (browser) | No extra agent required |

## Prerequisites

- A self-hosted [Synapse](https://github.com/element-hq/synapse) instance
  reachable over HTTPS, optionally with an OIDC provider for SSO
- A TURN server (coturn) for WebRTC NAT traversal
- An existing Matrix account for the mirror device

## Quick start (development)

With **pnpm**:

```bash
cd web
pnpm install
pnpm dev
```

With **Nix**:

```bash
nix-shell   # drops into a shell with node + pnpm
cd web && pnpm install && pnpm dev
```

Open the printed URL, enter your Synapse homeserver URL, and log in via
SSO — or fall back to username/password if your homeserver doesn't have
OIDC configured.

On first login you'll be prompted to verify the mirror's session
(recovery key or emoji SAS from Element X). This is required for calls
into encrypted rooms.

## Project layout

```
web/      — Svelte 5 web client
  src/
    lib/    — matrix client, store, input handling, presence, ringtone
    routes/ — one Svelte component per screen (Idle, Ringing, Call, …)
pi/       — Raspberry Pi kiosk setup scripts + optional PIR presence agent
nix/      — Nix derivation + NixOS module for serving the web client
```

## Deploy on NixOS

The repo ships a classic-Nix derivation (no flakes) that builds the
static site, plus a NixOS module that serves it via nginx with sensible
caching headers and optional ACME certificates.

In your `configuration.nix`:

```nix
let
  magic-mirror = builtins.fetchGit {
    url = "https://github.com/TuotHash/magic-calling-mirror";
    ref = "main";
  };
in {
  imports = [ "${magic-mirror}/nix/module.nix" ];

  services.magic-mirror = {
    enable   = true;
    hostName = "mirror.example.com";
    # enableACME = true;  # default; flip off if TLS is terminated upstream
  };

  security.acme.acceptTerms = true;
  security.acme.defaults.email = "you@example.com";
  networking.firewall.allowedTCPPorts = [ 80 443 ];
}
```

The browser refuses `getUserMedia` over plain HTTP, so HTTPS is required
for the camera to work.

Just want the static files? `nix-build` from the repo root produces
`./result/` containing `index.html` + hashed `assets/`.

## Pi kiosk

See [`pi/README.md`](pi/README.md) for a full guide on turning a
Raspberry Pi OS Lite install into a dedicated mirror, with the optional
PIR-based presence agent.

## Caller security

The whitelist has two sources, and a caller passes if they're in **either**:

1. **Contacts room** — the joined members of a configured Matrix room. Add
   or remove people by inviting/kicking from that room in any Matrix client
   (e.g. Element on your phone); the mirror picks up membership changes live,
   no SSH or restart required. Note that room members can see each other in
   the member list.
2. **Private contacts** — a per-person list managed in the mirror's Settings
   screen, populated from your existing DM peers. Use this for callers who
   shouldn't appear in the shared room (a doctor, a neighbor, etc.). Editing
   this list requires physical access to the mirror.

Calls from anyone in neither source are silently rejected at the Matrix level
— no audio, no video, no notification.

## Licensing

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Inspired by [Element Call](https://github.com/element-hq/element-call)
(AGPL-3.0), but contains no code from it. Uses the Apache-2.0-licensed
[matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk) directly.
