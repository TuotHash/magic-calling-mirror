/**
 * A small Web Audio chime that loops while the ringing splash is shown.
 * No audio file = no licensing, no asset pipeline, smaller bundle.
 */

let ctx: AudioContext | null = null;
let timer: number | null = null;

export function startRingtone(): void {
  if (timer !== null) return;
  ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();

  const playChime = () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    // Two-note pleasant alert: G5 → C6, soft attack, gentle release.
    chime(ctx, now, 784);
    chime(ctx, now + 0.35, 1047);
  };

  playChime();
  timer = window.setInterval(playChime, 1500);
}

export function stopRingtone(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function chime(ctx: AudioContext, when: number, freq: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.18, when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.6);

  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.65);
}
