import { clamp01, smooth01 } from "@/lib/ease";
import { MODEL_NAMES, PLANT_BY_ID, PLANTS, type StateCode } from "./fordPlants";
import type { Fit } from "@/lib/mapCamera";

/**
 * Section 5: the tour of Ford's U.S. assembly plants.
 *
 * Like the plant film before it, the tour is a pure function of one scroll number,
 * `p` (0-1 over MAP_VH screens), so scrolling back reverses it exactly. It is a list of
 * stops. At each the camera comes to rest on a place, the plants there light up one at
 * a time, and a board names each plant and what it builds; between stops the camera
 * flies.
 *
 * Durations are written in screens of scroll, so they read as what the visitor
 * does: a hold of 1.4 is a little over a screen of scrolling. PACE stretches or
 * squeezes the whole tour and is the one dial for its speed.
 */

/** Scales every duration below. 1 = as written. */
const PACE = 1;

export type Beat = {
  /** A plant that lights up, and the fraction of the hold (0-1) at which it does. */
  plant: string;
  at: number;
};

/** The words on the left. A group is a heading and the sentences under it; it is on
 * screen from its first beat until the next group's. */
export type Group = {
  /** The beat that brings this group on. */
  fromBeat: number;
  /** The state that is lit while the group is on screen. */
  state?: StateCode;
  heading: string[];
  /** Each sentence is on screen from its beat until the next sentence's. A sentence with a
   * `wall` is shown as that list of names, set as type, instead of as a sentence. */
  sentences: { fromBeat: number; text: string; wall?: string[] }[];
};

export type Stop = {
  id: string;
  /** What the camera has to fit: a rectangle of the map, in map units (about 2.9 km each). */
  fit: Fit;
  /** Tighter framing for a phone, where the focus area is small. */
  fitMobile?: Fit;
  /** Screens of scroll the flight into this stop takes, and the hold at it. */
  fly: number;
  hold: number;
  beats: Beat[];
  groups: Group[];
};

export const STOPS: Stop[] = [
  {
    id: "national",
    fit: { x: 0, y: 0, w: 1600, h: 1000 },
    fitMobile: { x: 0, y: 150, w: 1600, h: 700 },
    fly: 0,
    hold: 0.3,
    beats: [],
    groups: [
      {
        fromBeat: 0,
        heading: ["Seven plants.", "Five states."],
        sentences: [{ fromBeat: 0, text: "These are the plants where Ford assembles its vehicles in the United States." }],
      },
    ],
  },
  {
    id: "great-lakes",
    fit: { x: 1126, y: 302, w: 130, h: 80 },
    fitMobile: { x: 1159, y: 322, w: 64, h: 40 },
    fly: 0.35,
    hold: 1.2,
    beats: [
      { plant: "flat-rock", at: 0.05 },
      { plant: "michigan-assembly", at: 0.27 },
      { plant: "dearborn-truck", at: 0.49 },
      { plant: "ohio-assembly", at: 0.72 },
    ],
    groups: [
      {
        fromBeat: 0,
        state: "MI",
        heading: ["Michigan."],
        sentences: [
          { fromBeat: 0, text: "Three plants. The Mustang is built at Flat Rock, the Bronco and Ranger at Wayne, the F-150 at Dearborn." },
        ],
      },
      {
        fromBeat: 3,
        state: "OH",
        heading: ["Ohio."],
        sentences: [
          { fromBeat: 3, text: "Avon Lake builds the medium duty F-650 and F-750, Super Duty chassis cabs and E-Series cutaways." },
        ],
      },
    ],
  },
  {
    id: "heartland",
    fit: { x: 829, y: 340, w: 260, h: 160 },
    fitMobile: { x: 844, y: 380, w: 230, h: 80 },
    fly: 0.35,
    hold: 0.8,
    beats: [
      { plant: "chicago-assembly", at: 0.08 },
      { plant: "kansas-city", at: 0.55 },
    ],
    groups: [
      {
        fromBeat: 0,
        state: "IL",
        heading: ["Illinois."],
        sentences: [
          { fromBeat: 0, text: "Chicago Assembly opened in 1924. It builds the Explorer, the Police Interceptor Utility and the Lincoln Aviator." },
        ],
      },
      {
        fromBeat: 1,
        state: "MO",
        heading: ["Missouri."],
        sentences: [
          { fromBeat: 1, text: "Kansas City Assembly stands on 1,269 acres in Claycomo. It builds the F-150, the Transit and the E-Transit." },
        ],
      },
    ],
  },
  {
    id: "kentucky",
    fit: { x: 1090, y: 469, w: 70, h: 49 },
    fitMobile: { x: 1100, y: 476, w: 50, h: 36 },
    fly: 0.35,
    hold: 0.9,
    beats: [
      { plant: "kentucky-truck", at: 0.08 },
      { plant: "louisville-assembly", at: 0.56 },
    ],
    groups: [
      {
        fromBeat: 0,
        state: "KY",
        heading: ["Kentucky."],
        sentences: [
          { fromBeat: 0, text: "Kentucky Truck Plant builds the Super Duty F-250 to F-550, the Expedition and the Lincoln Navigator." },
          {
            fromBeat: 1,
            text: "Louisville Assembly is retooling for the mid-sized electric truck, the first vehicle off Ford’s Universal EV platform.",
          },
        ],
      },
    ],
  },
  {
    id: "overview",
    fit: { x: 826, y: 300, w: 420, h: 225 },
    fitMobile: { x: 816, y: 340, w: 440, h: 145 },
    fly: 0.35,
    hold: 0.4,
    beats: [],
    groups: [
      {
        fromBeat: 0,
        heading: ["Built here."],
        sentences: [{ fromBeat: 0, text: MODEL_NAMES.join(", "), wall: MODEL_NAMES }],
      },
    ],
  },
];

