import * as THREE from "three";

/**
 * A pool of instances of one primitive (box, cylinder, sphere), rewritten every
 * frame. All of the plant's equipment is built from these: a gantry is a few
 * boxes, a hoist is a handful of boxes that move, a robot is cylinders and
 * spheres on a chain. Because everything of one kind is ONE instanced mesh,
 * hundreds of moving pieces cost a few draw calls, which is what makes a
 * plant this busy affordable on an integrated GPU.
 *
 * Usage: pool.begin(); pool.box(...) x N; pool.end(), once per frame.
 */

const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchColor = new THREE.Color();
const scratchDir = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export type Rgb = readonly [number, number, number];

/** Linear-space colour from an sRGB hex. */
export function lin(hex: number): Rgb {
  scratchColor.setHex(hex, THREE.SRGBColorSpace);
  return [scratchColor.r, scratchColor.g, scratchColor.b];
}

export class PrimPool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly cap: number;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, cap: number) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // Allocates instanceColor.
    this.mesh.setColorAt(0, scratchColor.setRGB(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  begin() {
    this.n = 0;
  }

  /** Axis-aligned (optionally yawed about Y) instance, centred at (x, y, z). */
  put(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Rgb, yaw = 0) {
    if (this.n >= this.cap) return;
    scratchPos.set(x, y, z);
    scratchScale.set(sx, sy, sz);
    scratchQuat.setFromAxisAngle(AXIS_Y, yaw);
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
    this.write(color);
  }

  /** General instance: Euler rotation (XYZ), in radians. */
  putRot(x: number, y: number, z: number, sx: number, sy: number, sz: number, rx: number, ry: number, rz: number, color: Rgb) {
    if (this.n >= this.cap) return;
    scratchPos.set(x, y, z);
    scratchScale.set(sx, sy, sz);
    scratchEuler.set(rx, ry, rz, "XYZ");
    scratchQuat.setFromEuler(scratchEuler);
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
    this.write(color);
  }

  /** An instance running from point A to point B (a link between two joints):
   * the primitive's long axis (+Y for a cylinder or box, +Z for a box built
   * long in z) is laid along A -> B. `thickness` scales the cross-section. */
  between(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    thickness: number,
    color: Rgb,
    axis: "y" | "z" = "y",
    thicknessZ = thickness,
  ) {
    if (this.n >= this.cap) return;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    scratchPos.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    scratchDir.set(dx / len, dy / len, dz / len);
    scratchQuat.setFromUnitVectors(axis === "y" ? AXIS_Y : AXIS_Z, scratchDir);
    if (axis === "y") scratchScale.set(thickness, len, thicknessZ);
    else scratchScale.set(thickness, thicknessZ, len);
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
    this.write(color);
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.dispose();
  }

  private write(color: Rgb) {
    const i = this.n++;
    this.mesh.setMatrixAt(i, scratchMatrix);
    const a = this.mesh.instanceColor!.array as Float32Array;
    a[i * 3] = color[0];
    a[i * 3 + 1] = color[1];
    a[i * 3 + 2] = color[2];
  }
}

export { AXIS_X, AXIS_Y, AXIS_Z };
