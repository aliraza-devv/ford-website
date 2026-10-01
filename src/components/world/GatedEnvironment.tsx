"use client";

/* eslint-disable react-hooks/immutability --
 * The renderer's autoClear flag is toggled around the cube render, as drei's
 * Environment does, outside React's render/commit cycle. */

import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

type GatedEnvironmentProps = {
  /** Cube face size, in pixels. The cost of one refresh scales with its square. */
  resolution: number;
  /** Asked once per frame; return true to re-render the environment this frame. */
  shouldUpdate: (frame: number) => boolean;
  /** Lamps and panels: they are rendered into the cube, not into the scene. */
  children: ReactNode;
};

/**
 * drei's <Environment>, with the one thing it cannot do: skip frames.
 *
 * A live environment is a cube render of the lamps plus a PMREM pass that
 * pre-filters it for every roughness the materials use, and that pass is the
 * expensive part: on an integrated GPU a refresh at 256 px costs more than the
 * rest of the frame put together. drei offers "never" and "every frame". The
 * plant needs a third: refresh only while the lamps are actually moving
 * relative to the car, and not at all while the film is translation-invariant
 * (the cars slide along rows of lights that look the same from anywhere).
 *
 * Everything else is drei's: a virtual scene holding the children, a cube
 * camera in it, and the cube's texture installed as `scene.environment`.
 */
export function GatedEnvironment({ resolution, shouldUpdate, children }: GatedEnvironmentProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useRef<THREE.CubeCamera>(null);
  const [virtualScene] = useState(() => new THREE.Scene());
  const frame = useRef(0);

  const target = useMemo(() => {
    const t = new THREE.WebGLCubeRenderTarget(resolution);
    t.texture.type = THREE.HalfFloatType;
    return t;
  }, [resolution]);

  useEffect(() => () => target.dispose(), [target]);

  // An environment exists from the first frame (and from the first frame after
  // a resolution change), whatever the policy says next.
  useLayoutEffect(() => {
    const cam = camera.current;
    if (cam) {
      const autoClear = gl.autoClear;
      gl.autoClear = true;
      cam.update(gl, virtualScene);
      gl.autoClear = autoClear;
    }
    const previous = scene.environment;
    scene.environment = target.texture;
    return () => {
      scene.environment = previous;
    };
  }, [gl, scene, target, virtualScene]);

  useFrame(() => {
    frame.current++;
    const cam = camera.current;
    if (!cam || !shouldUpdate(frame.current)) return;
    const autoClear = gl.autoClear;
    gl.autoClear = true;
    cam.update(gl, virtualScene);
    gl.autoClear = autoClear;
  });

  return createPortal(
    <>
      {children}
      <cubeCamera ref={camera} args={[0.1, 1000, target]} />
    </>,
    virtualScene,
  );
}
