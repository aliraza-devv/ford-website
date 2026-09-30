"use client";

/* eslint-disable react-hooks/immutability --
 * useFrame writes fog, clear colour and transforms every frame, outside
 * React's render/commit cycle. */

import { type ComponentType, type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { damp } from "maath/easing";
import * as THREE from "three";
import type { ParallaxState } from "@/hooks/useParallax";
import {
  ENV_FORMERS,
  MAX_SPEED,
  METER,
  SKY_HORIZON_COLOR,
  SPEED_PER_SCROLL_VELOCITY,
  WORLD_RUNTIME,
  type EnvFormer,
  type WorldId,
  sampleWorld,
} from "@/config/worlds";
import { getCarPose } from "@/lib/carPose";
import { getDriveMode } from "@/lib/driveMode";
import type { Tier } from "@/lib/perfTier";
import { RIG } from "@/lib/theme";
import { getStage, scrollState } from "@/lib/scrollState";
import { EnvLamps } from "./EnvLamps";
import { Highway } from "./Highway";
import { roadShared } from "./roadShader";
import { SkyDome } from "./SkyDome";

type StageProps = { tier: Tier; parallaxRef: RefObject<ParallaxState> };

// Adding a stage means adding its entry here and in WORLD_STAGES. Tunnel and
// Garage are Stages B and C; until they exist the highway keeps showing
// behind the side profile and the interior, so the scene is never empty.
const STAGE_COMPONENTS: Record<WorldId, ComponentType<StageProps> | null> = {
  highway: Highway,
  tunnel: null,
  garage: null,
};

/** Tyre contact with the ground plane. The car sits at carGroundOffsetY but
 * carries a -0.02 rad nose-up tilt that lifts the front tyres ~3 cm and
 * sinks the rear ones by the same, so the ground is set halfway to split the
 * error rather than bury one axle. ContactShadows covers the rest. */
const GROUND_Y = RIG.carGroundOffsetY - 0.016;

function EnvPanel({ former, index }: { former: EnvFormer; index: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const base = useMemo(() => new THREE.Color(former.color), [former.color]);

  // The Environment's static lightformers fade with the stage, not the
  // frame: intensity is whatever the sampled world says it is.
  useLayoutEffect(() => {
    material.current?.color.copy(base).multiplyScalar(WORLD_RUNTIME.envIntensity[index]);
    if (former.faceCenter) mesh.current?.lookAt(0, 0, 0);
  }, [base, index, former.faceCenter]);
  useFrame(() => {
    material.current?.color.copy(base).multiplyScalar(WORLD_RUNTIME.envIntensity[index]);
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
    damp(scrollState, "world", stage, 0.3, dt);
    const sampled = sampleWorld(scrollState.world);

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

      <Environment
        frames={tier === "low" ? 1 : Infinity}
        resolution={256}
        background={false}
      >
        {ENV_FORMERS.map((former, i) => (
          <EnvPanel key={former.id} former={former} index={i} />
        ))}
        <EnvLamps live={tier !== "low"} />
      </Environment>

      <group ref={groupRef} scale={METER}>
        {(Object.keys(STAGE_COMPONENTS) as WorldId[]).map((id) => {
          const Stage = STAGE_COMPONENTS[id];
          return Stage ? <Stage key={id} tier={tier} parallaxRef={parallaxRef} /> : null;
        })}
      </group>
    </>
  );
}
