import { PART_BOUNDS } from "./partBounds";

/**
 * Section 4: the assembly line.
 *
 * The plant is not a set of effects; it is a small simulation of a real stop-
 * and-go assembly line, and every number below is a pure function of one scroll
 * value, `f` (0-1 over FACTORY_VH of scroll), so scrolling backward runs the
 * whole plant in reverse with nothing to fall out of step.
 *
 * How the line works (it is how real ones do):
 *
 *  - Cars sit on skillets, a moving floor, one PITCH apart. The skillet indexes:
 *    the whole line moves one pitch, stops, and every station works on the car in
 *    front of it at the same moment (a "hold"), then it indexes again.
 *  - A station is an overhead gantry. Parts wait on a cart beside it; the
 *    gantry's hoist picks the part, carries it across, lowers it onto the car,
 *    releases, and parks. Between holds a cart slides away and the next one,
 *    already loaded, slides in. Nothing hovers: everything is carried by
 *    something, and sits on something when it is not.
 *  - One car is the one we follow (B, the "hero"). It is the only one built from
 *    the full-detail model; the other cars on the line are lighter stand-ins that
 *    run the same operations in the same takt, so the plant looks and behaves
 *    like a plant wherever the camera points.
 *
 * Everything spatial is in METRES in the hall's own frame: +Z runs down the
 * line (the direction cars face), +X is the driver's side (the camera's side),
 * y is up from the floor.
 */

// ---------------------------------------------------------------- helpers

// The helpers live in lib/ease (shared with the sections that follow); they are
// re-exported here so every import of them from this file keeps working.
import { clamp01, win, smooth01, smoothstep, easeOutCubic, easeInCubic, easeInOutCubic, easeInOutSine, lerp } from "@/lib/ease";
export { clamp01, win, smooth01, smoothstep, easeOutCubic, easeInCubic, easeInOutCubic, easeInOutSine, lerp };

export type Vec3 = [number, number, number];

// ----------------------------------------------------------------- layout

/** Metres between stations, and between cars on the line. */
export const PITCH = 16;
/** Station 0 is the entry: the first car waits here. Stations 1-5 do work. */
export const S0 = 8;
export const STATION_COUNT = 5;
export const stationZ = (k: number) => S0 + PITCH * k;
/** The inspection tunnel is where the line ends (station 6). */
export const TUNNEL_Z = stationZ(6);
export const GATE_Z = TUNNEL_Z + 34;

export const HALL = {
  zMin: -64,
  zMax: GATE_Z + 14,
  /** Floor half-width. */
  halfWidth: 24,
  /** Linear light fixtures hang here. */
  fixtureY: 11.6,
  /** Hall x of the fixture rows. */
  rowX: [-16, -10, -4.2, 4.2, 10, 16] as const,
  /** Gantry beams run across the hall at this height. */
  beamY: 8.6,
  gantryLegX: 12.2,
  roofY: 14.4,
};

// ------------------------------------------------------------------ takt

/** Where the first hold begins, how long a hold and an index step last. All in
 * scroll progress.
 *
 * A step moves every car on the line one pitch (16 m). It used to take a fifth of a hold, a
 * tenth of a screen of scroll: one wheel notch threw the whole line across the frame, at a peak of
 * over 500 m per screen. Now it takes about a quarter of a screen and eases with a sine, which
 * puts the peak under 110 m per screen (see FACTORY_VH: the film is longer, so the holds
 * themselves keep the pace they had). A hold and a step still add up to 0.12. */
export const T0 = 0.04;
export const HOLD = 0.078;
export const STEP = 0.042;
/** Cycle 0 is the intro hold (the flythrough); cycles 1-5 are the stations B
 * works at. */
export const CYCLES = 6;
export const cycleStart = (c: number) => T0 + (HOLD + STEP) * c;
export const holdStart = cycleStart;
export const holdEnd = (c: number) => cycleStart(c) + HOLD;
export const stepEnd = (c: number) => cycleStart(c) + HOLD + STEP;
/** After this, B is in the tunnel and the line is done. */
export const LINE_END = stepEnd(CYCLES - 1);

/** How many pitches the line has indexed (0-6, smooth through each step). */
export function indexPos(f: number): number {
  let p = 0;
  for (let c = 0; c < CYCLES; c++) p += easeInOutSine(win(f, holdEnd(c), stepEnd(c)));
  return p;
}

