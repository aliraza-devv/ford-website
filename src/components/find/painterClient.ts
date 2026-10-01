import { renderRequest, type PaintRequest, type SkyRequest, type TileRequest } from "./render";

/**
 * Hands painting to the worker and delivers what comes back. Where the browser has no
 * module workers or no OffscreenCanvas, the same requests are painted on the main
 * thread instead, one at a time in the browser's idle time.
 */

type Done = (image: CanvasImageSource, width: number, height: number) => void;

export class PanoramaPainter {
  private worker: Worker | null = null;
  private waiting = new Map<number, { req: PaintRequest; done: Done }>();
  private nextId = 1;
  private version = 0;
  private fallbackQueue: { req: PaintRequest; done: Done }[] = [];
  private fallbackScheduled = false;
  private dead = false;

  constructor() {
    if (typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined") {
      try {
        const worker = new Worker(new URL("./paint.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent<{ id: number; version: number; bitmap: ImageBitmap }>) => {
          const { id, version, bitmap } = e.data;
          const entry = this.waiting.get(id);
          this.waiting.delete(id);
          if (!entry || version !== this.version || this.dead) {
            bitmap.close();
            return;
          }
          entry.done(bitmap, bitmap.width, bitmap.height);
          bitmap.close();
        };
        worker.onerror = () => {
          // A worker that cannot start: paint here instead, starting with what was asked.
          this.worker?.terminate();
          this.worker = null;
          for (const entry of this.waiting.values()) this.fallbackQueue.push(entry);
          this.waiting.clear();
          this.scheduleFallback();
        };
        this.worker = worker;
      } catch {
        this.worker = null;
      }
    }
  }

  /** Drops everything in flight: a new layout makes old requests wrong. */
  reset() {
    this.version++;
    this.waiting.clear();
    this.fallbackQueue = [];
  }

  sky(req: Omit<SkyRequest, "kind">, done: Done) {
    this.send({ ...req, kind: "sky" }, done);
  }

  tile(req: Omit<TileRequest, "kind">, done: Done) {
    this.send({ ...req, kind: "tile" }, done);
  }

  private send(body: SkyRequest | TileRequest, done: Done) {
    if (this.dead) return;
    const req = { ...body, id: this.nextId++, version: this.version } as PaintRequest;
    if (this.worker) {
      this.waiting.set(req.id, { req, done });
      this.worker.postMessage(req);
    } else {
      this.fallbackQueue.push({ req, done });
      this.scheduleFallback();
    }
  }

  private scheduleFallback() {
    if (this.fallbackScheduled) return;
    this.fallbackScheduled = true;
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    const run = () => {
      this.fallbackScheduled = false;
      const item = this.fallbackQueue.shift();
      if (item && !this.dead && item.req.version === this.version) {
        const canvas = document.createElement("canvas");
        renderRequest(canvas, item.req);
        item.done(canvas, canvas.width, canvas.height);
      }
      if (this.fallbackQueue.length) this.scheduleFallback();
    };
    if (ric) ric(run, { timeout: 600 });
    else window.setTimeout(run, 60);
  }

  destroy() {
    this.dead = true;
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
    this.fallbackQueue = [];
  }
}
