/**
 * Whether the pinned 3D stage (the hero, the car, the plant) can be seen at all.
 *
 * Once the plant map rises over it and covers it completely, nothing the canvas draws
 * reaches the screen, but it would go on drawing 60 frames a second and take that time
 * from the sections that are on screen. So the map flips this off when the cover is
 * complete and the canvas stops its render loop; scrolling back up flips it on a frame
 * before the stage is revealed again.
 *
 * A plain pub/sub rather than React state: it changes from a scroll callback, and the
 * canvas listens from inside its own tree.
 */
let live = true;
const listeners = new Set<(live: boolean) => void>();

export function isStageLive(): boolean {
  return live;
}

export function setStageLive(next: boolean) {
  if (next === live) return;
  live = next;
  listeners.forEach((l) => l(next));
}

export function onStageLive(cb: (live: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
