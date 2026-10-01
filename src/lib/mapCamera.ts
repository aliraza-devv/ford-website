/**
 * The plant map's camera.
 *
 * A view is where the camera looks (a point on the map, in the map's own units) and
 * how much of the map it shows (`w`, map units across the whole stage). Moving between
 * two views uses van Wijk and Nuij's "smooth and efficient zooming and panning": for a
 * long hop the camera pulls back as it travels and drops in at the end, the way a
 * camera on a crane does, and for a short one it just glides. It is the same maths as
 * d3.interpolateZoom, written out so the page ships no map library.
 */

export type View = {
  /** Map point at the centre of the focus area. */
  x: number;
  y: number;
  /** Map units across the stage's width. */
  w: number;
};

const RHO = 1.38;

export function interpolateView(a: View, b: View): (t: number) => View {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  const rho2 = RHO * RHO;
  const rho4 = rho2 * rho2;

  // The two views are (nearly) the same place: just zoom.
  if (d2 < 1e-6) {
    const S = Math.log(b.w / a.w) / RHO;
    return (t) => ({ x: a.x, y: a.y, w: a.w * Math.exp(RHO * t * S) });
  }

  const d1 = Math.sqrt(d2);
  const b0 = (b.w * b.w - a.w * a.w + rho4 * d2) / (2 * a.w * rho2 * d1);
  const b1 = (b.w * b.w - a.w * a.w - rho4 * d2) / (2 * b.w * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / RHO;
  const coshR0 = Math.cosh(r0);
  const sinhR0 = Math.sinh(r0);

  return (t) => {
    const s = t * S;
    const u = (a.w / (rho2 * d1)) * (coshR0 * Math.tanh(RHO * s + r0) - sinhR0);
    return { x: a.x + u * dx, y: a.y + u * dy, w: (a.w * coshR0) / Math.cosh(RHO * s + r0) };
  };
}

/** The rectangle of the stage the map is framed in (the rest holds the words). */
export type Focus = { x: number; y: number; w: number; h: number };

/** What a view must fit: the map extent, in map units, that has to be visible inside
 * the focus rectangle. */
export type Fit = { x: number; y: number; w: number; h: number };

/** The view that fits `fit` inside `focus`, on a stage `stageW` wide. */
export function viewFor(fit: Fit, focus: Focus, stageW: number, maxZoom: number): View {
  const z = Math.min(focus.w / fit.w, focus.h / fit.h, maxZoom);
  return { x: fit.x + fit.w / 2, y: fit.y + fit.h / 2, w: stageW / z };
}
