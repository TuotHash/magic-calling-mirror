#!/usr/bin/env python3
"""Magic Mirror PIR-presence agent.

Reads a PIR motion sensor on a GPIO pin and broadcasts presence-state
changes to all connected WebSocket clients on 127.0.0.1. The web
client opens this socket and uses the events to drive its dim/wake
behaviour, in place of the in-browser MediaPipe face detector.

Wire your PIR module's OUT pin to GPIO17 (BCM) by default, VCC to 5V,
GND to GND. Override via env vars (AGENT_GPIO_PIN, AGENT_WS_PORT) or
CLI flags.

Also accepts inbound `{"command":"wake"}` messages and, when
CEC_ENABLED=true, sends an HDMI-CEC power-on to the TV via cec-client.
This lets the web client wake grandpa's TV when a call comes in.
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
from typing import Set

from gpiozero import MotionSensor
import websockets

LOG = logging.getLogger("magic-mirror-agent")


class AgentState:
    def __init__(self) -> None:
        self.active: bool = False
        self.clients: Set = set()

    def message(self) -> str:
        return json.dumps({"presence": "active" if self.active else "idle"})

    async def broadcast(self) -> None:
        if not self.clients:
            return
        await asyncio.gather(
            *(c.send(self.message()) for c in self.clients),
            return_exceptions=True,
        )


async def cec_wake() -> None:
    """Power on the TV connected via HDMI by piping `on 0` to cec-client.

    `-s` runs a single command then exits, `-d 1` quietens the log output.
    Runs in a thread so a slow CEC bus doesn't stall the event loop.
    """
    def run() -> None:
        try:
            subprocess.run(
                ["cec-client", "-s", "-d", "1"],
                input=b"on 0",
                timeout=10,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError:
            LOG.warning("cec-client not installed — re-run install.sh with CEC enabled")
        except subprocess.TimeoutExpired:
            LOG.warning("cec-client timed out")
        except Exception as e:
            LOG.warning("cec-client failed: %s", e)

    await asyncio.to_thread(run)


async def handle_command(msg: dict, cec_enabled: bool) -> None:
    cmd = msg.get("command")
    if cmd == "wake":
        if not cec_enabled:
            LOG.debug("ignoring wake — CEC_ENABLED=false")
            return
        LOG.info("waking TV via HDMI-CEC")
        await cec_wake()
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
                await handle_command(msg, cec_enabled)
    finally:
        state.clients.discard(ws)
        LOG.info("client disconnected (%d remaining)", len(state.clients))


async def main(pin: int, port: int, cec_enabled: bool) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    state = AgentState()
    sensor = MotionSensor(pin)
    loop = asyncio.get_running_loop()

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

    LOG.info(
        "listening on 127.0.0.1:%d (PIR pin BCM%d, CEC %s)",
        port,
        pin,
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
        help="Enable HDMI-CEC TV wake on `{\"command\":\"wake\"}` messages",
    )
    args = parser.parse_args()
    try:
        asyncio.run(main(args.pin, args.port, args.cec))
    except KeyboardInterrupt:
        sys.exit(0)
