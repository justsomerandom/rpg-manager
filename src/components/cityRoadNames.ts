export type RoadTheme =
  | "western"
  | "mediterranean"
  | "nordic"
  | "elvish"
  | "dwarven"
  | "imperial"
  | "scifi"
  | "cyberpunk";

export const ROAD_THEMES: Array<{ key: RoadTheme; label: string; category: string }> = [
  { key: "western", label: "Western town", category: "Real world" },
  { key: "mediterranean", label: "Mediterranean", category: "Real world" },
  { key: "nordic", label: "Nordic", category: "Real world" },
  { key: "elvish", label: "Elvish", category: "Fantasy" },
  { key: "dwarven", label: "Dwarven", category: "Fantasy" },
  { key: "imperial", label: "Imperial", category: "Fantasy" },
  { key: "scifi", label: "Spacefaring", category: "Science fiction" },
  { key: "cyberpunk", label: "Neon metro", category: "Science fiction" },
];

const DICTIONARIES: Record<RoadTheme, { roots: string[]; suffixes: string[] }> = {
  western: { roots: ["Oak", "Cedar", "Market", "King", "River", "Station", "Mill", "Harbour", "Maple", "Foundry", "Willow", "Church"], suffixes: ["Street", "Road", "Lane", "Avenue", "Way", "Boulevard"] },
  mediterranean: { roots: ["Sole", "Oliva", "Marina", "Piazza", "Rosso", "Vento", "Citrus", "Azzuro", "Terra", "Luna", "Porta", "Vicolo"], suffixes: ["Via", "Corso", "Strada", "Piazza", "Passeggiata"] },
  nordic: { roots: ["Fjord", "Birch", "Raven", "Skald", "Aurora", "Pine", "Hearth", "Wolf", "North", "Iron", "Snow", "Harbour"], suffixes: ["Gate", "Way", "Road", "Lane", "Bridge", "Stræde"] },
  elvish: { roots: ["Ael", "Leth", "Silar", "Elar", "Thalan", "Ithil", "Vael", "Lór", "Nim", "Faer", "Mith", "Ari"], suffixes: ["walk", "glade", "way", "terrace", "bough", "path"] },
  dwarven: { roots: ["Anvil", "Granite", "Deep", "Ember", "Hammer", "Copper", "Forge", "Basalt", "Crown", "Mithril", "Stone", "Hearth"], suffixes: ["Run", "Delve", "Causeway", "Ramp", "Gallery", "Pass"] },
  imperial: { roots: ["Caesar", "Laurel", "Golden", "Triumph", "Senate", "Lion", "Marble", "Eagle", "Legion", "Crown", "Forum", "Regal"], suffixes: ["Avenue", "Forum", "Way", "Processional", "Arcade", "Road"] },
  scifi: { roots: ["Orion", "Nova", "Kepler", "Helix", "Zenith", "Axiom", "Vega", "Solace", "Meridian", "Lagrange", "Pulsar", "Atlas"], suffixes: ["Concourse", "Transit", "Spine", "Arc", "Promenade", "Vector"] },
  cyberpunk: { roots: ["Neon", "Chrome", "Static", "Cinder", "Vector", "Ghost", "Blackout", "Cipher", "Circuit", "Voltage", "Night", "Zero"], suffixes: ["Strip", "Deck", "Arcade", "Sprawl", "Line", "Underpass"] },
};

export function roadName(theme: RoadTheme, index: number, tier: number) {
  const dictionary = DICTIONARIES[theme] ?? DICTIONARIES.elvish;
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const safeTier = Number.isFinite(tier) ? Math.max(1, Math.floor(tier)) : 1;
  const root = dictionary.roots[safeIndex % dictionary.roots.length];
  const suffix = dictionary.suffixes[(safeIndex + safeTier) % dictionary.suffixes.length];
  return `${root} ${suffix}`;
}
