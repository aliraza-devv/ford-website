"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { LAYOUT } from "@/config/composition";
import { SECTION2_STATS, STATS, type StatDef } from "@/lib/theme";

type StatsPanelProps = {
  loaded: boolean;
};

const sharedPosition = {
  left: `${LAYOUT.sideGutter * 100}%`,
  top: `${LAYOUT.sidePanelBandTop * 100}%`,
  width: `${LAYOUT.panelWidth * 100}%`,
  borderLeft: "1px solid rgba(23, 0, 244, 0.25)",
} as const;

function StatRow({
  stat,
  index,
  animate = false,
}: {
  stat: StatDef;
  index: number;
  /** Count-up-from-zero rows need a `data-stat` hook and a "0" starting
   * value for the GSAP tween in StatsPanel to update; static rows just
   * render their final formatted value directly. */
  animate?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4 text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">
        <span>{stat.micro}</span>
        {stat.unit && <span>{stat.unit}</span>}
      </div>
      <span
        data-stat={animate ? index : undefined}
        className="font-display text-[40px] font-extrabold leading-none text-white"
      >
        {animate
          ? `${stat.prefix}0${stat.suffix}`
          : (stat.display ?? `${stat.prefix}${stat.value.toFixed(stat.decimals)}${stat.suffix}`)}
      </span>
    </div>
  );
}

/**
 * Layer 5, Step 7 left panel. Two stacked stat sets share the same
 * LAYOUT-anchored box: the hero's 0-60/hp/torque numbers (`hero-fade-content`,
 * count up from 0 on load) and Section 2's downforce/cornering/weight numbers
 * (`section2-fade-content`), crossfaded by the same scroll-driven GSAP
 * timeline every other DOM layer in HeroExperience.tsx already uses -- so the
 * panel shows new, section-relevant numbers once the car turns side-on
 * instead of repeating the hero's own stats.
 */
export function StatsPanel({ loaded }: StatsPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!loaded || !containerRef.current) return;

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(containerRef.current, { x: -40, opacity: 0, duration: 0.7 });

      STATS.forEach((stat, i) => {
        const counter = { value: 0 };
        const el = containerRef.current?.querySelector<HTMLElement>(`[data-stat="${i}"]`);
        tl.to(
          counter,
          {
            value: stat.value,
            duration: 1.1,
            ease: "power3.out",
            onUpdate: () => {
              if (el) {
                el.textContent = stat.prefix + counter.value.toFixed(stat.decimals) + stat.suffix;
              }
            },
          },
          i * 0.15,
        );
      });
    },
    { scope: containerRef, dependencies: [loaded] },
  );

  return (
    <>
      {/* FIX 4: absolutely positioned from the shared LAYOUT grid -- left
          inset matches sideGutter exactly (mirrored by DriveHud on the
          right), and the vertical band sits entirely above headlineBaselineY
          so it can never collide with the headline type underneath it.
          Anchored at `top` only, with intrinsic height -- a fixed top+bottom
          percentage band forced this to compress/overflow-center at shorter
          viewport heights (900px and below), pushing the third stat down
          toward (and at some heights, into) the headline. Anchoring at the
          top and letting flex-col stack downward at its natural size keeps
          it safely inside [sidePanelBandTop, sidePanelBandBottom] in spirit
          -- comfortably above headlineBaselineY -- without ever compressing. */}
      <div
        ref={containerRef}
        className="hero-fade-content pointer-events-none absolute z-30 flex flex-col gap-8 pl-6"
        style={sharedPosition}
      >
        {STATS.map((stat, i) => (
          <StatRow key={stat.micro} stat={stat} index={i} animate />
        ))}
      </div>

      <div
        className="section2-fade-content pointer-events-none absolute z-30 flex flex-col gap-8 pl-6 opacity-0"
        style={sharedPosition}
      >
        {SECTION2_STATS.map((stat, i) => (
          <StatRow key={stat.micro} stat={stat} index={i} />
        ))}
      </div>
    </>
  );
}
