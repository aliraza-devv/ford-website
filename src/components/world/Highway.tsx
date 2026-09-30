"use client";

/* eslint-disable react-hooks/immutability --
 * useFrame callbacks here imperatively update instance matrices, shader
 * uniforms and texture state every frame, outside React's render/commit cycle. */

import { type RefObject, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ParallaxState } from "@/hooks/useParallax";
import type { Tier } from "@/lib/perfTier";
import { METER, SKY_HORIZON_COLOR } from "@/config/worlds";
import { getStage, scrollState } from "@/lib/scrollState";
import { headlightLocal } from "@/lib/worldLights";
import { worldDebug } from "@/lib/worldDebug";
import { Ground, GROUND_CENTER_Z, GROUND_SIZE } from "./Ground";
import {
  makeIndustrialTexture,
  makeInterchangeTexture,
  makeLightPointsTexture,
  makePaintAlphaTexture,
  makeRoughnessTexture,
} from "./proceduralTextures";
import { PAINT_FRAGMENT, ROAD_VERTEX, roadShared } from "./roadShader";

// Everything in this file is authored in METRES. World.tsx mounts it inside
// a group scaled by METER, so these numbers are real-world sizes.

const LANE_DASH_X = 1.8; // dashed lines at +/-1.8 m of the car's centre (3.6 m lane)
const EDGE_LINE_X = 5.4; // solid edge lines
const LINE_WIDTH = 0.15;
const PAINT_PERIOD = 12; // 3 m dash + 9 m gap

/** Lamp posts stand on the RIGHT of the frame (+X), 28 m apart, 9 m tall with
 * a 2.5 m arm reaching over the carriageway. */
export const LAMP = {
  x: 7.5,
  height: 9,
  arm: 2.5,
  spacing: 28,
  count: 10, // 280 m of road, recycled by modulo
  zMin: -220,
};

/** Low concrete barrier on the left (-X). */
const BARRIER = { x: -6.8, segment: 4, count: 70, zMin: -220 };

// The road shader lights itself from two headlights and a window of four lamp
// heads (roadShader.ts). Intensities are in the shader's own units: picked so
// a lamp pool reads as a soft wash on the tarmac and a headlight pool as a
// wider, stronger one.
const LAMP_LIGHT = { slots: 4, windowMin: -84, intensity: 2100, angle: 0.95 };
const BEAM = { intensity: 6500, angle: 0.42 };

/** Scroll stage past which the camera is inside the car and the highway is
 * no longer drawn. */
const CABIN_HIDES_WORLD = 1.95;

/** z of lattice slot `index`, wrapped into [zMin, zMin + spacing*count). Every
 * lattice here (lamp posts, pooled lights, environment lamps, barrier joints)
 * is congruent to -travel modulo the spacing, which is what keeps a pooled
 * light exactly under the lamp head it belongs to. */
