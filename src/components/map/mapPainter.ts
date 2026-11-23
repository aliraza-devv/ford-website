import { MAP_STATES } from "@/config/usMap";
import type { View } from "@/lib/mapCamera";

/**
 * Draws the plant map on one 2D canvas.
 *
 * The country is 49 filled paths in the map's own units; the camera is just a matrix, so
 * zooming costs the same as holding still. Only what the camera can see is drawn. A
 * plate is a state, and its colour says how far the tour has got with it: dark until
 * a plant in it lights up, then blue, and brightest while the tour is in it.
 */

const BG = "#04070d";

type RGB = [number, number, number];
const BASE: RGB = [13, 22, 40];
const LIT: RGB = [19, 36, 76];
const FOCUS: RGB = [25, 50, 104];

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

export type PaintPlant = {
  /** Screen position, in CSS px. */
  x: number;
  y: number;
  /** 0-1: how lit the plant is. */
  lit: number;
  /** 0-1 over the moment it lights up (a ring leaves it); 0 or 1 when idle. */
  pulse: number;
  /** 0-1: how much the tour is looking at it right now. */
  focus: number;
  /** A plant that is being retooled is drawn as an outline. */
  retooling: boolean;
};

export type PaintFrame = {
  view: View;
  /** The stage, in CSS px, and the centre of the rectangle the map is framed in. */
  width: number;
  height: number;
  focusX: number;
  focusY: number;
  stateLit: Record<string, number>;
  stateFocus: Record<string, number>;
  plants: PaintPlant[];
  reduced: boolean;
};

export class MapPainter {
  private ctx: CanvasRenderingContext2D;
  private paths: Path2D[];
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    // Deliberately NOT `alpha: false`. paint() fills the whole canvas every frame, so the picture
    // is the same either way, but an opaque canvas tells Chrome's compositor that it may skip
    // drawing whatever is underneath it. The map rises over the 3D stage and the compositor's idea
    // of where the canvas sits lags behind the scroll, so with an opaque canvas it skipped the
    // plant scene in a band at the top of the screen (black panels and flicker at the end of the
    // plant film). A canvas that is not declared opaque is simply drawn over the scene.
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.paths = MAP_STATES.map((s) => new Path2D(s.d));
  }

  resize(width: number, height: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  paint(f: PaintFrame) {
    const { ctx, dpr } = this;
    const z = f.width / f.view.w;

    // ---- the ground
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, f.width, f.height);

    // ---- the plates, in map space
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (f.focusX - f.view.x * z), dpr * (f.focusY - f.view.y * z));
    const left = f.view.x - f.focusX / z;
    const right = f.view.x + (f.width - f.focusX) / z;
    const top = f.view.y - f.focusY / z;
    const bottom = f.view.y + (f.height - f.focusY) / z;

    const visible: number[] = [];
    for (let i = 0; i < MAP_STATES.length; i++) {
      const [x0, y0, x1, y1] = MAP_STATES[i].bbox;
      if (x1 < left || x0 > right || y1 < top || y0 > bottom) continue;
      visible.push(i);
    }

    for (const i of visible) {
      const id = MAP_STATES[i].id;
      const lit = f.stateLit[id] ?? 0;
      const focus = f.stateFocus[id] ?? 0;
      let c = BASE;
      if (lit > 0.001) {
        c = mix(BASE, LIT, lit);
        if (focus > 0.001) c = mix(c, FOCUS, focus);
      }
      ctx.fillStyle = css(c);
      ctx.fill(this.paths[i]);
    }

    // The gaps between plates: the ground colour, a hair wider than a pixel.
    ctx.strokeStyle = BG;
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.3 / z;
    for (const i of visible) ctx.stroke(this.paths[i]);

    // ---- light, in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // A soft glow behind whatever the camera is framing.
    const glowR = Math.max(f.width, f.height) * 0.62;
    const glow = ctx.createRadialGradient(f.focusX, f.focusY, 0, f.focusX, f.focusY, glowR);
    glow.addColorStop(0, "rgba(40,84,190,0.09)");
    glow.addColorStop(1, "rgba(40,84,190,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, f.width, f.height);

    // The pool of light each lit plant throws on its plate.
    for (const p of f.plants) {
      if (p.retooling && p.lit < 0.5) continue;
      const poolPx = Math.min(120, Math.max(30, 10 * z));
      // A plant the tour has not reached yet still glows faintly, so the whole network reads at once.
      const a = (0.1 + 0.9 * p.lit) * (0.16 + 0.2 * p.focus) * (p.retooling ? 0.6 : 1);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, poolPx);
      g.addColorStop(0, `rgba(150,180,255,${a.toFixed(3)})`);
      g.addColorStop(0.45, `rgba(90,130,255,${(a * 0.38).toFixed(3)})`);
      g.addColorStop(1, "rgba(60,100,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(p.x - poolPx, p.y - poolPx, poolPx * 2, poolPx * 2);
    }
    ctx.globalCompositeOperation = "source-over";

    // A darker rim, so the plates sink into the ground at the edges of the stage.
    const vignette = ctx.createRadialGradient(
      f.width / 2,
      f.height / 2,
      Math.min(f.width, f.height) * 0.42,
      f.width / 2,
      f.height / 2,
      Math.hypot(f.width, f.height) * 0.55,
    );
    vignette.addColorStop(0, "rgba(4,7,13,0)");
    vignette.addColorStop(1, "rgba(4,7,13,0.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, f.width, f.height);

    // ---- the plants
    for (const p of f.plants) this.marker(p, f.reduced);
  }

  private marker(p: PaintPlant, reduced: boolean) {
    const { ctx } = this;
    const x = Math.round(p.x);
    const y = Math.round(p.y);

    // A plant the tour has not reached is a small dark square, there to say that
    // something is here.
    if (p.lit < 0.5) {
      const a = 0.72 + 0.28 * p.lit * 2;
      ctx.fillStyle = p.retooling ? `rgba(140,155,255,${a.toFixed(3)})` : `rgba(200,214,255,${a.toFixed(3)})`;
      if (p.retooling) {
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      } else {
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
      return;
    }

    if (p.retooling) {
      // Outlined: not building yet.
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#8c9bff";
      ctx.strokeRect(x - 5, y - 5, 10, 10);
    } else {
      ctx.fillStyle = "#f4f7ff";
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = "#1700f4";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }

    // The ring that leaves a plant as it lights up.
    if (!reduced && p.pulse > 0 && p.pulse < 1) {
      const e = 1 - Math.pow(1 - p.pulse, 3);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(190,208,255,${(0.75 * (1 - p.pulse)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 8 + 34 * e, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

