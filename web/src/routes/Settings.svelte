<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { app } from "../lib/store.svelte";
  import { listDmCandidates, type CandidateContact } from "../lib/matrix";
  import { onInput } from "../lib/input";

  let candidates = $state<CandidateContact[]>([]);
  let selected = $state<Set<string>>(
    new Set(app.config.contacts.map((c) => c.userId)),
  );
  let cursor = $state(0);

  onMount(() => {
    if (!app.client) return;
    candidates = listDmCandidates(app.client);
    // Place cursor on first selected entry, if any.
    const idx = candidates.findIndex((c) => selected.has(c.userId));
    if (idx >= 0) cursor = idx;
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
        avatarHttpUrl: c.avatarHttpUrl,
      }));
    app.persist();
    app.setView("idle");
  }

  const SAVE_POS = $derived(candidates.length);
  const VERIFY_POS = $derived(candidates.length + 1);

  const off = onInput((evt) => {
    if (candidates.length === 0) {
      if (evt === "back") app.setView("idle");
      return;
    }
    switch (evt) {
      case "next":
        cursor = Math.min(cursor + 1, VERIFY_POS);
        break;
      case "prev":
        cursor = Math.max(cursor - 1, 0);
        break;
      case "select":
        if (cursor === SAVE_POS) save();
        else if (cursor === VERIFY_POS) app.setView("verify");
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
          {#if c.avatarHttpUrl}
            <img src={c.avatarHttpUrl} alt="" />
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

  .verify {
    margin-top: 0.5rem;
    padding: 0.6rem 1.5rem;
    background: rgba(255, 255, 255, 0.06);
    color: var(--muted);
    border-radius: 8px;
    border: 2px solid transparent;
  }
  .verify.active { border-color: var(--accent); color: inherit; }

  .empty { max-width: 480px; text-align: center; color: var(--muted); }
</style>
