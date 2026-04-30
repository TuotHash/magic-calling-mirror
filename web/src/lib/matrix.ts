import {
  createClient,
  CallEvent,
  createNewMatrixCall,
  Crypto,
  type MatrixClient,
  type MatrixCall,
  type LoginFlow,
} from "matrix-js-sdk";
import { app } from "./store.svelte";

// matrix-js-sdk doesn't re-export CallEventHandlerEvent, but the underlying
// emitter just uses the string "Call.incoming". Subscribe by name.
const INCOMING_CALL = "Call.incoming";

// How long to ring the remote before giving up on an outgoing call.
const OUTGOING_CALL_TIMEOUT_MS = 30_000;
let outgoingTimeoutId: number | null = null;

/**
 * Discover what login methods a homeserver supports. We use this to decide
 * whether to render an "SSO" button (which redirects to Authentik via Synapse)
 * or fall back to password login.
 */
export async function fetchLoginFlows(homeserverUrl: string): Promise<LoginFlow[]> {
  const url = `${stripTrailingSlash(homeserverUrl)}/_matrix/client/v3/login`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`login flows request failed: ${res.status}`);
  const data = await res.json();
  return (data.flows ?? []) as LoginFlow[];
}

/**
 * One entry of `identity_providers[]` on an `m.login.sso` flow. Synapse
 * populates this from each configured OIDC provider so clients can show
 * "Sign in with <provider name>" instead of a generic SSO button.
 */
export interface SsoIdentityProvider {
  id: string;
  name: string;
  icon?: string;
  brand?: string;
}

/**
 * Extract the identity providers advertised on the SSO flow, if any.
 *  - returns `null` if SSO isn't offered at all
 *  - returns `[]` if SSO is offered but with no per-IdP entries (the
 *    homeserver expects clients to use the generic redirect endpoint)
 *  - returns a populated array when one or more named providers exist
 */
export function getSsoIdentityProviders(
  flows: LoginFlow[],
): SsoIdentityProvider[] | null {
  const sso = flows.find((f) => f.type === "m.login.sso") as
    | (LoginFlow & { identity_providers?: SsoIdentityProvider[] })
    | undefined;
  if (!sso) return null;
  return sso.identity_providers ?? [];
}

/**
 * Build the SSO redirect URL. After the user authenticates with the OIDC
 * provider, Synapse redirects back to `redirectUrl` with `?loginToken=...`.
 *
 * If `idpId` is provided, the per-provider redirect endpoint is used so
 * Synapse skips its built-in IdP-picker page and goes straight to the
 * named provider.
 */
export function buildSsoRedirectUrl(
  homeserverUrl: string,
  redirectUrl: string,
  idpId?: string,
): string {
  const base = stripTrailingSlash(homeserverUrl);
  const r = encodeURIComponent(redirectUrl);
  const path = idpId
    ? `/_matrix/client/v3/login/sso/redirect/${encodeURIComponent(idpId)}`
    : `/_matrix/client/v3/login/sso/redirect`;
  return `${base}${path}?redirectUrl=${r}`;
}

/**
 * Authenticate via `m.login.password`. Accepts either a localpart ("alice")
 * or a full Matrix ID ("@alice:example.com") — Synapse parses both.
 */
export async function loginWithPassword(
  homeserverUrl: string,
  username: string,
  password: string,
): Promise<{ userId: string; accessToken: string; deviceId: string }> {
  const url = `${stripTrailingSlash(homeserverUrl)}/_matrix/client/v3/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: username },
      password,
      initial_device_display_name: "Magic Mirror",
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `password login failed: ${res.status}`);
  }
  const data = await res.json();
  return {
    userId: data.user_id,
    accessToken: data.access_token,
    deviceId: data.device_id,
  };
}

/**
 * Exchange the loginToken returned by the SSO redirect for an access token
 * and device ID via `m.login.token`.
 */
export async function loginWithToken(
  homeserverUrl: string,
  loginToken: string,
): Promise<{ userId: string; accessToken: string; deviceId: string }> {
  const url = `${stripTrailingSlash(homeserverUrl)}/_matrix/client/v3/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.token",
      token: loginToken,
      initial_device_display_name: "Magic Mirror",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const data = await res.json();
  return {
    userId: data.user_id,
    accessToken: data.access_token,
    deviceId: data.device_id,
  };
}

