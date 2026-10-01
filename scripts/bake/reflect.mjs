// A faint reflection under a car, as on a wet road: the car turned over about the line its tyres
// touch, darker, fading with the distance from that line. It is part of the sprite's picture, so
// it moves with the car and costs nothing at runtime.

/**
 * `rgba` is a W x H straight-alpha picture whose tyres touch at row `contact`; `span` is the car's
 * width in it. Returns the same picture, taller, with the reflection added beneath.
 */
export function addReflection(rgba, W, H, contact, span) {
  const depth = Math.round(0.3 * span);
  const H2 = Math.max(H, contact + depth + 2);
  const out = Buffer.alloc(W * H2 * 4);
  rgba.copy(out, 0, 0, W * H * 4);

  // the reflection is a little blurred along the road
  const BLUR = Math.max(2, Math.round(span / 450));
  for (let y = contact + 1; y < contact + depth; y++) {
    const d = y - contact;
    const ys = contact - d;
    if (ys < 0) break;
    const k = 0.34 * (1 - d / depth) ** 1.8;
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let j = -BLUR; j <= BLUR; j++) {
        const xx = x + j;
        if (xx < 0 || xx >= W) continue;
        const i = (ys * W + xx) * 4;
        const sa = rgba[i + 3] / 255;
        r += rgba[i] * sa;
        g += rgba[i + 1] * sa;
        b += rgba[i + 2] * sa;
        a += sa;
        n++;
      }
      if (a < 0.001 || !n) continue;
      const ra = (a / n) * k; // the reflection's own opacity at this pixel
      const rr = (r / a) * 0.62;
      const rg = (g / a) * 0.62;
      const rb = (b / a) * 0.62;
      // under whatever the picture already has here (the light the lamps throw), not over it
      const o = (y * W + x) * 4;
      const oa = out[o + 3] / 255;
      const ta = oa + ra * (1 - oa);
      if (ta <= 0.001) continue;
      out[o] = Math.round((out[o] * oa + rr * ra * (1 - oa)) / ta);
      out[o + 1] = Math.round((out[o + 1] * oa + rg * ra * (1 - oa)) / ta);
      out[o + 2] = Math.round((out[o + 2] * oa + rb * ra * (1 - oa)) / ta);
      out[o + 3] = Math.round(ta * 255);
    }
  }
  return { rgba: out, width: W, height: H2 };
}
