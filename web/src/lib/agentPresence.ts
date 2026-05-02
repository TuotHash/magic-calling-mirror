import { app } from "./store.svelte";

/**
 * Connect to the optional Pi Agent's WebSocket. The same socket carries
 * presence updates inbound (PIR sensor → drives `app.presenceActive`)
 * and command messages outbound (e.g. `{"command":"wake"}` to wake
 * grandpa's TV via HDMI-CEC on incoming call).
 *
 * The connection is opened whenever `presenceAgentUrl` is configured, so
 * `sendAgentCommand` works even with face-detection disabled. Inbound
 * presence messages are ignored when `app.config.presenceEnabled` is
 * false — the screen stays lit in that mode.
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
      // Ignore presence events when the user has disabled presence
      // dimming — the screen should stay fully lit.
      if (!app.config.presenceEnabled) return;
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

/**
 * Send a command (e.g. `"wake"`) to the Pi Agent. No-op if the socket
 * isn't open — wake is best-effort, and the call will still ring.
 */
export function sendAgentCommand(command: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ command }));
  } catch (e) {
    console.warn("agentPresence: send failed", e);
  }
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
