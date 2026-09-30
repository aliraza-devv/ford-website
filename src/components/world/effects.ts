import { BlendFunction, Effect } from "postprocessing";
import { Uniform } from "three";
import { wrapEffect } from "@react-three/postprocessing";

/**
 * Two small custom post effects.
 *
 * Why custom: the stock ToneMappingEffect has no exposure input (its ACES
 * mode is fixed), and the brief wants exposure per stage; and the stock
 * effects have no display-space dither, which is what actually removes
 * 8-bit banding in a dark gradient.
 */

const EXPOSURE_FRAGMENT = /* glsl */ `
  uniform float exposure;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
  }
`;

/** Scales linear HDR colour. Runs BEFORE ToneMapping, like a camera's exposure. */
class ExposureEffectImpl extends Effect {
  constructor() {
    super("ExposureEffect", EXPOSURE_FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([["exposure", new Uniform(1)]]),
    });
  }

  get exposure(): number {
    return this.uniforms.get("exposure")!.value as number;
  }

  set exposure(value: number) {
    this.uniforms.get("exposure")!.value = value;
  }
}

// The final encode to the screen converts linear -> sRGB AFTER every effect's
// mainImage runs, so a +-1/255 step in linear space is nowhere near +-1/255
// on screen (in the dark blues this scene is made of it is a fraction of one
// output step, and does nothing about banding). So: convert to sRGB here,
// add the noise in display space, and convert back; the final encode then
// lands the noise on exactly +-1/255 of output. Interleaved gradient noise
// keeps it structureless.
const DITHER_FRAGMENT = /* glsl */ `
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  vec3 toSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  vec3 toLinear(vec3 s) {
    return mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), step(0.04045, s));
  }
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 s = toSrgb(clamp(inputColor.rgb, 0.0, 1.0));
    s += (ign(gl_FragCoord.xy) - 0.5) * (2.0 / 255.0);
    outputColor = vec4(toLinear(clamp(s, 0.0, 1.0)), inputColor.a);
  }
`;

class DitherEffectImpl extends Effect {
  constructor() {
    super("DitherEffect", DITHER_FRAGMENT, { blendFunction: BlendFunction.NORMAL });
  }
}

export { ExposureEffectImpl };
export const Exposure = wrapEffect(ExposureEffectImpl);
export const Dither = wrapEffect(DitherEffectImpl);
