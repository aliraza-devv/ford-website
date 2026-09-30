"use client";

/* eslint-disable react-hooks/immutability --
 * useFrame runs outside React's render/commit cycle and is meant to mutate
 * this uniforms object every frame (same note as the retired Road.tsx). */

import { type RefObject, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ParallaxState } from "@/hooks/useParallax";
import { scrollState } from "@/lib/scrollState";
import { SKY_COLOR_GLSL, SKY_UNIFORMS } from "./skyGlsl";

// A directional dome, not a screen-space quad: the colour is a function of
// the view DIRECTION's elevation, so the horizon glow sits exactly on the
// real 3D horizon (it tracks camera pitch and FOV for free) and the wet
// road's mirror pass -- which renders this same mesh from a reflected
// camera -- sees the correctly reflected sky without any extra code.
//
// Vertex stage: the view matrix's translation is zeroed so the dome never
// parallaxes, and `.xyww` pins its depth to the far plane.
const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    mat4 rotationOnly = viewMatrix;
    rotationOnly[3] = vec4(0.0, 0.0, 0.0, 1.0);
    vec4 p = projectionMatrix * rotationOnly * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vDir;
  uniform float uTravel;
  uniform float uMouse;
  uniform float uDither;
  uniform float uClouds;

  ${SKY_COLOR_GLSL}

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }

  // Interleaved gradient noise (Jimenez): cheap, blue-ish, no visible tile.
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

  void main() {
    vec3 dir = normalize(vDir);
    float e = degrees(asin(clamp(dir.y, -1.0, 1.0)));
    vec3 c = skyColor(e);

    // Very faint cloud layer: 4% blend, drifting at a tenth of the road's
    // speed, fading out toward the horizon so it never touches the seam.
    if (uClouds > 0.5) {
      vec2 cuv = dir.xz / (abs(dir.y) + 0.25) * 1.6 + vec2(uMouse, uTravel * 0.1 * 0.012);
      float cloud = smoothstep(0.35, 0.75, fbm(cuv)) * smoothstep(0.02, 0.3, dir.y);
      c = mix(c, c * 3.0 + vec3(0.008, 0.016, 0.04), 0.04 * cloud);
    }

    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Only the no-composer path dithers here; with post-processing the
    // final DitherEffect does it in display space for the whole frame.
    gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5) * (2.0 / 255.0) * uDither;
  }
`;

type SkyDomeProps = {
  parallaxRef: RefObject<ParallaxState>;
  /** True when no EffectComposer follows (mobile / low tier). */
  dither: boolean;
  /** The 4% cloud layer is four octaves of noise over half the screen: not
   * worth it on the lightest tier. */
  clouds: boolean;
};

export function SkyDome({ parallaxRef, dither, clouds }: SkyDomeProps) {
  const uniforms = useMemo(
    () => ({
      ...SKY_UNIFORMS,
      uTravel: { value: 0 },
      uMouse: { value: 0 },
      uDither: { value: 0 },
      uClouds: { value: 1 },
    }),
    [],
  );

  useFrame(() => {
    uniforms.uTravel.value = scrollState.travel;
    // Sky parallax strength 0.1x, per the brief; it only has a horizontal
    // component to show, since the gradient itself is vertical.
    uniforms.uMouse.value = parallaxRef.current.x * 0.1 * 0.6;
    uniforms.uDither.value = dither ? 1 : 0;
    uniforms.uClouds.value = clouds ? 1 : 0;
  });

  return (
    <mesh renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[1, 48, 24]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
        depthWrite={false}
        depthTest={false}
        fog={false}
      />
    </mesh>
  );
}
