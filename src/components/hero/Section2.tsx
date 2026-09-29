import { LAYOUT } from "@/config/composition";

/**
 * The scroll-driven second section's DOM content -- fades in over the
 * pinned stage (see HeroExperience.tsx) as the car turns to a side
 * profile with its door open. Text sits on the LEFT; the right two-thirds
 * stays clear for the car, which shifts right during the same scroll
 * transition (SECTION2.carShiftX in theme.ts).
 */
export function Section2() {
  return (
    // Top-anchored, ending well before LAYOUT.sidePanelBandTop -- StatsPanel
    // and PaintSelector stay persistent across both sections (still
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
      <div className="flex max-w-md flex-col gap-6">
        <span className="text-[12px] font-medium uppercase tracking-[0.2em] text-white/60">
          THE COCKPIT
        </span>
        <h2 className="font-display text-[clamp(32px,4vw,56px)] font-extrabold uppercase leading-[0.95] tracking-[-0.03em] text-white">
          Built to be driven
        </h2>
        <p className="max-w-sm font-body text-[15px] leading-relaxed text-white/70">
          Carbon-trimmed, track-tuned, every surface inside the GTD is
          engineered for one thing: control. Step closer and see it from
          the side, door open, exactly as it sits in the paddock.
        </p>
        <button
          type="button"
          data-cursor-hover
          className="pointer-events-auto group relative w-fit overflow-hidden rounded-[4px] border border-white/25 px-8 py-4 text-[12px] font-medium uppercase tracking-[0.15em] text-white"
        >
          <span
            aria-hidden
            className="absolute inset-0 origin-left scale-x-0 bg-ford-grabber transition-[transform,background-color] duration-300 ease-out group-hover:scale-x-100 group-hover:bg-ford-blue"
          />
          <span className="relative z-10">EXPLORE THE INTERIOR</span>
        </button>
      </div>
    </div>
  );
}
