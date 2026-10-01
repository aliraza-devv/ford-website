"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { LAYOUT } from "@/config/composition";
import { COVER_VH, SECTION_Z } from "@/config/sections";
import {
  CLOSE_LINKS,
  FIGURES_AS_OF,
  FIGURES_NOTE,
  FIGURES_SOURCE,
  FIND_VH,
  ROADS,
  dwellCenter,
  roadState,
  type CarSprite,
  type Figure,
} from "@/config/roads";
import { clamp01, easeOutCubic, smoothstep } from "@/lib/ease";
import { scrollState } from "@/lib/scrollState";
import { scrollToY } from "@/lib/lenisInstance";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Navbar } from "@/components/hero/Navbar";
import { HEADING, Rise, SENTENCE } from "@/components/signage";
import { GEO, PANO, SCENES, SKY, TILE, layerWidth, sceneCenter, type PanoLayer } from "./panorama";
import { PanoramaPainter } from "./painterClient";

gsap.registerPlugin(ScrollTrigger);

/**
 * Section 6: find your Ford. One road runs through four places, and the page scrolls the
 * camera along it: sideways, smoothly, with the landscape changing under the same
 * light as it goes. Each place has the Ford that belongs on it standing in the road.
 *
 * Like the map, it is a pure function of one scroll number (`scrollState.find`, through
 * the timeline in config/roads), written to the DOM from one loop that only works when
 * that number has changed. All that moves is transforms (each layer slides at its own
 * speed, which is the depth) and opacities (the skies change over, the words swap).
 * Nothing on screen is laid out or painted while the page scrolls.
 *
 * The world itself (./panorama) is painted in a worker, well before the section is
 * reached, and the cars are baked sprites (public/scenes), so the section costs a few
 * layers of compositing and nothing else.
 */

const GROUND = "#03060d";

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27180%27 height=%27180%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.85%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix values=%270 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1.6 -0.45%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E\")";

/**
 * The poster's name is as big as the stage's width allows and no bigger than its height
 * does, and everything under it hangs from where its baseline ends. So the facts and the
 * plates can never reach up into the lettering, whatever shape the window is.
 */
const STAGE_VARS = {
  ["--gutter" as string]: `${LAYOUT.sideGutter * 100}%`,
  ["--name-size" as string]: "min(21.5vw, 36dvh)",
  ["--name-top" as string]: "10.5dvh",
  ["--band-top" as string]: "calc(var(--name-top) + var(--name-size) * 0.82 + max(4.6dvh, 38px))",
};
const STAGE_VARS_PHONE = {
  ["--gutter" as string]: `${LAYOUT.sideGutter * 100}%`,
  ["--name-size" as string]: "min(25vw, 11.5dvh)",
  ["--name-top" as string]: "10.5dvh",
  ["--band-top" as string]: "calc(var(--name-top) + var(--name-size) * 0.82 + 3dvh)",
};

const SIZE = {
  lead: { numeral: "text-[clamp(64px,5.2vw,104px)] max-md:text-[40px]", unit: "text-[clamp(26px,2.1vw,42px)] max-md:text-[17px]" },
  pair: { numeral: "text-[clamp(34px,2.5vw,50px)] max-md:text-[40px]", unit: "text-[clamp(16px,1.15vw,22px)] max-md:text-[17px]" },
} as const;

/** One figure: the numeral and its unit, and the caption under them. */
function FigureView({ f, size }: { f: Figure; size: keyof typeof SIZE }) {
  const s = SIZE[size];
  return (
    <div className="flex flex-col gap-[0.5em] text-[clamp(13px,0.9vw,16px)] max-md:text-[12px]">
      <span className="sr-only">{`${f.figure} ${f.unit}, ${f.caption}`}</span>
      <span aria-hidden className="block overflow-hidden pb-[0.06em]">
        <span data-part="rise" className="flex items-baseline gap-[0.22em]" style={{ transform: "translate3d(0,108%,0)" }}>
          <span className={`font-plant-display font-semibold leading-[0.9] tracking-[-0.005em] text-white tabular-nums ${s.numeral}`}>{f.figure}</span>
          <span className={`whitespace-nowrap font-plant-display font-medium leading-none text-white/80 ${s.unit}`}>{f.unit}</span>
        </span>
      </span>
      <span aria-hidden data-part="fade" className="text-pretty font-plant-text font-medium leading-tight text-white/70 opacity-0 max-md:text-[11.5px]">
        {f.caption}
      </span>
    </div>
  );
}

