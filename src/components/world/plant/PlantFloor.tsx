"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { GATE_Z, HALL, PITCH, STATION_COUNT, TUNNEL_Z, stationZ } from "@/config/line";
import type { Tier } from "@/lib/perfTier";
import { ROAD_VERTEX, roadShared } from "../roadShader";
import { HALL_LIGHT_GLSL, hallLight } from "./hallLight";

/** Floor plane, in hall coordinates. Its local +Y runs toward -Z once laid
 * flat, so a fragment's hall z is `FLOOR_CENTER_Z - vLocal.y`. */
export const FLOOR_LENGTH = HALL.zMax - HALL.zMin + 24;
export const FLOOR_CENTER_Z = (HALL.zMin + HALL.zMax) / 2;

/** Shared by every plant-floor material and updated once a frame by Plant. */
export const plantFloor = {
  /** World -> hall rotation, so the shader can take a view ray into the hall's
   * own frame and ask where it would meet the ceiling. */
  uWorldToHall: { value: new THREE.Matrix3() },
  /** Radius (m) around the tunnel inside which the overhead lights are on
   * (shared with the rest of the hall's lighting, see hallLight.ts). */
  uIgnite: hallLight.uIgnite,
  /** 0-1 brightness of the exit gate. */
  uGate: { value: 0 },
  /** Pitches the skillet has indexed: the belt's slats ride this. */
  uIndex: { value: 0 },
  uStationZ: { value: Array.from({ length: STATION_COUNT }, (_, i) => stationZ(i + 1)) },
  uRowX: hallLight.uRowX,
  uSky: hallLight.uSky,
  uGround: hallLight.uGround,
  uGain: hallLight.uGain,
  uReflect: { value: 1.0 },
};

/**
 * The floor is polished epoxy, and what a polished floor does is mirror the
 * lights above it into long streaks. On the lightest tier that is done
 * ANALYTICALLY: the view ray is reflected, followed up to the plane the light
 * rows hang in (and the tunnel's ceiling), and the same pattern the hall draws
 * is evaluated where it lands. No second render of the scene; the streaks stay
 * crisp up close and smear with distance and roughness, as a real floor's do.
 *
 * Medium and high tiers add the planar reflection of the actual scene (the car,
 * the gantries) the way the wet road does, and drop the analytic term, since
 * the reflected scene already contains the lights.
 *
 * Down the middle runs the skillet: a belt of steel slats that moves with the
 * cars, so that during an index step the car and the floor under it slide
 * together past a floor that stays put. It is the single detail that most
 * says "this is a line".
 */
