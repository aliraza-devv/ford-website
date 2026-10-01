"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ACTORS,
  CART_AWAY,
  CAR_RANGE,
  GATE_Z,
  HALL,
  STATE_ACTORS,
  type ActorId,
  cartAway,
  carryState,
  currentCycle,
  holdEnd,
  holdU,
  lineCarZ,
  opsDone,
  smooth01,
  stagedCenter,
  stepEnd,
  win,
} from "@/config/line";
import { decimateToBudget } from "@/lib/decimate";
import { METER } from "@/config/worlds";
import { carSource } from "@/lib/carSource";
import { normalizeNodeName } from "@/lib/nodeNames";
import { scrollState } from "@/lib/scrollState";
import { PAINT_BASE } from "@/lib/theme";

/**
 * The other cars on the line.
 *
 * A plant with one car in it is a stage set; a plant is cars, in a row, at
 * different points of being built, all moving together. These are those cars.
 * Each is the real model, decimated at load (vertex clustering, see
 * lib/decimate.ts) to about a twentieth of its triangles and baked to vertex
 * colours, so a car is ONE draw call and a few thousand triangles, and a line
 * of nine is cheaper than the single full-detail car in front of the camera.
 *
 * There are six body states (a rolling chassis, then the five operations
 * stacked on it) and eight parts that travel: they run the SAME carry paths the
 * real car's parts do (config/line.ts), in the same takt, so a stand-in car at
 * the next station has its hood lifted onto it at the very moment the real one
 * has its door hung. When a part lands, the car's state steps up on the same
 * frame the travelling part disappears, so there is no pop.
 */

/** Stand-in cars, by position on the line relative to the real one. Zero is
 * the real car; six is the finished car the film leaves behind. */
const NS = [-4, -3, -2, -1, 1, 2, 3, 4, 5];

// Linear-space colours baked into the vertices.
// The paint is the real car's blue, a touch lifted: a stand-in has no clearcoat
// to catch the lights with, so its flat colour has to carry a little more.
const PAINT: [number, number, number] = (() => {
  const c = new THREE.Color(PAINT_BASE);
  return [c.r * 1.15, c.g * 1.15, c.b * 1.15];
})();
const BLACK: [number, number, number] = [0.012, 0.012, 0.015];
const GLASS: [number, number, number] = [0.01, 0.016, 0.034];
const METAL: [number, number, number] = [0.07, 0.075, 0.09];
const TRIM: [number, number, number] = [0.03, 0.03, 0.036];
const BRAKE: [number, number, number] = [0.45, 0.02, 0.02];
const LIGHT: [number, number, number] = [0.9, 0.85, 0.75];
const SILVER: [number, number, number] = [0.45, 0.46, 0.5];
const AMBER: [number, number, number] = [0.6, 0.3, 0.02];

/** Cabin furniture the stand-ins do without: it is hidden behind dark glass at
 * the distances they are seen from. */
const SKIP = /^GT500(Dash_|Steer_|Seat|Sunvisor_|Gauges_|Screen_|Shifter_|MirrorInt_|Stalk|Pedal|Rollcage_)/;

function colourOf(mesh: THREE.Mesh, bodyMaterial: THREE.Material | null): [number, number, number] {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (mat === bodyMaterial) return PAINT;
  const name = (mat?.name ?? "").toLowerCase();
  if (name.includes("glass")) return GLASS;
  if (name.includes("carpaint")) return PAINT;
  if (name.includes("tire")) return BLACK;
  if (name.includes("glossblack") || name.includes("roll")) return BLACK;
  if (name.includes("plate")) return METAL;
  if (name.includes("brake")) return BRAKE;
  if (name.includes("rearlight") || name.includes("light")) return LIGHT;
  if (name.includes("mirror")) return SILVER;
  if (name.includes("orange")) return AMBER;
  if (name.includes("white")) return SILVER;
  if (name.includes("leather") || name.includes("seat")) return TRIM;
  return METAL;
}

