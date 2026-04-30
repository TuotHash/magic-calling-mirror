<script lang="ts">
  import { onDestroy } from "svelte";
  import { app } from "../lib/store.svelte";
  import { onInput } from "../lib/input";
  import { fetchAvatarBlobUrl, placeCall } from "../lib/matrix";

  let index = $state(0);
  let placing = $state(false);
  const contacts = $derived(app.config.contacts);
  const current = $derived(contacts[index]);

  let avatarUrls = $state<Record<string, string>>({});

  $effect(() => {
    const client = app.client;
    if (!client) return;
    for (const c of contacts) {
      if (!c.avatarMxc || avatarUrls[c.userId]) continue;
      fetchAvatarBlobUrl(client, c.avatarMxc, 512).then((url) => {
        if (url) avatarUrls = { ...avatarUrls, [c.userId]: url };
      });
    }
  });

  onDestroy(() => {
    for (const url of Object.values(avatarUrls)) URL.revokeObjectURL(url);
  });

  const off = onInput(async (evt) => {
    if (placing) return;
    if (contacts.length === 0) {
      if (evt === "back") app.setView("idle");
      return;
    }
    switch (evt) {
      case "next":
        index = (index + 1) % contacts.length;
        break;
      case "prev":
        index = (index - 1 + contacts.length) % contacts.length;
        break;
      case "select":
        placing = true;
        try {
          await placeCall(contacts[index].userId);
        } catch (err) {
          app.error = `Couldn't place call: ${err}`;
          placing = false;
        }
        break;
      case "back":
        app.setView("idle");
        break;
    }
  });
  onDestroy(off);
</script>

<div class="wrap">
  {#if contacts.length === 0}
    <p class="empty">
      No contacts yet. Press <kbd>S</kbd> from the clock screen to open settings,
      or start a Matrix DM with someone first.
    </p>
    <button onclick={() => app.setView("idle")}>Back</button>
  {:else}
    <p class="prompt">Call</p>

    <div class="card">
      {#if avatarUrls[current.userId]}
        <img src={avatarUrls[current.userId]} alt="" />
      {:else}
        <div class="placeholder">{current.displayName.charAt(0).toUpperCase()}</div>
      {/if}
      <div class="name">{current.displayName}</div>
    </div>

    <div class="dots" aria-hidden="true">
      {#each contacts as _, i}
        <span class:on={i === index}></span>
      {/each}
    </div>

    <p class="hint">
      {#if placing}
        Calling…
      {:else}
        Turn dial · Click to call · Back to cancel
      {/if}
    </p>
  {/if}
</div>

<style>
  .wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 2rem;
  }
  .prompt {
    color: var(--muted);
    font-size: 1.5rem;
    font-weight: 300;
    text-transform: uppercase;
    letter-spacing: 0.2em;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
  }
  img, .placeholder {
    width: clamp(180px, 36vmin, 320px);
    height: clamp(180px, 36vmin, 320px);
    border-radius: 50%;
    object-fit: cover;
    border: 4px solid rgba(93, 208, 255, 0.4);
    box-shadow: 0 16px 60px rgba(93, 208, 255, 0.2);
  }
  .placeholder {
    background: var(--muted);
    color: #000;
    display: grid;
    place-items: center;
    font-size: 6rem;
    font-weight: 600;
  }
  .name {
    font-size: clamp(2rem, 6vmin, 3.5rem);
    font-weight: 300;
    text-align: center;
  }
  .dots {
    display: flex;
    gap: 0.5rem;
  }
  .dots span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
    opacity: 0.4;
    transition: all 0.2s ease;
  }
  .dots span.on {
    background: var(--accent);
    opacity: 1;
    transform: scale(1.4);
  }
  .hint {
    margin-top: 1rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .empty { max-width: 480px; text-align: center; color: var(--muted); }
  kbd {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 0.1rem 0.4rem;
    font-family: monospace;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
</style>
