"use client";

import { type RefObject, useEffect, useMemo, useRef } from "react";
import { LAYOUT } from "@/config/composition";
import { STATION_NAMES, clamp01, easeOutCubic, holdEnd, smoothstep, win } from "@/config/line";
import type { HotspotScreenMap } from "@/lib/hotspots";
import { PLANT_CALLOUTS } from "@/lib/plantCallouts";
import { scrollState } from "@/lib/scrollState";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Fig, HEADING, Rise, SENTENCE } from "@/components/signage";

/**
 * Section 4's words. Like FeatureScan, everything here is a pure function of one
 * scroll number (`scrollState.factory`), evaluated in a single rAF loop and
 * written straight to the DOM: no timelines to drift out of step with the 3D
 * film, no React renders while scrolling, and scrolling back plays it all in
 * reverse.
 *
 * The plant speaks in its own voice: the condensed, all-capitals signage of the
 * boards hanging in the hall, short declarative lines, and nothing that is not
 * a fact. Each moment is placed where the film leaves room for it, not in one
 * template column.
 *
 * Every figure is Ford's own, as published for the plants and the 2020-2022
 * Shelby GT500:
 *
 *   - the 5.2 L supercharged V8 was hand-built by one builder at Ford's Romeo
 *     Engine Plant (Michigan) in about 210 minutes, then shipped to Flat Rock.
 *     Romeo closed in 2022 (it is not on Ford's list of plants today), so the
 *     engine's story is told in the past tense; the car and the plant it was
 *     built at are the 2022 GT500's.
 *   - the car was assembled at Flat Rock Assembly Plant (Michigan): opened 1987,
 *     a 400-acre site, where Ford builds the Mustang today (corporate.ford.com)
 *   - the Tremec seven-speed dual-clutch gearbox shifts in as little as 80 ms
 *
 * Copy that cannot be backed by one of those does not appear here. The closing
 * "build yours" call to action lives at the end of the road finder now.
 */

// ------------------------------------------------------------------ copy

type BeatId = "place" | "engine" | "plant";

type Beat = {
  id: BeatId;
  /** Factory-progress windows: [in start, in end], [out start, out end]. */
  in: [number, number];
  out: [number, number] | null;
};

// Windows sit inside the takt (config/line.ts): the intro flythrough, the
// engine hold and the body hold. The rest of the film, the line, the tunnel and the
// gate, has no words: the car and the hall speak.
const BEATS: Beat[] = [
  { id: "place", in: [0.056, 0.098], out: [0.132, 0.156] },
  { id: "engine", in: [0.168, 0.2], out: [0.252, 0.274] },
  { id: "plant", in: [0.294, 0.328], out: [0.37, 0.394] },
];

// ----------------------------------------------------------------- bits

function Sentence({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p data-part="fade" className={`${SENTENCE} max-w-[31ch] opacity-0 ${className}`}>
      {children}
    </p>
  );
}

// Each beat's own legibility wash. The hall is full of bright light rows and
// the copy sits across them, so the wash is shaped to where the copy is (a
// corner for the corner beats, an edge for the column), not one band for all.
const WASH = {
  corner: "radial-gradient(90% 85% at 0% 100%, rgba(2,5,10,0.86) 0%, rgba(2,5,10,0.6) 34%, rgba(2,5,10,0) 72%)",
  cornerTop: "radial-gradient(90% 85% at 100% 0%, rgba(2,5,10,0.86) 0%, rgba(2,5,10,0.6) 34%, rgba(2,5,10,0) 72%)",
  edge: "linear-gradient(90deg, rgba(2,5,10,0.86) 0%, rgba(2,5,10,0.6) 38%, rgba(2,5,10,0) 100%)",
};

// -------------------------------------------------------------- component

type PlantOverlayProps = {
  screenRef: RefObject<HotspotScreenMap>;
};

