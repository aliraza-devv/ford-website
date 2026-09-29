"use client";

import { type RefObject, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ParallaxState } from "@/hooks/useParallax";
import { RIG, SECTION2 } from "@/lib/theme";

type InteractionSystemProps = {
  parallaxRef: RefObject<ParallaxState>;
  cameraRigRef: RefObject<THREE.Group | null>;
  carGroupRef: RefObject<THREE.Group | null>;
  rimLightRef: RefObject<THREE.PointLight | null>;
  shadowGroupRef: RefObject<THREE.Group | null>;
  /** 0 at the top of the hero, 1 once section 2 is fully in view. Drives
   * the car's turn to a side profile, the camera dolly-in, and its
   * horizontal shift -- see SECTION2 in theme.ts. Additive on top of the
   * mouse-driven behavior below, not a replacement for it. */
  scrollProgressRef: RefObject<number>;
  isMobile: boolean;
};

const BASE_RIM_ANGLE = Math.PI * 0.15; // low and wide, behind the car
const RIM_RADIUS = 3.6;
const BASE_CAMERA_POS = new THREE.Vector3(...RIG.cameraPosition);

/**
 * The single useFrame that ties together the car canvas's mouse behaviors
 * -- camera parallax, car counter-rotation, the cursor-tracked rim light,
 * and the idle float -- so they read as one system. All of it reads the
 * SAME smoothed signal from useParallax() (shared with Sky/Road/headline/
 * chrome, each at their own Step 4 strength), rather than re-deriving its
 * own independent lerp, which is what makes five separately-rendered
 * layers feel like one composition instead of four unrelated effects.
 */
export function InteractionSystem({
  parallaxRef,
  cameraRigRef,
  carGroupRef,
  rimLightRef,
  shadowGroupRef,
  scrollProgressRef,
  isMobile,
}: InteractionSystemProps) {
  const rimSmoothed = useRef({ yaw: 0, height: 0 });
  const didInitLookAt = useRef(false);

  useFrame(({ clock, camera }) => {
    // One-time, on the first frame this runs (refs/camera inside a Canvas
    // aren't guaranteed ready in a plain mount effect, so this can't
    // safely live outside the render loop -- see the note this caused a
    // real regression: this call went missing during an earlier refactor,
    // leaving the camera at its default dead-level orientation instead of
    // tilted down at RIG.cameraLookAt the whole time).
    if (!didInitLookAt.current) {
      camera.lookAt(...RIG.cameraLookAt);
      didInitLookAt.current = true;
    }

    const parallax = parallaxRef.current;
    const t = clock.getElapsedTime();
    const idleBlend = isMobile ? 1 : parallax.idleBlend;
    const scroll = scrollProgressRef.current ?? 0;

    // 1. Camera parallax: orbit the camera rig around the car,
    //    horizontally only -- cursor Y no longer drives any vertical
    //    tilt/movement (only the ambient idle drift below still touches
    //    pitch, and that's time-based, not cursor-driven).
    const yaw = isMobile ? 0 : parallax.x * RIG.maxYaw * RIG.parallax.car;
    const idleYawDrift = Math.sin(t * 0.15) * 0.02 * idleBlend;
    const idlePitchDrift = Math.sin(t * 0.22) * 0.01 * idleBlend;

    const rig = cameraRigRef.current;
    if (rig) {
      rig.rotation.y = yaw + idleYawDrift;
      rig.rotation.x = idlePitchDrift;
    }

    // Section 2: dolly the camera closer as the user scrolls -- a real
    // move-toward-subject dolly, not an FOV "zoom" (which would distort).
    camera.position.copy(BASE_CAMERA_POS).multiplyScalar(1 - scroll * (1 - SECTION2.zoomScale));

    // 2. Car counter-rotation: opposite direction, ~3deg max, plus the
    //    static heroic tilt and a gentle idle vertical float. Section 2's
    //    side-yaw and horizontal shift are additive on top.
    const car = carGroupRef.current;
    if (car) {
      car.rotation.y = yaw * RIG.carCounterRatio + idleYawDrift * 0.5 + scroll * SECTION2.sideYaw;
      car.rotation.x = RIG.carBaseTiltX;
      car.position.y = RIG.carGroundOffsetY + Math.sin(t * 0.6) * 0.02 * idleBlend;
      car.position.x = scroll * SECTION2.carShiftX;
    }

    const shadowGroup = shadowGroupRef.current;
    if (shadowGroup) {
      shadowGroup.position.x = scroll * SECTION2.carShiftX;
    }

    // 3. Cursor-tracked rim light: wider sweep, with its own extra lerp on
    //    top of the shared signal so it visibly trails the camera/car.
    const targetRimYaw = isMobile ? 0 : parallax.x * RIG.rimLightYawRange;
    const targetRimHeight = isMobile ? 0 : parallax.y * RIG.rimLightHeightRange;
    const rimState = rimSmoothed.current;
    rimState.yaw = THREE.MathUtils.lerp(rimState.yaw, targetRimYaw, RIG.rimLightLerp);
    rimState.height = THREE.MathUtils.lerp(rimState.height, targetRimHeight, RIG.rimLightLerp);

    const rim = rimLightRef.current;
    if (rim) {
      const angle = BASE_RIM_ANGLE + rimState.yaw + Math.sin(t * 0.2) * 0.04 * idleBlend;
      rim.position.x = Math.sin(angle) * RIM_RADIUS;
      rim.position.z = -Math.abs(Math.cos(angle)) * RIM_RADIUS;
      rim.position.y = 1.1 - rimState.height * 0.5;
    }
  });

  return null;
}
