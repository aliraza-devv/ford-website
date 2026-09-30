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
  // Swapped from the GTD to the Shelby GT500 model -- copy corrected to
  // match (same "don't ship mismatched specs" rule FIX 9 established for
  // the GTD swap).
  modelDesignation: ["2022 MUSTANG", "SHELBY GT500"],
  audioLabel: "ENGINE SOUND",
  nav: ["VEHICLES", "ELECTRIC", "PERFORMANCE", "BUILD & PRICE"],
  navCta: "FIND A DEALER",
} as const;

export const MODEL_URL = "/models/mustang-shelby-gt500.glb";

export type StatDef = {
  micro: string;
  unit: string;
  /** Static text before the animated number, e.g. "UNDER " for "UNDER 3.0s". */
  prefix: string;
  value: number;
  decimals: number;
  suffix: string;
  /** Renders verbatim in place of prefix+value+suffix. For stats that aren't
   * really numbers ("7-SPD") and so can't be composed arithmetically. Only
   * valid on non-counting rows -- StatsPanel's count-up tween writes
   * prefix/value/suffix directly and would overwrite this. */
  display?: string;
};

// Corrected to the Shelby GT500's actual specs (was the GTD's).
export const STATS: StatDef[] = [
  { micro: "ACCELERATION", unit: "0-60 MPH", prefix: "UNDER ", value: 3.3, decimals: 1, suffix: "s" },
  { micro: "HORSEPOWER", unit: "", prefix: "", value: 760, decimals: 0, suffix: "" },
  { micro: "TORQUE", unit: "LB-FT", prefix: "", value: 625, decimals: 0, suffix: "" },
];

// Section 2's stat set -- swapped in for STATS (via the same hero-fade-content
// / section2-fade-content crossfade every other DOM layer uses) so the side
// panel shows something new once the car turns side-on, instead of repeating
// the hero's own 0-60/hp/torque numbers.
//
// Drivetrain facts rather than dynamics claims: the previous set (downforce
// at 150mph, 1.15g lateral, -200lb vs a standard GT) were the GTD's numbers
// and don't hold for a GT500. Deliberately no downforce figure here -- the
// GT500's varies by whether the Carbon Fiber Track Pack is fitted, and a
// spec panel is the wrong place to print a number that needs an asterisk.
export const SECTION2_STATS: StatDef[] = [
  { micro: "ENGINE", unit: "SUPERCHARGED V8", prefix: "", value: 5.2, decimals: 1, suffix: "L", display: "5.2L" },
  { micro: "TRANSMISSION", unit: "DUAL-CLUTCH", prefix: "", value: 7, decimals: 0, suffix: "", display: "7-SPD" },
  { micro: "TOP SPEED", unit: "MPH", prefix: "", value: 180, decimals: 0, suffix: "", display: "180" },
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
} as const;

