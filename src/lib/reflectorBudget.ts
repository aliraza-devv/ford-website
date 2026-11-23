import { LinearMipmapLinearFilter, type Material, type WebGLRenderer } from "three";
import type { Reflector } from "three/examples/jsm/objects/Reflector.js";

/**
 * Keeps a planar reflector (the wet road, the plant floor) from costing more than
 * the one reflection it is there to draw.
 *
 * A Reflector renders the whole scene a second time, from under the floor, every
 * time the floor is drawn. And the floor is drawn more than once per frame: when
 * any visible material uses real transmission (the car's glass on the high tier),
 * three renders every opaque object into a transmission target first, and then
 * again for the picture itself. The floor is an opaque object, so it was drawn,
 * and its reflection rendered, in both. On the high tier a frame in the plant came
 * to six passes over the scene when the picture needs two.
 *
 * The floor is drawn three times a frame, and only the last of them is the picture:
 *   - by the contact-shadow pass, through an orthographic camera looking up at the car. A
 *     reflection rendered for that camera is the wrong picture, and rendering it was a full
 *     extra pass for nothing;
 *   - by the transmission pass, where a reflection renders blank;
 *   - by the picture's own pass.
 * So the reflection is rendered for a perspective camera, outside the transmission pass: once.
 *
 * What this does:
 *  1. one reflection render per frame, from the picture's own draw;
 *  2. optionally one every `every` frames. The floor's reflection is blurred by
 *     the surface's roughness and the cars on the line barely move between two
 *     frames, so a reflection a frame old cannot be seen;
 *  3. while the reflection renders, the materials in `hiddenInReflection` are
 *     switched off. The floor does not need the car's windows, and with them gone
 *     the reflection's own render has no transmission pass to make.
 *
 * Material.visible does not change a material's shader, so switching it for the
 * length of one render costs nothing and recompiles nothing.
 */

/** Frame counter, bumped once per frame by <ReflectorClock /> before anything renders. */
export const reflectorClock = { frame: 0 };

/** Materials a reflection does not draw: transmissive glass. */
export const hiddenInReflection = new Set<Material>();

/**
 * True while three is rendering its transmission pass. That pass draws into a target of its own,
 * and it is the only mip-mapped one the picture is drawn through: the composer's buffer is not
 * mip-mapped, and the reflection's own target is never bound while its own floor is drawn.
 */
function inTransmissionPass(renderer: WebGLRenderer) {
  const target = renderer.getRenderTarget();
  return !!target && target.texture.generateMipmaps && target.texture.minFilter === LinearMipmapLinearFilter;
}

export function budgetReflector(reflector: Reflector, { every = 1 }: { every?: number } = {}) {
  const original = reflector.onBeforeRender;
  let lastFrame = -1;
  let rendered = false;

  reflector.onBeforeRender = function (this: Reflector, renderer, scene, camera, geometry, material, group) {
    // Only the picture's own camera (a perspective one) is reflected, and never from inside the
    // transmission pass.
    if (!(camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera) return;
    if (inTransmissionPass(renderer)) return;
    const frame = reflectorClock.frame;
    // Already rendered this frame: the texture and its matrix are this frame's.
    if (frame === lastFrame) return;
    lastFrame = frame;
    // A frame to skip, once there is a reflection to reuse.
    if (rendered && every > 1 && frame % every !== 0 && !this.forceUpdate) return;

    const hidden: Material[] = [];
    hiddenInReflection.forEach((m) => {
      if (m.visible) {
        m.visible = false;
        hidden.push(m);
      }
    });
    try {
      original.call(this, renderer, scene, camera, geometry, material, group);
      rendered = true;
    } finally {
      for (const m of hidden) m.visible = true;
    }
  };
}
