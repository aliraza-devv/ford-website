"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import type * as THREE from "three";
import { useParallax } from "@/hooks/useParallax";
import { LAYOUT } from "@/config/composition";
import { Loader } from "./Loader";
import { Sky } from "./Sky";
import { Road } from "./Road";
import { Hero } from "./Hero";
import { Section2 } from "./Section2";
import { CustomCursor } from "./CustomCursor";
import type { MustangModelHandle } from "./MustangModel";

gsap.registerPlugin(ScrollTrigger, SplitText);

// The Canvas/R3F tree only ever makes sense client-side.
const Scene = dynamic(() => import("./Scene").then((m) => m.Scene), { ssr: false });

/**
 * Owns the pinned 3D stage shared by the hero and section 2, and the
 * scroll transition between them. The car's canvas lives here (not inside
 * Hero.tsx) specifically so it can persist, unbroken, as the user scrolls
 * from the hero's front-on shot into section 2's closer side profile --
 * that persistence is the whole point of hoisting it up a level.
 *
 * Pinning itself is CSS `position: sticky` on `stageRef` (simpler and more
 * robust than GSAP ScrollTrigger's `pin` option -- no spacer-element
 * bookkeeping, works naturally with `100dvh`), inside a `wrapperRef` tall
 * enough to give that sticky element room to stay put while the user
 * scrolls through both sections' worth of content. GSAP/ScrollTrigger is
 * only used to read scroll progress (fed into the 3D InteractionSystem)
 * and to cross-fade the hero/section2 DOM content over the same range.
 */
export function HeroExperience() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const carGroupRef = useRef<THREE.Group>(null);
  const rimLightRef = useRef<THREE.PointLight>(null);
  const paintControllerRef = useRef<MustangModelHandle>(null);
  const parallaxRef = useParallax();
  const scrollProgressRef = useRef(0);
  const [loaded, setLoaded] = useState(false);

  const handleLoaded = useCallback(() => setLoaded(true), []);

  // FIX 0 (carried over): every DOM layer reads its position from this
  // one grid -- logged once so it's easy to confirm it's actually wired
  // through and not just decorative.
  useEffect(() => {
    console.log("[Composition] LAYOUT grid in use:", LAYOUT);
  }, []);

  // The hero's own load-in choreography (car scale, rim light, headline
  // stagger). Lives here now, not Hero.tsx, since this is where the Scene
  // refs actually are.
  useGSAP(
    () => {
      if (!loaded || !stageRef.current) return;

      const headline = stageRef.current.querySelector<HTMLElement>(".hero-headline");
      const split = headline ? new SplitText(headline, { type: "chars" }) : null;

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      tl.fromTo(".hero-road", { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0);

      if (carGroupRef.current) {
        tl.from(
          carGroupRef.current.scale,
          { x: 0.94, y: 0.94, z: 0.94, duration: 1.2, ease: "power3.out" },
          0.15,
        );
      }

      if (rimLightRef.current) {
        tl.to(rimLightRef.current, { intensity: 2.4, duration: 0.8, ease: "power2.out" }, 0.45);
      }

      if (split?.chars.length) {
        tl.from(
          split.chars,
          { yPercent: 130, opacity: 0, duration: 0.6, stagger: 0.025, ease: "power3.out" },
          0.6,
        );
      }

      tl.from(".hero-navbar", { opacity: 0, y: -10, duration: 0.5 }, 1.6).from(
        ".hero-scrollcue",
        { opacity: 0, duration: 0.5 },
        1.7,
      );

      return () => split?.revert();
    },
    { scope: stageRef, dependencies: [loaded] },
  );

  // Section 2 scroll transition. Only reads progress and cross-fades DOM
  // content -- the actual car turn/dolly/shift lives in InteractionSystem,
  // driven by the same scrollProgressRef.
  useGSAP(
    () => {
      if (!wrapperRef.current) return;

      gsap.timeline({
        scrollTrigger: {
          trigger: wrapperRef.current,
          start: "top top",
          end: "bottom bottom",
          // A SMALL numeric scrub -- enough catch-up easing to smooth out
          // raw mechanical jumps from discrete mouse-wheel deltas, but
          // nowhere near enough to read as delayed/laggy. 0.6 (tried
          // first) was audibly "late and slow"; scrub duration IS the lag,
          // so the fix for "smooth AND instant" is a small value, not a
          // big one.
          scrub: 0.15,
          onUpdate: (self) => {
            scrollProgressRef.current = self.progress;
          },
        },
      })
        .to(
          ".hero-fade-content",
          {
            opacity: 0,
            y: -30,
            pointerEvents: "none",
            duration: 0.35,
            ease: "power1.in",
            // PaintSelector/StatsPanel each run their OWN entrance tween
            // (a separate gsap.from(...opacity...) on mount) that also
            // touches opacity on these same elements -- without a forced
            // overwrite, that tween's resting value (opacity: 1) can win
            // the race against this one instead of this one staying in
            // control as the user scrolls.
            overwrite: "auto",
          },
          0.08,
        )
        .fromTo(
          ".section2-fade-content",
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.35, ease: "power1.out" },
          0.55,
        );
    },
    { scope: wrapperRef, dependencies: [loaded] },
  );

  return (
    <div ref={wrapperRef} className="relative h-[220vh] w-full bg-black">
      <div ref={stageRef} className="sticky top-0 h-dvh w-full overflow-hidden">
        <Sky />
        <Road />

        {/* Layer 4: the car, its own transparent canvas, persists across
            both sections' scroll range (see the module doc above). */}
        <div className="absolute inset-0 z-20">
          <Scene
            carGroupRef={carGroupRef}
            paintControllerRef={paintControllerRef}
            rimLightRef={rimLightRef}
            parallaxRef={parallaxRef}
            scrollProgressRef={scrollProgressRef}
          />
        </div>

        <Hero loaded={loaded} paintControllerRef={paintControllerRef} />

        <div className="section2-fade-content pointer-events-none absolute inset-0 z-10 opacity-0">
          <Section2 />
        </div>

        <Loader onComplete={handleLoaded} />
        <CustomCursor />
      </div>
    </div>
  );
}
