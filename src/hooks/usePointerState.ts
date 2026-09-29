"use client";

import { useEffect, useRef } from "react";

export type PointerState = {
  /** Normalized -1..1, rAF-throttled. */
  x: number;
  y: number;
  /** True once the pointer has been still for ~2s. */
  idle: boolean;
};

/**
 * Tracks pointer position in a ref (not React state) so the R3F render
 * loop can read it every frame without triggering component re-renders.
 * The mousemove listener itself is rAF-throttled to one sample per frame.
 */
export function usePointerState() {
  const stateRef = useRef<PointerState>({ x: 0, y: 0, idle: true });

  useEffect(() => {
    let rafId = 0;
    let idleTimeoutId = 0;
    let queued = false;
    let latestX = 0;
    let latestY = 0;

    function commit() {
      stateRef.current.x = latestX;
      stateRef.current.y = latestY;
      stateRef.current.idle = false;
      queued = false;
    }

    function onPointerMove(event: PointerEvent) {
      latestX = (event.clientX / window.innerWidth) * 2 - 1;
      latestY = (event.clientY / window.innerHeight) * 2 - 1;
      if (!queued) {
        queued = true;
        rafId = requestAnimationFrame(commit);
      }
      window.clearTimeout(idleTimeoutId);
      idleTimeoutId = window.setTimeout(() => {
        stateRef.current.idle = true;
      }, 2500);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(rafId);
      window.clearTimeout(idleTimeoutId);
    };
  }, []);

  return stateRef;
}
