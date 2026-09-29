"use client";

import { Bloom, ChromaticAberration, EffectComposer, Vignette } from "@react-three/postprocessing";

/**
 * Dynamically imported by Scene.tsx (ssr: false, code-split) so the
 * postprocessing shader bundle doesn't block the initial hero paint, and
 * skipped entirely on mobile per the performance budget in Step 8.
 */
export function PostFX() {
  return (
    <EffectComposer>
      {/* FIX 7: intensity/threshold pulled back so only the brightest
          highlights bloom, and chromatic aberration cut to a quarter of
          its previous offset -- at 0.0005 it was reading as RGB fringing/
          a game filter rather than a subtle lens characteristic. */}
      <Bloom intensity={0.35} luminanceThreshold={0.9} luminanceSmoothing={0.2} mipmapBlur />
      <ChromaticAberration offset={[0.0002, 0.0002]} />
      <Vignette darkness={0.6} offset={0.3} />
    </EffectComposer>
  );
}
