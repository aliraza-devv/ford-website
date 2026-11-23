/**
 * The single scroll signal the whole 3D stage reads.
 *
 * A plain module-level object rather than React state or a tree of refs:
 * it's written by ScrollTrigger's onUpdate (outside React's render cycle)
 * and read inside useFrame (also outside it), so routing it through React
 * would only add re-renders to a value that changes every frame. It
 * replaces the three separate refs (scrollProgressRef / stage3ProgressRef /
 * smoothedStageRef) that used to be threaded down through Scene into
 * InteractionSystem and MustangModel -- same data, four fewer props, and
 * one obvious place to read "where are we in the scroll" from.
 *
 * `stage12` / `stage23` are deliberately NOT smoothed here: Lenis already
 * eases the scroll POSITION upstream (see useSmoothScroll), so the car and
 * camera read them directly. The `world`, `speed` and `travel` fields below
 * belong to the 3D world and are written by it, not by scroll handlers.
 */
export type ScrollState = {
  /** 0-1 across Stage 1 -> 2 (hero front-on turning to side profile). */
  stage12: number;
  /** 0-1 across Stage 2 -> 3 (side profile, camera flying into the cabin).
   * Its scroll range starts exactly where stage12's ends, so the two never
   * overlap. */
  stage23: number;
  /** 0-1 across the interior feature scan that follows Stage 2 -> 3, while the
   * camera holds still inside the cabin (see FeatureScan). */
  features: number;
  /** 0-1 across the plant walkthrough (Section 4) that follows the feature
   * scan. The camera leaves the cabin, the hall lights up, and the car is
   * taken apart and rebuilt station by station. Everything in the plant --
   * hall position, camera, part offsets, paint sweep, overlay copy -- is a
   * pure function of this one number, so scrolling back reverses it exactly. */
  factory: number;
  /** Where the page's scroll says the walkthrough should be (0-1). `factory` follows it with a
   * little inertia and a top speed (see useSmoothScroll), so a hard flick can neither snap the
   * camera across the hall nor play the whole line in a blink. */
  factoryTarget: number;
  /** 0-1 as the plant map rises over the plant (Section 5's cover), then 0-1 across
   * the tour of Ford's plants itself once it is pinned. Neither touches the 3D
   * world; they are read by the map's own loop. */
  cover5: number;
  map: number;
  /** The same two for the road finder (Section 6), rising over the map. */
  cover6: number;
  find: number;
  /** 0-3 world float (0 highway, 1 tunnel, 2 garage/cabin, 3 plant), damped
   * toward its target by <World />. Drives colour/exposure/fog blends;
   * geometry that must stay locked to the car reads getStage() directly
   * instead. */
  world: number;
  /** Lenis scroll velocity, px per frame (signed). Written every tick from
   * useSmoothScroll, read by the world to couple road speed to scrolling. */
  velocity: number;
  /** Smoothed world flow speed in metres per second. */
  speed: number;
  /** Metres the world has travelled, accumulated from `speed`. Every
   * scrolling texture and recycled prop is a pure function of this. */
  travel: number;
};

export const scrollState: ScrollState = {
  stage12: 0,
  stage23: 0,
  features: 0,
  factory: 0,
  factoryTarget: 0,
  cover5: 0,
  map: 0,
  cover6: 0,
  find: 0,
  world: 0,
  velocity: 0,
  speed: 0,
  travel: 0,
};

/**
 * The combined 0-2 stage value. [0,1] is Stage 1->2, [1,2] is Stage 2->3.
 * Because the two ranges are back-to-back and non-overlapping, stage12 sits
 * pinned at 1 for the whole time stage23 is climbing, so the sum is
 * continuous and monotonic -- safe to compare against 1 to pick a branch.
 */
export function getStage(): number {
  return scrollState.stage12 + scrollState.stage23;
}
