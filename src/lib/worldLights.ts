import * as THREE from "three";

/**
 * Headlight lens centres in the car's own space, in metres. The road shader
 * lights itself from these (see roadShader.ts). MustangModel overwrites the
 * values with the real ones measured from the loaded model; the defaults are
 * close enough for the first frames.
 */
export const headlightLocal = [new THREE.Vector3(0.69, 0.82, 2.0), new THREE.Vector3(-0.69, 0.82, 2.0)];