export function latticeZ(index: number, spacing: number, count: number, zMin: number, travel: number) {
  const length = spacing * count;
  const raw = index * spacing - travel - zMin;
  return zMin + (((raw % length) + length) % length);
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** 0 at the ends of the lamp window, 1 in the middle, so a pooled light
 * handing from one lamp to the next does so while it is switched off. */
export function lampWindowWeight(z: number) {
  return smooth(LAMP_LIGHT.windowMin, LAMP_LIGHT.windowMin + 20, z) * (1 - smooth(8, 28, z));
}

type HighwayProps = {
  tier: Tier;
  parallaxRef: RefObject<ParallaxState>;
};

const scratch = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

export function Highway({ tier, parallaxRef }: HighwayProps) {
  const rootRef = useRef<THREE.Group>(null);

  // ------------------------------------------------------------ textures
  const textures = useMemo(() => {
    const roughness = makeRoughnessTexture();
    roughness.anisotropy = 4;
    const dashed = makePaintAlphaTexture(true);
    const solid = makePaintAlphaTexture(false);
    for (const t of [dashed, solid]) t.anisotropy = 4;

    const glow = `#${SKY_HORIZON_COLOR.getHexString()}`;
    return {
      roughness,
      dashed,
      solid,
      interchange: makeInterchangeTexture(glow, 0.2),
      industrial: makeIndustrialTexture(glow, 0.14),
      points: makeLightPointsTexture(),
    };
  }, []);

  useEffect(() => {
    roadShared.tRough.value = textures.roughness;
    return () => {
      roadShared.tRough.value = null;
      for (const t of Object.values(textures)) t.dispose();
    };
  }, [textures]);

  // ---------------------------------------------------------- lane paint
  const paint = useMemo(() => {
    const make = (alphaMap: THREE.Texture) =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...roadShared,
          textureMatrix: { value: new THREE.Matrix4() },
          tAlpha: { value: alphaMap },
          uPaintOffset: { value: 0 },
          uRepeatY: { value: GROUND_SIZE / PAINT_PERIOD },
          // View-space distances are in scene units, hence the METER factor.
          uFadeNear: { value: 4 * METER },
          uFadeFar: { value: 120 * METER },
        },
        vertexShader: ROAD_VERTEX,
        fragmentShader: PAINT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    return { dashed: make(textures.dashed), solid: make(textures.solid) };
  }, [textures]);

  useEffect(
    () => () => {
      paint.dashed.dispose();
      paint.solid.dispose();
    },
    [paint],
  );

  // ----------------------------------------------------------- lamp posts
  const lampCount = tier === "low" ? LAMP.count / 2 : LAMP.count;
  const lampSpacing = tier === "low" ? LAMP.spacing * 2 : LAMP.spacing;

  const poleRef = useRef<THREE.InstancedMesh>(null);
  const armRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const barrierRef = useRef<THREE.InstancedMesh>(null);
  const cardRefs = useRef<(THREE.Mesh | null)[]>([]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Cone shapes and the lamps' downward direction never change.
  useEffect(() => {
    for (let k = 0; k < LAMP_LIGHT.slots; k++) {
      roadShared.uLightDir.value[2 + k].set(0, -1, 0);
      roadShared.uLightCone.value[2 + k].set(Math.cos(LAMP_LIGHT.angle), Math.cos(LAMP_LIGHT.angle * 0.5));
    }
    for (let h = 0; h < 2; h++) {
      roadShared.uLightCone.value[h].set(Math.cos(BEAM.angle), Math.cos(BEAM.angle * 0.5));
    }
  }, []);

  useFrame(() => {
    const travel = scrollState.travel;
    const stage = getStage();
    const showProps = worldDebug.props;

    // Inside the cabin the road is fogged to black and mostly hidden by the
    // dashboard; skip drawing (and, on the higher tiers, reflecting) it.
    if (rootRef.current) rootRef.current.visible = stage < CABIN_HIDES_WORLD;

    roadShared.uTravel.value = travel;
    const paintOffset = (-travel / PAINT_PERIOD) % 1;
    paint.dashed.uniforms.uPaintOffset.value = paintOffset;
    paint.solid.uniforms.uPaintOffset.value = paintOffset;

    // ---- the road shader's lights, in world space
    const root = rootRef.current;
    if (root) {
      root.updateWorldMatrix(true, false);
      const { uLightPos, uLightDir, uLightColor } = roadShared;

      // Headlights: a forward beam that dips to meet the road, fading out
      // through Section 3 (a forward beam has no business inside the cabin).
      const beam = BEAM.intensity * (1 - smooth(1.0, 1.5, stage));
      scratchDir.set(0, -0.06, 1).transformDirection(root.matrixWorld);
      for (let h = 0; h < 2; h++) {
        scratch.copy(headlightLocal[h]);
        scratch.z += 0.25;
        root.localToWorld(scratch);
        uLightPos.value[h].copy(scratch);
        uLightDir.value[h].copy(scratchDir);
        uLightColor.value[h].set(1, 0.95, 0.85).multiplyScalar(beam);
      }

      // Lamp heads nearest the car.
      for (let k = 0; k < LAMP_LIGHT.slots; k++) {
        const z = latticeZ(k, LAMP.spacing, LAMP_LIGHT.slots, LAMP_LIGHT.windowMin, travel);
        scratch.set(LAMP.x - LAMP.arm, LAMP.height - 0.3, z);
        root.localToWorld(scratch);
        uLightPos.value[2 + k].copy(scratch);
        const w = showProps ? lampWindowWeight(z) : 0;
        uLightColor.value[2 + k].set(0.86, 0.91, 1.0).multiplyScalar(LAMP_LIGHT.intensity * w);
      }
    }

    // ---- lamp posts, recycled by modulo so the road loops forever
    const pole = poleRef.current;
    const arm = armRef.current;
    const head = headRef.current;
    if (pole && arm && head) {
      pole.visible = arm.visible = head.visible = showProps;
      for (let i = 0; i < lampCount; i++) {
        const z = latticeZ(i, lampSpacing, lampCount, LAMP.zMin, travel);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);

        dummy.position.set(LAMP.x, LAMP.height / 2, z);
        dummy.updateMatrix();
        pole.setMatrixAt(i, dummy.matrix);

        dummy.position.set(LAMP.x - LAMP.arm / 2, LAMP.height, z);
        dummy.updateMatrix();
        arm.setMatrixAt(i, dummy.matrix);

        dummy.position.set(LAMP.x - LAMP.arm, LAMP.height - 0.12, z);
        dummy.updateMatrix();
        head.setMatrixAt(i, dummy.matrix);
      }
      pole.instanceMatrix.needsUpdate = true;
      arm.instanceMatrix.needsUpdate = true;
      head.instanceMatrix.needsUpdate = true;
    }

    const barrier = barrierRef.current;
    if (barrier) {
      barrier.visible = showProps;
      for (let i = 0; i < BARRIER.count; i++) {
        const z = latticeZ(i, BARRIER.segment, BARRIER.count, BARRIER.zMin, travel);
        dummy.position.set(BARRIER.x, 0, z);
        dummy.updateMatrix();
        barrier.setMatrixAt(i, dummy.matrix);
      }
      barrier.instanceMatrix.needsUpdate = true;
    }

    // Horizon cards: a tiny mouse offset each (0.15x / 0.25x / 0.35x).
    const px = parallaxRef.current.x;
    const strengths = [0.15, 0.25, 0.35];
    for (let c = 0; c < 3; c++) {
      const card = cardRefs.current[c];
      if (!card) continue;
      card.position.x = CARD_X[c] + px * strengths[c] * 4;
      card.visible = worldDebug.horizon;
    }
  });

  return (
    <group ref={rootRef}>
      {/* ---------------------------------------------------------- ground */}
      <Ground tier={tier} />

      {/* --------------------------------------------------------- markings */}
      {[-LANE_DASH_X, LANE_DASH_X].map((x) => (
        <mesh key={`dash${x}`} rotation-x={-Math.PI / 2} position={[x, 0.004, GROUND_CENTER_Z]} material={paint.dashed}>
          <planeGeometry args={[LINE_WIDTH, GROUND_SIZE]} />
        </mesh>
      ))}
      {[-EDGE_LINE_X, EDGE_LINE_X].map((x) => (
        <mesh key={`edge${x}`} rotation-x={-Math.PI / 2} position={[x, 0.004, GROUND_CENTER_Z]} material={paint.solid}>
          <planeGeometry args={[LINE_WIDTH, GROUND_SIZE]} />
        </mesh>
      ))}

      {/* -------------------------------------------------------- lamp posts */}
      <instancedMesh ref={poleRef} args={[undefined, undefined, lampCount]} frustumCulled={false}>
        <cylinderGeometry args={[0.07, 0.11, LAMP.height, 8]} />
        <meshStandardMaterial color="#0b0f18" metalness={0.7} roughness={0.45} envMapIntensity={0.6} />
      </instancedMesh>
      <instancedMesh ref={armRef} args={[undefined, undefined, lampCount]} frustumCulled={false}>
        <boxGeometry args={[LAMP.arm, 0.1, 0.1]} />
        <meshStandardMaterial color="#0b0f18" metalness={0.7} roughness={0.45} envMapIntensity={0.6} />
      </instancedMesh>
      {/* The luminous head panel. Emissive well above the bloom threshold,
          mirrored as a Lightformer in the car's environment (EnvLamps), and
          the source of one of the road shader's lights. */}
      <instancedMesh ref={headRef} args={[undefined, undefined, lampCount]} frustumCulled={false}>
        <boxGeometry args={[1.0, 0.08, 0.45]} />
        <meshStandardMaterial color="#0b0f18" emissive="#dce6ff" emissiveIntensity={5} toneMapped />
      </instancedMesh>

      {/* ---------------------------------------------------------- barrier */}
      <instancedMesh ref={barrierRef} args={[undefined, undefined, BARRIER.count]} frustumCulled={false}>
        <boxGeometry args={[0.6, 0.85, BARRIER.segment - 0.05]} />
        <meshStandardMaterial color="#141a26" roughness={0.92} metalness={0} envMapIntensity={0.4} />
      </instancedMesh>

      {/* ---------------------------------------------------------- horizon */}
      {HORIZON_CARDS.map((card, c) => (
        <mesh
          key={card.key}
          ref={(el) => {
            cardRefs.current[c] = el;
          }}
          position={[CARD_X[c], card.height / 2, card.z]}
        >
          <planeGeometry args={[card.width, card.height]} />
          <meshBasicMaterial
            map={textures[card.key]}
            transparent
            depthWrite={false}
            fog={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

// Three sparse layers, far to near. Low horizon, lots of negative space.
const HORIZON_CARDS = [
  { key: "points", width: 420, height: 13, z: -255 },
  { key: "interchange", width: 330, height: 20.6, z: -235 },
  { key: "industrial", width: 120, height: 22.5, z: -215 },
] as const;

const CARD_X = [0, 10, 42];
