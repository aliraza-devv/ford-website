import { conifer, css, fbm, glow, hex, lin, mix, ridged, rng, stars, type Ctx, type RGB } from "./paintKit";

/**
 * The road finder's world: one long panorama along a single road, painted in code.
 *
 * Four places lie along it, left to right: a highway at the end of the blue hour, a
 * mountain trail at first light, a quarry in the last hour of sun, and a town at dusk.
 * The camera tracks sideways along the road as the page scrolls. To make that read as a
 * place and not a slideshow, the world is built the way a painter would build a deep
 * panorama:
 *
 *   sky   four skies, each with the far hills or skyline, that the camera passes through
 *         in turn (the light changes as you travel, there is no cut)
 *   mid   the middle distance, one long picture that slides at 0.8 of the road's speed;
 *         the four places grow out of one another along it (trees thin into houses,
 *         hills step down into the quarry)
 *   road  the road itself and the verge, at the cars' distance, at the road's speed
 *   fore  a thin strip of near foreground, faster than the road
 *
 * Each of mid, road and fore is painted in tiles from the same functions of x, so the
 * tiles join without a seam. Everything is a fraction of the stage, so the picture is
 * the same at any size. The cars (see config/roads) stand in the road layer.
 *
 * The geometry is one camera: the horizon at 0.6 of the stage's height, a lens whose
 * focal length is 1.8 stage-heights, 1.15 m above the road. At the cars' distance of
 * 12.5 m a metre is 0.144 stage-heights wide, which is how large a car is, and the tyres
 * touch the road 0.166 stage-heights below the horizon. Low, so the upper part of a car
 * stands against the sky.
 */

export const SCENES = 4;

export const GEO = {
  horizon: 0.6,
  /** The road's far and near edges (18.4 m and 6.9 m away), and the line the cars' tyres
   * touch (12.5 m). */
  roadFar: 0.718,
  roadNear: 0.9,
  contact: 0.7656,
} as const;

export type PanoLayer = "mid" | "road" | "fore";

/** How fast each layer slides (1 = the road), where it sits on the stage and how sharply
 * it is painted. */
export const PANO: Record<PanoLayer, { m: number; top: number; height: number; scale: number }> = {
  mid: { m: 0.8, top: 0.08, height: 0.92, scale: 0.85 },
  road: { m: 1, top: 0.7, height: 0.3, scale: 1 },
  fore: { m: 1.22, top: 0.82, height: 0.18, scale: 1 },
};

/** The skies slide a little (0.025 of the road’s speed, so at most 0.08 of the stage’s width over the whole
 * road) and each is painted that much wider than the stage. */
export const SKY = { m: 0.025, pad: 0.1, scale: 0.6 } as const;

/** Tile width, as a fraction of the stage's. */
export const TILE = 0.8;

export const layerWidth = (layer: PanoLayer, w: number) => w + (SCENES - 1) * PANO[layer].m * w;
export const sceneCenter = (layer: PanoLayer, i: number, w: number) => i * PANO[layer].m * w + w / 2;

// ------------------------------------------------------------------- the zones

const smooth = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/** How much of each place there is at x in a layer: they run into one another over a
 * stretch of 0.4 of a scene, so the change is gradual. */
export function zoneWeights(x: number, layer: PanoLayer, w: number): [number, number, number, number] {
  const s = (x - w / 2) / (PANO[layer].m * w);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  if (s <= 0) out[0] = 1;
  else if (s >= SCENES - 1) out[SCENES - 1] = 1;
  else {
    const i = Math.floor(s);
    const b = smooth((s - i - 0.3) / 0.4);
    out[i] = 1 - b;
    out[i + 1] = b;
  }
  return out;
}

/** Fills a horizontal strip across [x0, x1] whose opacity follows how much of place `zone`
 * there is at each x, as one gradient. */
