/**
 * Material-style click ripples, installed once as a single delegated listener.
 *
 * Doing it this way means no component has to know about ripples — any element
 * matching RIPPLE_HOSTS gets one for free. The host needs `position: relative`
 * and `overflow: hidden`, which styles.css already applies to each selector.
 */

const RIPPLE_HOSTS =
  ".btn, .icon-btn, .session-card, .tool-card__header, .inspector__tab, .insp-row__head";

let installed = false;

function isDisabled(element: HTMLElement): boolean {
  return (
    (element as HTMLButtonElement).disabled === true ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function spawnRipple(event: PointerEvent): void {
  if (event.button !== 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const target = event.target as Element | null;
  // closest() naturally resolves nesting: a delete icon inside a session card
  // ripples the icon, not the whole card.
  const host = target?.closest<HTMLElement>(RIPPLE_HOSTS);
  if (!host || isDisabled(host)) return;

  const rect = host.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;

  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;

  host.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
}

export function installRipples(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("pointerdown", spawnRipple, { passive: true });
}