/** Holds finished so far. Switches on the frame a hold ends. */
export function holdsCompleted(f: number): number {
  let n = 0;
  for (let c = 0; c < CYCLES; c++) if (f >= holdEnd(c) - 1e-9) n++;
  return n;
}

/** The cycle we are in or have just left: -1 before the first hold. */
export function currentCycle(f: number): number {
  if (f < T0) return -1;
  return Math.min(CYCLES - 1, Math.floor((f - T0) / (HOLD + STEP)));
}

/** Progress through the hold of the current cycle (0 before it, 1 after). */
export function holdU(f: number): number {
  const c = currentCycle(f);
  if (c < 0) return 0;
  return clamp01((f - holdStart(c)) / HOLD);
}

/** Progress through the index step that follows the current hold. */
export function stepS(f: number): number {
  const c = currentCycle(f);
  if (c < 0) return 0;
  return clamp01((f - holdEnd(c)) / STEP);
}

/** True while the skillet is moving. */
export function indexing(f: number): boolean {
  const c = currentCycle(f);
  return c >= 0 && f > holdEnd(c) && f < stepEnd(c);
}

// ------------------------------------------------------------------ cars

/** How a finished car leaves: after the index that carries it out of the
 * tunnel it drives itself, from rest, the length of the hall and out of the gate. (A
 * longer stretch of scroll, for a shorter run: a car that gets away at 500 m per screen is
 * a streak, not a car.) */
export const EXIT_DRIVE = { length: 0.12, distance: 46 };

/**
 * Car n on the line, relative to B (n = 0): n > 0 is ahead of B, n < 0 behind.
 * Its z at scroll `f`. (A, the finished car we leave in Section 3's cabin, is
 * n = 6 at the start and is handled separately.)
 *
 * A car ahead of B reaches the inspection tunnel (station 6) in hold 6 - n.
 * The index after that hold carries it one more pitch, out of the tunnel, with
 * the skillet; from there it drives off on its own, so it is clear of the
 * tunnel long before the car behind it needs the space.
 */
export function lineCarZ(n: number, f: number): number {
  const onSkillet = S0 + PITCH * (n + indexPos(f));
  if (n < 1) return onSkillet;
  const out = stepEnd(6 - n);
  if (f <= out) return onSkillet;
  const t = win(f, out, out + EXIT_DRIVE.length);
  return stationZ(7) + EXIT_DRIVE.distance * t * t;
}

/** Rolls B out of the tunnel and on, for the closing shot. */
export const B_ROLL = { from: 0.8, to: 0.93, length: 19 };

export function rollOut(f: number): number {
  return B_ROLL.length * easeInOutCubic(win(f, B_ROLL.from, B_ROLL.to));
}

export function zB(f: number): number {
  return lineCarZ(0, f) + rollOut(f);
}

/** The finished car (A) the camera leaves: still in the tunnel, then it drives
 * out through the gate. */
export const A_DRIVE = { from: 0.028, to: 0.15, distance: 52 };

export function zA(f: number): number {
  const t = win(f, A_DRIVE.from, A_DRIVE.to);
  return TUNNEL_Z + A_DRIVE.distance * (t * t);
}

/** The state of a car on the line: how many of the five operations have been
 * completed on it. (State 0 is a rolling chassis; 5 is a finished car.) */
export function opsDone(n: number, f: number): number {
  return Math.min(5, Math.max(0, holdsCompleted(f) + n - 1));
}

// --------------------------------------------------------------- actors

export type ActorId = "engine" | "tub" | "doorL" | "doorR" | "hood" | "trunk" | "front" | "rear";

export type RigKind = "engine" | "carrier" | "door" | "panel" | "fascia";

/** Phase windows of one operation, as fractions of a hold. */
export type Timing = {
  approach: [number, number];
  hookOn: [number, number];
  lift: [number, number];
  carry: [number, number];
  lower: [number, number];
  release: [number, number];
  park: [number, number];
};

export const DEFAULT_TIMING: Timing = {
  approach: [0.0, 0.12],
  hookOn: [0.12, 0.2],
  lift: [0.2, 0.34],
  carry: [0.34, 0.6],
  lower: [0.6, 0.88],
  release: [0.88, 0.95],
  park: [0.95, 1.0],
};

