"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { LAYOUT } from "@/config/composition";
import { COVER_VH, HOLD_VH, SECTION_Z } from "@/config/sections";
import { PLANTS, PLANTS_AS_OF, PLANTS_SOURCE, STATE_NAMES, type StateCode } from "@/config/fordPlants";
import {
  MAP_VH,
  PLANT_BEAT,
  SEGMENTS,
  STATE_STOPS,
  STOPS,
  beatAt,
  flightEase,
  groupEnd,
  groupStart,
  locate,
  stopEnd,
} from "@/config/plantTour";
import { interpolateView, viewFor, type Focus, type View } from "@/lib/mapCamera";
import { clamp01, easeOutCubic, smoothstep } from "@/lib/ease";
import { scrollState } from "@/lib/scrollState";
import { scrollToY } from "@/lib/lenisInstance";
import { setStageLive } from "@/lib/stageLive";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Navbar } from "@/components/hero/Navbar";
import { HEADING, PLATE_LABEL, Rise, SENTENCE } from "@/components/signage";
import { MapPainter, type PaintPlant } from "./mapPainter";

gsap.registerPlugin(ScrollTrigger);

/**
 * Section 5: where Ford builds. The camera tours the United States and comes to rest on
 * each of Ford's assembly plants in turn; a board names the plant and the vehicles it
 * builds, and the state it stands in lights up.
 *
 * Like the plant film, the whole thing is a pure function of one scroll number
 * (`scrollState.map`, from the tour in config/plantTour), written straight to the canvas
 * and the DOM from one loop: nothing is a timeline to drift out of step, no React renders
 * while scrolling, and scrolling back plays it in reverse. The loop only does work when
 * the scroll number has changed.
 *
 * The plants, their models and their cities are Ford's own list (config/fordPlants).
 */

/** How far in the camera may go, in screen px per map unit. A unit is about 2.9 km, and
 * the map's coastline is generalised for a view of the whole country, so closer than this
 * its edges begin to look like what they are. */
const MAX_ZOOM = 9.5;

/** Where each plant's board hangs from its marker, for a stage 1080 px high. `corner` is
 * the corner of the board the leader runs to. */
type Hang = { dx: number; dy: number; corner: "tl" | "tr" | "bl" | "br" };
const HANG: Record<string, Hang> = {
  "flat-rock": { dx: -60, dy: 88, corner: "tr" },
  "michigan-assembly": { dx: -64, dy: -112, corner: "br" },
  "dearborn-truck": { dx: 82, dy: -104, corner: "bl" },
  "ohio-assembly": { dx: 56, dy: 72, corner: "tl" },
  "chicago-assembly": { dx: -84, dy: -76, corner: "br" },
  "kansas-city": { dx: 80, dy: 62, corner: "tl" },
  "kentucky-truck": { dx: 84, dy: -96, corner: "bl" },
  "louisville-assembly": { dx: -84, dy: 84, corner: "tr" },
};

type Group = { stop: number; g: number; gs: number; ge: number; sentenceStarts: number[]; state?: StateCode };

const GROUPS: Group[] = STOPS.flatMap((stop, i) =>
  stop.groups.map((group, g) => {
    const gs = groupStart(i, g);
    return {
      stop: i,
      g,
      gs,
      ge: groupEnd(i, g),
      state: group.state,
      sentenceStarts: group.sentences.map((s, k) => (k === 0 ? gs + 0.012 : beatAt(i, s.fromBeat) - 0.012)),
    };
  }),
);

/** Progress at which each plant lights up. */
const BEAT_TIME = PLANTS.map((p) => beatAt(PLANT_BEAT[p.id].stop, PLANT_BEAT[p.id].beat));
/** The progress at which the hold a plant is in comes to an end, and at which the next
 * plant in the same stop (if any) lights up. */
const BEAT_END = PLANTS.map((p) => stopEnd(PLANT_BEAT[p.id].stop));
const BEAT_NEXT = PLANTS.map((p) => {
  const { stop, beat } = PLANT_BEAT[p.id];
  return STOPS[stop].beats[beat + 1] ? beatAt(stop, beat + 1) : stopEnd(stop);
});

const GROUND = "#04070d";

