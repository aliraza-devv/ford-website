"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SECTION3 } from "@/lib/theme";

type InteriorLightsProps = {
  /** 0-1 Stage 3 progress (the camera's own fly-in progress, see
   * InteractionSystem's stage3P) -- read here directly rather than passed
   * as a re-rendering prop, since this ramps every frame while the camera
   * is moving in. */
  progressRef: React.RefObject<number>;
};

/**
 * A warm overhead cabin light, a low Grabber-blue footwell accent, and a
 * cooler passenger-side fill -- see SECTION3 in theme.ts for the tuning
 * and why this has to do real illumination work (none of this scene's
 * exterior-facing lighting reaches the cabin once the camera is inside
 * it). MustangModel keeps this mounted for the whole scroll with every light at
 * intensity 0 until Stage 3: adding or removing a light changes the light
 * count, which makes three recompile EVERY material -- a multi-second freeze
 * on an integrated GPU, at exactly the moment the camera enters the cabin.
 */
export function InteriorLights({ progressRef }: InteriorLightsProps) {
  const cabinRef = useRef<THREE.PointLight>(null);
  const fillRef = useRef<THREE.PointLight>(null);
  const footwellRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    // Cabin + fill ramp in with the camera's own approach -- the footwell
    // accent is a constant hint of brand color once mounted, not tied to
    // progress.
    const p = progressRef.current ?? 0;
    if (cabinRef.current) cabinRef.current.intensity = p * SECTION3.cabinLight.maxIntensity;
    if (fillRef.current) fillRef.current.intensity = p * SECTION3.fillLight.maxIntensity;
    if (footwellRef.current) footwellRef.current.intensity = p * SECTION3.footwellLight.maxIntensity;
  });

  return (
    <>
      <pointLight
        ref={cabinRef}
        color={SECTION3.cabinLight.color}
        position={SECTION3.cabinLight.position}
        intensity={0}
        distance={SECTION3.cabinLight.distance}
        decay={2}
      />
      <pointLight
        ref={footwellRef}
        color={SECTION3.footwellLight.color}
        position={SECTION3.footwellLight.position}
        intensity={0}
        distance={SECTION3.footwellLight.distance}
        decay={2}
      />
      <pointLight
        ref={fillRef}
        color={SECTION3.fillLight.color}
        position={SECTION3.fillLight.position}
        intensity={0}
        distance={SECTION3.fillLight.distance}
        decay={2}
      />
    </>
  );
}
