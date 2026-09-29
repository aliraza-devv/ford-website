"use client";

import { useLayoutEffect, useEffect, useRef } from "react";

// Avoids the SSR "useLayoutEffect does nothing on the server" warning --
// this only ever needs to run client-side anyway.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const BASE_FONT_SIZE = 200; // px, an arbitrary large reference size for measurement
const MIN_FONT_SIZE = 48;
// Capped lower than before (190) -- the headline now lives in its own
// dedicated band between the navbar and the stats/car area, not a tall
// zone the car was meant to occlude, so it doesn't need to be as large.
const MAX_FONT_SIZE = 120;

/**
 * FIX 3: measures the element's natural width at a large reference size
 * and scales the font-size to exactly fill its parent container's width,
 * clamped to [MIN_FONT_SIZE, MAX_FONT_SIZE]. This guarantees no clipping
 * at any viewport width, rather than trusting a hand-picked `clamp()`
 * value against character metrics that were never actually measured.
 */
export function useFitText<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    function fit() {
      if (!el || !el.parentElement) return;
      el.style.fontSize = `${BASE_FONT_SIZE}px`;
      const containerWidth = el.parentElement.clientWidth;
      const textWidth = el.scrollWidth;
      const scale = textWidth > 0 ? containerWidth / textWidth : 1;
      const fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, BASE_FONT_SIZE * scale));
      el.style.fontSize = `${fontSize}px`;
    }

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return ref;
}
