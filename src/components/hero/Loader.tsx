"use client";

import { useCallback, useEffect, useRef } from "react";
import { useProgress } from "@react-three/drei";
import gsap from "gsap";

type LoaderProps = {
  onComplete: () => void;
};

/**
 * Step 10.1-2. Full-bleed Ford Twilight with a centered Grabber line
 * growing with real GLB load progress. At 100% the screen splits along
 * that same vertical line and the two halves slide apart, wiping open. A
 * hard timeout also forces the reveal if some asset never settles.
 */
export function Loader({ onComplete }: LoaderProps) {
  const { progress, active } = useProgress();
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const firedRef = useRef(false);

  const runReveal = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const tl = gsap.timeline({
      onComplete: () => {
        if (containerRef.current) containerRef.current.style.display = "none";
        onComplete();
      },
    });

    tl.to(lineRef.current, { scaleX: 1, duration: 0.2, ease: "power2.out" })
      .to(lineRef.current, { opacity: 0, duration: 0.2 }, "+=0.05")
      .to(
        [leftRef.current, rightRef.current],
        {
          xPercent: (i) => (i === 0 ? -100 : 100),
          duration: 0.7,
          ease: "power3.inOut",
        },
        "-=0.1",
      );
  }, [onComplete]);

  useEffect(() => {
    if (!lineRef.current || firedRef.current) return;
    gsap.to(lineRef.current, {
      scaleX: Math.max(progress / 100, 0.01),
      duration: 0.3,
      ease: "power1.out",
    });
  }, [progress]);

  useEffect(() => {
    const timeoutId = window.setTimeout(runReveal, 8000);
    return () => window.clearTimeout(timeoutId);
  }, [runReveal]);

  useEffect(() => {
    if (progress < 100 || active) return;
    runReveal();
  }, [progress, active, runReveal]);

  return (
    <div ref={containerRef} className="fixed inset-0 z-50">
      <div ref={leftRef} className="absolute inset-y-0 left-0 w-1/2 bg-ford-twilight" />
      <div ref={rightRef} className="absolute inset-y-0 right-0 w-1/2 bg-ford-twilight" />
      <div className="absolute left-1/2 top-1/2 h-px w-40 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-white/10">
        <div ref={lineRef} className="h-full w-full origin-left scale-x-0 bg-ford-grabber" />
      </div>
    </div>
  );
}
