"use client";

import { type RefObject, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ParallaxState } from "@/hooks/useParallax";
import { gateGlow, ignitionRadius, indexPos } from "@/config/line";
import { METER } from "@/config/worlds";
import { Z_REF } from "@/lib/hallSpace";
import type { Tier } from "@/lib/perfTier";
import { scrollState } from "@/lib/scrollState";
import { Equipment } from "./Equipment";
import { PlantCar } from "./PlantCar";
import { PlantFloor, plantFloor } from "./PlantFloor";
import { hallLight } from "./hallLight";
import { PlantHall } from "./PlantHall";
import { ProxyCars } from "./ProxyCars";

type PlantProps = { tier: Tier; parallaxRef: RefObject<ParallaxState> };

/**
 * Section 4's world: the assembly hall and the line that runs down it.
 *
 * Authored in metres in the hall's own frame. World mounts it under the same
 * group the highway uses (scaled by METER, turned with the car) and this root
 * offsets it so that the finished car's place in the inspection tunnel is the
 * origin Sections 1-3 built the camera around: see lib/hallSpace.ts.
 *
 * The hall is STATIC. Cars move through it, cranes work in it and the camera
 * travels it; the hall itself never slides. (An earlier version held the car
 * still and slid the hall past it, which is cheap but cannot show a line with
 * more than one car on it.)
 *
 * It exists only while the walkthrough does: hidden until `factory` leaves
 * zero, so it costs nothing in Sections 1-3, and Preload still compiles its
 * shaders during the load screen so entering it does not hitch.
 */
export function Plant({ tier }: PlantProps) {
  const rootRef = useRef<THREE.Group>(null);
  const rotation = useMemo(() => new THREE.Matrix3(), []);

  useFrame(() => {
    const root = rootRef.current;
    if (!root) return;
    const f = scrollState.factory;
    root.visible = f > 0.0005;
    if (!root.visible) return;

    plantFloor.uIgnite.value = ignitionRadius(f);
    plantFloor.uGate.value = gateGlow(f);
    plantFloor.uIndex.value = indexPos(f);

    // World -> hall rotation for the floor shader. The root's matrix carries the
    // METER scale as well as the car's heading, so divide that back out.
    root.updateWorldMatrix(true, false);
    // And the whole world -> hall transform for every surface that takes the
    // hall's light (hallLight.ts).
    hallLight.uHallFromWorld.value.copy(root.matrixWorld).invert();
    rotation.setFromMatrix4(root.matrixWorld);
    plantFloor.uWorldToHall.value.copy(rotation).transpose().multiplyScalar(1 / METER);
  });

  return (
    <group ref={rootRef} position={[0, 0, -Z_REF]} visible={false}>
      <PlantFloor tier={tier} />
      <PlantHall />
      <Equipment />
      <ProxyCars />
      <PlantCar />
    </group>
  );
}
