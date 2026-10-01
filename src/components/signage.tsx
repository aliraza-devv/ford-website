/**
 * The type the plant, the map and the road finder share: the condensed capitals of the
 * hall's signage for headings, a plain text face for the sentence under them. One
 * place, so a heading in the plant and a heading on the map are the same heading.
 */

/** Mask-rise line: the inner span is what moves; the outer clips it. */
export function Rise({ children }: { children: React.ReactNode }) {
  return (
    <span className="block overflow-hidden pb-[0.05em]">
      <span data-part="rise" className="block will-change-transform" style={{ transform: "translate3d(0,108%,0)" }}>
        {children}
      </span>
    </span>
  );
}

export const HEADING = "font-plant-display font-semibold uppercase leading-[0.9] tracking-[0.005em] text-white";

export const SENTENCE =
  "font-plant-text text-[clamp(15px,1.12vw,19px)] font-medium leading-[1.45] text-white/90 [text-shadow:0_1px_18px_rgba(0,4,12,0.9)] max-md:text-[15px]";

/** A figure inside a sentence. */
export function Fig({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-white">{children}</span>;
}

/** The label on a plate: the tracker in the plant, the states on the map, the roads
 * in the finder. */
export const PLATE_LABEL =
  "font-plant-text text-[clamp(11px,0.78vw,13.5px)] font-semibold uppercase tracking-[0.12em]";
