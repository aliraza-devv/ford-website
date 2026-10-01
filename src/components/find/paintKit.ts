/**
 * A small kit for painting the road finder's scenes in 2D.
 *
 * Each scene is painted once, in code, from seeded noise: the same four places every
 * time, with no image to download. The trick that makes flat shapes read as a place is
 * the one a painter uses: every layer further from the eye is lighter and bluer, and
 * hazier where it meets the one in front.
 */

export type Ctx = CanvasRenderingContext2D;
export type RGB = [number, number, number];

export const hex = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

// ----------------------------------------------------------------- randomness

export function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(i: number, seed: number): number {
  let h = Math.imul((i | 0) ^ seed, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * (3 - 2 * t);

function vnoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  return hash(i, seed) + (hash(i + 1, seed) - hash(i, seed)) * fade(f);
}

/** Smooth fractal noise, 0-1. */
export function fbm(x: number, seed: number, octaves = 5, gain = 0.5): number {
  let a = 1;
  let sum = 0;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x * f, seed + o * 131) * a;
    norm += a;
    a *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Sharp-crested fractal noise, 0-1: the shape of mountains. */
export function ridged(x: number, seed: number, octaves = 5): number {
  let a = 1;
  let sum = 0;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    const v = 1 - Math.abs(2 * vnoise(x * f, seed + o * 131) - 1);
    sum += v * v * a;
    norm += a;
    a *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

// ------------------------------------------------------------------- gradients

export function lin(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

export function radial(ctx: Ctx, x: number, y: number, r: number, stops: [number, string][], x1 = x, y1 = y): CanvasGradient {
  const g = ctx.createRadialGradient(x1, y1, 0, x, y, r);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

/** A soft glow, additive. */
export function glow(ctx: Ctx, x: number, y: number, r: number, color: string, peak = 1) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace(/[\d.]+\)$/u, `${peak})`));
  g.addColorStop(0.35, color.replace(/[\d.]+\)$/u, `${peak * 0.34})`));
  g.addColorStop(1, color.replace(/[\d.]+\)$/u, "0)"));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// -------------------------------------------------------------------- shapes

/** A ridge line: heights sampled every `step` px from `x0`. */
export type Ridge = { x0: number; step: number; ys: number[] };

/** The heights of a ridge line across [x0, x1], sampled every `step` px. */
export function ridge(x0: number, x1: number, step: number, height: (x: number) => number): Ridge {
  const ys: number[] = [];
  for (let x = x0; x <= x1 + step; x += step) ys.push(height(x));
  return { x0, step, ys };
}

/** The height of a ridge at x (nearest sample). */
export function ridgeAt(r: Ridge, x: number): number {
  const i = Math.round((x - r.x0) / r.step);
  return r.ys[Math.min(r.ys.length - 1, Math.max(0, i))];
}

/** Fills the area under a ridge line, down to `bottom`. */
export function fillRidge(ctx: Ctx, r: Ridge, bottom: number, style: string | CanvasGradient) {
  const last = r.x0 + (r.ys.length - 1) * r.step;
  ctx.beginPath();
  ctx.moveTo(r.x0, bottom);
  r.ys.forEach((y, i) => ctx.lineTo(r.x0 + i * r.step, y));
  ctx.lineTo(last, bottom);
  ctx.closePath();
  ctx.fillStyle = style;
  ctx.fill();
}

export function stars(ctx: Ctx, x0: number, x1: number, y0: number, y1: number, count: number, seed: number, maxAlpha = 0.8) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = x0 + r() * (x1 - x0);
    const y = y0 + (y1 - y0) * Math.pow(r(), 1.6);
    const a = (0.15 + r() * 0.85) * maxAlpha * (1 - (y - y0) / (y1 - y0) * 0.6);
    const s = r() < 0.08 ? 1.6 : 1;
    ctx.fillStyle = `rgba(220,232,255,${a.toFixed(3)})`;
    ctx.fillRect(x, y, s, s);
  }
}

/** A conifer: stacked, ragged tiers, `h` tall, base centred on (x, y). */
export function conifer(ctx: Ctx, x: number, y: number, h: number, r: () => number) {
  const tiers = Math.max(3, Math.round(h / 12));
  const w = h * 0.34;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  for (let i = 1; i <= tiers; i++) {
    const t = i / tiers;
    const yy = y - h + h * t;
    const ww = w * t * (0.78 + r() * 0.3);
    ctx.lineTo(x + ww, yy - h / tiers * 0.15);
    ctx.lineTo(x + ww * 0.55, yy - h / tiers * 0.05);
  }
  ctx.lineTo(x + w * 0.1, y);
  ctx.lineTo(x - w * 0.1, y);
  for (let i = tiers; i >= 1; i--) {
    const t = i / tiers;
    const yy = y - h + h * t;
    const ww = w * t * (0.78 + r() * 0.3);
    ctx.lineTo(x - ww * 0.55, yy - h / tiers * 0.05);
    ctx.lineTo(x - ww, yy - h / tiers * 0.15);
  }
  ctx.closePath();
  ctx.fill();
}
