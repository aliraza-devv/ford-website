/**
 * Dev-only switches for measuring the world in isolation (exposed on
 * `window.__fordWorldDebug` by Scene in development). The seam test, for
 * example, has to look at road -> fog -> sky without the horizon silhouettes
 * in front of it, because their edges are legitimate brightness steps.
 * Defaults are the shipped behaviour, so this costs nothing in production.
 */
export const worldDebug = {
  /** The three distant silhouette layers. */
  horizon: true,
  /** Lamp posts (with their pooled lights) and the barrier. */
  props: true,
  /** Parts of the Section 4 plant, switched off one at a time to find what a
   * frame costs. */
  plant: { floor: true, hall: true, gantries: true, robots: true, sparks: true, car: true },
  /** How many times the plant's environment cube has been refreshed. */
  envUpdates: 0,
};
