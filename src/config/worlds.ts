import * as THREE from "three";
import { FORD_COLORS, RIG, TARGET_CAR_LENGTH } from "@/lib/theme";

/**
 * Everything that differs from one world to the next lives here, as data.
 * Adding a fourth stage is one entry in WORLD_STAGES plus one entry in the
 * stage-component map in World.tsx -- the blending, fog, exposure, post and
 * environment code only ever reads the sampled result, never a stage by name.
 *
 * Written as .ts, not .js as sketched in the brief, for the same reason
 * composition.ts is: this is a fully TypeScript project.
 */

// ---------------------------------------------------------------- scale

/** The brief's real-world car length. */
export const CAR_LENGTH_M = 4.8;

/**
 * Scene units per metre. The car is scaled to TARGET_CAR_LENGTH scene units
 * (derived from the camera/composition grid, see theme.ts), so one scene
 * unit is about 1.08 m, not 1 m. Resizing the car would change the framing
 * of all three stages, so instead the WORLD is authored in real metres and
 * mounted in a group scaled by this factor.
 */
export const METER = TARGET_CAR_LENGTH / CAR_LENGTH_M;

// ------------------------------------------------------------------ sky

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** "A soft Ford Blue glow ONLY within about 6% of screen height above the
 * horizon" -- expressed as an elevation angle at the hero's field of view. */
export const SKY_GLOW_DEG = RIG.cameraFov * 0.06;

// Stops are in LINEAR colour space (three's Color stores linear), because the
// brief asks for the gradient to be computed there: interpolating in sRGB
// would darken every midpoint and is what makes naive gradients band.
const horizonGlow = new THREE.Color(FORD_COLORS.blue)
  .multiplyScalar(1.3)
  // Cool white mixed into the blue: distant city haze is never a pure hue,
  // and a saturated band reads as a graphic stripe rather than atmosphere.
  .add(new THREE.Color(0.022, 0.034, 0.066));
const twilight = new THREE.Color(FORD_COLORS.twilight);
const zenith = new THREE.Color(0.0004, 0.0008, 0.003); // near black, not #000

export type SkyStop = { e: number; color: THREE.Color };

/** Elevation in degrees above the horizon -> colour. The SAME table feeds
 * the GLSL (uniform arrays) and skyColorAt() below, which is how the fog
 * colour is guaranteed to equal the sky at the horizon. */
export const SKY_STOPS: SkyStop[] = [
  { e: -10, color: horizonGlow.clone().multiplyScalar(0.25) },
  { e: -2, color: horizonGlow.clone().multiplyScalar(0.7) },
  { e: 0, color: horizonGlow.clone() },
  { e: SKY_GLOW_DEG, color: twilight.clone().multiplyScalar(1.15) },
  { e: 9, color: twilight.clone() },
  { e: 26, color: zenith.clone() },
  { e: 90, color: zenith.clone() },
];

/** JS mirror of skyColor() in SkyDome's fragment shader. Same algorithm:
 * start at the first stop, then blend toward each next stop by a smoothstep
 * over its own elevation segment. */
export function skyColorAt(elevationDeg: number, out = new THREE.Color()): THREE.Color {
  out.copy(SKY_STOPS[0].color);
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    out.lerp(SKY_STOPS[i + 1].color, smooth(SKY_STOPS[i].e, SKY_STOPS[i + 1].e, elevationDeg));
  }
  return out;
}

export const SKY_HORIZON_COLOR = skyColorAt(0);

// ---------------------------------------------------------- environment

export type EnvFormer = {
  id: string;
  form: "rect" | "ring";
  position: [number, number, number];
  rotation?: [number, number, number];
  scale: number | [number, number, number];
  color: string;
  /** Intensity per stage, same order as WORLD_STAGES. */
  intensity: number[];
  /** Orient the panel to face the middle of the environment (the car). */
  faceCenter?: boolean;
};

/** The static part of the car's reflections. The moving part (lamp heads,
 * tunnel strips) is added by each stage's own component. */
export const ENV_FORMERS: EnvFormer[] = [
  {
    id: "key",
    form: "rect",
    position: [-4, 4, 4],
    scale: [4, 2, 1],
    color: "#eef4ff",
    intensity: [2.4, 1.2, 1.0],
  },
  {
    // Faint cool rim. Was a full-strength Ford Grabber blue (intensity 5);
    // Grabber is reserved for the tunnel guidance strip now.
    id: "rim",
    form: "rect",
    position: [3, 1.6, -3],
    rotation: [0, Math.PI / 2, 0],
    scale: [6, 1.5, 1],
    color: "#7f93ff",
    intensity: [0.5, 0.3, 0.2],
  },
  // Thin tall strips either side and a long one overhead: these replace the
  // three RectAreaLights the car used to carry. Same job (the long specular
  // streaks down the flanks and roofline), but reflected from the environment
  // map instead of shaded per pixel, which is far cheaper.
  {
    id: "strip-front-right",
    form: "rect",
    position: [3.2, 2.2, 2],
    scale: [0.3, 4, 1],
    color: "#eaf1ff",
    intensity: [9, 5, 4],
    faceCenter: true,
  },
  {
    id: "strip-front-left",
    form: "rect",
    position: [-3, 1.6, 2.6],
    scale: [0.3, 3, 1],
    color: "#9db4ff",
    intensity: [6, 3, 2],
    faceCenter: true,
  },
  {
    id: "strip-rear-top",
    form: "rect",
    position: [0, 2.6, -3.5],
    scale: [4, 0.3, 1],
    color: "#eaf1ff",
    intensity: [5, 3, 2],
    faceCenter: true,
  },
  {
    id: "overhead",
    form: "ring",
    position: [0, 5, 0],
    rotation: [-Math.PI / 2, 0, 0],
    scale: 8,
    color: "#dde4f0",
    intensity: [1.2, 0.6, 1.4],
  },
];

