"use client";

/* eslint-disable react-hooks/immutability --
 * useFrame rewrites the instance buffers every frame, outside React's
 * render/commit cycle. */

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  ACTORS,
  CART_AWAY,
  CART_DECK,
  CAR_RANGE,
  HALL,
  RIG_DROP,
  actorZ,
  cartAway,
  carryState,
  currentCycle,
  holdU,
  type Actor,
} from "@/config/line";
import { scrollState } from "@/lib/scrollState";
import { patchHallLit } from "./hallLight";
import { PrimPool, lin } from "./prims";

/**
 * The line's equipment: gantries, trolleys, hoists, spreaders and the carts that
 * bring parts to them. Everything is rewritten each frame from `carryState`
 * (config/line.ts), which is what the real car's parts (PlantCar) and the stand-in
 * cars' parts (ProxyCars) follow too, so a hook is always exactly where the
 * thing it carries is. A hook with nothing on it is a hook on its way to
 * something.
 */

// Painted crane steel and safety yellow: a plant's overhead cranes are grey
// girders with yellow end trucks, trolleys and hook blocks, and the carts that
// feed them are dark frames edged in yellow.
const STEEL = lin(0x8b929d);
const STEEL_LIGHT = lin(0xa5acb7);
const STEEL_DARK = lin(0x5f6672);
const YELLOW = lin(0xe3b015);
const BLACK = lin(0x181a20);
const ROPE = lin(0x22252c);
const CART_PAINT = lin(0x474d59);
const PAD = lin(0x101216);

const SLING = 0.035;
/** Hook block height. */
const HOOK_H = 0.3;

/** One gantry spans the hall at each distinct (station, z). */
type Gantry = { z: number };
function gantries(): Gantry[] {
  const out: Gantry[] = [];
  for (const a of ACTORS) {
    const z = actorZ(a);
    if (!out.some((g) => Math.abs(g.z - z) < 0.6)) out.push({ z });
  }
  return out;
}

const dirOf = (a: Actor) => (a.cartX < 0 ? -1 : 1);

function buildGantry(boxes: PrimPool, z: number) {
  const legX = HALL.gantryLegX;
  const h = HALL.beamY + 0.5;
  for (const sx of [-1, 1]) {
    // Leg with its base plate and hazard guard, and the yellow end truck the
    // girder sits on.
    boxes.put(sx * legX, h / 2, z, 0.55, h, 0.55, STEEL);
    boxes.put(sx * legX, 0.06, z, 1.1, 0.12, 1.1, STEEL_DARK);
    for (let b = 0; b < 4; b++) boxes.put(sx * legX, 0.12 + 0.15 + b * 0.3, z, 0.62, 0.3, 0.62, b % 2 ? BLACK : YELLOW);
    boxes.put(sx * legX, HALL.beamY, z, 1.0, 1.2, 1.0, YELLOW);
  }
  // The girder: a web between two flanges, with a stiffener every two metres,
  // and a walkway on top. The lower flange is the rail the trolley runs on.
  boxes.put(0, HALL.beamY, z, legX * 2 + 0.6, 0.72, 0.16, STEEL);
  boxes.put(0, HALL.beamY + 0.4, z, legX * 2 + 0.6, 0.08, 0.7, STEEL_LIGHT);
  boxes.put(0, HALL.beamY - 0.4, z, legX * 2 + 0.6, 0.08, 0.7, STEEL_DARK);
  for (let x = -legX + 1; x < legX; x += 2) boxes.put(x, HALL.beamY, z, 0.06, 0.72, 0.5, STEEL_DARK);
  boxes.put(0, HALL.beamY + 0.55, z, legX * 2, 0.04, 0.9, STEEL_DARK);
}

