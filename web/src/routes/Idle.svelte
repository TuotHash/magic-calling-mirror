<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { app } from "../lib/store.svelte";
  import { onInput } from "../lib/input";

  let now = $state(new Date());
  let timer: number;

  onMount(() => {
    timer = window.setInterval(() => (now = new Date()), 30_000);
  });
  onDestroy(() => clearInterval(timer));

  const off = onInput((evt) => {
    if (evt === "select" || evt === "next" || evt === "prev") {
      app.setView("wheel");
    }
  });
  onDestroy(off);

  // Hidden configurator shortcut: press 'S' from the idle screen to
  // re-open the contact picker. Not advertised in the UI so end users
  // won't bump into it accidentally.
  function handleSettingsKey(e: KeyboardEvent) {
    if (e.key === "s" || e.key === "S") app.setView("settings");
  }
  onMount(() => window.addEventListener("keydown", handleSettingsKey));
  onDestroy(() => window.removeEventListener("keydown", handleSettingsKey));

  const time = $derived(
    now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: !app.config.clock24h,
    }),
  );
  const date = $derived(
    now.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
  );
</script>

<div class="wrap">
  <div class="time">{time}</div>
  <div class="date">{date}</div>
  <div class="hint">Turn the dial to call someone</div>
</div>

<style>
  .wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }
  .time {
    font-size: clamp(6rem, 22vmin, 14rem);
    font-weight: 100;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .date {
    font-size: clamp(1.25rem, 3.5vmin, 2rem);
    color: var(--muted);
    font-weight: 300;
  }
  .hint {
    margin-top: 3rem;
    color: var(--muted);
    font-size: 1rem;
    opacity: 0.5;
  }
</style>
