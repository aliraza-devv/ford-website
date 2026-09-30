import { LAYOUT } from "@/config/composition";

/**
 * The scroll-driven second section's DOM content -- fades in over the
 * pinned stage (see HeroExperience.tsx) as the car turns to a side
 * profile (door stays closed here; it only opens in Stage 3, the interior
 * view). Text sits on the LEFT; the right two-thirds stays clear for the
 * car, which shifts right during this stage (SECTION2.stage2ShiftX in
 * theme.ts) and stays visible through Stage 3 too.
 */
export function Section2() {
  return (
    // Top-anchored, ending well before LAYOUT.sidePanelBandTop -- StatsPanel
    // stays persistent across both sections (still
    // relevant while looking at the car from the side), so this content
    // has to live in the same upper band Hero's headline vacates instead
    // of overlapping that band, the way a vertically-centered block did.
    <div
      className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-center"
      style={{
        left: `${LAYOUT.sideGutter * 100}%`,
        right: `${LAYOUT.sideGutter * 100}%`,
        height: `${LAYOUT.sidePanelBandTop * 100}%`,
      }}
    >
      <div className="flex max-w-lg flex-col gap-6">
        <span className="text-[12px] font-medium uppercase tracking-[0.2em] text-white/60">
          THE COCKPIT
        </span>
        <h2 className="font-display text-[clamp(30px,3.4vw,46px)] font-extrabold uppercase leading-[1.25] tracking-[-0.02em] text-white">
          Engineered for obsession
        </h2>
      </div>
    </div>
  );
}
