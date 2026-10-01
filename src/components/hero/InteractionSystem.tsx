"use client";

import { type RefObject, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ParallaxState } from "@/hooks/useParallax";
import { RIG, SECTION2 } from "@/lib/theme";
import { getStage, scrollState } from "@/lib/scrollState";
import { getCarPose } from "@/lib/carPose";
import { GATE_Z, TUNNEL_Z, zA, zB } from "@/config/line";
import { makeCameraSample, sampleCamera } from "@/config/lineCamera";
import { METER } from "@/config/worlds";
import { hallToWorld, lineDirection } from "@/lib/hallSpace";

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
// Where the camera is when Section 2 begins: the old view, dollied in.
const STAGE2_CAMERA_POS = BASE_CAMERA_POS.clone().multiplyScalar(SECTION2.stage2Zoom);

const HERO_POSITION = new THREE.Vector3(...RIG.hero.position);
const HERO_LOOK_AT = new THREE.Vector3(...RIG.hero.lookAt);

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
const factoryShot = makeCameraSample();
const lineDir = new THREE.Vector3();
const focusScratch = new THREE.Vector3();

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
  // The framing shift currently applied to the camera (see below).
  const viewShift = useRef({ shift: 0, width: 0, height: 0 });

  useFrame(({ clock, camera, size }) => {
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
    // Section 4 slides the picture sideways (without moving the camera) to
    // make room for its copy; every other stage leaves it centred.
    let framingShift = 0;

    if (stage <= 1) {
      const p = THREE.MathUtils.clamp(stage, 0, 1);
      // From the hero's own view to where Section 2 begins: the old move-toward-subject dolly's
      // end (a real dolly, not an FOV "zoom", which distorts).
      camera.position.copy(HERO_POSITION).lerp(STAGE2_CAMERA_POS, p);
      lookAtScratch.copy(HERO_LOOK_AT).lerp(BASE_LOOK_AT, p);

      // Set FOV every frame here -- scrolling back UP out of Stage 3
      // (where it widens, below) would otherwise leave it stuck at
      // whatever it last lerped to.
      const perspectiveReset = camera as THREE.PerspectiveCamera;
      const fov = THREE.MathUtils.lerp(RIG.hero.fov, RIG.cameraFov, p);
      if (perspectiveReset.isPerspectiveCamera && perspectiveReset.fov !== fov) {
        perspectiveReset.fov = fov;
        perspectiveReset.updateProjectionMatrix();
      }
    } else {
      // The car does NOT turn or shift any further in Stage 3 -- it holds
      // exactly the pose Stage 2 left it in, and only the camera keeps
      // moving. Two things moving at once would fight for attention right
      // when "the camera enters the car" needs to read on its own.
      carWorldScratch.set(shiftXNow, RIG.carGroundOffsetY, 0);

      const factory = scrollState.factory;
      const perspectiveCamera = camera as THREE.PerspectiveCamera;

      if (factory > 0) {
        // Section 4: the camera now travels the HALL, in hall coordinates (see
        // config/lineCamera). Its first shots are Section 3's cabin path
        // reversed, so it begins at the exact pose that path ended on.
        sampleCamera(factory, factoryShot);
        hallToWorld(factoryShot.pos.x, factoryShot.pos.y, factoryShot.pos.z, camera.position);
        hallToWorld(factoryShot.look.x, factoryShot.look.y, factoryShot.look.z, lookAtScratch);
        if (perspectiveCamera.isPerspectiveCamera) {
          perspectiveCamera.fov = factoryShot.fov;
          perspectiveCamera.updateProjectionMatrix();
        }
        framingShift = isMobile ? 0 : factoryShot.shift;
      } else {
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
        if (perspectiveCamera.isPerspectiveCamera) {
          perspectiveCamera.fov = THREE.MathUtils.lerp(RIG.cameraFov, SECTION2.stage3Fov, curveT);
          perspectiveCamera.updateProjectionMatrix();
        }
      }
    }

    // Apply (or clear) the framing shift only when it, or the canvas, changed:
    // setViewOffset rebuilds the projection matrix.
    const view = viewShift.current;
    const perspective = camera as THREE.PerspectiveCamera;
    if (
      perspective.isPerspectiveCamera &&
      (Math.abs(view.shift - framingShift) > 1e-4 || view.width !== size.width || view.height !== size.height)
    ) {
      view.shift = framingShift;
      view.width = size.width;
      view.height = size.height;
      if (framingShift === 0) perspective.clearViewOffset();
      else perspective.setViewOffset(size.width, size.height, -framingShift * size.width, 0, size.width, size.height);
    }

    camera.lookAt(lookAtScratch);

    // 2. Car counter-rotation: opposite direction, ~3deg max, plus the
    //    static heroic tilt and a gentle idle vertical float. The
    //    Stage 2/3 side-yaw and horizontal shift are additive on top.
    // In Section 4 this car is the finished one in the inspection tunnel: it
    // drives out along the line (hall +Z), through the gate, and is gone.
    const factoryNow = scrollState.factory;
    const driven = factoryNow > 0 ? (zA(factoryNow) - TUNNEL_Z) * METER : 0;
    lineDirection(lineDir).multiplyScalar(driven);
    const car = carGroupRef.current;
    if (car) {
      car.rotation.y = yaw * RIG.carCounterRatio + idleYawDrift * 0.5 + sideYawNow;
      car.rotation.x = RIG.carBaseTiltX;
      // The idle float fades out on the same parallaxFade as the drift
      // above -- a still car in Stage 3 means ALL of its idle motion stops,
      // not just the rotation.
      car.position.y = RIG.carGroundOffsetY + Math.sin(t * 0.6) * 0.02 * idleBlend * parallaxFade;
      car.position.x = shiftXNow + lineDir.x;
      car.position.z = lineDir.z;
      car.visible = !(factoryNow > 0 && zA(factoryNow) > GATE_Z + 5);
    }

    const shadowGroup = shadowGroupRef.current;
    if (shadowGroup) {
      shadowGroup.position.x = shiftXNow + lineDir.x;
      shadowGroup.position.z = lineDir.z;
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
      // In Section 4 the light stands off whichever car is the subject (the
      // finished one, then the one on the line), not off the world origin.
      if (factoryNow > 0) {
        hallToWorld(0, 0, factoryNow < 0.1 ? zA(factoryNow) : zB(factoryNow), focusScratch);
      } else {
        focusScratch.set(0, 0, 0);
      }
      rim.position.x = focusScratch.x + Math.sin(angle) * RIM_RADIUS;
      rim.position.z = focusScratch.z - Math.abs(Math.cos(angle)) * RIM_RADIUS;
      rim.position.y = 1.1 - rimState.height * 0.5;
    }
  });

  return null;
}
