import { PLANT_XY } from "./usMap";

/**
 * Ford's assembly plants in the United States, with the vehicles each builds.
 *
 * Source: Ford's own list, corporate.ford.com > Operations > Worldwide Locations,
 * read on 1 October 2026 (its headcounts are dated June 2026). The names, cities,
 * models and opening years below are copied from it; the positions are the
 * coordinates Wikipedia gives for each site. Nothing here is inferred: a plant whose
 * entry reads "retooling" is shown that way because Ford's list says it is.
 *
 * Two plants on that list are left off the map on purpose: the Rouge Electric
 * Vehicle Center (listed as the "future home" of the F-150 Lightning EREV, so it
 * builds nothing today) and every plant outside the United States.
 */
export const PLANTS_SOURCE = "corporate.ford.com";
export const PLANTS_AS_OF = "October 2026";

export type StateCode = "MI" | "OH" | "IL" | "MO" | "KY";

export type FordPlant = {
  id: string;
  /** Short name used as the board's title. */
  title: string;
  /** Ford's full name for the plant. */
  name: string;
  city: string;
  state: StateCode;
  /** The vehicles it builds, as Ford lists them. */
  models: string[];
  /** Whether the city is already part of the title (so the board need not repeat it). */
  cityInTitle: boolean;
  opened?: number;
  acres?: number;
  status: "building" | "retooling";
  /** Position in the map's own units (config/usMap). */
  xy: [number, number];
};

const at = (id: string): [number, number] => PLANT_XY[id];

export const PLANTS: FordPlant[] = [
  {
    id: "flat-rock",
    title: "Flat Rock",
    name: "Flat Rock Assembly Plant",
    city: "Flat Rock",
    state: "MI",
    models: ["Mustang", "Mustang GT", "Mustang Dark Horse"],
    cityInTitle: true,
    opened: 1987,
    acres: 400,
    status: "building",
    xy: at("flat-rock"),
  },
  {
    id: "michigan-assembly",
    title: "Michigan Assembly",
    name: "Michigan Assembly Plant",
    city: "Wayne",
    state: "MI",
    models: ["Ranger", "Bronco"],
    cityInTitle: false,
    opened: 1957,
    acres: 369,
    status: "building",
    xy: at("michigan-assembly"),
  },
  {
    id: "dearborn-truck",
    title: "Dearborn Truck",
    name: "Dearborn Truck Plant",
    city: "Dearborn",
    state: "MI",
    models: ["F-150", "F-150 Raptor"],
    cityInTitle: true,
    opened: 2004,
    acres: 1100,
    status: "building",
    xy: at("dearborn-truck"),
  },
  {
    id: "ohio-assembly",
    title: "Ohio Assembly",
    name: "Ohio Assembly Plant",
    city: "Avon Lake",
    state: "OH",
    models: ["F-650 and F-750 medium duty trucks", "Super Duty F-350, F-450 and F-550 chassis cab", "E-Series cutaway and stripped chassis"],
    cityInTitle: false,
    opened: 1974,
    acres: 419,
    status: "building",
    xy: at("ohio-assembly"),
  },
  {
    id: "chicago-assembly",
    title: "Chicago Assembly",
    name: "Chicago Assembly Plant",
    city: "Chicago",
    state: "IL",
    models: ["Explorer", "Police Interceptor Utility", "Lincoln Aviator"],
    cityInTitle: true,
    opened: 1924,
    acres: 113,
    status: "building",
    xy: at("chicago-assembly"),
  },
  {
    id: "kansas-city",
    title: "Kansas City Assembly",
    name: "Kansas City Assembly Plant",
    city: "Claycomo",
    state: "MO",
    models: ["F-150", "Transit", "E-Transit"],
    cityInTitle: false,
    opened: 1951,
    acres: 1269,
    status: "building",
    xy: at("kansas-city"),
  },
  {
    id: "kentucky-truck",
    title: "Kentucky Truck",
    name: "Kentucky Truck Plant",
    city: "Louisville",
    state: "KY",
    models: ["Super Duty F-250 to F-550", "Expedition", "Lincoln Navigator"],
    cityInTitle: false,
    opened: 1969,
    acres: 500,
    status: "building",
    xy: at("kentucky-truck"),
  },
  {
    id: "louisville-assembly",
    title: "Louisville Assembly",
    name: "Louisville Assembly Plant",
    city: "Louisville",
    state: "KY",
    // Ford's words: "Currently retooling for the mid-sized electric truck. First
    // vehicle off Universal EV platform."
    models: ["Retooling for the mid-sized electric truck"],
    cityInTitle: true,
    status: "retooling",
    xy: at("louisville-assembly"),
  },
];

/** Every nameplate those plants build, as Ford lists them (the list above, once each). */
export const MODEL_NAMES = [
  "Mustang",
  "Bronco",
  "Ranger",
  "F-150",
  "Super Duty",
  "Explorer",
  "Expedition",
  "Transit",
  "E-Transit",
  "E-Series",
  "F-650",
  "F-750",
  "Police Interceptor Utility",
  "Lincoln Aviator",
  "Lincoln Navigator",
];

export const PLANT_BY_ID: Record<string, FordPlant> = Object.fromEntries(PLANTS.map((p) => [p.id, p]));

export const STATE_NAMES: Record<StateCode, string> = {
  MI: "Michigan",
  OH: "Ohio",
  IL: "Illinois",
  MO: "Missouri",
  KY: "Kentucky",
};

/** How many of them are building vehicles today. */
export const PLANTS_BUILDING = PLANTS.filter((p) => p.status === "building").length;
/** The states they stand in. */
export const PLANT_STATES = Array.from(new Set(PLANTS.map((p) => p.state)));
