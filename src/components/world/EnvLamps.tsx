"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getCarPose } from "@/lib/carPose";
import { getStage, scrollState } from "@/lib/scrollState";
import { LAMP, latticeZ } from "./Highway";

// Rendered INSIDE <Environment>'s portal scene, so these meshes become light
// in the car's reflections and image-based lighting -- the brief's rule that
// every visible light also lights the car. Each one is the same lamp head
// the highway draws, found by the same lattice maths, so they can't drift
// apart.
//
// An environment map only encodes directions, and a real lamp head 20 m away
// covers a fraction of a cube-map texel (it would flicker as it moves). So
// each panel is placed at a fixed radius along its lamp's direction and
// sized to a readable angular width, which keeps the highlight on the paint
// a soft, stable streak.
const SLOTS = 5;
const WINDOW_MIN = -84; // 5 slots x 28 m = 140 m window
const RADIUS = 14;
const BOOST = 1.6; // angular inflation over the real 1.0 x 0.45 m head
const INTENSITY = 9;

function smooth(a: number, b: number, x: number) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

const dir = new THREE.Vector3();
const tint = new THREE.Color("#dce6ff");

/** `live` false freezes them at travel = 0 (the low tier's static map). */
export function EnvLamps({ live }: { live: boolean }) {
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const materials = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  useFrame(() => {
    const travel = live ? scrollState.travel : 0;
    const inPlant = scrollState.factory > 0.001;
    const { yaw } = getCarPose(getStage());
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    for (let k = 0; k < SLOTS; k++) {
      const mesh = meshes.current[k];
      const material = materials.current[k];
      if (!mesh || !material) continue;

      const z = latticeZ(k, LAMP.spacing, SLOTS, WINDOW_MIN, travel);
      const x = LAMP.x - LAMP.arm;
      const y = LAMP.height;

      // Rotate the lamp's car-local position by the car's yaw, so it lands
      // in the same world direction the highway draws it in.
      dir.set(x * cos + z * sin, y, -x * sin + z * cos);
      const distance = dir.length();
      dir.divideScalar(distance);

      mesh.position.copy(dir).multiplyScalar(RADIUS);
      mesh.lookAt(0, 0, 0);
      const k2 = (RADIUS / distance) * BOOST;
      mesh.scale.set(1.0 * k2, 0.45 * k2, 1);

      // The highway's lamps are not in the plant.
      const weight = smooth(WINDOW_MIN, WINDOW_MIN + 14, z) * (1 - smooth(42, 56, z)) * (inPlant ? 0 : 1);
      material.color.copy(tint).multiplyScalar(INTENSITY * weight);
    }
  });

  return (
    <>
      {Array.from({ length: SLOTS }, (_, k) => (
        <mesh
          key={k}
          ref={(el) => {
            meshes.current[k] = el;
          }}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={(el) => {
              materials.current[k] = el;
            }}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </>
  );
}
