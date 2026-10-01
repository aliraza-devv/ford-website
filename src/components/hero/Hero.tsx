"use client";

import { useFitText } from "@/hooks/useFitText";
import { LAYOUT } from "@/config/composition";
import { HERO_COPY } from "@/lib/theme";
import { Navbar } from "./Navbar";
import { StatsPanel } from "./StatsPanel";
import { DriveHud } from "./DriveHud";
import { AudioToggle } from "./AudioToggle";

type HeroProps = {
  loaded: boolean;
};

/**
 * Purely presentational DOM content for the hero stage -- the headline's
 * layout anchor, side panels, and chrome. Scene/world/refs/the load-in
 * timeline now live in HeroExperience.tsx, which owns the pinned stage this renders
 * into and the scroll transition into Section2. The headline and the two
 * side panels carry `hero-fade-content` and fade out as the car turns; the
 * nav and audio toggle stay visible in section 2, so they aren't tied to it.
 */
export function Hero({ loaded }: HeroProps) {
  const headlineRef = useFitText<HTMLHeadingElement>();

  return (
    <>
      {/* The headline. FIX 3: constrained to the gutter-bounded center
          column (never full-bleed) with a measure-and-fit font size instead
          of a guessed clamp(), and its bottom edge pinned to
          LAYOUT.headlineBaselineY so it sits in its own band below the
          navbar.

          It is no longer what you SEE: the visible headline is drawn inside
          the 3D canvas (world/HeadlinePlane) so it can sit between the world
          and the car in depth. This element stays as the single source for
          its layout rectangle, fitted font size and computed font, for the
          scroll fade (`hero-fade-content`, still tweened here), and as the
          real <h1> for screen readers and SEO -- hence transparent, not
          removed. Its mouse-parallax transform moved into HeadlinePlane. */}
      <div
        className="hero-headline-wrap hero-fade-content pointer-events-none absolute z-10 flex justify-center overflow-hidden"
        style={{
          left: `${LAYOUT.sideGutter * 100}%`,
          right: `${LAYOUT.sideGutter * 100}%`,
          top: 0,
          height: `${LAYOUT.headlineBaselineY * 100}%`,
          alignItems: "flex-end",
        }}
      >
        <h1
          ref={headlineRef}
          className="hero-headline select-none whitespace-nowrap font-display font-extrabold uppercase leading-[0.85] tracking-[-0.04em] text-transparent"
        >
          {HERO_COPY.headline}
        </h1>
      </div>

      {/* FIX 4/5: the side panels are absolutely self-positioned from
          LAYOUT (mirrored left/right insets). Persistent across section 2
          too -- still relevant while looking at the car from the side. */}
      <StatsPanel loaded={loaded} />
      <DriveHud loaded={loaded} />

      {/* Layer 5: remaining UI chrome, nearly fixed, topmost, persistent. */}
      <div
        className="pointer-events-none absolute inset-0 z-30 flex h-full flex-col justify-between"
        style={{
          transform:
            "translate3d(calc(var(--parallax-x, 0px) * 0.1), calc(var(--parallax-y, 0px) * 0.1), 0)",
        }}
      >
        <div className="hero-navbar">
          <Navbar />
        </div>

        <div className="flex-1" />

        <div className="flex items-end justify-between px-6 pb-8 sm:px-12">
          <AudioToggle />

          <div className="pointer-events-none text-right text-[11px] font-medium uppercase tracking-[0.2em] text-white/45">
            <div>{HERO_COPY.modelDesignation[0]}</div>
            <div>{HERO_COPY.modelDesignation[1]}</div>
          </div>
        </div>
      </div>
    </>
  );
}