const BUTTON =
  "inline-flex h-12 items-center whitespace-nowrap rounded-[4px] px-7 font-plant-text text-[13px] font-semibold uppercase tracking-[0.14em] transition-[background-color,color,transform] duration-200 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** The words slide this far (px) as the camera moves from one road to the next. */
const TEXT_SLIDE = 90;

/** A car is drawn at the world's scale, but never wider than this much of the stage: on a wide
 * screen so the facts and the plates beside it keep clear, on a phone (where they are above and
 * below it) so it is not a speck. */
const CAR_MAX_W = 0.44;
const CAR_MAX_W_PHONE = 0.8;

/** The shadow on the road under a car: soft ellipses, each as wide as this much of the car, as
 * flat as this (their height over their width), and as dark as this at the middle. */
const SHADOWS = [
  [0.62, 0.075, 0.5],
  [0.46, 0.035, 0.75],
] as const;

/** At the close the last car pulls forward this much of the stage's width, to stand on the right,
 * clear of the words. */
const CLOSE_SHIFT = 0.19;

/** What the close puts over the world so its words read: heavy where they are, almost nothing
 * where the car stands. */
const DIM_WIDE = "linear-gradient(to right, rgba(2,4,10,0.74) 0%, rgba(2,4,10,0.6) 34%, rgba(2,4,10,0.2) 66%, rgba(2,4,10,0.08) 100%)";
const DIM_PHONE = "rgba(2,4,10,0.55)";

type CarEls = { group: HTMLDivElement; img: HTMLImageElement; shadows: HTMLDivElement[] };

