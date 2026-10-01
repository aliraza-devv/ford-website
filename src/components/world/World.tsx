"use client";

/* eslint-disable react-hooks/immutability --
 * useFrame writes fog, clear colour and transforms every frame, outside
 * React's render/commit cycle. */

import { type ComponentType, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { damp } from "maath/easing";
import * as THREE from "three";
import type { ParallaxState } from "@/hooks/useParallax";
import {
  ENV_FORMERS,
  ENV_RUNTIME,
  MAX_SPEED,
  METER,
  SKY_HORIZON_COLOR,
  SPEED_PER_SCROLL_VELOCITY,
  type EnvFormer,
  type WorldId,
  sampleWorld,
} from "@/config/worlds";
import { smoothstep } from "@/config/line";
import { GROUND_Y } from "@/lib/hallSpace";
import { getCarPose } from "@/lib/carPose";
import { getDriveMode } from "@/lib/driveMode";
import type { Tier } from "@/lib/perfTier";
import { getStage, scrollState } from "@/lib/scrollState";
import { worldDebug } from "@/lib/worldDebug";
import { EnvLamps } from "./EnvLamps";
import { GatedEnvironment } from "./GatedEnvironment";
import { Highway } from "./Highway";
import { Plant } from "./plant/Plant";
import { roadShared } from "./roadShader";
import { SkyDome } from "./SkyDome";

type StageProps = { tier: Tier; parallaxRef: RefObject<ParallaxState> };

// Adding a stage means adding its entry here and in WORLD_STAGES. The tunnel
// and garage are never built (the highway keeps showing behind the side
// profile and the interior fades to black); the plant is Section 4.
const STAGE_COMPONENTS: Record<WorldId, ComponentType<StageProps> | null> = {
  highway: Highway,
  tunnel: null,
  garage: null,
  plant: Plant,
};


function EnvPanel({ former, index }: { former: EnvFormer; index: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const base = useMemo(() => new THREE.Color(former.color), [former.color]);

  // The Environment's static lightformers fade with the stage, not the
  // frame: intensity is whatever the sampled world says it is.
  useLayoutEffect(() => {
    material.current?.color.copy(base).multiplyScalar(ENV_RUNTIME.envIntensity[index]);
    if (former.faceCenter) mesh.current?.lookAt(0, 0, 0);
  }, [base, index, former.faceCenter]);
  useFrame(() => {
    material.current?.color.copy(base).multiplyScalar(ENV_RUNTIME.envIntensity[index]);
  });

  return (
    <mesh ref={mesh} position={former.position} rotation={former.rotation} scale={former.scale}>
      {former.form === "ring" ? <ringGeometry args={[0.5, 1, 64]} /> : <planeGeometry args={[1, 1]} />}
      <meshBasicMaterial ref={material} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

type WorldProps = {
  parallaxRef: RefObject<ParallaxState>;
  tier: Tier;
  /** True when nothing post-processes the frame (mobile): the sky then
   * applies its own dither and the renderer's own tone mapping/exposure. */
  bareRenderer: boolean;
};

/**
 * The persistent 3D world behind (and under) the car, inside the car's own
 * canvas -- one scene, so the wet road can reflect the car and the lamps can
 * light its paint. Owns fog, clear colour, the realtime environment, flow
 * speed, and per-stage blending. The individual places (Highway, later
 * Tunnel and Garage) only draw themselves.
 */
export function World({ parallaxRef, tier, bareRenderer }: WorldProps) {
  const { scene, gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  // True while the plant walkthrough is on screen.
  const plantOnRef = useRef(false);
  const envWasPlant = useRef(false);

  // When the environment cube is refreshed (see GatedEnvironment for why this
  // is a policy and not a prop). A refresh is the most expensive thing the
  // scene does on an integrated GPU, so it happens as rarely as the picture
  // allows:
  //  - Sections 1-3: as they always were. The low tier bakes the cube once at
  //    the highway's values; the others keep it live and follow the blend.
  //  - Entering the plant: once, with the plant's values from the first frame.
  //    That moment is the camera still inside the cabin, where no paint is in
  //    view to show the change.
  //  - In the plant: never. Its lights are rows that look the same from every
  //    point along them, so a car sliding down the line sees the same cube all
  //    the way; the one thing that moves past it, the inspection tunnel's bars,
  //    is drawn into the paint directly (see PlantPaintLight).
  //  - Leaving it (scrolling back): once, back to the Section 1-3 values.
  const shouldUpdateEnv = useCallback(
    (frame: number) => {
      const inPlant = plantOnRef.current;
      if (inPlant !== envWasPlant.current) {
        envWasPlant.current = inPlant;
        worldDebug.envUpdates++;
        return true;
      }
      if (inPlant) return false;
      return tier === "low" ? frame <= 2 : true;
    },
    [tier],
  );

  const fog = useMemo(() => new THREE.FogExp2(SKY_HORIZON_COLOR.clone(), 0.01), []);

  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const stage = getStage();

    // `world` is the smoothed 0-2 value that drives blends. Anything that
    // has to stay locked to the car (the group pose below) reads the raw
    // stage instead, or it would visibly lag the car it sits under.
    // The plant is one more world past the interior: it fades in over the
    // first tenth of the walkthrough, while the camera is still leaving the
    // cabin, so the hall's air arrives with its lights.
    const plantLead = smoothstep(0, 0.1, scrollState.factory);
    damp(scrollState, "world", stage + plantLead, 0.3, dt);

    const plantNow = scrollState.factory > 0.001;
    if (plantNow !== plantOnRef.current) {
      plantOnRef.current = plantNow;
    }
    const sampled = sampleWorld(scrollState.world);
    // The environment samples the world on its own terms: the plant's values the
    // moment the plant is on, the highway's while a low-tier cube is baked, the
    // live blend otherwise.
    sampleWorld(plantNow ? 3 : tier === "low" ? 0 : scrollState.world, ENV_RUNTIME);

    // Flow speed: the stage's resting speed plus a push from scroll
    // velocity, smoothed, never below the resting speed.
    const target = Math.min(
      sampled.baseSpeed * getDriveMode().speed + SPEED_PER_SCROLL_VELOCITY * Math.abs(scrollState.velocity),
      MAX_SPEED,
    );
    damp(scrollState, "speed", target, 0.7, dt);
    scrollState.travel += scrollState.speed * dt;

    // The world follows the car's heading and shift so the road always runs
    // along it (see getCarPose).
    const pose = getCarPose(stage);
    const group = groupRef.current;
    if (group) {
      group.rotation.y = pose.yaw;
      group.position.set(pose.shiftX, GROUND_Y, 0);
    }

    // Fog colour IS the sky's horizon colour (same table, see worlds.ts):
    // that equality is what removes the horizon line.
    fog.density = sampled.fogDensity / METER;
    fog.color.copy(sampled.fogColor);
    gl.setClearColor(fog.color);

    // The road is drawn by its own shader, which does its own fog: hand it
    // the same numbers the scene fog uses so the two can't drift apart.
    roadShared.uFogColor.value.copy(fog.color);
    roadShared.uFogDensity.value = fog.density;
    roadShared.uFarFade.value = (state.camera as THREE.PerspectiveCamera).far;
    if (bareRenderer) gl.toneMappingExposure = sampled.exposure;
  });

  return (
    <>
      <SkyDome parallaxRef={parallaxRef} dither={bareRenderer} clouds={tier !== "low"} />

      <GatedEnvironment resolution={256} shouldUpdate={shouldUpdateEnv}>
        {ENV_FORMERS.map((former, i) => (
          <EnvPanel key={former.id} former={former} index={i} />
        ))}
        <EnvLamps live={tier !== "low"} />
      </GatedEnvironment>

      <group ref={groupRef} scale={METER}>
        {(Object.keys(STAGE_COMPONENTS) as WorldId[]).map((id) => {
          const Stage = STAGE_COMPONENTS[id];
          return Stage ? <Stage key={id} tier={tier} parallaxRef={parallaxRef} /> : null;
        })}
      </group>
    </>
  );
}
