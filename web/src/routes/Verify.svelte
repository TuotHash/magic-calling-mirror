<script lang="ts">
  import { onDestroy } from "svelte";
  import { app } from "../lib/store.svelte";
  import { onInput } from "../lib/input";
  import {
    verifyWithRecoveryKey,
    acceptVerificationRequest,
    confirmSas,
    rejectSas,
    cancelVerification,
  } from "../lib/matrix";

  type Mode = "menu" | "key" | "wait" | "sas" | "done";

  let mode = $state<Mode>("menu");
  let recoveryKey = $state("");
  let busy = $state(false);
  let localError = $state<string | null>(null);
  let cursor = $state(0);

  // Auto-route when an external verification request comes in.
  $effect(() => {
    if (app.pendingSas && mode !== "sas") {
      mode = "sas";
      cursor = 0;
    } else if (app.pendingRequest && mode === "menu") {
      mode = "wait";
    }
  });

  // Live status string from the verification request, surfaced in the wait
  // UI so the configurator can tell how far along we got if SAS never shows.
  let phase = $state<string>("");
  $effect(() => {
    const r = app.pendingRequest;
    if (!r) {
      phase = "";
      return;
    }
    const update = () => (phase = String(r.phase));
    update();
    r.on("change" as any, update);
    return () => r.off("change" as any, update);
  });

  $effect(() => {
    if (app.verified && mode !== "done") {
      mode = "done";
      setTimeout(() => app.setView(app.config.contacts.length === 0 ? "settings" : "idle"), 1200);
    }
  });

  async function submitKey() {
    if (busy || !recoveryKey.trim()) return;
    busy = true;
    localError = null;
    try {
      await verifyWithRecoveryKey(recoveryKey);
    } catch (err) {
      localError = `Couldn't verify: ${(err as Error).message ?? err}`;
    } finally {
      busy = false;
    }
  }

  async function acceptIncoming() {
    busy = true;
    try {
      await acceptVerificationRequest();
    } catch (err) {
      localError = `Couldn't accept: ${(err as Error).message ?? err}`;
    } finally {
      busy = false;
    }
  }

  async function onMatch() {
    busy = true;
    try {
      await confirmSas();
    } finally {
      busy = false;
    }
  }

  function onMismatch() {
    rejectSas();
    mode = "menu";
  }

  const off = onInput((evt) => {
    if (busy) return;
    if (mode === "menu") {
      if (evt === "next") cursor = (cursor + 1) % 2;
      else if (evt === "prev") cursor = (cursor + 1) % 2;
      else if (evt === "select") {
        mode = cursor === 0 ? "key" : "wait";
      } else if (evt === "back") app.setView("idle");
    } else if (mode === "wait") {
      if (evt === "select") acceptIncoming();
      else if (evt === "back") {
        cancelVerification();
        mode = "menu";
      }
    } else if (mode === "sas") {
      if (evt === "next" || evt === "prev") cursor = cursor === 0 ? 1 : 0;
      else if (evt === "select") {
        if (cursor === 0) onMatch();
        else onMismatch();
      } else if (evt === "back") {
        cancelVerification();
        mode = "menu";
      }
    } else if (mode === "key") {
      if (evt === "back") mode = "menu";
    }
  });
  onDestroy(off);
  onDestroy(() => {
    if (app.pendingRequest) cancelVerification();
  });

  const emojis = $derived(app.pendingSas?.sas.emoji ?? []);
</script>

