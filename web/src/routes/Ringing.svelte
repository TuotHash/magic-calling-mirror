<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { app } from "../lib/store.svelte";
  import { onInput } from "../lib/input";
  import {
    answerActiveCall,
    describeCaller,
    endCall,
    fetchAvatarBlobUrl,
  } from "../lib/matrix";
  import { startRingtone, stopRingtone } from "../lib/ringtone";

  const caller = $derived(
    app.activeCall ? describeCaller(app.activeCall) : null,
  );
  let avatarUrl = $state<string | null>(null);

  $effect(() => {
    const mxc = caller?.avatarMxc ?? null;
    const client = app.client;
    if (!mxc || !client) {
      avatarUrl = null;
      return;
    }
    let cancelled = false;
    let owned: string | null = null;
    fetchAvatarBlobUrl(client, mxc, 512).then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      owned = url;
      avatarUrl = url;
    });
    return () => {
      cancelled = true;
      if (owned) URL.revokeObjectURL(owned);
    };
  });

  let answerTimer: number | null = null;

  onMount(() => {
    startRingtone();
    answerTimer = window.setTimeout(
      answerActiveCall,
      app.config.ringSeconds * 1000,
    );
  });

  onDestroy(() => {
    if (answerTimer !== null) clearTimeout(answerTimer);
    stopRingtone();
  });

  const off = onInput((evt) => {
    // Click to answer immediately, back to reject.
    if (evt === "select") answerActiveCall();
    else if (evt === "back") endCall();
  });
  onDestroy(off);
</script>

<div class="wrap">
  {#if caller}
    {#if avatarUrl}
      <img class="avatar pulse" src={avatarUrl} alt="" />
    {:else}
      <div class="avatar pulse placeholder">
        {caller.displayName.charAt(0).toUpperCase()}
      </div>
    {/if}
    <div class="name">{caller.displayName}</div>
    <div class="status">is calling…</div>
  {:else}
    <div class="avatar pulse placeholder">?</div>
    <div class="name">Incoming call</div>
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
  .avatar {
    width: clamp(200px, 40vmin, 360px);
    height: clamp(200px, 40vmin, 360px);
    border-radius: 50%;
    object-fit: cover;
    border: 4px solid rgba(93, 208, 255, 0.6);
  }
  .placeholder {
    background: var(--muted);
    color: #000;
    display: grid;
    place-items: center;
    font-size: 7rem;
    font-weight: 600;
  }
  .pulse {
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(93, 208, 255, 0.6);
    }
    50% {
      box-shadow: 0 0 0 36px rgba(93, 208, 255, 0);
    }
  }
  .name {
    font-size: clamp(2rem, 6vmin, 3.5rem);
    font-weight: 300;
  }
  .status {
    font-size: clamp(1rem, 2.5vmin, 1.5rem);
    color: var(--muted);
    font-weight: 300;
  }
</style>
