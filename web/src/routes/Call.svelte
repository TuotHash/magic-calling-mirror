<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { app } from "../lib/store.svelte";
  import { onInput } from "../lib/input";
  import { endCall } from "../lib/matrix";
  import { CallEvent } from "matrix-js-sdk";

  let remoteVideo: HTMLVideoElement;
  let localVideo: HTMLVideoElement;

  function attachStreams() {
    const call = app.activeCall;
    if (!call) return;
    const feeds = call.getFeeds();
    for (const feed of feeds) {
      const stream = feed.stream;
      if (feed.isLocal()) localVideo.srcObject = stream;
      else remoteVideo.srcObject = stream;
    }
  }

  onMount(() => {
    const call = app.activeCall;
    if (!call) return;
    attachStreams();
    call.on(CallEvent.FeedsChanged, attachStreams);
  });

  onDestroy(() => {
    const call = app.activeCall;
    if (call) call.off(CallEvent.FeedsChanged, attachStreams);
  });

  const off = onInput((evt) => {
    if (evt === "back" || evt === "select") endCall();
  });
  onDestroy(off);
</script>

<div class="wrap">
  <video bind:this={remoteVideo} class="remote" autoplay playsinline></video>
  <video bind:this={localVideo} class="local" autoplay playsinline muted></video>

  <button class="hangup" onclick={endCall} aria-label="End call">
    <span class="dot"></span>
  </button>
</div>

<style>
  .wrap {
    height: 100%;
    width: 100%;
    position: relative;
    background: #000;
  }
  /* 1:1 square sized to the smaller viewport dimension. Filled with the
     remote stream via cover, so cropping stays gentle in either orientation. */
  .remote {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 100vmin;
    height: 100vmin;
    object-fit: cover;
  }
  .local {
    position: absolute;
    bottom: 1.5rem;
    right: 1.5rem;
    width: clamp(140px, 28vmin, 280px);
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 12px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    transform: scaleX(-1);
  }
  .hangup {
    position: absolute;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    width: 88px;
    height: 88px;
    border-radius: 50%;
    background: var(--danger);
    display: grid;
    place-items: center;
    box-shadow: 0 8px 24px rgba(255, 93, 108, 0.4);
  }
  .dot {
    width: 28px;
    height: 4px;
    background: #fff;
    border-radius: 2px;
  }
</style>
