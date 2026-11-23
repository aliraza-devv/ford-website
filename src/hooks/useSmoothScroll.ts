"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { scrollState } from "@/lib/scrollState";
import { setLenis } from "@/lib/lenisInstance";
import { FACTORY_FOLLOW } from "@/config/line";

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
      // Longer than Lenis's 1.0 default: this page is one long pinned camera
      // move, and more glide suits a 3D dolly better than it would a text page.
      // 1.1 still let a hard flick fling the camera; 1.3 and a wheel that moves
      // a little less per notch gives the same flick a softer start and a longer
      // landing, without making a single notch feel slow to answer.
      duration: 1.3,
      wheelMultiplier: 0.85,
      // Exponential ease-out -- fast initial response to the wheel (so it
      // never feels laggy on the first tick) decaying to a soft landing.
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      // Touch devices already have native momentum scrolling; layering
      // Lenis on top fights the OS and feels worse, not better.
      syncTouch: false,
    });

    lenis.on("scroll", ScrollTrigger.update);
    setLenis(lenis);

    // Dev-only handle: Lenis owns scroll position now, so `window.scrollTo`
    // is no longer a reliable way to drive the page from the console or an
    // automated check -- Lenis's own rAF would immediately pull it back to
    // its internal target. Exposing the instance makes scroll-dependent
    // verification (Section 3's camera framing in particular) deterministic.
    // Stripped from production builds via the NODE_ENV constant.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>).__lenis = lenis;
    }

    // The film follows the scroll with inertia (critically damped, with a top speed). Written
    // here, from the same clock as Lenis, so every reader of `scrollState.factory` (the 3D
    // plant, the camera, the words) sees the one smoothed value on the same frame.
    let filmVelocity = 0;
    let lastTime = 0;
    const followFilm = (time: number) => {
      const dt = Math.min(Math.max(time - lastTime, 0), 0.1);
      lastTime = time;
      if (dt === 0) return;
      const target = scrollState.factoryTarget;
      const current = scrollState.factory;
      if (current === target) {
        filmVelocity = 0;
        return;
      }
      const { smoothTime, maxSpeed } = FACTORY_FOLLOW;
      const omega = 2 / smoothTime;
      const x = omega * dt;
      const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const maxChange = maxSpeed * smoothTime;
      const change = Math.max(-maxChange, Math.min(maxChange, current - target));
      const temp = (filmVelocity + omega * change) * dt;
      filmVelocity = (filmVelocity - omega * temp) * decay;
      let next = current - change + (change + temp) * decay;
      // Never overshoot, and land exactly: the plant switches off at 0 and the tunnel at 1.
      if (target - current > 0 === next > target || Math.abs(target - next) < 1e-5) {
        next = target;
        filmVelocity = 0;
      }
      scrollState.factory = next;
    };

    const raf = (time: number) => {
      lenis.raf(time * 1000); // gsap ticker is seconds, lenis wants ms
      followFilm(time);
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
      setLenis(null);
      lenis.destroy();
    };
  }, []);
}
