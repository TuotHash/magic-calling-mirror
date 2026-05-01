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

function isTextEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return type !== "checkbox" && type !== "radio" && type !== "button";
  }
  return false;
}

/**
 * Up/Down arrows are safe to hijack inside single-line text inputs (they
 * don't move the caret), so dial users can step off an input. Multi-line
 * editors (textarea / contenteditable) need vertical arrows for line nav.
 */
function verticalArrowAllowed(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.tagName === "TEXTAREA") return false;
  if (target.isContentEditable) return false;
  return true;
}

/** Left/Right arrows always move the caret in a text editor — leave them. */
function horizontalArrowAllowed(target: EventTarget | null): boolean {
  return !isTextEditable(target);
}

/**
 * If the focused element will react to Enter natively (button click, form
 * submit, link follow), let the browser handle it. We only emit "select"
 * for screens that drive their own cursor with a non-focusable body.
 */
function nativeHandlesEnter(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "BUTTON" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return true;
  if (tag === "A" && (target as HTMLAnchorElement).hasAttribute("href")) return true;
  return target.isContentEditable;
}

export function installInputHandlers() {
  window.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowUp":
        if (!verticalArrowAllowed(e.target)) return;
        e.preventDefault();
        emit("prev");
        break;
      case "ArrowLeft":
        if (!horizontalArrowAllowed(e.target)) return;
        e.preventDefault();
        emit("prev");
        break;
      case "ArrowDown":
        if (!verticalArrowAllowed(e.target)) return;
        e.preventDefault();
        emit("next");
        break;
      case "ArrowRight":
        if (!horizontalArrowAllowed(e.target)) return;
        e.preventDefault();
        emit("next");
        break;
      case "Enter":
      case " ":
        if (nativeHandlesEnter(e.target)) return;
        e.preventDefault();
        emit("select");
        break;
      case "Escape":
        e.preventDefault();
        emit("back");
        break;
      case "Backspace":
        if (isTextEditable(e.target)) return;
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
