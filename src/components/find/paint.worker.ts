import { renderRequest, type PaintRequest } from "./render";

/**
 * Paints the road finder's panorama off the main thread. A request in, a finished
 * ImageBitmap out (transferred, not copied). Painting a layer takes tens of
 * milliseconds; done on the page's own thread it would drop frames from whatever the
 * visitor is scrolling through at the time.
 */

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PaintRequest>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

scope.onmessage = (e) => {
  const req = e.data;
  const canvas = new OffscreenCanvas(2, 2);
  renderRequest(canvas, req);
  const bitmap = canvas.transferToImageBitmap();
  scope.postMessage({ id: req.id, version: req.version, bitmap }, [bitmap]);
};
