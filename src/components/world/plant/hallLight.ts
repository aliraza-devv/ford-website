import * as THREE from "three";
import { TUNNEL_Z, HALL } from "@/config/line";

/**
 * How the hall is lit, as one function every surface in it shares.
 *
 * The hall is made of a few thousand instanced boxes, and lighting those with
 * scene lights would be the most expensive thing in it (and adding a light would
 * recompile every material the page has). So the light is evaluated analytically
 * instead, from what actually lights a plant: long rows of LED battens hung
 * high, running the whole length of the hall. For a surface at P with normal N
 * each row is a line source, and a line source falls off as 1/distance (not
 * 1/distance squared), which is why a hall lit this way is lit EVENLY near the
 * rows and fades gently away from them. On top of that go the two things that
 * make a room read as a room and not a set: a bounce term (the floor and white
 * ceiling light everything softly from below and above) and occlusion (the
 * corners and the foot of every column are darker than the middle of a wall).
 *
 * The rows come on from the tunnel outward (uIgnite), so a surface's light is
 * also what makes the hall wake up.
 */
export const hallLight = {
  /** World -> the hall's own frame, updated once a frame by Plant. */
  uHallFromWorld: { value: new THREE.Matrix4() },
  /** Radius (m) around the tunnel inside which the overhead lights are on. */
  uIgnite: { value: 0 },
  uRowX: { value: [...HALL.rowX] as number[] },
  /** Bounce light from above and below (linear). */
  uSky: { value: new THREE.Color(0.11, 0.12, 0.14) },
  uGround: { value: new THREE.Color(0.055, 0.058, 0.066) },
  /** Strength of the rows. */
  uGain: { value: 0.85 },
};

/** The light function and the uniforms it reads. Included by the instanced
 * materials (patchHallLit) and by the floor's own shader. */
export const HALL_LIGHT_GLSL = /* glsl */ `
  uniform float uIgnite;
  uniform float uRowX[${HALL.rowX.length}];
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform float uGain;

  const float HL_T = ${TUNNEL_Z.toFixed(1)};
  const float HL_FIX_Y = ${HALL.fixtureY.toFixed(2)};

  // 1 where the overhead lights are on.
  float hallLit(float z) { return smoothstep(uIgnite, uIgnite - 24.0, abs(z - HL_T)); }

  // Irradiance on a surface at P with normal N, in the hall's frame (metres).
  vec3 hallLight(vec3 P, vec3 N) {
    float L = hallLit(P.z);

    // The rows: line sources along z at height HL_FIX_Y. Perpendicular
    // distance r in the x-y plane; falls off as 1 / (r + softening).
    float E = 0.0;
    for (int i = 0; i < ${HALL.rowX.length}; i++) {
      vec2 d = vec2(uRowX[i] - P.x, HL_FIX_Y - P.y);
      float r = length(d);
      vec2 u = d / max(r, 1e-3);
      // A surface facing along the row sees half the line, so z-facing
      // normals still catch some.
      float facing = max(dot(N.xy, u), 0.0) + 0.3 * abs(N.z);
      E += facing / (r + 2.5);
    }

    // Bounce: sky above, floor below, both stronger once the lights are on.
    vec3 bounce = mix(uGround, uSky, N.y * 0.5 + 0.5) * mix(0.3, 1.0, L);

    // Occlusion: the foot of everything, and the tops of the tall things
    // nearest the roof, are a little darker than the open middle.
    float ao = mix(0.45, 1.0, smoothstep(0.0, 2.6, P.y));

    return (bounce * ao + vec3(0.94, 0.97, 1.0) * E * 3.2 * uGain * L * mix(0.75, 1.0, ao)) + vec3(0.004);
  }
`;

/**
 * Makes an instanced (or ordinary) MeshBasicMaterial take the hall's light: its
 * colour is multiplied by hallLight() at the surface, so a column's lit side and
 * its shadow side, the top of a beam and its underside, the foot of a wall and
 * its upper part all read, with no scene light involved.
 */
export function patchHallLit<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, hallLight);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform mat4 uHallFromWorld;
        varying vec3 vHallPos;
        varying vec3 vHallN;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec4 hallW = vec4(transformed, 1.0);
          vec3 hallNrm = normal;
          #ifdef USE_INSTANCING
            mat3 hallIm = mat3(instanceMatrix);
            hallNrm = hallIm * (hallNrm / vec3(dot(hallIm[0], hallIm[0]), dot(hallIm[1], hallIm[1]), dot(hallIm[2], hallIm[2])));
            hallW = instanceMatrix * hallW;
          #endif
          vHallPos = (uHallFromWorld * (modelMatrix * hallW)).xyz;
          vHallN = mat3(uHallFromWorld) * (mat3(modelMatrix) * hallNrm);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vHallPos;
        varying vec3 vHallN;
        ${HALL_LIGHT_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb *= hallLight(vHallPos, normalize(vHallN));`,
      );
  };
  material.customProgramCacheKey = () => "hallLit-1";
  return material;
}
