import * as THREE from "three";

/**
 * Every texture the world uses is generated here from seeded noise, so the
 * project ships no image assets and the result is identical run to run.
 * All of this is client-only (it touches <canvas>); the Canvas that calls it
 * is already mounted with ssr: false.
 */

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Value noise on a wrapping lattice, so every map built from it tiles. */
function tileableFbm(
  width: number,
  height: number,
  opts: { cellsX: number; cellsY: number; octaves: number; persistence?: number; seed: number },
): Float32Array {
  const { cellsX, cellsY, octaves, persistence = 0.5, seed } = opts;
  const out = new Float32Array(width * height);
  const rand = mulberry32(seed);
  let amp = 1;
  let total = 0;

  for (let o = 0; o < octaves; o++) {
    const nx = cellsX << o;
    const ny = cellsY << o;
    const grid = new Float32Array(nx * ny);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();

    for (let y = 0; y < height; y++) {
      const v = (y / height) * ny;
      const y0 = Math.floor(v);
      const fy = v - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const ya = y0 % ny;
      const yb = (y0 + 1) % ny;
      for (let x = 0; x < width; x++) {
        const u = (x / width) * nx;
        const x0 = Math.floor(u);
        const fx = u - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const xa = x0 % nx;
        const xb = (x0 + 1) % nx;
        const top = grid[ya * nx + xa] * (1 - sx) + grid[ya * nx + xb] * sx;
        const bottom = grid[yb * nx + xa] * (1 - sx) + grid[yb * nx + xb] * sx;
        out[y * width + x] += (top * (1 - sy) + bottom * sy) * amp;
      }
    }
    total += amp;
    amp *= persistence;
  }

  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

function grayTexture(width: number, height: number, value: (i: number) => number) {
  const { canvas, ctx } = makeCanvas(width, height);
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const g = Math.round(Math.min(Math.max(value(i), 0), 1) * 255);
    image.data[i * 4] = g;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = g;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Wet/dry patches. The reflector reads this map's GREEN channel as
 * roughness: low (0.10) is a wet, mirror-like patch, high (0.82) is dry
 * tarmac. Mostly wet with dry islands, as just after rain.
 */
export function makeRoughnessTexture(): THREE.CanvasTexture {
  const size = 1024;
  const broad = tileableFbm(size, size, { cellsX: 4, cellsY: 4, octaves: 5, persistence: 0.55, seed: 11 });
  const fine = tileableFbm(size, size, { cellsX: 64, cellsY: 64, octaves: 2, persistence: 0.5, seed: 29 });
  return grayTexture(size, size, (i) => {
    const wet = smooth(0.4, 0.6, broad[i]);
    return THREE.MathUtils.lerp(0.82, 0.16, wet) + (fine[i] - 0.5) * 0.08;
  });
}

/**
 * Paint alpha along one 12 m period (texture height). `dashed` gives the
 * 3 m dash / 9 m gap; otherwise solid. Either way the alpha is worn: a
 * noise mask between 0.75 and 1.0, so the paint looks scuffed without ever
 * being brightened artificially (alphaMap reads the GREEN channel).
 */
export function makePaintAlphaTexture(dashed: boolean): THREE.CanvasTexture {
  const w = 16;
  const h = 1024;
  const wear = tileableFbm(w, h, { cellsX: 2, cellsY: 24, octaves: 3, persistence: 0.6, seed: dashed ? 41 : 43 });
  const dashLen = h * (3 / 12);
  return grayTexture(w, h, (i) => {
    const y = Math.floor(i / w);
    const base = dashed ? smooth(0, 3, y) * (1 - smooth(dashLen - 3, dashLen, y)) : 1;
    return base * (0.75 + 0.25 * smooth(0.25, 0.75, wear[i]));
  });
}

// ------------------------------------------------------ horizon silhouettes

/** Mixes a hex colour toward the horizon glow -- distant layers sit in haze,
 * but only a little: a silhouette has to stay DARKER than the glow behind
 * it, or it stops reading as a silhouette and becomes a lit wall. */
function hazed(hex: string, toward: string, amount: number) {
  return new THREE.Color(hex).lerp(new THREE.Color(toward), amount).getStyle();
}

function finishSilhouette(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A thin elevated road deck on slim pillars, with a few lamps along it.
 * Low and long; nearly all of the texture is empty. */
export function makeInterchangeTexture(glowHex: string, haze: number): THREE.CanvasTexture {
  const w = 2048;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);
  const rand = mulberry32(71);
  ctx.fillStyle = hazed("#01030a", glowHex, haze);

  const deckY = h * 0.66;
  ctx.fillRect(0, deckY, w, 4); // the deck itself
  ctx.fillRect(0, deckY - 3, w, 1.5); // parapet
  for (let x = 60; x < w; x += 170 + rand() * 140) ctx.fillRect(x, deckY, 3, h - deckY);
  // One gentle rise where a slip road peels off.
  ctx.beginPath();
  ctx.moveTo(w * 0.58, deckY + 4);
  ctx.quadraticCurveTo(w * 0.68, deckY - 16, w * 0.8, deckY + 4);
  ctx.fill();
  // Lamp posts along the parapet.
  for (let x = 40; x < w; x += 120 + rand() * 60) ctx.fillRect(x, deckY - 9, 1.5, 7);
  ctx.fillRect(0, h - 3, w, 3);
  return finishSilhouette(canvas);
}

/** A distant industrial cluster: a few tanks and stacks, a couple of lit
 * windows. Cool white and blue only -- nothing red, so no aircraft-warning
 * lights. */
export function makeIndustrialTexture(glowHex: string, haze: number): THREE.CanvasTexture {
  const w = 1024;
  const h = 192;
  const { canvas, ctx } = makeCanvas(w, h);
  const rand = mulberry32(97);
  ctx.fillStyle = hazed("#01030a", glowHex, haze);

  let x = 60;
  while (x < w - 120) {
    const kind = rand();
    const bw = 34 + rand() * 60;
    const bh = 22 + rand() * 46;
    if (kind < 0.4) {
      ctx.fillRect(x, h - bh, bw, bh); // tank / block
      ctx.fillRect(x + bw * 0.25, h - bh - 6, bw * 0.5, 6);
    } else if (kind < 0.75) {
      const sw = 5 + rand() * 4; // stack
      ctx.fillRect(x, h - bh * 1.8, sw, bh * 1.8);
    } else {
      ctx.fillRect(x, h - bh * 0.5, bw * 1.2, bh * 0.5); // low shed
    }
    x += bw + 70 + rand() * 120;
  }
  ctx.fillRect(0, h - 3, w, 3);

  for (let i = 0; i < 9; i++) {
    const px = 80 + rand() * (w - 160);
    const py = h - 6 - rand() * 40;
    ctx.fillStyle = rand() < 0.75 ? "rgba(220,230,255,0.9)" : "rgba(120,150,255,0.9)";
    ctx.fillRect(px, py, 2, 2);
  }
  return finishSilhouette(canvas);
}

/** Sparse far-off points of light, genuinely point-like: on the tiers with
 * depth of field the blur turns them into soft discs, and on the tiers
 * without it they stay as the tiny lights they are. */
export function makeLightPointsTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 64;
  const { canvas, ctx } = makeCanvas(w, h);
  const rand = mulberry32(131);
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    const y = h - 5 - rand() * 14;
    const r = 0.9 + rand() * 0.8;
    const color = rand() < 0.7 ? "225,233,255" : "120,150,255";
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, `rgba(${color},1)`);
    g.addColorStop(0.3, `rgba(${color},0.55)`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  }
  return finishSilhouette(canvas);
}
