"use client";

/* eslint-disable react-hooks/immutability --
 * ReflectorClock ticks a module counter and sets a renderer property from useFrame, outside
 * React's render/commit cycle. */

import { type RefObject, Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Preload, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import dynamic from "next/dynamic";
import gsap from "gsap";
import type { ParallaxState } from "@/hooks/useParallax";
import { FORD_COLORS, RIG } from "@/lib/theme";
import type { HotspotScreenMap } from "@/lib/hotspots";
import { capTier, getTier, pinTier, stepDownTier, type Tier, useTier } from "@/lib/perfTier";
import { scrollState } from "@/lib/scrollState";
import { worldDebug } from "@/lib/worldDebug";
import { isStageLive, onStageLive } from "@/lib/stageLive";
import { reflectorClock } from "@/lib/reflectorBudget";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Lighting } from "./Lighting";
import { PlantFill } from "@/components/world/plant/PlantFill";
import { MustangModel } from "./MustangModel";
import { InteractionSystem } from "./InteractionSystem";
import { World } from "@/components/world/World";
import { CarBlobShadow } from "@/components/world/CarBlobShadow";
import { HeadlinePlane } from "@/components/world/HeadlinePlane";
import type { HeadlineIntro } from "@/lib/headlineIntro";

const PostFX = dynamic(() => import("./PostFX").then((m) => m.PostFX), {
  ssr: false,
});

type SceneProps = {
  carGroupRef: RefObject<THREE.Group | null>;
  rimLightRef: RefObject<THREE.PointLight | null>;
  parallaxRef: RefObject<ParallaxState>;
  /** Per-hotspot projected screen position, written once per frame inside
   * MustangModel's own useFrame, read by HotspotOverlay's rAF loop. */
  hotspotScreenRef: RefObject<HotspotScreenMap>;
  /** 0 -> 1 progress of the headline's per-letter load-in, tweened by
   * HeroExperience's timeline and read by HeadlinePlane. */
  headlineIntroRef: RefObject<HeadlineIntro>;
  /** Called once the model is in the scene and a few frames of it have been drawn. */
  onReady?: () => void;
};

// ---------------------------------------------------------------- quality

/** Render scale bounds. The canvas is stretched to fit, so 0.6 is a visibly
 * softer car but a smooth scroll; DOM text stays crisp either way. */
const MIN_DPR = 0.55;
/** Above this frame time (under 50 fps) for two seconds, quality steps down. */
const SLOW_MS = 20;
/** Frame time the resolution controller aims for once it has to act. */
const TARGET_MS = 17;
/** Below this (over ~75 fps) for three seconds, resolution may creep back up. */
const FAST_MS = 13.5;
/** Settling time after mount: model download, shader compiles and the intro
 * animation are not sustained slowness. */
const GRACE_MS = 2500;
/** After a resolution change the render targets are reallocated and the next frames are slow for
 * that reason alone: they are not measured. */
const SETTLE_MS = 1500;
/**
 * The render scales the controller moves between. Every change reallocates the canvas and every
 * post-processing target, which is a visible hitch, so it moves in a few big steps rather than
 * many small ones, and each step is a scale that looks like a choice (1.5x, 1x), not a number.
 */
const DPR_STEPS = [2, 1.5, 1.25, 1, 0.8, 0.65, MIN_DPR];
/** Scroll speed (px a frame) above which resolution is not handed back: sharpening in the
 * middle of a scroll is a hitch exactly when the eye is following motion. */
const SCROLLING = 0.6;

/** Development only: hands the renderer, scene and camera to the console and the
 * verification scripts (window.__fordGl), so a frame can be taken apart. */
function DevProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as Record<string, unknown>).__fordGl = { gl, scene, camera };
  }, [gl, scene, camera]);
  return null;
}

/**
 * Says the scene is ready: it is mounted inside the same Suspense as the car, so it appears only
 * once the model has loaded, and the first frames (which carry the compiling of every shader)
 * have then been drawn. The page fades the canvas in on it.
 */
function ReadySignal({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    if (frames.current < 3 && ++frames.current === 3) onReady?.();
  });
  return null;
}

/** Screens that refresh faster than this get the frame cap; slower ones (60, 75, 90, 100 Hz)
 * are left alone. */
