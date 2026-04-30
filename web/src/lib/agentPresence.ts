import { app } from "./store.svelte";

/**
 * Connect to the optional Pi Agent's PIR-presence WebSocket. While
 * connected, presence-state messages drive `app.presenceActive`
 * directly. On disconnect we reconnect after a short delay; the
 * MediaPipe webcam pipeline is not started in this mode.
 *
 * Wire-format from the agent:
 *     { "presence": "active" | "idle" }
 */

const RECONNECT_DELAY_MS = 3_000;

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let stopped = false;

export function startAgentPresence(url: string): void {
  stopped = false;
  connect(url);
}

function connect(url: string): void {
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch (e) {
    console.warn("agentPresence: bad URL", url, e);
    return;
  }
  ws = socket;

  socket.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.presence === "active") app.presenceActive = true;
      else if (msg.presence === "idle") app.presenceActive = false;
    } catch {
      console.warn("agentPresence: malformed message", ev.data);
    }
  });

  // The error event fires alongside close — handle reconnects in close
  // only so we don't schedule two retries for one drop.
  socket.addEventListener("close", () => {
    if (stopped || ws !== socket) return;
    reconnectTimer = window.setTimeout(() => connect(url), RECONNECT_DELAY_MS);
  });
}

export function stopAgentPresence(): void {
  stopped = true;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}
