"use client";

import { type RefObject, Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Preload, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import dynamic from "next/dynamic";
import type { ParallaxState } from "@/hooks/useParallax";
import { FORD_COLORS, RIG } from "@/lib/theme";
import type { HotspotScreenMap } from "@/lib/hotspots";
import { capTier, getTier, pinTier, stepDownTier, type Tier, useTier } from "@/lib/perfTier";
import { scrollState } from "@/lib/scrollState";
import { worldDebug } from "@/lib/worldDebug";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Lighting } from "./Lighting";
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
  const s = useRef({ acc: 0, n: 0, dpr: startDpr, slowStreak: 0, fastStreak: 0, elapsed: 0 });

  useFrame((_, dt) => {
    if (dt > 0.25 || document.hidden) return;
    const q = s.current;
    q.acc += dt;
    q.elapsed += dt;
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
          // scale that would land on TARGET_MS is sqrt(target / actual).
          const scale = Math.min(0.95, Math.max(0.6, Math.sqrt(TARGET_MS / avgMs)));
          q.dpr = Math.max(MIN_DPR, q.dpr * scale);
          setDpr(q.dpr);
        } else {
          // Resolution is at its floor: drop a tier. The controller hands
          // resolution back on its own once the lighter tier proves fast.
          stepDownTier();
        }
      }
    } else if (avgMs < FAST_MS) {
      q.slowStreak = 0;
      if (++q.fastStreak >= 4 && q.dpr < maxDpr - 0.01) {
        q.fastStreak = 0;
        q.dpr = Math.min(maxDpr, q.dpr * 1.08);
        setDpr(q.dpr);
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
  const [startDpr] = useState(() => Math.min(deviceDpr, tier === "high" ? 2 : tier === "medium" ? 1.25 : 0.75));

  return (
    <Canvas
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

      <ambientLight intensity={0.15} />

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
