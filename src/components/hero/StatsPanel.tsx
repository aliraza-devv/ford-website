"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { LAYOUT } from "@/config/composition";
import { SECTION2_STATS, STATS, type StatDef } from "@/lib/theme";

type StatsPanelProps = {
  loaded: boolean;
};

/**
 * The panel speaks in the car's own register: a DIN-style condensed face for the
 * figures (the same one the plant's signage uses in Section 4), a plain text face
 * for the words. One figure leads at full size and the other two sit under it as
 * a pair, so the panel has a hierarchy instead of three identical rows, and each
 * figure carries its unit and a short caption instead of a tracked-out label
 * above it.
 */
const SIZE = {
  lead: {
    numeral: "text-[clamp(64px,5.2vw,104px)] max-md:text-[40px]",
    unit: "text-[clamp(26px,2.1vw,42px)] max-md:text-[17px]",
  },
  pair: {
    numeral: "text-[clamp(34px,2.5vw,50px)] max-md:text-[40px]",
    unit: "text-[clamp(16px,1.15vw,22px)] max-md:text-[17px]",
  },
} as const;

function startText(stat: StatDef) {
  if (stat.value === undefined) return stat.figure;
  return (0).toFixed(stat.decimals ?? 0);
}

function Figure({
  stat,
  index,
  size,
  animate = false,
}: {
  stat: StatDef;
  index: number;
  size: keyof typeof SIZE;
  /** Count-up figures need a `data-stat` hook and a zero start; static ones
   * just render their text. */
  animate?: boolean;
}) {
  const s = SIZE[size];
  const counts = animate && stat.value !== undefined;
  return (
    <div className="flex flex-col gap-[0.5em] text-[clamp(13px,0.9vw,16px)] max-md:text-[12px]">
      {/* Read once, as a phrase, by assistive tech; the drawn figure counts up
          and is hidden from it. */}
      <span className="sr-only">{`${stat.figure} ${stat.unit}, ${stat.caption}`}</span>
      {/* The mask clips the figure as it rises on load. */}
      <span aria-hidden className="block overflow-hidden pb-[0.06em]">
        <span data-rise={animate ? "" : undefined} className="flex items-baseline gap-[0.22em]" style={animate ? { transform: "translate3d(0,108%,0)" } : undefined}>
          {/* The final text sizes the box, so the figure counting up never
              nudges what sits beside it. */}
          <span className={`relative inline-block font-plant-display font-semibold leading-[0.9] tracking-[-0.005em] text-white tabular-nums ${s.numeral}`}>
            <span className="invisible">{stat.figure}</span>
            <span data-stat={counts ? index : undefined} className="absolute left-0 top-0">
              {counts ? startText(stat) : stat.figure}
            </span>
          </span>
          <span className={`font-plant-display font-medium leading-none text-white/80 ${s.unit}`}>{stat.unit}</span>
        </span>
      </span>
      <span aria-hidden data-fade={animate ? "" : undefined} className={`font-plant-text font-medium leading-tight text-white/70 ${animate ? "opacity-0" : ""}`}>
        {stat.caption}
      </span>
    </div>
  );
}

function StatSet({ stats, animate = false }: { stats: StatDef[]; animate?: boolean }) {
  const [lead, ...rest] = stats;
  return (
    <div className="flex flex-col gap-[clamp(22px,2.3vw,42px)] [text-shadow:0_2px_26px_rgba(0,4,14,0.8)] max-md:grid max-md:grid-cols-3 max-md:gap-x-5 max-md:gap-y-0">
      <Figure stat={lead} index={0} size="lead" animate={animate} />
      <div className="flex gap-x-[clamp(22px,2.4vw,44px)] max-md:contents">
        {rest.map((stat, i) => (
          <Figure key={stat.caption} stat={stat} index={i + 1} size="pair" animate={animate} />
        ))}
      </div>
    </div>
  );
}

/**
 * The hero's left-hand panel. Two stat sets share one box: the hero's
 * 0-60/power/torque figures (`hero-fade-content`, counting up from zero on
 * load) and Section 2's drivetrain figures (`section2-fade-content`), crossfaded
 * by the same scroll-driven GSAP timeline every other DOM layer in
 * HeroExperience.tsx uses, so the panel shows something new once the car turns
 * side-on instead of repeating itself.
 *
 * It sits at the shared LAYOUT gutter, mirrored by DriveHud on the right, and
 * entirely above the headline's band so the two can never collide.
 */
export function StatsPanel({ loaded }: StatsPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = containerRef.current;
      if (!loaded || !root) return;

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const rises = root.querySelectorAll<HTMLElement>("[data-rise]");
      const fades = root.querySelectorAll<HTMLElement>("[data-fade]");

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      if (reduced) {
        gsap.set(rises, { y: "0%" });
        gsap.set(fades, { opacity: 1 });
      } else {
        // The figures rise out of their masks one after another, the captions
        // settle in under them: the order the eye reads them in.
        tl.to(rises, { y: "0%", duration: 0.9, stagger: 0.12 }, 0.1);
        tl.to(fades, { opacity: 1, duration: 0.6, stagger: 0.12 }, 0.35);
      }

      STATS.forEach((stat, i) => {
        if (stat.value === undefined) return;
        const el = root.querySelector<HTMLElement>(`[data-stat="${i}"]`);
        if (!el) return;
        if (reduced) {
          el.textContent = stat.figure;
          return;
        }
        const counter = { value: 0 };
        tl.to(
          counter,
          {
            value: stat.value,
            duration: 1.1,
            ease: "power3.out",
            onUpdate: () => {
              el.textContent = counter.value.toFixed(stat.decimals ?? 0);
            },
          },
          0.1 + i * 0.12,
        );
      });
    },
    { scope: containerRef, dependencies: [loaded] },
  );

  const position = {
    ["--gutter" as string]: `${LAYOUT.sideGutter * 100}%`,
    ["--band-top" as string]: `${LAYOUT.sidePanelBandTop * 100}%`,
  };
  const box =
    "pointer-events-none absolute z-30 max-md:inset-x-5 max-md:bottom-[21%] md:left-[var(--gutter)] md:top-[var(--band-top)] md:w-[clamp(220px,17vw,340px)]";

  return (
    <>
      <div ref={containerRef} className={`hero-fade-content ${box}`} style={position}>
        <StatSet stats={STATS} animate />
      </div>

      <div className={`section2-fade-content ${box} opacity-0`} style={position}>
        <StatSet stats={SECTION2_STATS} />
      </div>
    </>
  );
}