type Accum = { pos: number[]; nrm: number[]; col: number[]; idx: number[]; verts: number };
const newAccum = (): Accum => ({ pos: [], nrm: [], col: [], idx: [], verts: 0 });

function toGeometry(a: Accum): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(a.nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(a.col, 3));
  g.setIndex(a.idx);
  g.computeBoundingSphere();
  return g;
}

type Built = {
  states: THREE.BufferGeometry[];
  parts: Record<ActorId, THREE.BufferGeometry>;
};

export function ProxyCars() {
  const groupRef = useRef<THREE.Group>(null);
  const built = useRef<Built | null>(null);
  const building = useRef(false);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.62,
        roughness: 0.38,
        envMapIntensity: 1.35,
      }),
    [],
  );
  const carMeshes = useMemo(() => NS.map(() => new THREE.Mesh(undefined, material)), [material]);
  const partMeshes = useMemo(() => ACTORS.map(() => new THREE.Mesh(undefined, material)), [material]);
  const lastState = useRef<number[]>(NS.map(() => -1));

  useEffect(() => {
    for (const m of [...carMeshes, ...partMeshes]) {
      m.visible = false;
      m.frustumCulled = true;
    }
    return () => {
      material.dispose();
    };
  }, [material, carMeshes, partMeshes]);

  // Build in slices as soon as the source car is ready (at load, long before
  // anyone scrolls this far), a few milliseconds at a time so the page never
  // hitches.
  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const start = () => {
      if (cancelled || building.current || built.current) return;
      if (!carSource.ready || !carSource.scene || !carSource.offset) {
        timer = window.setTimeout(start, 250);
        return;
      }
      building.current = true;

      const scene = carSource.scene;
      scene.updateMatrixWorld(true);
      const sceneInverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();
      // glb -> hall metres: the same wrapper PlantCar uses.
      const s = carSource.scale / METER;
      const toHall = new THREE.Matrix4()
        .makeScale(s, s, s)
        .multiply(new THREE.Matrix4().makeTranslation(carSource.offset.x, carSource.offset.y, carSource.offset.z));

      const meshes: THREE.Mesh[] = [];
      let bodyMaterial: THREE.Material | null = null;
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const name = normalizeNodeName(child.name);
        if (name === "GT500Body_carpaint_0") bodyMaterial = Array.isArray(child.material) ? child.material[0] : child.material;
        if (SKIP.test(name)) return;
        meshes.push(child);
      });

      const accum: Record<string, Accum> = { chassis: newAccum() };
      for (const a of ACTORS) accum[a.id] = newAccum();

      let i = 0;
      const step = () => {
        if (cancelled) return;
        const t0 = performance.now();
        while (i < meshes.length && performance.now() - t0 < 6) {
          const mesh = meshes[i++];
          const name = normalizeNodeName(mesh.name);
          const actor = ACTORS.find((a) => a.match.test(name));
          const target = accum[actor ? actor.id : "chassis"];

          const matrix = new THREE.Matrix4().multiplyMatrices(toHall, new THREE.Matrix4().multiplyMatrices(sceneInverse, mesh.matrixWorld));
          const geo = mesh.geometry;
          const tris = (geo.index ? geo.index.count : geo.getAttribute("position").count) / 3;
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          const isTire = (mat?.name ?? "").toLowerCase().includes("tire");
          const budget = Math.max(isTire ? 140 : 36, Math.round(tris * (isTire ? 0.022 : 0.05)));
          const d = decimateToBudget(geo, matrix, budget);
          if (d.triangles === 0) continue;

          const col = colourOf(mesh, bodyMaterial);
          const base = target.verts;
          for (let k = 0; k < d.position.length; k++) {
            target.pos.push(d.position[k]);
            target.nrm.push(d.normal[k]);
          }
          for (let k = 0; k < d.position.length / 3; k++) target.col.push(col[0], col[1], col[2]);
          for (let k = 0; k < d.index.length; k++) target.idx.push(d.index[k] + base);
          target.verts += d.position.length / 3;
        }
        if (i < meshes.length) {
          timer = window.setTimeout(step, 0);
          return;
        }

        // Finalise: per-actor part geometry, and the six cumulative body states.
        const chassis = toGeometry(accum.chassis);
        const parts = {} as Record<ActorId, THREE.BufferGeometry>;
        for (const a of ACTORS) parts[a.id] = toGeometry(accum[a.id]);
        const states = STATE_ACTORS.map((ids) => {
          const geos = [chassis, ...ids.map((id) => parts[id])];
          return geos.length === 1 ? chassis : mergeGeometries(geos.map((g) => g.clone()), false)!;
        });
        built.current = { states, parts };
        building.current = false;
        if (process.env.NODE_ENV !== "production") {
          const tri = (g: THREE.BufferGeometry) => g.getIndex()!.count / 3;
          (window as unknown as Record<string, unknown>).__fordProxy = { states: states.map(tri), parts: Object.fromEntries(ACTORS.map((a) => [a.id, tri(parts[a.id])])) };
        }
      };
      timer = window.setTimeout(step, 0);
    };
    start();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useFrame(() => {
    const f = scrollState.factory;
    const b = built.current;
    const on = f > 0.0005 && !!b;
    if (!on || !b) {
      for (const m of [...carMeshes, ...partMeshes]) m.visible = false;
      return;
    }

    // ---- the cars
    NS.forEach((n, k) => {
      const mesh = carMeshes[k];
      const z = lineCarZ(n, f);
      const inHall = z > HALL.zMin + 4 && z < GATE_Z + 6;
      mesh.visible = inHall;
      if (!inHall) return;
      const state = opsDone(n, f);
      if (lastState.current[k] !== state) {
        lastState.current[k] = state;
        mesh.geometry = b.states[state];
      }
      mesh.position.set(0, 0, z);
    });

    // ---- the travelling parts: same carry paths as the real car's
    const c = currentCycle(f);
    const inStep = c >= 0 && f > holdEnd(c) - 1e-9;
    ACTORS.forEach((a, k) => {
      const mesh = partMeshes[k];
      // The hold this actor's cart is serving, and the car that hold is for.
      const served = c < 0 ? 0 : inStep ? c + 1 : c;
      const n = a.station - served;
      const proxyCar = n !== 0 && n >= CAR_RANGE[0] && n <= 5 && served <= 5;
      if (!proxyCar) {
        mesh.visible = false;
        return;
      }
      let center: [number, number, number];
      if (inStep) {
        // The next cart sliding in, loaded.
        const away = 1 - smooth01(win(f, holdEnd(c), stepEnd(c)));
        const staged = stagedCenter(a);
        const dir = a.cartX < 0 ? -1 : 1;
        center = [staged[0] + dir * CART_AWAY * away, staged[1], staged[2]];
      } else {
        const u = c < 0 ? 0 : holdU(f);
        if (u >= 1 - 1e-9) {
          // Landed: now part of the car (its state stepped up this frame).
          mesh.visible = false;
          return;
        }
        center = carryState(a, u).center;
      }
      if (mesh.geometry !== b.parts[a.id]) mesh.geometry = b.parts[a.id];
      mesh.visible = true;
      // The geometry is in the car's frame, installed at the car origin.
      mesh.position.set(center[0] - a.center[0], center[1] - a.center[1], center[2] - a.center[2]);
    });
    // `cartAway` is the same helper the carts use; referenced so the two stay
    // in lock-step if its contract changes.
    void cartAway;
  });

  return (
    <group ref={groupRef}>
      {carMeshes.map((m, i) => (
        <primitive key={`c${i}`} object={m} />
      ))}
      {partMeshes.map((m, i) => (
        <primitive key={`p${i}`} object={m} />
      ))}
    </group>
  );
}
