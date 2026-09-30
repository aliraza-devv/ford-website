"use client";

import { type ReactElement, type RefObject, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  Bloom,
  DepthOfField,
  EffectComposer,
  HueSaturation,
  Noise,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction, type BloomEffect, type DepthOfFieldEffect, ToneMappingMode } from "postprocessing";
import { WORLD_RUNTIME } from "@/config/worlds";
import type { Tier } from "@/lib/perfTier";
import { Dither, Exposure, type ExposureEffectImpl } from "@/components/world/effects";

type PostFXProps = {
  tier: Tier;
  carGroupRef: RefObject<THREE.Group | null>;
};

const carWorld = new THREE.Vector3();

/**
 * Dynamically imported by Scene.tsx (ssr: false, code-split) so the
 * postprocessing shader bundle doesn't block the initial hero paint, and
 * skipped entirely on mobile per the performance budget.
 *
 * Chain, in order: DepthOfField (high tier, highway only) -> Bloom ->
 * Exposure -> ACES tone mapping -> desaturation -> vignette -> film grain ->
 * display-space dither. There is deliberately NO chromatic aberration.
 *
 * Tone mapping lives here because EffectComposer renders to linear
 * float buffers and ignores the renderer's own toneMapping setting; before
 * this, desktop was showing untoned linear colour while mobile (which has no
 * composer) got ACES.
 */
export function PostFX({ tier, carGroupRef }: PostFXProps) {
  const exposure = useRef<ExposureEffectImpl>(null);
  const bloom = useRef<BloomEffect>(null);
  const dof = useRef<DepthOfFieldEffect>(null);
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    if (exposure.current) exposure.current.exposure = WORLD_RUNTIME.exposure;
    if (bloom.current) bloom.current.intensity = WORLD_RUNTIME.bloom;

    const effect = dof.current;
    if (effect) {
      // Focus on the car. Everything from the front splitter to the
      // headline stay sharp (blur ramps linearly with distance from the focus
      // plane over `worldFocusRange`, so it has to be wide); the lamps 30 m
      // and more down the road reach most of the blur and become soft discs.
      if (carGroupRef.current) {
        carGroupRef.current.getWorldPosition(carWorld);
        effect.circleOfConfusionMaterial.worldFocusDistance = camera.position.distanceTo(carWorld);
      }
      effect.bokehScale = 2.2 * WORLD_RUNTIME.dof;
    }
  });

  const effects: ReactElement[] = [];
  if (tier === "high") {
    effects.push(<DepthOfField key="dof" ref={dof} worldFocusRange={30} bokehScale={2.2} resolutionScale={0.5} />);
  }
  effects.push(
    <Bloom key="bloom" ref={bloom} intensity={0.35} luminanceThreshold={0.9} luminanceSmoothing={0.2} mipmapBlur />,
    <Exposure key="exposure" ref={exposure} />,
    <ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />,
    <HueSaturation key="sat" saturation={-0.1} />,
    <Vignette key="vignette" darkness={0.55} offset={0.3} />,
    <Noise key="noise" blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.04} />,
    <Dither key="dither" />,
  );

  return <EffectComposer multisampling={tier === "high" ? 4 : tier === "medium" ? 2 : 0}>{effects}</EffectComposer>;
}
