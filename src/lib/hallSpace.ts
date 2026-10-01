import * as THREE from "three";
import { TUNNEL_Z } from "@/config/line";
import { METER } from "@/config/worlds";
import { RIG, SECTION2 } from "@/lib/theme";

/**
 * Where the plant sits in the world.
 *
 * The hall is authored in metres in its own frame (+Z down the line). The
 * world mounts it under the same group the highway uses, which follows the
 * car's heading and is scaled by METER; the hall is offset so that hall z =
 * Z_REF (the finished car's place in the inspection tunnel) lands on the origin
 * that Sections 1-3 built their camera and car around. That is what lets
 * Section 4 begin exactly where Section 3's cabin ends.
 */
export const Z_REF = TUNNEL_Z;

/** World y of the hall floor: the tyres' contact plane, less the 1.6 cm the
 * car is raised to split its nose-up tilt. */
export const GROUND_Y = RIG.carGroundOffsetY - 0.016;

const cos = Math.cos(SECTION2.sideYaw);
const sin = Math.sin(SECTION2.sideYaw);

/** Hall (metres) -> world (scene units). */
export function hallToWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const lx = x * METER;
  const lz = (z - Z_REF) * METER;
  return out.set(SECTION2.stage2ShiftX + lx * cos + lz * sin, GROUND_Y + y * METER, -lx * sin + lz * cos);
}

/** A hall-frame displacement along the line, as the world-space offset it makes. */
export function lineDirection(out: THREE.Vector3): THREE.Vector3 {
  return out.set(sin, 0, cos);
}
