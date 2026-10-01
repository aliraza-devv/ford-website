"use client";

/* eslint-disable react-hooks/immutability --
 * useFrame writes instance colours and material colours every frame, outside
 * React's render/commit cycle. */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  GATE_Z,
  HALL,
  STATION_COUNT,
  STATION_NAMES,
  TUNNEL_Z,
  gateGlow,
  ignitionRadius,
  smoothstep,
  stationZ,
} from "@/config/line";
import { scrollState } from "@/lib/scrollState";
import { patchHallLit } from "./hallLight";
import { PrimPool, lin } from "./prims";
import { boardTexture, drawBoard, plantFontsReady } from "./signs";

/**
 * The hall's architecture, in the hall's own frame: columns, roof trusses,
 * purlins, ducts, trays and sprinkler mains, rows of linear LED fixtures, the
 * inspection tunnel, the exit gate, the walls and their boards.
 *
 * Every structural surface takes its light from hallLight() (hallLight.ts): the
 * rows overhead as line sources, a bounce from floor and ceiling, occlusion at
 * the foot of things. That is what makes a column read as a column (a lit face
 * and a shadow face) and a beam as a beam (a bright top and a dark underside)
 * with no scene light involved, so the whole structure is a handful of draw
 * calls however long the hall is, and the walkthrough's lights coming on
 * outward from the tunnel lights the architecture as it goes.
 *
 * Scale is what makes it read as real: fixtures are 1.4 m battens at 2 m pitch,
 * columns are on the 16 m station grid, the roof is 14 m up.
 */

const COOL: readonly [number, number, number] = [0.86, 0.91, 1.0];
const FIXTURE_PEAK = 7;
const FIXTURE_PITCH = 2;

// Painted steel, concrete, galvanised duct, safety paint.
const STEEL = lin(0x9097a2);
const STEEL_DARK = lin(0x646b77);
const CONCRETE = lin(0x80838a);
const DECK = lin(0xb6bbc5);
const DUCT = lin(0xc3c8d0);
const TRAY = lin(0x8a919c);
const SAFETY_YELLOW = lin(0xd9a812);
const SAFETY_BLACK = lin(0x181a1f);
const SPRINKLER = lin(0xc2382b);
const HOUSING = lin(0x9aa0aa);

const lit = (z: number, radius: number) => smoothstep(radius, radius - 24, Math.abs(z - TUNNEL_Z));

/** Painted sheet walls: a concrete plinth, corrugated cladding, and a band of
 * glazing under the eaves. */
function wallTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // Cladding.
  ctx.fillStyle = "#98a0ac";
  ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, "rgba(255,255,255,0.16)");
    g.addColorStop(0.5, "rgba(0,0,0,0.16)");
    g.addColorStop(1, "rgba(255,255,255,0.05)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, h);
  }
  // Concrete plinth, 1.4 m of a 14 m wall.
  ctx.fillStyle = "#6c6f77";
  ctx.fillRect(0, h * 0.9, w, h * 0.1);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, h * 0.9, w, 3);
  // A horizontal seam two thirds of the way up.
  ctx.fillStyle = "rgba(40,44,54,0.35)";
  ctx.fillRect(0, h * 0.34, w, 3);
  // The glazing band under the eaves: dark glass, light mullions every 4 m.
  ctx.fillStyle = "#222a3b";
  ctx.fillRect(0, 0, w, h * 0.19);
  const glow = ctx.createLinearGradient(0, 0, 0, h * 0.19);
  glow.addColorStop(0, "rgba(120,150,210,0.18)");
  glow.addColorStop(1, "rgba(120,150,210,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h * 0.19);
  ctx.fillStyle = "#8e95a3";
  for (let x = 0; x < w; x += 128) ctx.fillRect(x, 0, 4, h * 0.19);
  ctx.fillRect(0, h * 0.19 - 3, w, 5);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set((HALL.zMax - HALL.zMin) / 8, 1);
  t.anisotropy = 4;
  return t;
}

type Built = {
  steel: PrimPool;
  ducts: PrimPool;
  fixtures: PrimPool;
  fixtureLights: PrimPool;
  tunnel: PrimPool;
  fixtureZ: number[];
  tunnelZ: number[];
};

