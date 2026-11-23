// Section 4 (the plant walkthrough) verification. Drives the installed Chrome
// through playwright-core against the running dev server, scrolls to chosen
// points of the walkthrough and screenshots each.
//
//   node scripts/verify-plant.mjs --launch-only [--tier=low|medium|high] [--headed]
//        (leave running; it opens Chrome with remote debugging on :9222)
//   node scripts/verify-plant.mjs --connect=9222 --frames=0,0.1,0.2 [--prefix=a] [--dom=0]
//
// Frames are values of `scrollState.factory` (0-1). Output goes to
// reference/compare/plant-<prefix>-<frame>.png. With --dom=0 the DOM overlay is
// hidden so only the WebGL canvas is captured.

import { chromium } from "playwright-core";
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
const TIER = args.tier ?? "auto";
const FRAMES = (args.frames ?? "0,0.06,0.12,0.2,0.3,0.4,0.5,0.6,0.72,0.8,0.9,1").split(",").filter((x) => x !== "").map(Number);
// --at=3.0,3.3: absolute scroll positions in screen heights (for the earlier sections).
const AT = (args.at ?? "").split(",").filter((x) => x !== "").map(Number);
// --map=0,0.1,..: progress through the plant map tour (0-1); --cover=0.5: how far the map
// has risen over the plant (0-1); --find=..., --cover6=...: the same for the road finder.
const listArg = (v) => (v ?? "").split(",").filter((x) => x !== "").map(Number);
const MAPS = listArg(args.map);
const COVERS = listArg(args.cover);
const FINDS = listArg(args.find);
const COVERS6 = listArg(args.cover6);
const PREFIX = args.prefix ?? "run";
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const OUT = path.resolve("reference/compare");
fs.mkdirSync(OUT, { recursive: true });

// Stage 1->2 (1.2) + 2->3 (1.1) + features (1.2) come first; then the walkthrough
// (FACTORY_VH in src/config/line.ts, 7.5 screens; override with --vh=).
// A negative frame means "the very top of the page" (the hero).
const FACTORY_VH = Number(args.vh ?? 7.5);
const scrollForFrame = (f) => (f < 0 ? 0 : (1.2 + 1.1 + 1.2 + f * FACTORY_VH) * H);

const query = args.query ? `?${args.query}` : TIER === "auto" ? "" : `?tier=${TIER}`;
const consoleLines = [];
const attachConsole = (p) => {
  p.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) consoleLines.push(`[${m.type()}] ${m.text().slice(0, 400)}`);
  });
  p.on("pageerror", (e) => consoleLines.push(`[pageerror] ${String(e).slice(0, 400)}`));
};

