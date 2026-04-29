/**
 * Persistent app configuration. Lives in localStorage so the first-run
 * wizard happens in-browser and survives reloads.
 */

export interface Contact {
  userId: string;
  displayName: string;
  /** Last-known thumbnail URL. Refreshed when settings is opened. */
  avatarHttpUrl: string | null;
}

export interface AppConfig {
  homeserverUrl: string;
  userId: string | null;
  accessToken: string | null;
  deviceId: string | null;
  contacts: Contact[];
  /** Auto-answer all incoming calls (M1 default). Will become a whitelist later. */
  autoAnswer: boolean;
  /** Seconds without a detected face before dimming the screen. */
  dimAfterSeconds: number;
  /** Seconds the "ringing" splash is shown before auto-answering. */
  ringSeconds: number;
  /** Show the idle clock in 24h format. False = 12h with AM/PM. */
  clock24h: boolean;
}

const STORAGE_KEY = "magic-mirror.config.v1";

const DEFAULT_CONFIG: AppConfig = {
  homeserverUrl: "",
  userId: null,
  accessToken: null,
  deviceId: null,
  contacts: [],
  autoAnswer: true,
  dimAfterSeconds: 60,
  ringSeconds: 3,
  clock24h: true,
};

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
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
