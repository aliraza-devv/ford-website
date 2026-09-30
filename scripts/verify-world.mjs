// Stage verification for the 3D world. Drives the installed Chrome through
// playwright-core (no browser download) against the running dev server.
//
//   node scripts/verify-world.mjs [--tier=high|medium|low] [--url=http://localhost:3001]
//                                 [--stages=0,0.5,1,1.5,2] [--headed] [--skip-perf]
//
// Fast iteration: start a long-lived Chrome once, then attach to it so each
// run skips the page load (HMR keeps the page current):
//   node scripts/verify-world.mjs --launch-only [--tier=...]   (leave running)
//   node scripts/verify-world.mjs --connect=9222 --stages=0 --skip-perf
//
// Writes to reference/compare/:
//   world-<stage>.png        full-page 1920x1080 frames at each scroll stage
//   canvas-<stage>.png       the same frame with all DOM overlays hidden (WebGL only)
//   seam-0.png               hero frame, WebGL only, horizon silhouettes off
//   banding-*-4x.png         sky crops, 4x contrast about their mean
//   banding-*-autolevel.png  same crops, min/max auto-levelled
// and prints the measured seam / banding / frame-time numbers as JSON.

import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const body = a.replace(/^--/, "");
    const i = body.indexOf("=");
    return i < 0 ? [body, true] : [body.slice(0, i), body.slice(i + 1)];
  }),
);

const URL_BASE = args.url ?? "http://localhost:3001";
const TIER = args.tier ?? "auto"; // auto = natural behaviour (the monitor may step down)
const STAGES = (args.stages ?? "0,0.5,1,1.5,2").split(",").map(Number);
const W = 1920;
const H = 1080;
const OUT = path.resolve("reference/compare");
fs.mkdirSync(OUT, { recursive: true });

// Scroll distance for a 0-2 stage: Stage 1->2 takes 1.2 viewport heights, then
// Stage 2->3 takes 1.1 (STAGE_12_VH / STAGE_23_VH in HeroExperience.tsx).
const scrollForStage = (s) => (s <= 1 ? s * 1.2 * H : 1.2 * H + (s - 1) * 1.1 * H);

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function pixel(png, x, y) {
  const i = (png.width * y + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

/** Mean luminance per row over columns [x0, x1). */
function rowProfile(png, x0, x1, y0, y1) {
  const rows = [];
  for (let y = y0; y < y1; y++) {
    let sum = 0;
    for (let x = x0; x < x1; x++) sum += lum(...pixel(png, x, y));
    rows.push(sum / (x1 - x0));
  }
  return rows;
}

function seamTest(file) {
  const png = readPng(file);
  // A strip right of the car and clear of the headline, edge line and poles,
  // spanning well above and below the horizon row (0.46 of the height).
  const x0 = 1560;
  const x1 = 1800;
  const y0 = 400;
  const y1 = 600;
  const rows = rowProfile(png, x0, x1, y0, y1);
  let max = 0;
  let at = y0;
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(rows[i] - rows[i - 1]);
    if (d > max) {
      max = d;
      at = y0 + i;
    }
  }
  return {
    strip: { x0, x1, y0, y1 },
    horizonRow: Math.round(0.46 * H),
    maxAdjacentRowDiff: +max.toFixed(3),
    atRow: at,
    limit: 3,
    pass: max < 3,
  };
}

function bandingTest(file, name, x0, y0, cw, ch) {
  const png = readPng(file);
  const crop = new PNG({ width: cw, height: ch });
  let mean = 0;
  let lo = 255;
  let hi = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const [r, g, b] = pixel(png, x0 + x, y0 + y);
      const i = (cw * y + x) * 4;
      crop.data[i] = r;
      crop.data[i + 1] = g;
      crop.data[i + 2] = b;
      crop.data[i + 3] = 255;
      const l = lum(r, g, b);
      mean += l;
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
  }
  mean /= cw * ch;

  const stretched = new PNG({ width: cw, height: ch });
  const leveled = new PNG({ width: cw, height: ch });
  for (let i = 0; i < cw * ch * 4; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = crop.data[i + c];
      stretched.data[i + c] = Math.max(0, Math.min(255, (v - mean) * 4 + 128));
      leveled.data[i + c] = Math.max(0, Math.min(255, ((v - lo) / Math.max(1, hi - lo)) * 255));
    }
    stretched.data[i + 3] = 255;
    leveled.data[i + 3] = 255;
  }
  fs.writeFileSync(path.join(OUT, `banding-${name}-4x.png`), PNG.sync.write(stretched));
  fs.writeFileSync(path.join(OUT, `banding-${name}-autolevel.png`), PNG.sync.write(leveled));

  // Plateau length: along each column, the run of identical quantised
  // luminance. A dithered gradient breaks into short runs; an undithered one
  // leaves flat bands many pixels tall.
  let runSum = 0;
  let runCount = 0;
  let runMax = 0;
  for (let x = 0; x < cw; x += 4) {
    let prev = -1;
    let run = 0;
    for (let y = 0; y < ch; y++) {
      const i = (cw * y + x) * 4;
      const q = Math.round(lum(crop.data[i], crop.data[i + 1], crop.data[i + 2]));
      if (q === prev) run++;
      else {
        if (prev >= 0) {
          runSum += run;
          runCount++;
          runMax = Math.max(runMax, run);
        }
        prev = q;
        run = 1;
      }
    }
  }
  return {
    crop: { x0, y0, w: cw, h: ch },
    lumaRange: [+lo.toFixed(1), +hi.toFixed(1)],
    meanRunLengthPx: +(runSum / runCount).toFixed(2),
    maxRunLengthPx: runMax,
  };
}

