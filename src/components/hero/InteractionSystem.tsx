"use client";

import { type RefObject, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ParallaxState } from "@/hooks/useParallax";
import { RIG, SECTION2 } from "@/lib/theme";
import { getStage } from "@/lib/scrollState";
import { getCarPose } from "@/lib/carPose";

type InteractionSystemProps = {
  parallaxRef: RefObject<ParallaxState>;
  cameraRigRef: RefObject<THREE.Group | null>;
  carGroupRef: RefObject<THREE.Group | null>;
  rimLightRef: RefObject<THREE.PointLight | null>;
  shadowGroupRef: RefObject<THREE.Group | null>;
  isMobile: boolean;
};

const BASE_RIM_ANGLE = Math.PI * 0.15; // low and wide, behind the car
const RIM_RADIUS = 3.6;
const BASE_CAMERA_POS = new THREE.Vector3(...RIG.cameraPosition);
const BASE_LOOK_AT = new THREE.Vector3(...RIG.cameraLookAt);

// Stage 3's camera and aim paths, in the CAR's own local space (see
// SECTION2.stage3CameraPath). Converted to world space each frame using the
// car's FROZEN Stage-2-end rotation -- it doesn't turn any further once
// Stage 3 begins, so this is a constant, precomputed once.
const STAGE2_END_ROTATION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  SECTION2.sideYaw,
);

// "centripetal" (three's default) is the right curve type here: it's the
// parameterisation that provably can't produce cusps or loops that overshoot
// outside the control points. With four waypoints threading a camera through
// a window aperture, an overshoot would put the camera inside the door skin.
const CAMERA_CURVE = new THREE.CatmullRomCurve3(
  SECTION2.stage3CameraPath.map((p) => new THREE.Vector3(...p)),
  false,
  "centripetal",
);
const LOOK_AT_CURVE = new THREE.CatmullRomCurve3(
  SECTION2.stage3LookAtPath.map((p) => new THREE.Vector3(...p)),
  false,
  "centripetal",
);

// Scratch vectors -- useFrame runs 60x/second, so nothing in here allocates.
const cameraLocalScratch = new THREE.Vector3();
const lookAtScratch = new THREE.Vector3();
const carWorldScratch = new THREE.Vector3();

/** Smoothstep. Eases the camera's arrival into the cabin at both ends of the
 * path without touching the scroll signal itself -- scroll stays linear
 * (so the scrollbar still means what it says) while the move decelerates
 * into its final framing rather than stopping dead. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The single useFrame that ties together the car canvas's mouse behaviors
 * -- camera parallax, car counter-rotation, the cursor-tracked rim light,
 * and the idle float -- so they read as one system. All of it reads the
 * SAME smoothed signal from useParallax() (shared with Sky/Road/headline/
 * chrome, each at their own Step 4 strength), rather than re-deriving its
 * own independent lerp, which is what makes five separately-rendered
 * layers feel like one composition instead of four unrelated effects.
 *
 * Scroll position comes from the shared `scrollState` module rather than
 * props -- see the note there on why it isn't React state.
 */
