// Captures the hero's poster: the first picture of the page, shown from the first paint while the
// 3D scene is still loading, and faded out when the live canvas takes its place.
//
//   node scripts/verify-plant.mjs --launch-only          (leave running: Chrome on :9222)
//   node scripts/capture-hero-poster.mjs [--url=http://localhost:3001]
//
// It is a picture of the scene itself, taken at the hero's resting pose with the DOM hidden and the
// headline (which draws in, letter by letter, and is part of the canvas) switched off. It is taken
// 21:9, so that cropped to any narrower window with object-fit: cover it shows exactly what the
// canvas shows there: the canvas's field of view is fixed in height, and a narrower window sees
// the middle of a wider one.

import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const sharp = createRequire(import.meta.url)("sharp");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const URL_BASE = args.url ?? "http://localhost:3001";
const W = 2520;
const H = 1080;
const OUT = path.resolve("public", "hero", "poster.webp");

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
await page.setViewportSize({ width: W, height: H });
await page.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded", timeout: 240_000 });
await page.waitForFunction(
  () => {
    const stat = document.querySelector('[data-stat="0"]');
    return !!stat && /3.3/.test(stat.textContent ?? "") && !!window.__lenis && !!window.__fordGl;
  },
  null,
  { timeout: 300_000 },
);
await page.waitForTimeout(4000);
await page.evaluate(() => window.__lenis.scrollTo(0, { immediate: true, force: true }));

// The headline is drawn into the canvas; a plane whose alpha test never passes draws nothing.
const hidden = await page.evaluate(() => {
  let n = 0;
  window.__fordGl.scene.traverse((o) => {
    if (o.isMesh && o.renderOrder === 5 && o.material?.map?.isCanvasTexture) {
      o.material.alphaTest = 2;
      o.material.needsUpdate = true;
      n++;
    }
  });
  return n;
});
console.log("headline planes switched off:", hidden);
await page.addStyleTag({ content: "div.sticky > *:not(:first-child) { visibility: hidden !important; } nextjs-portal { display: none !important; }" });
await page.waitForTimeout(900);

const png = await page.screenshot({ type: "png" });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const info = await sharp(png).webp({ quality: 84, effort: 6 }).toFile(OUT);
console.log(`wrote ${path.relative(".", OUT)}: ${info.width}x${info.height}, ${(info.size / 1024).toFixed(0)} KB`);
process.exit(0);