/** Keeps a hyphenated name (F-150, E-Series, mid-sized) on one line. */
function NoBreak({ text }: { text: string }) {
  return text.split(/(\S+-\S+)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** How lit a state with a plant in it is before the tour has been there: enough that the
 * five states read as a set from the first frame. */
const PREVIEW_LIT = 0.4;

/** Fine grain, to break up the banding that a dark gradient shows in 8 bits. A tile of
 * SVG noise, rendered once by the browser and repeated. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27180%27 height=%27180%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.85%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix values=%270 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1.6 -0.45%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E\")";

/** The page’s side gutter, shared with every other section. */
const STAGE_VARS = { ["--gutter" as string]: `${LAYOUT.sideGutter * 100}%` };

export function PlantMap() {
  const isMobile = useIsMobile();
  const wrapperRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leaderRefs = useRef<(SVGLineElement | null)[]>([]);
  const boardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);
  const plateRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const noteRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !stage || !canvas) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const painter = new MapPainter(canvas);

    // ---- layout, redone whenever the stage changes size
    let W = 0;
    let H = 0;
    let fcx = 0;
    let fcy = 0;
    let scale = 1;
    let views: View[] = [];
    let flights: ((t: number) => View)[] = [];
    let boardSize: { w: number; h: number }[] = [];
    let layoutVersion = 0;

    const layout = () => {
      W = stage.clientWidth;
      H = stage.clientHeight;
      if (!W || !H) return;
      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      // A 4K stage at 2x is 33 megapixels of canvas; the plates do not need it.
      while (W * H * dpr * dpr > 4.4e6 && dpr > 1) dpr = Math.max(1, dpr - 0.25);
      painter.resize(W, H, dpr);

      const focus: Focus = isMobile
        ? { x: W * 0.03, y: H * 0.29, w: W * 0.94, h: H * 0.34 }
        : { x: W * 0.38, y: H * 0.08, w: W * 0.6, h: H * 0.84 };
      fcx = focus.x + focus.w / 2;
      fcy = focus.y + focus.h / 2;
      scale = Math.min(Math.max(H / 1080, 0.72), 1.2);

      views = STOPS.map((s) => viewFor(isMobile && s.fitMobile ? s.fitMobile : s.fit, focus, W, MAX_ZOOM));
      flights = views.map((v, i) => (i === 0 ? () => v : interpolateView(views[i - 1], v)));
      boardSize = PLANTS.map((_, i) => ({ w: boardRefs.current[i]?.offsetWidth ?? 0, h: boardRefs.current[i]?.offsetHeight ?? 0 }));
      layoutVersion++;
    };
    layout();
    const resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(stage);
    void document.fonts?.ready.then(layout);

    // ---- the parts of each group of words, collected once
    const groupParts = GROUPS.map((g, idx) => {
      const el = groupRefs.current[idx];
      return {
        el,
        rises: el ? Array.from(el.querySelectorAll<HTMLElement>("[data-part='rise']")) : [],
        sentences: el ? Array.from(el.querySelectorAll<HTMLElement>("[data-sentence]")) : [],
      };
    });

    const plantFrame: PaintPlant[] = PLANTS.map((p) => ({ x: 0, y: 0, lit: 0, pulse: 0, focus: 0, retooling: p.status === "retooling" }));
    const plateState: string[] = STATE_STOPS.map(() => "");
    let shownName = "";

    // ---- one frame
    const render = (p: number, cover: number) => {
      if (!W || !H) return;
      const loc = locate(p);
      let view = loc.stop === 0 ? views[0] : flights[loc.stop](flightEase(loc.fly));
      if (!reduced && loc.stop > 0 && loc.fly >= 1) {
        // While it holds, the camera drifts in a little and settles back: still, but alive.
        view = { x: view.x, y: view.y, w: view.w * (1 - 0.03 * Math.sin(Math.PI * loc.hold)) };
      }
      const z = W / view.w;

      // The plants: where they are on the stage, and how lit.
      const stateLit: Record<string, number> = {};
      PLANTS.forEach((plant, i) => {
        const f = plantFrame[i];
        f.x = (plant.xy[0] - view.x) * z + fcx;
        f.y = (plant.xy[1] - view.y) * z + fcy;
        f.lit = smoothstep(BEAT_TIME[i] - 0.01, BEAT_TIME[i] + 0.012, p);
        const sincePulse = (p - BEAT_TIME[i]) / 0.03;
        f.pulse = sincePulse <= 0 ? 0 : clamp01(sincePulse);
        stateLit[plant.state] = Math.max(stateLit[plant.state] ?? PREVIEW_LIT, f.lit);
      });

      // The groups of words: which is on screen, and the state it is about.
      const stateFocus: Record<string, number> = {};
      let activeGroup = -1;
      let activeWeight = 0;
      GROUPS.forEach((g, idx) => {
        const parts = groupParts[idx];
        const el = parts.el;
        if (!el) return;
        const intro = g.stop === 0;
        const inT = intro ? smoothstep(0.35, 0.9, cover) : clamp01((p - g.gs) / 0.03);
        const outT = clamp01((p - (g.ge - 0.016)) / 0.016);
        const alpha = inT > 0 ? 1 - easeOutCubic(outT) : 0;
        if (alpha < 0.002) {
          if (el.style.visibility !== "hidden") {
            el.style.visibility = "hidden";
            el.style.opacity = "0";
          }
          return;
        }
        el.style.visibility = "visible";
        el.style.opacity = String(alpha);
        el.style.transform = reduced || outT === 0 ? "" : `translate3d(0,${(-18 * easeOutCubic(outT)).toFixed(1)}px,0)`;
        parts.rises.forEach((r, k) => {
          const e = easeOutCubic(clamp01(inT * 1.3 - k * 0.25));
          r.style.transform = reduced ? "none" : `translate3d(0,${((1 - e) * 108).toFixed(1)}%,0)`;
          r.style.opacity = reduced ? String(e) : "1";
        });
        parts.sentences.forEach((s, k) => {
          const start = g.sentenceStarts[k];
          const end = k + 1 < g.sentenceStarts.length ? g.sentenceStarts[k + 1] : Infinity;
          const sIn = intro ? smoothstep(0.55, 0.95, cover) : clamp01((p - start) / 0.025);
          const sOut = clamp01((p - (end - 0.02)) / 0.02);
          const e = easeOutCubic(sIn) * (1 - sOut);
          s.style.opacity = String(e);
          s.style.transform = reduced ? "none" : `translate3d(0,${((1 - easeOutCubic(sIn)) * 14).toFixed(1)}px,0)`;
        });
        if (g.state) {
          stateFocus[g.state] = Math.max(stateFocus[g.state] ?? 0, smoothstep(0, 1, alpha));
          if (alpha > activeWeight) {
            activeWeight = alpha;
            activeGroup = idx;
          }
        }
      });

      // The boards, and the leaders from them to their plants.
      PLANTS.forEach((plant, i) => {
        const board = boardRefs.current[i];
        const leader = leaderRefs.current[i];
        const f = plantFrame[i];
        if (!board) return;
        // On a phone one board at a time, docked; on a desktop they stay until the
        // stop is over.
        const outAt = isMobile ? BEAT_NEXT[i] : BEAT_END[i];
        const inT = clamp01((p - BEAT_TIME[i]) / 0.02);
        const outT = clamp01((p - (outAt - 0.016)) / 0.016);
        const alpha = easeOutCubic(inT) * (1 - outT);
        f.focus = alpha;
        if (alpha < 0.003) {
          if (board.style.visibility !== "hidden") {
            board.style.visibility = "hidden";
            board.style.opacity = "0";
            if (leader) leader.style.opacity = "0";
          }
          return;
        }
        const size = boardSize[i];
        let bx: number;
        let by: number;
        if (isMobile) {
          bx = 20;
          by = H * 0.875 - size.h;
          if (leader) leader.style.opacity = "0";
        } else {
          const hang = HANG[plant.id];
          const ax = f.x + hang.dx * scale;
          const ay = f.y + hang.dy * scale;
          bx = hang.corner.endsWith("r") ? ax - size.w : ax;
          by = hang.corner.startsWith("b") ? ay - size.h : ay;
          if (leader) {
            // The leader starts a little off the marker, and is drawn on as the board arrives.
            const dx = ax - f.x;
            const dy = ay - f.y;
            const len = Math.hypot(dx, dy) || 1;
            const x1 = f.x + (dx / len) * 9;
            const y1 = f.y + (dy / len) * 9;
            const grow = reduced ? 1 : easeOutCubic(clamp01(inT * 1.25));
            leader.setAttribute("x1", x1.toFixed(1));
            leader.setAttribute("y1", y1.toFixed(1));
            leader.setAttribute("x2", (x1 + (ax - x1) * grow).toFixed(1));
            leader.setAttribute("y2", (y1 + (ay - y1) * grow).toFixed(1));
            leader.style.opacity = String(alpha);
          }
        }
        board.style.visibility = "visible";
        board.style.opacity = String(alpha);
        const rise = reduced ? 0 : (1 - easeOutCubic(inT)) * 10;
        board.style.transform = `translate3d(${bx.toFixed(1)}px,${(by + rise).toFixed(1)}px,0)`;
      });

      painter.paint({
        view,
        width: W,
        height: H,
        focusX: fcx,
        focusY: fcy,
        stateLit,
        stateFocus,
        plants: plantFrame,
        reduced,
      });

      // ---- the state tracker
      const track = trackRef.current;
      if (track) {
        const show = smoothstep(SEGMENTS[1].flyStart + 0.02, SEGMENTS[1].holdStart, p);
        track.style.opacity = String(show);
        track.style.visibility = show < 0.002 ? "hidden" : "visible";
        track.style.pointerEvents = show > 0.6 ? "auto" : "none";
        const activeState = activeGroup >= 0 ? GROUPS[activeGroup].state : undefined;
        STATE_STOPS.forEach((s, i) => {
          const started = p >= groupStart(s.stop, s.group) - 0.002;
          const state = s.state === activeState ? "active" : started ? "done" : "todo";
          if (plateState[i] !== state) {
            plateState[i] = state;
            plateRefs.current[i]?.setAttribute("data-state", state);
          }
          const bar = barRefs.current[i];
          if (bar) bar.style.transform = `scaleX(${state === "todo" ? 0 : 1})`;
        });
        const label = activeState ?? (p >= SEGMENTS[SEGMENTS.length - 1].flyStart ? STATE_STOPS[STATE_STOPS.length - 1].state : STATE_STOPS[0].state);
        if (nameRef.current && label !== shownName) {
          shownName = label;
          nameRef.current.textContent = STATE_NAMES[label];
        }
      }

      if (noteRef.current) noteRef.current.style.opacity = String(smoothstep(0.7, 1, cover));

      // The nav joins the page as the map arrives; until then the hero’s own is the only one.
      if (navRef.current) {
        const nav = smoothstep(0.82, 1, cover);
        navRef.current.style.opacity = String(nav);
        navRef.current.style.visibility = nav < 0.02 ? "hidden" : "visible";
      }
    };

    // ---- the scroll: the cover (the map rising over the plant), then the tour
    const toStage = (self: ScrollTrigger) => {
      scrollState.cover5 = self.progress;
      // Once the map covers the 3D stage completely, the canvas behind it stops drawing.
      setStageLive(self.progress < 0.997);
    };
    const cover = ScrollTrigger.create({
      trigger: wrapper,
      start: "top bottom",
      end: "top top",
      invalidateOnRefresh: true,
      onUpdate: toStage,
      onRefresh: toStage,
    });
    const tour = ScrollTrigger.create({
      trigger: wrapper,
      start: "top top",
      end: () => `+=${window.innerHeight * MAP_VH}`,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        scrollState.map = self.progress;
      },
      onRefresh: (self) => {
        scrollState.map = self.progress;
      },
    });

    // Only draw while the section is near the screen.
    let near = false;
    const nearTrigger = ScrollTrigger.create({
      trigger: wrapper,
      start: "top bottom+=60%",
      end: "bottom top-=60%",
      onToggle: (self) => {
        near = self.isActive;
      },
      onRefresh: (self) => {
        near = self.isActive;
      },
    });

    let raf = 0;
    let lastKey = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // The road finder covers this section completely at the end: nothing to draw then.
      if (!near || scrollState.cover6 > 0.997) return;
      const p = scrollState.map;
      const c = scrollState.cover5;
      const key = `${p.toFixed(5)}|${c.toFixed(4)}|${layoutVersion}`;
      if (key === lastKey) return;
      lastKey = key;
      render(p, c);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      cover.kill();
      tour.kill();
      nearTrigger.kill();
    };
  }, [isMobile]);

  // Where a state's plate takes the visitor: the start of that state's words.
  const goTo = (i: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const s = STATE_STOPS[i];
    const top = wrapper.getBoundingClientRect().top + window.scrollY;
    const target = groupStart(s.stop, s.group) + 0.03;
    scrollToY(top + target * MAP_VH * window.innerHeight);
  };

  return (
    <section
      ref={wrapperRef}
      id="plants"
      aria-label="Where Ford builds in the United States"
      data-vh={MAP_VH.toFixed(3)}
      className="relative"
      style={{
        // The tour, then the stage holds its closing frame for HOLD_VH while the road finder
        // rises over it for COVER_VH.
        height: `${(1 + MAP_VH + HOLD_VH + COVER_VH) * 100}vh`,
        marginTop: `-${COVER_VH * 100}vh`,
        zIndex: SECTION_Z.map,
        backgroundColor: GROUND,
      }}
    >
      {/* The shadow the rising edge throws on the stage it is covering. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-full h-[28vh]"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0))" }}
      />

      <div ref={stageRef} className="sticky top-0 h-dvh w-full overflow-hidden" style={STAGE_VARS}>
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: GRAIN }} />

        <p className="sr-only">
          Ford assembles its vehicles in the United States at seven plants in five states, and a further plant is being retooled.
          {PLANTS.map((p) => ` ${p.name}, ${p.city}, ${STATE_NAMES[p.state]}: ${p.models.join(", ")}.`).join("")} Source: {PLANTS_SOURCE},{" "}
          {PLANTS_AS_OF}.
        </p>

        {/* Leaders, from each marker to its board. */}
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          {PLANTS.map((p, i) => (
            <line
              key={p.id}
              ref={(el) => {
                leaderRefs.current[i] = el;
              }}
              stroke="rgba(235,241,255,0.78)"
              strokeWidth={1}
              style={{ opacity: 0 }}
            />
          ))}
        </svg>

        {/* The boards: what the hall's wall boards were, on the map. Each is cut to its text. */}
        {PLANTS.map((p, i) => (
          <div
            key={p.id}
            ref={(el) => {
              boardRefs.current[i] = el;
            }}
            data-plant={p.id}
            className="invisible absolute left-0 top-0 w-max max-w-[min(30vw,380px)] overflow-hidden rounded-[4px] bg-[#070b16] opacity-0 shadow-[0_22px_50px_-22px_rgba(0,0,0,0.95),inset_0_0_0_1px_rgba(190,205,255,0.14)] will-change-transform max-md:w-[calc(100%-40px)] max-md:max-w-none"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-[6px] bg-ford-grabber" />
            <div className="flex flex-col gap-[0.4em] py-[clamp(12px,1vw,18px)] pl-[clamp(20px,1.6vw,28px)] pr-[clamp(18px,1.5vw,28px)]">
              <span className="font-plant-display text-[clamp(24px,2vw,40px)] font-semibold uppercase leading-[0.95] tracking-[0.005em] text-white">
                {p.title}
              </span>
              <span className="max-w-[28ch] text-balance font-plant-text text-[clamp(14px,1.02vw,18px)] font-semibold leading-[1.3] text-white/90">
                <NoBreak text={p.models.join(", ")} />
              </span>
              {!p.cityInTitle && (
                <span className="font-plant-text text-[clamp(12.5px,0.88vw,15px)] font-medium leading-tight text-[#8f9dc6]">
                  {p.city}, {STATE_NAMES[p.state]}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* The words. One group at a time, in the same place; a stop with two states
            swaps its group when the camera has nothing to move for. */}
        {GROUPS.map((g, idx) => {
          const group = STOPS[g.stop].groups[g.g];
          const intro = g.stop === 0;
          const Tag = intro ? "h2" : "h3";
          return (
            <div
              key={`${g.stop}-${g.g}`}
              ref={(el) => {
                groupRefs.current[idx] = el;
              }}
              className={`invisible absolute inset-x-6 top-[11.5%] opacity-0 md:inset-x-auto md:left-[var(--gutter)] md:top-[27%] ${intro ? "md:w-[min(34vw,660px)]" : "md:w-[min(31vw,540px)]"}`}
            >
              <div className="flex flex-col gap-4 md:gap-6">
                <Tag className={`${HEADING} ${intro ? "text-[clamp(44px,5.3vw,104px)]" : "text-[clamp(42px,4.7vw,88px)]"}`}>
                  {group.heading.map((line) => (
                    <Rise key={line}>{line}</Rise>
                  ))}
                </Tag>
                <div className="grid">
                  {group.sentences.map((s, k) =>
                    s.wall ? (
                      <ul
                        key={k}
                        data-sentence={k}
                        className="flex list-none flex-wrap gap-x-[0.7em] gap-y-[0.1em] font-plant-display text-[clamp(21px,1.75vw,32px)] font-semibold uppercase leading-[1.12] tracking-[0.01em] text-white/90 opacity-0 [grid-area:1/1] [text-shadow:0_1px_18px_rgba(0,4,12,0.9)] max-md:text-[19px]"
                      >
                        {s.wall.map((name) => (
                          <li key={name} className="whitespace-nowrap">
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p key={k} data-sentence={k} className={`${SENTENCE} max-w-[31ch] opacity-0 [grid-area:1/1]`}>
                        {s.text}
                      </p>
                    ),
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* The states, as plates: the one the tour is in is white, those it has been to are lit. */}
        <div ref={trackRef} className="invisible absolute inset-x-0 bottom-[4.5%] flex justify-center px-4 opacity-0">
          <ol className="hidden overflow-hidden rounded-[4px] bg-[rgba(6,9,15,0.9)] shadow-[0_0_0_1px_rgba(255,255,255,0.14)] md:flex">
            {STATE_STOPS.map((s, i) => (
              <li key={s.state} className="border-l border-white/10 first:border-l-0">
                <button
                  type="button"
                  ref={(el) => {
                    plateRefs.current[i] = el;
                  }}
                  data-state="todo"
                  data-cursor-hover
                  onClick={() => goTo(i)}
                  className={`${PLATE_LABEL} group relative flex h-11 items-center whitespace-nowrap px-[clamp(14px,1.3vw,24px)] text-white/60 outline-none transition-colors duration-200 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white data-[state=active]:bg-white data-[state=active]:text-[#0a0f18] data-[state=done]:bg-white/[0.14] data-[state=done]:text-white`}
                >
                  {STATE_NAMES[s.state]}
                  <span
                    aria-hidden
                    ref={(el) => {
                      barRefs.current[i] = el;
                    }}
                    className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-ford-grabber transition-transform duration-300 group-data-[state=active]:bg-ford-grabber"
                    style={{ transform: "scaleX(0)" }}
                  />
                </button>
              </li>
            ))}
          </ol>
          <div className="flex w-[min(92vw,420px)] items-center justify-between rounded-[4px] bg-[rgba(6,9,15,0.9)] px-4 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.14)] md:hidden">
            <span ref={nameRef} className={`${PLATE_LABEL} text-white`}>
              {STATE_NAMES[STATE_STOPS[0].state]}
            </span>
          </div>
        </div>

        <div ref={noteRef} className="absolute bottom-[1.6%] left-6 right-6 text-center opacity-0 md:bottom-[4.8%] md:left-[var(--gutter)] md:right-auto md:max-w-[26vw] md:text-left">
          <span className="font-plant-text text-[11.5px] font-medium leading-snug tracking-[0.02em] text-white/70">
            Plants and models: Ford, {PLANTS_SOURCE}, {PLANTS_AS_OF}.
          </span>
        </div>

        {/* The nav stays with the page: the hero's own is covered by now. */}
        <div ref={navRef} className="invisible absolute inset-x-0 top-0 z-10 opacity-0">
          <Navbar />
        </div>
      </div>
    </section>
  );
}
