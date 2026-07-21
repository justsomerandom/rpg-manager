import type { Biome, ToolGroup, PrimaryAction } from "./types";

export const MAP_DEFAULT_SIZE = 96;
export const DEFAULT_WATER_LEVEL = 0.42;
export const MAP_SIZE_CHOICES = [64, 96, 128, 160];
export const TILE_BASE = 28;
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.75;
export const SNAP_THRESHOLD = 0.03;
export const RELIEF_INTENSITY = 0.035;
export const CLIMATE_INTENSITY = 0.025;

export const CLIMATE_LAYERS: Array<{
  key: "moisture" | "temperature" | "vegetation";
  label: string;
  minLabel: string;
  maxLabel: string;
}> = [
  { key: "moisture", label: "Humidity", minLabel: "Arid", maxLabel: "Wet" },
  { key: "temperature", label: "Temperature", minLabel: "Cold", maxLabel: "Hot" },
  { key: "vegetation", label: "Vegetation", minLabel: "Barren", maxLabel: "Lush" },
];

export const BIOME_COLORS: Record<Biome, [number, number, number]> = {
  ocean: [6, 32, 52],
  shallow: [25, 65, 93],
  reef: [41, 99, 126],
  beach: [205, 186, 143],
  mangrove: [39, 91, 80],
  wetland: [48, 96, 71],
  plains: [83, 130, 76],
  meadow: [114, 150, 88],
  forest: [44, 95, 66],
  rainforest: [27, 84, 53],
  boreal_forest: [35, 80, 72],
  hilly_forest: [57, 112, 85],
  jungle: [22, 70, 50],
  swamp: [58, 96, 65],
  fen: [77, 111, 83],
  savanna: [160, 133, 73],
  steppe: [133, 125, 96],
  badlands: [146, 102, 66],
  desert: [213, 174, 98],
  crystal_desert: [228, 198, 171],
  salt_flat: [200, 205, 203],
  tundra: [156, 161, 178],
  icy_plains: [192, 216, 231],
  glacier: [221, 234, 241],
  mountain: [121, 112, 120],
  highland: [107, 126, 112],
  hills: [132, 147, 118],
  basalt_fields: [74, 65, 66],
  lava_lake: [203, 74, 44],
  obsidian_ridge: [44, 38, 46],
  hot_springs: [116, 185, 188],
  volcanic_forest: [72, 102, 71],
  snow: [238, 242, 247],
};

export const BIOME_TARGETS: Record<
  Biome,
  { relief: number; moisture: number; temperature: number; vegetation: number }
> = {
  ocean: { relief: 0.05, moisture: 0.95, temperature: 0.45, vegetation: 0.2 },
  shallow: { relief: 0.15, moisture: 0.85, temperature: 0.5, vegetation: 0.35 },
  reef: { relief: 0.18, moisture: 0.8, temperature: 0.55, vegetation: 0.4 },
  beach: { relief: 0.22, moisture: 0.55, temperature: 0.65, vegetation: 0.25 },
  mangrove: { relief: 0.27, moisture: 0.95, temperature: 0.7, vegetation: 0.85 },
  wetland: { relief: 0.3, moisture: 0.88, temperature: 0.55, vegetation: 0.8 },
  plains: { relief: 0.45, moisture: 0.55, temperature: 0.6, vegetation: 0.55 },
  meadow: { relief: 0.42, moisture: 0.58, temperature: 0.55, vegetation: 0.6 },
  forest: { relief: 0.5, moisture: 0.65, temperature: 0.55, vegetation: 0.75 },
  rainforest: { relief: 0.55, moisture: 0.9, temperature: 0.8, vegetation: 0.9 },
  boreal_forest: { relief: 0.58, moisture: 0.55, temperature: 0.35, vegetation: 0.75 },
  hilly_forest: { relief: 0.65, moisture: 0.6, temperature: 0.55, vegetation: 0.7 },
  jungle: { relief: 0.5, moisture: 0.85, temperature: 0.78, vegetation: 0.86 },
  swamp: { relief: 0.35, moisture: 0.9, temperature: 0.6, vegetation: 0.8 },
  fen: { relief: 0.38, moisture: 0.82, temperature: 0.45, vegetation: 0.72 },
  savanna: { relief: 0.48, moisture: 0.45, temperature: 0.7, vegetation: 0.4 },
  steppe: { relief: 0.43, moisture: 0.35, temperature: 0.5, vegetation: 0.32 },
  badlands: { relief: 0.6, moisture: 0.25, temperature: 0.7, vegetation: 0.18 },
  desert: { relief: 0.52, moisture: 0.1, temperature: 0.82, vegetation: 0.1 },
  crystal_desert: { relief: 0.57, moisture: 0.12, temperature: 0.7, vegetation: 0.08 },
  salt_flat: { relief: 0.4, moisture: 0.1, temperature: 0.65, vegetation: 0.05 },
  tundra: { relief: 0.6, moisture: 0.28, temperature: 0.2, vegetation: 0.2 },
  icy_plains: { relief: 0.42, moisture: 0.35, temperature: 0.17, vegetation: 0.18 },
  glacier: { relief: 0.65, moisture: 0.3, temperature: 0.1, vegetation: 0.1 },
  mountain: { relief: 0.88, moisture: 0.35, temperature: 0.35, vegetation: 0.25 },
  highland: { relief: 0.75, moisture: 0.45, temperature: 0.45, vegetation: 0.4 },
  hills: { relief: 0.65, moisture: 0.5, temperature: 0.5, vegetation: 0.5 },
  basalt_fields: { relief: 0.78, moisture: 0.22, temperature: 0.85, vegetation: 0.15 },
  lava_lake: { relief: 0.82, moisture: 0.2, temperature: 0.95, vegetation: 0.05 },
  obsidian_ridge: { relief: 0.92, moisture: 0.18, temperature: 0.8, vegetation: 0.05 },
  hot_springs: { relief: 0.72, moisture: 0.6, temperature: 0.7, vegetation: 0.45 },
  volcanic_forest: { relief: 0.68, moisture: 0.65, temperature: 0.7, vegetation: 0.65 },
  snow: { relief: 0.92, moisture: 0.4, temperature: 0.15, vegetation: 0.15 },
};

