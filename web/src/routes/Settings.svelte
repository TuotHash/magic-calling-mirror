<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { app } from "../lib/store.svelte";
  import {
    fetchAvatarBlobUrl,
    listDmCandidates,
    logout,
    type CandidateContact,
  } from "../lib/matrix";
  import { onInput } from "../lib/input";

  let candidates = $state<CandidateContact[]>([]);
  let avatarUrls = $state<Record<string, string>>({});
  let selected = $state<Set<string>>(
    new Set(app.config.contacts.map((c) => c.userId)),
  );
  let cursor = $state(0);
  let confirmLogout = $state(false);

  function toggleClock() {
    app.config.clock24h = !app.config.clock24h;
    app.persist();
  }

  function toggleAutoAnswer() {
    app.config.autoAnswer = !app.config.autoAnswer;
    app.persist();
  }

  function togglePresence() {
    app.config.presenceEnabled = !app.config.presenceEnabled;
    // Pin the screen lit immediately when turning detection off, so the
    // change is visible without waiting for a reload.
    if (!app.config.presenceEnabled) app.presenceActive = true;
    app.persist();
  }

  function toggleQuiet() {
    app.config.quietHoursEnabled = !app.config.quietHoursEnabled;
    app.persist();
  }

  function onTimeChange() {
    // Bound via bind:value — Svelte already updated the field; just persist.
    app.persist();
  }

  async function doLogout() {
    if (!confirmLogout) {
      confirmLogout = true;
      return;
    }
    await logout();
  }

  onMount(() => {
    if (!app.client) return;
    const client = app.client;
    candidates = listDmCandidates(client);
    // Place cursor on first selected entry, if any.
    const idx = candidates.findIndex((c) => selected.has(c.userId));
    if (idx >= 0) cursor = idx;

    for (const c of candidates) {
      if (!c.avatarMxc) continue;
      fetchAvatarBlobUrl(client, c.avatarMxc, 128).then((url) => {
        if (url) avatarUrls = { ...avatarUrls, [c.userId]: url };
      });
    }
  });

  onDestroy(() => {
    for (const url of Object.values(avatarUrls)) URL.revokeObjectURL(url);
  });

  function toggleAt(i: number) {
    const c = candidates[i];
    if (!c) return;
    const next = new Set(selected);
    if (next.has(c.userId)) next.delete(c.userId);
    else next.add(c.userId);
    selected = next;
  }

  function save() {
    app.config.contacts = candidates
      .filter((c) => selected.has(c.userId))
      .map((c) => ({
        userId: c.userId,
        displayName: c.displayName,
        avatarMxc: c.avatarMxc,
      }));
    app.persist();
    app.setView("idle");
  }

  const SAVE_POS = $derived(candidates.length);
  const VERIFY_POS = $derived(candidates.length + 1);
  const AUTO_ANSWER_POS = $derived(candidates.length + 2);
  const PRESENCE_POS = $derived(candidates.length + 3);
  const QUIET_POS = $derived(candidates.length + 4);
  const CLOCK_POS = $derived(candidates.length + 5);
  const LOGOUT_POS = $derived(candidates.length + 6);

  const off = onInput((evt) => {
    // Reset the "are you sure?" prompt as soon as the user moves off it.
    if (evt !== "select") confirmLogout = false;

    if (candidates.length === 0) {
      if (evt === "back") app.setView("idle");
      return;
    }
    switch (evt) {
      case "next":
        cursor = Math.min(cursor + 1, LOGOUT_POS);
        break;
      case "prev":
        cursor = Math.max(cursor - 1, 0);
        break;
      case "select":
        if (cursor === SAVE_POS) save();
        else if (cursor === VERIFY_POS) app.setView("verify");
        else if (cursor === AUTO_ANSWER_POS) toggleAutoAnswer();
        else if (cursor === PRESENCE_POS) togglePresence();
        else if (cursor === QUIET_POS) toggleQuiet();
        else if (cursor === CLOCK_POS) toggleClock();
        else if (cursor === LOGOUT_POS) doLogout();
        else toggleAt(cursor);
        break;
      case "back":
        app.setView("idle");
        break;
    }
  });
  onDestroy(off);
</script>

