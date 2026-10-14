import type { PointerEvent } from "react";

const reduced = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Material-style click ripple. Injects a span at the pointer position, lets
 * the CSS animation scale and fade it, then removes it on `animationend`.
 *
 * The host element needs `.ripple-host` (position + overflow: hidden), which
 * is what clips the circle to the button's own rounded shape.
 */
export function ripple(e: PointerEvent<HTMLElement>) {
  if (reduced()) return;

  const host = e.currentTarget;
  const box = host.getBoundingClientRect();
  /* Diameter = the box's longest side, so the circle always covers the
     whole button no matter where it was clicked. */
  const size = Math.max(box.width, box.height);

  const span = document.createElement("span");
  span.className = "ripple";
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.style.left = `${e.clientX - box.left - size / 2}px`;
  span.style.top = `${e.clientY - box.top - size / 2}px`;

  host.appendChild(span);
  span.addEventListener("animationend", () => span.remove(), { once: true });
}
