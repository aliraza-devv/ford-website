import { LAYOUT } from "@/config/composition";

export const FORD_COLORS = {
  blue: "#00095B",
  twilight: "#00142E",
  grabber: "#1700F4",
  white: "#FFFFFF",
  black: "#000000",
} as const;

export const HERO_COPY = {
  microLabel: "FORD MOTOR COMPANY / EST. 1903",
  headline: "BUILT FORD TOUGH",
  scrollIndicator: "SCROLL TO DISCOVER",
  // FIX 9, Option B: the loaded model is the GTD (confirmed -- the only
  // other file in public/3D Models/ is a 1965 Mustang, no Dark Horse
  // variant exists in the project), so the copy is corrected to match the
  // GTD's actual specs rather than the model being swapped.
  modelDesignation: ["2026 MUSTANG", "GTD"],
  audioLabel: "ENGINE SOUND",
  nav: ["VEHICLES", "ELECTRIC", "PERFORMANCE", "BUILD & PRICE"],
  navCta: "FIND A DEALER",
} as const;

export const MODEL_URL = "/models/mustang-gtd.glb";

export type StatDef = {
  micro: string;
  unit: string;
  /** Static text before the animated number, e.g. "UNDER " for "UNDER 3.0s". */
  prefix: string;
  value: number;
  decimals: number;
  suffix: string;
};

// FIX 9: corrected to the GTD's actual specs.
export const STATS: StatDef[] = [
  { micro: "ACCELERATION", unit: "0-60 MPH", prefix: "UNDER ", value: 3.0, decimals: 1, suffix: "s" },
  { micro: "HORSEPOWER", unit: "", prefix: "", value: 815, decimals: 0, suffix: "" },
  { micro: "TORQUE", unit: "LB-FT", prefix: "", value: 664, decimals: 0, suffix: "" },
];

export type PaintOption = {
  name: string;
  hex: string;
};

// Step 7 right panel -- clicking one re-triggers the liquid paint sweep
// full-body, originating from the swatch's own screen position.
export const PAINT_OPTIONS: PaintOption[] = [
  { name: "FORD BLUE", hex: "#00095B" },
  { name: "GRABBER BLUE", hex: "#1700F4" },
  { name: "TWILIGHT", hex: "#00142E" },
  { name: "OXFORD WHITE", hex: "#FFFFFF" },
  { name: "SHADOW BLACK", hex: "#0A0A0A" },
];

// Camera / rig tuning. Kept in one place so positions/angles can be nudged
// without hunting through the R3F tree.
export const RIG = {
  cameraFov: 35,
  // FIX 1: camera sits slightly below the car's beltline for an imposing,
  // looking-up angle. FIX 2: the world-space width the car is scaled to
  // (see MustangModel's TARGET_LENGTH) is derived from this same position/
  // fov via perspective math so LAYOUT.carWidthRatio is honored, not
  // picked independently -- see composition.ts.
  cameraPosition: [0, 0.9, 6] as [number, number, number],
  cameraLookAt: [0, 0.75, 0] as [number, number, number],
  // Shifts the car (and its ContactShadows, see Scene.tsx) straight down
  // in world space -- moves it toward the bottom of the frame WITHOUT
  // touching the camera's position/angle, unlike the previous (reverted)
  // attempt which lowered the camera itself and changed the viewing angle.
  carGroundOffsetY: -0.32,
  // FIX 1: static yaw that faces the model's front at the camera. Turns
  // out to be 0 -- the glTF's own native export orientation already faces
  // +Z (the camera's direction) with no rotation needed. Two material-
  // name heuristics were tried first (headlight-mesh average, then
  // grille-mesh average) and both actively introduced the WRONG rotation
  // (this GTD's single "LightA" material covers headlights AND taillights,
  // and it has rear diffuser/vent meshes that also match "Grille" naming),
  // solving a problem the model didn't have. Verified empirically by
  // testing cardinal angles directly in the live preview: 0 is the one
  // that's dead-on front and symmetric -- grille, pony badge, both
  // headlights, no taillights, no rear diffuser.
  carFrontYaw: 0,
  carBaseTiltX: -0.02,

  maxYaw: (6 * Math.PI) / 180,
  maxPitch: (3 * Math.PI) / 180,
  cameraLerp: 0.05,
  carCounterRatio: -0.5, // 3deg at max 6deg camera yaw, per Step 9.2

  rimLightLerp: 0.035,
  rimLightYawRange: (36 * Math.PI) / 180,
  rimLightHeightRange: 0.8,

  idleBlendLerp: 0.02,
  idleAfterMs: 2500,

  // Parallax strengths, Step 4 / Step 9.1 -- all layers read the SAME
  // underlying lerped pointer signal, just scaled differently, so they
  // read as one system instead of four independent listeners.
  parallax: {
    sky: 0.2,
    road: 0.4,
    headline: 0.6,
    car: 1.0,
    chrome: 0.1,
  },
} as const;

