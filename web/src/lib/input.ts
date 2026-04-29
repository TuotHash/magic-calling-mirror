/**
 * Global keyboard input contract. Any USB-HID rotary encoder / dial /
 * remote control that emits arrow keys + Enter will work.
 *
 * Mapping:
 *   ArrowUp / ArrowLeft / wheel up    → "prev"
 *   ArrowDown / ArrowRight / wheel down → "next"
 *   Enter / Space                     → "select"
 *   Escape / Backspace                → "back"
 */

export type InputEvent = "prev" | "next" | "select" | "back";

type Handler = (event: InputEvent) => void;

const handlers = new Set<Handler>();

export function onInput(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

function emit(event: InputEvent) {
  for (const h of handlers) h(event);
}

export function installInputHandlers() {
  window.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        emit("prev");
        break;
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        emit("next");
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        emit("select");
        break;
      case "Escape":
      case "Backspace":
        e.preventDefault();
        emit("back");
        break;
    }
  });

  window.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY < 0) emit("prev");
      else if (e.deltaY > 0) emit("next");
    },
    { passive: true },
  );
}
