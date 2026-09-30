import * as THREE from "three";
import { SKY_COLOR_GLSL, SKY_UNIFORMS } from "./skyGlsl";

/**
 * The road is lit by a hand-written shader instead of three's standard
 * material. That is a performance decision first: three evaluates EVERY
 * scene light for EVERY pixel of a standard material, and the road covers
 * half the screen, so a handful of spotlights on it cost more than the car.
 * Here the few lights that matter to a road (two headlights, a window of
 * lamp heads) are evaluated analytically, once each, and nothing else is.
 *
 * It is also what makes the road read as wet tarmac: Fresnel reflectance
 * (mirror-like at grazing angles, dark underfoot), GGX highlights from the
 * lamps that stretch into streaks, wheel ruts that hold water, and -- on the
 * tiers that have one -- the planar reflection of the car and lamp posts.
 */

export const ROAD_LIGHT_COUNT = 6; // 2 headlights + 4 lamp heads

const makeVec3s = () => Array.from({ length: ROAD_LIGHT_COUNT }, () => new THREE.Vector3());

/** Uniform objects shared by every road material (and cloned-over reflector
 * materials: see Ground.tsx). One set of numbers, updated once per frame. */
export const roadShared = {
  ...SKY_UNIFORMS,
  tRough: { value: null as THREE.Texture | null },
  uTravel: { value: 0 },
  uFogColor: { value: new THREE.Color() },
  uFogDensity: { value: 0.01 },
  uFarFade: { value: 320 },
  uAmbient: { value: new THREE.Color(0.004, 0.0075, 0.02) },
  // Overall strength of the wet-road reflection. Below 1 because the reflected
  // twilight sky is a saturated navy, and a full-strength mirror turns the
  // near road into a flat blue sheet; a wet road is mostly dark with
  // reflections picking out the lights.
  uReflect: { value: 0.7 },
  uLightPos: { value: makeVec3s() },
  uLightDir: { value: makeVec3s() },
  uLightColor: { value: makeVec3s() },
  uLightCone: { value: Array.from({ length: ROAD_LIGHT_COUNT }, () => new THREE.Vector2(0.9, 0.95)) },
};

export const ROAD_VERTEX = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vViewPos;
  varying vec2 vUv;
  varying vec4 vReflUv;

  void main() {
    vUv = uv;
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vViewPos = mv.xyz;
    vReflUv = textureMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const COMMON_FRAGMENT = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vViewPos;
  varying vec2 vUv;
  varying vec4 vReflUv;

  uniform float uTravel;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uFarFade;
  uniform vec3 uAmbient;
  uniform float uReflect;
  uniform vec3 uLightPos[${ROAD_LIGHT_COUNT}];
  uniform vec3 uLightDir[${ROAD_LIGHT_COUNT}];
  uniform vec3 uLightColor[${ROAD_LIGHT_COUNT}];
  uniform vec2 uLightCone[${ROAD_LIGHT_COUNT}];

  ${SKY_COLOR_GLSL}

  const float PI = 3.14159265;

  float fresnelSchlick(float c, float f0) { return f0 + (1.0 - f0) * pow(1.0 - c, 5.0); }

  float ggx(float NoH, float a) {
    float a2 = a * a;
    float d = NoH * NoH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d + 1e-5);
  }

  vec3 skyAlong(vec3 dir) {
    return skyColor(degrees(asin(clamp(dir.y, -1.0, 1.0))));
  }

  // Diffuse pools + GGX highlights from the headlights and lamp heads, for a
  // surface facing straight up (the road is flat). Diffuse is lit tarmac;
  // the specular lobe is what stretches a lamp into a long wet streak at
  // grazing view angles.
  vec3 roadLighting(vec3 P, vec3 V, vec3 albedo, float rough) {
    float alpha = max(rough * rough, 0.04);
    vec3 diffuse = vec3(0.0);
    vec3 spec = vec3(0.0);
    for (int i = 0; i < ${ROAD_LIGHT_COUNT}; i++) {
      vec3 L = uLightPos[i] - P;
      float d2 = max(dot(L, L), 0.05);
      vec3 l = L * inversesqrt(d2);
      float spot = smoothstep(uLightCone[i].x, uLightCone[i].y, dot(-l, uLightDir[i]));
      vec3 E = uLightColor[i] * (spot / d2);
      float NoL = max(l.y, 0.0);
      vec3 H = normalize(l + V);
      float NoH = max(H.y, 0.0);
      float VoH = max(dot(V, H), 0.05);
      float F = fresnelSchlick(VoH, 0.04);
      diffuse += E * NoL;
      spec += E * NoL * ggx(NoH, alpha) * F * (0.25 / max(VoH * VoH, 0.04)) * 0.02;
    }
    // A point light's GGX peak is unbounded; a real lamp head is an area
    // source whose reflection can't outshine its own luminance.
    return albedo * (diffuse / PI + uAmbient) + min(spec, vec3(8.0));
  }

  vec3 applyFog(vec3 col, float dist) {
    float k = uFogDensity * dist;
    float fog = 1.0 - exp(-k * k);
    // Whatever the exponential leaves, force the last stretch before the far
    // clip to pure fog colour -- otherwise the ground's cut edge shows as a
    // faint line against the sky just below the horizon.
    fog = max(fog, smoothstep(uFarFade * 0.78, uFarFade * 0.97, dist));
    return mix(col, uFogColor, fog);
  }
