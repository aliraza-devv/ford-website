// Cuts the supplied car photographs out of their white backgrounds and sets them for the road
// finder: public/car images/* in, public/scenes/<id>.webp and src/config/carSprites.ts out.
//
//   node scripts/cut-cars.mjs [bronco f150 explorer] [--shot]
//
// --shot also writes reference/compare/cut-<id>.png: the cut-out on a dark road, to look at.
// Needs sharp, which ships with Next (npm i --no-save sharp if it is missing).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CARS } from "./cut/cars.mjs";
import { cut } from "./cut/cut.mjs";
import { grade } from "./cut/grade.mjs";
import { writeSprites } from "./bake/write-sprites.mjs";
import { addReflection } from "./bake/reflect.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const ROOT = path.resolve(".");
const SRC = path.join(ROOT, "public", "car images");
const OUT = path.join(ROOT, "public", "scenes");
const args = process.argv.slice(2);
const SHOT = args.includes("--shot");
const CUT_ONLY = args.includes("--cut-only");
const ids = args.filter((a) => !a.startsWith("--"));
const wanted = ids.length ? ids : Object.keys(CARS);

/** The picture's size on the 1080-high reference stage: the world's camera puts a metre of a car at
 * this many px (a 1.8-stage-height lens, a car 12.5 m away). */
const REF_PX_PER_M = (1.8 * 1080) / 12.5;
const CAMERA_HEIGHT = 1.15;

fs.mkdirSync(OUT, { recursive: true });
const metaFile = path.join(ROOT, "scripts", "bake", "meta.json");
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};

for (const id of wanted) {
  const car = CARS[id];
  if (!car) throw new Error(`no recipe for ${id}`);
  console.log(`${id}...`);
  const file = car.file.endsWith(".avif") ? await sharp(path.join(SRC, car.file)).png().toBuffer() : path.join(SRC, car.file);
  const cutOut = await cut(sharp, file, car);
  console.log(`  cut: ${cutOut.width}x${cutOut.height}, tyres touch at row ${cutOut.contact}`);

  if (SHOT) {
    fs.mkdirSync(path.join(ROOT, "reference", "compare"), { recursive: true });
    const bg = { r: 26, g: 30, b: 44, alpha: 1 };
    await sharp(cutOut.rgba, { raw: { width: cutOut.width, height: cutOut.height, channels: 4 } })
      .flatten({ background: bg })
      .png()
      .toFile(path.join(ROOT, "reference", "compare", `cut-${id}.png`));
  }
  if (CUT_ONLY) continue;

  const set = grade(cutOut, car);
  const span = cutOut.carRight - cutOut.carLeft + 1;
  const graded = { ...set, ...addReflection(set.rgba, set.width, set.height, set.contact, span) };
  if (SHOT) {
    const bg = { r: 14, g: 20, b: 36, alpha: 1 };
    await sharp(graded.rgba, { raw: { width: graded.width, height: graded.height, channels: 4 } })
      .flatten({ background: bg })
      .png()
      .toFile(path.join(ROOT, "reference", "compare", `graded-${id}.png`));
  }
  await sharp(graded.rgba, { raw: { width: graded.width, height: graded.height, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 100, effort: 6 })
    .toFile(path.join(OUT, `${id}.webp`));

  // Where the sprite stands in the world: its size follows from the car's real length, and its
  // horizon is the row 1.15 m (the camera's height) above where the tyres touch the road.
  const pxPerM = (cutOut.carRight - cutOut.carLeft) / car.length;
  const density = pxPerM / REF_PX_PER_M;
  const contact = graded.contact;
  meta[id] = {
    src: `/scenes/${id}.webp`,
    width: graded.width,
    height: graded.height,
    span: cutOut.carRight - cutOut.carLeft + 1,
    density: +density.toFixed(4),
    horizon: Math.round(contact - CAMERA_HEIGHT * pxPerM),
    contact,
    centre: +(((graded.carLeft + graded.carRight) / 2) / graded.width).toFixed(4),
  };
  console.log(`  ${id}: ${graded.width}x${graded.height}, density ${meta[id].density}, horizon ${meta[id].horizon}, contact ${contact}`);
}

if (!CUT_ONLY) {
  fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  writeSprites(ROOT, meta);
}
console.log("done");