/**
 * Create a matrix-js-sdk client from saved credentials and attach handlers
 * for incoming calls. Returns a started client that's syncing.
 */
export async function startClient(): Promise<MatrixClient> {
  const { homeserverUrl, userId, accessToken, deviceId } = app.config;
  if (!homeserverUrl || !userId || !accessToken || !deviceId) {
    throw new Error("missing credentials; cannot start client");
  }

  const client = createClient({
    baseUrl: homeserverUrl,
    userId,
    accessToken,
    deviceId,
    timelineSupport: false,
  });

  // Calls into encrypted DMs require crypto. Use the Rust stack — the legacy
  // Olm path is deprecated and won't be supported in matrix-js-sdk much longer.
  await client.initRustCrypto();

  client.on(INCOMING_CALL as any, handleIncomingCall);

  // Listen for verification requests initiated by another session
  // (e.g. Element X "Verify session"). When one arrives we route to the
  // verify view so the configurator can confirm. The CryptoApi interface
  // doesn't surface .on() directly — subscribe via the client, which
  // re-emits all crypto events.
  client.on(
    Crypto.CryptoEvent.VerificationRequestReceived,
    handleVerificationRequest,
  );

  // Cross-signing signatures arrive asynchronously via /sync after SAS
  // completes. Re-check verified status whenever device keys move.
  const refresh = async () => {
    app.verified = await isMirrorVerified(client);
  };
  client.on(Crypto.CryptoEvent.KeysChanged, refresh);
  client.on(Crypto.CryptoEvent.DevicesUpdated, refresh);

  await client.startClient({ initialSyncLimit: 10 });
  app.client = client;
  app.verified = await isMirrorVerified(client);
  return client;
}

/**
 * Whether this device's keys are cross-signed by the user's master key
 * (i.e. trusted by other sessions).
 */
export async function isMirrorVerified(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  const userId = client.getUserId();
  const deviceId = client.getDeviceId();
  if (!crypto || !userId || !deviceId) return false;
  const status = await crypto.getDeviceVerificationStatus(userId, deviceId);
  return status?.crossSigningVerified === true;
}

function handleIncomingCall(call: MatrixCall) {
  // Whitelist: only ring through for users in the configured contacts list.
  // Default-deny — if we can't even identify the caller, reject.
  const callerId = resolveCallerId(call);
  const allowed =
    callerId !== null &&
    app.config.contacts.some((c) => c.userId === callerId);

  if (!allowed) {
    console.warn(`rejecting call from non-contact: ${callerId ?? "unknown"}`);
    try {
      call.reject();
    } catch {
      try { call.hangup("user_busy" as any, false); } catch { /* ignore */ }
    }
    return;
  }

  if (!app.config.autoAnswer) return;

  attachCallLifecycle(call);
  app.activeCall = call;
  // Show the ringing splash; the Ringing view itself will call answerActiveCall
  // after the configured delay.
  app.setView("ringing");
}

function resolveCallerId(call: MatrixCall): string | null {
  const opp = call.getOpponentMember();
  if (opp?.userId) return opp.userId;
  // Fallback: room state may not have populated the opponent yet on a fresh
  // invite — pick the only other member in the DM room.
  const client = app.client;
  if (!client || !call.roomId) return null;
  const room = client.getRoom(call.roomId);
  if (!room) return null;
  const me = client.getUserId();
  const other =
    room.getJoinedMembers().find((m) => m.userId !== me) ??
    room.currentState.getMembers().find((m) => m.userId !== me);
  return other?.userId ?? null;
}

