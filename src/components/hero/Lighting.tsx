"use client";

import { type RefObject, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { smoothstep } from "@/config/line";
import type { Tier } from "@/lib/perfTier";
import { getStage } from "@/lib/scrollState";
import { FORD_COLORS } from "@/lib/theme";

// Ford Grabber (#1700F4) now appears in the world in exactly one place -- the
// tunnel's guidance strip -- so the car-side rim light that used it is a cool
// periwinkle-white instead: still a blue rim, but not the brand's signal
// colour with no source in the scene.
const COOL_RIM = "#9db4ff";

/** Strength of the soft light on the car's face in the hero. */
const HERO_FILL = 0.7;

/**
 * A soft light from just above and behind the camera, on the car's face. The key light comes from
 * the side and above, so the front of the car, the grille, the lamps' surrounds, the lip, met it
 * edge-on and fell into shadow; this is what shows them. It is the hero's alone: it fades out as
 * the car turns away (the side profile and the rooms after it have lights of their own), and it is
 * mounted for the whole page at zero rather than added, because adding a light recompiles every
 * material (see PlantFill).
 */
function HeroFill() {
  const ref = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const light = ref.current;
    if (light) light.intensity = HERO_FILL * (1 - smoothstep(0, 0.7, getStage()));
  });
  return <directionalLight ref={ref} position={[0.8, 3, 8]} intensity={HERO_FILL} color="#dfe9ff" />;
}

type LightingProps = {
  rimLightRef: RefObject<THREE.PointLight | null>;
  /** High tier adds the car's self-shadow map (it re-renders the whole car
   * from the light every frame) and the faint blue fill light. */
  tier: Tier;
};

/**
 * Key / fill / rim on the car. The long thin specular streaks across the
 * paint used to come from three RectAreaLights; those cost ~18 ms a frame on
 * an integrated GPU (LTC shading on every car pixel) and are now thin
 * Lightformers in the Environment instead (see ENV_FORMERS in worlds.ts),
 * which reflect in the clearcoat identically for free. Rim light starts at
 * intensity 0 -- HeroExperience's load timeline ramps it up once the model is
 * visible. Its position is driven every frame by InteractionSystem.
 */
export function Lighting({ rimLightRef, tier }: LightingProps) {
  return (
    <>
      <directionalLight
        position={[-4, 6, 4]}
        intensity={2.2}
        color="#eef4ff"
        castShadow={tier === "high"}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
      />

      <HeroFill />

      {/* Every light is evaluated for every car pixel, so the lights that add
          least are the first to go on the lighter tiers. */}
      {tier === "high" && <directionalLight position={[-6, 1.5, 1]} intensity={0.35} color={FORD_COLORS.blue} />}

      <pointLight
        ref={rimLightRef}
        position={[1.4, 1.1, -3.2]}
        intensity={0}
        distance={8}
        color={COOL_RIM}
      />
    </>
  );
}
