import * as THREE from "three";

/**
 * The plant's signage is drawn into canvas textures in the page's own Barlow
 * faces, so the boards in the hall and the copy on top of it are the same
 * typography. The faces are resolved the way HeadlinePlane resolves the hero
 * face: from the computed style of an element that uses them.
 */

export type PlantFonts = { display: string; text: string };

let cached: PlantFonts | null = null;

export function plantFonts(): PlantFonts {
  if (cached) return cached;
  const probe = (cls: string) => {
    const el = document.createElement("span");
    el.className = cls;
    el.style.position = "absolute";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    const family = getComputedStyle(el).fontFamily;
    el.remove();
    return family;
  };
  cached = { display: probe("font-plant-display"), text: probe("font-plant-text") };
  return cached;
}

/** Resolves once the faces the signs use are actually loaded. */
export async function plantFontsReady(): Promise<PlantFonts> {
  const f = plantFonts();
  await Promise.all([document.fonts.load(`600 100px ${f.display}`), document.fonts.load(`500 40px ${f.text}`)]);
  return f;
}

type SignOptions = {
  title: string;
  /** One short line under the title. */
  sub?: string;
  width?: number;
  height?: number;
  /** Panel colour. */
  panel?: string;
};

/** A wall board: a dark panel, a Ford-blue bar down its left edge, the title
 * in the condensed face, an optional second line. The board is cut to its
 * text: a short title is a short board, as a real one is, not a long black
 * panel with a word in one corner. Its width in metres is `height`'s metres
 * times canvas.width / canvas.height. */
export function drawBoard(fonts: PlantFonts, { title, sub, width = 1536, height = 480, panel = "#070b16" }: SignOptions): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const probe = canvas.getContext("2d")!;
  let fit = sub ? 250 : 290;
  probe.font = `600 ${fit}px ${fonts.display}`;
  const widest = Math.max(width, 3200);
  while (probe.measureText(title).width + 230 > widest && fit > 80) {
    fit -= 8;
    probe.font = `600 ${fit}px ${fonts.display}`;
  }
  // Cut to the text: the bar and padding either side of it.
  width = Math.round(probe.measureText(title).width + 230);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1700f4";
  ctx.fillRect(0, 0, 36, height);
  // A thin keyline, so the board reads as an object in the hall rather than a hole in it.
  ctx.strokeStyle = "rgba(190,205,255,0.22)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, width - 4, height - 4);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f4f6fb";
  const size = fit;
  ctx.font = `600 ${size}px ${fonts.display}`;
  const baseline = sub ? height * 0.58 : height * 0.66;
  ctx.fillText(title, 110, baseline);

  if (sub) {
    ctx.fillStyle = "#97a5cf";
    ctx.font = `500 74px ${fonts.text}`;
    ctx.fillText(sub, 114, height * 0.84);
  }
  return canvas;
}

export function boardTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
