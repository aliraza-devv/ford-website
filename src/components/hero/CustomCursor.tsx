"use client";

import { useEffect, useRef } from "react";

const LERP = 0.2; // ~5-frame time constant at 60fps -- tight but never twitchy

/**
 * Ford Grabber ring that replaces the native cursor on desktop. Scales up
 * on any element carrying `data-cursor-hover` (nav links, CTAs). Skipped
 * entirely on touch devices -- there's no hover state to represent.
 *
 * Uses a plain rAF + exponential-lerp loop rather than gsap.quickTo --
 * two different quickTo duration/ease combinations both read as jerky/
 * unpredictable in practice (one felt laggy, the other too snappy and
 * hard). A frame-locked lerp is the same smoothing technique already used
 * for camera parallax elsewhere in this app, and it's predictable by
 * construction: no ease curve to fight, just "closes 20% of the remaining
 * distance every frame."
 */
export function CustomCursor() {
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    document.body.classList.add("custom-cursor-active");
    ring.style.opacity = "1";

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const current = { ...target };

    function onPointerMove(event: PointerEvent) {
      target.x = event.clientX;
      target.y = event.clientY;
    }

    function onPointerOver(event: PointerEvent) {
      const isHoverTarget = (event.target as HTMLElement | null)?.closest(
        "[data-cursor-hover]",
      );
      ring?.classList.toggle("is-hovering", Boolean(isHoverTarget));
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerover", onPointerOver, { passive: true });

    let rafId = requestAnimationFrame(function tick() {
      current.x += (target.x - current.x) * LERP;
      current.y += (target.y - current.y) * LERP;
      if (ring) {
        ring.style.transform = `translate3d(${current.x}px, ${current.y}px, 0) translate(-50%, -50%)`;
      }
      rafId = requestAnimationFrame(tick);
    });

    return () => {
      document.body.classList.remove("custom-cursor-active");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerover", onPointerOver);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={ringRef}
      className="pointer-events-none fixed left-0 top-0 z-[60] h-8 w-8 rounded-full border border-ford-grabber opacity-0 mix-blend-difference transition-[width,height,background-color] duration-300 ease-out [&.is-hovering]:h-14 [&.is-hovering]:w-14 [&.is-hovering]:bg-ford-grabber"
    />
  );
}