export const BIOME_GROUPS: Array<{ label: string; description: string; biomes: Biome[] }> = [
  {
    label: "Oceanic",
    description: "Seas, coasts, and river mouths",
    biomes: ["ocean", "shallow", "reef", "beach", "mangrove", "wetland"],
  },
  {
    label: "Temperate",
    description: "Mild climates, mixed woodlands",
    biomes: ["plains", "meadow", "forest", "hilly_forest", "savanna", "fen"],
  },
  {
    label: "Tropical",
    description: "Warm lush regions",
    biomes: ["jungle", "rainforest", "swamp", "volcanic_forest"],
  },
  {
    label: "Arid",
    description: "Dry windswept lands",
    biomes: ["steppe", "badlands", "desert", "crystal_desert", "salt_flat"],
  },
  {
    label: "Polar",
    description: "Frozen tundra and snow fields",
    biomes: ["tundra", "icy_plains", "glacier", "snow"],
  },
  {
    label: "Highlands",
    description: "Elevated ridges and slopes",
    biomes: ["highland", "hills", "mountain", "boreal_forest"],
  },
  {
    label: "Volcanic",
    description: "Heat, magma, and thermal pools",
    biomes: ["basalt_fields", "lava_lake", "obsidian_ridge", "hot_springs"],
  },
];

export const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  general: "General",
  biome: "Biome",
  relief: "Relief",
  locations: "Locations",
};

export const PRIMARY_ACTION_LABEL: Record<PrimaryAction, string> = {
  navigate: "Navigate / select",
  "paint-biome": "Paint biome",
  "raise-relief": "Raise relief",
  "lower-relief": "Lower relief",
  "raise-moisture": "Raise humidity",
  "lower-moisture": "Lower humidity",
  "raise-temperature": "Raise temperature",
  "lower-temperature": "Lower temperature",
  "raise-vegetation": "Raise vegetation",
  "lower-vegetation": "Lower vegetation",
  "place-city": "Add city",
  "add-road": "Add road",
};

export const ACTION_CURSOR: Record<PrimaryAction, string> = {
  navigate: "grab",
  "paint-biome": "crosshair",
  "raise-relief": "crosshair",
  "lower-relief": "crosshair",
  "raise-moisture": "crosshair",
  "lower-moisture": "crosshair",
  "raise-temperature": "crosshair",
  "lower-temperature": "crosshair",
  "raise-vegetation": "crosshair",
  "lower-vegetation": "crosshair",
  "place-city": "copy",
  "add-road": "cell",
};

export const BRUSH_ACTIONS: ReadonlySet<PrimaryAction> = new Set<PrimaryAction>([
  "paint-biome",
  "raise-relief",
  "lower-relief",
  "raise-moisture",
  "lower-moisture",
  "raise-temperature",
  "lower-temperature",
  "raise-vegetation",
  "lower-vegetation",
]);