/** The body is the main event: a longer, gentler carry, and it lands early so
 * the fastening robots have the rest of the hold. */
export const BODY_TIMING: Timing = {
  approach: [0.0, 0.1],
  hookOn: [0.1, 0.18],
  lift: [0.18, 0.3],
  carry: [0.3, 0.48],
  lower: [0.48, 0.76],
  release: [0.76, 0.82],
  park: [0.82, 0.88],
};

export type Actor = {
  id: ActorId;
  /** The station (1-5) whose gantry carries this part. */
  station: 1 | 2 | 3 | 4 | 5;
  /** Matched against the NORMALISED node names of the model (three strips
   * `. [ ] : /` when it loads a glb). */
  match: RegExp;
  rig: RigKind;
  /** Hall x of the cart's centre. */
  cartX: number;
  /** Extra height above the installed pose that the part travels at. */
  clearance: number;
  timing: Timing;
  /** Installed bounding box in the car's frame, metres. */
  min: Vec3;
  max: Vec3;
  /** Derived. */
  center: Vec3;
  size: Vec3;
};

const BOUNDS = PART_BOUNDS;

function actor(
  id: ActorId,
  station: Actor["station"],
  match: RegExp,
  rig: RigKind,
  cartX: number,
  clearance: number,
  timing: Timing = DEFAULT_TIMING,
): Actor {
  const b = BOUNDS[id];
  const min = [...b.min] as Vec3;
  const max = [...b.max] as Vec3;
  return {
    id,
    station,
    match,
    rig,
    cartX,
    clearance,
    timing,
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

const CART_FAR = -9.6;
const CART_NEAR = 9.6;

// The matchers are the same ones scripts/gen-part-bounds.mjs sized the bounds
// from: keep them in step.
export const ACTORS: Actor[] = [
  actor("engine", 1, /^GT500(Engine_|Supercharger_|Strutbar_|Transmission_|Radiator_|RadiatorFan_)/, "engine", CART_FAR, 1.5),
  actor(
    "tub",
    2,
    /^GT500(Body_|Dash_|Sunvisor_|Seat|Steer_|Gauges_|Screen_|Shifter_|MirrorInt_|Stalk|Pedal|Rollcage_|Fender[LR]_|Windshield|Backlight|SideGlass[LR]_|Wipers)/,
    "carrier",
    CART_FAR,
    1.9,
    BODY_TIMING,
  ),
  actor("doorL", 3, /^GT500(DoorL_|DoorGlassL_|MirrorL_|BadgeL_)/, "door", CART_NEAR, 0.3),
  actor("doorR", 3, /^GT500(DoorR_|DoorGlassR_|MirrorR_|BadgeR_)/, "door", CART_FAR, 0.3),
  actor("hood", 4, /^GT500Hood_/, "panel", CART_FAR, 0.9),
  actor("trunk", 4, /^GT500(Trunk_|Wing_|BadgeRr_)/, "panel", CART_NEAR, 0.9),
  actor("front", 5, /^GT500(BumperFt_|Headlight[LR]_|HeadlightGlass[LR]_)/, "fascia", CART_NEAR, 0.7),
  actor("rear", 5, /^GT500(BumperRr_|Taillight[LR]_|TaillightGlass[LR]_)/, "fascia", CART_FAR, 0.7),
];

export const ACTOR_BY_ID = Object.fromEntries(ACTORS.map((a) => [a.id, a])) as Record<ActorId, Actor>;

/** Which actors are on a car in each state (cumulative). */
export const STATE_ACTORS: ActorId[][] = [
  [],
  ["engine"],
  ["engine", "tub"],
  ["engine", "tub", "doorL", "doorR"],
  ["engine", "tub", "doorL", "doorR", "hood", "trunk"],
  ["engine", "tub", "doorL", "doorR", "hood", "trunk", "front", "rear"],
];

// ----------------------------------------------------------- the carry path

/** Height of a cart's deck (the surface a part rests on). */
export const CART_DECK = 0.55;
/** A part rests this much above the deck (dunnage pads). */
const PAD = 0.08;
/** How far a cart slides away when it is not serving a hold. */
export const CART_AWAY = 30;

/** The hall z of an actor's gantry and cart: right over where the part goes. */
export function actorZ(a: Actor): number {
  return stationZ(a.station) + a.center[2];
}

/** Hall position of a part's CENTRE, staged on its cart. */
export function stagedCenter(a: Actor): Vec3 {
  return [a.cartX, CART_DECK + PAD + a.size[1] / 2, actorZ(a)];
}

/** Hall position of a part's centre once installed on a car stopped at its
 * station. */
export function installedCenter(a: Actor): Vec3 {
  return [a.center[0], a.center[1], stationZ(a.station) + a.center[2]];
}

const ease = {
  lift: easeInOutCubic,
  carry: easeInOutCubic,
  // Slow at the end: a heavy part is set down, not dropped.
  lower: (t: number) => 1 - Math.pow(1 - smooth01(t), 1.6),
};

export type CarryState = {
  /** Hall position of the part's centre. */
  center: Vec3;
  /** 0 before the part is hooked, 1 while it is carried, 0 after it is set down. */
  carried: number;
  /** True once the part is installed (stays true for the rest of the hold). */
  installed: boolean;
  /** Hall position of the hook block's centre, and of the trolley along the beam. */
  hook: Vec3;
};

/** Height the hook parks at between holds. */
export const HOOK_PARK_Y = 6.6;
/** How far above the top of a part its hook block hangs (sling + spreader). */
export const RIG_DROP: Record<RigKind, number> = {
  engine: 1.15,
  carrier: 1.35,
  door: 0.75,
  panel: 0.8,
  fascia: 0.85,
};

/**
 * Where an actor's part, and its hook, are at progress `u` through a hold.
 * Independent of which car it is (real or stand-in): the car is stopped at the
 * station, so the path is the same every time.
 */
export function carryState(a: Actor, u: number): CarryState {
  const t = a.timing;
  const S = stagedCenter(a);
  const I = installedCenter(a);
  const travelY = I[1] + a.clearance;
  const hookAbove = (centerY: number): number => centerY + a.size[1] / 2 + RIG_DROP[a.rig];

  // Part centre.
  let c: Vec3;
  if (u < t.lift[0]) {
    c = [...S];
  } else if (u < t.lift[1]) {
    const e = ease.lift(win(u, t.lift[0], t.lift[1]));
    c = [S[0], lerp(S[1], Math.max(S[1], travelY), e), S[2]];
  } else if (u < t.carry[1]) {
    const e = ease.carry(win(u, t.carry[0], t.carry[1]));
    const y0 = Math.max(S[1], travelY);
    c = [lerp(S[0], I[0], e), y0, S[2]];
  } else if (u < t.lower[1]) {
    const e = ease.lower(win(u, t.lower[0], t.lower[1]));
    const y0 = Math.max(S[1], travelY);
    c = [I[0], lerp(y0, I[1], e), lerp(S[2], I[2], 1)];
  } else {
    c = [...I];
  }

  const installed = u >= t.lower[1];
  const carried = u >= t.hookOn[1] && u < t.release[0] ? 1 : 0;

  // Hook block: from park, over the part, down onto it, with it, then up and away.
  const parkX = 0;
  let hook: Vec3;
  if (u < t.approach[1]) {
    const e = easeInOutCubic(win(u, t.approach[0], t.approach[1]));
    hook = [lerp(parkX, S[0], e), HOOK_PARK_Y, S[2]];
  } else if (u < t.hookOn[1]) {
    const e = easeInOutCubic(win(u, t.hookOn[0], t.hookOn[1]));
    hook = [S[0], lerp(HOOK_PARK_Y, hookAbove(S[1]), e), S[2]];
  } else if (u < t.release[0]) {
    hook = [c[0], hookAbove(c[1]), c[2]];
  } else if (u < t.release[1]) {
    const e = easeInOutCubic(win(u, t.release[0], t.release[1]));
    hook = [I[0], lerp(hookAbove(I[1]), HOOK_PARK_Y, e), I[2]];
  } else {
    const e = easeInOutCubic(win(u, t.park[0], t.park[1]));
    hook = [lerp(I[0], parkX, e), HOOK_PARK_Y, I[2]];
  }

  return { center: c, carried, installed, hook };
}

/**
 * Cart offset along x, as a fraction of CART_AWAY outward (0 = in place).
 * `served` is the hold the cart is serving: it slides in during the index step
 * before that hold, waits, and slides away once the part has been lifted.
 */
export function cartAway(a: Actor, f: number): { away: number; served: number } {
  const c = currentCycle(f);
  if (c < 0) return { away: 0, served: 0 };
  const u = holdU(f);
  const inStep = f > holdEnd(c) - 1e-9;
  if (!inStep) {
    // In hold c: serving hold c; leaves after the lift.
    const leave = smooth01(win(u, a.timing.lift[1], Math.min(1, a.timing.lift[1] + 0.2)));
    return { away: leave, served: c };
  }
  // In the step after hold c: the cart for hold c+1 slides in.
  if (c >= CYCLES - 1) return { away: 1, served: c };
  const s = win(f, holdEnd(c), stepEnd(c));
  return { away: 1 - smooth01(s), served: c + 1 };
}

/** Which car (relative to B) the actor at `station` is working on during hold
 * `h`. Zero is B. */
export function carServed(station: number, h: number): number {
  return station - h;
}

/** Range of cars that exist on the line (relative to B). */
export const CAR_RANGE: [number, number] = [-4, 6];

// --------------------------------------------------- the real car's parts

export type PartPose = {
  /** False while the part has not reached the line yet (it is off-stage). */
  visible: boolean;
  /** Hall position of the part's centre. */
  center: Vec3;
};

/**
 * Where B's own copy of an actor's part is. It is delivered by cart during the
 * index step before B's hold at that station, picked up by the gantry, carried,
 * set down, and from then on rides on B.
 */
export function realPartPose(a: Actor, f: number): PartPose {
  const k = a.station;
  const staged = stagedCenter(a);

  // Installed: rides on B from the moment the hold ends.
  if (f >= holdEnd(k) - 1e-9) {
    return { visible: true, center: [a.center[0], a.center[1], zB(f) + a.center[2]] };
  }
  // Not delivered yet: off-stage.
  const arrivalStart = holdEnd(k - 1);
  if (f < arrivalStart) return { visible: false, center: staged };
  // Arriving on its cart during the step before the hold.
  if (f < holdStart(k)) {
    const away = 1 - smooth01(win(f, holdEnd(k - 1), stepEnd(k - 1)));
    const dir = a.cartX < 0 ? -1 : 1;
    return { visible: true, center: [staged[0] + dir * CART_AWAY * away, staged[1], staged[2]] };
  }
  // In B's hold: the carry path.
  return { visible: true, center: carryState(a, holdU(f)).center };
}

// ------------------------------------------------------------ the hall's life

/** Radius (m) around the tunnel inside which the overhead lights are on: the
 * plant wakes outward from the finished car. */
export function ignitionRadius(f: number): number {
  return 205 * easeInOutCubic(win(f, 0, 0.12));
}

/** How lit the exit gate is. */
export function gateGlow(f: number): number {
  return smoothstep(0.02, 0.1, f);
}

/** Station names, as they read on the boards. Two or three words, each one
 * enough on its own. */
export const STATION_NAMES = ["Engine", "Body", "Doors", "Hood and trunk", "Bumpers and lights"] as const;

/** Scroll length of the whole walkthrough, in viewport heights. It began at
 * three screens, which played every station in about three wheel clicks; four
 * and a half gave each hold (a crane carrying a part across the hall and
 * setting it down) the time to be watched; five and a half is that plus room for the
 * cars' own moves (see STEP). It still read as fast: the fly over the line and the
 * camera's swing round to the first station cover about seventy metres in under half a
 * screen, and a single hard flick of a trackpad is two or three screens. Seven and a half
 * slows all of it by a third, and the film now follows the scroll with inertia and a top
 * speed (see FACTORY_FOLLOW), which is what keeps a flick from skipping a station.
 * The one number that sets the pace of the whole film: every window in it is a fraction
 * of this length. */
export const FACTORY_VH = 7.5;

/** How the film follows the scroll position. `smoothTime` is the time (s) it takes to settle
 * onto a new position; `maxSpeed` is the most of the whole film (0-1) it will play in a
 * second, so even a jump to the end of the page plays the plant through in a couple of
 * seconds instead of cutting across it. */
export const FACTORY_FOLLOW = { smoothTime: 0.4, maxSpeed: 0.45 };
