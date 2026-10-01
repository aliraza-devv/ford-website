// Bakes the cars the road finder stands in its road: renders each model in light that
// suits its place, from the world's own camera, and writes public/scenes/<id>.webp and a
// src/config/carSprites.ts with their sizes.
//
//   node scripts/bake-cars.mjs [mustang bronco f150 explorer] [--shot]
//
// --shot also writes reference/compare/car-<id>.png so a bake can be looked at.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { writeSprites } from "./bake/write-sprites.mjs";
import { addReflection } from "./bake/reflect.mjs";

const sharp = createRequire(import.meta.url)("sharp");

const ROOT = path.resolve(".");
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const SHOT = args.includes("--shot");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".glb": "model/gltf-binary", ".webp": "image/webp", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(5178, "127.0.0.1", r));

const { SPECS } = await import("./bake/specs.mjs");
const wanted = ids.length ? ids : Object.keys(SPECS);

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
page.on("console", (m) => console.log(m.text()));
page.on("pageerror", (e) => console.log("PAGE ERROR", String(e)));
await page.goto("http://127.0.0.1:5178/scripts/bake/bake.html");
await page.waitForFunction(() => window.bakeReady === true, null, { timeout: 60000 });

const outDir = path.join(ROOT, "public", "scenes");
fs.mkdirSync(outDir, { recursive: true });
const metaFile = path.join(ROOT, "scripts", "bake", "meta.json");
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};

for (const id of wanted) {
  const spec = SPECS[id];
  if (!spec) throw new Error(`no spec for ${id}`);
  console.log(`baking ${id}...`);
  const t0 = Date.now();
  const result = await page.evaluate((spec) => window.bake(spec), spec);
  const b64 = result.dataUrl.split(",")[1];
  // the reflection under the car, added to the render
  const { data, info } = await sharp(Buffer.from(b64, "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const withReflection = addReflection(data, info.width, info.height, result.meta.contact, result.meta.span);
  await sharp(withReflection.rgba, { raw: { width: withReflection.width, height: withReflection.height, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 100, effort: 6 })
    .toFile(path.join(outDir, `${id}.webp`));
  result.meta.height = withReflection.height;
  meta[id] = { src: `/scenes/${id}.webp`, ...result.meta };
  console.log(`  ${id}: ${result.meta.width}x${result.meta.height}, horizon ${result.meta.horizon}, ${(b64.length * 0.75 / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (SHOT) {
    // a looking copy: the sprite on a dusk gradient
    const shot = await page.evaluate(async (dataUrl) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width + 200;
      c.height = img.height + 200;
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, 0, c.height);
      g.addColorStop(0, "#0a1230");
      g.addColorStop(0.55, "#9a6a5a");
      g.addColorStop(0.56, "#141a2e");
      g.addColorStop(1, "#05070d");
      x.fillStyle = g;
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 100, 100);
      return c.toDataURL("image/png");
    }, result.dataUrl);
    fs.mkdirSync(path.join(ROOT, "reference", "compare"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "reference", "compare", `car-${id}.png`), Buffer.from(shot.split(",")[1], "base64"));
  }
}
fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
writeSprites(ROOT, meta);
await browser.close();
server.close();
console.log("done");
