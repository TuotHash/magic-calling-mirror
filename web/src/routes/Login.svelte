<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../lib/store.svelte";
  import {
    fetchLoginFlows,
    buildSsoRedirectUrl,
    loginWithToken,
    startClient,
  } from "../lib/matrix";
  import { startPresence } from "../lib/presence";

  let busy = $state(true);
  let hasSso = $state(false);
  let err = $state<string | null>(null);

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("loginToken");

    if (token) {
      // Returning from SSO redirect — exchange the token for credentials.
      try {
        const creds = await loginWithToken(app.config.homeserverUrl, token);
        app.config.userId = creds.userId;
        app.config.accessToken = creds.accessToken;
        app.config.deviceId = creds.deviceId;
        app.persist();

        // Clean up the URL so a refresh doesn't try to re-use the token.
        window.history.replaceState({}, "", window.location.pathname);

        await startClient();
        app.setView(app.config.contacts.length === 0 ? "settings" : "idle");
        startPresence().catch((e) => console.warn("presence unavailable", e));
        return;
      } catch (e) {
        err = `Login failed: ${e}`;
        busy = false;
        return;
      }
    }

    try {
      const flows = await fetchLoginFlows(app.config.homeserverUrl);
      hasSso = flows.some((f) => f.type === "m.login.sso");
    } catch (e) {
      err = `Couldn't reach homeserver: ${e}`;
    } finally {
      busy = false;
    }
  });

  function startSso() {
    const url = buildSsoRedirectUrl(app.config.homeserverUrl, window.location.origin);
    window.location.href = url;
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
  {:else if err}
    <p class="err">{err}</p>
    <button onclick={reset}>Start over</button>
  {:else if hasSso}
    <h1>Sign in</h1>
    <p class="hint">{app.config.homeserverUrl}</p>
    <button class="primary" onclick={startSso}>Sign in with single sign-on</button>
    <button class="link" onclick={reset}>Use a different homeserver</button>
  {:else}
    <p class="err">
      This homeserver doesn't advertise SSO login. Configure your Synapse with
      an OIDC provider (e.g. Authentik) and try again.
    </p>
    <button onclick={reset}>Start over</button>
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
  .primary {
    background: var(--accent);
    color: #000;
    padding: 0.75rem 2rem;
    border-radius: 8px;
    font-weight: 600;
    font-size: 1.1rem;
  }
  .link { color: var(--muted); text-decoration: underline; padding: 0.5rem; }
  .err { color: var(--danger); max-width: 480px; }
</style>
