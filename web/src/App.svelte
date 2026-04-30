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

  let showShortcuts = $state(false);

  onMount(async () => {
    installInputHandlers();

    // Press C to hide the cursor (for kiosk use). Cursor is visible by default.
    if (localStorage.getItem("magic-mirror.hide-cursor") === "1") {
      document.body.classList.add("hide-cursor");
    }
    window.addEventListener("keydown", (e) => {
      // Don't hijack typing in form fields.
      const t = e.target as HTMLElement | null;
      const editing =
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (editing) return;

      if (e.key === "c" || e.key === "C") {
        const hidden = document.body.classList.toggle("hide-cursor");
        localStorage.setItem("magic-mirror.hide-cursor", hidden ? "1" : "0");
      }
      if (e.key === "?" || e.key === "F1") {
        showShortcuts = !showShortcuts;
      }
      if (e.key === "Escape" && showShortcuts) {
        showShortcuts = false;
      }
    });

    const params = new URLSearchParams(window.location.search);

    // ?presenceAgentUrl=... is the one-time entry point for opting into
    // the Pi Agent (or back out, with an empty value). Save it and strip
    // the param so refreshes don't re-apply it.
    if (params.has("presenceAgentUrl")) {
      app.config.presenceAgentUrl = (params.get("presenceAgentUrl") ?? "").trim();
      app.persist();
      params.delete("presenceAgentUrl");
      const search = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (search ? `?${search}` : ""),
      );
    }

    // ?loginToken= means we just came back from the SSO redirect.
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

  const shortcuts = [
    { keys: "↑ ↓  /  dial", action: "Navigate up / down" },
    { keys: "← →  /  dial", action: "Navigate left / right" },
    { keys: "Enter  /  Space", action: "Select / confirm" },
    { keys: "Esc  /  Backspace", action: "Go back" },
    { keys: "Scroll wheel", action: "Navigate (same as dial)" },
    { keys: "S  (idle screen)", action: "Open settings" },
    { keys: "C", action: "Toggle cursor visibility" },
    { keys: "?  /  F1", action: "Toggle this shortcuts panel" },
  ];
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

  <!-- Shortcuts button — hidden during calls so it doesn't cover the video -->
  {#if app.view !== "call"}
    <button
      class="shortcuts-btn"
      onclick={() => (showShortcuts = !showShortcuts)}
      aria-label="Keyboard shortcuts"
      title="Shortcuts (? or F1)"
    >?</button>
  {/if}

  {#if showShortcuts}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="overlay-backdrop" onclick={() => (showShortcuts = false)}>
      <div class="overlay" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <table>
          <tbody>
            {#each shortcuts as s}
              <tr>
                <td class="keys">{s.keys}</td>
                <td class="action">{s.action}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button class="close" onclick={() => (showShortcuts = false)}>Close</button>
      </div>
    </div>
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

  .shortcuts-btn {
    position: fixed;
    top: 1rem;
    right: 1rem;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: var(--muted);
    font-size: 1.1rem;
    font-weight: 600;
    display: grid;
    place-items: center;
    transition: opacity 0.2s, background 0.2s;
    opacity: 0.4;
    z-index: 10;
  }
  .shortcuts-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.14);
  }

  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: grid;
    place-items: center;
    z-index: 100;
    backdrop-filter: blur(4px);
  }
  .overlay {
    background: #111;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 2rem;
    min-width: 360px;
    max-width: 90vw;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  h3 {
    font-weight: 300;
    font-size: 1.4rem;
    color: var(--fg);
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  tr + tr td {
    padding-top: 0.6rem;
  }
  .keys {
    font-family: monospace;
    font-size: 0.9rem;
    color: var(--accent);
    white-space: nowrap;
    padding-right: 1.5rem;
  }
  .action {
    color: var(--muted);
    font-size: 0.95rem;
  }
  .close {
    align-self: flex-end;
    padding: 0.5rem 1.25rem;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--fg);
    font-size: 0.95rem;
  }
  .close:hover {
    background: rgba(255, 255, 255, 0.14);
  }
</style>
