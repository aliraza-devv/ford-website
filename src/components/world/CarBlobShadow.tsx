"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getCarPose } from "@/lib/carPose";
import { getStage } from "@/lib/scrollState";

/**
 * A soft dark pool under the car, in place of drei's ContactShadows on the
 * tiers that can't afford it. ContactShadows re-renders the car's depth from
 * below and blurs it twice EVERY frame (~10 ms on an integrated GPU); this is
 * one textured quad that turns with the car's heading. Next to a wet,
 * reflective road the under-car darkening is what grounds the tyres, and a
 * blurred silhouette adds little beyond it.
 *
 * Mount it inside the group InteractionSystem slides in X and lowers to the
 * ground, so it follows the car's shift for free.
 */
export function CarBlobShadow() {
  const heading = useRef<THREE.Group>(null);

  const texture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    // An ellipse about 1 : 2.5 (width : length), darkest in the middle.
    ctx.translate(size / 2, size / 2);
    ctx.scale(0.8, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.95)");
    g.addColorStop(0.55, "rgba(0,0,0,0.6)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-size, -size, size * 2, size * 2);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    if (heading.current) heading.current.rotation.y = getCarPose(getStage()).yaw;
  });

  return (
    // Yaw lives on a parent group: rotating the flat plane's own Y would spin
    // it about its local (vertical-in-world) axis only by accident of order.
    <group ref={heading}>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.012, 0]} renderOrder={1}>
        <planeGeometry args={[2.9, 5.8]} />
        <meshBasicMaterial map={texture} color="#00040f" transparent depthWrite={false} toneMapped />
      </mesh>
    </group>
  );
}
