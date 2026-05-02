/**
 * Persistent app configuration. Lives in localStorage so the first-run
 * wizard happens in-browser and survives reloads.
 */

export interface Contact {
  userId: string;
  displayName: string;
  /**
   * `mxc://` URI for the user's avatar. Resolved to an authenticated blob
   * URL at render time — Synapse ≥1.100 freezes the unauthenticated
   * /_matrix/media/v3 endpoints, so we cannot persist HTTP URLs.
   */
  avatarMxc: string | null;
}

export interface AppConfig {
  homeserverUrl: string;
  userId: string | null;
  accessToken: string | null;
  deviceId: string | null;
  contacts: Contact[];
  /** Auto-answer all incoming calls (M1 default). Will become a whitelist later. */
  autoAnswer: boolean;
  /**
   * Run a presence detector (MediaPipe webcam or Pi PIR agent) and dim
   * the idle screen when nobody's there. When false, the screen stays
   * lit and `presenceActive` is pinned true.
   */
  presenceEnabled: boolean;
  /** Seconds without a detected face before dimming the screen. */
  dimAfterSeconds: number;
  /** Seconds the "ringing" splash is shown before auto-answering. */
  ringSeconds: number;
  /** Show the idle clock in 24h format. False = 12h with AM/PM. */
  clock24h: boolean;
  /**
   * Quiet hours: while enabled and `now` falls inside [from, until),
   * incoming calls are silently ignored — no ring, no auto-answer, no TV
   * wake. The window may wrap past midnight (e.g. 22:00 → 08:00).
   */
  quietHoursEnabled: boolean;
  /** Quiet-hours start as "HH:MM" (24h). */
  quietFrom: string;
  /** Quiet-hours end as "HH:MM" (24h). */
  quietUntil: string;
  /**
   * Optional Pi Agent presence WebSocket URL (e.g. ws://127.0.0.1:8765).
   * When set, PIR-based presence drives dim/wake instead of MediaPipe.
   * Also the channel used to send `{"command":"wake"}` for HDMI-CEC TV
   * wake on incoming call. Set via `?presenceAgentUrl=…` once on first
   * load — see pi/README.md.
   */
  presenceAgentUrl: string;
}

const STORAGE_KEY = "magic-mirror.config.v1";

const DEFAULT_CONFIG: AppConfig = {
  homeserverUrl: "",
  userId: null,
  accessToken: null,
  deviceId: null,
  contacts: [],
  autoAnswer: true,
  presenceEnabled: true,
  dimAfterSeconds: 60,
  ringSeconds: 3,
  clock24h: true,
  quietHoursEnabled: false,
  quietFrom: "22:00",
  quietUntil: "08:00",
  presenceAgentUrl: "",
};

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    const merged: AppConfig = { ...DEFAULT_CONFIG, ...parsed };
    // Drop the legacy unauthenticated avatar URL field — replaced by avatarMxc.
    merged.contacts = (parsed.contacts ?? []).map((c: any) => ({
      userId: c.userId,
      displayName: c.displayName,
      avatarMxc: c.avatarMxc ?? null,
    }));
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}
