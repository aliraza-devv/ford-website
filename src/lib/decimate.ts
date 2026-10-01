import * as THREE from "three";

/**
 * Vertex-clustering decimation: snap every vertex to a grid, merge the vertices
 * that share a cell, and drop the triangles that collapse. It is crude (it
 * rounds off creases and thin features) but it is linear, allocation-light and
 * has no failure modes, which is what a loader-time pass over a 350,000-triangle
 * car needs. It is used only for the plant's stand-in cars, which are seen from
 * a dozen metres or more, where a rounded crease is invisible and a ten-times
 * lighter car is what lets the line be full.
 */

export type Decimated = {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
  triangles: number;
};

const OFFSET = 4096;

/** Cluster `geometry` (transformed by `matrix` first) on a cube grid of size `cell`. */
export function cluster(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, cell: number): Decimated {
  const pos = geometry.getAttribute("position");
  const nrm = geometry.getAttribute("normal");
  const idx = geometry.getIndex();
  const count = pos.count;

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  const ids = new Int32Array(count);
  const keyToCluster = new Map<number, number>();
  const sums: number[] = [];
  const nsums: number[] = [];
  const counts: number[] = [];

  const inv = 1 / cell;
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    const ix = Math.floor(v.x * inv) + OFFSET;
    const iy = Math.floor(v.y * inv) + OFFSET;
    const iz = Math.floor(v.z * inv) + OFFSET;
    const key = (ix * 16384 + iy) * 16384 + iz;
    let c = keyToCluster.get(key);
    if (c === undefined) {
      c = counts.length;
      keyToCluster.set(key, c);
      sums.push(0, 0, 0);
      nsums.push(0, 0, 0);
      counts.push(0);
    }
    ids[i] = c;
    sums[c * 3] += v.x;
    sums[c * 3 + 1] += v.y;
    sums[c * 3 + 2] += v.z;
    if (nrm) {
      n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix);
      nsums[c * 3] += n.x;
      nsums[c * 3 + 1] += n.y;
      nsums[c * 3 + 2] += n.z;
    }
    counts[c]++;
  }

  const total = idx ? idx.count : count;
  const tris: number[] = [];
  for (let t = 0; t < total; t += 3) {
    const a = ids[idx ? idx.getX(t) : t];
    const b = ids[idx ? idx.getX(t + 1) : t + 1];
    const c = ids[idx ? idx.getX(t + 2) : t + 2];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }

  const m = counts.length;
  const position = new Float32Array(m * 3);
  const normal = new Float32Array(m * 3);
  for (let c = 0; c < m; c++) {
    const k = 1 / counts[c];
    position[c * 3] = sums[c * 3] * k;
    position[c * 3 + 1] = sums[c * 3 + 1] * k;
    position[c * 3 + 2] = sums[c * 3 + 2] * k;
    const nx = nsums[c * 3];
    const ny = nsums[c * 3 + 1];
    const nz = nsums[c * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    normal[c * 3] = nx / len;
    normal[c * 3 + 1] = ny / len;
    normal[c * 3 + 2] = nz / len;
  }
  return { position, normal, index: Uint32Array.from(tris), triangles: tris.length / 3 };
}

/** The finest cell size that brings `geometry` under `target` triangles. */
export function decimateToBudget(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, target: number): Decimated {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  const diag = size.length() * Math.cbrt(Math.abs(matrix.determinant()));
  let lo = Math.max(diag / 600, 0.004);
  let hi = Math.max(diag / 3, 0.05);
  let best = cluster(geometry, matrix, hi);
  // Bisect on cell size: finer cells keep more triangles.
  for (let i = 0; i < 6; i++) {
    const mid = Math.sqrt(lo * hi);
    const r = cluster(geometry, matrix, mid);
    if (r.triangles <= target) {
      best = r;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}