// Three-stage scroll transition: the hero's car canvas is pinned (CSS
// `sticky`, see HeroExperience.tsx) across all three sections' scroll
// range, which is driven by TWO INDEPENDENT, back-to-back ScrollTriggers
// (see STAGE_12_VH/STAGE_23_VH in HeroExperience.tsx) rather than one
// shared 0-1 progress carved up by guessed fractions -- that's what
// guarantees Stage 3 can never bleed backward into Section 2's own
// transition. InteractionSystem sums both ScrollTriggers' progress into a
// single smoothed `stage` value (0-2): [0,1] is Stage 1 (hero, front-on)
// turning into Stage 2 (side profile); [1,2] is Stage 2 turning into
// Stage 3 (interior view -- shifted the OPPOSITE way, door open, camera in
// tight). All additive on TOP of InteractionSystem's existing mouse-driven
// rotation, not a replacement.
export const SECTION2 = {
  // Stage 2 target transform. Front-on (0) -> side profile; sign/magnitude
  // verified empirically in the live preview (same technique used to find
  // carFrontYaw itself). Door stays CLOSED through all of Stage 1 and
  // Stage 2 -- see doorOpenStart below.
  sideYaw: -Math.PI / 2,
  // Camera dollies to this fraction of its base distance (0.6 = 40%
  // closer), not an FOV change -- FOV "zoom" distorts, dollying doesn't.
  stage2Zoom: 0.6,
  // Car shifts this many world units right, to compose against Section 2's
  // text (which sits on the opposite side).
  stage2ShiftX: 1.3,

  // Stage 3: the camera flies INTO the cabin -- the car itself holds its
  // Stage 2 side-profile pose (yaw, shift) for all of Stage 3; only the
  // camera keeps moving, from Stage 2's exterior dolly position to a
  // driver's-eye position behind the wheel. The car holding still is what
  // makes it read as "the camera enters the car" rather than "the car
  // does something else" -- two things moving at once would fight for
  // attention right when the interior itself needs it most.
  //
  // stage3CameraPos/stage3LookAt are given in the CAR's own local model
  // space (same space as SECTION3's interior feature positions below) and
  // converted to world space in InteractionSystem using the car's known,
  // FROZEN Stage-2-end transform (rotation.y = sideYaw, position.x =
  // stage2ShiftX) -- not hardcoded world coordinates, so if stage2ShiftX
  // or sideYaw ever change, the interior camera stays correctly anchored
  // to the car without needing to be re-derived by hand.
  //
  // Positions derived from the glTF directly (composed through this
  // model's own node-transform chain -- it wraps the whole scene in two
  // Z-up-to-Y-up rotation matrices, so raw accessor bounds alone read as
  // nonsense for anything under those wrappers), then nudged back off the
  // steering wheel's exact center so the camera sits at a driver's head
  // position instead of inside the wheel rim itself.
  // The camera follows a CURVE into the cabin, not a straight line. A
  // straight lerp from the exterior side-profile position to the driver's
  // seat passes directly through the closed door -- geometrically the
  // shortest path, but it reads as the camera clipping through sheet metal
  // rather than swinging in through the window. These four waypoints arc
  // it around and in:
  //
  //   [0] the Stage-2 exterior side-profile position, so there's no pop at
  //       progress 0. Derived, not guessed: it's world-space
  //       (cameraPosition * stage2Zoom) converted into car-local space
  //       through the car's own frozen Stage-2 transform.
  //   [1] out beyond the driver's door, risen to window height
  //   [2] in the window aperture itself
  //   [3] the driver's eye point
  //
  // +X is the driver's side, +Y up, +Z toward the front of the car.
  stage3CameraPath: [
    [3.6, 0.86, 1.3],
    [1.9, 1.25, 0.15],
    [0.95, 1.2, 0.0],
    [0.3, 1.1, -0.15],
  ] as [number, number, number][],
  // The aim swings on its own (shorter) curve so it leads the move --
  // starting on the car's flank, passing over the door opening, settling on
  // the cluster/touchscreen. Point [0] is RIG.cameraLookAt converted into
  // car-local space the same way as the camera path's own first point.
  stage3LookAtPath: [
    [0, 1.07, 1.3],
    [0.4, 1.0, 0.9],
    [0.15, 0.9, 0.45],
  ] as [number, number, number][],
  // FOV widens as the camera moves in -- the base 35deg (tuned for a
  // flattering exterior telephoto look) reads as flat and claustrophobic
  // this close to the dash; a wider angle is what makes an interior shot
  // feel like sitting in the seat instead of pressing your face against it.
  stage3Fov: 58,

  // Scroll smoothing is no longer done here. It used to be a per-frame lerp
  // over raw ScrollTrigger progress, because raw wheel deltas arrive in
  // discrete steps and drove the car in visible snaps. Lenis now eases the
  // scroll POSITION upstream (see useSmoothScroll), so this whole signal
  // arrives pre-smoothed -- lerping it again would just add latency back.
} as const;

