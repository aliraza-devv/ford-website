"use client";

/* eslint-disable react-hooks/immutability --
 * useFrame mutates the liquid-paint shader's uniforms every frame, outside
 * React's render/commit cycle (same pattern as the world components). */

import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import { MODEL_URL, PAINT_SHADER, RIG, SECTION3, TARGET_CAR_LENGTH } from "@/lib/theme";
import { HOTSPOTS, type HotspotScreenMap } from "@/lib/hotspots";
import { getStage } from "@/lib/scrollState";
import { useLiquidPaintMaterial } from "./LiquidPaintMaterial";
import { InteriorLights } from "./InteriorLights";
import { useTier } from "@/lib/perfTier";
import { headlightLocal } from "@/lib/worldLights";
import { METER } from "@/config/worlds";

useGLTF.preload(MODEL_URL);

// This model's exterior painted body panels (Shelby GT500 export). Unlike
// the GTD, this model's paint-colored material ("carpaint") is shared by
// dozens of SEPARATE meshes, including underbody/engine-bay parts
// (suspension arms, subframe, radiator, transmission) that happen to use
// the same dark-blue color but aren't painted body panels -- matching by
// NODE name instead of material name picks out just the real exterior
// shell.
//
// Note that Door.L/R_carpaint_0 is BOTH the outer door skin and the
// body-colored accent panel on the inside of the door card -- one mesh,
// verified from the glb (the two overlap through the card's full depth).
// That's why the cabin's accent trim takes the bodywork's colour and its
// liquid-paint hover effect. Emergent, but correct: it's painted body-color
// on the real car for the same reason.
/**
 * three's GLTFLoader renames every node through
 * `PropertyBinding.sanitizeNodeName`, which STRIPS the characters
 * `. [ ] : /` outright (it doesn't substitute them). So this model's
 * "GT500.Door.L_carpaint_0" is only ever reachable as
 * "GT500DoorL_carpaint_0" once loaded, and `scene.getObjectByName` with the
 * name as it appears in the glb silently returns undefined.
 *
 * Everything below therefore matches on the NORMALIZED form, and the names
 * written out in this file stay as they appear in the actual asset -- which
 * is what you'd search for if you opened the glb in a viewer. Normalizing
 * both sides also means this keeps working if the loader's rules change.
 */
function normalizeNodeName(name: string): string {
  return name.replace(/[.[\]:/]/g, "");
}

const EXTERIOR_PANEL_PATTERN = /^GT500(Body|Door[LR]|Hood|Trunk|Bumper(Ft|Rr)|Fender[LR])_carpaint_0$/;
const MAIN_BODY_NODE_NAME = normalizeNodeName("GT500.Body_carpaint_0");
const HEADLIGHT_GLOW_PATTERN = /Headlight[LR]_light_0$/;

// Cabin surfaces, by node name. Listed explicitly rather than matched by
// material name because all three interior materials are SHARED with
// exterior parts -- "glossblack" alone covers the gauges and the shifter
// but also the rear wing, the badges and the wheels. Retuning the material
// in place would wash out the bodywork; these meshes get their own clone.
// See SECTION3.interiorMaterial for why any of this is necessary.
const INTERIOR_NODE_NAMES = new Set([
  "GT500.Dash_leather_0",
  "GT500.Steer_leather_0",
  "GT500.Sunvisor_leather_0",
  "GT500.Body_leather_0", // cabin floor, sills, rear shelf
  "GT500.Door.L_leather_0",
  "GT500.Door.R_leather_0",
  "GT500.Door.L_glossblack_0",
  "GT500.Door.R_glossblack_0",
  "GT500.Seat.Ft.L_seat_0",
  "GT500.Seat.Ft.R_seat_0",
  "GT500.Seats.Rr_seat_0",
  "GT500.Gauges_glossblack_0",
  "GT500.Screen_glossblack_0",
  "GT500.Shifter_glossblack_0",
  "GT500.Mirror.Int_glossblack_0",
  "GT500.Stalk.Wiper_glossblack_0",
  "GT500.Stalk.Signal_glossblack_0",
  "GT500.Pedal.Brake_glossblack_0",
  "GT500.Pedal.Gas_glossblack_0",
  "GT500.Rollcage_roll_0",
].map(normalizeNodeName));

