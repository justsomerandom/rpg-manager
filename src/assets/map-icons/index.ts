export const settlementIcons = {
  hamlet: new URL("./settlements/hamlet.svg", import.meta.url).href,
  village: new URL("./settlements/village.svg", import.meta.url).href,
  town: new URL("./settlements/town.svg", import.meta.url).href,
  city: new URL("./settlements/city.svg", import.meta.url).href,
  megapolis: new URL("./settlements/megapolis.svg", import.meta.url).href,
  port: new URL("./settlements/port.svg", import.meta.url).href,
  fort: new URL("./settlements/fort.svg", import.meta.url).href,
  ruin: new URL("./settlements/ruin.svg", import.meta.url).href,
} as const;

export const terrainIcons = {
  mountain: new URL("./terrain/mountain.svg", import.meta.url).href,
  range: new URL("./terrain/range.svg", import.meta.url).href,
  volcano: new URL("./terrain/volcano.svg", import.meta.url).href,
  hills: new URL("./terrain/hills.svg", import.meta.url).href,
  dunes: new URL("./terrain/dunes.svg", import.meta.url).href,
  glacier: new URL("./terrain/glacier.svg", import.meta.url).href,
  crystal_peak: new URL("./terrain/crystal_peak.svg", import.meta.url).href,
  badlands_spire: new URL("./terrain/badlands_spire.svg", import.meta.url).href,
  hot_spring: new URL("./terrain/hot_spring.svg", import.meta.url).href,
} as const;

export type BiomeKey =
  | "ocean"
  | "shallow"
  | "reef"
  | "beach"
  | "mangrove"
  | "wetland"
  | "plains"
  | "meadow"
  | "forest"
  | "rainforest"
  | "boreal_forest"
  | "hilly_forest"
  | "jungle"
  | "swamp"
  | "fen"
  | "savanna"
  | "steppe"
  | "badlands"
  | "desert"
  | "crystal_desert"
  | "salt_flat"
  | "tundra"
  | "icy_plains"
  | "glacier"
  | "mountain"
  | "highland"
  | "hills"
  | "basalt_fields"
  | "lava_lake"
  | "obsidian_ridge"
  | "hot_springs"
  | "volcanic_forest"
  | "snow";

export const vegetationIcons: Record<BiomeKey, string> = {
  ocean: new URL("./vegetation/ocean.svg", import.meta.url).href,
  shallow: new URL("./vegetation/shallow.svg", import.meta.url).href,
  reef: new URL("./vegetation/reef.svg", import.meta.url).href,
  beach: new URL("./vegetation/beach.svg", import.meta.url).href,
  mangrove: new URL("./vegetation/mangrove.svg", import.meta.url).href,
  wetland: new URL("./vegetation/wetland.svg", import.meta.url).href,
  plains: new URL("./vegetation/plains.svg", import.meta.url).href,
  meadow: new URL("./vegetation/meadow.svg", import.meta.url).href,
  forest: new URL("./vegetation/forest.svg", import.meta.url).href,
  rainforest: new URL("./vegetation/rainforest.svg", import.meta.url).href,
  boreal_forest: new URL("./vegetation/boreal_forest.svg", import.meta.url).href,
  hilly_forest: new URL("./vegetation/hilly_forest.svg", import.meta.url).href,
  jungle: new URL("./vegetation/jungle.svg", import.meta.url).href,
  swamp: new URL("./vegetation/swamp.svg", import.meta.url).href,
  fen: new URL("./vegetation/fen.svg", import.meta.url).href,
  savanna: new URL("./vegetation/savanna.svg", import.meta.url).href,
  steppe: new URL("./vegetation/steppe.svg", import.meta.url).href,
  badlands: new URL("./vegetation/badlands.svg", import.meta.url).href,
  desert: new URL("./vegetation/desert.svg", import.meta.url).href,
  crystal_desert: new URL("./vegetation/crystal_desert.svg", import.meta.url).href,
  salt_flat: new URL("./vegetation/salt_flat.svg", import.meta.url).href,
  tundra: new URL("./vegetation/tundra.svg", import.meta.url).href,
  icy_plains: new URL("./vegetation/icy_plains.svg", import.meta.url).href,
  glacier: new URL("./vegetation/glacier.svg", import.meta.url).href,
  mountain: new URL("./vegetation/mountain.svg", import.meta.url).href,
  highland: new URL("./vegetation/highland.svg", import.meta.url).href,
  hills: new URL("./vegetation/hills.svg", import.meta.url).href,
  basalt_fields: new URL("./vegetation/basalt_fields.svg", import.meta.url).href,
  lava_lake: new URL("./vegetation/lava_lake.svg", import.meta.url).href,
  obsidian_ridge: new URL("./vegetation/obsidian_ridge.svg", import.meta.url).href,
  hot_springs: new URL("./vegetation/hot_springs.svg", import.meta.url).href,
  volcanic_forest: new URL("./vegetation/volcanic_forest.svg", import.meta.url).href,
  snow: new URL("./vegetation/snow.svg", import.meta.url).href,
};

export const mapFeatureIcons = {
  ...terrainIcons,
  vegetation: vegetationIcons,
  settlements: settlementIcons,
};