function buildHoist(boxes: PrimPool, a: Actor, hook: readonly [number, number, number]) {
  const gz = hook[2];
  const hx = hook[0];

  // Trolley rides the beam.
  const trolleyY = HALL.beamY - 0.7;
  boxes.put(hx, trolleyY, gz, 1.4, 0.5, 1.0, YELLOW);
  boxes.put(hx, HALL.beamY - 0.5, gz, 1.0, 0.2, 0.9, BLACK);

  // Wire ropes, trolley to hook block.
  const ropeTop = trolleyY - 0.25;
  const ropeBottom = hook[1] + HOOK_H / 2;
  const ropeLen = ropeTop - ropeBottom;
  if (ropeLen > 0.05) {
    for (const dz of [-0.17, 0.17]) boxes.put(hx, (ropeTop + ropeBottom) / 2, gz + dz, SLING, ropeLen, SLING, ROPE);
  }

  // Hook block.
  boxes.put(hx, hook[1], gz, 0.2, HOOK_H, 0.14, YELLOW);
  boxes.put(hx, hook[1] + HOOK_H / 2 + 0.02, gz, 0.26, 0.04, 0.18, BLACK);
  boxes.put(hx, hook[1] - HOOK_H / 2 - 0.05, gz, 0.07, 0.1, 0.07, BLACK);

  // Spreader and slings, by what is being lifted.
  const spreaderY = hook[1] - HOOK_H / 2 - 0.2;
  const slingLen = RIG_DROP[a.rig] - 0.5;
  const slingTop = spreaderY - 0.07;
  const slingMid = slingTop - slingLen / 2;
  const drop = (x: number, z: number, w = SLING) => boxes.put(x, slingMid, z, w, slingLen, w, ROPE);
  // Slings always hang the same length from the spreader; they only reach the
  // part once it is hooked, because the hook comes down to meet it.

  switch (a.rig) {
    case "engine": {
      boxes.put(hx, spreaderY, gz, 0.16, 0.14, 1.1, STEEL_LIGHT);
      boxes.put(hx, spreaderY, gz - 0.55, 0.22, 0.2, 0.1, YELLOW);
      boxes.put(hx, spreaderY, gz + 0.55, 0.22, 0.2, 0.1, YELLOW);
      drop(hx, gz - 0.42);
      drop(hx, gz + 0.42);
      break;
    }
    case "carrier": {
      // An H-frame: two long bars joined by a cross bar, four hangers.
      const bx = 0.66;
      for (const sx of [-1, 1]) boxes.put(hx + sx * bx, spreaderY, gz, 0.14, 0.14, 3.7, STEEL_LIGHT);
      boxes.put(hx, spreaderY, gz, bx * 2 + 0.14, 0.14, 0.14, STEEL_LIGHT);
      boxes.put(hx, spreaderY + 0.12, gz, 0.1, 0.14, 0.1, ROPE);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          boxes.put(hx + sx * bx, spreaderY, gz + sz * 1.75, 0.2, 0.2, 0.2, YELLOW);
          drop(hx + sx * bx, gz + sz * 1.55, 0.05);
        }
      }
      break;
    }
    case "door": {
      boxes.put(hx, spreaderY, gz, 0.3, 0.1, 1.1, STEEL_LIGHT);
      for (const sz of [-0.4, 0.4]) {
        boxes.put(hx, slingMid - 0.05, gz + sz, 0.1, slingLen, 0.12, BLACK);
        boxes.put(hx, slingTop - slingLen, gz + sz, 0.36, 0.08, 0.12, BLACK);
      }
      break;
    }
    case "panel": {
      const w = a.size[0] * 0.7;
      const l = a.size[2] * 0.62;
      boxes.put(hx, spreaderY, gz, w, 0.08, l, STEEL_LIGHT);
      boxes.put(hx, spreaderY, gz, w * 0.9, 0.06, 0.1, YELLOW);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          boxes.put(hx + (sx * w) / 2.2, slingMid, gz + (sz * l) / 2.2, 0.1, slingLen, 0.1, BLACK);
        }
      }
      break;
    }
    case "fascia": {
      const w = a.size[0] * 0.62;
      boxes.put(hx, spreaderY, gz, w, 0.09, 0.5, STEEL_LIGHT);
      for (const sx of [-1, 1]) {
        boxes.put(hx + sx * w * 0.42, slingMid, gz, 0.08, slingLen, 0.14, BLACK);
        boxes.put(hx + sx * w * 0.42, slingTop - slingLen, gz, 0.2, 0.07, 0.2, YELLOW);
      }
      break;
    }
  }
}

function buildCart(boxes: PrimPool, a: Actor, x: number) {
  const z = actorZ(a);
  const dw = Math.max(a.size[0] + 0.7, a.rig === "door" ? 1.1 : 1.6);
  const dl = a.size[2] + 0.7;
  // Deck and a rim, legs, casters, dunnage pads under the part.
  boxes.put(x, CART_DECK - 0.06, z, dw, 0.12, dl, CART_PAINT);
  boxes.put(x, CART_DECK - 0.01, z - dl / 2 + 0.03, dw, 0.04, 0.06, YELLOW);
  boxes.put(x, CART_DECK - 0.01, z + dl / 2 - 0.03, dw, 0.04, 0.06, YELLOW);
  const legH = CART_DECK - 0.24;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      boxes.put(x + (sx * (dw - 0.2)) / 2, 0.12 + legH / 2, z + (sz * (dl - 0.2)) / 2, 0.12, legH, 0.12, CART_PAINT);
      boxes.put(x + (sx * (dw - 0.2)) / 2, 0.07, z + (sz * (dl - 0.2)) / 2, 0.14, 0.14, 0.22, BLACK);
    }
  }
  boxes.put(x, CART_DECK + 0.03, z - a.size[2] * 0.28, Math.max(a.size[0] * 0.7, 0.4), 0.06, 0.2, PAD);
  boxes.put(x, CART_DECK + 0.03, z + a.size[2] * 0.28, Math.max(a.size[0] * 0.7, 0.4), 0.06, 0.2, PAD);
}

export function Equipment() {
  const pool = useMemo(
    () =>
      new PrimPool(new THREE.BoxGeometry(1, 1, 1), patchHallLit(new THREE.MeshBasicMaterial({ color: "#ffffff" })), 1800),
    [],
  );
  const gantryList = useMemo(() => gantries(), []);

  useEffect(
    () => () => {
      pool.mesh.geometry.dispose();
      (pool.mesh.material as THREE.Material).dispose();
      pool.dispose();
    },
    [pool],
  );

  useFrame(() => {
    const f = scrollState.factory;
    pool.mesh.visible = f > 0.0005;
    if (!pool.mesh.visible) return;

    pool.begin();
    for (const g of gantryList) buildGantry(pool, g.z);

    const c = currentCycle(f);
    const u = holdU(f);
    for (const a of ACTORS) {
      // The car this gantry is working on in this hold: station - cycle.
      const n = a.station - c;
      const exists = c >= 0 && n >= CAR_RANGE[0] && n <= CAR_RANGE[1];
      const st = carryState(a, exists ? u : 0);
      buildHoist(pool, a, st.hook);

      const { away } = cartAway(a, f);
      buildCart(pool, a, a.cartX + dirOf(a) * CART_AWAY * away);
    }
    pool.end();
  });

  return <primitive object={pool.mesh} />;
}
