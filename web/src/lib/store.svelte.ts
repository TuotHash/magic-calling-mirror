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
  }
}

export const app = new AppState();
