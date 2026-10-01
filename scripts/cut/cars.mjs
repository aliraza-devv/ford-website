// How each supplied photograph is cut and set. Coordinates are px in the photograph as supplied.
//
//   length    the car's real length in metres: its size in the road follows from it
//   flip      the photograph has the car facing left; the road's cars all face right
//   tyres     each tyre as a circle, so the shadow beneath can be taken away round it
//   groundY   below this row only the tyres (and what `keep` and `darkKeep` allow) stay
//   keep      rectangles [x0, y0, x1, y1] below the ground line that are the car's underside
//   darkKeep  [dark, light]: below the ground line (down to darkKeepY), pixels darker than this are
//             the car, not its shadow
//   erase     rectangles of the photograph to take out (an aerial)
//   whiteFrom from this row down (default groundY) a near-white pixel is the ground showing
//             through, in the gap between the underside and its shadow
//
// and how it is set for the dusk of its place (see grade.mjs):
//
//   look      exposure and ground (how much light is left on the upper and the lower car), tint (the
//             place's light, a multiplier), sky and sheen (the sky on the upper surfaces), rim (the
//             horizon's light along the roof), contrast, glass (how dark, how much sky)
//   glass     outlines of the windows, in the photograph
//   lamps     where each lamp is (in the photograph), the size of its glow in the cut picture's px, how
//             it shines, and for a headlamp the length of the cone of light ahead of it

const HEAD = "#fff0d4";
const TAIL = "#ff2a1a";

export const CARS = {
  // Trail: a cool evening in the trees, a warm sun low behind them.
  bronco: {
    file: "Bronco.jpg",
    length: 4.81,
    flip: true,
    tyres: [
      { x: 111, y: 300, r: 55.8 },
      { x: 500, y: 299.6, r: 55.8 },
    ],
    groundY: 297,
    keep: [[165, 297, 447, 317.5]],
    erase: [[189.5, 128, 197.5, 169.5]],
    look: {
      exposure: 0.22,
      ground: 0.34,
      tint: [0.84, 0.98, 1.0],
      sky: "#7fb0bd",
      sheen: 0.14,
      rim: "#ffc08e",
      rimStrength: 0.55,
      rimWidth: 4,
      contrast: 1.14,
      glass: { dark: 0.16, sheen: 0.3 },
    },
    glass: [
      [[262, 129], [323, 129], [323, 180], [222, 180], [240, 150]],
      [[350, 130], [430, 130], [430, 178], [350, 180]],
      [[470, 128], [558, 128], [558, 170], [470, 170]],
    ],
    lamps: [
      { x: 26, y: 225, rx: 30, ry: 42, color: HEAD, glow: 0.8, core: 3, air: 0.5, cone: 200, coneGlow: 0.22 },
      { x: 582, y: 216, rx: 16, ry: 34, color: TAIL, glow: 0.4, core: 1.3, air: 0.3 },
    ],
  },

  // Job site: an orange evening over the quarry.
  f150: {
    file: "f-150.jpg",
    length: 5.85,
    flip: false,
    tyres: [
      { x: 207, y: 222.4, r: 39.2 },
      { x: 559, y: 222.4, r: 39.5 },
    ],
    groundY: 258,
    whiteFrom: 233,
    erase: [[510.5, 50, 521, 126.5]],
    look: {
      exposure: 0.46,
      ground: 0.42,
      tint: [1.0, 0.86, 0.72],
      sky: "#ffb47a",
      sheen: 0.14,
      rim: "#ffb067",
      rimStrength: 0.65,
      rimWidth: 4,
      contrast: 1.1,
      glass: { dark: 0.2, sheen: 0.2 },
    },
    glass: [
      [[332, 100], [369, 100], [369, 141], [332, 141]],
      [[394, 100], [436, 101], [462, 114], [474, 130], [468, 146], [430, 147], [394, 142]],
    ],
    lamps: [
      { x: 620, y: 170, rx: 34, ry: 36, color: HEAD, glow: 0.8, core: 3, air: 0.5, cone: 200, coneGlow: 0.22 },
      { x: 112, y: 170, rx: 34, ry: 36, color: TAIL, glow: 0.4, core: 1.3, air: 0.3 },
    ],
  },

  // Town: a purple evening, the street lamps lit.
  explorer: {
    file: "Explorer.avif",
    length: 5.05,
    flip: false,
    tyres: [
      { x: 140, y: 297.6, r: 70 },
      { x: 612, y: 298, r: 69 },
    ],
    groundY: 305,
    darkKeep: [55, 95],
    darkKeepY: 346,
    look: {
      exposure: 0.16,
      ground: 0.32,
      tint: [0.92, 0.88, 1.0],
      sky: "#b49ae0",
      sheen: 0.14,
      rim: "#ff9d70",
      rimStrength: 0.55,
      rimWidth: 4,
      contrast: 1.14,
      glass: { dark: 0.16, sheen: 0.22 },
    },
    glass: [
      [[196, 99], [298, 99], [298, 158], [196, 158]],
      [[305, 98], [392, 98], [425, 125], [432, 150], [398, 160], [305, 160]],
    ],
    lamps: [
      { x: 682, y: 198, rx: 26, ry: 30, color: HEAD, glow: 0.8, core: 3, air: 0.5, cone: 200, coneGlow: 0.22 },
      { x: 49, y: 192, rx: 24, ry: 24, color: TAIL, glow: 0.4, core: 1.3, air: 0.3 },
    ],
  },
};
