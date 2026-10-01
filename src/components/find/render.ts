import { SKY, paintSky, paintTile, type TileJob } from "./panorama";
import type { Ctx } from "./paintKit";

/**
 * One request to paint a piece of the panorama, and the one function that does it. The
 * same function runs in the paint worker (on an OffscreenCanvas, off the main thread)
 * and, where workers or OffscreenCanvas are missing, on the main thread.
 */

export type SkyRequest = {
  kind: "sky";
  scene: number;
  /** The stage, in CSS px. */
  w: number;
  h: number;
  /** Canvas pixels per CSS px. */
  k: number;
};

export type TileRequest = {
  kind: "tile";
  job: TileJob;
  /** Where the tile's canvas starts vertically (CSS px from the stage's top), how tall
   * it is, and its pixel density. Its width is the job's x1 - x0. */
  top: number;
  height: number;
  k: number;
};

export type PaintRequest = (SkyRequest | TileRequest) & { id: number; version: number };

export function renderRequest(canvas: OffscreenCanvas | HTMLCanvasElement, req: PaintRequest) {
  const ctx = canvas.getContext("2d") as unknown as Ctx | null;
  if (!ctx) return;
  if (req.kind === "sky") {
    // A sky reaches past the stage's sides by its pad, so it can shift a little.
    const pad = SKY.pad * req.w;
    canvas.width = Math.max(2, Math.round((req.w + 2 * pad) * req.k));
    canvas.height = Math.max(2, Math.round(req.h * req.k));
    ctx.setTransform(req.k, 0, 0, req.k, pad * req.k, 0);
    paintSky(req.scene, ctx, req.w, req.h, -pad, req.w + pad);
  } else {
    const { job, k } = req;
    canvas.width = Math.max(2, Math.round((job.x1 - job.x0) * k));
    canvas.height = Math.max(2, Math.round(req.height * k));
    ctx.setTransform(k, 0, 0, k, -job.x0 * k, -req.top * k);
    paintTile(ctx, job);
  }
}
