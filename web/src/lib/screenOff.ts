import { app } from "./store.svelte";
import { sendAgentCommand } from "./agentPresence";

/**
 * Turns the display off after `screenOffMinutes` without activity
 * (button press, call). The browser can't cut the HDMI signal itself, so
 * this asks the Pi agent to; without the agent it's a no-op.
 *
 * X wakes the display on any key press by itself, but the web client
 * still needs to know: the first press after waking is swallowed so it
 * doesn't also move the cursor or start a call on a screen nobody saw.
 */

let timer: number | null = null;
let off = false;

export function installScreenOff(): void {
  // Capture phase on window runs before every other key/wheel/click
  // handler, so a swallowed wake press never reaches them.
  for (const type of ["keydown", "wheel", "pointerdown"]) {
    window.addEventListener(
      type,
      (e) => {
        if (noteActivity()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      { capture: true, passive: false },
    );
  }
  restartTimer();
}

/**
 * Record activity: wake the display if it's off and restart the countdown.
 * Returns true if this call woke the display.
 */
export function noteActivity(): boolean {
  const woke = off;
  if (off) {
    off = false;
    sendAgentCommand("display_on");
  }
  restartTimer();
  return woke;
}

function restartTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const minutes = app.config.screenOffMinutes;
  if (minutes > 0) timer = window.setTimeout(sleep, minutes * 60_000);
}

function sleep(): void {
  timer = null;
  // Never blank a ringing or running call, or a setup/login/verify flow
  // someone is in the middle of — check again later instead.
  if (app.activeCall || !["idle", "wheel", "settings"].includes(app.view)) {
    restartTimer();
    return;
  }
  app.setView("idle");
  off = true;
  sendAgentCommand("display_off");
}
