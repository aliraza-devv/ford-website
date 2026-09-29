import { HERO_COPY } from "@/lib/theme";

/**
 * Layer 5 (closest), Step 8. Thin top bar, nearly fixed (0.1x parallax via
 * the shared --parallax-x/y vars on its wrapper in Hero.tsx).
 */
export function Navbar() {
  return (
    <div className="pointer-events-auto flex items-center justify-between border-b border-white/10 px-6 py-6 sm:px-10">
      {/* FIX 8: a proper blue-oval-with-wordmark approximation, not an
          empty outline -- swap for the official asset when it's ready. */}
      <svg viewBox="0 0 200 100" className="h-7 w-auto" aria-label="Ford logo placeholder">
        <ellipse cx="100" cy="50" rx="96" ry="46" fill="#00095B" stroke="#ffffff" strokeWidth="4" />
        <text
          x="100"
          y="67"
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontStyle="italic"
          fontWeight="700"
          fontSize="46"
          letterSpacing="-1"
          fill="#ffffff"
        >
          Ford
        </text>
      </svg>

      <nav className="hidden gap-10 md:flex">
        {HERO_COPY.nav.map((label) => (
          <a
            key={label}
            href="#"
            data-cursor-hover
            className="group relative text-[11px] font-medium uppercase tracking-[0.2em] text-white/70 transition-colors hover:text-white"
          >
            {label}
            <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-ford-grabber transition-transform duration-[250ms] ease-out group-hover:scale-x-100" />
          </a>
        ))}
      </nav>

      <button
        type="button"
        data-cursor-hover
        className="rounded-[4px] bg-ford-grabber px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.2em] text-white transition-transform hover:scale-105"
      >
        {HERO_COPY.navCta}
      </button>
    </div>
  );
}
