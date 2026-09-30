"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import type { Tier } from "@/lib/perfTier";
import { ROAD_VERTEX, roadFragment, roadShared } from "./roadShader";

export const GROUND_SIZE = 700;
export const GROUND_CENTER_Z = -150;

/**
 * The wet tarmac. Always drawn with the custom road shader (roadShader.ts);
 * what changes by tier is where its reflection comes from:
 *
 *  - low:    no planar reflection. The shader reflects the sky analytically
 *            (Fresnel-weighted, so the far road picks up the horizon glow)
 *            and the lamps still streak via their GGX highlights. Costs one
 *            pass and nothing else.
 *  - medium: a planar reflection of the scene (car, posts, lamps) at 512 x 288.
 *  - high:   the same at 1024 x 576.
 *
 * The reflection render target is mip-mapped and sampled by roughness, which
 * gives the blur for free -- cheaper than the separate blur passes a
 * general-purpose reflector needs.
 */
export function Ground({ tier }: { tier: Tier }) {
  const object = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);

    if (tier === "low") {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...roadShared, textureMatrix: { value: new THREE.Matrix4() }, tDiffuse: { value: null } },
        vertexShader: ROAD_VERTEX,
        fragmentShader: roadFragment(false),
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0, GROUND_CENTER_Z);
      return mesh;
    }

    const [textureWidth, textureHeight] = tier === "high" ? [1024, 576] : [512, 288];
    const reflector = new Reflector(geometry, {
      textureWidth,
      textureHeight,
      clipBias: 0.003,
      // No MSAA: the target is mip-mapped and blurred anyway, and a
      // multisampled target cannot be sampled with explicit LODs.
      multisample: 0,
      shader: {
        name: "RoadReflector",
        uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
        vertexShader: ROAD_VERTEX,
        fragmentShader: roadFragment(true),
      },
    });
    const target = reflector.getRenderTarget();
    target.texture.generateMipmaps = true;
    target.texture.minFilter = THREE.LinearMipmapLinearFilter;
    // Reflector clones the shader's uniforms; point its clone back at the
    // shared objects so the once-per-frame updates reach it.
    Object.assign((reflector.material as THREE.ShaderMaterial).uniforms, roadShared);
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(0, 0, GROUND_CENTER_Z);
    return reflector;
  }, [tier]);

  useEffect(
    () => () => {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
      if (object instanceof Reflector) object.dispose();
    },
    [object],
  );

  return <primitive object={object} />;
}
