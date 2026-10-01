/**
 * Section 3's interior features.
 *
 * Each one is anchored by NODE NAME, not by a hand-authored [x,y,z].
 * MustangModel resolves the name against the loaded glTF once, takes that
 * mesh's own bounding-box centre, and projects it through the live camera
 * every frame. Two things fall out of that which matter:
 *
 *  - The anchor is measured from the actual geometry, so it can't drift out
 *    of sync with the model the way a copied coordinate can.
 *  - A name that doesn't resolve produces NO callout and a console warning,
 *    instead of a label pointing confidently at empty space.
 *
 * Every name below was verified present in the GT500 glb (219 nodes / 116
 * meshes). Features the model does not contain are not here: the centre-stack
 * toggle switches have no geometry, and the dash-top pods are fused into
 * `GT500.Dash_leather_0`, so anchoring to either would be inventing a position.
 *
 * `nudge` moves the marker off the node's centre, as a fraction of viewport
 * HEIGHT (the camera's vertical field of view is fixed, so this stays correct
 * at any aspect ratio). It exists for features the model has no separate mesh
 * for: the paddle shifters are part of the steering-wheel mesh, and sit a
 * known distance out from its hub.
 */
export type Hotspot = {
  id: string;
  /** Node name in the glb. Must resolve to a Mesh -- see the module note. */
  node: string;
  nudge?: [number, number];
  /** The whole callout: two or three words that explain themselves. There is
   * deliberately no second line of copy. */
  title: string;
  /** Which way the leader runs from the marker, and whether its label sits
   * above or below the horizontal rule. */
  side: "left" | "right";
  rise: "up" | "down";
};

// Ordered left to right by where they sit on screen: the light blade meets
// them in this order, and the phone layout steps through them in it.
export const HOTSPOTS: Hotspot[] = [
  {
    id: "paddle-shifters",
    node: "GT500.Steer_leather_0",
    // The paddles sit out to the left of the wheel's hub.
    nudge: [-0.205, -0.12],
    title: "Paddle shifters",
    side: "left",
    rise: "up",
  },
  {
    id: "digital-cluster",
    node: "GT500.Gauges_glossblack_0",
    title: "Digital cluster",
    side: "right",
    rise: "up",
  },
  {
    id: "steering-wheel",
    node: "GT500.Steer_leather_0",
    title: "Flat-bottom wheel",
    side: "left",
    rise: "down",
  },
  {
    id: "sync-display",
    // The 2020-2022 GT500 runs SYNC 3 on an 8-inch screen.
    node: "GT500.Screen_glossblack_0",
    title: "SYNC 3 display",
    side: "right",
    rise: "down",
  },
  {
    id: "door-trim",
    // The passenger door card: the driver's is out of frame at this camera.
    // The card's own centre is past the right edge, so the marker is nudged
    // onto the blue trim strip that IS in frame.
    node: "GT500.Door.R_leather_0",
    nudge: [-0.992, -0.21],
    title: "Body-colour trim",
    side: "left",
    rise: "down",
  },
];

/** Per-hotspot projected screen state -- written once per frame by
 * MustangModel (the only thing with live access to the camera and the
 * car's current transform), read once per frame by FeatureScan's own
 * rAF loop. A plain mutable object, not React state -- this updates at
 * render frame rate and neither side should re-render React for it. */
export type HotspotScreenState = {
  x: number;
  y: number;
  /** False when the anchor is behind the camera or past the near/far
   * planes. It does NOT mean "off screen": a feature may be nudged back onto
   * the screen from an anchor that is not, so the consumer checks bounds
   * after the nudge. */
  visible: boolean;
};
export type HotspotScreenMap = Record<string, HotspotScreenState>;

/** The one shared map of projected callout positions. Sections 3 and 4 both
 * write into it (the interior car, and the car on the plant line) and the
 * overlays read from it. */
export const hotspotScreen: HotspotScreenMap = {};
