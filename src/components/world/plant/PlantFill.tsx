"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { smoothstep } from "@/config/line";
import { scrollState } from "@/lib/scrollState";

/** Peak strength of the hall's bounce light. */
const PEAK = 1.15;

/**
 * The hall's ambient bounce: cool light from the white ceiling and walls above,
 * a dim grey from the floor below. Without it everything the overhead rows do
 * not hit directly (the undersides of a hoist, the flank of a cart, the car's
 * shadow side) falls to black, which is the single thing that most made the
 * first pass read as a game level and not a room.
 *
 * It is mounted for the whole page at intensity zero and only ramped up as the
 * plant comes on: adding or removing a light changes the light count, which
 * makes three recompile every material, a multi-second freeze on an integrated
 * GPU at exactly the moment the walkthrough begins.
 */
export function PlantFill() {
  const ref = useRef<THREE.HemisphereLight>(null);
  useFrame(() => {
    const light = ref.current;
    if (light) light.intensity = PEAK * smoothstep(0, 0.1, scrollState.factory);
  });
  return <hemisphereLight ref={ref} args={["#cdd6ee", "#4d5465", 0]} />;
}
