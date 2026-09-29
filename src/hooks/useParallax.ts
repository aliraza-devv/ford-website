"use client";

import { useEffect, useRef } from "react";
import { usePointerState } from "./usePointerState";

export type ParallaxState = {
  /** Smoothed -1..1, shared by every layer -- only the per-layer strength differs. */
  x: number;
  y: number;
  /** Blends 0->1 after ~2.5s of no pointer movement. */
  idleBlend: number;
};

const LERP = 0.05;
const IDLE_LERP = 0.02;

/**
 * One smoothed pointer signal for the whole hero, so every depth layer
 * (Sky, Road, headline, car, UI chrome) is reading the same underlying
 * value and just scaling it by its own Step 4 strength -- that's what
 * makes five independently-rendered layers read as one system instead of
 * four different things each doing their own thing.
 *
 * Also writes CSS custom properties on <html> (--parallax-x/--parallax-y,
 * range roughly -20..20px, and --idle-blend 0..1) so plain DOM layers can
 * react with a single `transform: translate3d(calc(var(--parallax-x) *
 * var(--layer-strength)), ...)` rule and never touch JS. WebGL layers
 * (Road, the car canvas) read the returned ref directly in their own
 * useFrame instead.
 */
export function useParallax() {
  const pointerStateRef = usePointerState();
  const parallaxRef = useRef<ParallaxState>({ x: 0, y: 0, idleBlend: 0 });

  useEffect(() => {
    let rafId = 0;

    function tick() {
      const pointer = pointerStateRef.current;
      const state = parallaxRef.current;

      state.x += (pointer.x - state.x) * LERP;
      state.y += (pointer.y - state.y) * LERP;
      const targetIdle = pointer.idle ? 1 : 0;
      state.idleBlend += (targetIdle - state.idleBlend) * IDLE_LERP;

      const root = document.documentElement.style;
      root.setProperty("--parallax-x", `${(state.x * 20).toFixed(3)}px`);
      root.setProperty("--parallax-y", `${(state.y * 12).toFixed(3)}px`);
      root.setProperty("--idle-blend", state.idleBlend.toFixed(3));

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [pointerStateRef]);

  return parallaxRef;
}