<div class="wrap">
  {#if mode === "menu"}
    <h2>Verify this session</h2>
    <p class="hint">Pick how you want to verify.</p>
    <div class="choices">
      <button class:active={cursor === 0} onclick={() => { cursor = 0; mode = "key"; }}>
        <div class="choice-title">Paste recovery key</div>
        <div class="choice-sub">From Element → Settings → Encryption.</div>
      </button>
      <button class:active={cursor === 1} onclick={() => { cursor = 1; mode = "wait"; }}>
        <div class="choice-title">Verify from another device</div>
        <div class="choice-sub">Confirm emojis on your phone.</div>
      </button>
    </div>
    <button class="link" onclick={() => app.setView("idle")}>Skip for now</button>

  {:else if mode === "key"}
    <h2>Recovery key</h2>
    <p class="hint">Paste the recovery key from Element. Spaces are OK.</p>
    <textarea bind:value={recoveryKey} placeholder="EsT… …" autocomplete="off" spellcheck="false"></textarea>
    {#if localError}<p class="error">{localError}</p>{/if}
    <div class="row">
      <button onclick={() => { mode = "menu"; localError = null; }} disabled={busy}>Back</button>
      <button class="primary" onclick={submitKey} disabled={busy || !recoveryKey.trim()}>
        {busy ? "Verifying…" : "Verify"}
      </button>
    </div>

  {:else if mode === "wait"}
    <h2>Waiting for your other device</h2>
    <p class="hint">
      On your phone or desktop Matrix client:
      <strong>Settings → Sessions → this device → Verify</strong>.
    </p>
    {#if app.pendingRequest && !app.pendingSas}
      <button class="primary" onclick={acceptIncoming} disabled={busy}>
        {busy ? "Accepting…" : "Accept request"}
      </button>
    {:else}
      <div class="spinner"></div>
    {/if}
    {#if phase}
      <p class="phase">phase: {phase}</p>
    {/if}
    <button class="link" onclick={() => { cancelVerification(); mode = "menu"; }}>Cancel</button>

  {:else if mode === "sas"}
    <h2>Do these match?</h2>
    <p class="hint">Compare with your other device. They should be identical.</p>
    <div class="emoji-grid">
      {#each emojis as e}
        <div class="emoji-cell">
          <div class="glyph">{e[0]}</div>
          <div class="label">{e[1]}</div>
        </div>
      {/each}
    </div>
    <div class="row">
      <button class:active={cursor === 1} onclick={onMismatch} disabled={busy}>No match</button>
      <button class="primary" class:active={cursor === 0} onclick={onMatch} disabled={busy}>
        {busy ? "Confirming…" : "They match"}
      </button>
    </div>

  {:else if mode === "done"}
    <h2>Verified</h2>
    <p class="hint">This mirror can now decrypt encrypted rooms.</p>
  {/if}
</div>

<style>
  .wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    padding: 2rem;
    max-width: 720px;
    margin: 0 auto;
  }
  h2 { font-weight: 200; font-size: 2.25rem; margin: 0; }
  .hint { color: var(--muted); text-align: center; max-width: 520px; }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    max-width: 520px;
  }
  .choices button {
    text-align: left;
    padding: 1.25rem 1.5rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid transparent;
  }
  .choices button.active {
    border-color: var(--accent);
    background: rgba(93, 208, 255, 0.08);
  }
  .choice-title { font-size: 1.15rem; }
  .choice-sub { color: var(--muted); font-size: 0.9rem; margin-top: 0.25rem; }

  textarea {
    width: 100%;
    max-width: 520px;
    min-height: 120px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 0.75rem;
    font-family: monospace;
    font-size: 1rem;
    resize: vertical;
  }
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .row {
    display: flex;
    gap: 0.75rem;
    width: 100%;
    max-width: 520px;
    justify-content: flex-end;
  }
  .row button {
    padding: 0.6rem 1.5rem;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 2px solid transparent;
  }
  .row button.primary {
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .row button.active {
    border-color: #fff;
    box-shadow: 0 0 0 4px rgba(93, 208, 255, 0.3);
  }
  .row button:disabled { opacity: 0.5; }

  .link {
    background: none;
    color: var(--muted);
    text-decoration: underline;
    margin-top: 0.5rem;
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 0.75rem;
    width: 100%;
    max-width: 640px;
  }
  .emoji-cell {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 10px;
    padding: 0.75rem 0.5rem;
    text-align: center;
  }
  .glyph { font-size: 2.5rem; line-height: 1; }
  .label { color: var(--muted); font-size: 0.8rem; margin-top: 0.25rem; }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error {
    color: var(--danger);
    font-size: 0.9rem;
    text-align: center;
  }
  .phase {
    color: var(--muted);
    font-size: 0.75rem;
    font-family: monospace;
    opacity: 0.6;
  }
</style>
