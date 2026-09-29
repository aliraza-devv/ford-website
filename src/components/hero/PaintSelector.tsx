"use client";

import { type RefObject, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { LAYOUT } from "@/config/composition";
import { FORD_COLORS, PAINT_OPTIONS } from "@/lib/theme";
import type { MustangModelHandle } from "./MustangModel";

type PaintSelectorProps = {
  paintControllerRef: RefObject<MustangModelHandle | null>;
  loaded: boolean;
};

/**
 * Layer 5, Step 7 right panel. Clicking a swatch re-triggers the SAME
 * liquid shader mask as the hover blob (see LiquidPaintMaterial /
 * MustangModel.triggerSweep) but as a one-shot full-body sweep originating
 * from the swatch's own screen position, permanently setting the new base
 * color on completion.
 */
export function PaintSelector({ paintControllerRef, loaded }: PaintSelectorProps) {
  const [activeHex, setActiveHex] = useState<string>(FORD_COLORS.blue);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    // FIX 5: absolutely positioned from the shared LAYOUT grid -- right
    // inset matches sideGutter exactly (mirroring StatsPanel's left inset),
    // same vertical band, and a fixed panelWidth so the hover label always
    // has room to slide in without ever pushing past the viewport edge.
    // hero-fade-content: hidden once section 2 is in view -- the swatches
    // read as visual clutter next to the close-up side/interior shot, so
    // (unlike StatsPanel, which stays relevant) this fades out with the
    // rest of the hero-specific chrome.
    <div
      ref={containerRef}
      className="hero-fade-content pointer-events-auto absolute z-30 flex flex-col justify-center gap-4 pr-6"
      style={{
        right: `${LAYOUT.sideGutter * 100}%`,
        top: `${LAYOUT.sidePanelBandTop * 100}%`,
        bottom: `${100 - LAYOUT.sidePanelBandBottom * 100}%`,
        width: `${LAYOUT.panelWidth * 100}%`,
        borderRight: "1px solid rgba(255,255,255,0.2)",
      }}
    >
      {PAINT_OPTIONS.map((option) => {
        const isActive = option.hex.toLowerCase() === activeHex.toLowerCase();
        return (
          <button
            key={option.name}
            type="button"
            data-cursor-hover
            onClick={(event) => {
              paintControllerRef.current?.triggerSweep(event.clientX, event.clientY, option.hex);
              setActiveHex(option.hex);
            }}
            className="group flex items-center justify-end gap-3"
            aria-label={`Set paint to ${option.name}`}
          >
            <span className="translate-x-2 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.15em] text-white/70 opacity-0 transition-all duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100">
              {option.name}
            </span>
            <span
              className="h-8 w-8 rounded-[4px] border transition-[border-color,transform] duration-200"
              style={{
                backgroundColor: option.hex,
                borderColor: isActive ? FORD_COLORS.grabber : "rgba(255,255,255,0.2)",
                borderWidth: isActive ? 2 : 1,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