// --------------------------------------------------------------- stages

export type WorldId = "highway" | "tunnel" | "garage";

export type WorldStage = {
  id: WorldId;
  /** FogExp2 extinction per metre. */
  fogDensity: number;
  /** Hex, or undefined to use the sky's own horizon colour (highway). */
  fogColor?: string;
  exposure: number;
  bloom: number;
  /** 0-1 depth-of-field amount. Highway only. */
  dof: number;
  /** Flow speed in m/s while the page is at rest. */
  baseSpeed: number;
};

export const WORLD_STAGES: WorldStage[] = [
  { id: "highway", fogDensity: 0.0095, exposure: 0.9, bloom: 0.35, dof: 1, baseSpeed: 12 },
  { id: "tunnel", fogDensity: 0.006, fogColor: "#030812", exposure: 0.85, bloom: 0.5, dof: 0, baseSpeed: 6 },
  // Placeholder until Stage C: heavy black fog, so by the time the camera is
  // inside the cabin the highway behind the glass has dissolved into the dark
  // (and Highway stops drawing it altogether, see its useFrame).
  { id: "garage", fogDensity: 0.08, fogColor: "#000000", exposure: 1.05, bloom: 0.2, dof: 0, baseSpeed: 0 },
];

/** Metres/second of extra flow per px/frame of Lenis scroll velocity. */
export const SPEED_PER_SCROLL_VELOCITY = 0.9;
/** Hard ceiling on flow speed, m/s (about 134 mph, reached only in Drag Strip
 * mode while scrolling hard). */
export const MAX_SPEED = 60;

export type SampledWorld = {
  exposure: number;
  bloom: number;
  dof: number;
  fogDensity: number;
  baseSpeed: number;
  fogColor: THREE.Color;
  /** ENV_FORMERS intensities blended for the current world value. */
  envIntensity: number[];
};

function makeSampled(): SampledWorld {
  return {
    exposure: 1,
    bloom: 0,
    dof: 0,
    fogDensity: 0,
    baseSpeed: 0,
    fogColor: new THREE.Color(),
    envIntensity: ENV_FORMERS.map(() => 0),
  };
}

/** Live, mutable result of the latest sampleWorld() call. World.tsx writes
 * it once per frame; PostFX and friends read it. A plain object rather than
 * React state for the same reason scrollState is one. */
export const WORLD_RUNTIME: SampledWorld = makeSampled();

const scratchColorA = new THREE.Color();
const scratchColorB = new THREE.Color();

function stageFogColor(stage: WorldStage, out: THREE.Color): THREE.Color {
  return stage.fogColor ? out.set(stage.fogColor) : out.copy(SKY_HORIZON_COLOR);
}

/** Blends the two stages either side of `world` into `out`. */
export function sampleWorld(world: number, out: SampledWorld = WORLD_RUNTIME): SampledWorld {
  const last = WORLD_STAGES.length - 1;
  const w = Math.min(Math.max(world, 0), last);
  const i = Math.min(Math.floor(w), last - 1);
  const t = w - i;
  const a = WORLD_STAGES[i];
  const b = WORLD_STAGES[i + 1];

  out.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, t);
  out.bloom = THREE.MathUtils.lerp(a.bloom, b.bloom, t);
  out.dof = THREE.MathUtils.lerp(a.dof, b.dof, t);
  out.fogDensity = THREE.MathUtils.lerp(a.fogDensity, b.fogDensity, t);
  out.baseSpeed = THREE.MathUtils.lerp(a.baseSpeed, b.baseSpeed, t);
  out.fogColor.copy(stageFogColor(a, scratchColorA)).lerp(stageFogColor(b, scratchColorB), t);
  for (let k = 0; k < ENV_FORMERS.length; k++) {
    const arr = ENV_FORMERS[k].intensity;
    out.envIntensity[k] = THREE.MathUtils.lerp(arr[i] ?? 0, arr[i + 1] ?? 0, t);
  }
  return out;
}

// Prime the runtime object so the first Environment render (and anything
// else that reads it before the first frame) sees Stage A's values, not zeros.
sampleWorld(0);