function interiorColorFor(materialName: string): string | null {
  const name = materialName.toLowerCase();
  if (name.includes("seat")) return SECTION3.interiorMaterial.seatColor;
  if (name.includes("leather")) return SECTION3.interiorMaterial.leatherColor;
  if (name.includes("glossblack") || name.includes("roll")) {
    return SECTION3.interiorMaterial.glossBlackColor;
  }
  return null;
}

type MustangModelProps = {
  outerRef: React.RefObject<THREE.Group | null>;
  /** Per-hotspot projected screen position, written once per frame by the
   * useFrame below (the only place with live access to both the camera and
   * the car's current transform) and read by HotspotOverlay's own rAF loop. */
  hotspotScreenRef: React.RefObject<HotspotScreenMap>;
};

/** A resolved callout anchor: the mesh, plus its bbox centre in that mesh's
 * OWN geometry space. Stored in geometry space rather than world space so
 * it stays correct as the car rotates and shifts -- pushing it through the
 * mesh's live matrixWorld each frame is exact and allocation-free. */
type ResolvedAnchor = {
  id: string;
  mesh: THREE.Mesh;
  localCenter: THREE.Vector3;
};

// Frame-loop scratch -- nothing below allocates per frame.
const projectScratch = new THREE.Vector3();
const camDirScratch = new THREE.Vector3();
const toPointScratch = new THREE.Vector3();

/**
 * Loads the Shelby GT500 glb, auto-centers/scales it, statically yaws it
 * to face the camera (front-on composition), tunes the window/headlight
 * materials, rebuilds the cabin's materials so the interior is actually
 * legible from inside (see SECTION3.interiorMaterial), and swaps the
 * exterior body panels' material for the liquid paint shader.
 *
 * Hover tracking for the paint blob lives here (R3F pointer events give
 * exact per-mesh UV via raycasting, far simpler and more accurate than
 * projecting screen space by hand), as does the per-frame projection of the
 * Section 3 callout anchors. InteractionSystem still owns the outer group's
 * position/rotation for the parallax/counter-rotation system.
 */
