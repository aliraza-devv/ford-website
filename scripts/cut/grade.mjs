// Sets a cut-out car for the dusk it stands in. A photograph of a car in a studio is lit from
// every side by a white room; at the end of the day the light is behind it, in the sky, and the
// ground is dark. So: take the light down, tint what is left with the place's own colour, let the
// sky show on the upper surfaces and the dark ground on the lower, put a thin rim of the horizon's
// light along the roof, darken the glass, and switch the lamps on.

const toLin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  toLin[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const toSrgb = (l) => {
  const v = Math.min(Math.max(l, 0), 1);
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
};
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const hex = (h) => [1, 3, 5].map((i) => toLin[parseInt(h.slice(i, i + 2), 16)]);

/**
 * Fills `polys` (in the photograph's px) into a 0-1 plane the size of the cut picture, softened,
 * and says how far down its own outline each pixel is (0 at the top, 1 at the bottom).
 */
function paintPolys(polys, cutOut, W, H, offX, offY) {
  const mask = new Float32Array(W * H);
  const down = new Float32Array(W * H);
  for (const poly of polys) {
    const pts = poly.map(([sx, sy]) => {
      const [x, y] = cutOut.at(sx, sy);
      return [x + offX, y + offY];
    });
    let x0 = W;
    let x1 = 0;
    let y0 = H;
    let y1 = 0;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i];
          const [xj, yj] = pts[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) {
          mask[y * W + x] = 1;
          down[y * W + x] = clamp01((y - y0) / Math.max(y1 - y0, 1));
        }
      }
    }
  }
  // soften the mask by a box blur, twice
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += mask[y * W + Math.min(Math.max(x + k, 0), W - 1)];
        tmp[y * W + x] = s / 5;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += tmp[Math.min(Math.max(y + k, 0), H - 1) * W + x];
        mask[y * W + x] = s / 5;
      }
    }
  }
  return { mask, down };
}

