// Cuts a car out of a photograph on a white ground. The ground is the white that reaches the
// picture's edge; the shadow on it is removed by shape (the tyres are circles, the sill a
// rectangle), because a shadow under a car is as dark as the car's underside.

const UP = 2; // the cut is made at twice the photograph's size, so its edge is cleaner
const WHITE = 247; // a pixel whose darkest channel is at least this is ground, if it joins the edge

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** How much of a source pixel at (sx, sy) the car's recipe lets stay below its ground line. */
function allowed(car, sx, sy, lum) {
  if (sy < car.groundY) return 1;
  let a = 0;
  for (const t of car.tyres) a = Math.max(a, smooth(t.r + 1.1, t.r - 0.7, Math.hypot(sx - t.x, sy - t.y)));
  for (const [x0, y0, x1, y1] of car.keep ?? []) {
    const inside = Math.min(smooth(x0 - 0.8, x0 + 0.8, sx), smooth(x1 + 0.8, x1 - 0.8, sx), smooth(y0 - 0.8, y0 + 0.8, sy), smooth(y1 + 0.8, y1 - 0.8, sy));
    a = Math.max(a, inside);
  }
  // Where the shadow is lighter than the car's black parts, the car's blacks are kept by their
  // colour, down to the shadow's top edge.
  if (car.darkKeep && sy < (car.darkKeepY ?? Infinity)) a = Math.max(a, 1 - smooth(car.darkKeep[0], car.darkKeep[1], lum));
  return a;
}

const inRect = (rects, sx, sy) => (rects ?? []).some(([x0, y0, x1, y1]) => sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1);

/** 5-tap blur, twice (about sigma 1.2), on a Float32 plane. */
function blur(a, W, H) {
  const k = [0.06, 0.24, 0.4, 0.24, 0.06];
  const tmp = new Float32Array(a.length);
  const out = new Float32Array(a.length);
  for (let pass = 0; pass < 1; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let j = -2; j <= 2; j++) s += a[y * W + Math.min(Math.max(x + j, 0), W - 1)] * k[j + 2];
        tmp[y * W + x] = s;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let j = -2; j <= 2; j++) s += tmp[Math.min(Math.max(y + j, 0), H - 1) * W + x] * k[j + 2];
        out[y * W + x] = s;
      }
    }
  }
  return out;
}

export async function cut(sharp, input, car) {
  const meta = await sharp(input).metadata();
  const W = meta.width * UP;
  const H = meta.height * UP;
  const { data } = await sharp(input).resize(W, H, { kernel: "lanczos3" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const N = W * H;

  // ---- the ground: white that reaches the edge
  const ground = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0;
  let qt = 0;
  const minOf = (i) => Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  const push = (i) => {
    if (!ground[i] && minOf(i) >= WHITE) {
      ground[i] = 1;
      queue[qt++] = i;
    }
  };
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % W;
    const y = (i / W) | 0;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }

  // ---- the car: what is not ground, less the shadow under it
  const a0 = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (ground[i]) continue;
      const sx = (x + 0.5) / UP;
      const sy = (y + 0.5) / UP;
      if (inRect(car.erase, sx, sy)) continue;
      const lum = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
      let a = allowed(car, sx, sy, lum);
      // Below the ground line there is no body of the car as light as the ground: what is that
      // light is the gap between the underside and the shadow, which the flood could not reach,
      // and the soft edge between it and the car.
      if (sy >= (car.whiteFrom ?? car.groundY)) a *= 1 - smooth(120, 232, minOf(i));
      a0[i] = a;
    }
  }

  // ---- a clean edge: take off the pixel that still carries the white of the ground, then soften
  const eroded = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let m = a0[i];
      if (x > 0) m = Math.min(m, a0[i - 1]);
      if (x < W - 1) m = Math.min(m, a0[i + 1]);
      if (y > 0) m = Math.min(m, a0[i - W]);
      if (y < H - 1) m = Math.min(m, a0[i + W]);
      eroded[i] = m;
    }
  }
  const alpha = blur(eroded, W, H);

  // ---- the colour at the edge comes from inside it, so no white shows through the softening
  const col = new Float32Array(N * 3);
  const have = new Uint8Array(N);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      // interior: opaque, and everything within two pixels is too
      let inside = eroded[i] > 0.98;
      for (let j = -2; inside && j <= 2; j += 2) {
        for (let k = -2; k <= 2; k += 2) {
          if (eroded[i + j * W + k] < 0.98) {
            inside = false;
            break;
          }
        }
      }
      if (inside) {
        have[i] = 1;
        col[i * 3] = data[i * 3];
        col[i * 3 + 1] = data[i * 3 + 1];
        col[i * 3 + 2] = data[i * 3 + 2];
      }
    }
  }
  for (let round = 0; round < 4; round++) {
    const fresh = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (have[i] || alpha[i] < 0.004) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let j = -1; j <= 1; j++) {
          for (let k = -1; k <= 1; k++) {
            const m = i + j * W + k;
            if (have[m]) {
              r += col[m * 3];
              g += col[m * 3 + 1];
              b += col[m * 3 + 2];
              n++;
            }
          }
        }
        if (n) fresh.push(i, r / n, g / n, b / n);
      }
    }
    for (let f = 0; f < fresh.length; f += 4) {
      const i = fresh[f];
      have[i] = 1;
      col[i * 3] = fresh[f + 1];
      col[i * 3 + 1] = fresh[f + 2];
      col[i * 3 + 2] = fresh[f + 3];
    }
  }

  // ---- crop to the car
  let x0 = W;
  let x1 = 0;
  let y0 = H;
  let y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alpha[y * W + x] > 0.04) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const PAD = 6;
  x0 = Math.max(0, x0 - PAD);
  y0 = Math.max(0, y0 - PAD);
  x1 = Math.min(W - 1, x1 + PAD);
  y1 = Math.min(H - 1, y1 + PAD);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const rgba = Buffer.alloc(cw * ch * 4);
  let carLeft = cw;
  let carRight = 0;
  let contact = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y + y0) * W + (x + x0);
      const ox = car.flip ? cw - 1 - x : x;
      const o = (y * cw + ox) * 4;
      const a = alpha[i];
      const c = have[i] ? i : -1;
      rgba[o] = Math.round(c >= 0 ? col[c * 3] : data[i * 3]);
      rgba[o + 1] = Math.round(c >= 0 ? col[c * 3 + 1] : data[i * 3 + 1]);
      rgba[o + 2] = Math.round(c >= 0 ? col[c * 3 + 2] : data[i * 3 + 2]);
      rgba[o + 3] = Math.round(a * 255);
      if (a > 0.5) {
        if (ox < carLeft) carLeft = ox;
        if (ox > carRight) carRight = ox;
        if (y > contact) contact = y;
      }
    }
  }
  return {
    rgba,
    width: cw,
    height: ch,
    carLeft,
    carRight,
    contact: contact + 1,
    /** A point in the photograph (px) -> a point in the cut picture. */
    at: (sx, sy) => {
      const x = sx * UP - x0;
      return [car.flip ? cw - 1 - x : x, sy * UP - y0];
    },
    scale: UP,
  };
}