export function FindYourFord() {
  const isMobile = useIsMobile();
  const wrapperRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLDivElement>(null);
  const trackRefs = useRef<Record<PanoLayer, HTMLDivElement | null>>({ mid: null, road: null, fore: null });
  const namesRef = useRef<HTMLDivElement>(null);
  const nameRefs = useRef<(HTMLDivElement | null)[]>([]);
  const carHostRef = useRef<HTMLDivElement>(null);
  const factRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dealRefs = useRef<(HTMLDivElement | null)[]>([]);
  const matcherRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = useRef(0);
  const placed = useRef(false);

  // The sliding plate behind the active road's label: one element, moved to sit behind
  // the active button (transform only), measured so it is right in the 2 x 2 grid on a
  // desktop and in the single row on a phone alike.
  const placePlate = (animate: boolean) => {
    const button = buttonRefs.current[activeIndex.current];
    const plate = highlightRef.current;
    if (!button || !plate) return;
    plate.style.width = `${button.offsetWidth}px`;
    plate.style.height = `${button.offsetHeight}px`;
    if (!animate || !placed.current) {
      plate.style.transition = "none";
      plate.style.transform = `translate3d(${button.offsetLeft}px, ${button.offsetTop}px, 0)`;
      void plate.offsetWidth;
      plate.style.transition = "";
      placed.current = true;
    } else {
      plate.style.transform = `translate3d(${button.offsetLeft}px, ${button.offsetTop}px, 0)`;
    }
  };

  useLayoutEffect(() => {
    placePlate(false);
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(() => placePlate(false));
    observer.observe(grid);
    return () => observer.disconnect();
  }, [isMobile]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const stage = stageRef.current;
    const skyBox = skyRef.current;
    const carHost = carHostRef.current;
    const tracks = trackRefs.current;
    if (!wrapper || !stage || !skyBox || !carHost || !tracks.mid || !tracks.road || !tracks.fore) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const painter = new PanoramaPainter();

    let W = 0;
    let H = 0;
    let layoutVersion = 0;
    let lastKey = "";

    // ---- the painted world: canvases that fill in as the worker delivers them
    const skyCanvases: HTMLCanvasElement[] = [];
    const tileCanvases: { el: HTMLCanvasElement }[] = [];
    const carEls: (CarEls | null)[] = [];
    /** Where each car's group sits (px, in the road layer) before the close moves the last one. */
    const carBase: number[] = [];
    let carShift = 0;

    const makeCanvas = (parent: HTMLElement) => {
      const c = document.createElement("canvas");
      c.setAttribute("aria-hidden", "true");
      c.style.position = "absolute";
      c.style.opacity = "0";
      parent.appendChild(c);
      return c;
    };
    for (let i = 0; i < SCENES; i++) {
      const c = makeCanvas(skyBox);
      c.style.top = "0";
      skyCanvases.push(c);
    }

    // The cars: sprites that stand in the road, each with the shadow it casts on it.
    ROADS.forEach((road) => {
      if (!road.car) {
        carEls.push(null);
        return;
      }
      const group = document.createElement("div");
      group.style.position = "absolute";
      group.style.left = "0";
      group.style.top = "0";
      group.style.willChange = "transform";
      const shadows = SHADOWS.map(([, , a]) => {
        const shadow = document.createElement("div");
        shadow.style.position = "absolute";
        shadow.style.left = "0";
        shadow.style.top = "0";
        shadow.style.opacity = "0";
        shadow.style.transition = "opacity 700ms ease";
        shadow.style.background = `radial-gradient(closest-side, rgba(0,0,0,${a}) 0%, rgba(0,0,0,${(a * 0.4).toFixed(2)}) 70%, rgba(0,0,0,0) 100%)`;
        group.appendChild(shadow);
        return shadow;
      });
      const img = document.createElement("img");
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.decoding = "async";
      img.draggable = false;
      img.src = road.car.src;
      img.style.position = "absolute";
      img.style.left = "0";
      img.style.top = "0";
      img.style.maxWidth = "none";
      img.style.opacity = "0";
      img.style.transition = "opacity 700ms ease";
      img.style.userSelect = "none";
      img.onload = () => {
        img.style.opacity = "1";
        shadows.forEach((shadow) => {
          shadow.style.opacity = "1";
        });
      };
      group.appendChild(img);
      carHost.appendChild(group);
      carEls.push({ group, img, shadows });
    });

    /** How the sprite is scaled to the stage: to the world's own scale, but never wider than
     * CAR_MAX_W of the stage. */
    const carScale = (car: CarSprite) => Math.min(H / 1080 / car.density, ((isMobile ? CAR_MAX_W_PHONE : CAR_MAX_W) * W) / car.span);

    const layout = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h || (w === W && h === H)) return;
      W = w;
      H = h;
      layoutVersion++;
      lastKey = "";
      painter.reset();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const density = (cssPixels: number, k: number) => {
        let kk = k;
        while (cssPixels * kk * kk > 3.4e6 && kk > 0.4) kk -= 0.05;
        return kk;
      };

      // the four skies, each a little wider than the stage
      const skyW = W * (1 + 2 * SKY.pad);
      skyCanvases.forEach((c, i) => {
        c.dataset.ready = "";
        c.style.left = `${-SKY.pad * W}px`;
        c.style.width = `${skyW}px`;
        c.style.height = `${H}px`;
        painter.sky({ scene: i, w: W, h: H, k: density(skyW * H, SKY.scale * dpr) }, (img, pw, ph) => {
          c.width = pw;
          c.height = ph;
          c.getContext("2d")?.drawImage(img, 0, 0);
          c.dataset.ready = "1";
          lastKey = "";
        });
      });

      // the road's tiles first (the cars stand on them), then the middle ground, then the foreground
      for (const t of tileCanvases) t.el.remove();
      tileCanvases.length = 0;
      const order: PanoLayer[] = ["road", "mid", "fore"];
      for (const layer of order) {
        const spec = PANO[layer];
        const track = tracks[layer]!;
        const lw = layerWidth(layer, W) + 0.12 * W;
        const top = spec.top * H;
        const height = spec.height * H;
        track.style.top = `${top}px`;
        track.style.width = `${lw}px`;
        track.style.height = `${height}px`;
        const tileW = Math.round(TILE * W);
        const count = Math.ceil(lw / tileW);
        const k = density(tileW * height, spec.scale * dpr);
        for (let t = 0; t < count; t++) {
          const x0 = t * tileW;
          const x1 = Math.min(lw, x0 + tileW + 2);
          const el = makeCanvas(track);
          el.style.transition = "opacity 700ms ease";
          el.style.left = `${x0}px`;
          el.style.top = "0";
          el.style.width = `${x1 - x0}px`;
          el.style.height = `${height}px`;
          tileCanvases.push({ el });
          painter.tile({ job: { layer, w: W, h: H, x0, x1 }, top, height, k }, (img, pw, ph) => {
            el.width = pw;
            el.height = ph;
            el.getContext("2d")?.drawImage(img, 0, 0);
            el.style.opacity = "1";
          });
        }
      }

      // the names, one to a place, centred on it
      nameRefs.current.forEach((el, i) => {
        if (el) el.style.left = `${sceneCenter("road", i, W)}px`;
      });

      // the cars, standing on the road with the horizon of their picture on the world's
      ROADS.forEach((road, i) => {
        const els = carEls[i];
        const car = road.car;
        if (!els || !car) return;
        const s = carScale(car);
        const cw = car.width * s;
        const spanW = car.span * s;
        const cx = cw * car.centre; // the car's middle in its picture
        els.img.style.width = `${cw}px`;
        els.img.style.height = `${car.height * s}px`;
        // Its tyres on the line the road is painted for, at any scale: shrunk to fit a narrow stage, a car
        // placed by its horizon would climb toward the horizon and float above the road.
        els.img.style.transform = `translate3d(0, ${H * GEO.contact - car.contact * s}px, 0)`;
        // the shadow, centred under the car a little below where its tyres touch
        const cy = H * GEO.contact + (6 * H) / 1080;
        SHADOWS.forEach(([rxK, ry], k) => {
          const rx = spanW * rxK;
          const shadow = els.shadows[k];
          shadow.style.width = `${2 * rx}px`;
          shadow.style.height = `${2 * rx * ry}px`;
          shadow.style.transform = `translate3d(${cx - rx}px, ${cy - rx * ry}px, 0)`;
        });
        carBase[i] = sceneCenter("road", i, W) - cx;
        els.group.style.transform = `translate3d(${carBase[i] + (i === ROADS.length - 1 ? carShift : 0)}px, 0, 0)`;
      });
    };
    layout();
    const resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(stage);

    // ---- the parts of each block, collected once
    const partsOf = (el: HTMLElement | null) => ({
      rises: el ? Array.from(el.querySelectorAll<HTMLElement>("[data-part='rise']")) : [],
      fades: el ? Array.from(el.querySelectorAll<HTMLElement>("[data-part='fade']")) : [],
    });
    const factParts = ROADS.map((_, i) => partsOf(factRefs.current[i]));
    const dealParts = ROADS.map((_, i) => partsOf(dealRefs.current[i]));
    const closeParts = partsOf(closeRef.current);

    /** Shows a block at `alpha`, shifted `dx` px sideways; `rise` (0-1) is how far its
     * numerals have risen out of their masks. */
    const setBlock = (el: HTMLElement | null, parts: ReturnType<typeof partsOf>, alpha: number, dx: number, rise: number) => {
      if (!el) return;
      if (alpha < 0.003) {
        if (el.style.visibility !== "hidden") {
          el.style.visibility = "hidden";
          el.style.opacity = "0";
        }
        return;
      }
      el.style.visibility = "visible";
      el.style.opacity = String(Math.min(1, alpha));
      el.style.transform = reduced || dx === 0 ? "" : `translate3d(${dx.toFixed(1)}px,0,0)`;
      const n = Math.max(parts.rises.length, 1);
      parts.rises.forEach((r, k) => {
        const e = easeOutCubic(clamp01(rise * 1.2 - (k / n) * 0.35));
        r.style.transform = reduced ? "none" : `translate3d(0,${((1 - e) * 108).toFixed(1)}%,0)`;
        r.style.opacity = reduced ? String(e) : "1";
      });
      parts.fades.forEach((f, k) => {
        const e = easeOutCubic(clamp01(rise * 1.1 - 0.15 - (k / Math.max(parts.fades.length, 1)) * 0.3));
        f.style.opacity = String(e);
        f.style.transform = reduced ? "none" : `translate3d(0,${((1 - e) * 12).toFixed(1)}px,0)`;
      });
    };

    // ---- one frame
    const render = (q: number, cover: number) => {
      if (!W || !H) return;
      const st = roadState(q);
      const moving = st.from !== st.to;
      // With reduced motion there is no travelling: the camera cuts from place to place.
      const pos = reduced && moving ? (st.u < 0.5 ? st.from : st.to) : st.pos;

      // The skies change over as the camera passes between places: the later sky comes up
      // over the earlier one, and the one beneath never dips, so the light changes
      // without a moment of dark.
      const skyShift = `translate3d(${(-pos * W * SKY.m).toFixed(1)}px,0,0)`;
      skyCanvases.forEach((c, i) => {
        const a = i === 0 ? 1 : smoothstep(0, 1, pos - (i - 1));
        const ready = c.dataset.ready === "1";
        c.style.opacity = ready ? String(a) : "0";
        c.style.visibility = ready && a > 0.002 ? "visible" : "hidden";
        c.style.transform = skyShift;
      });

      // Every layer slides at its own speed: that difference is the depth.
      const road = `translate3d(${(-pos * W * PANO.road.m).toFixed(1)}px,0,0)`;
      tracks.mid!.style.transform = `translate3d(${(-pos * W * PANO.mid.m).toFixed(1)}px,0,0)`;
      tracks.road!.style.transform = road;
      tracks.fore!.style.transform = `translate3d(${(-pos * W * PANO.fore.m).toFixed(1)}px,0,0)`;
      carHost.style.transform = road;
      const names = namesRef.current;
      const reveal = smoothstep(0.45, 0.95, cover);
      const reveal2 = smoothstep(0.7, 1, cover);
      const closeT = st.close;

      // The close: the last car pulls forward, to the right of the stage, as the words come in.
      const lastCar = carEls[ROADS.length - 1];
      if (lastCar) {
        const k = isMobile ? 0 : reduced ? (closeT > 0.5 ? 1 : 0) : smoothstep(0.2, 1, closeT);
        const shift = W * CLOSE_SHIFT * k;
        if (Math.abs(shift - carShift) > 0.05) {
          carShift = shift;
          lastCar.group.style.transform = `translate3d(${(carBase[ROADS.length - 1] ?? 0) + shift}px, 0, 0)`;
        }
      }
      if (names) {
        names.style.transform = road;
        names.style.opacity = String(reveal * (1 - smoothstep(0, 0.4, closeT)));
      }

      // The matcher: facts on the left, the plates and the way in on the right. The
      // words of one place slide away with the camera and the next place's arrive.
      const matcher = 1 - smoothstep(0, 0.45, closeT);
      ROADS.forEach((_, s) => {
        let a = 0;
        let dx = 0;
        if (!moving) a = s === st.from ? 1 : 0;
        else if (s === st.from) {
          const t = smoothstep(0, 0.42, st.u);
          a = 1 - t;
          dx = -t * TEXT_SLIDE;
        } else if (s === st.to) {
          const t = smoothstep(0.58, 1, st.u);
          a = t;
          dx = (1 - t) * TEXT_SLIDE;
        }
        a *= matcher * (s === 0 ? reveal2 : 1);
        const rise = s === 0 ? reveal2 : 1;
        setBlock(factRefs.current[s], factParts[s], a, dx, rise);
        setBlock(dealRefs.current[s], dealParts[s], a, dx, rise);
        const deal = dealRefs.current[s];
        if (deal) deal.style.pointerEvents = a > 0.6 ? "auto" : "none";
      });
      const matcherEl = matcherRef.current;
      if (matcherEl) {
        matcherEl.style.opacity = String(matcher * reveal2);
        matcherEl.style.visibility = matcher * reveal2 < 0.003 ? "hidden" : "visible";
        matcherEl.style.pointerEvents = matcher * reveal2 > 0.6 ? "auto" : "none";
      }

      // The plate follows the road we are at.
      const idx = moving && st.u >= 0.5 ? st.to : st.from;
      if (idx !== activeIndex.current) {
        activeIndex.current = idx;
        buttonRefs.current.forEach((b, i) => {
          b?.setAttribute("aria-pressed", String(i === idx));
          b?.setAttribute("data-active", String(i === idx));
        });
        placePlate(true);
      }

      // The close.
      const closeA = smoothstep(0.35, 0.8, closeT);
      setBlock(closeRef.current, closeParts, closeA, 0, closeA);
      if (closeRef.current) closeRef.current.style.pointerEvents = closeA > 0.6 ? "auto" : "none";
      if (dimRef.current) dimRef.current.style.opacity = String(smoothstep(0, 0.6, closeT));
      if (noteRef.current) noteRef.current.style.opacity = String(smoothstep(0.7, 1, cover));
      if (navRef.current) {
        const nav = smoothstep(0.82, 1, cover);
        navRef.current.style.opacity = String(nav);
        navRef.current.style.visibility = nav < 0.02 ? "hidden" : "visible";
      }
    };

    // ---- the scroll: the cover (rising over the map), then the finder
    const cover = ScrollTrigger.create({
      trigger: wrapper,
      start: "top bottom",
      end: "top top",
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        scrollState.cover6 = self.progress;
      },
      onRefresh: (self) => {
        scrollState.cover6 = self.progress;
      },
    });
    const finder = ScrollTrigger.create({
      trigger: wrapper,
      start: "top top",
      end: () => `+=${window.innerHeight * FIND_VH}`,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        scrollState.find = self.progress;
      },
      onRefresh: (self) => {
        scrollState.find = self.progress;
      },
    });

    let near = false;
    const nearTrigger = ScrollTrigger.create({
      trigger: wrapper,
      start: "top bottom+=40%",
      end: "bottom top-=40%",
      onToggle: (self) => {
        near = self.isActive;
      },
      onRefresh: (self) => {
        near = self.isActive;
      },
    });

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!near) return;
      const q = scrollState.find;
      const c = scrollState.cover6;
      const key = `${q.toFixed(5)}|${c.toFixed(4)}|${layoutVersion}`;
      if (key === lastKey) return;
      lastKey = key;
      render(q, c);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      cover.kill();
      finder.kill();
      nearTrigger.kill();
      painter.destroy();
      skyCanvases.forEach((c) => c.remove());
      tileCanvases.forEach((t) => t.el.remove());
      carEls.forEach((c) => c?.group.remove());
    };
  }, [isMobile]);

  // A plate takes the visitor to the middle of that road's stay.
  const goTo = (i: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const top = wrapper.getBoundingClientRect().top + window.scrollY;
    scrollToY(top + dwellCenter(i) * FIND_VH * window.innerHeight, 2.1);
  };

  return (
    <section
      ref={wrapperRef}
      id="find"
      aria-label="Find your Ford"
      data-vh={FIND_VH.toFixed(3)}
      className="relative"
      style={{
        height: `${(1 + FIND_VH) * 100}vh`,
        marginTop: `-${COVER_VH * 100}vh`,
        zIndex: SECTION_Z.find,
        backgroundColor: GROUND,
      }}
    >
      {/* The shadow the rising edge throws on the map it is covering. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-full h-[28vh]"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0))" }}
      />

      <div ref={stageRef} className="sticky top-0 h-dvh w-full overflow-hidden" style={isMobile ? STAGE_VARS_PHONE : STAGE_VARS}>
        {/* ----------------------------------------------------------------- the world
            Stacked far to near: the skies, the middle ground, the names, the road with
            the cars on it, the foreground. */}
        <div ref={skyRef} aria-hidden className="absolute inset-0" />
        <div
          ref={(el) => {
            trackRefs.current.mid = el;
          }}
          aria-hidden
          className="absolute left-0 will-change-transform"
        />
        <div ref={namesRef} aria-hidden className="pointer-events-none absolute inset-0 will-change-transform">
          {ROADS.map((road, i) => (
            <div
              key={road.id}
              ref={(el) => {
                nameRefs.current[i] = el;
              }}
              className="absolute top-[var(--name-top)] -translate-x-1/2 whitespace-nowrap font-plant-display text-[length:var(--name-size)] font-semibold uppercase leading-[0.8] tracking-[0.005em] text-white"
            >
              {road.model}
            </div>
          ))}
        </div>
        <div
          ref={(el) => {
            trackRefs.current.road = el;
          }}
          aria-hidden
          className="absolute left-0 will-change-transform"
        />
        <div ref={carHostRef} aria-hidden className="pointer-events-none absolute left-0 top-0 will-change-transform" />
        <div
          ref={(el) => {
            trackRefs.current.fore = el;
          }}
          aria-hidden
          className="absolute left-0 will-change-transform"
        />

        {/* ------------------------------------------------------- scrims and grain */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[3] h-[13%]" style={{ background: "linear-gradient(to bottom, rgba(1,3,8,0.55), rgba(1,3,8,0))" }} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-[46%]" style={{ background: "linear-gradient(to top, rgba(1,3,8,0.66), rgba(1,3,8,0))" }} />
        <div ref={dimRef} aria-hidden className="pointer-events-none absolute inset-0 z-[3] opacity-0" style={{ background: isMobile ? DIM_PHONE : DIM_WIDE }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[3] opacity-[0.07]" style={{ backgroundImage: GRAIN }} />

        <p className="sr-only">
          Find your Ford. {ROADS.map((r) => `${r.label}: the ${r.model}, built in ${r.builtIn}.`).join(" ")}
        </p>

        {/* ---------------------------------------------------------- the matcher */}
        <div ref={matcherRef} className="pointer-events-none absolute inset-0 z-[10] invisible opacity-0">
          {/* Facts, on the left: one set per road, one on screen at a time. */}
          <div className="absolute max-md:inset-x-5 max-md:top-[var(--band-top)] md:left-[var(--gutter)] md:top-[var(--band-top)] md:w-[clamp(220px,17vw,340px)]">
            <div className="grid [text-shadow:0_2px_26px_rgba(0,4,14,0.8)]">
              {ROADS.map((road, s) => (
                <div
                  key={road.id}
                  ref={(el) => {
                    factRefs.current[s] = el;
                  }}
                  className="invisible flex flex-col gap-[clamp(22px,2.3vw,42px)] opacity-0 [grid-area:1/1] max-md:grid max-md:grid-cols-3 max-md:gap-x-5 max-md:gap-y-0"
                >
                  <FigureView f={road.lead} size="lead" />
                  <div className="flex gap-x-[clamp(22px,2.4vw,44px)] max-md:contents">
                    {road.pair.map((f) => (
                      <FigureView key={f.caption} f={f} size="pair" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* The question and the plates, on the right, with the way into the road's Ford. */}
          <div className="absolute flex flex-col items-end gap-[clamp(18px,1.7vw,30px)] text-right max-md:inset-x-5 max-md:bottom-[8.5%] max-md:flex-col-reverse max-md:items-stretch md:right-[var(--gutter)] md:top-[var(--band-top)] md:w-[clamp(206px,14.2vw,260px)]">
            <p className={`${HEADING} text-[clamp(30px,2.3vw,44px)] max-md:hidden`}>
              Where are
              <br />
              you headed?
            </p>

            <div className="pointer-events-auto relative w-full">
              <div role="group" aria-label="Road" ref={gridRef} className="relative grid grid-cols-4 gap-1.5 md:grid-cols-2">
                <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-4 gap-1.5 md:grid-cols-2">
                  {ROADS.map((r) => (
                    <span key={r.id} className="rounded-[4px] bg-[rgba(8,12,22,0.8)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]" />
                  ))}
                </div>
                <span
                  ref={highlightRef}
                  aria-hidden
                  className="pointer-events-none absolute left-0 top-0 rounded-[4px] bg-white transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
                />
                {ROADS.map((road, i) => (
                  <button
                    key={road.id}
                    ref={(el) => {
                      buttonRefs.current[i] = el;
                    }}
                    type="button"
                    data-cursor-hover
                    data-active={i === 0 ? "true" : "false"}
                    aria-pressed={i === 0}
                    onClick={() => goTo(i)}
                    className="relative h-10 whitespace-nowrap rounded-[4px] px-2 font-plant-display text-[clamp(14px,0.95vw,17px)] font-semibold uppercase tracking-[0.07em] text-white/85 outline-none transition-colors duration-200 hover:bg-white/10 hover:text-white active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white data-[active=true]:text-[#0a0f18] data-[active=true]:hover:bg-transparent motion-reduce:transition-none md:px-3"
                  >
                    {road.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid w-full max-md:justify-items-start md:justify-items-end">
              {ROADS.map((road, s) => (
                <div
                  key={road.id}
                  ref={(el) => {
                    dealRefs.current[s] = el;
                  }}
                  className="invisible flex flex-col gap-3 opacity-0 [grid-area:1/1] max-md:flex-row max-md:items-center max-md:gap-4 md:items-end"
                >
                  <p data-part="fade" className="font-plant-text text-[clamp(13px,0.9vw,16px)] font-medium leading-tight text-white/70 opacity-0 [text-shadow:0_2px_20px_rgba(0,4,14,0.85)]">
                    Built in {road.builtIn}.
                  </p>
                  <a
                    data-part="fade"
                    href={road.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-cursor-hover
                    className={`${BUTTON} bg-ford-grabber text-white opacity-0 hover:bg-white hover:text-[#0a0f18]`}
                  >
                    Explore {road.model}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- the close */}
        <div
          ref={closeRef}
          className="invisible absolute inset-x-6 top-[16%] z-[10] opacity-0 md:inset-x-auto md:left-[var(--gutter)] md:top-[24%] md:w-[min(40vw,640px)]"
        >
          <div className="flex flex-col gap-5 md:gap-6">
            <h2 className={`${HEADING} text-[clamp(52px,6.9vw,128px)]`}>
              <Rise>Now build</Rise>
              <Rise>yours.</Rise>
            </h2>
            <p data-part="fade" className={`${SENTENCE} max-w-[31ch] opacity-0`}>
              Pick a Ford and build it, or find the dealer nearest you.
            </p>
            <div data-part="fade" className="flex flex-wrap items-center gap-3 pt-1 opacity-0">
              <a
                href={CLOSE_LINKS.build}
                target="_blank"
                rel="noopener noreferrer"
                data-cursor-hover
                className={`${BUTTON} bg-ford-grabber text-white hover:bg-white hover:text-[#0a0f18]`}
              >
                See all vehicles
              </a>
              <a
                href={CLOSE_LINKS.dealer}
                target="_blank"
                rel="noopener noreferrer"
                data-cursor-hover
                className={`${BUTTON} border border-white/70 text-white hover:bg-white hover:text-[#0a0f18]`}
              >
                Find a Dealer
              </a>
            </div>
          </div>
        </div>

        <div ref={noteRef} className="absolute bottom-[1.6%] left-6 right-6 z-[10] text-center opacity-0 md:bottom-[2.4%] md:left-[var(--gutter)] md:right-auto md:max-w-[44vw] md:text-left">
          <span className="font-plant-text text-[11.5px] font-medium leading-snug tracking-[0.02em] text-white/65 [text-shadow:0_1px_10px_rgba(0,4,12,0.95)]">
            Figures: {FIGURES_SOURCE}, {FIGURES_AS_OF} ({FIGURES_NOTE}).
          </span>
        </div>

        <div ref={navRef} className="invisible absolute inset-x-0 top-0 z-[20] opacity-0">
          <Navbar />
        </div>
      </div>
    </section>
  );
}
