import type { MatrixClient, MatrixCall, Crypto } from "matrix-js-sdk";
import { loadConfig, saveConfig, type AppConfig } from "./config";

/**
 * Single source of truth for app-wide state, exposed as Svelte 5 runes.
 * Components import `app` and read reactively.
 */

export type AppView =
  | "setup"
  | "login"
  | "idle"
  | "wheel"
  | "ringing"
  | "call"
  | "settings"
  | "verify";

const VIEW_PATHS: Record<AppView, string> = {
  idle: "/",
  setup: "/setup",
  login: "/login",
  verify: "/verify",
  wheel: "/wheel",
  ringing: "/ringing",
  call: "/call",
  settings: "/settings",
};

const PATH_VIEWS: Record<string, AppView> = Object.fromEntries(
  Object.entries(VIEW_PATHS).map(([v, p]) => [p, v as AppView]),
);

export function viewToPath(view: AppView): string {
  return VIEW_PATHS[view];
}

export function pathToView(path: string): AppView | null {
  return PATH_VIEWS[path] ?? null;
}

class AppState {
  config = $state<AppConfig>(loadConfig());
  view = $state<AppView>("setup");
  client = $state<MatrixClient | null>(null);
  activeCall = $state<MatrixCall | null>(null);
  presenceActive = $state(false);
  error = $state<string | null>(null);

  // Verification state. `pendingRequest` is set when another session sends
  // an `m.key.verification.request`; `pendingSas` is set once the SAS emoji
  // are ready to display.
  verified = $state(false);
  pendingRequest = $state<Crypto.VerificationRequest | null>(null);
  pendingSas = $state<Crypto.ShowSasCallbacks | null>(null);

  persist() {
    saveConfig(this.config);
  }

  setView(view: AppView) {
    this.view = view;
    const path = viewToPath(view);
    if (
      typeof window !== "undefined" &&
      window.location.pathname !== path
    ) {
      window.history.pushState({ view }, "", path + window.location.search);
    }
  }

  // Used by the popstate listener: update view without pushing a new
  // history entry, since the browser already navigated.
  syncViewFromPath() {
    const view = pathToView(window.location.pathname);
    if (view) this.view = view;
  }
}

export const app = new AppState();
