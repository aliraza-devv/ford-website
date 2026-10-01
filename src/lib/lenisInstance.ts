import type Lenis from "lenis";

/**
 * The page's one Lenis instance, so anything that needs to move the scroll (the plates
 * in the plant map and the road finder jump to a place in their section) goes through
 * the same smoother that eases every other scroll, instead of fighting it.
 */
let instance: Lenis | null = null;

export function setLenis(lenis: Lenis | null) {
  instance = lenis;
}

export function getLenis(): Lenis | null {
  return instance;
}

/** Glide to an absolute scroll position, in px. Falls back to the browser's own
 * scrolling if Lenis is not up (or the visitor asked for less motion). */
export function scrollToY(y: number, duration = 1.6) {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (instance) {
    instance.scrollTo(y, { duration: reduced ? 0 : duration, easing: (t: number) => 1 - Math.pow(1 - t, 4) });
  } else if (typeof window !== "undefined") {
    window.scrollTo({ top: y, behavior: reduced ? "auto" : "smooth" });
  }
}
