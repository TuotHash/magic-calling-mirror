<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../lib/store.svelte";
  import {
    fetchLoginFlows,
    buildSsoRedirectUrl,
    getSsoIdentityProviders,
    loginWithPassword,
    loginWithToken,
    startClient,
    type SsoIdentityProvider,
  } from "../lib/matrix";
  import { startPresence } from "../lib/presence";

  let busy = $state(true);
  let hasSso = $state(false);
  let ssoProviders = $state<SsoIdentityProvider[]>([]);
  let hasPassword = $state(false);
  let err = $state<string | null>(null);

  let username = $state("");
  let password = $state("");
  let submitting = $state(false);

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("loginToken");

    if (token) {
      // Returning from SSO redirect — exchange the token for credentials.
      try {
        const creds = await loginWithToken(app.config.homeserverUrl, token);
        await finishLogin(creds);
        // Clean up the URL so a refresh doesn't try to re-use the token.
        window.history.replaceState({}, "", window.location.pathname);
        return;
      } catch (e) {
        err = `Login failed: ${e}`;
        busy = false;
        return;
      }
    }

    try {
      const flows = await fetchLoginFlows(app.config.homeserverUrl);
      const providers = getSsoIdentityProviders(flows);
      hasSso = providers !== null;
      ssoProviders = providers ?? [];
      hasPassword = flows.some((f) => f.type === "m.login.password");
    } catch (e) {
      err = `Couldn't reach homeserver: ${e}`;
    } finally {
      busy = false;
    }
  });

  async function finishLogin(creds: { userId: string; accessToken: string; deviceId: string }) {
    app.config.userId = creds.userId;
    app.config.accessToken = creds.accessToken;
    app.config.deviceId = creds.deviceId;
    app.persist();
    await startClient();
    app.setView(app.config.contacts.length === 0 ? "settings" : "idle");
    startPresence().catch((e) => console.warn("presence unavailable", e));
  }

  function startSso(idpId?: string) {
    const url = buildSsoRedirectUrl(
      app.config.homeserverUrl,
      window.location.origin,
      idpId,
    );
    window.location.href = url;
  }

  async function submitPassword(event: SubmitEvent) {
    event.preventDefault();
    if (!username || !password) return;
    submitting = true;
    err = null;
    try {
      const creds = await loginWithPassword(
        app.config.homeserverUrl,
        username.trim(),
        password,
      );
      password = "";
      await finishLogin(creds);
    } catch (e) {
      err = `${e instanceof Error ? e.message : e}`;
    } finally {
      submitting = false;
    }
  }

  function reset() {
    app.config.homeserverUrl = "";
    app.persist();
    app.setView("setup");
  }
</script>

<div class="wrap">
  {#if busy}
    <p>Signing in…</p>
  {:else if err && !hasSso && !hasPassword}
    <p class="err">{err}</p>
    <button onclick={reset}>Start over</button>
  {:else if !hasSso && !hasPassword}
    <p class="err">
      This homeserver doesn't advertise a supported login method. Configure
      Synapse with password login or an OIDC provider and try again.
    </p>
    <button onclick={reset}>Start over</button>
  {:else}
    <h1>Sign in</h1>
    <p class="hint">{app.config.homeserverUrl}</p>

    {#if hasSso && ssoProviders.length > 0}
      {#each ssoProviders as provider (provider.id)}
        <button class="primary" onclick={() => startSso(provider.id)}>
          Sign in with {provider.name}
        </button>
      {/each}
    {:else if hasSso}
      <button class="primary" onclick={() => startSso()}>
        Sign in with single sign-on
      </button>
    {/if}

    {#if hasSso && hasPassword}
      <p class="divider">or</p>
    {/if}

    {#if hasPassword}
      <form onsubmit={submitPassword}>
        <input
          type="text"
          placeholder="Username"
          autocomplete="username"
          bind:value={username}
          required
        />
        <input
          type="password"
          placeholder="Password"
          autocomplete="current-password"
          bind:value={password}
          required
        />
        <button class="primary" type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    {/if}

    {#if err}<p class="err">{err}</p>{/if}
    <button class="link" onclick={reset}>Use a different homeserver</button>
  {/if}
</div>

<style>
  .wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 2rem;
    text-align: center;
  }
  h1 { font-size: 3rem; font-weight: 200; }
  .hint { color: var(--muted); }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: min(360px, 90%);
  }
  input {
    font-size: 1.1rem;
    padding: 0.75rem 1rem;
  }
  .primary {
    background: var(--accent);
    color: #000;
    padding: 0.75rem 2rem;
    border-radius: 8px;
    font-weight: 600;
    font-size: 1.1rem;
  }
  .primary:disabled { opacity: 0.5; }
  .divider { color: var(--muted); margin: 0; }
  .link { color: var(--muted); text-decoration: underline; padding: 0.5rem; }
  .err { color: var(--danger); max-width: 480px; }
</style>
