import * as THREE from "three";
import { TUNNEL_Z, clamp01, smooth01, stationZ, type Vec3 } from "./line";

/**
 * The film: camera shots for Section 4, in HALL coordinates (metres, +Z down
 * the line), as a function of scroll.
 *
 * The first three shots run the interior camera's entry path backward (the
 * cabin eye, the window aperture, out beyond the door), so the cut from
 * Section 3 is the same move reversed and there is nothing to match. From there
 * the camera lingers on the finished car as it drives out through the
 * inspection tunnel, rises, turns upstream and flies the length of the line,
 * and settles at the first station to follow the build. Long lenses and slow
 * moves throughout: the point of view of someone filming a plant, not a game.
 */

export type Shot = {
  f: number;
  pos: Vec3;
  look: Vec3;
  fov: number;
  /** Horizontal framing shift, fraction of the viewport width, +right. Moves
   * the picture aside for the copy without moving the camera. */
  shift: number;
};

const T = TUNNEL_Z;
const S = stationZ;

export const SHOTS: Shot[] = [
  // Section 3's cabin eye, in metres in the finished car's frame (it stands in
  // the tunnel), then out through the window.
  { f: 0.0, pos: [0.324, 1.206, T - 0.162], look: [0.162, 0.987, T + 0.486], fov: 58, shift: 0 },
  { f: 0.012, pos: [1.027, 1.316, T], look: [0.432, 1.098, T + 0.973], fov: 54, shift: 0 },
  { f: 0.022, pos: [2.054, 1.37, T + 0.162], look: [0.324, 1.152, T + 1.189], fov: 48, shift: 0 },
  // The finished car pulls away down the tunnel; the camera stays and watches.
  { f: 0.042, pos: [3.9, 1.15, T + 1.2], look: [0.0, 1.0, T + 1.9], fov: 40, shift: 0 },
  { f: 0.066, pos: [4.6, 1.5, T - 3.0], look: [0, 1.1, T + 9.0], fov: 34, shift: 0 },
  // Up, round to face upstream, and over the line.
  { f: 0.086, pos: [4.5, 3.2, T - 7.0], look: [0, 1.3, T - 24.0], fov: 38, shift: 0 },
  { f: 0.106, pos: [4.8, 6.4, T - 30], look: [0, 1.6, T - 50], fov: 42, shift: 0 },
  { f: 0.13, pos: [6.0, 4.6, S(2) + 6], look: [0, 1.0, S(1) + 4], fov: 40, shift: 0 },
  // Down to the first station as the first car indexes into it.
  { f: 0.152, pos: [6.8, 2.5, S(1) + 10], look: [0, 1.1, S(1) + 1], fov: 36, shift: 0.08 },

  // Station 1: the engine.
  { f: 0.176, pos: [6.8, 1.7, S(1) + 7.4], look: [0, 1.2, S(1) + 1.5], fov: 34, shift: 0.1 },
  { f: 0.21, pos: [5.6, 2.2, S(1) + 5.6], look: [0, 1.8, S(1) + 1.5], fov: 34, shift: 0.1 },
  { f: 0.252, pos: [3.6, 1.5, S(1) + 6.6], look: [0, 1.0, S(1) + 1.5], fov: 34, shift: 0.1 },
  // Station 2: the body.
  { f: 0.292, pos: [8.2, 2.3, S(2) + 1.0], look: [0, 2.1, S(2)], fov: 34, shift: 0.1 },
  { f: 0.336, pos: [8.6, 2.5, S(2) - 1.5], look: [0, 1.8, S(2)], fov: 34, shift: 0.1 },
  { f: 0.378, pos: [6.4, 1.3, S(2) - 6.5], look: [0, 1.0, S(2)], fov: 34, shift: 0.1 },
  // Station 3: the doors.
  { f: 0.414, pos: [7.4, 1.6, S(3) + 6.8], look: [0, 1.0, S(3)], fov: 34, shift: 0.1 },
  { f: 0.456, pos: [6.0, 1.5, S(3) + 3.6], look: [0, 1.0, S(3)], fov: 34, shift: 0.1 },
  { f: 0.496, pos: [4.4, 1.2, S(3) - 5.2], look: [0, 1.0, S(3)], fov: 34, shift: 0.1 },
  // Station 4: hood and trunk.
  { f: 0.534, pos: [5.6, 2.9, S(4) + 6.4], look: [0, 1.1, S(4) + 1.4], fov: 34, shift: 0.1 },
  { f: 0.58, pos: [6.4, 2.5, S(4) - 6.2], look: [0, 1.2, S(4) - 1.4], fov: 34, shift: 0.1 },
  { f: 0.618, pos: [7.4, 1.6, S(4) + 0.6], look: [0, 1.1, S(4)], fov: 34, shift: 0.1 },
  // Station 5: bumpers and lights.
  { f: 0.656, pos: [6.6, 1.6, S(5) + 7.6], look: [0, 0.9, S(5) + 2.0], fov: 34, shift: 0.1 },
  { f: 0.7, pos: [6.9, 1.7, S(5) - 7.6], look: [0, 0.9, S(5) - 2.0], fov: 34, shift: 0.1 },
  { f: 0.738, pos: [7.4, 1.4, S(5)], look: [0, 1.0, S(5)], fov: 34, shift: 0.1 },
  // Into the tunnel, and out the far end to meet the camera.
  { f: 0.79, pos: [5.6, 1.6, T - 10], look: [0, 1.1, T], fov: 35, shift: 0.06 },
  { f: 0.86, pos: [4.2, 1.2, T + 17], look: [0, 1.1, T + 6], fov: 35, shift: 0.0 },
  { f: 0.93, pos: [2.6, 0.95, T + 26.5], look: [-0.2, 1.0, T + 19], fov: 35, shift: 0.1 },
  { f: 1.0, pos: [2.3, 0.95, T + 26.0], look: [-0.2, 1.0, T + 19], fov: 35, shift: 0.1 },
];

export type CameraSample = {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  shift: number;
};

let posCurve: THREE.CatmullRomCurve3 | null = null;
let lookCurve: THREE.CatmullRomCurve3 | null = null;

export function makeCameraSample(): CameraSample {
  return { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 35, shift: 0 };
}

/** Centripetal Catmull-Rom through the shots' positions (and, separately, their
 * aim points): the same curve type the interior fly-in uses, for the same
 * reason, since it cannot cusp or overshoot between waypoints. */
export function sampleCamera(f: number, out: CameraSample): CameraSample {
  if (!posCurve || !lookCurve) {
    posCurve = new THREE.CatmullRomCurve3(SHOTS.map((s) => new THREE.Vector3(...s.pos)), false, "centripetal");
    lookCurve = new THREE.CatmullRomCurve3(SHOTS.map((s) => new THREE.Vector3(...s.look)), false, "centripetal");
  }
  const n = SHOTS.length;
  const t = clamp01(f);
  let i = 0;
  while (i < n - 2 && t > SHOTS[i + 1].f) i++;
  const a = SHOTS[i];
  const b = SHOTS[i + 1];
  const local = clamp01((t - a.f) / (b.f - a.f));
  const u = (i + local) / (n - 1);
  posCurve.getPoint(u, out.pos);
  lookCurve.getPoint(u, out.look);
  const e = smooth01(local);
  out.fov = a.fov + (b.fov - a.fov) * e;
  out.shift = a.shift + (b.shift - a.shift) * e;
  return out;
}
