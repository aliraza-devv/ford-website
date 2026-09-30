"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { scrollState } from "@/lib/scrollState";

/**
 * Installs Lenis as the page's scroll smoother and hands its clock to GSAP.
 *
 * Native wheel/trackpad scroll arrives in discrete, uneven jumps. Everything
 * downstream -- ScrollTrigger progress, the car's rotation, the camera path --
 * is a pure function of scroll position, so those jumps used to show up
 * directly as the car snapping between poses. Smoothing each consumer
 * individually (the old per-frame lerp in InteractionSystem) treats the
 * symptom; Lenis interpolates the scroll position itself, so every consumer
 * inherits one consistently-eased signal for free.
 *
 * Three details matter and are easy to get wrong:
 *
 * 1. Lenis is driven from `gsap.ticker`, not its own rAF loop. Two
 *    independent loops would tear -- ScrollTrigger would read a scroll
 *    position from a different instant than the one GSAP is tweening
 *    against, which reads as jitter at exactly the moment things are
 *    moving fastest.
 * 2. `lagSmoothing(0)` disables GSAP's frame-drop compensation. That feature
 *    fabricates a catch-up delta after a stutter, which would teleport the
 *    camera mid-flight.
 * 3. No `ScrollTrigger.scrollerProxy` is needed. That's only for a custom
 *    scroll container; Lenis here drives real window scroll, so ScrollTrigger
 *    reads `window.scrollY` as usual and just needs telling when it changed.
 */
export function useSmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      // Slightly longer than Lenis's 1.0 default: this page is one long
      // pinned camera move, and a touch more glide suits a 3D dolly better
      // than it would a text page, without reading as sluggish.
      duration: 1.1,
      // Exponential ease-out -- fast initial response to the wheel (so it
      // never feels laggy on the first tick) decaying to a soft landing.
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      // Touch devices already have native momentum scrolling; layering
      // Lenis on top fights the OS and feels worse, not better.
      syncTouch: false,
    });

    lenis.on("scroll", ScrollTrigger.update);

    // Dev-only handle: Lenis owns scroll position now, so `window.scrollTo`
    // is no longer a reliable way to drive the page from the console or an
    // automated check -- Lenis's own rAF would immediately pull it back to
    // its internal target. Exposing the instance makes scroll-dependent
    // verification (Section 3's camera framing in particular) deterministic.
    // Stripped from production builds via the NODE_ENV constant.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>).__lenis = lenis;
    }

    const raf = (time: number) => {
      lenis.raf(time * 1000); // gsap ticker is seconds, lenis wants ms
      // Written every tick, not from the scroll event: the event stops
      // firing once scrolling settles, which would leave the last non-zero
      // velocity stuck and the world racing forever.
      scrollState.velocity = lenis.velocity;
    };
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(raf);
      gsap.ticker.lagSmoothing(500, 33); // restore GSAP's defaults
      lenis.destroy();
    };
  }, []);
}
