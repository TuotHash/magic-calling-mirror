import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { app } from "./store.svelte";

/**
 * Webcam-based presence detection using MediaPipe's lightweight face detector.
 * Runs at ~2 Hz to keep the Pi cool. Updates `app.presenceActive` so the UI
 * can dim/wake based on whether someone is in front of the mirror.
 */

const DETECT_INTERVAL_MS = 500;

let detector: FaceDetector | null = null;
let video: HTMLVideoElement | null = null;
let stream: MediaStream | null = null;
let timer: number | null = null;
let lastFaceAt = 0;

export async function startPresence(): Promise<void> {
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

export function stopPresence() {
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
