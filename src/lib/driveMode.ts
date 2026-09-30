import { useSyncExternalStore } from "react";

/**
 * The GT500's drive modes, as the choice the hero's right-hand panel offers.
 * Picking one changes how fast the road runs past the car (and so the speed
 * readout), which is the part of a real mode change you can actually SEE from
 * outside. `speed` multiplies the world's resting flow speed.
 */
export type DriveMode = {
  id: "normal" | "sport" | "track" | "drag";
  label: string;
  /** One line on what the mode does on the car. */
  note: string;
  speed: number;
};

export const DRIVE_MODES: DriveMode[] = [
  { id: "normal", label: "Normal", note: "Balanced for everyday driving.", speed: 1 },
  { id: "sport", label: "Sport", note: "Sharper throttle and steering.", speed: 1.5 },
  { id: "track", label: "Track", note: "Firmer ride, traction control relaxed.", speed: 2.1 },
  { id: "drag", label: "Drag Strip", note: "Launch control armed.", speed: 2.8 },
];

let index = 0;
const listeners = new Set<() => void>();

export function getDriveMode(): DriveMode {
  return DRIVE_MODES[index];
}

export function setDriveMode(next: number) {
  if (next === index || next < 0 || next >= DRIVE_MODES.length) return;
  index = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useDriveMode(): DriveMode {
  return useSyncExternalStore(subscribe, getDriveMode, () => DRIVE_MODES[0]);
}
