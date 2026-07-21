import type { MapState } from "../../../api/worldMap";

export type Biome =
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

export type ViewMode = "iso" | "grid";
export type ToolGroup = "general" | "biome" | "relief" | "locations";
export type BiomeToolMode = "palette" | "moisture" | "temperature" | "vegetation";
export type ClimateTarget = "moisture" | "temperature" | "vegetation";
export type PrimaryAction =
  | "navigate"
  | "paint-biome"
  | "raise-relief"
  | "lower-relief"
  | "raise-moisture"
  | "lower-moisture"
  | "raise-temperature"
  | "lower-temperature"
  | "raise-vegetation"
  | "lower-vegetation"
  | "place-city"
  | "add-road";

export type PixelPoint = { x: number; y: number };
export type PanVector = { x: number; y: number };
export type NetworkAnchor = PixelPoint & {
  label: string;
  targetType: "city" | "road" | "free";
  targetId?: string;
};

export type MapStateExtended = MapState & {
  temperature: number[];
  vegetation: number[];
  compiled_grid?: string;
  compiled_iso?: string;
  compiled_updated_at?: number;
};

export type OverlayMode = "biomes" | "relief" | "temperature" | "vegetation";

export type CompiledRenders = { grid: string; iso: string };
