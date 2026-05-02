<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { app } from "../lib/store.svelte";
  import {
    fetchAvatarBlobUrl,
    listCandidateRooms,
    listDmCandidates,
    logout,
    recomputeWhitelist,
    type CandidateContact,
    type CandidateRoom,
  } from "../lib/matrix";
  import { onInput } from "../lib/input";

  let rooms = $state<CandidateRoom[]>([]);
  let candidates = $state<CandidateContact[]>([]);
  let avatarUrls = $state<Record<string, string>>({});
  let selectedRoomId = $state<string | null>(app.config.whitelistRoomId);
  let selectedManual = $state<Set<string>>(
    new Set(app.config.manualContacts.map((c) => c.userId)),
  );
  let cursor = $state(0);
  let confirmLogout = $state(false);
  // While non-null, prev/next adjusts the focused segment instead of moving
  // the cursor — lets keyboard-only users edit quiet-hour times. Native
  // <input type="time"> needs caret/typing or per-segment Tab focus that the
  // arrow-only rotary contract can't drive.
  let editingTime = $state<{
    field: "from" | "until";
    segment: "h" | "m";
  } | null>(null);

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
    if (!app.config.quietHoursEnabled) editingTime = null;
    app.persist();
  }

  function timeParts(s: string): [string, string] {
    const [h = "00", m = "00"] = s.split(":");
    return [h.padStart(2, "0"), m.padStart(2, "0")];
  }

  function adjustTime(
    field: "from" | "until",
    segment: "h" | "m",
    delta: number,
  ) {
    const key = field === "from" ? "quietFrom" : "quietUntil";
    const [hStr, mStr] = timeParts(app.config[key]);
    let h = parseInt(hStr, 10);
    let m = parseInt(mStr, 10);
    if (segment === "h") h = (h + delta + 24) % 24;
    else m = (m + delta + 60) % 60;
    app.config[key] =
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
    rooms = listCandidateRooms(client);

    // Manual candidates = current DM peers, plus any already-selected manual
    // contacts who aren't current DM peers (so the user can still deselect
    // them). Sorted by display name across the union.
    const dms = listDmCandidates(client);
    const dmIds = new Set(dms.map((c) => c.userId));
    const orphaned: CandidateContact[] = app.config.manualContacts
      .filter((c) => !dmIds.has(c.userId))
      .map((c) => ({
        userId: c.userId,
        displayName: c.displayName,
        avatarMxc: c.avatarMxc,
      }));
    candidates = [...dms, ...orphaned].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );

    // Place cursor on the currently-selected room, else first selected manual
    // contact, else top.
    const roomIdx = rooms.findIndex((r) => r.roomId === selectedRoomId);
    if (roomIdx >= 0) cursor = roomIdx;
    else {
      const manualIdx = candidates.findIndex((c) => selectedManual.has(c.userId));
      if (manualIdx >= 0) cursor = rooms.length + manualIdx;
    }

    // Avatars: rooms keyed by roomId, contacts keyed by userId — disjoint
    // because the userId form is `@x:host` and roomId is `!x:host`.
    for (const r of rooms) {
      if (!r.avatarMxc) continue;
      fetchAvatarBlobUrl(client, r.avatarMxc, 128).then((url) => {
        if (url) avatarUrls = { ...avatarUrls, [r.roomId]: url };
      });
    }
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

  function toggleRoomAt(i: number) {
    const r = rooms[i];
    if (!r) return;
    // Click-to-toggle: clicking the selected room clears the selection so
    // the user can run with manual contacts only (no shared room).
    selectedRoomId = selectedRoomId === r.roomId ? null : r.roomId;
  }

  function toggleManualAt(i: number) {
    const c = candidates[i];
    if (!c) return;
    const next = new Set(selectedManual);
    if (next.has(c.userId)) next.delete(c.userId);
    else next.add(c.userId);
    selectedManual = next;
  }

  function save() {
    app.config.whitelistRoomId = selectedRoomId;
    app.config.manualContacts = candidates
      .filter((c) => selectedManual.has(c.userId))
      .map((c) => ({
        userId: c.userId,
        displayName: c.displayName,
        avatarMxc: c.avatarMxc,
      }));
    app.persist();
    if (app.client) recomputeWhitelist(app.client);
    app.setView("idle");
  }

  const selectedRoom = $derived(
    rooms.find((r) => r.roomId === selectedRoomId) ?? null,
  );

  const SAVE_POS = $derived(rooms.length + candidates.length);
  const VERIFY_POS = $derived(SAVE_POS + 1);
  const AUTO_ANSWER_POS = $derived(VERIFY_POS + 1);
  const PRESENCE_POS = $derived(AUTO_ANSWER_POS + 1);
  const QUIET_POS = $derived(PRESENCE_POS + 1);
  // Time-field stops only exist while quiet hours is enabled. -1 keeps the
  // === comparisons in the input switch from ever matching when hidden.
  const FROM_POS = $derived(
    app.config.quietHoursEnabled ? QUIET_POS + 1 : -1,
  );
  const UNTIL_POS = $derived(
    app.config.quietHoursEnabled ? QUIET_POS + 2 : -1,
  );
  const CLOCK_POS = $derived(
    QUIET_POS + (app.config.quietHoursEnabled ? 3 : 1),
  );
  const LOGOUT_POS = $derived(CLOCK_POS + 1);

  const off = onInput((evt) => {
    // Time-edit mode: prev/next adjusts the focused segment, select advances
    // hour → minute → exit, back exits without further changes.
    if (editingTime) {
      switch (evt) {
        case "prev":
          adjustTime(editingTime.field, editingTime.segment, -1);
          break;
        case "next":
          adjustTime(editingTime.field, editingTime.segment, +1);
          break;
        case "select":
          editingTime =
            editingTime.segment === "h"
              ? { field: editingTime.field, segment: "m" }
              : null;
          break;
        case "back":
          editingTime = null;
          break;
      }
      return;
    }

    // Reset the "are you sure?" prompt as soon as the user moves off it.
    if (evt !== "select") confirmLogout = false;

    if (rooms.length === 0 && candidates.length === 0) {
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
        else if (cursor === FROM_POS)
          editingTime = { field: "from", segment: "h" };
        else if (cursor === UNTIL_POS)
          editingTime = { field: "until", segment: "h" };
        else if (cursor === CLOCK_POS) toggleClock();
        else if (cursor === LOGOUT_POS) doLogout();
        else if (cursor < rooms.length) toggleRoomAt(cursor);
        else toggleManualAt(cursor - rooms.length);
        break;
      case "back":
        app.setView("idle");
        break;
    }
  });
  onDestroy(off);
