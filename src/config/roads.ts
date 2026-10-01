import { clamp01, smooth01 } from "@/lib/ease";
import { CAR_SPRITES } from "./carSprites";

/**
 * Section 6: find your Ford. Four roads, each with its own scene and the Ford that
 * belongs on it. The four places are one long panorama along a single road: the page
 * scrolls vertically and the camera tracks sideways along it, so a scene arrives by the
 * landscape continuing, not by one picture replacing another.
 *
 * The four are all built at plants on the map before it (config/fordPlants), so the
 * poster can say where. Every figure is as published on ford.com on 1 October 2026,
 * for the model year Ford's page names: 2026 for the Mustang, Bronco and F-150, 2027
 * for the Explorer. Where a figure belongs to one version (the Raptor), the caption
 * says so. The F-Series sales record is Ford's own ("49 consecutive years as America's
 * best-selling truck", Ford Media, after the 2025 sales year).
 */

export const FIGURES_SOURCE = "ford.com";
export const FIGURES_AS_OF = "October 2026";
export const FIGURES_NOTE = "2026 Mustang, Bronco and F-150, 2027 Explorer";

export type Figure = { figure: string; unit: string; caption: string };

/**
 * A car standing in the road: a picture of the model, set for the world’s own light
 * (scripts/bake-cars renders one from a 3D model; scripts/cut-cars cuts one from a
 * photograph), with its measurements, so it can be set down on the road at the right
 * size without further adjustment.
 */
export type CarSprite = {
  src: string;
  /** The picture’s size in px, and the car’s own width in it (the picture also holds the
   * light its lamps throw). */
  width: number;
  height: number;
  span: number;
  /** Picture px per reference px: the picture is drawn at (stage height / 1080 / density). */
  density: number;
  /** px from the top of the picture to the horizon in it, and to where the tyres touch. */
  horizon: number;
  contact: number;
  /** Where the car’s middle is, as a fraction of the picture’s width. */
  centre: number;
};

export type RoadId = "highway" | "trail" | "job-site" | "town";

export type Road = {
  id: RoadId;
  /** The plate. */
  label: string;
  /** The poster's name, set huge. */
  model: string;
  /** Ford's page for it. */
  href: string;
  /** Where it is built, as the plants on the map. */
  builtIn: string;
  /** One figure leads; two follow. */
  lead: Figure;
  pair: [Figure, Figure];
  /** The model standing in the road. */
  car?: CarSprite;
};

export const ROADS: Road[] = [
  {
    id: "highway",
    label: "Highway",
    model: "Mustang",
    href: "https://www.ford.com/cars/mustang/",
    builtIn: "Flat Rock, Michigan",
    car: CAR_SPRITES.mustang,
    lead: { figure: "500", unit: "hp", caption: "Mustang Dark Horse" },
    pair: [
      { figure: "480", unit: "hp", caption: "Mustang GT" },
      { figure: "315", unit: "hp", caption: "Mustang EcoBoost" },
    ],
  },
  {
    id: "trail",
    label: "Trail",
    model: "Bronco",
    href: "https://www.ford.com/suvs/bronco/",
    builtIn: "Wayne, Michigan",
    car: CAR_SPRITES.bronco,
    lead: { figure: "7", unit: "modes", caption: "G.O.A.T. terrain modes, up to" },
    pair: [
      { figure: "13.1", unit: "in", caption: "Ground clearance, Raptor" },
      { figure: "37", unit: "in", caption: "Water fording, Raptor" },
    ],
  },
  {
    id: "job-site",
    label: "Job site",
    model: "F-150",
    href: "https://www.ford.com/trucks/f150/",
    builtIn: "Dearborn, Michigan and Claycomo, Missouri",
    car: CAR_SPRITES.f150,
    lead: { figure: "13,500", unit: "lb", caption: "Max available towing" },
    pair: [
      { figure: "7.2", unit: "kW", caption: "Pro Power Onboard, available" },
      { figure: "49", unit: "years", caption: "America’s best-selling truck, F-Series" },
    ],
  },
  {
    id: "town",
    label: "Town",
    model: "Explorer",
    href: "https://www.ford.com/suvs/explorer/",
    builtIn: "Chicago, Illinois",
    car: CAR_SPRITES.explorer,
    lead: { figure: "7", unit: "seats", caption: "Seating, up to" },
    pair: [
      { figure: "85.8", unit: "cu ft", caption: "Cargo space, up to" },
      { figure: "400", unit: "hp", caption: "Available 3.0L twin-turbo V6" },
    ],
  },
];

