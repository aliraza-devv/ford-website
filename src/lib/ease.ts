/** Small easing and windowing helpers shared by the scroll-driven sections. */

export const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
/** 0 before `a`, 1 after `b`, linear between. */
export const win = (f: number, a: number, b: number) => clamp01((f - a) / (b - a));
export const smooth01 = (t: number) => t * t * (3 - 2 * t);
export const smoothstep = (a: number, b: number, f: number) => smooth01(win(f, a, b));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Eases in and out with the gentlest peak speed of the usual curves (1.57 times the average, where
 * the cubic's is 3 times): for something heavy that has to move a long way, like a car on a line. */
export const easeInOutSine = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
