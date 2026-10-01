"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { LAYOUT } from "@/config/composition";
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
 * It mirrors StatsPanel on the left in everything but content: the same
 * condensed figure leads, the same caption sits under it, and the controls
 * take the place of the second pair. The figure is the road's speed, live: it
 * climbs as you scroll (scrolling reads as accelerating) and eases back to the
 * mode's cruise speed when you stop, and the caption under it says what the
 * mode does. The modes are a small switch, like the one on the car: one solid
 * plate marks the mode you are in and slides to the next when you pick it.
 */
export function DriveHud({ loaded }: DriveHudProps) {
  const mode = useDriveMode();
  const modeIndex = DRIVE_MODES.findIndex((m) => m.id === mode.id);

  const containerRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const placed = useRef(false);
  // The caption only animates once the mode has actually been changed: on first
  // load it belongs to the panel's own entrance.
  const [touched, setTouched] = useState(false);

  useGSAP(
    () => {
      const root = containerRef.current;
      if (!loaded || !root) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const rise = root.querySelector<HTMLElement>("[data-rise]");
      const fades = root.querySelectorAll<HTMLElement>("[data-fade]");
      const switchEl = root.querySelector<HTMLElement>("[data-switch]");
      if (reduced) {
        if (rise) gsap.set(rise, { y: "0%" });
        gsap.set(fades, { opacity: 1 });
        if (switchEl) gsap.set(switchEl, { opacity: 1, y: 0 });
        return;
      }
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      if (rise) tl.to(rise, { y: "0%", duration: 0.9 }, 0.2);
      tl.to(fades, { opacity: 1, duration: 0.6 }, 0.45);
      if (switchEl) tl.to(switchEl, { opacity: 1, y: 0, duration: 0.7 }, 0.55);
    },
    { scope: containerRef, dependencies: [loaded] },
  );

  // The plate that marks the active mode: one element, moved to sit exactly
  // behind the active button (transform only, so it is cheap and smooth). It is
  // measured rather than computed, so it is right in the 2 x 2 grid on a
  // desktop and in the single row on a phone alike.
  useLayoutEffect(() => {
    const place = () => {
      const button = buttonRefs.current[modeIndex];
      const plate = highlightRef.current;
      if (!button || !plate) return;
      plate.style.width = `${button.offsetWidth}px`;
      plate.style.height = `${button.offsetHeight}px`;
      plate.style.transform = `translate3d(${button.offsetLeft}px, ${button.offsetTop}px, 0)`;
      if (!placed.current) {
        // First placement: no slide in from the corner.
        placed.current = true;
        plate.style.transition = "none";
        void plate.offsetWidth;
        plate.style.transition = "";
      }
    };
    place();
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(() => {
      // A resize re-seats the plate without animating it.
      const plate = highlightRef.current;
      if (plate) plate.style.transition = "none";
      place();
      if (plate) {
        void plate.offsetWidth;
        plate.style.transition = "";
      }
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [modeIndex]);

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
        speedRef.current.textContent = String(mph);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={containerRef}
      // hero-fade-content: fades out with the rest of the hero chrome once
      // Section 2 is in view.
      className="hero-fade-content pointer-events-none absolute z-30 flex flex-col items-end gap-[clamp(22px,2.3vw,42px)] text-right max-md:inset-x-5 max-md:bottom-[9%] md:right-[var(--gutter)] md:top-[var(--band-top)] md:w-[clamp(220px,17vw,340px)]"
      style={{
        ["--gutter" as string]: `${LAYOUT.sideGutter * 100}%`,
        ["--band-top" as string]: `${LAYOUT.sidePanelBandTop * 100}%`,
      }}
    >
      {/* The speed. On a phone the road speaks for itself and the switch is
          what is worth the room. */}
      <div className="flex flex-col items-end gap-[0.5em] text-[clamp(13px,0.9vw,16px)] [text-shadow:0_2px_26px_rgba(0,4,14,0.8)] max-md:hidden">
        <span aria-hidden className="block overflow-hidden pb-[0.06em]">
          <span data-rise className="flex items-baseline gap-[0.22em]" style={{ transform: "translate3d(0,108%,0)" }}>
            <span
              ref={speedRef}
              className="font-plant-display text-[clamp(64px,5.2vw,104px)] font-semibold leading-[0.9] tracking-[-0.005em] text-white tabular-nums"
            >
              0
            </span>
            <span className="font-plant-display text-[clamp(26px,2.1vw,42px)] font-medium leading-none text-white/80">mph</span>
          </span>
        </span>
        {/* Said once, when the mode changes, not on every tick of the number. */}
        <div aria-live="polite">
          <p
            key={mode.id}
            data-fade
            className={`${touched ? "note-in " : ""}max-w-[28ch] text-pretty font-plant-text font-medium leading-tight text-white/70 opacity-0`}
          >
            {mode.note}
          </p>
        </div>
      </div>

      <div data-switch className="pointer-events-auto relative w-full opacity-0 md:w-[clamp(206px,14.2vw,260px)]" style={{ transform: "translate3d(0,10px,0)" }}>
        <div role="group" aria-label="Drive mode" ref={gridRef} className="relative grid grid-cols-4 gap-1.5 md:grid-cols-2">
          {/* The resting plates sit behind everything, the active plate on top
              of them, the labels on top of that. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-4 gap-1.5 md:grid-cols-2">
            {DRIVE_MODES.map((m) => (
              <span key={m.id} className="rounded-[4px] bg-[rgba(8,12,22,0.8)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]" />
            ))}
          </div>
          <span
            ref={highlightRef}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 rounded-[4px] bg-white transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
          />
          {DRIVE_MODES.map((m, i) => {
            const active = i === modeIndex;
            return (
              <button
                key={m.id}
                ref={(el) => {
                  buttonRefs.current[i] = el;
                }}
                type="button"
                data-cursor-hover
                aria-pressed={active}
                onClick={() => {
                  setTouched(true);
                  setDriveMode(i);
                }}
                className={`relative h-10 whitespace-nowrap rounded-[4px] px-2 font-plant-display text-[clamp(14px,0.95vw,17px)] font-semibold uppercase tracking-[0.07em] outline-none transition-colors duration-200 active:translate-y-px motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:px-3 ${
                  active ? "text-[#0a0f18]" : "text-white/85 hover:bg-white/10 hover:text-white"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