</script>

<div class="wrap">
  <h2>Trusted callers</h2>
  <p class="hint">
    Anyone in the contacts room <em>or</em> on the private list can ring through.
  </p>

  {#if rooms.length === 0 && candidates.length === 0}
    <p class="empty">
      No rooms or DM contacts found. From another Matrix client (e.g. Element
      on your phone), create a contacts room <em>or</em> start a 1:1 chat with
      someone you want to be able to call, then come back here.
    </p>
    <button onclick={() => app.setView("idle")}>Back</button>
  {:else}
    <h3>Contacts room</h3>
    <p class="sub-hint">
      Joined members can call. Invite or kick from any Matrix client.
    </p>
    {#if rooms.length === 0}
      <p class="empty-section">No rooms with other members yet.</p>
    {:else}
      <ul>
        {#each rooms as r, i}
          <li
            class:active={i === cursor}
            class:on={r.roomId === selectedRoomId}
            onclick={() => toggleRoomAt(i)}
            role="button"
            tabindex="-1"
          >
            {#if avatarUrls[r.roomId]}
              <img src={avatarUrls[r.roomId]} alt="" />
            {:else}
              <div class="placeholder">{r.name.charAt(0).toUpperCase()}</div>
            {/if}
            <div class="meta">
              <div class="name">{r.name}</div>
              <div class="id">{r.others} {r.others === 1 ? "member" : "members"}</div>
            </div>
            <div class="check" aria-hidden="true">
              {r.roomId === selectedRoomId ? "●" : "○"}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <h3>Private contacts</h3>
    <p class="sub-hint">
      For callers who shouldn't appear in the room's member list.
    </p>
    {#if candidates.length === 0}
      <p class="empty-section">
        No DM peers. Start a 1:1 chat from another Matrix client to add one.
      </p>
    {:else}
      <ul>
        {#each candidates as c, i}
          {@const pos = rooms.length + i}
          <li
            class:active={pos === cursor}
            class:on={selectedManual.has(c.userId)}
            onclick={() => toggleManualAt(i)}
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
              {selectedManual.has(c.userId) ? "✓" : ""}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <button class="save" class:active={cursor === SAVE_POS} onclick={save}>
      {#if selectedRoom && selectedManual.size > 0}
        Save · {selectedRoom.others} in room + {selectedManual.size} private
      {:else if selectedRoom}
        Save · {selectedRoom.others} in room
      {:else if selectedManual.size > 0}
        Save · {selectedManual.size} private
      {:else}
        Save · none selected
      {/if}
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
      {@const fromParts = timeParts(app.config.quietFrom)}
      {@const untilParts = timeParts(app.config.quietUntil)}
      <div class="time-row">
        <button
          type="button"
          class="time-field"
          class:active={cursor === FROM_POS}
          class:editing={editingTime?.field === "from"}
          onclick={() => (editingTime = { field: "from", segment: "h" })}
        >
          <span class="time-label">From</span>
          <span
            class="seg"
            class:focus={editingTime?.field === "from" &&
              editingTime.segment === "h"}>{fromParts[0]}</span
          ><span class="colon">:</span><span
            class="seg"
            class:focus={editingTime?.field === "from" &&
              editingTime.segment === "m"}>{fromParts[1]}</span
          >
        </button>
        <button
          type="button"
          class="time-field"
          class:active={cursor === UNTIL_POS}
          class:editing={editingTime?.field === "until"}
          onclick={() => (editingTime = { field: "until", segment: "h" })}
        >
          <span class="time-label">Until</span>
          <span
            class="seg"
            class:focus={editingTime?.field === "until" &&
              editingTime.segment === "h"}>{untilParts[0]}</span
          ><span class="colon">:</span><span
            class="seg"
            class:focus={editingTime?.field === "until" &&
              editingTime.segment === "m"}>{untilParts[1]}</span
          >
        </button>
      </div>
      {#if editingTime}
        <p class="edit-hint">
          Turn the dial to change · press to advance · back to finish
        </p>
      {/if}
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
  h3 {
    font-weight: 300;
    font-size: 1.15rem;
    margin: 1.25rem 0 0;
    align-self: flex-start;
    width: min(640px, 100%);
    color: var(--muted);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .hint { color: var(--muted); margin-bottom: 1rem; }
  .sub-hint {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0 0 0.25rem;
    width: min(640px, 100%);
    align-self: flex-start;
  }
  .empty-section {
    color: var(--muted);
    font-size: 0.9rem;
    width: min(640px, 100%);
    align-self: flex-start;
    margin: 0;
    padding: 0.5rem 0;
  }

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
    font-size: 0.95rem;
  }
  .time-field {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.9rem;
    background: rgba(255, 255, 255, 0.06);
    border: 2px solid transparent;
    border-radius: 8px;
    color: var(--fg);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
  .time-field.active { border-color: var(--accent); }
  .time-field.editing {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px rgba(93, 208, 255, 0.25);
  }
  .time-label { color: var(--muted); }
  .seg {
    display: inline-block;
    min-width: 1.6em;
    padding: 0.05rem 0.25rem;
    border-radius: 4px;
    text-align: center;
  }
  .seg.focus {
    background: var(--accent);
    color: #000;
  }
  .colon { padding: 0 0.05rem; }
  .edit-hint {
    margin-top: 0.25rem;
    color: var(--muted);
    font-size: 0.8rem;
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
