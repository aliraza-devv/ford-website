"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ACTORS, realPartPose, zB } from "@/config/line";
import { METER } from "@/config/worlds";
import { hotspotScreen } from "@/lib/hotspots";
import { carSource } from "@/lib/carSource";
import { normalizeNodeName } from "@/lib/nodeNames";
import { PLANT_CALLOUTS } from "@/lib/plantCallouts";
import { scrollState } from "@/lib/scrollState";

/**
 * B: the car we follow down the line.
 *
 * It is a clone of the model Sections 1-3 use, taken after that model's
 * materials were finished, so it shares the paint, glass and trim (and the
 * uploaded geometry) rather than duplicating them. Its parts are separate nodes
 * of the model's own hierarchy, which is what lets a hood be lifted by a hoist:
 * each assembly actor's parts are moved together, every frame, to wherever
 * `realPartPose` (config/line.ts) says they are.
 *
 * It only writes a mesh's position, and only for meshes that belong to an
 * actor; the rolling chassis is never touched. Before a part's cart has
 * brought it to the line the part is hidden, so nothing waits in mid-air.
 */

type RigPart = {
  object: THREE.Object3D;
  base: THREE.Vector3;
  toLocal: THREE.Matrix3;
  actor: number;
};

type Anchor = { id: string; mesh: THREE.Mesh; localCenter: THREE.Vector3 };

type Built = {
  outer: THREE.Group;
  parts: RigPart[];
  anchors: Anchor[];
  /** glb units per hall metre. */
  unitsPerMetre: number;
  visible: boolean[];
};

function build(): Built {
  const source = carSource.scene!;
  const scale = carSource.scale;
  const offset = carSource.offset!;

  const scene = source.clone(true);
  // Same wrapper MustangModel uses, except in hall metres: the hall group the
  // plant lives in is already scaled by METER, so glb units -> metres here.
  const inner = new THREE.Group();
  inner.scale.setScalar(scale / METER);
  inner.position.copy(offset).multiplyScalar(scale / METER);
  inner.add(scene);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.updateMatrixWorld(true);

  const sceneInverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const parts: RigPart[] = [];
  const byName = new Map<string, THREE.Mesh>();

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.parent) return;
    const name = normalizeNodeName(child.name);
    byName.set(name, child);
    const actor = ACTORS.findIndex((a) => a.match.test(name));
    if (actor < 0) return;

    // Parent frame -> the model's own frame, rotation and scale only.
    const parentInScene = new THREE.Matrix4().multiplyMatrices(sceneInverse, child.parent.matrixWorld);
    const toLocal = new THREE.Matrix3().setFromMatrix4(parentInScene);
    if (Math.abs(toLocal.determinant()) < 1e-12) return;
    toLocal.invert();
    parts.push({ object: child, base: child.position.clone(), toLocal, actor });
  });

  const anchors: Anchor[] = [];
  for (const c of PLANT_CALLOUTS) {
    const mesh = byName.get(normalizeNodeName(c.node));
    if (!mesh) continue;
    mesh.geometry.computeBoundingBox();
    const localCenter = new THREE.Vector3();
    mesh.geometry.boundingBox!.getCenter(localCenter);
    anchors.push({ id: c.id, mesh, localCenter });
  }

  return {
    outer,
    parts,
    anchors,
    unitsPerMetre: METER / scale,
    visible: ACTORS.map(() => true),
  };
}

const projectScratch = new THREE.Vector3();
const camDirScratch = new THREE.Vector3();
const toPointScratch = new THREE.Vector3();
const offsetScratch = new THREE.Vector3();

export function PlantCar() {
  const holder = useRef<THREE.Group>(null);
  const built = useRef<Built | null>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useEffect(
    () => () => {
      built.current = null;
    },
    [],
  );

  useFrame(() => {
    const f = scrollState.factory;
    const group = holder.current;
    if (!group) return;

    // Built lazily, the first frame the source car is ready: it has to exist
    // before it can be cloned.
    if (!built.current) {
      if (!carSource.ready) return;
      built.current = build();
      group.add(built.current.outer);
    }
    const b = built.current;

    // B is only on stage once the camera has left the finished car behind.
    const show = f >= 0.085;
    b.outer.visible = show;
    if (!show) return;

    const z = zB(f);
    b.outer.position.set(0, 0, z);

    // Each actor's parts: where is the part, relative to where it belongs on B?
    ACTORS.forEach((a, i) => {
      const pose = realPartPose(a, f);
      if (pose.visible !== b.visible[i]) {
        b.visible[i] = pose.visible;
        for (const p of b.parts) if (p.actor === i) p.object.visible = pose.visible;
      }
      if (!pose.visible) return;
      const dx = pose.center[0] - a.center[0];
      const dy = pose.center[1] - a.center[1];
      const dz = pose.center[2] - (z + a.center[2]);
      for (const p of b.parts) {
        if (p.actor !== i) continue;
        offsetScratch.set(dx, dy, dz).multiplyScalar(b.unitsPerMetre).applyMatrix3(p.toLocal);
        p.object.position.copy(p.base).add(offsetScratch);
      }
    });

    // Callout anchors: only worth projecting while a callout can be on screen.
    const screen = hotspotScreen;
    if (f > 0.15 && f < 0.3) {
      b.outer.updateMatrixWorld(true);
      camera.getWorldDirection(camDirScratch);
      for (const anchor of b.anchors) {
        projectScratch.copy(anchor.localCenter).applyMatrix4(anchor.mesh.matrixWorld);
        toPointScratch.copy(projectScratch).sub(camera.position);
        const inFront = toPointScratch.dot(camDirScratch) > 0;
        projectScratch.project(camera);
        screen[anchor.id] = {
          x: (projectScratch.x * 0.5 + 0.5) * size.width,
          y: (-projectScratch.y * 0.5 + 0.5) * size.height,
          visible: inFront && projectScratch.z < 1,
        };
      }
    }
  });

  return <group ref={holder} />;
}
