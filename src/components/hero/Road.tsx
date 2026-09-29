"use client";

/* eslint-disable react-hooks/immutability --
 * useFrame runs outside React's render/commit cycle and is meant to
 * mutate this uniforms object every frame; see the same note in the
 * (now-retired) ParticleNetwork.tsx from the first hero build. */

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LAYOUT } from "@/config/composition";
import { FORD_COLORS, ROAD } from "@/lib/theme";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Bypasses the camera/projection entirely -- a fullscreen quad in clip
    // space, so this always covers the canvas exactly regardless of aspect.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// FIX 6 rewrite (round 2): the plane's top edge faded to alpha 0 exactly
// at the horizon seam, while its color there darkened toward black instead
// of matching Sky's bright, fully-opaque bottom edge -- a hard brightness
// AND transparency discontinuity right at the seam, which is what read as
// "harsh, glitchy, undone". Now: fully opaque everywhere (no alpha fade at
// all -- it's a rectangular canvas already bounded by its container, so
// there's no shape-edge left to fade out), and the color blends UP INTO
// the exact same horizon-glow color Sky ends its own gradient on, so the
// seam is a continuation of one gradient rather than two independently-
// colored layers meeting. A subtle per-pixel dither fights banding, same
// idea as Sky's grain overlay.
const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uAsphalt;
  uniform vec3 uHorizonGlow;

  float dither(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv; // y=0 bottom/near, y=1 top -- vanishing point is always this container's own top edge
    float dist = 1.0 / max(1.0 - uv.y * 0.985, 0.02);
    float cx = 0.5;

    // Asphalt near the camera, blending up into Sky's own horizon-glow
    // color as uv.y -> 1 -- continues Sky's gradient instead of meeting it.
    float horizonMix = pow(smoothstep(0.0, 1.0, uv.y), 1.4);
    vec3 color = mix(uAsphalt, uHorizonGlow, horizonMix);

    // Decorations fade out toward the horizon too, so nothing sits as a
    // hard-edged overlay on top of the glow.
    float decorFade = 1.0 - horizonMix * 0.85;

    // Wet-tarmac sheen, reduced to ~0.25 strength per FIX 6.
    float sheen = exp(-pow((uv.x - cx) * 3.0, 2.0)) * 0.25 * decorFade;
    color += sheen * vec3(0.35, 0.45, 0.9);

    // Thin converging side lines (decoration only, not an alpha cutout).
    float roadHalf = 0.46 / dist;
    float edgeL = cx - roadHalf;
    float edgeR = cx + roadHalf;
    float sideW = 0.0045 / dist;
    float lineL = smoothstep(sideW, 0.0, abs(uv.x - edgeL));
    float lineR = smoothstep(sideW, 0.0, abs(uv.x - edgeR));
    color += (lineL + lineR) * 0.8 * decorFade;

    // Dashed center line animating toward the camera -- a fast-cruise
    // speed, not a race.
    float dashPos = fract(dist * 0.55 - uTime * 0.85);
    float dash = step(0.5, dashPos) * smoothstep(0.007, 0.0, abs(uv.x - cx));
    color += dash * 1.1 * decorFade;

    // Subtle dither to break up gradient banding (matches Sky's grain).
    color += (dither(uv * 900.0 + uTime * 0.01) - 0.5) * 0.015;

    // Fully opaque -- no alpha fade, so there's no transparency-based seam.
    gl_FragColor = vec4(color, 1.0);
  }
`;

function RoadPlane() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAsphalt: { value: new THREE.Color(FORD_COLORS.twilight) },
      // Same color Sky.tsx ends its own gradient on -- keeps the seam a
      // continuation of one gradient instead of two layers meeting.
      uHorizonGlow: { value: new THREE.Color(FORD_COLORS.blue) },
    }),
    [],
  );

  useFrame((_, delta) => {
    uniforms.uTime.value += delta * ROAD.laneSpeed * 2;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Layer 2, Step 4. Its own small WebGL canvas (a fullscreen-quad shader,
 * not real 3D geometry) so it never has to share camera/depth space with
 * the car's canvas above it. FIX 6: height is exactly `1 - LAYOUT.horizonY`
 * so it tiles precisely against Sky with no gap or overlap, and its
 * vanishing point is geometrically always this container's own top edge --
 * i.e. exactly the shared horizon line, not two independently-guessed
 * values that happened to almost match.
 */
export function Road() {
  return (
    <div
      className="hero-road pointer-events-none absolute inset-x-0 bottom-0 z-[5] overflow-hidden"
      style={{
        height: `${(1 - LAYOUT.horizonY) * 100}%`,
        transform:
          "translate3d(calc(var(--parallax-x, 0px) * 0.4), calc(var(--parallax-y, 0px) * 0.4), 0)",
      }}
    >
      <Canvas
        orthographic
        gl={{ alpha: true, antialias: false }}
        dpr={[1, 1.5]}
        style={{ background: "transparent" }}
      >
        <RoadPlane />
      </Canvas>
    </div>
  );
}