/** The close: the same two places the plant film used to end at. */
export const CLOSE_LINKS = {
  build: "https://shop.ford.com/showroom/",
  dealer: "https://www.ford.com/dealerships/",
};

// --------------------------------------------------------------- timeline

/**
 * Screens of scroll for each part of the section, in order. A dwell is the scene at
 * rest with its poster readable; a move is the slide from one scene to the next.
 */
type Part =
  | { kind: "intro"; len: number }
  | { kind: "dwell"; road: number; len: number }
  | { kind: "move"; from: number; to: number; len: number }
  | { kind: "close"; len: number }
  | { kind: "end"; len: number };

const DWELL = 0.42;
const MOVE = 0.56;

const PARTS: Part[] = [
  { kind: "intro", len: 0.25 },
  { kind: "dwell", road: 0, len: DWELL },
  { kind: "move", from: 0, to: 1, len: MOVE },
  { kind: "dwell", road: 1, len: DWELL },
  { kind: "move", from: 1, to: 2, len: MOVE },
  { kind: "dwell", road: 2, len: DWELL },
  { kind: "move", from: 2, to: 3, len: MOVE },
  { kind: "dwell", road: 3, len: DWELL },
  { kind: "close", len: 0.4 },
  { kind: "end", len: 0.5 },
];

/** How many screens of scroll the whole section takes. */
export const FIND_VH = PARTS.reduce((s, p) => s + p.len, 0);

type Timed = Part & { a: number; b: number };
const TIMED: Timed[] = (() => {
  let acc = 0;
  return PARTS.map((p) => {
    const a = acc / FIND_VH;
    acc += p.len;
    return { ...p, a, b: acc / FIND_VH };
  });
})();

export type RoadState = {
  /** Where the camera is along the road, in scenes: 0 is the first scene's centre, 3 the
   * last's. It stays on a whole number while a road is at rest and glides between them. */
  pos: number;
  /** The scene the camera is leaving and the one it is going to (the same when at rest). */
  from: number;
  to: number;
  /** 0-1 along the move from `from` to `to`, linear: the text uses it. `pos` is the eased one. */
  u: number;
  /** 0-1 through the dwell at `from` (0 outside one). */
  dwell: number;
  /** 0-1: how far the matcher has given way to the close. */
  close: number;
};

export function roadState(q: number): RoadState {
  const p = clamp01(q);
  const s: RoadState = { pos: 0, from: 0, to: 0, u: 0, dwell: 0, close: 0 };
  for (const part of TIMED) {
    if (p < part.a) continue;
    const t = clamp01((p - part.a) / (part.b - part.a));
    switch (part.kind) {
      case "intro":
        s.from = s.to = 0;
        s.pos = 0;
        s.dwell = 0;
        s.u = 0;
        break;
      case "dwell":
        s.from = s.to = part.road;
        s.pos = part.road;
        s.dwell = t;
        s.u = 0;
        break;
      case "move":
        s.from = part.from;
        s.to = part.to;
        s.u = t;
        s.dwell = 0;
        // Quintic ease: the camera sets off and comes to rest without a jolt.
        s.pos = part.from + t * t * t * (t * (t * 6 - 15) + 10);
        break;
      case "close":
        s.from = s.to = ROADS.length - 1;
        s.pos = ROADS.length - 1;
        s.dwell = 0;
        s.u = 0;
        s.close = smooth01(t);
        break;
      case "end":
        s.from = s.to = ROADS.length - 1;
        s.pos = ROADS.length - 1;
        s.u = 0;
        s.close = 1;
        break;
    }
  }
  return s;
}

/** The progress at the middle of a road's dwell: where its plate takes the visitor. */
export function dwellCenter(road: number): number {
  const part = TIMED.find((x) => x.kind === "dwell" && x.road === road);
  return part ? (part.a + part.b) / 2 : 0;
}
