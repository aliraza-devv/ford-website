"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { LAYOUT } from "@/config/composition";
import { MAX_SPEED } from "@/config/worlds";
import { DRIVE_MODES, setDriveMode, useDriveMode } from "@/lib/driveMode";
import { scrollState } from "@/lib/scrollState";

type DriveHudProps = {
  loaded: boolean;
};

const MPH_PER_MS = 2.23694;
/** The readout refreshes 20 times a second: a number that re-rendered every
 * frame would be unreadable, and a text node write is not free. */
const READOUT_INTERVAL_MS = 50;

/**
 * The hero's right-hand panel: pick a drive mode, watch the road respond.
 *
 * It replaces the paint swatches. Both sit in the same LAYOUT slot (mirroring
 * StatsPanel on the left, same micro-label + big-number language), but this
 * one is part of the scene rather than a setting for it: choosing a mode
 * changes how fast the road runs, and the readout underneath is that speed,
 * live -- it climbs as you scroll (scrolling reads as accelerating) and eases
 * back to the mode's cruise speed when you stop.
 */
export function DriveHud({ loaded }: DriveHudProps) {
  const mode = useDriveMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (!loaded || !containerRef.current) return;
      gsap.from(containerRef.current, {
        x: 40,
        opacity: 0,
        duration: 0.7,
        delay: 0.15,
        ease: "power3.out",
      });
    },
    { scope: containerRef, dependencies: [loaded] },
  );

  // Live speed. Plain DOM writes from a rAF loop, never React state: this
  // changes every few milliseconds and would otherwise re-render the panel.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let shown = -1;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < READOUT_INTERVAL_MS) return;
      last = now;
      const mph = Math.round(scrollState.speed * MPH_PER_MS);
      if (mph !== shown && speedRef.current) {
        shown = mph;
        speedRef.current.textContent = String(mph).padStart(3, "0");
      }
      if (barRef.current) {
        const fraction = Math.min(scrollState.speed / MAX_SPEED, 1);
        barRef.current.style.transform = `scaleX(${fraction.toFixed(3)})`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={containerRef}
      // hero-fade-content: fades out with the rest of the hero chrome once
      // Section 2 is in view, as the swatches did.
      className="hero-fade-content pointer-events-auto absolute z-30 flex flex-col items-end gap-9 pr-6 text-right"
      style={{
        right: `${LAYOUT.sideGutter * 100}%`,
        top: `${LAYOUT.sidePanelBandTop * 100}%`,
        width: `${LAYOUT.panelWidth * 100}%`,
        borderRight: "1px solid rgba(255,255,255,0.2)",
      }}
    >
      <div className="flex flex-col items-end gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">Drive mode</span>

        <div role="group" aria-label="Drive mode" className="flex flex-col items-end gap-1.5">
          {DRIVE_MODES.map((m, i) => {
            const active = m.id === mode.id;
            return (
              <button
                key={m.id}
                type="button"
                data-cursor-hover
                aria-pressed={active}
                onClick={() => setDriveMode(i)}
                className="group flex items-center gap-3 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-white/60"
              >
                <span
                  className={`text-[13px] font-semibold uppercase tracking-[0.14em] transition-colors duration-200 motion-reduce:transition-none ${
                    active ? "text-white" : "text-white/45 group-hover:text-white/80"
                  }`}
                >
                  {m.label}
                </span>
                {/* The active mode's tick is the brand's Grabber blue -- the
                    one accent on this panel. */}
                <span
                  className={`h-[2px] transition-all duration-300 ease-out motion-reduce:transition-none ${
                    active ? "w-7 bg-ford-grabber" : "w-3 bg-white/30 group-hover:w-5"
                  }`}
                />
              </button>
            );
          })}
        </div>

        <p className="max-w-[18ch] text-[12px] leading-snug text-white/55">{mode.note}</p>
      </div>

      <div className="flex w-full flex-col items-end gap-1.5">
        <div className="flex w-full items-baseline justify-between gap-4 text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">
          <span>Road speed</span>
          <span>MPH</span>
        </div>
        <span
          ref={speedRef}
          className="font-display text-[40px] font-extrabold leading-none tabular-nums text-white"
        >
          000
        </span>
        <span className="mt-1 block h-[3px] w-full bg-white/15">
          <span ref={barRef} className="block h-full origin-left bg-ford-grabber" style={{ transform: "scaleX(0)" }} />
        </span>
      </div>
    </div>
  );
}
