import { LAYOUT } from "@/config/composition";

/**
 * Layer 1 (furthest), Step 4. Pure DOM/CSS -- a vertical fade from
 * near-black through Ford Twilight into a soft Ford Blue horizon glow,
 * plus a restrained animated noise haze near the horizon line (an SVG
 * feTurbulence filter, not a literal WebGL shader, but the same idea at a
 * fraction of the cost), and a very low-opacity static grain layer to kill
 * the visible gradient banding FIX 6 called out.
 *
 * FIX 6: height is exactly LAYOUT.horizonY (not an independently-chosen
 * "55%" that happened to roughly match Road's own independent "55%") --
 * the two layers now tile the viewport exactly, with no gap or overlap,
 * which is what a mismatched seam actually was.
 */
export function Sky() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-0 overflow-hidden"
      style={{
        height: `${LAYOUT.horizonY * 100}%`,
        transform:
          "translate3d(calc(var(--parallax-x, 0px) * 0.2), calc(var(--parallax-y, 0px) * 0.2), 0)",
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, #000000 0%, #000a1c 28%, var(--ford-twilight) 60%, #000a45 82%, #00095b 100%)",
        }}
      />

      <svg className="absolute h-0 w-0">
        <filter id="skyHazeNoise">
          <feTurbulence type="fractalNoise" baseFrequency="0.01 0.03" numOctaves={2} seed={7} result="noise">
            <animate
              attributeName="baseFrequency"
              values="0.01 0.03;0.013 0.034;0.01 0.03"
              dur="22s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0.09  0 0 0 0 0.15  0 0 0 0 0.55  0 0 0 0.25 0"
          />
        </filter>
        {/* Static luminance grain -- kills gradient banding at a barely
            perceptible opacity, per FIX 6. */}
        <filter id="skyGrain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={3} stitchTiles="stitch" />
        </filter>
      </svg>

      {/* Haze: kept under 0.15 opacity total (0.35 layer * 0.25 matrix alpha
          above = ~0.09 effective) so it reads as atmosphere, not an effect. */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2 mix-blend-screen"
        style={{ filter: "url(#skyHazeNoise)", opacity: 0.35 }}
      />
      <div
        className="absolute inset-0 mix-blend-overlay"
        style={{ filter: "url(#skyGrain)", opacity: 0.035 }}
      />
    </div>
  );
}
