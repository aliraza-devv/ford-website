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
};
