<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./lib/store.svelte";
  import { startClient } from "./lib/matrix";
  import { installInputHandlers } from "./lib/input";
  import { startPresence } from "./lib/presence";

  import Setup from "./routes/Setup.svelte";
  import Login from "./routes/Login.svelte";
  import Idle from "./routes/Idle.svelte";
  import ContactWheel from "./routes/ContactWheel.svelte";
  import Ringing from "./routes/Ringing.svelte";
  import Call from "./routes/Call.svelte";
  import Settings from "./routes/Settings.svelte";
  import Verify from "./routes/Verify.svelte";

  onMount(async () => {
    installInputHandlers();

    // Configurator shortcut: press C to toggle the system cursor on/off.
    // Persisted in localStorage so reloads remember the choice.
    if (localStorage.getItem("magic-mirror.show-cursor") === "1") {
      document.body.classList.add("show-cursor");
    }
    window.addEventListener("keydown", (e) => {
      if (e.key === "c" || e.key === "C") {
        const on = document.body.classList.toggle("show-cursor");
        localStorage.setItem("magic-mirror.show-cursor", on ? "1" : "0");
      }
    });

    // ?loginToken= means we just came back from the SSO redirect.
    const params = new URLSearchParams(window.location.search);
    if (params.get("loginToken")) {
      app.setView("login");
      return;
    }

    if (!app.config.homeserverUrl) {
      app.setView("setup");
    } else if (!app.config.accessToken) {
      app.setView("login");
    } else {
      try {
        await startClient();
        // First-run convenience: if no contacts are configured yet, jump
        // straight to the picker so the configurator can finish setup.
        // If the device isn't cross-signed yet, route to verify first —
        // calls into encrypted rooms will fail without it.
        if (!app.verified) {
          app.setView("verify");
        } else {
          app.setView(app.config.contacts.length === 0 ? "settings" : "idle");
        }
        // Presence detection is best-effort — never block the UI on it.
        startPresence().catch((err) => console.warn("presence unavailable", err));
      } catch (err) {
        console.error(err);
        app.error = String(err);
        app.setView("login");
      }
    }
  });
</script>

<main class:dim={!app.presenceActive && app.view === "idle"}>
  {#if app.view === "setup"}
    <Setup />
  {:else if app.view === "login"}
    <Login />
  {:else if app.view === "idle"}
    <Idle />
  {:else if app.view === "wheel"}
    <ContactWheel />
  {:else if app.view === "ringing"}
    <Ringing />
  {:else if app.view === "call"}
    <Call />
  {:else if app.view === "settings"}
    <Settings />
  {:else if app.view === "verify"}
    <Verify />
  {/if}

  {#if app.error}
    <div class="error" role="alert">{app.error}</div>
  {/if}
</main>

<style>
  main {
    width: 100%;
    height: 100%;
    transition: opacity 1.5s ease;
  }
  main.dim {
    opacity: 0.05;
  }
  .error {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--danger);
    color: #fff;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    max-width: 80%;
  }
</style>