const FLOOR_FRAGMENT = (reflective: boolean) => /* glsl */ `
  ${reflective ? "#define USE_REFLECTION" : ""}
  uniform sampler2D tDiffuse;
  uniform mat3 uWorldToHall;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uFarFade;
  uniform float uGate;
  uniform float uIndex;
  uniform float uStationZ[${STATION_COUNT}];
  uniform float uReflect;
  ${HALL_LIGHT_GLSL}

  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vViewPos;
  varying vec2 vUv;
  varying vec4 vReflUv;

  const float FIX_Y = ${HALL.fixtureY.toFixed(2)};
  const float T = ${TUNNEL_Z.toFixed(1)};
  const float GATE_Z = ${GATE_Z.toFixed(1)};
  const float PITCH = ${PITCH.toFixed(1)};
  const vec3 COOL = vec3(0.86, 0.91, 1.0);

  float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vn(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
      mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  // 1 where the overhead lights are on.
  float lit(float z) { return hallLit(z); }
  float band(float v, float c, float w, float soft) {
    return 1.0 - smoothstep(w - soft, w + soft, abs(v - c));
  }
  // The fixture battens: 1.4 m lit, every 2 m.
  float batten(float z, float soft) {
    float c = abs(mod(z, ${(2.0).toFixed(1)}) - 1.0);
    return 1.0 - smoothstep(0.7 - soft, 0.7 + soft, c);
  }
  float fixtureRows(vec2 q, float soft) {
    float m = 0.0;
    for (int i = 0; i < ${HALL.rowX.length}; i++) m += band(q.x, uRowX[i], 0.14, soft);
    return m * lit(q.y) * batten(q.y, soft);
  }
  // The tunnel's ceiling bars: a bar every 1.4 m across its width.
  float tunnelCeiling(vec2 q, float soft) {
    float inside = band(q.x, 0.0, 3.45, soft) * (1.0 - smoothstep(7.0 - 0.01, 7.0 + 0.5, abs(q.y - T)));
    float c = abs(mod(q.y - (T - 7.0), 1.4) - 0.7);
    return inside * (1.0 - smoothstep(0.045 - soft * 0.4, 0.045 + soft * 0.4, c)) * lit(q.y);
  }

  float fresnel(float c, float f0) { return f0 + (1.0 - f0) * pow(1.0 - c, 5.0); }

  vec3 applyFog(vec3 col, float dist) {
    float k = uFogDensity * dist;
    float fog = 1.0 - exp(-k * k);
    fog = max(fog, smoothstep(uFarFade * 0.78, uFarFade * 0.97, dist));
    return mix(col, uFogColor, fog);
  }

  void main() {
    vec3 Vw = normalize(cameraPosition - vWorld);
    vec3 Vh = normalize(uWorldToHall * Vw);
    float NoV = max(Vh.y, 0.03);
    vec2 P = vec2(vLocal.x, ${FLOOR_CENTER_Z.toFixed(2)} - vLocal.y);
    float dist = length(vViewPos);

    // ---- the surface: light grey epoxy, patchy sheen, wear, expansion joints
    // on the 16 m grid
    float n1 = vn(P * 0.22);
    float n2 = vn(P * 1.3 + 7.0);
    float n3 = vn(P * 7.0);
    float rough = clamp(0.2 + 0.26 * n1 + 0.12 * n2, 0.1, 0.6);
    vec2 g = abs(fract(P / 8.0) - 0.5) * 8.0;
    float joint = smoothstep(3.97, 4.0, max(g.x, g.y)) * (1.0 - smoothstep(30.0, 90.0, dist));
    vec3 albedo = vec3(0.14, 0.15, 0.17) * (0.8 + 0.32 * n1 + 0.1 * n3);
    albedo *= 1.0 - 0.4 * joint;

    // ---- paint goes into the albedo, so it is lit the way the floor is: lane
    // lines, the stop bars at each station, the cart bays, the belt's hazard edge
    vec3 yellow = vec3(0.62, 0.43, 0.02);
    vec3 white = vec3(0.6, 0.62, 0.68);
    float lane = band(abs(P.x), 5.6, 0.06, 0.02);
    float stop = 0.0;
    for (int i = 0; i < ${STATION_COUNT}; i++) {
      stop += band(P.y, uStationZ[i] - 6.5, 0.07, 0.02) + band(P.y, uStationZ[i] + 6.5, 0.07, 0.02);
    }
    stop *= 1.0 - smoothstep(6.5, 7.0, abs(P.x));
    float bay = 0.0;
    for (int i = 0; i < ${STATION_COUNT}; i++) {
      bay += band(P.y, uStationZ[i], 3.6, 0.03) * (1.0 - band(P.y, uStationZ[i], 3.5, 0.03));
    }
    bay *= step(8.2, abs(P.x)) * (1.0 - step(11.0, abs(P.x)));
    float edge = band(abs(P.x), 1.5, 0.05, 0.015) * step(-12.0, P.y);
    // A pedestrian walkway down each side of the bay, in green.
    float walk = band(abs(P.x), 15.2, 0.07, 0.02) + band(abs(P.x), 17.0, 0.07, 0.02);
    albedo = mix(albedo, white, clamp(lane + stop, 0.0, 1.0) * 0.85);
    albedo = mix(albedo, yellow, clamp(bay + edge, 0.0, 1.0) * 0.9);
    albedo = mix(albedo, vec3(0.04, 0.3, 0.12), clamp(walk, 0.0, 1.0) * 0.8);

    // ---- the skillet belt: slats that ride with the cars
    float inBelt = step(abs(P.x), 1.38) * step(-12.0, P.y) * (1.0 - step(T + 9.0, P.y));
    if (inBelt > 0.5) {
      float s = fract((P.y - uIndex * PITCH) / 0.55);
      float slat = smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(0.94, 1.0, s));
      albedo = mix(vec3(0.012, 0.013, 0.016), vec3(0.2, 0.21, 0.24), slat);
      albedo = mix(albedo, yellow, edge * 0.9);
      rough = mix(0.5, 0.28, slat);
    }

    // ---- what the hall's lights do to the floor: the rows, the bounce, and the
    // work lights over each station, the tunnel and the gate
    float L = lit(P.y);
    vec3 irr = hallLight(vec3(P.x, 0.0, P.y), vec3(0.0, 1.0, 0.0));
    float pool = exp(-pow(P.x / 11.0, 2.0));
    float stationPool = 0.0;
    for (int i = 0; i < ${STATION_COUNT}; i++) {
      float d = (P.y - uStationZ[i]) / 5.5;
      stationPool += exp(-d * d);
    }
    irr += vec3(0.94, 0.97, 1.0) * stationPool * pool * 0.8 * L;
    float inT = (1.0 - smoothstep(6.4, 8.4, abs(P.y - T))) * band(P.x, 0.0, 3.6, 0.5);
    irr += vec3(0.9, 0.95, 1.0) * inT * 1.0 * lit(T);
    irr += vec3(0.55, 0.7, 1.0) * uGate * exp(-pow((P.y - GATE_Z) / 16.0, 2.0)) * exp(-pow(P.x / 10.0, 2.0)) * 1.0;

    vec3 col = albedo * irr;

    // ---- reflection
    vec3 Rh = vec3(-Vh.x, Vh.y, -Vh.z);
    vec3 refl = vec3(0.0);
    #ifdef USE_REFLECTION
      vec2 ruv = vReflUv.xy / vReflUv.w;
      float lod = rough * 4.0;
      float smear = 0.003 + 0.02 * rough;
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int k = -2; k <= 2; k++) {
        float w = 1.0 - abs(float(k)) * 0.25;
        acc += textureLod(tDiffuse, ruv + vec2(0.0, float(k) * smear), lod).rgb * w;
        wsum += w;
      }
      refl = acc / wsum;
    #else
      float ry = max(Rh.y, 0.03);
      float t = FIX_Y / ry;
      float soft = 0.07 + t * rough * 0.06;
      refl += COOL * fixtureRows(P + Rh.xz * t, soft) * 5.5;

      float t2 = 4.38 / ry;
      float soft2 = 0.05 + t2 * rough * 0.05;
      refl += COOL * tunnelCeiling(P + Rh.xz * t2, soft2) * 5.0;

      // The exit gate: a lit rectangle standing across the far end of the line.
      float t3 = (GATE_Z - P.y) / max(Rh.z, 0.02);
      float hitY = Rh.y * t3;
      float gate = (1.0 - smoothstep(8.2, 9.4, abs(P.x + Rh.x * t3))) * smoothstep(-0.5, 0.5, hitY) * (1.0 - smoothstep(8.0, 9.0, hitY));
      refl += vec3(0.55, 0.7, 1.0) * gate * step(0.0, Rh.z) * uGate * 3.2;
    #endif
    col += refl * fresnel(NoV, 0.05) * (1.0 - 0.7 * rough) * uReflect;

    col = applyFog(col, dist);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The plant floor, in the hall's own frame (mount it inside the hall group). */
export function PlantFloor({ tier }: { tier: Tier }) {
  const object = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(HALL.halfWidth * 2, FLOOR_LENGTH);
    const shared = {
      uFogColor: roadShared.uFogColor,
      uFogDensity: roadShared.uFogDensity,
      uFarFade: roadShared.uFarFade,
      ...plantFloor,
    };

    if (tier === "low") {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...shared, textureMatrix: { value: new THREE.Matrix4() }, tDiffuse: { value: null } },
        vertexShader: ROAD_VERTEX,
        fragmentShader: FLOOR_FRAGMENT(false),
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0, FLOOR_CENTER_Z);
      return mesh;
    }

    const [textureWidth, textureHeight] = tier === "high" ? [1024, 576] : [512, 288];
    const reflector = new Reflector(geometry, {
      textureWidth,
      textureHeight,
      clipBias: 0.003,
      multisample: 0,
      shader: {
        name: "PlantFloorReflector",
        uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
        vertexShader: ROAD_VERTEX,
        fragmentShader: FLOOR_FRAGMENT(true),
      },
    });
    const target = reflector.getRenderTarget();
    target.texture.generateMipmaps = true;
    target.texture.minFilter = THREE.LinearMipmapLinearFilter;
    // Reflector clones the shader's uniforms; point its clone back at the
    // shared objects so the once-per-frame updates reach it.
    Object.assign((reflector.material as THREE.ShaderMaterial).uniforms, shared);
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(0, 0, FLOOR_CENTER_Z);
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