export function grade(cutOut, car) {
  const look = car.look;
  const PAD = 60; // room round the car for the light the lamps throw
  const AHEAD = 220; // and, in front of it, for the cone of the headlamps
  const W = cutOut.width + 2 * PAD + AHEAD;
  const H = cutOut.height + 2 * PAD;
  // the cut picture sits here; the room ahead is on the right, where every car's nose is
  const offX = PAD;
  const offY = PAD;
  const src = cutOut.rgba;
  const alpha = new Float32Array(W * H);
  const lin = new Float32Array(W * H * 3);
  for (let y = 0; y < cutOut.height; y++) {
    for (let x = 0; x < cutOut.width; x++) {
      const i = (y * cutOut.width + x) * 4;
      const o = (y + offY) * W + (x + offX);
      alpha[o] = src[i + 3] / 255;
      lin[o * 3] = toLin[src[i]];
      lin[o * 3 + 1] = toLin[src[i + 1]];
      lin[o * 3 + 2] = toLin[src[i + 2]];
    }
  }

  // where the car is: its top row, its tyres' row
  let top = H;
  for (let y = 0; y < H && top === H; y++) for (let x = 0; x < W; x++) if (alpha[y * W + x] > 0.5) { top = y; break; }
  const bottom = cutOut.contact + offY;
  const body = Math.max(bottom - top, 1);

  // the top edge of the car, column by column, smoothed (the cut's own edge is a little ragged),
  // and how level it is: the rim runs along the roof, the hood and the rail, and only faintly down
  // the steep edges
  const raw = new Float32Array(W).fill(-1);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (alpha[y * W + x] > 0.5) { raw[x] = y; break; }
  const edge = new Float32Array(W).fill(-1);
  const level = new Float32Array(W);
  const R = 7;
  for (let x = 0; x < W; x++) {
    if (raw[x] < 0) continue;
    let s = 0;
    let n = 0;
    for (let k = -R; k <= R; k++) {
      const v = raw[Math.min(Math.max(x + k, 0), W - 1)];
      if (v >= 0) {
        s += v;
        n++;
      }
    }
    edge[x] = n ? s / n : raw[x];
  }
  for (let x = 0; x < W; x++) {
    const a = edge[Math.max(x - 6, 0)];
    const b = edge[Math.min(x + 6, W - 1)];
    level[x] = a < 0 || b < 0 ? 0 : 1 - smooth(0.15, 1.1, Math.abs(b - a) / 12);
  }

  const glass = look.glass ? paintPolys(car.glass ?? [], cutOut, W, H, offX, offY) : null;
  const tint = look.tint;
  const sky = hex(look.sky);
  const rim = hex(look.rim);

  const out = new Float32Array(W * H * 3); // premultiplied linear colour
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const a = alpha[p];
      if (a <= 0) continue;
      const v = clamp01((y - top) / body); // 0 at the roof, 1 at the tyres
      let r = lin[p * 3];
      let g = lin[p * 3 + 1];
      let b = lin[p * 3 + 2];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // the light is taken down, most of all low on the car, where it faces the dark road
      const gain = look.exposure * (1 - (1 - look.ground) * smooth(0.28, 0.95, v));
      r *= gain * tint[0];
      g *= gain * tint[1];
      b *= gain * tint[2];

      // the sky on the upper surfaces: a sheen, stronger where the paint is lighter
      const sheen = (1 - smooth(0.0, 0.5, v)) * (0.2 + 0.8 * Math.sqrt(L)) * look.sheen;
      r += sky[0] * sheen;
      g += sky[1] * sheen;
      b += sky[2] * sheen;

      // the glass: dark, with the sky only in the top of each window
      if (glass) {
        const gm = glass.mask[p];
        if (gm > 0.001) {
          const keep = 1 - gm * (1 - look.glass.dark);
          const refl = gm * look.glass.sheen * (1 - glass.down[p]) ** 2.4;
          r = r * keep + sky[0] * refl;
          g = g * keep + sky[1] * refl;
          b = b * keep + sky[2] * refl;
        }
      }

      // a rim of the horizon's light along the top edge, on the paint and not on the black trim
      const e = edge[x];
      if (e >= 0) {
        const d = y - e;
        if (d > -2) {
          const w = Math.exp(-((Math.max(d, 0) / look.rimWidth) ** 2)) * (0.3 + 0.7 * level[x]) * Math.sqrt(L) * look.rimStrength;
          r += rim[0] * w;
          g += rim[1] * w;
          b += rim[2] * w;
        }
      }

      // contrast, about a mid grey that is low (it is a dark picture)
      const k = look.contrast;
      r = 0.18 * (r / 0.18) ** k;
      g = 0.18 * (g / 0.18) ** k;
      b = 0.18 * (b / 0.18) ** k;

      out[p * 3] = r * a;
      out[p * 3 + 1] = g * a;
      out[p * 3 + 2] = b * a;
    }
  }

  // the lamps: a bloom round the lens and, for the headlamps, a faint cone ahead
  const outA = Float32Array.from(alpha);
  for (const lamp of car.lamps ?? []) {
    const [lx, ly] = cutOut.at(lamp.x, lamp.y);
    const cx = lx + offX;
    const cy = ly + offY;
    const col = hex(lamp.color);
    const reach = Math.ceil(Math.max(lamp.rx, lamp.ry) * 3 + (lamp.cone ?? 0));
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(H - 1, Math.ceil(cy + reach)); y++) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(W - 1, Math.ceil(cx + reach)); x++) {
        const dx = (x - cx) / lamp.rx;
        const dy = (y - cy) / lamp.ry;
        const bloom = Math.exp(-(dx * dx + dy * dy) * 1.4) * lamp.glow;
        const core = Math.exp(-(((x - cx) / (lamp.rx * 0.16)) ** 2 + ((y - cy) / (lamp.ry * 0.2)) ** 2)) * lamp.core;
        // the cone: the headlamp's light in the dusk air ahead of the car, widening and fading
        let cone = 0;
        if (lamp.cone) {
          const ahead = x - cx;
          if (ahead > 0) {
            const spread = lamp.ry * (0.7 + (ahead / lamp.cone) * 0.9);
            cone = Math.exp(-(((y - cy - ahead * 0.035) / spread) ** 2)) * Math.exp(-ahead / (lamp.cone * 0.55)) * lamp.coneGlow * smooth(0, lamp.rx * 0.6, ahead);
          }
        }
        const e = bloom + core + cone;
        if (e < 0.002) continue;
        const p = y * W + x;
        // additive light: it adds to the colour, and a little to the opacity so it shows in the air
        out[p * 3] += col[0] * e;
        out[p * 3 + 1] += col[1] * e;
        out[p * 3 + 2] += col[2] * e;
        outA[p] = Math.min(1, outA[p] + (bloom + cone) * lamp.air + core);
      }
    }
  }

  // un-premultiply and write
  const rgba = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const a = outA[p];
    if (a <= 0.001) continue;
    rgba[p * 4] = toSrgb(out[p * 3] / a);
    rgba[p * 4 + 1] = toSrgb(out[p * 3 + 1] / a);
    rgba[p * 4 + 2] = toSrgb(out[p * 3 + 2] / a);
    rgba[p * 4 + 3] = Math.round(clamp01(a) * 255);
  }
  return { rgba, width: W, height: H, contact: bottom, carLeft: cutOut.carLeft + offX, carRight: cutOut.carRight + offX };
}