function build(): Built {
  const lit_ = () => patchHallLit(new THREE.MeshBasicMaterial({ color: "#ffffff" }));
  const basic = () => new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const steel = new PrimPool(new THREE.BoxGeometry(1, 1, 1), lit_(), 3200);
  const ducts = new PrimPool(new THREE.CylinderGeometry(1, 1, 1, 16), lit_(), 24);
  const fixtures = new PrimPool(new THREE.BoxGeometry(1, 1, 1), lit_(), 700);
  const fixtureLights = new PrimPool(new THREE.BoxGeometry(1, 1, 1), basic(), 700);
  const tunnel = new PrimPool(new THREE.BoxGeometry(1, 1, 1), basic(), 64);

  const length = HALL.zMax - HALL.zMin;
  const zMid = (HALL.zMin + HALL.zMax) / 2;

  steel.begin();
  ducts.begin();
  fixtures.begin();
  fixtureLights.begin();
  tunnel.begin();

  // Columns on the 16 m grid down both sides of the bay: a base plate, a
  // hazard-painted guard to knee height (yellow and black, as every plant paints
  // them), the column, and a bracket where the roof truss lands.
  for (let z = HALL.zMin + 8; z <= HALL.zMax; z += 16) {
    for (const sx of [-1, 1]) {
      const x = sx * 18.5;
      steel.put(x, 6.9, z, 0.6, 13.8, 0.6, STEEL);
      steel.put(x, 0.1, z, 1.15, 0.2, 1.15, STEEL_DARK);
      for (let b = 0; b < 5; b++) steel.put(x, 0.2 + 0.15 + b * 0.3, z, 0.68, 0.3, 0.68, b % 2 ? SAFETY_BLACK : SAFETY_YELLOW);
      steel.put(x, 13.2, z, 0.9, 0.5, 0.9, STEEL_DARK);
    }
  }

  // The roof: trusses every 8 m with verticals and diagonals, purlins along the
  // hall, and the deck over it all.
  const yTop = HALL.roofY;
  const yBot = HALL.roofY - 1.5;
  const bays = 10;
  const half = 21.5;
  const span = (half * 2) / bays;
  for (let z = HALL.zMin + 4; z <= HALL.zMax; z += 8) {
    steel.put(0, yTop, z, half * 2, 0.3, 0.3, STEEL);
    steel.put(0, yBot, z, half * 2, 0.3, 0.3, STEEL);
    for (let i = 0; i <= bays; i++) steel.put(-half + i * span, (yTop + yBot) / 2, z, 0.12, yTop - yBot, 0.12, STEEL);
    for (let i = 0; i < bays; i++) {
      const x0 = -half + i * span;
      const x1 = x0 + span;
      if (i % 2 === 0) steel.between(x0, yBot, z, x1, yTop, z, 0.12, STEEL);
      else steel.between(x0, yTop, z, x1, yBot, z, 0.12, STEEL);
    }
  }
  for (let i = 0; i < 11; i++) steel.put(-20 + i * 4, yTop + 0.3, zMid, 0.18, 0.22, length, STEEL);

  // Services under the trusses: cable trays, sprinkler mains with their
  // branches, the air ducts.
  for (const sx of [-1, 1]) {
    steel.put(sx * 13, yBot - 0.4, zMid, 0.9, 0.12, length, TRAY);
    steel.put(sx * 13, yBot - 0.5, zMid, 0.06, 0.18, length, STEEL_DARK);
    steel.put(sx * 2.4, yBot - 0.9, zMid, 0.12, 0.12, length, TRAY);
    steel.put(sx * 6, yBot - 1.3, zMid, 0.14, 0.14, length, SPRINKLER);
    steel.put(sx * 15.5, yBot - 1.3, zMid, 0.14, 0.14, length, SPRINKLER);
    for (let z = HALL.zMin + 6; z < HALL.zMax; z += 8) {
      steel.put(sx * 10.75, yBot - 1.3, z, 9.5, 0.08, 0.08, SPRINKLER);
      steel.put(sx * 4.2, yBot - 1.3, z, 3.6, 0.08, 0.08, SPRINKLER);
    }
    ducts.putRot(sx * 8, yBot - 1.2, zMid, 0.62, length, 0.62, Math.PI / 2, 0, 0, DUCT);
  }
  // The deck.
  steel.put(0, yTop + 0.55, zMid, 49, 0.2, length, DECK);

  // Fixture rows: a rail above each, battens hung under it.
  for (const x of HALL.rowX) steel.put(x, HALL.fixtureY + 0.5, zMid, 0.16, 0.16, length, STEEL_DARK);
  const fixtureZ: number[] = [];
  for (let z = HALL.zMin + 1; z < HALL.zMax; z += FIXTURE_PITCH) fixtureZ.push(z);
  for (const x of HALL.rowX) {
    for (const z of fixtureZ) {
      fixtures.put(x, HALL.fixtureY, z, 0.34, 0.1, 1.4, HOUSING);
      fixtureLights.put(x, HALL.fixtureY - 0.065, z, 0.26, 0.03, 1.3, COOL);
    }
  }

  // The inspection tunnel: a run of frames, each with light bars across the
  // ceiling and down both walls.
  const tunnelZ: number[] = [];
  for (let z = TUNNEL_Z - 7; z <= TUNNEL_Z + 7.01; z += 1.4) tunnelZ.push(z);
  for (const z of tunnelZ) {
    for (const sx of [-1, 1]) {
      steel.put(sx * 3.75, 2.25, z, 0.18, 4.5, 0.18, STEEL_DARK);
      tunnel.put(sx * 3.62, 2.2, z, 0.04, 3.0, 0.06, COOL);
    }
    steel.put(0, 4.5, z, 7.7, 0.18, 0.18, STEEL_DARK);
    tunnel.put(0, 4.38, z, 6.9, 0.04, 0.06, COOL);
  }
  steel.put(0, 4.62, TUNNEL_Z, 0.3, 0.2, 15, STEEL_DARK);

  // The exit gate: posts and a lintel round the opening.
  for (const sx of [-1, 1]) steel.put(sx * 9.8, 5, GATE_Z, 1.3, 10, 1.3, STEEL_DARK);
  steel.put(0, 9.6, GATE_Z, 21, 1.3, 1.3, STEEL_DARK);

  steel.end();
  ducts.end();
  fixtures.end();
  fixtureLights.end();
  tunnel.end();
  return { steel, ducts, fixtures, fixtureLights, tunnel, fixtureZ, tunnelZ };
}