// --------------------------------------------------------------- timeline

export type Segment = {
  stop: number;
  /** Progress at which the flight into the stop starts, where the hold starts, where it ends. */
  flyStart: number;
  holdStart: number;
  holdEnd: number;
};

const SCREENS = STOPS.reduce((s, st) => s + st.fly + st.hold, 0) * PACE;

/** How many screens of scroll the whole tour takes. */
export const MAP_VH = SCREENS;

export const SEGMENTS: Segment[] = (() => {
  let acc = 0;
  return STOPS.map((st, i) => {
    const flyStart = acc / SCREENS;
    acc += st.fly * PACE;
    const holdStart = acc / SCREENS;
    acc += st.hold * PACE;
    return { stop: i, flyStart, holdStart, holdEnd: acc / SCREENS };
  });
})();

/** The stop the camera is at or flying into, how far through its flight (0-1; 1 while
 * holding) and how far through its hold (0-1; 0 before it). */
export function locate(p: number): { stop: number; fly: number; hold: number } {
  const q = clamp01(p);
  for (let i = SEGMENTS.length - 1; i >= 0; i--) {
    const s = SEGMENTS[i];
    if (q >= s.flyStart) {
      const fly = s.holdStart > s.flyStart ? clamp01((q - s.flyStart) / (s.holdStart - s.flyStart)) : 1;
      const hold = clamp01((q - s.holdStart) / (s.holdEnd - s.holdStart));
      return { stop: i, fly, hold };
    }
  }
  return { stop: 0, fly: 1, hold: 0 };
}

/** The camera's easing along a flight: slow out of one stop, slow into the next. */
export const flightEase = (t: number) => smooth01(smooth01(t) * 0.4 + t * 0.6);

/** Progress at which beat `k` of stop `i` lights its plant. */
export function beatAt(i: number, k: number): number {
  const s = SEGMENTS[i];
  const beat = STOPS[i].beats[k];
  return s.holdStart + beat.at * (s.holdEnd - s.holdStart);
}

/** Progress at which the hold at stop `i` begins and ends. */
export const stopStart = (i: number) => SEGMENTS[i].holdStart;
export const stopEnd = (i: number) => SEGMENTS[i].holdEnd;

/** Which stop of the tour a plant belongs to, and which beat. */
export const PLANT_BEAT: Record<string, { stop: number; beat: number }> = (() => {
  const out: Record<string, { stop: number; beat: number }> = {};
  STOPS.forEach((st, i) => st.beats.forEach((b, k) => (out[b.plant] = { stop: i, beat: k })));
  return out;
})();

/** Progress at which a group of words comes on: its first beat, or, for the first group
 * of a stop, a little before the camera arrives. */
export function groupStart(i: number, g: number): number {
  if (g > 0) return beatAt(i, STOPS[i].groups[g].fromBeat) - 0.012;
  const s = SEGMENTS[i];
  return s.holdStart - 0.45 * (s.holdStart - s.flyStart);
}

/** Progress at which group `g` of stop `i` goes: the next group's start, or the end of the stop. */
export function groupEnd(i: number, g: number): number {
  const next = STOPS[i].groups[g + 1];
  if (next) return groupStart(i, g + 1);
  // The words of the last stop stay for the end of the tour.
  if (i === STOPS.length - 1) return Infinity;
  return stopEnd(i) - 0.004;
}

/** The states the tracker names, in the order the tour reaches them, with the progress
 * at which each one's words come on. */
export const STATE_STOPS: { state: StateCode; stop: number; group: number }[] = STOPS.flatMap((st, stop) =>
  st.groups.flatMap((g, group) => (g.state ? [{ state: g.state, stop, group }] : [])),
).filter((x, i, all) => all.findIndex((y) => y.state === x.state) === i);

// Sanity: every plant on the map has a beat in the tour.
if (process.env.NODE_ENV !== "production") {
  for (const p of PLANTS) {
    if (!PLANT_BEAT[p.id]) console.warn(`plantTour: ${p.id} has no beat`);
    if (!PLANT_BY_ID[p.id]) console.warn(`plantTour: unknown plant ${p.id}`);
  }
}
