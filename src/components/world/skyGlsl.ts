import * as THREE from "three";
import { skyColorAt } from "@/config/worlds";

/**
 * The sky's colour table, baked once into a 1-D texture, plus the GLSL that
 * reads it. Shared by the sky dome (what you see) and the road shader (the
 * sky reflected in wet tarmac); the fog colour comes from the same table
 * through skyColorAt() in worlds.ts, which is what this texture is baked
 * from -- so the three cannot disagree.
 *
 * It used to be evaluated per pixel: a seven-stop loop of smoothsteps, run
 * for every sky pixel and again for every road pixel's reflection. On an
 * integrated GPU that was measurable; a texture fetch is not.
 *
 * The domain is elevation in degrees, [-10, 90], sampled every 0.1 degree:
 * fine enough that linear filtering reproduces the 2-degree horizon glow
 * exactly. Half-float because linear filtering of full float needs an
 * extension WebGL2 does not guarantee.
 */
export const SKY_LUT_MIN_DEG = -10;
export const SKY_LUT_RANGE_DEG = 100;
const SIZE = 1024;

function buildLut(): THREE.DataTexture {
  const data = new Uint16Array(SIZE * 4);
  const c = new THREE.Color();
  for (let i = 0; i < SIZE; i++) {
    skyColorAt(SKY_LUT_MIN_DEG + (i / (SIZE - 1)) * SKY_LUT_RANGE_DEG, c);
    data[i * 4] = THREE.DataUtils.toHalfFloat(c.r);
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(c.g);
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(c.b);
    data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const texture = new THREE.DataTexture(data, SIZE, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Module-level singleton: one texture, referenced by every material that
 * reads the sky. */
export const SKY_UNIFORMS = {
  tSkyLut: { value: buildLut() },
};

export const SKY_COLOR_GLSL = /* glsl */ `
  uniform sampler2D tSkyLut;

  vec3 skyColor(float e) {
    float u = clamp((e - (${SKY_LUT_MIN_DEG.toFixed(1)})) / ${SKY_LUT_RANGE_DEG.toFixed(1)}, 0.0, 1.0);
    return texture2D(tSkyLut, vec2(u, 0.5)).rgb;
  }
`;
