import type { Hotspot } from "@/lib/hotspots";

/**
 * Callouts for the plant walkthrough's first station, anchored to the same
 * kind of thing Section 3's are: a node of the glb, resolved once by
 * MustangModel and projected through the live camera every frame. Because the
 * anchor is the mesh itself, the callout follows the part as it descends into
 * the car.
 *
 * The figures are Ford's published ones for the 2020-2022 Shelby GT500 (see
 * the notes beside each). Nothing here is rounded up.
 */
export const PLANT_CALLOUTS: Hotspot[] = [
  {
    id: "plant-engine",
    node: "GT500.Engine_glossblack_0",
    // 5.2-litre supercharged "Predator" V8, rated 760 hp and 625 lb-ft.
    title: "5.2L supercharged V8",
    side: "left",
    rise: "up",
  },
  {
    id: "plant-gearbox",
    node: "GT500.Transmission_carpaint_0",
    // Tremec TR-9070 seven-speed dual-clutch; shifts "in as little as 80 ms".
    title: "7-speed dual-clutch",
    side: "right",
    rise: "down",
  },
];