const query = args.query ? `?${args.query}` : TIER === "auto" ? "" : `?tier=${TIER}`;
const consoleLines = [];
const attachConsole = (p) => {
  p.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) consoleLines.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
  });
  p.on("pageerror", (e) => consoleLines.push(`[pageerror] ${String(e).slice(0, 300)}`));
};

async function loadAndWait(p) {
  console.log(`URL: ${URL_BASE}/${query}`);
  await p.goto(`${URL_BASE}/${query}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  // Loaded + intro finished == the scroll cue (last thing in the intro timeline) is fully visible.
  await p.waitForFunction(
    () => {
      const el = document.querySelector(".hero-scrollcue");
      return !!el && getComputedStyle(el).opacity === "1" && !!window.__lenis;
    },
    null,
    { timeout: 240_000 },
  );
  await p.waitForTimeout(2500);
}

let browser;
let page;

if (args["launch-only"]) {
  const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), "ford-verify-chrome"), {
    channel: "chrome",
    headless: !args.headed,
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--remote-debugging-port=9222"],
  });
  page = context.pages()[0] ?? (await context.newPage());
  attachConsole(page);
  await loadAndWait(page);
  console.log("READY: Chrome is running with remote debugging on :9222 (Ctrl+C to stop)");
  await new Promise(() => {});
} else if (args.connect) {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.connect}`);
  page = browser.contexts()[0].pages()[0];
  attachConsole(page);
  console.log(`Attached to existing Chrome on :${args.connect} at ${page.url()}`);
} else {
  browser = await chromium.launch({
    channel: "chrome",
    headless: !args.headed,
    args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page = await context.newPage();
  attachConsole(page);
  await loadAndWait(page);
}

const gpu = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
console.log("WebGL renderer:", gpu);

const HIDE_DOM = `
  div.sticky > *:not(:first-child) { visibility: hidden !important; }
`;

const result = { url: page.url(), gpu, stages: {} };

const domState = () =>
  page.evaluate(() => {
    const o = (sel) => {
      const el = document.querySelector(sel);
      return el ? +Number(getComputedStyle(el).opacity).toFixed(3) : null;
    };
    return {
      heroFade: o(".hero-headline-wrap"),
      section2: o(".section2-fade-content"),
      section3: o(".section3-fade-content"),
      scrollCue: o(".hero-scrollcue"),
    };
  });
result.reverse = { initial: await domState() };

for (const s of args["perf-only"] ? [] : STAGES) {
  await page.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true, force: true }), scrollForStage(s));
  await page.waitForTimeout(3200);
  const tag = String(s).replace(".", "_");
  await page.screenshot({ path: path.join(OUT, `world-${tag}.png`) });

  const style = await page.addStyleTag({ content: HIDE_DOM });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `canvas-${tag}.png`) });
  await style.evaluate((n) => n.remove());

  const state = await page.evaluate(() => ({
    stage: window.__fordScroll.stage12 + window.__fordScroll.stage23,
    world: window.__fordScroll.world,
    speed: window.__fordScroll.speed,
    travel: window.__fordScroll.travel,
    tier: window.__fordPerf.getTier(),
  }));
  result.stages[s] = state;
  console.log(`stage ${s}:`, JSON.stringify(state));
}