const CAP_ABOVE_HZ = 105;
/** The cap draws every n-th screen refresh, n the smallest whole number that brings the rate to
 * about this or below: 120 Hz draws 60, 144 Hz draws 72, 165 Hz draws 82, 240 Hz draws 80. A
 * whole divisor is what keeps the gap between frames even; "about 60" on a 144 Hz screen
 * alternates 14 and 21 ms and judders worse than either. The measured rate runs a few percent
 * above the screen's (the quick end of the gaps), which CAP_SLACK allows for. */
const CAP_TARGET_HZ = 85;
const CAP_SLACK = 0.1;

/**
 * Pauses the render loop while the plant map covers this stage completely (see lib/stageLive),
 * and holds it to 60 frames a second on screens that refresh faster than that.
 *
 * 1. Nothing the canvas drew while the map covers it would be seen, and its frames would be
 *    paid for with the time the map and the road finder need to scroll smoothly.
 * 2. On a 120 or 144 Hz screen the default loop asks for a frame every 7-8 ms. A scene this
 *    heavy cannot keep that up, and a loop that manages 90 one moment and 70 the next is the
 *    judder people call lag. A steady 60-72 looks smoother than a wavering 100, and the GPU gets
 *    half the work. The screen's rate is measured from the first two seconds of ticks (a
 *    loaded page can only tick slower than its screen, never faster, so the quick end of the
 *    gaps is the screen's own rate). A 60 Hz screen keeps the plain loop untouched: no frame is
 *    ever held back there, and no frame of latency is added.
 *
 * In capped mode the loop is "demand": a frame is requested from the same clock as Lenis and
 * GSAP (gsap.ticker), so it is drawn on the next screen refresh with the scroll already moved.
 */
function FrameDriver() {
  const invalidate = useThree((s) => s.invalidate);
  const setFrameloop = useThree((s) => s.setFrameloop);

  useEffect(() => {
    let live = isStageLive();
    let mode: "always" | "demand" | "never" = live ? "always" : "never";
    let measured = false;
    const gaps: number[] = [];
    let prev = -1;
    let last = -1;
    // Screen refreshes per drawn frame (1 = no cap), and the screen's refresh interval.
    let every = 1;
    let tickS = 1 / 60;

    const apply = (next: typeof mode) => {
      if (next === mode) return;
      mode = next;
      setFrameloop(next);
    };
    const wanted = () => (!live ? "never" : every > 1 ? "demand" : "always");

    const tick = (time: number) => {
      if (!measured && prev >= 0 && live) {
        gaps.push(time - prev);
        if (gaps.length >= 120) {
          measured = true;
          gaps.sort((a, b) => a - b);
          tickS = gaps[Math.floor(gaps.length * 0.1)];
          const hz = 1 / tickS;
          every = hz > CAP_ABOVE_HZ ? Math.ceil(hz / CAP_TARGET_HZ - CAP_SLACK) : 1;
          apply(wanted());
        }
      }
      prev = time;
      if (mode !== "demand") return;
      // Draw on every n-th refresh: once n refreshes' worth of time has passed, less half a
      // refresh so that the nearest one to it is the one that draws.
      if (last >= 0 && time - last < (every - 0.5) * tickS) return;
      last = time;
      invalidate();
    };

    // Development only: `?frameEvery=3` draws every 3rd tick whatever the screen, so the capped loop
    // can be checked on a 60 Hz (or software-rendered) machine.
    if (process.env.NODE_ENV !== "production") {
      const forced = Number(new URLSearchParams(window.location.search).get("frameEvery"));
      if (forced >= 2) {
        measured = true;
        every = forced;
        tickS = 1 / 60;
        mode = wanted();
      }
    }

    setFrameloop(mode);
    gsap.ticker.add(tick);
    const off = onStageLive((next) => {
      live = next;
      last = -1;
      apply(wanted());
    });
    return () => {
      gsap.ticker.remove(tick);
      off();
    };
  }, [invalidate, setFrameloop]);

  return null;
}

/**
 * Ticks once a frame, before anything renders (priority below zero), and keeps the
 * glass transmission pass cheap in the plant. See lib/reflectorBudget for the clock.
 */
function ReflectorClock() {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    reflectorClock.frame++;
    // Real transmission (the high tier's glass) draws every opaque object again into a
    // target as large as the screen. Behind a car window in the plant half that size reads
    // the same, and its fill cost is a quarter.
    const scale = scrollState.factory > 0 ? 0.5 : 1;
    if (gl.transmissionResolutionScale !== scale) gl.transmissionResolutionScale = scale;
  }, -1000);
  return null;
}

