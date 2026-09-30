import { SECTION2 } from "@/lib/theme";

/**
 * The car's heading and sideways shift as a function of the 0-2 scroll stage.
 *
 * One function, two readers: InteractionSystem applies it to the car, and the
 * 3D world applies it to its own root group, so the road, markings and
 * barrier always run along the car's heading instead of the car turning
 * against a fixed road. Stage 1 -> 2 is the only place either changes; both
 * hold their Stage 2 values for the whole of Stage 3.
 */
export function getCarPose(stage: number): { yaw: number; shiftX: number } {
  const p = Math.min(Math.max(stage, 0), 1);
  return { yaw: SECTION2.sideYaw * p, shiftX: SECTION2.stage2ShiftX * p };
}
