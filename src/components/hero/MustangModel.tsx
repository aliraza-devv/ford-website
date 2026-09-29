"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import { MODEL_URL, PAINT_SHADER, RIG, SECTION2, TARGET_CAR_LENGTH } from "@/lib/theme";
import { useLiquidPaintMaterial } from "./LiquidPaintMaterial";

useGLTF.preload(MODEL_URL);

// The top-level door bones (verified against the glTF directly -- these
// start at ~identity rotation, unlike their child "Hinge_1" correction
// bones which already carry a baked Y-axis rotation, so these are the
// right ones to add an opening rotation on top of). No baked animation
// clips exist in this glTF (0 in the animations array) despite the
// Maya-style "Animate_/Target_/Trigger_" naming suggesting an interactive
// rig elsewhere -- so the door has to be driven by rotating these bones
// directly, the same way a real skeletal animation would.
const DOOR_BONE_NAMES = ["Animate_Door_FrontLeft_05", "Animate_Door_FrontRight_010"];

export type MustangModelHandle = {
  /** Raycasts from a screen-space point (e.g. a clicked swatch's center)
   * onto the body mesh and sweeps the whole car to the given color. */
  triggerSweep: (clientX: number, clientY: number, hex: string) => void;
};

/**
 * Loads the GTD glb, auto-centers/scales it, statically yaws it to face
 * the camera (front-on composition, per the Step 1 audit), tunes the
 * window/headlight materials, and swaps the isolated body-paint mesh's
 * material for the liquid paint shader. Hover tracking for the paint blob
 * lives here (R3F pointer events give exact per-mesh UV via raycasting,
 * which is far simpler and more accurate than projecting screen space by
 * hand), while InteractionSystem still owns the outer group's per-frame
 * position/rotation for the parallax/counter-rotation system.
 */
type MustangModelProps = {
  outerRef: React.RefObject<THREE.Group | null>;
  scrollProgressRef: React.RefObject<number>;
};

export const MustangModel = forwardRef<MustangModelHandle, MustangModelProps>(
  function MustangModel({ outerRef, scrollProgressRef }, handleRef) {
    const { scene } = useGLTF(MODEL_URL);
    const { camera, gl } = useThree();
    const headlightLightsRef = useRef<THREE.Group>(null);
    const bodyMeshRef = useRef<THREE.Mesh | null>(null);
    const doorBonesRef = useRef<{ bone: THREE.Object3D; restY: number }[]>([]);
    const hoverTarget = useRef({ uv: new THREE.Vector2(0.5, 0.5), radius: 0, hovering: false });

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
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        if (materials.some((mat) => mat.name.includes("Light"))) {
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

    useEffect(() => {
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.castShadow = true;
        child.receiveShadow = true;

        const materials = Array.isArray(child.material) ? child.material : [child.material];

        for (const mat of materials) {
          if (mat.name.includes("Paint")) {
            // The single isolatable body-panel mesh (confirmed 1-to-1 in
            // the Step 1 audit) -- swap it for the liquid paint material.
            // Its geometry has only NORMAL/POSITION (verified against the
            // glTF directly -- a flat PBR color never needed a texture, so
            // the exporter never generated UVs), so both the raycaster's
            // hover UV and the shader's vUv would otherwise read a
            // constant default everywhere, making the blob invisible.
            // Generate a simple planar-projected UV so both have real,
            // spatially-varying coordinates to work with.
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
            bodyMeshRef.current = child;
            continue;
          }

          if (!(mat instanceof THREE.MeshStandardMaterial)) continue;

          if (
            mat instanceof THREE.MeshPhysicalMaterial &&
            (mat.name.includes("Window") || mat.name.toLowerCase().includes("glass"))
          ) {
            mat.transmission = mat.transmission || 1;
            mat.thickness = mat.thickness || 0.05;
            mat.roughness = Math.min(mat.roughness, 0.08);
            mat.envMapIntensity = 1.2;
          }

          if (mat.name.includes("Light")) {
            const isDark = mat.emissive.r < 0.05 && mat.emissive.g < 0.05 && mat.emissive.b < 0.05;
            if (isDark) mat.emissive.set("#fff2d9");
            mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 2.5);
          }
        }
      });

      doorBonesRef.current = DOOR_BONE_NAMES.map((name) => scene.getObjectByName(name))
        .filter((bone): bone is THREE.Object3D => Boolean(bone))
        .map((bone) => ({ bone, restY: bone.rotation.y }));

      const group = headlightLightsRef.current;
      if (group) {
        group.clear();
        for (const center of headlightCenters.slice(0, 4)) {
          const light = new THREE.PointLight("#fff2d9", 3, 2.2, 2);
          light.position.copy(center).add(offset).multiplyScalar(scale);
          group.add(light);
        }
      }
    }, [scene, offset, scale, headlightCenters, paintMaterial]);

    // Hover: lerp the blob toward the raycasted UV every frame (viscous
    // trail, per PAINT_SHADER.hoverLerp), and keep the noise animating.
    // Also drives the door-open bones from scroll progress -- see
    // DOOR_BONE_NAMES above for why these specific bones and not the
    // model's own animation system (there isn't one).
    useFrame((_, delta) => {
      uniforms.current.uTime.value += delta;
      if (hoverTarget.current.hovering) {
        uniforms.current.uBlobUv.value.lerp(hoverTarget.current.uv, PAINT_SHADER.hoverLerp);
        uniforms.current.uBlobRadius.value +=
          (hoverTarget.current.radius - uniforms.current.uBlobRadius.value) * PAINT_SHADER.hoverLerp;
      }

      const scroll = scrollProgressRef.current ?? 0;
      const doorProgress = THREE.MathUtils.clamp(
        (scroll - SECTION2.doorOpenStart) / (SECTION2.doorOpenEnd - SECTION2.doorOpenStart),
        0,
        1,
      );
      for (const { bone, restY } of doorBonesRef.current) {
        bone.rotation.y = restY + doorProgress * SECTION2.doorOpenAngle;
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

    useImperativeHandle(
      handleRef,
      () => ({
        triggerSweep(clientX, clientY, hex) {
          const mesh = bodyMeshRef.current;
          if (!mesh) return;

          const rect = gl.domElement.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
          );
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(ndc, camera);
          const hit = raycaster.intersectObject(mesh, false)[0];
          // Fall back to the panel's own edge (a swatch is off to one side
          // of the viewport, so this still reads as "sweeping in" even
          // when the ray misses the body, e.g. a very oblique camera angle).
          const originUv = hit?.uv ?? new THREE.Vector2(clientX < rect.width / 2 ? 0 : 1, 0.5);

          hoverTarget.current.hovering = false;
          uniforms.current.uBlobUv.value.copy(originUv);
          uniforms.current.uColorB.value.set(hex);
          uniforms.current.uBlobRadius.value = 0;

          gsap.to(uniforms.current.uBlobRadius, {
            value: 1.6, // guaranteed full coverage from any UV corner
            duration: PAINT_SHADER.sweepDuration,
            ease: "power2.inOut",
            onComplete: () => {
              uniforms.current.uColorA.value.set(hex);
              uniforms.current.uBlobRadius.value = 0;
            },
          });
        },
      }),
      [camera, gl, uniforms],
    );

    return (
      <group ref={outerRef}>
        <group rotation={[0, RIG.carFrontYaw, 0]} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
          <group scale={scale} position={offset.clone().multiplyScalar(scale)}>
            <primitive object={scene} />
          </group>
          <group ref={headlightLightsRef} />
        </group>
      </group>
    );
  },
);
