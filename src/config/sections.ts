/**
 * How the sections after the hero stack are laid out in scroll.
 *
 * Every section from the plant map onward is a tall wrapper holding one sticky,
 * full-screen stage, exactly as the hero does. Each hands over to the next the same
 * way: the next wrapper is pulled up by COVER_VH (a negative margin), so its stage
 * rises over the previous one while that stays pinned and holds its last frame. When
 * the cover is complete the previous stage is hidden for good, and (for the hero) its
 * 3D canvas stops rendering (see lib/stageLive).
 *
 * All lengths are in screens (viewport heights) of scroll. How long the map's tour and
 * the road finder run is worked out from their own parts (config/plantTour, config/roads).
 */

/** The screens a section takes to rise over the one before it. */
export const COVER_VH = 1;
/** The screens the previous stage holds its final frame before the next begins to rise. */
export const HOLD_VH = 0.2;

/** Layers for the sections that stack over the hero. The hero's own stage is at 0. */
export const SECTION_Z = {
  map: 40,
  find: 50,
} as const;