export function InteractionSystem({
  parallaxRef,
  cameraRigRef,
  carGroupRef,
  rimLightRef,
  shadowGroupRef,
  isMobile,
}: InteractionSystemProps) {
  const rimSmoothed = useRef({ yaw: 0, height: 0 });

  useFrame(({ clock, camera }) => {
    const parallax = parallaxRef.current;
    const t = clock.getElapsedTime();
    const idleBlend = isMobile ? 1 : parallax.idleBlend;

    // 0-2 across the whole pinned stage: [0,1] hero -> side profile,
    // [1,2] side profile -> interior. Already eased by Lenis upstream, so
    // it's consumed directly -- no second smoothing pass.
    const stage = getStage();
    const stage3P = THREE.MathUtils.clamp(stage - 1, 0, 1);

    // 1. Camera parallax: orbit the camera rig around the car,
    //    horizontally only -- cursor Y no longer drives any vertical
    //    tilt/movement (only the ambient idle drift below still touches
    //    pitch, and that's time-based, not cursor-driven).
    //    Faded to 0 as Stage 3 comes in -- once the camera is inside the
    //    cabin the model has to be still, and mouse parallax on the rig
    //    would make the dashboard drift out from under a camera that's
    //    meant to be sitting in the seat.
    const parallaxFade = 1 - stage3P;
    const yaw = (isMobile ? 0 : parallax.x * RIG.maxYaw * RIG.parallax.car) * parallaxFade;
    const idleYawDrift = Math.sin(t * 0.15) * 0.02 * idleBlend * parallaxFade;
    const idlePitchDrift = Math.sin(t * 0.22) * 0.01 * idleBlend * parallaxFade;

    const rig = cameraRigRef.current;
    if (rig) {
      rig.rotation.y = yaw + idleYawDrift;
      rig.rotation.x = idlePitchDrift;
    }

    // Stage 1->2 and Stage 2->3 are two separate moves chained end to end
    // at `stage === 1`, not one continuous formula -- Stage 3 only starts
    // once `stage` actually crosses 1, which (by construction, via the two
    // back-to-back non-overlapping ScrollTriggers) can only happen after
    // ALL of Stage 1->2 has played. It can never creep into Section 2.
    // The car's heading and shift come from the same function the 3D world
    // uses for its own root group, so the road can't disagree with the car.
    const { yaw: sideYawNow, shiftX: shiftXNow } = getCarPose(stage);

    if (stage <= 1) {
      const p = THREE.MathUtils.clamp(stage, 0, 1);
      // A real move-toward-subject dolly, not an FOV "zoom" (which distorts).
      camera.position.copy(BASE_CAMERA_POS).multiplyScalar(THREE.MathUtils.lerp(1, SECTION2.stage2Zoom, p));
      lookAtScratch.copy(BASE_LOOK_AT);

      // Reset FOV every frame here -- scrolling back UP out of Stage 3
      // (where it widens, below) would otherwise leave it stuck at
      // whatever it last lerped to.
      const perspectiveReset = camera as THREE.PerspectiveCamera;
      if (perspectiveReset.isPerspectiveCamera && perspectiveReset.fov !== RIG.cameraFov) {
        perspectiveReset.fov = RIG.cameraFov;
        perspectiveReset.updateProjectionMatrix();
      }
    } else {
      // The car does NOT turn or shift any further in Stage 3 -- it holds
      // exactly the pose Stage 2 left it in, and only the camera keeps
      // moving. Two things moving at once would fight for attention right
      // when "the camera enters the car" needs to read on its own.
      carWorldScratch.set(shiftXNow, RIG.carGroundOffsetY, 0);

      const curveT = smoothstep(stage3P);

      // Sample both curves in car-local space, then push each through the
      // car's own frozen Stage-2 transform. Doing it in local space is what
      // keeps the waypoints meaningful: "in the window aperture" stays in
      // the window aperture even if stage2ShiftX or sideYaw are retuned.
      CAMERA_CURVE.getPoint(curveT, cameraLocalScratch);
      camera.position.copy(cameraLocalScratch).applyQuaternion(STAGE2_END_ROTATION).add(carWorldScratch);

      LOOK_AT_CURVE.getPoint(curveT, lookAtScratch);
      lookAtScratch.applyQuaternion(STAGE2_END_ROTATION).add(carWorldScratch);

      // Base 35deg (tuned for the exterior telephoto look) reads flat and
      // claustrophobic this close to the dash -- widening it as the camera
      // moves in is what makes the interior feel like sitting in the seat.
      const perspectiveCamera = camera as THREE.PerspectiveCamera;
      if (perspectiveCamera.isPerspectiveCamera) {
        perspectiveCamera.fov = THREE.MathUtils.lerp(RIG.cameraFov, SECTION2.stage3Fov, curveT);
        perspectiveCamera.updateProjectionMatrix();
      }
    }

    camera.lookAt(lookAtScratch);

    // 2. Car counter-rotation: opposite direction, ~3deg max, plus the
    //    static heroic tilt and a gentle idle vertical float. The
    //    Stage 2/3 side-yaw and horizontal shift are additive on top.
    const car = carGroupRef.current;
    if (car) {
      car.rotation.y = yaw * RIG.carCounterRatio + idleYawDrift * 0.5 + sideYawNow;
      car.rotation.x = RIG.carBaseTiltX;
      // The idle float fades out on the same parallaxFade as the drift
      // above -- a still car in Stage 3 means ALL of its idle motion stops,
      // not just the rotation.
      car.position.y = RIG.carGroundOffsetY + Math.sin(t * 0.6) * 0.02 * idleBlend * parallaxFade;
      car.position.x = shiftXNow;
    }

    const shadowGroup = shadowGroupRef.current;
    if (shadowGroup) {
      shadowGroup.position.x = shiftXNow;
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