// Reverse-scroll check: after the forward sweep above, everything DOM-driven
// must be back at its hero values when we return to the top.
if (STAGES.length > 1 && STAGES[0] === 0 && !args["perf-only"]) {
  await page.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true, force: true }), 0);
  await page.waitForTimeout(3200);
  result.reverse.afterScrollBackToTop = await domState();
  await page.screenshot({ path: path.join(OUT, "world-0-after-reverse.png") });
}

// Seam and banding are measured on the WebGL pixels alone, at the hero
// stage, with the horizon silhouettes switched off: their edges are
// legitimate brightness steps, and the test is about road -> fog -> sky.
if (STAGES.includes(0) && !args["perf-only"]) {
  await page.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true, force: true }), 0);
  await page.waitForTimeout(3200);
  const style = await page.addStyleTag({ content: HIDE_DOM });
  await page.evaluate(() => {
    window.__fordWorldDebug.horizon = false;
    window.__fordWorldDebug.props = false;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "seam-0.png") });
  await page.evaluate(() => {
    window.__fordWorldDebug.horizon = true;
    window.__fordWorldDebug.props = true;
  });
  await style.evaluate((n) => n.remove());

  result.seam = seamTest(path.join(OUT, "seam-0.png"));
  result.banding = {
    darkSky: bandingTest(path.join(OUT, "seam-0.png"), "sky", 0, 0, 400, 400),
    glowAndSeam: bandingTest(path.join(OUT, "seam-0.png"), "seam", 1460, 230, 400, 300),
  };
}

if (!args["skip-perf"]) {
  await page.evaluate(() => window.__lenis.scrollTo(0, { immediate: true, force: true }));
  await page.waitForTimeout(1500);
  // A scripted 10 s scroll down through every stage and back, sampling rAF deltas.
  const perf = await page.evaluate(
    async ({ total }) => {
      const deltas = [];
      let last = performance.now();
      let running = true;
      const tick = (t) => {
        deltas.push(t - last);
        last = t;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const half = 4500;
      window.__lenis.scrollTo(total, { duration: half / 1000, easing: (t) => t, force: true });
      await new Promise((r) => setTimeout(r, half + 400));
      window.__lenis.scrollTo(0, { duration: half / 1000, easing: (t) => t, force: true });
      await new Promise((r) => setTimeout(r, half + 400));
      running = false;
      deltas.shift();
      deltas.sort((a, b) => a - b);
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      return {
        frames: deltas.length,
        avgFrameMs: +avg.toFixed(2),
        avgFps: +(1000 / avg).toFixed(1),
        p95FrameMs: +deltas[Math.floor(deltas.length * 0.95)].toFixed(2),
        worstFrameMs: +deltas[deltas.length - 1].toFixed(2),
        tierAtEnd: window.__fordPerf.getTier(),
      };
    },
    { total: scrollForStage(2) },
  );
  result.perf = perf;
}

result.console = consoleLines;
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(result, null, 2));
if (browser) await browser.close();
