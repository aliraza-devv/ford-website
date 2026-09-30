import { HERO_COPY } from "@/lib/theme";

/** Shared progress value the load timeline (HeroExperience) tweens 0 -> 1 and
 * the in-scene headline (HeadlinePlane) reads. Lives in its own module so the
 * timeline can use the duration without importing any three.js code into the
 * main bundle. */
export type HeadlineIntro = { p: number };

// The numbers the DOM SplitText intro used: each character takes 0.6 s, and
// they start 25 ms apart.
export const HEADLINE_CHAR_SECONDS = 0.6;
export const HEADLINE_STAGGER_SECONDS = 0.025;
export const HEADLINE_INTRO_SECONDS =
  HEADLINE_CHAR_SECONDS + HEADLINE_STAGGER_SECONDS * (HERO_COPY.headline.length - 1);