// FIX 2: the car's world-space scale target is derived from the shared
// composition grid via perspective projection instead of a hand-picked
// constant -- at the camera's actual distance and fov, this is the world
// width that projects to exactly LAYOUT.carWidthRatio of the viewport, at
// a representative 16:9 desktop aspect (three's PerspectiveCamera adjusts
// the live aspect every frame regardless, so this is the right constant to
// target the 1920/1440/1280-wide verification widths, which are all ~16:9).
const REFERENCE_ASPECT = 16 / 9;
const verticalHalfFovRad = (RIG.cameraFov * Math.PI) / 180 / 2;
const horizontalHalfFovTan = Math.tan(verticalHalfFovRad) * REFERENCE_ASPECT;
const distanceToCar = RIG.cameraPosition[2]; // car sits at world z=0
const visibleWidthAtCar = 2 * distanceToCar * horizontalHalfFovTan;
export const TARGET_CAR_LENGTH = visibleWidthAtCar * LAYOUT.carWidthRatio;

// Liquid paint shader tuning (Step 5) -- exposed here so the blob feel can
// be tuned without touching shader code.
export const PAINT_SHADER = {
  hoverLerp: 0.06, // viscous trail, not a spotlight
  leaveDuration: 0.8, // seconds, power2.inOut contraction on mouse leave
  noiseScale: 3.2, // fbm frequency across the body's UV space
  blobRadius: 0.42, // base reveal radius in UV space before noise distortion
  sweepDuration: 1.4, // full-body swatch-triggered transition
} as const;

// Section 2 scroll transition: the hero's car canvas is pinned (CSS
// `sticky`, see HeroExperience.tsx) across both sections' scroll range,
// and these drive how it transforms as the user scrolls from the hero's
// front-on hero shot into section 2's closer side-profile shot. All
// additive on TOP of InteractionSystem's existing mouse-driven rotation,
// not a replacement for it.
export const SECTION2 = {
  // Front-on (0) -> side profile. Sign/magnitude verified empirically in
  // the live preview (same technique used to find carFrontYaw itself).
  sideYaw: -Math.PI / 2,
  // Camera dollies to this fraction of its base distance at full scroll
  // (0.6 = 40% closer), not an FOV change -- FOV "zoom" distorts, dollying
  // doesn't.
  zoomScale: 0.6,
  // Car shifts this many world units horizontally at full scroll, to
  // compose against section 2's text (which sits on the opposite side).
  carShiftX: 1.3,
  // Door swings open between these two scroll fractions (so it opens
  // during the back half of the transition, once the side profile is
  // mostly turned toward camera) -- not the full [0,1] range.
  doorOpenStart: 0.5,
  doorOpenEnd: 0.95,
  // Rotation applied on top of the door bone's own rest rotation. Sign/
  // axis verified empirically in the live preview (same technique used
  // for carFrontYaw) -- a door hinge's "open" direction isn't knowable
  // from the glTF alone without testing it.
  doorOpenAngle: Math.PI * 0.35,
} as const;

// Road shader tuning (Step 4, layer 2). The vanishing point itself is no
// longer a separate constant here -- FIX 6 makes the Road layer's own
// container exactly LAYOUT.horizonY tall, so its shader's vanishing point
// is geometrically always its own top edge (uv.y = 1), guaranteeing it
// lines up with Sky's bottom edge instead of two independently-guessed
// values that happened to almost match.
export const ROAD = {
  laneSpeed: 0.35, // UV units/second, reads as a fast cruise not a race
} as const;