function zoneStrip(ctx: Ctx, layer: PanoLayer, w: number, zone: number, x0: number, x1: number, y: number, hgt: number, rgb: string, max: number) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  const step = 48;
  const from = Math.floor(x0 / step) * step;
  for (let x = from; x <= x1 + step; x += step) {
    const t = Math.min(Math.max((x - x0) / (x1 - x0), 0), 1);
    g.addColorStop(t, `rgba(${rgb},${(max * zoneWeights(x, layer, w)[zone]).toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(x0, y, x1 - x0, hgt);
}

const mixRGB = (w: number[], c: RGB[]): RGB => {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < w.length; i++) {
    r += c[i][0] * w[i];
    g += c[i][1] * w[i];
    b += c[i][2] * w[i];
  }
  return [r, g, b];
};
const pal = (a: string, b: string, c: string, d: string): RGB[] => [hex(a), hex(b), hex(c), hex(d)];

// ================================================================== the skies

type SkyPainter = (ctx: Ctx, w: number, h: number, x0: number, x1: number) => void;

const HAZE = hex("#9fb4d6");

const skyHighway: SkyPainter = (ctx, w, h, x0, x1) => {
  const yh = h * GEO.horizon;
  const span = x1 - x0;
  ctx.fillStyle = lin(ctx, 0, 0, 0, yh, [
    [0, "#02040b"],
    [0.38, "#06102a"],
    [0.7, "#0e2455"],
    [0.9, "#25477f"],
    [1, "#3f6499"],
  ]);
  ctx.fillRect(x0, 0, span, yh + 2);
  stars(ctx, x0, x1, 0, yh * 0.62, Math.round((150 * span) / w), 11, 0.8);
  // The last light, low and wide.
  ctx.fillStyle = lin(ctx, 0, yh - h * 0.17, 0, yh + 1, [
    [0, "rgba(255,150,80,0)"],
    [0.62, "rgba(255,150,80,0.22)"],
    [1, "rgba(255,196,140,0.6)"],
  ]);
  ctx.fillRect(x0, yh - h * 0.17, span, h * 0.17 + 1);
  glow(ctx, w * 0.5, yh, w * 0.42, "rgba(255,160,90,1)", 0.34);
  // Hills on the horizon.
  hills(ctx, x0, x1, yh, h * 0.05, 340, 21, "rgb(12,24,52)", h * 0.016);
  hills(ctx, x0, x1, yh, h * 0.028, 210, 33, "rgb(7,14,32)", h * 0.004);
};

const skyTrail: SkyPainter = (ctx, w, h, x0, x1) => {
  const yh = h * GEO.horizon;
  const span = x1 - x0;
  ctx.fillStyle = lin(ctx, 0, 0, 0, yh + h * 0.08, [
    [0, "#03060d"],
    [0.4, "#0a1d2e"],
    [0.72, "#1c4656"],
    [0.9, "#8b8f95"],
    [1, "#d7ab90"],
  ]);
  ctx.fillRect(x0, 0, span, yh + h * 0.1);
  stars(ctx, x0, x1, 0, h * 0.34, Math.round((110 * span) / w), 41, 0.62);
  glow(ctx, w * 0.64, h * 0.56, w * 0.34, "rgba(255,190,140,1)", 0.46);
  const sky = hex("#6e8fa0");
  const ridges = [
    { base: 0.6, amp: 0.2, seed: 3, col: mix(hex("#243c52"), sky, 0.34), fq: 500 },
    { base: 0.635, amp: 0.17, seed: 9, col: mix(hex("#193044"), sky, 0.2), fq: 420 },
  ];
  for (const L of ridges) {
    const top = h * (L.base - L.amp);
    ctx.beginPath();
    ctx.moveTo(x0, yh + h * 0.12);
    for (let x = x0; x <= x1 + 4; x += 4) ctx.lineTo(x, h * L.base - Math.pow(ridged(x / L.fq + L.seed * 0.7, L.seed, 5), 1.25) * h * L.amp);
    ctx.lineTo(x1, yh + h * 0.12);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, top, 0, yh + h * 0.1, [
      [0, css(mix(L.col, hex("#a6bccb"), 0.08))],
      [1, css(mix(L.col, HAZE, 0.5))],
    ]);
    ctx.fill();
    ctx.fillStyle = lin(ctx, 0, h * (L.base + 0.02), 0, yh + h * 0.1, [
      [0, "rgba(176,196,214,0)"],
      [1, "rgba(176,196,214,0.2)"],
    ]);
    ctx.fillRect(x0, h * (L.base + 0.02), span, yh + h * 0.1 - h * (L.base + 0.02));
  }
};

const skyJob: SkyPainter = (ctx, w, h, x0, x1) => {
  const yh = h * GEO.horizon;
  const span = x1 - x0;
  const sunX = w * 0.72;
  ctx.fillStyle = lin(ctx, 0, 0, 0, yh, [
    [0, "#0b1226"],
    [0.38, "#2e2a4a"],
    [0.66, "#8b4b4a"],
    [0.88, "#e08a55"],
    [1, "#fbc57a"],
  ]);
  ctx.fillRect(x0, 0, span, yh + 2);
  glow(ctx, sunX, yh * 0.93, w * 0.4, "rgba(255,196,128,1)", 0.62);
  glow(ctx, sunX, yh * 0.93, w * 0.07, "rgba(255,238,200,1)", 0.95);
  ctx.fillStyle = lin(ctx, 0, yh - h * 0.2, 0, yh + 2, [[0, "rgba(255,190,130,0)"], [1, "rgba(255,190,130,0.34)"]]);
  ctx.fillRect(x0, yh - h * 0.2, span, h * 0.2 + 2);
  hills(ctx, x0, x1, yh, h * 0.07, 380, 55, "rgb(88,58,78)", h * 0.012);
  hills(ctx, x0, x1, yh, h * 0.04, 300, 56, "rgb(58,40,62)", -h * 0.002);
};

const skyTown: SkyPainter = (ctx, w, h, x0, x1) => {
  const yh = h * GEO.horizon;
  const span = x1 - x0;
  ctx.fillStyle = lin(ctx, 0, 0, 0, yh, [
    [0, "#03050f"],
    [0.4, "#0a1233"],
    [0.66, "#1d2658"],
    [0.84, "#5b4a7a"],
    [1, "#e58f5c"],
  ]);
  ctx.fillRect(x0, 0, span, yh + 2);
  stars(ctx, x0, x1, 0, yh * 0.5, Math.round((90 * span) / w), 71, 0.55);
  glow(ctx, w * 0.4, yh, w * 0.4, "rgba(255,150,90,1)", 0.3);
  // The skyline, far.
  const r = rng(14);
  let x = x0 - 20;
  while (x < x1 + 20) {
    const bw = 26 + r() * 56;
    const tall = r() < 0.12;
    const bh = h * (tall ? 0.2 + r() * 0.1 : 0.04 + r() * 0.12);
    const col = mix(hex("#141c42"), hex("#4a3f72"), r() * 0.25);
    ctx.fillStyle = lin(ctx, 0, yh - bh, 0, yh, [[0, css(col)], [1, css(mix(col, hex("#8a5f86"), 0.5))]]);
    ctx.fillRect(x, yh - bh, bw, bh + 2);
    for (let wy = yh - bh + 8; wy < yh - 6; wy += 9) {
      for (let wx = x + 5; wx < x + bw - 5; wx += 8) {
        if (r() < 0.2) {
          ctx.fillStyle = `rgba(255,214,150,${(0.25 + r() * 0.4).toFixed(2)})`;
          ctx.fillRect(wx, wy, 3, 4);
        }
      }
    }
    if (tall) {
      ctx.fillStyle = css(col);
      ctx.fillRect(x + bw / 2 - 0.8, yh - bh - h * 0.04, 1.6, h * 0.04);
      ctx.fillStyle = "rgba(255,80,70,0.9)";
      ctx.fillRect(x + bw / 2 - 1.6, yh - bh - h * 0.04 - 2, 3.2, 3.2);
    }
    x += bw + r() * 6;
  }
};

/** Low hills along a line: a silhouette of fbm noise `amp` tall. */
function hills(ctx: Ctx, x0: number, x1: number, y: number, amp: number, fq: number, seed: number, fill: string, lift: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y + 2);
  for (let x = x0; x <= x1 + 6; x += 6) ctx.lineTo(x, y - lift - fbm(x / fq, seed, 4) * amp);
  ctx.lineTo(x1, y + 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

const SKIES: SkyPainter[] = [skyHighway, skyTrail, skyJob, skyTown];

/** The ground colour each sky carries below its horizon, so a sky is a whole picture. */
const GROUND_UNDER: [string, string][] = [
  ["#0b1530", "#03050d"],
  ["#0a1a25", "#04090f"],
  ["#6d4547", "#150f1b"],
  ["#3b3768", "#04060f"],
];

/** One of the four skies, painted across [x0, x1] (the stage plus its pad). */
export function paintSky(scene: number, ctx: Ctx, w: number, h: number, x0: number, x1: number) {
  const yh = h * GEO.horizon;
  ctx.fillStyle = lin(ctx, 0, yh, 0, h, [[0, GROUND_UNDER[scene][0]], [0.5, GROUND_UNDER[scene][1]], [1, GROUND_UNDER[scene][1]]]);
  ctx.fillRect(x0, yh, x1 - x0, h - yh);
  SKIES[scene](ctx, w, h, x0, x1);
}

// ============================================================= the middle ground

/** The ground behind the road, at the horizon and at the road's far edge, in each place. */
const FIELD_TOP = pal("#0b1530", "#0a1a25", "#7a4f48", "#3b3768");
const FIELD_BOT = pal("#070e22", "#07111a", "#3a2630", "#12163a");

function paintMid(ctx: Ctx, w: number, h: number, x0: number, x1: number) {
  const L: PanoLayer = "mid";
  const yh = h * GEO.horizon;
  const u = h / 1080; // sizes that are meant to be a physical size scale with the stage
  const STEP = 8;

  // ---- the ground behind the road
  for (let x = Math.floor(x0 / STEP) * STEP - STEP; x < x1 + STEP; x += STEP) {
    const wt = zoneWeights(x + STEP / 2, L, w);
    ctx.fillStyle = lin(ctx, 0, yh - 2, 0, h, [
      [0, css(mixRGB(wt, FIELD_TOP))],
      [0.28, css(mixRGB(wt, FIELD_BOT))],
      [1, css(mixRGB(wt, FIELD_BOT))],
    ]);
    ctx.fillRect(x, yh - 2, STEP + 0.8, h - yh + 2);
  }

  // ---- the land: low hills, forested ridges, a quarry stepping up and down
  const zc2 = sceneCenter(L, 2, w);
  const quarryR = w * 0.5;
  const plateau = w * 0.12;
  // the quarry's profile: terraces, each a ledge and a riser
  const benches: { x: number; y: number }[] = [];
  {
    const r = rng(8);
    const n = 6;
    const rise = h * 0.036;
    const base = yh + h * 0.045;
    const sideW = quarryR - plateau;
    let x = zc2 - quarryR;
    let y = base;
    benches.push({ x, y });
    for (let i = 0; i < n; i++) {
      const ledge = (sideW / n) * (0.7 + r() * 0.2);
      x += ledge;
      benches.push({ x, y });
      x += (sideW / n) - ledge;
      y -= rise * (0.85 + r() * 0.3);
      benches.push({ x, y });
    }
    x += plateau * 2;
    benches.push({ x, y });
    for (let i = 0; i < n; i++) {
      const riser = (sideW / n) * (0.25 + r() * 0.15);
      x += riser;
      y += rise * (0.85 + r() * 0.3);
      benches.push({ x, y });
      x += (sideW / n) - riser;
      benches.push({ x, y });
    }
    benches.push({ x: zc2 + quarryR, y: base });
  }
  const quarryAt = (x: number): number => {
    if (x < zc2 - quarryR || x > zc2 + quarryR) return Infinity;
    for (let i = 1; i < benches.length; i++) {
      if (x <= benches[i].x) {
        const a = benches[i - 1];
        const b = benches[i];
        const t = b.x === a.x ? 1 : (x - a.x) / (b.x - a.x);
        return a.y + (b.y - a.y) * t;
      }
    }
    return Infinity;
  };

  const ground = yh + h * 0.045;
  const land = (x: number): number => {
    const wt = zoneWeights(x, L, w);
    const hw = ground - h * 0.008 - fbm(x / 160, 3, 3) * h * 0.012;
    const tr = ground - h * 0.02 - Math.pow(ridged(x / 420 + 2, 17, 5), 1.15) * h * 0.2;
    const tn = ground - h * 0.004;
    return wt[0] * hw + wt[1] * tr + wt[2] * ground + wt[3] * tn;
  };

  const silhouette: RGB[] = pal("#050a1c", "#0c1d29", "#4a3040", "#070b1f");
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, h);
  for (let x = Math.floor(x0 / 4) * 4 - 4; x <= x1 + 4; x += 4) ctx.lineTo(x, land(x));
  ctx.lineTo(x1 + 4, h);
  ctx.closePath();
  ctx.clip();
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  for (let x = Math.floor(x0 / 40) * 40; x <= x1 + 40; x += 40) {
    const t = Math.min(Math.max((x - x0) / (x1 - x0), 0), 1);
    g.addColorStop(t, css(mixRGB(zoneWeights(x, L, w), silhouette)));
  }
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, x1 - x0, h);
  // the haze that sits on far land: it builds toward the ground and thins away below it
  ctx.fillStyle = lin(ctx, 0, yh - h * 0.25, 0, ground + h * 0.06, [
    [0, "rgba(150,170,205,0)"],
    [0.78, "rgba(150,170,205,0.16)"],
    [1, "rgba(150,170,205,0)"],
  ]);
  ctx.fillRect(x0, yh - h * 0.25, x1 - x0, h * 0.31);
  ctx.restore();

  // ---- the quarry: terraces, lit on the side that faces the sun, in shadow on the other,
  // and a crane on the top
  {
    if (zc2 + quarryR > x0 - 10 && zc2 - quarryR < x1 + 10) {
      const pts = benches;
      const topY = Math.min(...pts.map((b) => b.y));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, ground + 6);
      pts.forEach((b) => ctx.lineTo(b.x, b.y));
      ctx.lineTo(pts[pts.length - 1].x, ground + 6);
      ctx.closePath();
      ctx.clip();
      // shaded on the left, lit on the right
      ctx.fillStyle = lin(ctx, zc2 - quarryR, 0, zc2 + quarryR, 0, [
        [0, "#2b2030"],
        [0.42, "#3a2a3c"],
        [0.55, "#6f4543"],
        [1, "#a96a4c"],
      ]);
      ctx.fillRect(zc2 - quarryR - 2, topY - 4, quarryR * 2 + 4, ground + 12 - topY);
      // the dust at its foot, and the haze over all of it
      ctx.fillStyle = lin(ctx, 0, topY, 0, ground + 6, [
        [0, "rgba(255,190,140,0)"],
        [1, "rgba(255,170,120,0.38)"],
      ]);
      ctx.fillRect(zc2 - quarryR - 2, topY - 4, quarryR * 2 + 4, ground + 12 - topY);
      // each riser a little darker than the ledge above it
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (Math.abs(a.y - b.y) < 0.5) continue; // a ledge
        const lit = a.x > zc2;
        const top = Math.min(a.y, b.y);
        const bot = Math.max(a.y, b.y);
        ctx.fillStyle = lit ? "rgba(60,26,30,0.38)" : "rgba(8,4,14,0.3)";
        ctx.fillRect(Math.min(a.x, b.x) - 1, top, Math.abs(b.x - a.x) + 2, (bot - top) * 0.9 + (ground - bot) * 0);
      }
      ctx.restore();
      // the ledges catch the light
      for (let i = 1; i < benches.length; i++) {
        const a = benches[i - 1];
        const b = benches[i];
        if (b.x < x0 - 10 || a.x > x1 + 10) continue;
        if (Math.abs(a.y - b.y) >= 0.5) continue;
        const lit = a.x > zc2;
        ctx.fillStyle = lit ? "rgba(255,206,150,0.72)" : "rgba(255,170,120,0.18)";
        ctx.fillRect(a.x, a.y - 1.5, b.x - a.x, 3);
      }
    }
    // the crane
    const cx = zc2 - plateau * 0.4;
    const base = quarryAt(cx);
    if (cx > x0 - w * 0.2 && cx < x1 + w * 0.2 && Number.isFinite(base)) {
      const top = base - h * 0.3;
      const lw = Math.max(1.3, w * 0.0014);
      const mw = w * 0.0065;
      ctx.strokeStyle = "rgb(18,10,20)";
      ctx.fillStyle = "rgb(18,10,20)";
      ctx.lineWidth = lw * 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - mw, base);
      ctx.lineTo(cx - mw, top);
      ctx.moveTo(cx + mw, base);
      ctx.lineTo(cx + mw, top);
      ctx.stroke();
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      const cells = 22;
      for (let i = 0; i < cells; i++) {
        const ya = base + ((top - base) * i) / cells;
        const yb = base + ((top - base) * (i + 1)) / cells;
        ctx.moveTo(i % 2 ? cx + mw : cx - mw, ya);
        ctx.lineTo(i % 2 ? cx - mw : cx + mw, yb);
      }
      ctx.stroke();
      const jibEnd = cx + w * 0.24;
      const cjEnd = cx - w * 0.075;
      ctx.lineWidth = lw * 1.4;
      ctx.beginPath();
      ctx.moveTo(cjEnd, top);
      ctx.lineTo(jibEnd, top);
      ctx.moveTo(cjEnd, top - mw * 1.6);
      ctx.lineTo(jibEnd - w * 0.02, top - mw * 1.6);
      ctx.stroke();
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      const jc = 28;
      for (let i = 0; i < jc; i++) {
        const xa = cjEnd + ((jibEnd - cjEnd) * i) / jc;
        const xb = cjEnd + ((jibEnd - cjEnd) * (i + 1)) / jc;
        ctx.moveTo(xa, i % 2 ? top : top - mw * 1.6);
        ctx.lineTo(xb, i % 2 ? top - mw * 1.6 : top);
      }
      ctx.stroke();
      ctx.fillRect(cx - mw * 1.2, top - mw * 3.4, mw * 2.4, mw * 3.2);
      ctx.fillRect(cjEnd, top, mw * 2.6, mw * 3.4);
      ctx.lineWidth = lw * 0.6;
      ctx.beginPath();
      ctx.moveTo(cx, top - mw * 6.5);
      ctx.lineTo(jibEnd - w * 0.02, top - mw * 1.6);
      ctx.moveTo(cx, top - mw * 6.5);
      ctx.lineTo(cjEnd, top);
      ctx.moveTo(cx, top - mw * 6.5);
      ctx.lineTo(cx, top - mw * 3.4);
      const hookX = cx + w * 0.15;
      ctx.moveTo(hookX, top);
      ctx.lineTo(hookX, top + h * 0.1);
      ctx.stroke();
      ctx.fillRect(hookX - mw * 0.7, top + h * 0.1, mw * 1.4, mw * 1.6);
    }
  }

  // ---- the forest, thinning out at the edges of the trail. Every tree is drawn from its
  // own seed, so each tile paints the same trees.
  {
    const W2 = layerWidth(L, w);
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? "rgb(8,19,28)" : "rgb(5,12,19)";
      let x = -20;
      for (let n = 0; x < W2 + 20; n++) {
        const r = rng(23 + pass * 5003 + n * 7919);
        const step = 7 + r() * 11;
        const dice = r();
        const hh = (0.04 + r() * 0.13) * h;
        const depth = pass === 0 ? 0 : h * (0.01 + r() * 0.025);
        if (x >= x0 - 40 && x <= x1 + 40 && dice <= Math.pow(zoneWeights(x, L, w)[1], 1.1)) {
          conifer(ctx, x, land(x) + depth + hh * 0.18, hh, r);
        }
        x += step;
      }
    }
  }

  // ---- utility poles and their wires, along the highway and into the town
  {
    const W2 = layerWidth(L, w);
    const spacing = 760 * u;
    const poles: { x: number; y: number; ph: number }[] = [];
    for (let n = 0; n * spacing < W2 + spacing; n++) {
      const r = rng(41 + n * 7919);
      const x = n * spacing + r() * 90 * u;
      const wt = zoneWeights(x, L, w);
      const presence = wt[0] * 1 + wt[3] * 0.9;
      if (r() > presence) continue;
      poles.push({ x, y: yh + h * 0.052, ph: h * 0.26 });
    }
    ctx.strokeStyle = "rgb(3,5,13)";
    ctx.lineCap = "round";
    poles.forEach((p, i) => {
      const q = poles[i + 1];
      const lw = Math.max(1.6, 5 * u);
      if (p.x > x0 - 120 && p.x < x1 + 120) {
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y - p.ph);
        ctx.stroke();
        ctx.lineWidth = lw * 0.7;
        ctx.beginPath();
        ctx.moveTo(p.x - 34 * u, p.y - p.ph + 14 * u);
        ctx.lineTo(p.x + 34 * u, p.y - p.ph + 14 * u);
        ctx.stroke();
      }
      if (q && q.x - p.x < spacing * 1.7 && q.x > x0 - 50 && p.x < x1 + 50) {
        ctx.lineWidth = Math.max(0.9, 1.5 * u);
        for (const off of [-1, 0, 1]) {
          const xa = p.x + off * 30 * u;
          const ya = p.y - p.ph + 14 * u + Math.abs(off) * 0;
          const xb = q.x + off * 30 * u;
          const sag = (xb - xa) * 0.045;
          ctx.beginPath();
          ctx.moveTo(xa, ya);
          ctx.quadraticCurveTo((xa + xb) / 2, ya + sag * 2, xb, ya);
          ctx.stroke();
        }
      }
    });
  }

  // ---- the town: houses with their lights coming on, trees between them, street lamps
  {
    const W2 = layerWidth(L, w);
    const yBase = yh + h * 0.052;
    const zc3 = sceneCenter(L, 3, w);
    let x = zc3 - w * 1.2;
    const houses: { x: number; bw: number; bh: number; roof: number; chim: number; sw: number }[] = [];
    for (let n = 0; x < Math.min(W2 + 200, zc3 + w * 1.6); n++) {
      const r = rng(33 + n * 7919);
      const bw = (210 + r() * 150) * u;
      houses.push({ x, bw, bh: (96 + r() * 64) * u, roof: (62 + r() * 44) * u, chim: r(), sw: r() });
      x += bw + (30 + r() * 110) * u;
    }
    // trees first, then the houses in front of them
    ctx.fillStyle = "rgb(6,9,24)";
    for (const hs of houses) {
      const wt = zoneWeights(hs.x + hs.bw / 2, L, w)[3];
      if (hs.sw > wt + 0.35) continue;
      const tx = hs.x - 50 * u + hs.sw * hs.bw;
      const rr = (34 + hs.chim * 34) * u;
      if (tx + rr * 2 < x0 || tx - rr * 2 > x1) continue;
      // a tree is a few lumps of foliage on a trunk
      ctx.fillRect(tx - 3 * u, yBase - rr * 1.4, 6 * u, rr * 1.4 + 4);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + hs.sw * 6;
        ctx.beginPath();
        ctx.ellipse(tx + Math.cos(a) * rr * 0.5, yBase - rr * 2 + Math.sin(a) * rr * 0.55, rr * 0.78, rr * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(tx, yBase - rr * 2, rr * 0.9, rr * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const hs of houses) {
      const wt = zoneWeights(hs.x + hs.bw / 2, L, w)[3];
      if (hs.sw > wt + 0.2) continue; // thin at the edge of town
      if (hs.x + hs.bw < x0 - 20 || hs.x > x1 + 20) continue;
      ctx.fillStyle = "rgb(5,8,22)";
      ctx.fillRect(hs.x, yBase - hs.bh, hs.bw, hs.bh + 4);
      ctx.beginPath();
      ctx.moveTo(hs.x - 14 * u, yBase - hs.bh);
      ctx.lineTo(hs.x + hs.bw / 2, yBase - hs.bh - hs.roof);
      ctx.lineTo(hs.x + hs.bw + 14 * u, yBase - hs.bh);
      ctx.closePath();
      ctx.fill();
      if (hs.chim < 0.6) ctx.fillRect(hs.x + hs.bw * (0.62 + hs.chim * 0.3), yBase - hs.bh - hs.roof * 0.82, 16 * u, hs.roof * 0.6);
      const cols = Math.max(2, Math.floor(hs.bw / (62 * u)));
      for (let c = 0; c < cols; c++) {
        const wx = hs.x + 22 * u + c * ((hs.bw - 44 * u - 24 * u) / Math.max(1, cols - 1));
        const lit = (hs.sw * 7 + c * 0.37) % 1 < 0.55;
        ctx.fillStyle = lit ? "rgba(255,200,125,0.95)" : "rgba(46,56,104,0.4)";
        ctx.fillRect(wx, yBase - hs.bh + 20 * u, 24 * u, 32 * u);
        if (lit) glow(ctx, wx + 12 * u, yBase - hs.bh + 36 * u, 56 * u, "rgba(255,190,110,1)", 0.3);
      }
    }
    // street lamps
    const spacing = 920 * u;
    for (let n = 0; n * spacing < W2; n++) {
      const lx = n * spacing + 330 * u;
      const wt = zoneWeights(lx, L, w)[3];
      if (wt < 0.35 || lx < x0 - 200 || lx > x1 + 200) continue;
      const top = yBase - h * 0.2;
      ctx.fillStyle = "rgb(3,5,13)";
      ctx.fillRect(lx - 3 * u, top, 6 * u, yBase - top + 4);
      ctx.beginPath();
      ctx.moveTo(lx - 3 * u, top + 6 * u);
      ctx.quadraticCurveTo(lx - 3 * u, top - 22 * u, lx + 46 * u, top - 18 * u);
      ctx.lineTo(lx + 46 * u, top - 12 * u);
      ctx.quadraticCurveTo(lx + 4 * u, top - 14 * u, lx + 3 * u, top + 6 * u);
      ctx.fill();
      glow(ctx, lx + 46 * u, top - 10 * u, 130 * u * wt, "rgba(255,196,120,1)", 0.55 * wt);
      glow(ctx, lx + 46 * u, top - 10 * u, 22 * u, "rgba(255,236,190,1)", 0.9 * wt);
    }
  }
}

// ================================================================== the road

const SURFACE_TOP = pal("#17203a", "#2c2622", "#523c3e", "#1a2040");
const SURFACE_BOT = pal("#05070f", "#120e0c", "#1d1319", "#070a16");
const VERGE = pal("#050a1a", "#0b1a12", "#3a2a30", "#2a2f55");

function paintRoad(ctx: Ctx, w: number, h: number, x0: number, x1: number) {
  const L: PanoLayer = "road";
  const yF = h * GEO.roadFar;
  const yN = h * GEO.roadNear;
  const u = h / 1080;
  const STEP = 8;

  // ---- the surface: far verge, the road, the near verge
  for (let x = Math.floor(x0 / STEP) * STEP - STEP; x < x1 + STEP; x += STEP) {
    const wt = zoneWeights(x + STEP / 2, L, w);
    const top = mixRGB(wt, SURFACE_TOP);
    const bot = mixRGB(wt, SURFACE_BOT);
    const verge = mixRGB(wt, VERGE);
    ctx.fillStyle = css(verge);
    ctx.fillRect(x, yF - h * 0.03, STEP + 0.8, h * 0.03 + 1);
    ctx.fillStyle = lin(ctx, 0, yF, 0, yN, [[0, css(top)], [0.55, css(mix(top, bot, 0.7))], [1, css(bot)]]);
    ctx.fillRect(x, yF, STEP + 0.8, yN - yF);
    ctx.fillStyle = css(mix(bot, verge, 0.15));
    ctx.fillRect(x, yN - 0.5, STEP + 0.8, h - yN + 1);
  }

  // ---- the highway: edge lines, and the broken yellow line down the middle
  {
    const dash = 470 * u;
    const gap = 1400 * u;
    for (let x = -dash; x < layerWidth(L, w) + gap; x += dash + gap) {
      const wt = zoneWeights(x + dash / 2, L, w)[0];
      if (wt < 0.3 || x + dash < x0 || x > x1) continue;
      ctx.fillStyle = `rgba(244,188,70,${(0.78 * wt).toFixed(3)})`;
      ctx.fillRect(x, h * 0.742, dash, 4 * u);
    }
    // edge lines fade in and out with the highway
    zoneStrip(ctx, L, w, 0, x0, x1, yF + 5 * u, 4 * u, "232,238,255", 0.58);
    zoneStrip(ctx, L, w, 0, x0, x1, yN - 11 * u, 4 * u, "232,238,255", 0.58);
  }

  // ---- the trail: ruts, puddles holding the sky, gravel
  {
    zoneStrip(ctx, L, w, 1, x0, x1, h * 0.77, h * 0.024, "6,5,5", 0.34);
    zoneStrip(ctx, L, w, 1, x0, x1, h * 0.83, h * 0.024, "6,5,5", 0.34);
    const W2 = layerWidth(L, w);
    for (let n = 0; n < 40; n++) {
      const r = rng(17 + n * 7919);
      const px = r() * W2;
      const py = h * (0.79 + r() * 0.1);
      const pw = (90 + r() * 230) * u;
      const wt = zoneWeights(px, L, w)[1];
      if (wt < 0.45 || px + pw < x0 || px - pw > x1) continue;
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, 0.12);
      ctx.fillStyle = radial(ctx, 0, 0, pw, [[0, `rgba(120,150,170,${(0.5 * wt).toFixed(2)})`], [1, "rgba(120,150,170,0)"]]);
      ctx.beginPath();
      ctx.arc(0, 0, pw, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (let n = 0; n < 900; n++) {
      const r = rng(19 + n * 7919);
      const px = r() * W2;
      const py = yF + r() * (yN - yF);
      const dice = r();
      const alpha = 0.06 + r() * 0.1;
      const s = (1 + r() * 2.4) * u;
      if (px < x0 - 4 || px > x1 + 4) continue;
      const wz = zoneWeights(px, L, w);
      if (dice > Math.max(wz[1], wz[2])) continue;
      ctx.fillStyle = `rgba(190,170,150,${alpha.toFixed(3)})`;
      ctx.fillRect(px, py, s * 1.6, s);
    }
  }

  // ---- the quarry's haul road: dust, the ghosts of old tracks
  {
    const W2 = layerWidth(L, w);
    for (let n = 0; n < 26; n++) {
      const r = rng(29 + n * 7919);
      const px = r() * W2;
      const py = h * (0.775 + r() * 0.12);
      const pw = (160 + r() * 380) * u;
      const wt = zoneWeights(px, L, w)[2];
      if (wt < 0.4 || px + pw < x0 || px - pw > x1) continue;
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, 0.08);
      ctx.fillStyle = radial(ctx, 0, 0, pw, [[0, `rgba(255,200,150,${(0.1 * wt).toFixed(2)})`], [1, "rgba(255,200,150,0)"]]);
      ctx.beginPath();
      ctx.arc(0, 0, pw, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---- the town: a kerb and pavement on the far side, a white dashed line
  {
    zoneStrip(ctx, L, w, 3, x0, x1, yF - h * 0.026, h * 0.026 + 2, "58,62,104", 1);
    zoneStrip(ctx, L, w, 3, x0, x1, yF - h * 0.0035, 3.5 * u, "110,116,170", 0.5);
    zoneStrip(ctx, L, w, 3, x0, x1, yF, 7 * u, "20,24,52", 1);
    const dash = 300 * u;
    const gap = 560 * u;
    for (let x = -dash; x < layerWidth(L, w) + gap; x += dash + gap) {
      const wt = zoneWeights(x + dash / 2, L, w)[3];
      if (wt < 0.3 || x + dash < x0 || x > x1) continue;
      ctx.fillStyle = `rgba(226,232,255,${(0.5 * wt).toFixed(3)})`;
      ctx.fillRect(x, h * 0.742, dash, 4 * u);
    }
  }
}

function radial(ctx: Ctx, x: number, y: number, r: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

// ============================================================ the foreground

function paintFore(ctx: Ctx, w: number, h: number, x0: number, x1: number) {
  const L: PanoLayer = "fore";
  const u = h / 1080;
  const W2 = layerWidth(L, w);

  // a dark band along the bottom, which the words sit on
  ctx.fillStyle = lin(ctx, 0, h * 0.9, 0, h, [[0, "rgba(2,4,9,0)"], [0.5, "rgba(2,4,9,0.6)"], [1, "rgba(2,4,9,0.96)"]]);
  ctx.fillRect(x0, h * 0.9, x1 - x0, h * 0.1 + 1);

  ctx.fillStyle = "rgb(2,4,10)";
  // the highway's verge: grass
  for (let n = 0; n < Math.round(W2 / 5); n++) {
    const r = rng(77 + n * 7919);
    const x = r() * W2;
    const bh = (10 + r() * 40) * u;
    const lean = (r() - 0.5) * 16 * u;
    const dice = r();
    const base = h * (0.985 + r() * 0.02);
    if (x < x0 - 30 || x > x1 + 30) continue;
    const wt = zoneWeights(x, L, w);
    if (dice > wt[0] * 0.8 + wt[2] * 0.25 + wt[3] * 0.15) continue;
    ctx.beginPath();
    ctx.moveTo(x - 2.2 * u, base);
    ctx.quadraticCurveTo(x + lean * 0.4, base - bh * 0.55, x + lean, base - bh);
    ctx.quadraticCurveTo(x + lean * 0.5 + 1.4, base - bh * 0.5, x + 2.2 * u, base);
    ctx.fill();
  }

  // the trail: ferns and rocks
  for (let n = 0; n < Math.round(W2 / 60); n++) {
    const r = rng(81 + n * 7919);
    const x = r() * W2;
    const sz = (26 + r() * 70) * u;
    const dice = r();
    const y = h * (0.995 + r() * 0.01);
    const rock = r() < 0.45;
    if (x < x0 - 120 || x > x1 + 120 || dice > zoneWeights(x, L, w)[1]) continue;
    if (rock) {
      ctx.beginPath();
      ctx.moveTo(x - sz, y);
      ctx.lineTo(x - sz * 0.7, y - sz * 0.5);
      ctx.lineTo(x - sz * 0.1, y - sz * 0.72);
      ctx.lineTo(x + sz * 0.45, y - sz * 0.55);
      ctx.lineTo(x + sz, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(190,215,235,0.14)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k - 3) * 0.32;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a) * sz * 0.6, y + Math.sin(a) * sz * 0.9, x + Math.cos(a) * sz, y + Math.sin(a) * sz * 0.6);
        ctx.quadraticCurveTo(x + Math.cos(a) * sz * 0.55, y + Math.sin(a) * sz * 0.5, x, y);
        ctx.fill();
      }
    }
  }

  // the quarry: heaps of gravel
  for (let n = 0; n < Math.round(W2 / 500); n++) {
    const r = rng(83 + n * 7919);
    const x = r() * W2;
    const hw = (160 + r() * 260) * u;
    const hh = (40 + r() * 70) * u;
    const dice = r();
    const bumps = Array.from({ length: 29 }, () => 0.88 + r() * 0.12);
    if (x < x0 - hw || x > x1 + hw || dice > zoneWeights(x, L, w)[2]) continue;
    ctx.beginPath();
    ctx.moveTo(x - hw, h * 1.01);
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const tri = 1 - Math.abs(t * 2 - 1);
      ctx.lineTo(x - hw + t * hw * 2, h * 1.01 - Math.pow(tri, 0.8) * hh * bumps[i]);
    }
    ctx.lineTo(x + hw, h * 1.01);
    ctx.closePath();
    ctx.fillStyle = "rgb(20,12,22)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,168,100,0.3)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // the town: a hedge, and a picket fence
  ctx.fillStyle = "rgb(2,4,10)";
  for (let n = 0; n < Math.round(W2 / 70); n++) {
    const r = rng(87 + n * 7919);
    const x = r() * W2;
    const rr = (34 + r() * 50) * u;
    const dice = r();
    if (x < x0 - rr * 2 || x > x1 + rr * 2 || dice > zoneWeights(x, L, w)[3] * 0.9) continue;
    ctx.beginPath();
    ctx.ellipse(x, h * 1.02, rr * 1.4, rr, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let x = Math.floor((x0 - 20) / 30) * 30; x < x1 + 20; x += 30) {
    const wt = zoneWeights(x, L, w)[3];
    if (wt < 0.55) continue;
    const fh = h * 0.1 * wt;
    ctx.beginPath();
    ctx.moveTo(x, h * 1.01);
    ctx.lineTo(x, h - fh);
    ctx.lineTo(x + 9 * u, h - fh - 14 * u);
    ctx.lineTo(x + 18 * u, h - fh);
    ctx.lineTo(x + 18 * u, h * 1.01);
    ctx.closePath();
    ctx.fill();
  }
}

// ============================================================== the entry point

export type TileJob = {
  layer: PanoLayer;
  /** The stage's size, in CSS px. */
  w: number;
  h: number;
  /** The tile, in the layer's own coordinates. */
  x0: number;
  x1: number;
};

/** Paints one tile of one layer. `ctx` is already positioned so the layer's own
 * coordinates fall on the tile. */
export function paintTile(ctx: Ctx, job: TileJob) {
  const { layer, w, h, x0, x1 } = job;
  ctx.save();
  if (layer === "mid") paintMid(ctx, w, h, x0, x1);
  else if (layer === "road") paintRoad(ctx, w, h, x0, x1);
  else paintFore(ctx, w, h, x0, x1);
  ctx.restore();
}