/**
 * Answer whatever call is currently active (call this from the Ringing view
 * once the ringtone has played, or from a manual Accept button).
 */
export function answerActiveCall(): void {
  const call = app.activeCall;
  if (!call) return;
  app.setView("call");
  call.answer().catch((err) => {
    console.error("failed to answer call", err);
    app.error = `Failed to answer: ${err.message ?? err}`;
    endCall();
  });
}

/**
 * Place an outgoing video call into a 1:1 room with the given user. Creates
 * a DM room if one doesn't exist yet.
 */
export async function placeCall(userId: string): Promise<void> {
  const client = app.client;
  if (!client) throw new Error("client not started");

  const roomId = await findOrCreateDmRoom(client, userId);

  const call = createNewMatrixCall(client, roomId);
  if (!call) throw new Error("WebRTC not supported in this browser");

  attachCallLifecycle(call);
  app.activeCall = call;
  app.setView("call");
  await call.placeCall(true, true); // audio + video

  // Bail out if the remote never picks up. The State listener in
  // attachCallLifecycle clears this once we connect.
  outgoingTimeoutId = window.setTimeout(() => {
    outgoingTimeoutId = null;
    if (app.activeCall === call) {
      app.error = "No answer";
      endCall();
    }
  }, OUTGOING_CALL_TIMEOUT_MS);
}

function attachCallLifecycle(call: MatrixCall) {
  call.on(CallEvent.Hangup, () => endCall());
  call.on(CallEvent.Error, (err: Error) => {
    console.error("call error", err);
    app.error = err.message;
    endCall();
  });
  // CallState is a string enum but isn't exported from the matrix-js-sdk
  // barrel — compare against the literal value instead.
  call.on(CallEvent.State, (state: string) => {
    if (state === "connected") clearOutgoingTimeout();
  });
}

function clearOutgoingTimeout() {
  if (outgoingTimeoutId !== null) {
    clearTimeout(outgoingTimeoutId);
    outgoingTimeoutId = null;
  }
}

export function endCall() {
  clearOutgoingTimeout();
  const call = app.activeCall;
  if (call) {
    try {
      call.hangup("user_hangup" as any, false);
    } catch {
      // ignore — call may already be terminated
    }
  }
  app.activeCall = null;
  app.setView("idle");
}

/**
 * Sign the mirror out: invalidate the access token server-side, stop the
 * client, wipe stored creds + contacts, and route back to login. Homeserver
 * URL is kept so the next login skips the setup screen.
 */
export async function logout(): Promise<void> {
  clearOutgoingTimeout();
  const client = app.client;
  if (client) {
    try { await client.logout(true); } catch { /* server unreachable — proceed anyway */ }
    try { client.stopClient(); } catch { /* ignore */ }
    try { await client.clearStores(); } catch { /* ignore */ }
  }
  app.client = null;
  app.activeCall = null;
  app.verified = false;
  app.pendingRequest = null;
  app.pendingSas = null;
  app.error = null;

  app.config.userId = null;
  app.config.accessToken = null;
  app.config.deviceId = null;
  app.config.contacts = [];
  app.persist();

  app.setView(app.config.homeserverUrl ? "login" : "setup");
}

/**
 * Resolve the "other" participant in a call's room — used by the ringing
 * splash to display who's calling. Returns null if we can't find them yet
 * (e.g., room state hasn't synced).
 */
export function describeCaller(call: MatrixCall): {
  displayName: string;
  avatarHttpUrl: string | null;
} | null {
  const client = app.client;
  if (!client) return null;
  const room = call.roomId ? client.getRoom(call.roomId) : null;
  if (!room) return null;

  const me = client.getUserId();
  const member =
    room.getJoinedMembers().find((m) => m.userId !== me) ??
    room.currentState.getMembers().find((m) => m.userId !== me);

  if (!member) return null;
  const mxc = member.getMxcAvatarUrl() ?? null;
  return {
    displayName: member.name || member.rawDisplayName || member.userId,
    avatarHttpUrl: mxc ? mxcToHttp(client, mxc, 512) : null,
  };
}

