"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { HOTSPOTS, type HotspotScreenMap } from "@/lib/hotspots";
import { scrollState } from "@/lib/scrollState";
import { useIsMobile } from "@/hooks/useIsMobile";

type FeatureScanProps = {
  /** Written every frame inside the Canvas (MustangModel), read here in a
   * plain rAF loop -- never React state, so five anchors' worth of position
   * updates cost no renders. */
  screenRef: RefObject<HotspotScreenMap>;
};

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** How far (px) the light blade has to travel past a feature's marker for its
 * callout to finish drawing itself. */
const IGNITE_TRAVEL = 380;
/** The blade is slightly AHEAD of a marker when the marker starts to wake. */
const IGNITE_LEAD = 40;

/**
 * The interior feature reveal: the cabin drops to near-dark, then a blade of
 * light sweeps across it as you scroll. Each feature ignites as the blade
 * passes its marker -- a ring opens on the part, a 45-degree leader draws
 * out to a rule, and the title and line of copy rise out of masks the way the
 * hero headline does. Scroll back and it un-lights in reverse.
 *
 * Everything is a pure function of `scrollState.features` (0-1 across about a
 * screen and a bit of scroll), evaluated in one rAF loop and written straight
 * to the DOM: no timelines to fall out of step with the scroll, no React
 * renders, and the blade and the darkness are each a single transformed layer,
 * so the whole effect is composited rather than repainted.
 *
 * Under `prefers-reduced-motion` there is no sweep: the features simply
 * appear, together, once the scan begins.
 */
