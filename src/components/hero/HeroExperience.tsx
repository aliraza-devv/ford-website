"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import type * as THREE from "three";
import { useParallax } from "@/hooks/useParallax";
import { useSmoothScroll } from "@/hooks/useSmoothScroll";
import { scrollState } from "@/lib/scrollState";
import { LAYOUT } from "@/config/composition";
import { HEADLINE_INTRO_SECONDS, type HeadlineIntro } from "@/lib/headlineIntro";
import { Loader } from "./Loader";
import { Hero } from "./Hero";
import { Section2 } from "./Section2";
import { FeatureScan } from "./FeatureScan";
import type { HotspotScreenMap } from "@/lib/hotspots";

gsap.registerPlugin(ScrollTrigger);

// The Canvas/R3F tree only ever makes sense client-side.
const Scene = dynamic(() => import("./Scene").then((m) => m.Scene), { ssr: false });

// Scroll distance (in viewport-heights) dedicated to each stage transition.
// STAGE_12_VH matches the original 220vh container's scrollable distance
// (220vh - the 100vh pinned viewport) exactly, so Section 2 is unaffected
// by Stage 3 being added after it. STAGE_23_VH is Stage 3's own new range.
// Wrapper height = 1 (pinned) + STAGE_12_VH + STAGE_23_VH.
const STAGE_12_VH = 1.2;
const STAGE_23_VH = 1.1;
// The interior feature scan: the camera holds still inside the cabin and a
// blade of light sweeps across it. About three scroll flicks, deliberately
// short -- see FeatureScan.
const FEATURES_VH = 1.2;
const WRAPPER_VH = 1 + STAGE_12_VH + STAGE_23_VH + FEATURES_VH;

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
  const parallaxRef = useParallax();
  // Per-hotspot projected screen position -- written once per frame inside
  // the Canvas (MustangModel), read by FeatureScan's own rAF loop.
  const hotspotScreenRef = useRef<HotspotScreenMap>({});
  // The headline is drawn inside the canvas now (see HeadlinePlane); its
  // per-letter load-in is this one number, tweened below and read there.
  const headlineIntroRef = useRef<HeadlineIntro>({ p: 0 });
  const [loaded, setLoaded] = useState(false);

  const handleLoaded = useCallback(() => setLoaded(true), []);

  // Lenis eases the scroll position itself, upstream of everything here --
  // see the hook for why that replaces the per-consumer smoothing this
  // component and InteractionSystem used to each do separately.
  useSmoothScroll();

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

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

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

      // Linear: the per-letter power3.out easing is applied inside
      // HeadlinePlane, per character, exactly as SplitText's stagger did.
      tl.to(headlineIntroRef.current, { p: 1, duration: HEADLINE_INTRO_SECONDS, ease: "none" }, 0.6);

      // The cue's CHILDREN, not the cue: the scroll fade (below) owns the
      // container's opacity, and two tweens on one element's opacity fight
      // over which start value to restore when you scroll back to the top.
      tl.from(".hero-navbar", { opacity: 0, y: -10, duration: 0.5 }, 1.6).from(
        ".hero-scrollcue > *",
        { opacity: 0, duration: 0.5 },
        1.7,
      );
    },
    { scope: stageRef, dependencies: [loaded] },
  );

  // Scroll drives two separate things, kept apart on purpose:
  //
  //  1. scrollState (two plain ScrollTriggers, no tweens). The car, camera
  //     and world read it in their own frame loop; it is just "how far
  //     through Stage 1->2 / Stage 2->3 are we". InteractionSystem owns the
  //     actual turn/dolly/shift.
  //  2. ONE scrubbed timeline that owns every DOM fade, across both stages.
  //
  // The second used to be split: a scrubbed timeline for Stage 1->2 and, for
  // Stage 2->3, `gsap.set(".section2-fade-content", { opacity, overwrite: true })`
  // inside an onUpdate. That `overwrite: true` killed the Stage 1->2 tween
  // for good the first time it ran, and on scrolling back up past Stage 2 it
  // fired once more with progress 0 and left Section 2's copy at opacity 1
  // on top of the hero. One timeline means every fade, both ways, is just a
  // position on the same clock -- nothing to overwrite, nothing to forget.
  useGSAP(
    () => {
      if (!wrapperRef.current) return;

      // Scrub now sits ON TOP of Lenis rather than on raw wheel deltas,
      // which changes what this number means. It used to be 0.15, kept
      // deliberately tiny because scrub duration IS lag and 0.6 read as
      // "late and slow" against unsmoothed scroll. With Lenis already
      // easing the scroll position, the timeline is chasing a target
      // that's itself gliding, so a longer scrub shapes the motion instead
      // of delaying it. If this ever reads late again, this is the first
      // dial to turn -- not Lenis's duration.
      const SCRUB = 0.8;

      // EXPLICIT `+=<px>` scroll distances: STAGE_12_VH reproduces exactly
      // the 120vh of scroll the original 220vh container gave Stage 1->2
      // (220vh - the 100vh pinned viewport), so Section 2 plays out with
      // identical timing regardless of how tall the wrapper grows. Stage 2->3
      // starts exactly where that range ends, so the two never overlap.
      ScrollTrigger.create({
        trigger: wrapperRef.current,
        start: "top top",
        end: () => `+=${window.innerHeight * STAGE_12_VH}`,
        invalidateOnRefresh: true,
        onRefresh: (self) => {
          scrollState.stage12 = self.progress;
        },
        onUpdate: (self) => {
          scrollState.stage12 = self.progress;
        },
      });
      ScrollTrigger.create({
        trigger: wrapperRef.current,
        start: () => `${window.innerHeight * STAGE_12_VH}px top`,
        end: () => `+=${window.innerHeight * STAGE_23_VH}`,
        invalidateOnRefresh: true,
        onRefresh: (self) => {
          scrollState.stage23 = self.progress;
        },
        onUpdate: (self) => {
          scrollState.stage23 = self.progress;
        },
      });

      ScrollTrigger.create({
        trigger: wrapperRef.current,
        start: () => `${window.innerHeight * (STAGE_12_VH + STAGE_23_VH)}px top`,
        end: () => `+=${window.innerHeight * FEATURES_VH}`,
        invalidateOnRefresh: true,
        onRefresh: (self) => {
          scrollState.features = self.progress;
        },
        onUpdate: (self) => {
          scrollState.features = self.progress;
        },
      });

      // The fades, positioned in units of viewport-heights of scroll so each
      // one lands on the same fraction of its stage as before: hero chrome
      // out by 0.08-0.43 of Stage 1->2, Section 2 in from 0.55, Section 2
      // out over the FIRST 20% of Stage 2->3.
      const T12 = STAGE_12_VH;
      const T23 = STAGE_23_VH;
      gsap
        .timeline({
          scrollTrigger: {
            trigger: wrapperRef.current,
            start: "top top",
            end: () => `+=${window.innerHeight * (T12 + T23)}`,
            scrub: SCRUB,
            invalidateOnRefresh: true,
          },
        })
        // An explicit from/to (never an implicit "from whatever it is now"):
        // the load-in tweens also own these elements' opacity, and a tween
        // that records its start value lazily can record one of THEIR
        // in-between values and then restore it, wrongly, when you scroll
        // back to the top. `immediateRender: false` keeps it from touching
        // anything until scroll actually reaches it, so the load-in plays.
        .fromTo(
          ".hero-fade-content",
          { opacity: 1, y: 0 },
          {
            opacity: 0,
            y: -30,
            pointerEvents: "none",
            duration: 0.35 * T12,
            ease: "power1.in",
            immediateRender: false,
            // StatsPanel and DriveHud run their OWN entrance tween (a
            // gsap.from(...opacity...) on mount) on these same elements;
            // if the user scrolls before it finishes, this one must win.
            overwrite: "auto",
          },
          0.08 * T12,
        )
        .fromTo(
          ".section2-fade-content",
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.35 * T12, ease: "power1.out" },
          0.55 * T12,
        )
        .to(".section2-fade-content", { opacity: 0, x: -40, duration: 0.2 * T23, ease: "none" }, T12)
        // Pads the timeline to exactly T12 + T23, so its 0-1 progress lines
        // up with the scroll distance above no matter what the last tween is.
        .set({}, {}, T12 + T23);
    },
    { scope: wrapperRef, dependencies: [loaded] },
  );

  return (
    <div
      ref={wrapperRef}
      className="relative w-full bg-black"
      style={{ height: `${WRAPPER_VH * 100}vh` }}
    >
      <div ref={stageRef} className="sticky top-0 h-dvh w-full overflow-hidden">
        {/* Layer 1: the whole 3D world -- sky, wet road, lamps and the car --
            in one persistent, opaque canvas that spans every scroll stage
            (see the module doc above). The headline is drawn inside it too
            (HeadlinePlane), which is how it stays behind the car. */}
        <div className="absolute inset-0 z-20">
          <Scene
            carGroupRef={carGroupRef}
            rimLightRef={rimLightRef}
            parallaxRef={parallaxRef}
            hotspotScreenRef={hotspotScreenRef}
            headlineIntroRef={headlineIntroRef}
          />
        </div>

        {/* Bottom scrim: keeps ENGINE SOUND, the scroll cue and the model
            label off bright road. Above the canvas, below all UI. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[25] h-[16%]"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0))" }}
        />

        <Hero loaded={loaded} />

        {/* The canvas is opaque now, so section copy has to sit ABOVE it
            (it used to sit below a transparent one). */}
        <div className="section2-fade-content pointer-events-none absolute inset-0 z-30 opacity-0">
          <Section2 />
        </div>

        <FeatureScan screenRef={hotspotScreenRef} />

        <Loader onComplete={handleLoaded} />
      </div>
    </div>
  );
}