<div class="wrap">
  <h2>Choose contacts</h2>
  <p class="hint">Choose who can be called from this mirror</p>

  {#if candidates.length === 0}
    <p class="empty">
      No DMs found on this account. Start a 1:1 chat from another Matrix client
      first, then come back here.
    </p>
    <button onclick={() => app.setView("idle")}>Back</button>
  {:else}
    <ul>
      {#each candidates as c, i}
        <li
          class:active={i === cursor}
          class:on={selected.has(c.userId)}
          onclick={() => toggleAt(i)}
          role="button"
          tabindex="-1"
        >
          {#if avatarUrls[c.userId]}
            <img src={avatarUrls[c.userId]} alt="" />
          {:else}
            <div class="placeholder">{c.displayName.charAt(0).toUpperCase()}</div>
          {/if}
          <div class="meta">
            <div class="name">{c.displayName}</div>
            <div class="id">{c.userId}</div>
          </div>
          <div class="check" aria-hidden="true">
            {selected.has(c.userId) ? "✓" : ""}
          </div>
        </li>
      {/each}
    </ul>

    <button class="save" class:active={cursor === SAVE_POS} onclick={save}>
      Save · {selected.size} selected
    </button>

    <button
      class="verify"
      class:active={cursor === VERIFY_POS}
      onclick={() => app.setView("verify")}
    >
      {app.verified ? "Re-verify session" : "Verify session ⚠"}
    </button>

    <button
      class="toggle"
      class:active={cursor === AUTO_ANSWER_POS}
      onclick={toggleAutoAnswer}
    >
      Auto-answer calls · <strong>{app.config.autoAnswer ? "on" : "off"}</strong>
    </button>

    <button
      class="toggle"
      class:active={cursor === PRESENCE_POS}
      onclick={togglePresence}
    >
      Face detection · <strong>{app.config.presenceEnabled ? "on" : "off"}</strong>
    </button>

    <button
      class="toggle"
      class:active={cursor === QUIET_POS}
      onclick={toggleQuiet}
    >
      Sleep schedule · <strong>{app.config.quietHoursEnabled ? "on" : "off"}</strong>
    </button>

    {#if app.config.quietHoursEnabled}
      <div class="time-row">
        <label>
          From
          <input
            type="time"
            bind:value={app.config.quietFrom}
            onchange={onTimeChange}
          />
        </label>
        <label>
          Until
          <input
            type="time"
            bind:value={app.config.quietUntil}
            onchange={onTimeChange}
          />
        </label>
      </div>
    {/if}

    <button
      class="toggle"
      class:active={cursor === CLOCK_POS}
      onclick={toggleClock}
    >
      Clock format · <strong>{app.config.clock24h ? "24h" : "12h"}</strong>
    </button>

    <button
      class="logout"
      class:active={cursor === LOGOUT_POS}
      class:armed={confirmLogout}
      onclick={doLogout}
    >
      {confirmLogout ? "Tap again to confirm sign out" : "Sign out"}
    </button>

    {#if app.config.userId}
      <div class="account">Signed in as {app.config.userId}</div>
    {/if}
  {/if}
</div>

<style>
  .wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3rem 2rem;
    gap: 1rem;
    overflow-y: auto;
  }
  h2 { font-weight: 200; font-size: 2.25rem; }
  .hint { color: var(--muted); margin-bottom: 1rem; }

  ul {
    list-style: none;
    width: min(640px, 100%);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid transparent;
    transition: all 0.12s ease;
  }
  li.active {
    border-color: var(--accent);
    background: rgba(93, 208, 255, 0.08);
  }
  li.on { background: rgba(93, 208, 255, 0.12); }

  img, .placeholder {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .placeholder {
    background: var(--muted);
    color: #000;
    display: grid;
    place-items: center;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .meta { flex: 1; min-width: 0; }
  .name { font-size: 1.1rem; }
  .id { color: var(--muted); font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .check {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--accent);
    font-size: 1.25rem;
  }

  .save {
    margin-top: 1rem;
    padding: 0.75rem 2rem;
    background: var(--accent);
    color: #000;
    border-radius: 8px;
    font-weight: 600;
    font-size: 1.1rem;
    border: 2px solid transparent;
  }
  .save.active { border-color: #fff; box-shadow: 0 0 0 4px rgba(93, 208, 255, 0.3); }

  .verify, .toggle, .logout {
    margin-top: 0.5rem;
    padding: 0.6rem 1.5rem;
    background: rgba(255, 255, 255, 0.06);
    color: var(--muted);
    border-radius: 8px;
    border: 2px solid transparent;
  }
  .verify.active, .toggle.active, .logout.active {
    border-color: var(--accent);
    color: inherit;
  }
  .toggle strong { color: var(--accent); font-weight: 500; }

  .time-row {
    display: flex;
    gap: 1.25rem;
    margin-top: 0.25rem;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .time-row label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .time-row input {
    background: rgba(255, 255, 255, 0.06);
    color: var(--fg);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    font: inherit;
  }

  .logout { color: var(--danger); }
  .logout.active { border-color: var(--danger); }
  .logout.armed {
    background: rgba(255, 93, 108, 0.15);
    color: #fff;
  }

  .account {
    margin-top: 0.75rem;
    color: var(--muted);
    font-size: 0.8rem;
    opacity: 0.6;
  }

  .empty { max-width: 480px; text-align: center; color: var(--muted); }
</style>