export interface CandidateContact {
  userId: string;
  displayName: string;
  avatarHttpUrl: string | null;
}

/**
 * Enumerate the user's existing 1:1 DMs as candidate contacts. Reads
 * `m.direct` account data to find direct rooms, then resolves each peer's
 * displayName and avatar via the room's member list.
 */
export function listDmCandidates(client: MatrixClient): CandidateContact[] {
  const direct = client.getAccountData("m.direct" as any);
  const dmMap = (direct?.getContent() ?? {}) as Record<string, string[]>;

  const seen = new Set<string>();
  const out: CandidateContact[] = [];

  for (const [userId, roomIds] of Object.entries(dmMap)) {
    if (seen.has(userId)) continue;
    seen.add(userId);

    let displayName = userId;
    let avatarMxc: string | null = null;
    for (const roomId of roomIds) {
      const room = client.getRoom(roomId);
      if (!room) continue;
      const member = room.getMember(userId);
      if (member) {
        displayName = member.name || member.rawDisplayName || userId;
        avatarMxc = member.getMxcAvatarUrl() ?? null;
        break;
      }
    }

    out.push({
      userId,
      displayName,
      avatarHttpUrl: avatarMxc ? mxcToHttp(client, avatarMxc, 256) : null,
    });
  }

  out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}

/**
 * Convert an mxc:// URL to a thumbnailed HTTP URL via the homeserver's media
 * proxy. Returns null if the input isn't a valid mxc URL.
 */
export function mxcToHttp(
  client: MatrixClient,
  mxcUrl: string,
  size = 256,
): string | null {
  try {
    return client.mxcUrlToHttp(mxcUrl, size, size, "crop", false, true) ?? null;
  } catch {
    return null;
  }
}