export function PlantOverlay({ screenRef }: PlantOverlayProps) {
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<Partial<Record<BeatId, HTMLDivElement | null>>>({});
  const washRefs = useRef<Partial<Record<BeatId, HTMLDivElement | null>>>({});
  const noteRef = useRef<HTMLDivElement>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const plateRefs = useRef<(HTMLLIElement | null)[]>([]);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const dotFillRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const nameRef = useRef<HTMLSpanElement>(null);

  const markerRefs = useRef<(SVGGElement | null)[]>([]);
  const ringRefs = useRef<(SVGCircleElement | null)[]>([]);
  const leaderRefs = useRef<(SVGPathElement | null)[]>([]);
  const calloutRefs = useRef<(HTMLDivElement | null)[]>([]);
  const calloutTitleRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let idle = false;
    // A callout is only its heading, so each leader's rule is cut to the width
    // of its label.
    const widths: number[] = [];
    let measuredFor = -1;
    const measure = () => {
      PLANT_CALLOUTS.forEach((_, i) => {
        widths[i] = calloutRefs.current[i]?.offsetWidth ?? 0;
      });
    };
    void document.fonts?.ready.then(() => measure());

    // The overlay's size, kept up to date by an observer. It used to be read from the element
    // (clientWidth/clientHeight) inside the frame loop, after the loop had written opacities and
    // transforms: reading layout after writing styles makes the browser recalculate style and
    // layout on the spot, once a frame, for as long as the walkthrough is on screen.
    const size = { w: rootRef.current?.clientWidth ?? 0, h: rootRef.current?.clientHeight ?? 0 };
    const sizeObserver = new ResizeObserver(([entry]) => {
      size.w = entry.contentRect.width;
      size.h = entry.contentRect.height;
    });
    if (rootRef.current) sizeObserver.observe(rootRef.current);

    // The parts of each block, collected once.
    const parts: Partial<Record<BeatId, { el: HTMLElement; kind: string }[]>> = {};
    for (const b of BEATS) {
      const root = blockRefs.current[b.id];
      parts[b.id] = root
        ? Array.from(root.querySelectorAll<HTMLElement>("[data-part]")).map((el) => ({ el, kind: el.dataset.part ?? "fade" }))
        : [];
    }

    const hideCallout = (i: number) => {
      if (markerRefs.current[i]) markerRefs.current[i]!.style.opacity = "0";
      if (calloutRefs.current[i]) calloutRefs.current[i]!.style.opacity = "0";
      if (leaderRefs.current[i]) leaderRefs.current[i]!.style.opacity = "0";
    };

    const hideAll = () => {
      for (const b of BEATS) {
        const el = blockRefs.current[b.id];
        if (el) {
          el.style.opacity = "0";
          el.style.visibility = "hidden";
        }
        const wash = washRefs.current[b.id];
        if (wash) wash.style.opacity = "0";
      }
      if (trackRef.current) {
        trackRef.current.style.opacity = "0";
        trackRef.current.style.visibility = "hidden";
      }
      if (noteRef.current) noteRef.current.style.opacity = "0";
      PLANT_CALLOUTS.forEach((_, i) => hideCallout(i));
    };

    // Station i is "now" from the moment the line indexes toward it until its
    // hold ends: [holdEnd(i), holdEnd(i + 1)).
    const segStart = (i: number) => holdEnd(i);
    const segEnd = (i: number) => holdEnd(i + 1);
    const plateState: string[] = STATION_NAMES.map(() => "");
    let shownName = "";

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const root = rootRef.current;
      if (!root) return;
      const f = scrollState.factory;

      if (f <= 0.0005) {
        if (!idle) {
          hideAll();
          idle = true;
        }
        return;
      }
      idle = false;

      // ---- the beats
      for (const b of BEATS) {
        const el = blockRefs.current[b.id];
        if (!el) continue;
        const pin = win(f, b.in[0], b.in[1]);
        const pout = b.out ? win(f, b.out[0], b.out[1]) : 0;
        const alpha = pin > 0 ? 1 - easeOutCubic(pout) : 0;
        const wash = washRefs.current[b.id];

        if (alpha < 0.002) {
          if (el.style.visibility !== "hidden") {
            el.style.visibility = "hidden";
            el.style.opacity = "0";
            if (wash) wash.style.opacity = "0";
          }
          continue;
        }
        el.style.visibility = "visible";
        el.style.opacity = String(alpha);
        if (wash) wash.style.opacity = String(alpha * clamp01(pin / 0.4));
        // The whole block lifts a little as it leaves.
        el.style.transform = reduced || pout === 0 ? "" : `translate3d(0,${(-18 * easeOutCubic(pout)).toFixed(1)}px,0)`;

        const list = parts[b.id] ?? [];
        const n = list.length;
        list.forEach((part, k) => {
          const t = reduced ? clamp01(pin / 0.4) : clamp01((pin - (k / Math.max(n, 1)) * 0.5) / 0.5);
          const e = easeOutCubic(t);
          if (part.kind === "rise") {
            part.el.style.transform = reduced ? "none" : `translate3d(0,${((1 - e) * 108).toFixed(1)}%,0)`;
            part.el.style.opacity = reduced ? String(e) : "1";
          } else {
            part.el.style.opacity = String(e);
            part.el.style.transform = reduced ? "none" : `translate3d(0,${((1 - e) * 14).toFixed(1)}px,0)`;
          }
        });
      }

      // ---- the source note, once the line map has gone: it stays through the closing shot
      if (noteRef.current) noteRef.current.style.opacity = String(smoothstep(0.8, 0.84, f));

      // ---- the line map
      const track = trackRef.current;
      if (track) {
        const show = smoothstep(0.128, 0.152, f) * (1 - smoothstep(0.745, 0.79, f));
        track.style.opacity = String(show);
        track.style.visibility = show < 0.002 ? "hidden" : "visible";
        let active = -1;
        STATION_NAMES.forEach((_, i) => {
          if (f >= segStart(i) && f < segEnd(i)) active = i;
        });
        STATION_NAMES.forEach((_, i) => {
          const state = f >= segEnd(i) ? "done" : i === active ? "active" : "todo";
          const progress = state === "done" ? 1 : state === "active" ? win(f, segStart(i), segEnd(i)) : 0;
          if (plateState[i] !== state) {
            plateState[i] = state;
            plateRefs.current[i]?.setAttribute("data-state", state);
            dotRefs.current[i]?.setAttribute("data-state", state);
          }
          const bar = barRefs.current[i];
          if (bar) bar.style.transform = `scaleX(${progress.toFixed(3)})`;
          const dotFill = dotFillRefs.current[i];
          if (dotFill) dotFill.style.transform = `scaleX(${progress.toFixed(3)})`;
        });
        const label = STATION_NAMES[active >= 0 ? active : f >= segEnd(STATION_NAMES.length - 1) ? STATION_NAMES.length - 1 : 0];
        if (nameRef.current && label !== shownName) {
          shownName = label;
          nameRef.current.textContent = label;
        }
      }

      // ---- callouts on the engine and gearbox (desktop)
      const W = size.w;
      const H = size.h;
      const s = Math.min(Math.max(H / 1080, 0.7), 1.25);
      const callAlpha = smoothstep(0.222, 0.24, f) * (1 - smoothstep(0.262, 0.28, f));
      if (W !== measuredFor) {
        measuredFor = W;
        measure();
      }
      const leg = 54 * s;
      const screen = screenRef.current;

      PLANT_CALLOUTS.forEach((c, i) => {
        const marker = markerRefs.current[i];
        const label = calloutRefs.current[i];
        const leader = leaderRefs.current[i];
        const pos = screen?.[c.id];
        if (!marker || !label || !leader) return;
        if (isMobile || callAlpha < 0.003 || !pos || !pos.visible || pos.x < 24 || pos.x > W - 24 || pos.y < 24 || pos.y > H - 24) {
          hideCallout(i);
          return;
        }

        marker.style.opacity = String(callAlpha);
        marker.setAttribute("transform", `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);
        const e = easeOutCubic(clamp01(callAlpha));
        ringRefs.current[i]?.setAttribute("r", (11 * e).toFixed(2));

        const sx = c.side === "left" ? -1 : 1;
        const sy = c.rise === "up" ? -1 : 1;
        const dx = pos.x + sx * leg;
        const dy = pos.y + sy * leg;
        const rx = dx + sx * ((widths[i] || 180) + 14);
        leader.setAttribute("d", `M${pos.x.toFixed(1)} ${pos.y.toFixed(1)}L${dx.toFixed(1)} ${dy.toFixed(1)}L${rx.toFixed(1)} ${dy.toFixed(1)}`);
        leader.style.opacity = String(callAlpha);
        leader.style.strokeDashoffset = String(1 - easeOutCubic(clamp01((callAlpha - 0.1) / 0.8)));

        const left = Math.min(dx, rx);
        const above = c.rise === "up";
        label.style.opacity = String(callAlpha);
        label.style.transform = `translate3d(${left.toFixed(1)}px,${(above ? dy - 12 : dy + 12).toFixed(1)}px,0)${above ? " translateY(-100%)" : ""}`;
        const eTitle = easeOutCubic(clamp01((callAlpha - 0.25) / 0.5));
        if (calloutTitleRefs.current[i]) calloutTitleRefs.current[i]!.style.transform = `translate3d(0,${((1 - eTitle) * 112).toFixed(1)}%,0)`;
      });
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      sizeObserver.disconnect();
    };
  }, [isMobile, screenRef]);

  // One stable ref callback per block and per wash.
  const { block, wash } = useMemo(() => {
    const blocks: Partial<Record<BeatId, (el: HTMLDivElement | null) => void>> = {};
    const washes: Partial<Record<BeatId, (el: HTMLDivElement | null) => void>> = {};
    for (const b of BEATS) {
      blocks[b.id] = (el) => {
        blockRefs.current[b.id] = el;
      };
      washes[b.id] = (el) => {
        washRefs.current[b.id] = el;
      };
    }
    return { block: (id: BeatId) => blocks[id], wash: (id: BeatId) => washes[id] };
  }, []);

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Assembly plant walkthrough"
      className="plant-overlay pointer-events-none absolute inset-0 z-[27] overflow-hidden"
      style={{ ["--gutter" as string]: `${LAYOUT.sideGutter * 100}%` }}
    >
      <p className="sr-only">
        Flat Rock Assembly Plant in Michigan builds the Mustang. The 2022 Shelby GT500&apos;s 5.2-litre supercharged V8 was assembled by hand
        at Ford&apos;s Romeo Engine Plant. The walkthrough follows a car through five stations: engine, body, doors, hood and trunk, then
        bumpers and lights.
      </p>

      {/* ------------------------------------------------ the legibility washes */}
      <div ref={wash("place")} aria-hidden className="absolute bottom-0 left-0 hidden h-[80%] w-[74%] opacity-0 will-change-[opacity] md:block" style={{ background: WASH.corner }} />
      <div ref={wash("engine")} aria-hidden className="absolute right-0 top-0 hidden h-[72%] w-[62%] opacity-0 will-change-[opacity] md:block" style={{ background: WASH.cornerTop }} />
      <div ref={wash("plant")} aria-hidden className="absolute inset-y-0 left-0 hidden w-[58%] opacity-0 will-change-[opacity] md:block" style={{ background: WASH.edge }} />

      {/* ------------------------------------------------------ two plants */}
      <div
        ref={block("place")}
        className="invisible absolute inset-x-6 bottom-[16%] opacity-0 will-change-[opacity,transform] md:inset-x-auto md:bottom-[11%] md:left-[var(--gutter)] md:w-[min(46vw,760px)]"
      >
        <div className="flex flex-col gap-5 md:gap-6">
          <h2 className={`${HEADING} text-[clamp(52px,6.9vw,128px)]`}>
            <Rise>Two plants.</Rise>
            <Rise>One car.</Rise>
          </h2>
          <Sentence>
            The engine was hand-built in Romeo, Michigan. The car came together at Flat Rock.
          </Sentence>
        </div>
      </div>

      {/* ----------------------------------------------------- the engine */}
      <div
        ref={block("engine")}
        className="invisible absolute inset-x-6 bottom-[16%] opacity-0 will-change-[opacity,transform] md:inset-x-auto md:bottom-auto md:right-[var(--gutter)] md:top-[19%] md:w-[min(34vw,560px)]"
      >
        <div className="flex flex-col gap-5 md:items-end md:gap-6 md:text-right">
          <h3 className={`${HEADING} text-[clamp(40px,4.7vw,88px)]`}>
            <Rise>One builder.</Rise>
            <Rise>One engine.</Rise>
          </h3>
          <Sentence>
            One builder assembled each 5.2-litre supercharged V8 at Ford&apos;s Romeo Engine Plant. It took about <Fig>210 minutes</Fig>.
          </Sentence>
        </div>
      </div>

      {/* ------------------------------------------------------ flat rock */}
      <div
        ref={block("plant")}
        className="invisible absolute inset-x-6 bottom-[16%] opacity-0 will-change-[opacity,transform] md:inset-x-auto md:bottom-auto md:left-[var(--gutter)] md:top-[26%] md:w-[min(30vw,500px)]"
      >
        <div className="flex flex-col gap-5 md:gap-6">
          <h3 className={`${HEADING} text-[clamp(40px,4.7vw,88px)]`}>
            <Rise>Flat Rock,</Rise>
            <Rise>Michigan.</Rise>
          </h3>
          <Sentence>
            Opened in <Fig>1987</Fig> on a <Fig>400-acre</Fig> site, this is where Ford builds the Mustang.
          </Sentence>
        </div>
      </div>

      {/* Where the figures come from, and what the line is. It sits where the
          line map sat. */}
      <div
        ref={noteRef}
        className="absolute inset-x-6 bottom-[3.2%] text-center opacity-0 md:bottom-[4.2%]"
      >
        <span className="font-plant-text text-[11.5px] font-medium leading-snug tracking-[0.02em] text-white/70 [text-shadow:0_1px_10px_rgba(0,4,12,0.95)]">
          Plant facts: Ford Media and corporate.ford.com. The line shown is a simplified illustration.
        </span>
      </div>

      {/* -------------------------------------------------------- line map */}
      <div
        ref={trackRef}
        className="invisible absolute inset-x-0 bottom-[4.5%] flex justify-center px-4 opacity-0"
        aria-hidden
      >
        {/* Desktop: the five stations as one plate. The station the car is at
            is white; the ones it has left are lit; the ones to come are dark. */}
        <ol className="hidden overflow-hidden rounded-[4px] bg-[rgba(6,9,15,0.9)] shadow-[0_0_0_1px_rgba(255,255,255,0.14)] md:flex">
          {STATION_NAMES.map((name, i) => (
            <li
              key={name}
              ref={(el) => {
                plateRefs.current[i] = el;
              }}
              data-state="todo"
              className="group relative flex h-11 items-center whitespace-nowrap border-l border-white/10 px-[clamp(14px,1.3vw,24px)] font-plant-text text-[clamp(11px,0.78vw,13.5px)] font-semibold uppercase tracking-[0.12em] text-white/60 transition-colors duration-200 first:border-l-0 data-[state=active]:bg-white data-[state=active]:text-[#0a0f18] data-[state=done]:bg-white/[0.14] data-[state=done]:text-white"
            >
              {name}
              <span
                ref={(el) => {
                  barRefs.current[i] = el;
                }}
                className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-ford-grabber group-data-[state=done]:bg-white"
                style={{ transform: "scaleX(0)" }}
              />
            </li>
          ))}
        </ol>

        {/* Phone: the current station's name over five bars, like a story. */}
        <div className="flex w-[min(92vw,420px)] flex-col gap-2.5 rounded-[4px] bg-[rgba(6,9,15,0.9)] px-4 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.14)] md:hidden">
          <span ref={nameRef} className="font-plant-text text-[12px] font-semibold uppercase tracking-[0.14em] text-white">
            {STATION_NAMES[0]}
          </span>
          <div className="flex gap-1.5">
            {STATION_NAMES.map((name, i) => (
              <span
                key={name}
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
                data-state="todo"
                className="relative h-[3px] flex-1 overflow-hidden rounded-[1px] bg-white/25"
              >
                <span
                  ref={(el) => {
                    dotFillRefs.current[i] = el;
                  }}
                  className="absolute inset-0 origin-left bg-white"
                  style={{ transform: "scaleX(0)" }}
                />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* --------------------------- callouts on the engine and gearbox */}
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {PLANT_CALLOUTS.map((c, i) => (
          <g key={c.id}>
            <path
              ref={(el) => {
                leaderRefs.current[i] = el;
              }}
              fill="none"
              stroke="rgba(255,255,255,0.72)"
              strokeWidth={1}
              pathLength={1}
              style={{ strokeDasharray: 1, strokeDashoffset: 1, opacity: 0 }}
            />
            <g
              ref={(el) => {
                markerRefs.current[i] = el;
              }}
              style={{ opacity: 0 }}
            >
              <circle
                ref={(el) => {
                  ringRefs.current[i] = el;
                }}
                r={0}
                fill="rgba(0,8,22,0.35)"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={1}
              />
              <circle r={3.4} fill="#1700f4" stroke="rgba(255,255,255,0.85)" strokeWidth={1} />
            </g>
          </g>
        ))}
      </svg>
      {!isMobile && (
        <div className="absolute inset-0">
          {PLANT_CALLOUTS.map((c, i) => (
            <div
              key={c.id}
              ref={(el) => {
                calloutRefs.current[i] = el;
              }}
              className="absolute left-0 top-0 w-max whitespace-nowrap opacity-0 [text-shadow:0_1px_16px_rgba(0,6,18,0.95)]"
            >
              <span className="block overflow-hidden pb-[3px]">
                <span
                  ref={(el) => {
                    calloutTitleRefs.current[i] = el;
                  }}
                  className="block font-display text-[clamp(16px,1.15vw,22px)] font-extrabold uppercase leading-[1.05] tracking-[-0.02em] text-white will-change-transform"
                  style={{ transform: "translate3d(0,112%,0)" }}
                >
                  {c.title}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
