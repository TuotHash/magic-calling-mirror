<script lang="ts">
  import { onDestroy } from "svelte";
  import { app } from "../lib/store.svelte";
  import { fetchLoginFlows } from "../lib/matrix";
  import { onInput } from "../lib/input";

  let url = $state("https://matrix.org");
  let busy = $state(false);
  let err = $state<string | null>(null);
  let inputEl: HTMLInputElement;
  let wrapEl: HTMLElement;

  $effect(() => {
    inputEl?.focus();
  });

  const off = onInput((evt) => {
    if (!wrapEl) return;
    const items = Array.from(
      wrapEl.querySelectorAll<HTMLElement>(
        "input:not([disabled]), button:not([disabled])",
      ),
    );
    if (items.length === 0) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const idx = active ? items.indexOf(active) : -1;
    switch (evt) {
      case "next":
        items[idx < 0 ? 0 : (idx + 1) % items.length]?.focus();
        break;
      case "prev":
        items[idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length]?.focus();
        break;
      case "select":
        wrapEl.querySelector<HTMLButtonElement>("button.primary")?.click();
        break;
    }
  });
  onDestroy(off);

  async function next(event?: SubmitEvent) {
    event?.preventDefault();
    if (busy) return;
    busy = true;
    err = null;
    try {
      const normalized = url.startsWith("http") ? url : `https://${url}`;
      // Validate the homeserver responds to the login endpoint before saving.
      await fetchLoginFlows(normalized);
      app.config.homeserverUrl = normalized;
      app.persist();
      app.setView("login");
    } catch (e) {
      err = `Couldn't reach ${url}. Check the URL.`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap" bind:this={wrapEl}>
  <h1>Magic Mirror</h1>
  <p class="hint">Enter your Matrix homeserver URL to begin.</p>

  <form onsubmit={next}>
    <input
      bind:this={inputEl}
      type="url"
      bind:value={url}
      placeholder="https://matrix.example.com"
    />

    <button class="primary" type="submit" disabled={busy}>
      {busy ? "Checking…" : "Continue"}
    </button>
  </form>

  {#if err}<p class="err">{err}</p>{/if}
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
  }
  h1 { font-size: 3rem; font-weight: 200; letter-spacing: -0.02em; }
  .hint { color: var(--muted); }
  form {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
    width: 100%;
  }
  input { width: min(480px, 90%); font-size: 1.25rem; }
  .primary {
    background: var(--accent);
    color: #000;
    padding: 0.75rem 2rem;
    border-radius: 8px;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .primary:disabled { opacity: 0.5; }
  .err { color: var(--danger); }
</style>
