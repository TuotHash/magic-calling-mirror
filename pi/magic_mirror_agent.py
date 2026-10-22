#!/usr/bin/env python3
"""Magic Mirror Pi agent.

Gives the web client control over things a browser can't touch, over a
WebSocket on 127.0.0.1. Inbound commands:

  {"command":"display_off"}  cut the HDMI signal (X DPMS off)
  {"command":"display_on"}   restore it
  {"command":"wake"}         restore it and, when CEC_ENABLED=true, turn
                             the TV on and switch it to our input
  {"command":"call_ended"}   with CEC, put the TV back the way `wake`
                             found it: standby if it was off, otherwise
                             give up the input so it returns to its
                             previous source

Optionally (PIR_ENABLED=true) reads a PIR motion sensor on a GPIO pin
and broadcasts presence changes, which drive the web client's dimming
in place of the in-browser MediaPipe face detector. Wire the PIR's OUT
pin to GPIO17 (BCM) by default, VCC to 5V, GND to GND. Without a sensor
presence is always reported as active.

Override via env vars (PIR_ENABLED, AGENT_GPIO_PIN, AGENT_WS_PORT,
CEC_ENABLED) or CLI flags.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
from typing import Optional, Set

import websockets

LOG = logging.getLogger("magic-mirror-agent")


class AgentState:
    def __init__(self) -> None:
        self.active: bool = False
        self.clients: Set = set()
        # How to undo the last CEC wake once the call ends: "standby",
        # "inactive", or None if there's nothing to undo.
        self.tv_restore: Optional[str] = None

    def message(self) -> str:
        return json.dumps({"presence": "active" if self.active else "idle"})

    async def broadcast(self) -> None:
        if not self.clients:
            return
        await asyncio.gather(
            *(c.send(self.message()) for c in self.clients),
            return_exceptions=True,
        )


def _cec(command: str) -> Optional[str]:
    """Run one cec-client command and return its output, or None on failure.

    `-s` runs a single command then exits, `-d 1` quietens the log output.
    Blocking — call it from a thread so a slow CEC bus doesn't stall the
    event loop.
    """
    try:
        r = subprocess.run(
            ["cec-client", "-s", "-d", "1"],
            input=command.encode(),
            timeout=10,
            check=False,
            capture_output=True,
        )
    except FileNotFoundError:
        LOG.warning("cec-client not installed — re-run install.sh with CEC enabled")
        return None
    except subprocess.TimeoutExpired:
        LOG.warning("cec-client %r timed out", command)
        return None
    except Exception as e:
        LOG.warning("cec-client %r failed: %s", command, e)
        return None
    return r.stdout.decode(errors="replace")


async def cec_wake() -> str:
    """Power on the TV (`on 0`), then announce ourselves as the active
    source (`as`) so the TV switches to our HDMI input even if it was on
    another one.

    Returns how to undo this afterwards: "standby" if the TV was off,
    otherwise "inactive" (hand the input back).
    """
    def run() -> str:
        status = (_cec("pow 0") or "").lower()
        was_off = (
            "power status: standby" in status
            or "in transition from on to standby" in status
        )
        _cec("on 0")
        _cec("as")
        return "standby" if was_off else "inactive"

    return await asyncio.to_thread(run)


async def cec_restore(action: str) -> None:
    """Undo a `cec_wake`: send the TV back to standby, or mark ourselves as
    an inactive source (`is`) so the TV returns to its previous input."""
    await asyncio.to_thread(_cec, "standby 0" if action == "standby" else "is")


async def display_power(on: bool) -> None:
    """Cut or restore the HDMI signal via X DPMS.

    Needs DISPLAY (set in the service unit) and X access, which
    start-mirror.sh grants this user with xhost. start-mirror.sh also runs
    `xset -dpms`, so DPMS is enabled here first — with zero timeouts, so
    X never blanks on its own. Any key press wakes the display in X too.
    """
    if on:
        steps = [["dpms", "force", "on"]]
    else:
        steps = [["+dpms"], ["dpms", "0", "0", "0"], ["dpms", "force", "off"]]

    def run() -> None:
        for args in steps:
            try:
                r = subprocess.run(
                    ["xset", *args],
                    timeout=5,
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
            except Exception as e:
                LOG.warning("xset %s failed: %s", " ".join(args), e)
                return
            if r.returncode != 0:
                LOG.warning(
                    "xset %s failed: %s",
                    " ".join(args),
                    r.stderr.decode(errors="replace").strip(),
                )
                return

    await asyncio.to_thread(run)


async def handle_command(msg: dict, state: AgentState, cec_enabled: bool) -> None:
    cmd = msg.get("command")
    if cmd == "wake":
        LOG.info("wake: display on%s", " + HDMI-CEC" if cec_enabled else "")
        await display_power(True)
        if cec_enabled:
            restore = await cec_wake()
            # A second wake before the call ended would see the TV already
            # on — keep the state from before the first one.
            if state.tv_restore is None:
                state.tv_restore = restore
    elif cmd == "call_ended":
        if cec_enabled and state.tv_restore is not None:
            restore, state.tv_restore = state.tv_restore, None
            LOG.info("call ended: TV %s", "to standby" if restore == "standby" else "back to previous input")
            await cec_restore(restore)
    elif cmd == "display_on":
        LOG.info("display on")
        await display_power(True)
    elif cmd == "display_off":
        LOG.info("display off")
        await display_power(False)
    else:
        LOG.debug("unknown command: %r", cmd)


async def serve_client(ws, state: AgentState, cec_enabled: bool) -> None:
    state.clients.add(ws)
    LOG.info("client connected (%d total)", len(state.clients))
    try:
        # Send current state on connect so the UI doesn't have to wait
        # for the next motion event to learn what's going on.
        await ws.send(state.message())
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except (TypeError, ValueError):
                LOG.warning("non-JSON message ignored: %r", raw)
                continue
            if isinstance(msg, dict):
                await handle_command(msg, state, cec_enabled)
    finally:
        state.clients.discard(ws)
        LOG.info("client disconnected (%d remaining)", len(state.clients))


async def main(pir: bool, pin: int, port: int, cec_enabled: bool) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    state = AgentState()
    loop = asyncio.get_running_loop()
    sensor = None

    if pir:
        # Imported here so the agent runs without gpiozero when there's
        # no sensor.
        from gpiozero import MotionSensor

        sensor = MotionSensor(pin)

        # gpiozero callbacks fire on a background thread; hop back to the
        # event loop before touching the connection set.
        def schedule_broadcast() -> None:
            loop.call_soon_threadsafe(asyncio.create_task, state.broadcast())

        def on_motion() -> None:
            state.active = True
            schedule_broadcast()

        def on_no_motion() -> None:
            state.active = False
            schedule_broadcast()

        sensor.when_motion = on_motion
        sensor.when_no_motion = on_no_motion
        state.active = sensor.motion_detected
    else:
        # No sensor: report "active" so the web client never dims.
        state.active = True

    LOG.info(
        "listening on 127.0.0.1:%d (%s, CEC %s)",
        port,
        f"PIR pin BCM{pin}" if pir else "no PIR",
        "enabled" if cec_enabled else "disabled",
    )

    # Accept both the websockets 10.x (ws, path) and 11+ (ws,) handler
    # signatures by swallowing extra positional args.
    async def handler(ws, *_):
        await serve_client(ws, state, cec_enabled)

    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    async with websockets.serve(handler, "127.0.0.1", port):
        await stop.wait()

    if sensor is not None:
        sensor.close()
    LOG.info("shutting down")


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pir",
        action=argparse.BooleanOptionalAction,
        default=_env_bool("PIR_ENABLED", True),
        help="Read a PIR motion sensor (default: on)",
    )
    parser.add_argument(
        "--pin",
        type=int,
        default=int(os.environ.get("AGENT_GPIO_PIN", "17")),
        help="BCM GPIO pin connected to PIR OUT (default: 17)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("AGENT_WS_PORT", "8765")),
        help="WebSocket port, bound to 127.0.0.1 (default: 8765)",
    )
    parser.add_argument(
        "--cec",
        action="store_true",
        default=_env_bool("CEC_ENABLED"),
        help="Also turn the TV on via HDMI-CEC on `{\"command\":\"wake\"}` messages",
    )
    args = parser.parse_args()
    try:
        asyncio.run(main(args.pir, args.pin, args.port, args.cec))
    except KeyboardInterrupt:
        sys.exit(0)
