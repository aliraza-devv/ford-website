"use client";

import type { RefObject } from "react";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { FORD_COLORS } from "@/lib/theme";

// RectAreaLight needs its LTC lookup textures registered before first use.
// Safe to call more than once (HMR) -- it just re-registers the same data.
RectAreaLightUniformsLib.init();

type LightingProps = {
  rimLightRef: RefObject<THREE.PointLight | null>;
};

/**
 * Key / fill / rim setup plus a few thin rect-area lights for the long
 * specular streaks across the paint. Rim light starts at intensity 0 --
 * Hero.tsx's load-sequence timeline ramps it up once the model is visible.
 * Its position is driven every frame by InteractionSystem, not here.
 */
export function Lighting({ rimLightRef }: LightingProps) {
  return (
    <>
      <directionalLight
        position={[-4, 6, 4]}
        intensity={2.2}
        color="#eef4ff"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
      />

      <directionalLight position={[-6, 1.5, 1]} intensity={0.35} color={FORD_COLORS.blue} />

      <pointLight
        ref={rimLightRef}
        position={[1.4, 1.1, -3.2]}
        intensity={0}
        distance={8}
        color={FORD_COLORS.grabber}
      />

      <rectAreaLight
        position={[3.2, 2.2, 2]}
        rotation={[0, Math.PI / 3, 0]}
        width={0.15}
        height={4}
        intensity={6}
        color="#eaf1ff"
      />
      <rectAreaLight
        position={[-3, 1.6, 2.6]}
        rotation={[0, -Math.PI / 4, 0]}
        width={0.15}
        height={3}
        intensity={4}
        color={FORD_COLORS.grabber}
      />
      <rectAreaLight
        position={[0, 2.6, -3.5]}
        rotation={[Math.PI / 8, Math.PI, 0]}
        width={4}
        height={0.12}
        intensity={3}
        color="#eaf1ff"
      />
    </>
  );
}
