import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { app } from "./store.svelte";
import { startAgentPresence, stopAgentPresence } from "./agentPresence";

/**
 * Presence detection facade. Picks the source based on config:
 *  - if `presenceAgentUrl` is set, the optional Pi Agent (PIR sensor
 *    over WebSocket) drives `app.presenceActive`;
 *  - otherwise MediaPipe's lightweight face detector runs on the
 *    webcam at ~2 Hz.
 *
 * The two sources never run simultaneously — picking one at startup
 * keeps the Pi cool.
 *
 * When `presenceEnabled` is false, the screen stays lit — no detector
 * runs and `presenceActive` is pinned true. The agent socket is still
 * opened (when configured) so `sendAgentCommand` can wake the TV.
 */

const DETECT_INTERVAL_MS = 500;

let detector: FaceDetector | null = null;
let video: HTMLVideoElement | null = null;
let stream: MediaStream | null = null;
let timer: number | null = null;
let lastFaceAt = 0;

export async function startPresence(): Promise<void> {
  const agentUrl = app.config.presenceAgentUrl?.trim();
  // Always open the agent socket when configured — we need it for
  // `sendAgentCommand("wake")` even if presence dimming is off.
  if (agentUrl) startAgentPresence(agentUrl);

  if (!app.config.presenceEnabled) {
    app.presenceActive = true;
    return;
  }

  // Presence enabled: agent (when present) already drives presenceActive
  // via its inbound stream. Otherwise fall back to the webcam detector.
  if (!agentUrl) await startCameraPresence();
}

export function stopPresence(): void {
  stopCameraPresence();
  stopAgentPresence();
}

async function startCameraPresence(): Promise<void> {
  if (detector) return;

  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 320, height: 240, facingMode: "user" },
    audio: false,
  });

  video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
  );
  detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    },
    runningMode: "VIDEO",
  });

  lastFaceAt = performance.now();
  timer = window.setInterval(detectStep, DETECT_INTERVAL_MS);
}

function detectStep() {
  if (!detector || !video) return;
  const now = performance.now();
  const result = detector.detectForVideo(video, now);
  const seen = result.detections.length > 0;

  if (seen) {
    lastFaceAt = now;
    if (!app.presenceActive) app.presenceActive = true;
  } else {
    const dimAfterMs = app.config.dimAfterSeconds * 1000;
    if (app.presenceActive && now - lastFaceAt > dimAfterMs) {
      app.presenceActive = false;
    }
  }
}

function stopCameraPresence() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  detector?.close();
  detector = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video = null;
}