/**
 * Keeps the scroll smooth by trading resolution first and look second.
 * Every second it averages the real frame time: two slow seconds in a row
 * lower the render scale (cheap, and reversible); once that is at its floor
 * they step the whole tier down instead, and the tier never comes back up
 * this session (see perfTier.ts). Single long frames (a shader compile, a
 * tab switch) are ignored -- they are hitches, not load.
 */
function AdaptiveQuality({ maxDpr, startDpr }: { maxDpr: number; startDpr: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const s = useRef({ acc: 0, n: 0, dpr: startDpr, slowStreak: 0, fastStreak: 0, elapsed: 0, settle: 0 });

  /** The rungs of the ladder below a scale (largest first), and above it up to where the page
   * started: it is never handed more than it began with, so a scene that had to give resolution
   * back does not keep trading it up and down. `maxDpr` is what the screen could show at most. */
  const ceiling = Math.min(maxDpr, startDpr);
  const stepsBelow = (dpr: number) => DPR_STEPS.filter((d) => d < dpr - 0.01);
  const stepsAbove = (dpr: number) => DPR_STEPS.filter((d) => d <= ceiling + 0.01 && d > dpr + 0.01);

  useFrame((_, dt) => {
    if (dt > 0.25 || document.hidden) return;
    const q = s.current;
    q.elapsed += dt;
    if (q.settle > 0) {
      q.settle -= dt;
      return;
    }
    q.acc += dt;
    q.n++;
    if (q.acc < 0.75) return;

    const avgMs = (q.acc / q.n) * 1000;
    q.acc = 0;
    q.n = 0;
    if (q.elapsed < GRACE_MS / 1000) return;

    if (avgMs > SLOW_MS) {
      q.fastStreak = 0;
      // Two slow windows in a row (1.5 s) -- or one, if it is slow by a mile.
      if (++q.slowStreak >= 2 || avgMs > SLOW_MS * 2) {
        q.slowStreak = 0;
        if (q.dpr > MIN_DPR + 0.01) {
          // Fill cost scales with pixel count, i.e. with dpr squared, so the
          // scale that would land on TARGET_MS is sqrt(target / actual). Take the
          // first rung of the ladder at or below that.
          const want = q.dpr * Math.min(0.95, Math.max(0.55, Math.sqrt(TARGET_MS / avgMs)));
          const below = stepsBelow(q.dpr);
          const next = below.find((d) => d <= want + 0.01) ?? below[below.length - 1] ?? MIN_DPR;
          q.dpr = Math.max(MIN_DPR, next);
          q.settle = SETTLE_MS / 1000;
          setDpr(q.dpr);
        } else {
          // Resolution is at its floor: drop a tier. The controller hands
          // resolution back on its own once the lighter tier proves fast.
          stepDownTier();
          q.settle = SETTLE_MS / 1000;
        }
      }
    } else if (avgMs < FAST_MS) {
      q.slowStreak = 0;
      // Only while the page is still: a sharper picture can wait for the next pause.
      if (Math.abs(scrollState.velocity) < SCROLLING && ++q.fastStreak >= 5) {
        q.fastStreak = 0;
        const above = stepsAbove(q.dpr);
        if (above.length) {
          q.dpr = above[above.length - 1]; // the nearest rung up
          setDpr(q.dpr);
          q.settle = SETTLE_MS / 1000;
        }
      }
    } else {
      q.slowStreak = 0;
      q.fastStreak = 0;
    }
  });

  return null;
}

/**
 * The car's canvas, now also the whole world. It is opaque: the sky, the wet
 * road, the lamps and the car all live in this one scene, which is what lets
 * the road reflect the car and the lamps light its paint. The DOM headline
 * that used to sit between road and car is re-created in-scene by
 * HeadlinePlane, and the section text / UI chrome sit above the canvas.
 */
export function Scene({
  carGroupRef,
  rimLightRef,
  parallaxRef,
  hotspotScreenRef,
  headlineIntroRef,
  onReady,
}: SceneProps) {
  const isMobile = useIsMobile();
  const tier = useTier();
  const cameraRigRef = useRef<THREE.Group>(null);
  const shadowGroupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    // `?tier=high|medium|low` pins a tier (used by the verification script
    // and for checking a tier by hand); the monitor then leaves it alone.
    const requested = new URLSearchParams(window.location.search).get("tier");
    if (requested === "high" || requested === "medium" || requested === "low") pinTier(requested as Tier);

    if (process.env.NODE_ENV !== "production") {
      const dev = window as unknown as Record<string, unknown>;
      dev.__fordScroll = scrollState;
      dev.__fordPerf = { getTier };
      dev.__fordWorldDebug = worldDebug;
    }
  }, []);

  useEffect(() => {
    if (isMobile) capTier("low");
  }, [isMobile]);

  const deviceDpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  // Start at a resolution the detected tier can plausibly hold. Fixed for the
  // session: AdaptiveQuality owns the render scale from here on, and a
  // changing `dpr` prop would fight it.
  // The low tier starts at the screen's own resolution (it was 0.75 of it, a car stretched soft
  // over the screen); AdaptiveQuality still lowers it if the frames cannot keep up.
  // The high tier no longer starts at 2: on a retina screen that is four times the pixels of 1,
  // through a 4x-multisampled, bloomed, tone-mapped chain, and a car and a reflection in it. 1.5
  // reads as sharp here (the picture is graded, grained and bloomed) and costs about half.
  const [startDpr] = useState(() => Math.min(deviceDpr, tier === "high" ? 1.5 : tier === "medium" ? 1.25 : 1));

  return (
    <Canvas
      // FrameDriver pauses it while the map covers the stage and caps it at 60 on fast screens.
      dpr={startDpr}
      // Named explicitly: bare `shadows` asks for PCFSoftShadowMap, which
      // three removed in r186 and silently downgrades to PCFShadowMap with
      // a console warning on every mount. Asking for what we actually get.
      shadows={{ type: THREE.PCFShadowMap }}
      gl={{
        // With the composer the default framebuffer is never drawn to, so
        // multisampling it is pure waste; PostFX multisamples its own target.
        antialias: isMobile,
        alpha: false,
        powerPreference: "high-performance",
        // Used only when nothing post-processes the frame (mobile). With the
        // EffectComposer, PostFX applies tone mapping and exposure itself.
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.9,
      }}
    >
      <AdaptiveQuality maxDpr={deviceDpr} startDpr={startDpr} />
      <FrameDriver />
      <ReflectorClock />
      <DevProbe />

      <ambientLight intensity={0.15} />
      <PlantFill />

      <World parallaxRef={parallaxRef} tier={tier} bareRenderer={isMobile} />

      <Suspense fallback={null}>
        <MustangModel
          outerRef={carGroupRef}
          hotspotScreenRef={hotspotScreenRef}
        />

        {/* Wrapped in its own group so InteractionSystem can slide it
            sideways in lockstep with the car during the section 2 scroll
            transition -- otherwise the shadow visibly detaches from the
            car as it shifts. Sits just above the reflective road. High tier
            keeps the true contact shadow; the others a soft blob. */}
        <group ref={shadowGroupRef} position={[0, RIG.carGroundOffsetY, 0]}>
          {tier === "high" ? (
            <ContactShadows
              opacity={0.8}
              blur={2.5}
              far={1.2}
              resolution={1024}
              scale={10}
              color={FORD_COLORS.blue}
            />
          ) : (
            <CarBlobShadow />
          )}
        </group>

        {/* Compile every material and upload every texture during the load
            screen, not on the first scroll. */}
        <Preload all />
        <ReadySignal onReady={onReady} />
      </Suspense>

      <Lighting rimLightRef={rimLightRef} tier={tier} />

      <group ref={cameraRigRef}>
        <PerspectiveCamera
          makeDefault
          fov={RIG.cameraFov}
          position={RIG.cameraPosition}
          near={0.1}
          // The highway is fogged out well before this, but the horizon
          // silhouettes sit ~255 m away and the tunnel is 200 m long.
          far={320}
        />
      </group>

      <InteractionSystem
        parallaxRef={parallaxRef}
        cameraRigRef={cameraRigRef}
        carGroupRef={carGroupRef}
        rimLightRef={rimLightRef}
        shadowGroupRef={shadowGroupRef}
        isMobile={isMobile}
      />

      {/* After InteractionSystem on purpose: useFrame callbacks run in mount
          order, and this reads the camera InteractionSystem just placed. */}
      <HeadlinePlane parallaxRef={parallaxRef} carGroupRef={carGroupRef} introRef={headlineIntroRef} />

      {!isMobile && <PostFX tier={tier} carGroupRef={carGroupRef} />}
    </Canvas>
  );
}
