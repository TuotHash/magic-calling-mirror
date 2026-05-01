<script lang="ts">
  import { app } from "../lib/store.svelte";
  import { fetchLoginFlows } from "../lib/matrix";

  let url = $state("https://matrix.org");
  let busy = $state(false);
  let err = $state<string | null>(null);
  let inputEl: HTMLInputElement;

  $effect(() => {
    inputEl?.focus();
  });

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

<div class="wrap">
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