async function findOrCreateDmRoom(client: MatrixClient, userId: string): Promise<string> {
  // Look for an existing DM with this user via m.direct account data
  const direct = client.getAccountData("m.direct" as any);
  const dmMap = (direct?.getContent() ?? {}) as Record<string, string[]>;
  const existing = dmMap[userId]?.[0];
  if (existing && client.getRoom(existing)) return existing;

  const created = await client.createRoom({
    is_direct: true,
    invite: [userId],
    preset: "trusted_private_chat" as any,
  });
  return created.room_id;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

// ---------- verification ---------------------------------------------------

/**
 * Verify this device by feeding the user's Secure Backup recovery key. The
 * SDK uses the key to decrypt cross-signing private keys from secret storage,
 * then self-signs this device. One-shot: succeeds → device is cross-signed
 * forever (until logout).
 */
export async function verifyWithRecoveryKey(recoveryKey: string): Promise<void> {
  const client = app.client;
  if (!client) throw new Error("client not started");
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("crypto not initialised");

  const decoded = Crypto.decodeRecoveryKey(recoveryKey.trim());

  // bootstrapCrossSigning will call this to unlock secret storage. The keys
  // map normally has one entry — return the first id alongside the decoded
  // bytes. If the key is wrong, secret-storage decryption fails downstream.
  client.cryptoCallbacks.getSecretStorageKey = async ({ keys }) => {
    const keyId = Object.keys(keys)[0];
    if (!keyId) return null;
    return [keyId, decoded];
  };

  await crypto.bootstrapCrossSigning({});
  app.verified = await isMirrorVerified(client);
  if (!app.verified) {
    throw new Error("device still unverified after bootstrap — wrong key?");
  }
}

function handleVerificationRequest(request: Crypto.VerificationRequest) {
  // Ignore cross-user verifications — we only care about self-verification
  // (another session of the same Matrix user trusting this one).
  if (!request.isSelfVerification) {
    request.cancel().catch(() => { /* ignore */ });
    return;
  }

  // NB: don't read request.methods here — the Rust verifier's getter throws
  // "not implemented" until phase reaches Ready/Started, and an exception
  // inside this event handler aborts the rest of /sync delivery.
  console.debug("[verify] request received, phase:", request.phase);

  app.pendingRequest = request;
  app.pendingSas = null;
  app.setView("verify");

  // Attach immediately in case the verifier is already populated.
  if (request.verifier) attachVerifier(request.verifier);

  request.on(Crypto.VerificationRequestEvent.Change, () => {
    console.debug("[verify] phase change", request.phase);

    if (request.phase === Crypto.VerificationPhase.Done) {
      finishVerification(true);
      return;
    }
    if (request.phase === Crypto.VerificationPhase.Cancelled) {
      finishVerification(false);
      return;
    }

    if (request.verifier) attachVerifier(request.verifier);
  });
}

function attachVerifier(verifier: Crypto.Verifier) {
  if ((verifier as any).__mirrorAttached) return;
  (verifier as any).__mirrorAttached = true;
  console.debug("[verify] verifier attached");

  verifier.on(Crypto.VerifierEvent.ShowSas, (cbs) => {
    console.debug("[verify] ShowSas fired");
    app.pendingSas = cbs;
  });
  verifier.on(Crypto.VerifierEvent.Cancel, (e) => {
    console.debug("[verify] verifier cancelled", e);
    finishVerification(false);
  });

  // The SAS callbacks may already be available — the ShowSas event might
  // have fired before we got a chance to attach.
  const existing = verifier.getShowSasCallbacks();
  if (existing) {
    console.debug("[verify] SAS callbacks already present");
    app.pendingSas = existing;
  }

  // Rust crypto needs an explicit kick to actually start the SAS protocol
  // once the request transitions to Started. Idempotent — safe to call even
  // if the verifier has already begun.
  verifier.verify().catch((err) => {
    console.warn("[verify] verifier.verify() rejected", err);
  });
}

/** Accept the pending verification request — sends `m.key.verification.ready`. */
export async function acceptVerificationRequest(): Promise<void> {
  const r = app.pendingRequest;
  if (!r) return;
  await r.accept();
}

/** User confirmed the SAS emojis match. */
export async function confirmSas(): Promise<void> {
  const sas = app.pendingSas;
  if (!sas) return;
  await sas.confirm();
}

/** User said the SAS emojis don't match — cancels with mismatch reason. */
export function rejectSas(): void {
  const sas = app.pendingSas;
  if (!sas) return;
  sas.mismatch();
}

/** Cancel the entire verification flow (back/escape). */
export async function cancelVerification(): Promise<void> {
  const r = app.pendingRequest;
  if (r && r.pending) {
    try { await r.cancel(); } catch { /* ignore */ }
  }
  finishVerification(false);
}

let verifiedPollTimer: number | null = null;

function finishVerification(succeeded: boolean) {
  app.pendingRequest = null;
  app.pendingSas = null;
  if (succeeded && app.client) {
    pollUntilVerified(app.client, 10_000);
  }
}

/**
 * After SAS completes, the cross-signing signature still has to round-trip
 * via /sync before crossSigningVerified flips true. The KeysChanged event
 * usually catches it, but as a fallback we also poll for a few seconds.
 */
function pollUntilVerified(client: MatrixClient, durationMs: number) {
  if (verifiedPollTimer !== null) clearInterval(verifiedPollTimer);
  const deadline = Date.now() + durationMs;
  const tick = async () => {
    const v = await isMirrorVerified(client);
    if (v) {
      app.verified = true;
      if (verifiedPollTimer !== null) {
        clearInterval(verifiedPollTimer);
        verifiedPollTimer = null;
      }
    } else if (Date.now() > deadline && verifiedPollTimer !== null) {
      clearInterval(verifiedPollTimer);
      verifiedPollTimer = null;
    }
  };
  verifiedPollTimer = window.setInterval(tick, 500);
  tick();
}
