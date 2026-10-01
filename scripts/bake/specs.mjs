// How each car is shot: its model, its paint, and the light of the place it stands in.
// Units are metres; the camera is the world's (see bake.js).
//
// The light is behind the car (the afterglow, the sun, the lamps), so the faces we see are
// dark and the shape is drawn by the edges that catch it and by its own lamps. That is how a
// car looks at that hour.

/** The environment a place gives the car to reflect: a dark sky and ground, the glow
 * behind and to either side, and a few strips of light to draw highlights along the panels. */
const SKIES = {
  highway: {
    top: "#010208",
    mid: "#050b1c",
    horizon: "#1f3a66",
    ground: "#010206",
    bands: [
      { w: 150, h: 9, at: [0, 3.2, -60], color: "#ff9a52", power: 9 },
      { w: 90, h: 7, at: [-62, 3, -28], color: "#ff9a52", power: 5 },
      { w: 90, h: 7, at: [62, 3, -28], color: "#ff9a52", power: 5 },
    ],
    strips: [
      { w: 18, h: 0.7, at: [0, 6.5, -5], color: "#cfe0ff", power: 8 },
      { w: 0.9, h: 6, at: [-8, 2.4, -7], color: "#ffd9b0", power: 7 },
      { w: 0.9, h: 6, at: [8, 2.4, -7], color: "#cfe0ff", power: 6 },
    ],
  },
};

export const SPECS = {
  mustang: {
    glb: "/public/models/mustang-shelby-gt500.glb",
    length: 4.81,
    yaw: 24,
    paint: { color: "#1536c4", metalness: 0.62, roughness: 0.26, env: 1.6 },
    sky: SKIES.highway,
    exposure: 1.05,
    envIntensity: 1.3,
    lights: [
      { color: "#ffae6e", power: 5, at: [-9, 3.2, -12] },
      { color: "#a9c0ff", power: 3, at: [10, 3.6, -9] },
      { color: "#7f9bff", power: 0.55, at: [3, 3, 12] },
    ],
    hemi: { sky: "#4a5f9a", ground: "#05060c", power: 0.28 },
  },
};

/**
 * The loader's car: the GT500 in pure profile on a night road, lit from the front and above by the
 * road's own lamps (it has to read from across the room, so its near side is lit much more than a
 * car in the scenery needs to be), with the afterglow behind it drawing the roofline and the
 * shoulders.
 */
export const PROFILE = {
  glb: "/public/models/mustang-shelby-gt500.glb",
  length: 4.81,
  pxPerM: 400,
  yaw: 0,
  paint: { color: "#1536c4", metalness: 0.6, roughness: 0.27, env: 1.5 },
  sky: SKIES.highway,
  exposure: 1.1,
  envIntensity: 1.2,
  lights: [
    { color: "#dfe9ff", power: 2.2, at: [-5, 6, 10] },
    { color: "#8fb0ff", power: 0.9, at: [9, 2, 9] },
    { color: "#ffae6e", power: 5, at: [-9, 3.2, -12] },
    { color: "#a9c0ff", power: 3, at: [12, 3.4, -8] },
  ],
  hemi: { sky: "#6f86c8", ground: "#05060c", power: 0.4 },
};