export function PlantHall() {
  const built = useMemo(() => build(), []);
  const wallMap = useMemo(() => wallTexture(), []);
  const wallMaterial = useMemo(() => patchHallLit(new THREE.MeshBasicMaterial({ map: wallMap, color: "#ffffff" })), [wallMap]);
  const concreteMaterial = useMemo(() => patchHallLit(new THREE.MeshBasicMaterial({ color: new THREE.Color(...CONCRETE) })), []);
  const boardRefs = useRef<(THREE.Mesh | null)[]>([]);
  const gateRef = useRef<THREE.MeshBasicMaterial>(null);
  const lastRadius = useRef(Number.NaN);

  // Wall boards, drawn once the display face is loaded.
  const boards = useMemo(
    () =>
      [
        ...Array.from({ length: STATION_COUNT }, (_, i) => ({
          key: `s${i}`,
          title: STATION_NAMES[i].toUpperCase(),
          z: stationZ(i + 1),
          x: -23.7,
          yaw: Math.PI / 2,
          w: 7.6,
          h: 2.4,
        })),
        // The near wall repeats them for the camera's side of the hall.
        ...Array.from({ length: STATION_COUNT }, (_, i) => ({
          key: `n${i}`,
          title: STATION_NAMES[i].toUpperCase(),
          z: stationZ(i + 1),
          x: 23.7,
          yaw: -Math.PI / 2,
          w: 7.6,
          h: 2.4,
        })),
      ] as const,
    [],
  );
  const tunnelBoard = useMemo(() => ({ title: "INSPECTION", z: TUNNEL_Z - 7.6, y: 5.4 }), []);

  useEffect(() => {
    let cancelled = false;
    const textures: THREE.Texture[] = [];
    void plantFontsReady().then((fonts) => {
      if (cancelled) return;
      // A board is cut to its text (see drawBoard), so its width follows the
      // drawn canvas: the height stays what the hall's scale says it is.
      boards.forEach((b, i) => {
        const mesh = boardRefs.current[i];
        if (!mesh) return;
        const canvas = drawBoard(fonts, { title: b.title, width: 1536, height: 486 });
        const tex = boardTexture(canvas);
        textures.push(tex);
        mesh.scale.x = (b.h * (canvas.width / canvas.height)) / b.w;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map = tex;
        mat.needsUpdate = true;
      });
      const tm = boardRefs.current[boards.length];
      if (tm) {
        const canvas = drawBoard(fonts, { title: tunnelBoard.title, width: 1536, height: 300 });
        const tex = boardTexture(canvas);
        textures.push(tex);
        tm.scale.x = (1.25 * (canvas.width / canvas.height)) / 6.4;
        const mat = tm.material as THREE.MeshBasicMaterial;
        mat.map = tex;
        mat.needsUpdate = true;
      }
    });
    return () => {
      cancelled = true;
      textures.forEach((t) => t.dispose());
    };
  }, [boards, tunnelBoard]);

  useEffect(
    () => () => {
      for (const pool of [built.steel, built.ducts, built.fixtures, built.fixtureLights, built.tunnel]) {
        pool.mesh.geometry.dispose();
        (pool.mesh.material as THREE.Material).dispose();
        pool.dispose();
      }
      wallMap.dispose();
      wallMaterial.dispose();
      concreteMaterial.dispose();
    },
    [built, wallMap, wallMaterial, concreteMaterial],
  );

  useFrame(() => {
    const f = scrollState.factory;
    if (f <= 0) return;

    // The exit gate's opening.
    const glow = gateGlow(f);
    if (gateRef.current) gateRef.current.color.setRGB(0.55, 0.7, 1.0).multiplyScalar(0.05 + 3.2 * glow);

    // Overhead lights and the tunnel come on from the tunnel outward. Instance
    // colours are only rewritten while the front is actually moving.
    const radius = ignitionRadius(f);
    if (Math.abs(radius - lastRadius.current) < 0.05) return;
    lastRadius.current = radius;

    const arr = built.fixtureLights.mesh.instanceColor!.array as Float32Array;
    const nz = built.fixtureZ.length;
    for (let r = 0; r < HALL.rowX.length; r++) {
      for (let i = 0; i < nz; i++) {
        const z = built.fixtureZ[i];
        const L = lit(z, radius);
        // A fixture that is just coming on flickers as it strikes.
        let flick = 1;
        if (L > 0.001 && L < 0.999) {
          const h = Math.sin((r * 31 + i) * 12.9898) * 43758.5453;
          flick = 0.5 + 0.5 * (h - Math.floor(h));
        }
        const k = FIXTURE_PEAK * L * flick + 0.012;
        const o = (r * nz + i) * 3;
        arr[o] = COOL[0] * k;
        arr[o + 1] = COOL[1] * k;
        arr[o + 2] = COOL[2] * k;
      }
    }
    built.fixtureLights.mesh.instanceColor!.needsUpdate = true;

    const ta = built.tunnel.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < built.tunnelZ.length; i++) {
      const k = 4 * lit(built.tunnelZ[i], radius) + 0.02;
      for (let b = 0; b < 3; b++) {
        const o = (i * 3 + b) * 3;
        ta[o] = COOL[0] * k;
        ta[o + 1] = COOL[1] * k;
        ta[o + 2] = COOL[2] * k;
      }
    }
    built.tunnel.mesh.instanceColor!.needsUpdate = true;
  });

  const zMid = (HALL.zMin + HALL.zMax) / 2;
  const length = HALL.zMax - HALL.zMin;

  return (
    <group>
      <primitive object={built.steel.mesh} />
      <primitive object={built.ducts.mesh} />
      <primitive object={built.fixtures.mesh} />
      <primitive object={built.fixtureLights.mesh} />
      <primitive object={built.tunnel.mesh} />

      {/* Side walls: painted cladding, a glazing band, behind the columns. */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * 24.4, 7, zMid]} rotation-y={(-sx * Math.PI) / 2} material={wallMaterial}>
          <planeGeometry args={[length, 14]} />
        </mesh>
      ))}

      {/* The upstream end of the hall: a plain wall, so the far end is a place
          and not a void. */}
      <mesh position={[0, 7, HALL.zMin - 0.5]} material={concreteMaterial}>
        <planeGeometry args={[49, 14]} />
      </mesh>

      {/* Station boards, on both walls. */}
      {boards.map((b, i) => (
        <mesh
          key={b.key}
          ref={(el) => {
            boardRefs.current[i] = el;
          }}
          position={[b.x, 7.4, b.z]}
          rotation-y={b.yaw}
        >
          <planeGeometry args={[b.w, b.h]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}

      {/* The tunnel's own board, over its mouth, facing up the line. */}
      <mesh
        ref={(el) => {
          boardRefs.current[boards.length] = el;
        }}
        position={[0, tunnelBoard.y, tunnelBoard.z]}
        rotation-y={Math.PI}
      >
        <planeGeometry args={[6.4, 1.25]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      {/* The gate's opening. */}
      <mesh position={[0, 4.4, GATE_Z + 0.6]}>
        <planeGeometry args={[18.6, 8.8]} />
        <meshBasicMaterial ref={gateRef} color="#ffffff" fog={false} />
      </mesh>
    </group>
  );
}
