"use client";

import { type CSSProperties, useEffect, useRef } from "react";
import { LOADER_CAR as CAR } from "@/config/loaderCar";

type LoaderProps = {
  /** Called when the loader is on its way out, so the page's introduction can start under it. */
  onComplete: () => void;
};

/** The loader's timeline lives in the stylesheet (.ld): it swoops in for 0.42 s and drives out over
 * the next 0.53, so it is gone at 0.95. The page's introduction starts at 0.6 s at the earliest. */
const INTRO_AT_MS = 600;
/** The loader is taken out of the page once its exit is over (ms after the page began). */
const REMOVE_AT_MS = 1100;

/** Where the parts of the car fall in its picture (see scripts/bake-loader-car.mjs). */
const VARS = {
  "--aspect": CAR.aspect,
  "--cg": +(CAR.ground * CAR.aspect).toFixed(5),
  "--gr": CAR.ground,
  "--wheel": CAR.wheel,
  "--nose": CAR.nose,
  "--hx": CAR.headlamp.x,
  "--hy": CAR.headlamp.y,
  "--tx": CAR.taillamp.x,
  "--ty": CAR.taillamp.y,
} as CSSProperties;
const FRONT = { "--x": CAR.front.x, "--y": CAR.front.y } as CSSProperties;
const REAR = { "--x": CAR.rear.x, "--y": CAR.rear.y } as CSSProperties;

/**
 * The loader: one short drive, under a second. The GT500 swoops in from the left on a night road,
 * wheels turning, lamps lit, and drives out to the right with the whole picture sliding after it,
 * uncovering the page. It is a fixed piece of choreography, not a progress bar: what takes longer
 * (the 21 MB model, the shaders) loads behind the poster the page opens on, not behind the loader,
 * and fades in when it is there.
 *
 * All of it is HTML and CSS (see .ld in globals.css), drawn in the first paint, before any script has
 * run, and animated by the compositor, so its time is the same however busy the page's main thread is.
 * This component only tells the page when it is on its way out, and takes it out of the page afterwards.
 */
export function Loader({ onComplete }: LoaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // performance.now() counts from the start of the page, not from this component's mount, which
    // in development is two seconds in.
    const now = performance.now();
    const intro = window.setTimeout(() => completeRef.current(), Math.max(0, INTRO_AT_MS - now));
    const remove = window.setTimeout(() => {
      root.style.display = "none";
    }, Math.max(0, REMOVE_AT_MS - now));
    return () => {
      window.clearTimeout(intro);
      window.clearTimeout(remove);
    };
  }, []);

  return (
    <div ref={rootRef} className="ld" role="status" aria-live="polite" style={VARS}>
      <span className="sr-only">Loading</span>
      <div aria-hidden className="ld-panel">
        <div className="ld-glow" />
        <div className="ld-road">
          <div className="ld-dashes" />
        </div>
        <div className="ld-car">
          <div className="ld-shadow" />
          <div className="ld-bob">
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative, sized by CSS, must paint in the first frame */}
            <img className="ld-body" src={CAR.src} alt="" width={CAR.width} height={CAR.height} fetchPriority="high" decoding="async" draggable={false} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="ld-wheel" style={FRONT} src={CAR.wheelSrc} alt="" fetchPriority="high" decoding="async" draggable={false} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="ld-wheel" style={REAR} src={CAR.wheelSrc} alt="" fetchPriority="high" decoding="async" draggable={false} />
            <i className="ld-pool" />
            <i className="ld-flare" />
            <i className="ld-tail" />
          </div>
        </div>
      </div>
    </div>
  );
}