export function FeatureScan({ screenRef }: FeatureScanProps) {
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const bladeRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const markerRefs = useRef<(SVGGElement | null)[]>([]);
  const ringRefs = useRef<(SVGCircleElement | null)[]>([]);
  const flashRefs = useRef<(SVGCircleElement | null)[]>([]);
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const leaderRefs = useRef<(SVGPathElement | null)[]>([]);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const titleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const bodyRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Mobile has no room for leaders and labels beside the car, so it shows the
  // markers and one caption for the latest feature to light. React state is
  // fine here: it only changes a handful of times per scan.
  const [caption, setCaption] = useState(-1);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let idle = false;
    const leaderKey: string[] = [];
    let lastCaption = -1;

    const hideAll = () => {
      if (dimRef.current) dimRef.current.style.opacity = "0";
      if (bladeRef.current) bladeRef.current.style.opacity = "0";
      HOTSPOTS.forEach((_, i) => hideFeature(i));
    };

    // One place that switches a feature fully off -- marker, leader AND label.
    // (Leaders used to be left behind when scrolling back up.)
    const hideFeature = (i: number) => {
      if (markerRefs.current[i]) markerRefs.current[i]!.style.opacity = "0";
      if (labelRefs.current[i]) labelRefs.current[i]!.style.opacity = "0";
      const leader = leaderRefs.current[i];
      if (leader) leader.style.opacity = "0";
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const root = rootRef.current;
      if (!root) return;

      const f = scrollState.features;
      // Before the scan starts (the whole hero and approach) there is
      // nothing to draw: clear once, then idle at zero cost.
      if (f <= 0.0005) {
        if (!idle) {
          hideAll();
          idle = true;
          if (lastCaption !== -1) {
            lastCaption = -1;
            setCaption(-1);
          }
        }
        return;
      }
      idle = false;

      const W = root.clientWidth;
      const H = root.clientHeight;
      const s = Math.min(Math.max(H / 1080, 0.7), 1.25);
      const screen = screenRef.current;

      // The blade crosses from just off the left edge to just off the right,
      // linearly in scroll, so the scrollbar still means what it says.
      const barX = reduced ? -W : -0.08 * W + 1.16 * W * f;
      const scan = reduced ? 0 : smooth(0, 0.05, f) * (1 - smooth(0.97, 1, f));
      if (dimRef.current) {
        dimRef.current.style.opacity = String(scan);
        dimRef.current.style.transform = `translate3d(${barX}px,0,0)`;
      }
      if (bladeRef.current) {
        bladeRef.current.style.opacity = String(scan);
        bladeRef.current.style.transform = `translate3d(${barX}px,0,0)`;
      }

      const ruleLength = Math.min(Math.max(W * 0.135, 230), 300);
      const leg = 62 * s; // each axis of the 45-degree run
      // Mobile caption: the scan is split into one segment per feature, in
      // left-to-right order. It does not depend on where the anchors land:
      // at a phone's aspect ratio most of the cabin is out of frame, but the
      // copy should still walk through every feature.
      const newest = isMobile && f > 0.04 ? Math.min(HOTSPOTS.length - 1, Math.floor(((f - 0.04) / 0.94) * HOTSPOTS.length)) : -1;

      HOTSPOTS.forEach((h, i) => {
        const marker = markerRefs.current[i];
        const label = labelRefs.current[i];
        const pos = screen?.[h.id];
        if (!marker || !label) return;

        if (!pos || !pos.visible) {
          hideFeature(i);
          return;
        }

        const ax = pos.x + (h.nudge?.[0] ?? 0) * H;
        const ay = pos.y + (h.nudge?.[1] ?? 0) * H;
        // Off the frame (after any nudge): nothing to point at.
        if (ax < -20 || ax > W + 20 || ay < -20 || ay > H + 20) {
          hideFeature(i);
          return;
        }
        const t = reduced ? 1 : clamp01((barX - ax + IGNITE_LEAD) / IGNITE_TRAVEL);

        if (t <= 0) {
          hideFeature(i);
          return;
        }

        marker.style.opacity = "1";
        marker.setAttribute("transform", `translate(${ax.toFixed(1)} ${ay.toFixed(1)})`);

        const eMarker = easeOut(clamp01(t / 0.3));
        ringRefs.current[i]?.setAttribute("r", (12 * eMarker).toFixed(2));
        dotRefs.current[i]?.setAttribute("r", (3.4 * eMarker).toFixed(2));
        const flash = clamp01((t - 0.04) / 0.46);
        const flashEl = flashRefs.current[i];
        if (flashEl) {
          flashEl.setAttribute("r", (12 + 26 * easeOut(flash)).toFixed(2));
          flashEl.style.opacity = flash > 0 && flash < 1 ? String(0.55 * (1 - flash)) : "0";
        }

        if (isMobile) {
          label.style.opacity = "0";
          const leaderM = leaderRefs.current[i];
          if (leaderM) leaderM.style.opacity = "0";
          return;
        }

        // ---- leader: marker -> 45-degree run -> horizontal rule
        const sx = h.side === "left" ? -1 : 1;
        const sy = h.rise === "up" ? -1 : 1;
        const dx = ax + sx * leg;
        const dy = ay + sy * leg;
        const rx = dx + sx * ruleLength;
        const path = `M${ax.toFixed(1)} ${ay.toFixed(1)}L${dx.toFixed(1)} ${dy.toFixed(1)}L${rx.toFixed(1)} ${dy.toFixed(1)}`;
        const leader = leaderRefs.current[i];
        if (leader) {
          if (leaderKey[i] !== path) {
            leaderKey[i] = path;
            leader.setAttribute("d", path);
          }
          leader.style.opacity = "1";
          leader.style.strokeDashoffset = String(1 - easeOut(clamp01((t - 0.12) / 0.5)));
        }

        // ---- label: sits on the rule, extending from its far end
        const left = Math.min(dx, rx);
        const above = h.rise === "up";
        label.style.opacity = "1";
        label.style.width = `${ruleLength}px`;
        label.style.transform = `translate3d(${left.toFixed(1)}px,${(above ? dy - 13 : dy + 13).toFixed(1)}px,0)${above ? " translateY(-100%)" : ""}`;

        const eTitle = easeOut(clamp01((t - 0.36) / 0.4));
        const eBody = easeOut(clamp01((t - 0.5) / 0.42));
        if (titleRefs.current[i]) titleRefs.current[i]!.style.transform = `translate3d(0,${((1 - eTitle) * 112).toFixed(1)}%,0)`;
        if (bodyRefs.current[i]) bodyRefs.current[i]!.style.transform = `translate3d(0,${((1 - eBody) * 112).toFixed(1)}%,0)`;
      });

      if (isMobile && newest !== lastCaption) {
        lastCaption = newest;
        setCaption(newest);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isMobile, screenRef]);

  return (
    <div ref={rootRef} className="feature-scan pointer-events-none absolute inset-0 z-[26] overflow-hidden" aria-label="Interior features">
      {/* The darkness ahead of the blade: one wide layer whose left edge is a
          soft feather, moved by transform alone. Twilight-tinted black, not
          neutral, so it reads as the cabin going dark rather than a grey film. */}
      <div
        ref={dimRef}
        className="absolute left-0 top-0 h-full will-change-transform"
        style={{
          width: "220%",
          opacity: 0,
          background:
            "linear-gradient(90deg, rgba(0,8,22,0) 0, rgba(0,8,22,0.5) 7vw, rgba(0,8,22,0.84) 16vw, rgba(0,8,22,0.84) 100%)",
        }}
      />

      {/* The blade: a thin hard core, the light it has already thrown behind
          it, and a glow. Static paint, moved by transform. */}
      <div ref={bladeRef} className="absolute left-0 top-0 h-full w-0 will-change-transform" style={{ opacity: 0 }}>
        <div
          className="absolute right-0 top-0 h-full"
          style={{
            width: "24vw",
            background: "linear-gradient(to left, rgba(150,176,255,0.16), rgba(150,176,255,0.05) 40%, rgba(150,176,255,0))",
          }}
        />
        <div
          className="absolute top-0 h-full"
          style={{
            left: -1,
            width: 2,
            background: "linear-gradient(to bottom, rgba(220,232,255,0), rgba(232,240,255,0.95) 14%, rgba(232,240,255,0.95) 86%, rgba(220,232,255,0))",
            boxShadow: "0 0 14px 2px rgba(140,168,255,0.55), 0 0 70px 14px rgba(60,92,255,0.22)",
          }}
        />
      </div>

      {/* Markers and leaders. One SVG, geometry set per frame. */}
      <svg ref={svgRef} className="absolute inset-0 h-full w-full overflow-visible z-[30]" aria-hidden>
        {HOTSPOTS.map((h, i) => (
          <g key={h.id}>
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
                  flashRefs.current[i] = el;
                }}
                r={12}
                fill="none"
                stroke="rgba(214,226,255,0.9)"
                strokeWidth={1}
                style={{ opacity: 0 }}
              />
              <circle
                ref={(el) => {
                  ringRefs.current[i] = el;
                }}
                r={0}
                fill="rgba(0,8,22,0.35)"
                stroke="rgba(255,255,255,0.8)"
                strokeWidth={1}
              />
              <circle
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
                r={0}
                fill="#1700f4"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={1}
              />
            </g>
          </g>
        ))}
      </svg>

      {/* Labels: real text, so they wrap, select, translate and read aloud.
          Each line lives in an overflow mask and rises into it. */}
      {!isMobile && (
        <div className="features-list absolute inset-0 z-[30]">
          {HOTSPOTS.map((h, i) => (
            <div
              key={h.id}
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              data-cursor-hover
              className="feature pointer-events-auto absolute left-0 top-0 flex cursor-default flex-col gap-2 opacity-0 transition-[opacity] duration-300 [text-shadow:0_1px_16px_rgba(0,6,18,0.95)]"
            >
              <span className="block overflow-hidden pb-[3px]">
                <span
                  ref={(el) => {
                    titleRefs.current[i] = el;
                  }}
                  className="block font-display text-[clamp(17px,1.2vw,23px)] font-extrabold uppercase leading-[1.05] tracking-[-0.02em] text-white will-change-transform"
                  style={{ transform: "translate3d(0,112%,0)" }}
                >
                  {h.title}
                </span>
              </span>
              <span className="block overflow-hidden">
                <span
                  ref={(el) => {
                    bodyRefs.current[i] = el;
                  }}
                  className="block max-w-[30ch] font-body text-[clamp(12.5px,0.82vw,14.5px)] leading-[1.45] text-white/80 will-change-transform"
                  style={{ transform: "translate3d(0,112%,0)" }}
                >
                  {h.body}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {isMobile && (
        <div className="absolute inset-x-6 bottom-24 z-[30] min-h-[76px]">
          {HOTSPOTS.map((h, i) => (
            <div
              key={h.id}
              className={`absolute inset-x-0 bottom-0 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none ${
                caption === i ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
              }`}
            >
              <p className="font-display text-[19px] font-extrabold uppercase leading-none tracking-[-0.02em] text-white">
                {h.title}
              </p>
              <p className="mt-2 max-w-[34ch] font-body text-[14px] leading-[1.45] text-white/80">{h.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
