"use client";

import { type RefObject, Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import dynamic from "next/dynamic";
import type { ParallaxState } from "@/hooks/useParallax";
import { FORD_COLORS, RIG } from "@/lib/theme";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Lighting } from "./Lighting";
import { MustangModel, type MustangModelHandle } from "./MustangModel";
import { InteractionSystem } from "./InteractionSystem";

const PostFX = dynamic(() => import("./PostFX").then((m) => m.PostFX), {
  ssr: false,
});

type SceneProps = {
  carGroupRef: RefObject<THREE.Group | null>;
  paintControllerRef: RefObject<MustangModelHandle | null>;
  rimLightRef: RefObject<THREE.PointLight | null>;
  parallaxRef: RefObject<ParallaxState>;
  scrollProgressRef: RefObject<number>;
};

/**
 * The car's own canvas -- transparent background, sitting on top of the
 * Sky/Road/headline DOM stack (Hero.tsx composes the layers). Its opaque
 * pixels naturally occlude the headline text underneath via real alpha
 * compositing, which is the whole reason the car gets a dedicated canvas
 * instead of living in the same scene as Sky/Road.
 */
export function Scene({
  carGroupRef,
  paintControllerRef,
  rimLightRef,
  parallaxRef,
  scrollProgressRef,
}: SceneProps) {
  const isMobile = useIsMobile();
  const cameraRigRef = useRef<THREE.Group>(null);
  const shadowGroupRef = useRef<THREE.Group>(null);

  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.1,
      }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.15} />

      <Suspense fallback={null}>
        {/* Procedural night-studio environment -- no external HDRI fetch,
            fully brand-colored, still gives the clearcoat paint real
            reflections to catch and stretch. */}
        <Environment resolution={256} background={false}>
          <Lightformer
            form="rect"
            intensity={2}
            color="#eef4ff"
            position={[-4, 4, 4]}
            scale={[4, 2, 1]}
          />
          <Lightformer
            form="rect"
            intensity={5}
            color={FORD_COLORS.grabber}
            position={[3, 1.6, -3]}
            rotation={[0, Math.PI / 2, 0]}
            scale={[6, 1.5, 1]}
          />
          <Lightformer
            form="ring"
            intensity={1.2}
            color={FORD_COLORS.blue}
            position={[0, 5, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={8}
          />
        </Environment>

        <MustangModel
          ref={paintControllerRef}
          outerRef={carGroupRef}
          scrollProgressRef={scrollProgressRef}
        />

        {/* FIX 2: blur/opacity/far/resolution/color per spec -- previously
            far=6 spread the shadow into a diffuse haze under the whole
            ground plane instead of a tight contact shadow at the tyres.
            Wrapped in its own group so InteractionSystem can slide it
            sideways in lockstep with the car during the section 2 scroll
            transition -- otherwise the shadow visibly detaches from the
            car as it shifts. */}
        <group ref={shadowGroupRef} position={[0, RIG.carGroundOffsetY, 0]}>
          <ContactShadows
            opacity={0.8}
            blur={2.5}
            far={1.2}
            resolution={1024}
            scale={10}
            color={FORD_COLORS.blue}
          />
        </group>
      </Suspense>

      <Lighting rimLightRef={rimLightRef} />

      <group ref={cameraRigRef}>
        <PerspectiveCamera
          makeDefault
          fov={RIG.cameraFov}
          position={RIG.cameraPosition}
          near={0.1}
          far={50}
        />
      </group>

      <InteractionSystem
        parallaxRef={parallaxRef}
        cameraRigRef={cameraRigRef}
        carGroupRef={carGroupRef}
        rimLightRef={rimLightRef}
        shadowGroupRef={shadowGroupRef}
        scrollProgressRef={scrollProgressRef}
        isMobile={isMobile}
      />

      {!isMobile && <PostFX />}
    </Canvas>
  );
}
