/**
 * FIX 0: the single shared layout grid every hero layer reads from. Sky,
 * Road, the headline, the car/camera framing, and both side panels all
 * derive their position from these fractions -- no component picks its
 * own independent position anymore. That was the root cause of the
 * collisions/misalignment this file exists to fix.
 *
 * Written as .ts, not .js as sketched in the brief -- this is a fully
 * TypeScript project (every other file is .ts/.tsx), so a lone .js file
 * would be the odd one out and lose type-checking for free.
 */
export const LAYOUT = {
  /** Horizon line, fraction from top of viewport. Sky ends here, Road starts here. */
  horizonY: 0.46,
  /** Car dead center horizontally. */
  carCenterX: 0.5,
  /** Car's tyre contact point, fraction from top of viewport. */
  carBaseY: 0.78,
  /** Car occupies this fraction of viewport width. */
  carWidthRatio: 0.66,
  /** Headline baseline, fraction from top -- sits in its own band below
   * the navbar and above the stats/paint panels and the car, no overlap
   * with either (the earlier "car occludes the lower third of the type"
   * concept read as broken/overlapping in practice, not intentional). */
  headlineBaselineY: 0.33,
  /** Side panels start this fraction in from each edge, symmetrically. */
  sideGutter: 0.08,
  /** Each side panel reserves this fraction of viewport width. */
  panelWidth: 0.16,
  /** Stats panel / paint selector vertical band -- lower, flanking the
   * car rather than sitting right under the (now much higher) headline. */
  sidePanelBandTop: 0.42,
  sidePanelBandBottom: 0.68,
} as const;

export type CompositionLayout = typeof LAYOUT;
