import type * as THREE from "three";

/**
 * Hand-off between the car the page loads (MustangModel) and the plant, which
 * needs a second, independent copy of it to build on the line.
 *
 * MustangModel sets this once it has finished re-materialling the model (paint,
 * glass, interior). The plant clones the scene AFTER that, so the clone shares
 * the finished materials and geometry (nothing is uploaded or compiled twice)
 * but has its own node hierarchy to move parts around in.
 */
export const carSource: {
  ready: boolean;
  scene: THREE.Object3D | null;
  /** glb units -> scene units. */
  scale: number;
  /** Offset (glb units) that centres the model's footprint and drops its floor to y = 0. */
  offset: THREE.Vector3 | null;
} = { ready: false, scene: null, scale: 1, offset: null };
