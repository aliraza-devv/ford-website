"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { FORD_COLORS, PAINT_SHADER } from "@/lib/theme";

/**
 * A real MeshPhysicalMaterial patched via onBeforeCompile -- NOT a flat
 * unlit shader swap. Clearcoat, metalness/roughness and all of three's
 * standard PBR lighting run exactly as they would on the stock material;
 * the patch only overrides the base albedo color (right after the chunk
 * that would normally read material.color/map) with a noise-distorted
 * radial blob mask blended between uColorA (the current paint) and
 * uColorB (the hover preview colour), plus a thin Grabber Fresnel rim that
 * brightens while the blob is active.
 *
 * The mask follows the cursor: hover lerps uBlobUv toward it every frame
 * (see useFrame in the consumer, MustangModel) and the radius eases in and
 * out on enter/leave.
 */
export type LiquidPaintUniforms = {
  uColorA: { value: THREE.Color };
  uColorB: { value: THREE.Color };
  uBlobUv: { value: THREE.Vector2 };
  uBlobRadius: { value: number };
  uNoiseScale: { value: number };
  uTime: { value: number };
};

export function useLiquidPaintMaterial() {
  const uniformsRef = useRef<LiquidPaintUniforms>({
    uColorA: { value: new THREE.Color(FORD_COLORS.blue) },
    uColorB: { value: new THREE.Color(FORD_COLORS.grabber) },
    uBlobUv: { value: new THREE.Vector2(0.5, 0.5) },
    uBlobRadius: { value: 0 },
    uNoiseScale: { value: PAINT_SHADER.noiseScale },
    uTime: { value: 0 },
  });

  const material = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: FORD_COLORS.blue,
      // FIX 7: bumped up from 0.6/0.35/0.12 -- automotive clearcoat paint
      // needs to be considerably more reflective/glossy than that to catch
      // visible highlights instead of reading as a flat color fill.
      metalness: 0.9,
      roughness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.5,
    });

    mat.onBeforeCompile = (shader) => {
      const u = uniformsRef.current;
      Object.assign(shader.uniforms, u);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          uniform vec2 uBlobUv;
          uniform float uBlobRadius;
          uniform float uNoiseScale;
          uniform float uTime;

          // Cheap 2D hash + value noise, layered into fbm. This doesn't need
          // to be photoreal -- just enough irregularity that the blob edge
          // reads as fluid instead of a clean vector circle.
          float paintHash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }
          float paintNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = paintHash(i);
            float b = paintHash(i + vec2(1.0, 0.0));
            float c = paintHash(i + vec2(0.0, 1.0));
            float d = paintHash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
          }
          float paintFbm(vec2 p) {
            float sum = 0.0;
            float amp = 0.5;
            for (int i = 0; i < 4; i++) {
              sum += amp * paintNoise(p);
              p *= 2.02;
              amp *= 0.5;
            }
            return sum;
          }`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          {
            float n = paintFbm(vUv * uNoiseScale + uTime * 0.06) - 0.5;
            float dist = distance(vUv, uBlobUv) + n * 0.22;
            float edge = 1.0 - smoothstep(uBlobRadius - 0.16, uBlobRadius, dist);
            diffuseColor.rgb = mix(uColorA, uColorB, clamp(edge, 0.0, 1.0));
          }`,
        )
        .replace(
          "#include <opaque_fragment>",
          `{
            // Fresnel strength scales with the blob's own radius (this was
            // previously driven by a uFresnelStrength uniform that was
            // declared in GLSL but never registered in JS, so it silently
            // read 0 always -- the rim never actually rendered) -- a
            // faint base amount always, boosted while the blob is active.
            float rim = 1.0 - max(dot(normalize(vViewPosition), normal), 0.0);
            float fresnelStrength = 0.05 + clamp(uBlobRadius, 0.0, 1.0) * 0.35;
            rim = pow(rim, 2.5) * fresnelStrength;
            outgoingLight += vec3(0.09, 0.0, 0.96) * rim;
          }
          #include <opaque_fragment>`,
        );

      // This material has no texture maps, so three's built-in vUv varying
      // (declared only when USE_UV/USE_MAP are defined) never gets emitted.
      // Declare our own and populate it from the raw uv attribute instead.
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>\nvarying vec2 vUv;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>\nvUv = uv;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <clipping_planes_pars_fragment>",
        `#include <clipping_planes_pars_fragment>\nvarying vec2 vUv;`,
      );
    };

    return mat;
  }, []);

  return { material, uniforms: uniformsRef };
}