// Section 3: the interior reveal -- the camera flies from Stage 2's
// exterior side-profile into a driver's-eye position inside the cabin
// (see STAGE3_CAMERA_LOCAL/STAGE3_LOOKAT_LOCAL in SECTION2 above). No door
// animation for now -- this model's doors ARE separate meshes (Door.L/
// Door.R, unlike the previous GTD model's fused single-shell body), a
// much better foundation for a future open-door feature, just not wired
// up yet.
export const SECTION3 = {
  // MEASURED, not guessed: this model ships 0 textures and 0 images -- all
  // 15 materials are flat PBR constants -- and all three interior materials
  // ("leather", "seat", "glossblack") have baseColor [0,0,0], pure black.
  //
  // A pure-black albedo has zero diffuse response, so no amount of interior
  // lighting can brighten these surfaces; only the specular lobe answers.
  // And since they're partly metallic (0.33-0.61) and a metal's specular is
  // tinted by its baseColor, the metallic fraction reflects black too. What
  // survives is the dielectric fraction's ~4% white Fresnel -- around 2.6%
  // of the environment map for leather. That 2.6% WAS the entire cabin
  // image, which is why it read as a blue silhouette: the brightest thing
  // in the environment is Scene.tsx's Grabber-blue Lightformer.
  //
  // So the fix is two-part and neither part is a light-intensity tweak:
  // lift the albedo off zero so diffuse lighting works at all, and pull the
  // interior's envMapIntensity down so the blue stops dominating what's
  // left. Applied to cloned materials on interior meshes only (see
  // MustangModel) -- these materials are shared with exterior trim, and
  // mutating them in place would wash out the bodywork too.
  // These hexes are picked in LINEAR space and written back as sRGB, which
  // is why they look lighter than you'd expect for a black interior.
  // three converts hex -> linear on assignment, and sRGB #141414 (the
  // obvious "very dark grey") is only 0.7% linear albedo -- still visually
  // black under any light. A dark surface that actually shows its form
  // wants roughly 2-3% linear, which lands around sRGB #2a2a2a.
  interiorMaterial: {
    leatherColor: "#3d3d3d", // ~3.5% linear -- dash, wheel, door cards, visor
    seatColor: "#333333", // ~2.8% linear, roughness 0.86, so very matte
    glossBlackColor: "#1a1a1a", // sharp specular reads through highlights, not diffuse
    envMapIntensity: 0.06, // near-zero: the env map is dominated by a Grabber-blue Lightformer; anything above ~0.1 makes the cabin read as blue
    metalness: 0, // leather and fabric are dielectric, not metallic; the original model's 0.3-0.6 metalness tints specular by baseColor (dark), killing neutral reflections
  },

  // Interior lighting -- see InteriorLights.tsx. None of this project's
  // existing rig (ambient 0.15, the procedural exterior Environment/
  // Lightformers, the cursor-tracked rim light) reaches the cabin once the
  // camera is actually inside it -- every one of those is aimed at or
  // reflects off the car's OUTER surfaces. Without dedicated interior
  // lights the dash/wheel/gauges render as near-black silhouettes. So
  // unlike a typical "moody accent" light, this one has to do the real
  // work of making the cabin legible on its own -- positions verified
  // directly against the glTF (composed through this model's own
  // Z-up-to-Y-up wrapper transforms -- see the note above), same space as
  // STAGE3_CAMERA_LOCAL/STAGE3_LOOKAT_LOCAL in SECTION2.
  cabinLight: {
    color: "#fff2d9",
    position: [0.2, 1.35, 0.25] as [number, number, number],
    maxIntensity: 8,
    distance: 2.5,
  },
  footwellLight: {
    color: "#1700F4",
    position: [0.35, 0.35, -0.05] as [number, number, number],
    maxIntensity: 0.4,
    distance: 0.8,
  },
  fillLight: {
    color: "#eef4ff",
    position: [-0.3, 1.0, 0.3] as [number, number, number],
    maxIntensity: 4,
    distance: 2.2,
  },

} as const;