`;

export function roadFragment(reflective: boolean) {
  return /* glsl */ `
    ${reflective ? "#define USE_REFLECTION" : ""}
    uniform sampler2D tRough;
    uniform sampler2D tDiffuse;
    ${COMMON_FRAGMENT}

    void main() {
      vec3 P = vWorld;
      vec3 V = normalize(cameraPosition - P);
      float NoV = max(V.y, 0.03);

      float x = vLocal.x; // metres across the road
      float z = -vLocal.y; // metres along it
      vec2 ruv = vec2(x, z + uTravel) / 24.0;
      float rough = texture2D(tRough, ruv).g;

      // Wheel ruts (either side of each lane's centre, 1.8 m apart, across
      // the two lanes) hold standing water. One periodic term, not a loop.
      float rutD = abs(mod(x + 2.7 + 0.9, 1.8) - 0.9);
      float t = rutD / 0.3;
      float ruts = exp(-t * t) * step(abs(x), 3.4);
      rough = mix(rough, 0.1, ruts * 0.8);

      vec3 albedo = mix(vec3(0.020, 0.022, 0.030), vec3(0.036, 0.038, 0.048), smoothstep(0.25, 0.85, rough));
      albedo *= 1.0 - 0.3 * ruts;
      float wet = smoothstep(0.78, 0.22, rough);

      vec3 col = roadLighting(P, V, albedo, rough);

      vec3 refl;
      #ifdef USE_REFLECTION
        // The planar reflection is mip-blurred by roughness, then smeared
        // vertically in screen space: a wet road stretches reflected lights
        // along the view direction, which on screen is straight down.
        vec2 ruv2 = vReflUv.xy / vReflUv.w;
        float lod = rough * 4.5;
        float smear = 0.004 + 0.03 * rough;
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int k = -2; k <= 2; k++) {
          float w = 1.0 - abs(float(k)) * 0.25;
          acc += textureLod(tDiffuse, ruv2 + vec2(0.0, float(k) * smear), lod).rgb * w;
          wsum += w;
        }
        refl = acc / wsum;
      #else
        refl = skyAlong(reflect(-V, vec3(0.0, 1.0, 0.0)));
      #endif

      col += refl * fresnelSchlick(NoV, 0.03) * mix(0.1, 1.0, wet) * uReflect;

      col = applyFog(col, length(vViewPos));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
}

export const PAINT_FRAGMENT = /* glsl */ `
  uniform sampler2D tAlpha;
  uniform float uPaintOffset;
  uniform float uRepeatY;
  uniform float uFadeNear;
  uniform float uFadeFar;
  ${COMMON_FRAGMENT}

  void main() {
    vec2 auv = vec2(vUv.x, vUv.y * uRepeatY + uPaintOffset);
    float a = texture2D(tAlpha, auv).g;

    // "Fade line alpha to 0 within 4 m of the camera and beyond 120 m, so no
    // line ever runs into the bottom corners."
    float dist = length(vViewPos);
    a *= smoothstep(uFadeNear, uFadeNear * 2.5, dist) * (1.0 - smoothstep(uFadeFar * 0.65, uFadeFar, dist));
    if (a < 0.003) discard;

    vec3 P = vWorld;
    vec3 V = normalize(cameraPosition - P);
    // Worn thermoplastic: lit like a surface, never made brighter than its
    // albedo. It only brightens where a headlight or lamp actually reaches it.
    vec3 col = roadLighting(P, V, vec3(0.42, 0.44, 0.5), 0.55);
    col += skyAlong(reflect(-V, vec3(0.0, 1.0, 0.0))) * fresnelSchlick(max(V.y, 0.03), 0.03) * 0.5;

    col = applyFog(col, dist);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