async function loadAndWait(p) {
  console.log(`URL: ${URL_BASE}/${query}`);
  await p.goto(`${URL_BASE}/${query}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await p.waitForFunction(
    () => {
      const nav = document.querySelector(".hero-navbar");
      const stat = document.querySelector('[data-stat="0"]');
      // The navbar is visible before the intro runs; the stats count-up
      // reaching its final value is what says the intro has finished.
      return !!nav && getComputedStyle(nav).opacity === "1" && !!stat && /3.3/.test(stat.textContent ?? "") && !!window.__lenis;
    },
    null,
    { timeout: 300_000 },
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
  // A second CDP client (or any earlier one) can leave the window at its default
  // size; the viewport is applied per session, so set it here.
  await page.setViewportSize({ width: W, height: H });
  // Lenis measures the page when the window resizes; its scroll limit is stale until it has
  // (a jump straight after the resize would be clamped to the old, shorter page).
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__lenis?.resize?.());
  await page.waitForTimeout(400);
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

if (args.reload) {
  await loadAndWait(page);
}

// A jump straight from the hero to the middle of the walkthrough makes the page
// do a few seconds of catching up (the world blend damps toward its target, the
// plant draws for the first time, the stand-in cars finish building). Settle
// there once before the first screenshot so it is not a frame of dense fog.
if (FRAMES.length && FRAMES.some((f) => f >= 0) && !args.noprime) {
  await page.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true, force: true }), scrollForFrame(0.2));
  await page.waitForTimeout(Number(args.prime ?? 6000));
}

const HIDE_DOM = `div.sticky > *:not(:first-child) { visibility: hidden !important; }`;
const results = { frames: {} };

for (const f of FRAMES) {
  await page.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true, force: true }), scrollForFrame(f));
  await page.waitForTimeout(Number(args.wait ?? 2600));
  const tag = `${PREFIX}-${String(f).replace(".", "_")}`;
  if (args.dom === "0") {
    const style = await page.addStyleTag({ content: HIDE_DOM });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `plant-${tag}.png`) });
    await style.evaluate((n) => n.remove());
  } else {
    await page.screenshot({ path: path.join(OUT, `plant-${tag}.png`) });
  }
  const state = await page.evaluate(() => ({
    factory: +window.__fordScroll.factory.toFixed(4),
    world: +window.__fordScroll.world.toFixed(3),
    tier: window.__fordPerf.getTier(),
  }));
  results.frames[f] = state;
  console.log(`f=${f}:`, JSON.stringify(state));
}

// The sections after the plant. Each is a wrapper with a data-vh attribute (screens of
// scroll once pinned) and a cover (screens it takes to rise over the one before).
async function shootSection(sel, values, toY, tag) {
  for (const v of values) {
    const y = await page.evaluate(
      ({ sel, v, kind, H }) => {
        const el = document.querySelector(sel);
        const top = el.getBoundingClientRect().top + window.scrollY;
        const vh = parseFloat(el.getAttribute("data-vh") ?? "0");
        return kind === "cover" ? top - H + v * H : top + v * vh * H;
      },
      { sel, v, kind: toY, H },
    );
    await page.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true, force: true }), y);
    await page.waitForTimeout(Number(args.swait ?? 900));
    await page.screenshot({ path: path.join(OUT, `plant-${PREFIX}-${tag}${String(v).replace(".", "_")}.png`) });
    console.log(`${tag}${v}: y=${Math.round(y)}`);
  }
}
if (COVERS.length) await shootSection("#plants", COVERS, "cover", "cover5-");
if (MAPS.length) await shootSection("#plants", MAPS, "progress", "map-");
if (COVERS6.length) await shootSection("#find", COVERS6, "cover", "cover6-");
if (FINDS.length) await shootSection("#find", FINDS, "progress", "find-");

// --perfsec=#plants (or #find, or #hero for the whole page above the map): a scripted
// scroll from before the section starts rising to the end of its pinned range, sampling
// frame times. --seconds= sets how long the scroll takes (default 10).
async function measureScroll(from, to, seconds) {
  await page.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true, force: true }), from);
  await page.waitForTimeout(2500);
  return page.evaluate(
    async ({ to, seconds }) => {
      const deltas = [];
      let last = performance.now();
      let running = true;
      const tick = (t) => {
        deltas.push(t - last);
        last = t;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__lenis.scrollTo(to, { duration: seconds, easing: (t) => t, force: true });
      await new Promise((r) => setTimeout(r, seconds * 1000 + 600));
      running = false;
      deltas.shift();
      deltas.sort((a, b) => a - b);
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const over = (ms) => deltas.filter((d) => d > ms).length;
      return {
        frames: deltas.length,
        avgFrameMs: +avg.toFixed(2),
        avgFps: +(1000 / avg).toFixed(1),
        medianFrameMs: +deltas[Math.floor(deltas.length * 0.5)].toFixed(2),
        p95FrameMs: +deltas[Math.floor(deltas.length * 0.95)].toFixed(2),
        p99FrameMs: +deltas[Math.floor(deltas.length * 0.99)].toFixed(2),
        worstFrameMs: +deltas[deltas.length - 1].toFixed(2),
        framesOver25ms: over(25),
        framesOver50ms: over(50),
      };
    },
    { to, seconds },
  );
}
// --hidevis="a|b" / --hidedisp="a|b": switch parts of the page off (visibility / display) so a
// frame-time test can say what a part costs.
if (args.hidevis) {
  const css = String(args.hidevis).split("|").map((x) => `${x} { visibility: hidden !important; }`).join(" ");
  await page.addStyleTag({ content: css });
}
if (args.hidedisp) {
  const css = String(args.hidedisp).split("|").map((x) => `${x} { display: none !important; }`).join(" ");
  await page.addStyleTag({ content: css });
}
if (args.perfsec) {
  const sel = args.perfsec === "hero" ? "#plants" : args.perfsec;
  const range = await page.evaluate(
    ({ sel, H }) => {
      const el = document.querySelector(sel);
      const top = el.getBoundingClientRect().top + window.scrollY;
      const vh = parseFloat(el.getAttribute("data-vh") ?? "0");
      return { from: top - H, to: top + vh * H };
    },
    { sel, H },
  );
  const from = args.perfsec === "hero" ? 0 : range.from;
  const to = args.perfsec === "hero" ? range.from : range.to;
  results.perfsec = await measureScroll(from, to, Number(args.seconds ?? 10));
  console.log("PERFSEC", args.perfsec, JSON.stringify(results.perfsec));
}

// --perf: a scripted scroll through the whole walkthrough, sampling frame times.
if (args.perf) {
  await page.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true, force: true }), scrollForFrame(0));
  await page.waitForTimeout(2500);
  results.perf = await page.evaluate(
    async ({ from, to, seconds }) => {
      const deltas = [];
      const tiers = new Set();
      let last = performance.now();
      let running = true;
      const tick = (t) => {
        deltas.push(t - last);
        last = t;
        tiers.add(window.__fordPerf.getTier());
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__lenis.scrollTo(to, { duration: seconds, easing: (t) => t, force: true });
      await new Promise((r) => setTimeout(r, seconds * 1000 + 600));
      running = false;
      deltas.shift();
      deltas.sort((a, b) => a - b);
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      return {
        frames: deltas.length,
        avgFrameMs: +avg.toFixed(2),
        avgFps: +(1000 / avg).toFixed(1),
        medianFrameMs: +deltas[Math.floor(deltas.length * 0.5)].toFixed(2),
        p95FrameMs: +deltas[Math.floor(deltas.length * 0.95)].toFixed(2),
        worstFrameMs: +deltas[deltas.length - 1].toFixed(2),
        tiers: [...tiers],
      };
    },
    { from: scrollForFrame(0), to: scrollForFrame(1), seconds: Number(args.perf) || 12 },
  );
  console.log("PERF", JSON.stringify(results.perf));
}

for (const vh of AT) {
  await page.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true, force: true }), vh * H);
  await page.waitForTimeout(Number(args.wait ?? 2600));
  await page.screenshot({ path: path.join(OUT, `plant-${PREFIX}-at${String(vh).replace(".", "_")}.png`) });
  console.log(`at ${vh} screens: `, JSON.stringify(await page.evaluate(() => ({ features: +window.__fordScroll.features.toFixed(3), stage: +(window.__fordScroll.stage12 + window.__fordScroll.stage23).toFixed(3) }))));
}

results.rig = await page.evaluate(() => window.__fordRig ?? null);
results.console = consoleLines;
console.log(JSON.stringify({ rig: results.rig, console: results.console }, null, 2));
// A browser we only attached to is left running (closing the CDP connection
// would close the persistent Chrome and with it the loaded page).
if (args.connect) process.exit(0);
if (browser) await browser.close();
