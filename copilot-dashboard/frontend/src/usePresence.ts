import { useEffect, useState } from "react";

export type PresenceState = "entering" | "exiting";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Keeps a component mounted for `duration` ms after `visible` goes false, so a CSS
 * exit animation has time to play.
 *
 * React unmounts children in the same commit that removes them, which means an
 * element styled only with an enter animation simply vanishes on close. Holding the
 * node around for one animation length — and tagging it `exiting` while we do — is
 * the smallest way to get a symmetric open/close feel without a animation library.
 */
export function usePresence(visible: boolean, duration = 260) {
  const [mounted, setMounted] = useState(visible);
  const [state, setState] = useState<PresenceState>(visible ? "entering" : "exiting");

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setState("entering");
      return;
    }

    setState("exiting");
    // Users who asked for reduced motion get no exit animation, so there is nothing
    // to wait for — tearing down immediately keeps the UI feeling responsive.
    const hold = window.matchMedia?.(REDUCED_MOTION).matches ? 0 : duration;
    const timer = window.setTimeout(() => setMounted(false), hold);
    return () => window.clearTimeout(timer);
  }, [visible, duration]);

  return { mounted, state, className: state === "exiting" ? "is-exiting" : "is-entering" };
}
