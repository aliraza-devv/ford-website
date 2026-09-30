import { useSyncExternalStore } from "react";

export type Tier = "high" | "medium" | "low";

const ORDER: Tier[] = ["high", "medium", "low"];

/**
 * Picks where to START from what the GPU is. Starting at `high` and waiting
 * for a frame-rate monitor to notice is exactly wrong on an integrated GPU:
 * the first seconds are a slideshow, and every tier change recompiles shaders.
 * So: discrete GPUs start high, integrated and mobile GPUs start low, and
 * anything unrecognised starts in the middle. The frame-time controller in
 * Scene still moves it from there.
 */
function detectStartingTier(): Tier {
  if (typeof window === "undefined") return "high";
  if (window.matchMedia("(max-width: 767px)").matches) return "low";

  let renderer = "";
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // No WebGL info available: fall through to the default.
  }

  if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return "low";
  if (/intel.*(uhd|hd graphics|iris|xe)|mali|adreno|powervr|videocore/i.test(renderer)) return "low";
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc\b|apple m\d|apple gpu/i.test(renderer)) {
    return (navigator.hardwareConcurrency ?? 8) <= 4 ? "medium" : "high";
  }
  return "medium";
}

let tier: Tier = detectStartingTier();
let pinned = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getTier(): Tier {
  return tier;
}

/** Steps one tier down and never back up for the rest of the session, so a
 * single slow frame spike can't make the scene flicker between looks. */
export function stepDownTier(): boolean {
  if (pinned) return false;
  const i = ORDER.indexOf(tier);
  if (i >= ORDER.length - 1) return false;
  tier = ORDER[i + 1];
  emit();
  return true;
}

/** `?tier=` override (verification, or checking a tier by hand): sets the
 * tier and stops the monitor from moving it. */
export function pinTier(next: Tier) {
  pinned = true;
  if (tier !== next) {
    tier = next;
    emit();
  }
}

/** Clamps the tier downward only (mobile). Never raises it. */
export function capTier(max: Tier) {
  if (ORDER.indexOf(max) > ORDER.indexOf(tier)) {
    tier = max;
    emit();
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTier(): Tier {
  return useSyncExternalStore(subscribe, getTier, () => "high" as Tier);
}