export function MustangModel({ outerRef, hotspotScreenRef }: MustangModelProps) {
  const { scene } = useGLTF(MODEL_URL);
  const { camera, size } = useThree();
  const headlightLightsRef = useRef<THREE.Group>(null);
  const bodyMeshRef = useRef<THREE.Mesh | null>(null);
  const hoverTarget = useRef({ uv: new THREE.Vector2(0.5, 0.5), radius: 0, hovering: false });
  const anchorsRef = useRef<ResolvedAnchor[]>([]);
  const stage3ProgressRef = useRef(0);
  const tier = useTier();

  const { material: paintMaterial, uniforms } = useLiquidPaintMaterial();

  const { offset, scale, headlightCenters } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const rawCenter = new THREE.Vector3();
    box.getCenter(rawCenter);
    const longestSide = Math.max(size.x, size.z) || 1;

    const centers: THREE.Vector3[] = [];
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (HEADLIGHT_GLOW_PATTERN.test(normalizeNodeName(child.name))) {
        centers.push(new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3()));
      }
    });

    // FIX: center X/Z on the bbox center (correct -- horizontal centering
    // should use the middle), but Y on the bbox's own BOTTOM (box.min.y),
    // not its center. Centering Y on the bbox middle put the car's tire
    // contact point below world y=0, inside/behind the ground plane and
    // ContactShadows (both placed at y=0) -- the car visually "sank"
    // into the ground instead of standing on it, and lost its lower
    // third (splitter, rockers, tires) to that overlap.
    return {
      offset: new THREE.Vector3(-rawCenter.x, -box.min.y, -rawCenter.z),
      scale: TARGET_CAR_LENGTH / longestSide,
      headlightCenters: centers,
    };
  }, [scene]);

  // Headlight lens centres in the car's own space, handed to the road
  // shader (in metres) so the pools of light on the tarmac start at the
  // real lenses.
  useEffect(() => {
    headlightCenters.slice(0, 2).forEach((c, i) => {
      headlightLocal[i].copy(c).add(offset).multiplyScalar(scale).divideScalar(METER);
    });
  }, [headlightCenters, offset, scale]);

  useEffect(() => {
    // One clone per SOURCE material, shared by every interior mesh using
    // it -- keeps the draw-call batching the exporter set up, and means a
    // retune touches one object rather than twenty.
    const interiorClones = new Map<string, THREE.MeshStandardMaterial>();

    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;

      const nodeName = normalizeNodeName(child.name);

      if (EXTERIOR_PANEL_PATTERN.test(nodeName)) {
        // Every exterior panel gets the SAME liquid-paint material
        // instance, so the hood, doors, bumpers and fenders all carry the
        // same paint and a change to its uniforms repaints the whole car
        // uniformly, not just one panel. Its geometry has only NORMAL/POSITION (a flat PBR
        // color never needed a texture, so the exporter never generated
        // UVs), so both the raycaster's hover UV and the shader's vUv
        // would otherwise read a constant default everywhere, making
        // the blob invisible -- generate a simple planar-projected UV
        // per panel so both have real, spatially-varying coordinates.
        if (!child.geometry.attributes.uv) {
          const geometry = child.geometry;
          geometry.computeBoundingBox();
          const bbox = geometry.boundingBox!;
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const position = geometry.attributes.position;
          const uv = new Float32Array(position.count * 2);
          for (let i = 0; i < position.count; i++) {
            uv[i * 2] = size.x > 0 ? (position.getX(i) - bbox.min.x) / size.x : 0.5;
            uv[i * 2 + 1] = size.y > 0 ? (position.getY(i) - bbox.min.y) / size.y : 0.5;
          }
          geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        }
        child.material = paintMaterial;
        // Raycasting/hover-blob tracking only follows the main body
        // panel -- the other exterior panels share the paint material but
        // don't participate in the cursor-tracked hover trail individually.
        if (nodeName === MAIN_BODY_NODE_NAME) bodyMeshRef.current = child;
        return;
      }

      if (INTERIOR_NODE_NAMES.has(nodeName) && child.material instanceof THREE.MeshStandardMaterial) {
        const source = child.material;
        const color = interiorColorFor(source.name);
        if (color) {
          let clone = interiorClones.get(source.uuid);
          if (!clone) {
            clone = source.clone();
            clone.name = `${source.name}__interior`;
            clone.color.set(color);
            clone.envMapIntensity = SECTION3.interiorMaterial.envMapIntensity;
            clone.metalness = SECTION3.interiorMaterial.metalness;
            interiorClones.set(source.uuid, clone);
          }
          child.material = clone;
        }
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;

        if (mat instanceof THREE.MeshPhysicalMaterial && mat.name.toLowerCase().includes("glass")) {
          mat.roughness = Math.min(mat.roughness, 0.08);
          mat.envMapIntensity = 1.2;
          if (tier === "high") {
            mat.transmission = mat.transmission || 1;
            mat.thickness = mat.thickness || 0.05;
          } else {
            // Real transmission re-renders the whole scene behind the glass
            // into a second target every frame (~75 ms inside the cabin on
            // an integrated GPU). Plain tinted alpha glass reads the same at
            // this distance for a fraction of the cost.
            mat.transmission = 0;
            mat.transparent = true;
            mat.opacity = Math.min(mat.opacity, 0.3);
            mat.depthWrite = false;
          }
          mat.needsUpdate = true;
        }

        // Clearcoat is a second specular lobe on every pixel. The paint
        // needs it; the trim, rubber, leather and metal do not, and on the
        // lighter tiers it is dropped from all of them.
        if (tier !== "high" && mat instanceof THREE.MeshPhysicalMaterial && mat.clearcoat > 0) {
          mat.clearcoat = 0;
          mat.needsUpdate = true;
        }

        if (mat.name.toLowerCase().includes("light")) {
          const isDark = mat.emissive.r < 0.05 && mat.emissive.g < 0.05 && mat.emissive.b < 0.05;
          if (isDark) mat.emissive.set("#fff2d9");
          mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 2.5);
        }
      }
    });

    const group = headlightLightsRef.current;
    if (group) {
      group.clear();
      // The two lens glows are point lights; they are a small flourish on
      // top of the emissive lenses and bloom, and cost a light evaluation
      // on every car pixel, so only the top tier carries them.
      for (const center of tier === "high" ? headlightCenters.slice(0, 4) : []) {
        const light = new THREE.PointLight("#fff2d9", 3, 2.2, 2);
        light.position.copy(center).add(offset).multiplyScalar(scale);
        group.add(light);
      }
    }

    return () => {
      for (const clone of interiorClones.values()) clone.dispose();
    };
  }, [scene, offset, scale, headlightCenters, paintMaterial, tier]);

  // Resolve each callout's anchor node to a real mesh once, and warn
  // loudly about any that don't resolve -- a silently-missing anchor
  // would otherwise surface much later as a label floating in space.
  useEffect(() => {
    const resolved: ResolvedAnchor[] = [];
    const missing: string[] = [];

    // Build the lookup from the loaded scene's own (sanitized) names --
    // getObjectByName can't be used directly here, see normalizeNodeName.
    const byName = new Map<string, THREE.Mesh>();
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) byName.set(normalizeNodeName(child.name), child);
    });

    for (const hotspot of HOTSPOTS) {
      const node = byName.get(normalizeNodeName(hotspot.node));
      if (!node) {
        missing.push(hotspot.node);
        continue;
      }
      node.geometry.computeBoundingBox();
      const localCenter = new THREE.Vector3();
      node.geometry.boundingBox!.getCenter(localCenter);
      resolved.push({ id: hotspot.id, mesh: node, localCenter });
    }

    if (missing.length) {
      console.warn("[Hotspots] anchor nodes not found in the model:", missing);
    }
    anchorsRef.current = resolved;

    // Dev-only handle on the live projected positions, so the Section 3
    // framing can be checked against real numbers from the console rather
    // than judged by eye. Stripped from production builds -- Next
    // eliminates the branch on the NODE_ENV constant.
    if (process.env.NODE_ENV !== "production") {
      const devWindow = window as unknown as Record<string, unknown>;
      devWindow.__fordHotspots = hotspotScreenRef.current;
      devWindow.__fordScene = scene;
      devWindow.__fordMeshNames = [...byName.keys()];
    }
  }, [scene, hotspotScreenRef]);

  // Hover: lerp the blob toward the raycasted UV every frame (viscous
  // trail, per PAINT_SHADER.hoverLerp), keep the noise animating, track
  // Stage 3 progress for InteriorLights, and project the callout anchors.
  useFrame((_, delta) => {
    uniforms.current.uTime.value += delta;
    if (hoverTarget.current.hovering) {
      uniforms.current.uBlobUv.value.lerp(hoverTarget.current.uv, PAINT_SHADER.hoverLerp);
      uniforms.current.uBlobRadius.value +=
        (hoverTarget.current.radius - uniforms.current.uBlobRadius.value) * PAINT_SHADER.hoverLerp;
    }

    const stage3Progress = THREE.MathUtils.clamp(getStage() - 1, 0, 1);
    stage3ProgressRef.current = stage3Progress;
    const nowInSection3 = stage3Progress > 0;

    // Only project while Section 3 is actually on screen -- the overlay
    // is hidden otherwise, so this would be pure per-frame cost.
    if (!nowInSection3) return;

    const screen = hotspotScreenRef.current;
    if (!screen) return;

    camera.getWorldDirection(camDirScratch);

    for (const anchor of anchorsRef.current) {
      projectScratch.copy(anchor.localCenter).applyMatrix4(anchor.mesh.matrixWorld);

      // Behind-the-camera check BEFORE projecting: perspective division
      // by a negative w mirrors such points back into valid-looking NDC,
      // so a label for something behind you would otherwise appear on
      // screen, in the wrong place.
      toPointScratch.copy(projectScratch).sub(camera.position);
      const inFront = toPointScratch.dot(camDirScratch) > 0;

      projectScratch.project(camera);
      const x = (projectScratch.x * 0.5 + 0.5) * size.width;
      const y = (-projectScratch.y * 0.5 + 0.5) * size.height;

      screen[anchor.id] = {
        x,
        y,
        visible: inFront && projectScratch.z < 1,
      };
    }
  });

  function onPointerMove(event: ThreeEvent<PointerEvent>) {
    if (event.object !== bodyMeshRef.current || !event.uv) return;
    hoverTarget.current.hovering = true;
    hoverTarget.current.uv.copy(event.uv);
    hoverTarget.current.radius = PAINT_SHADER.blobRadius;
  }

  function onPointerLeave() {
    hoverTarget.current.hovering = false;
    gsap.to(uniforms.current.uBlobRadius, {
      value: 0,
      duration: PAINT_SHADER.leaveDuration,
      ease: "power2.inOut",
    });
  }

  return (
    <group ref={outerRef}>
      <group rotation={[0, RIG.carFrontYaw, 0]} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
        <group scale={scale} position={offset.clone().multiplyScalar(scale)}>
          <primitive object={scene} />
          <InteriorLights progressRef={stage3ProgressRef} />
        </group>
        <group ref={headlightLightsRef} />
      </group>
    </group>
  );
}
