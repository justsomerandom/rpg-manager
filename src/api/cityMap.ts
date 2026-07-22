import { invokeOrThrow } from "./client";

export type CityRoadPoint = {
  id: string;
  x: number;
  y: number;
};

export type CityMapPoint = {
  x: number;
  y: number;
};

export type CityEntitySource = "generated" | "manual" | "legacy";
export type CityType = "capital" | "trade" | "port" | "fortress" | "industrial" | "rural";
export type CityLayout = "ring" | "grid" | "radial" | "organic";
export type CityBuildingUse =
  | "residential"
  | "commercial"
  | "industrial"
  | "civic"
  | "landmark";
export type CityDistrictUse =
  | "civic"
  | "commercial"
  | "residential"
  | "industrial"
  | "harbor"
  | "green"
  | "mixed";

export type CityEntrance = {
  id: string;
  world_road_id: string;
  angle: number;
  road_class: "arterial" | "road";
};

export type CityRoad = {
  id: string;
  name: string;
  importance: "main" | "secondary" | "alley";
  tier?: 1 | 2 | 3 | 4 | 5 | null;
  external_connection_index?: number | null;
  external_connection_id?: string | null;
  source?: CityEntitySource;
  locked?: boolean;
  points: CityRoadPoint[];
};

export type CityBuilding = {
  id: string;
  name: string;
  kind: CityBuildingUse | "private" | "public" | "market" | "utility";
  x: number;
  y: number;
  footprint: number;
  width?: number | null;
  height?: number | null;
  rotation?: number | null;
  role?: string | null;
  district?: "centre" | "midtown" | "edge" | "outskirts" | null;
  district_id?: string | null;
  source?: CityEntitySource;
  locked?: boolean;
};

export type CitySize = "village" | "town" | "city" | "megapolis";

export type CityDistrict = {
  id: string;
  name: string;
  kind: CityDistrictUse | "centre" | "market" | "downtown" | "ward" | "edge" | "outskirts";
  x: number;
  y: number;
  radius: number;
  color: string;
  points?: CityMapPoint[];
  source?: CityEntitySource;
  locked?: boolean;
};

export type CityMap = {
  schema_version?: number;
  city_id: string;
  city_type?: CityType;
  size_label: CitySize;
  width: number;
  height: number;
  seed: number;
  scale?: number;
  density?: number;
  road_architecture?: CityLayout | "star";
  road_theme?: "western" | "mediterranean" | "nordic" | "elvish" | "dwarven" | "imperial" | "scifi" | "cyberpunk";
  external_connections?: number[];
  entrances?: CityEntrance[];
  districts?: CityDistrict[];
  roads: CityRoad[];
  buildings: CityBuilding[];
};

const CITY_SIZES: ReadonlySet<CitySize> = new Set(["village", "town", "city", "megapolis"]);
const CITY_TYPES = new Set<CityType>(["capital", "trade", "port", "fortress", "industrial", "rural"]);
const ROAD_ARCHITECTURES = new Set<CityLayout>(["ring", "grid", "radial", "organic"]);
const ROAD_THEMES = new Set(["western", "mediterranean", "nordic", "elvish", "dwarven", "imperial", "scifi", "cyberpunk"]);
const BUILDING_KINDS = new Set<CityBuildingUse>(["residential", "commercial", "industrial", "civic", "landmark"]);
const DISTRICT_KINDS = new Set<CityDistrictUse>(["civic", "commercial", "residential", "industrial", "harbor", "green", "mixed"]);
const ENTITY_SOURCES = new Set<CityEntitySource>(["generated", "manual", "legacy"]);
const MAX_CITY_ROADS = 10_000;
const MAX_CITY_ROAD_POINTS = 200_000;
const MAX_CITY_BUILDINGS = 100_000;
const MAX_CITY_DISTRICTS = 100;
const MAX_CITY_ENTRANCES = 1_000;

const LEGACY_BUILDING_KIND: Record<string, CityBuildingUse> = {
  private: "residential",
  public: "civic",
  market: "commercial",
  utility: "industrial",
};

const LEGACY_DISTRICT_KIND: Record<string, CityDistrictUse> = {
  centre: "civic",
  market: "commercial",
  downtown: "commercial",
  ward: "mixed",
  edge: "residential",
  outskirts: "residential",
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeText(value: unknown, fallback: string, maxLength = 120) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

export function normalizeCityMap(raw: CityMap, cityId: string): CityMap {
  const map = raw as CityMap;
  const size = CITY_SIZES.has(map.size_label) ? map.size_label : "town";
  const architectureCandidate = map.road_architecture === "star" ? "radial" : map.road_architecture;
  const architecture: CityLayout = ROAD_ARCHITECTURES.has(architectureCandidate as CityLayout)
    ? architectureCandidate as CityLayout
    : "ring";
  // Older backend defaults used "fantasy", which was never a valid naming theme.
  const theme = ROAD_THEMES.has(map.road_theme ?? "") ? map.road_theme! : "elvish";
  const rawRoads = Array.isArray(map.roads) ? map.roads : [];
  if (rawRoads.length > MAX_CITY_ROADS) {
    throw new Error(`City map contains ${rawRoads.length} roads; the limit is ${MAX_CITY_ROADS}.`);
  }
  let totalRoadPoints = 0;
  const roads = rawRoads.flatMap((road, roadIndex) => {
    if (!road || !Array.isArray(road.points)) return [];
    totalRoadPoints += road.points.length;
    if (totalRoadPoints > MAX_CITY_ROAD_POINTS) {
      throw new Error(`City map contains more than ${MAX_CITY_ROAD_POINTS} road points.`);
    }
    const points = road.points.flatMap((point, pointIndex) =>
      point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? [{
            id: safeText(point.id, `road-${roadIndex}-point-${pointIndex}`, 128),
            x: clamp(point.x),
            y: clamp(point.y),
          }]
        : []
    );
    if (points.length < 2) return [];
    const importance: CityRoad["importance"] = road.importance === "secondary" || road.importance === "alley"
      ? road.importance
      : "main";
    return [{
      id: safeText(road.id, `road-${roadIndex}`, 128),
      name: safeText(road.name, `Road ${roadIndex + 1}`),
      importance,
      tier: clamp(Math.round(finiteNumber(road.tier, 1)), 1, 5) as 1 | 2 | 3 | 4 | 5,
      external_connection_index: Number.isInteger(road.external_connection_index) && road.external_connection_index! >= 0
        ? Math.min(MAX_CITY_ENTRANCES - 1, road.external_connection_index!)
        : undefined,
      external_connection_id: typeof road.external_connection_id === "string" && road.external_connection_id.trim()
        ? road.external_connection_id.trim().slice(0, 128)
        : undefined,
      source: ENTITY_SOURCES.has(road.source as CityEntitySource) ? road.source : "legacy",
      locked: Boolean(road.locked),
      points,
    }];
  });
  const rawBuildings = Array.isArray(map.buildings) ? map.buildings : [];
  if (rawBuildings.length > MAX_CITY_BUILDINGS) {
    throw new Error(`City map contains ${rawBuildings.length} buildings; the limit is ${MAX_CITY_BUILDINGS}.`);
  }
  const buildings = rawBuildings.flatMap((building, index) => {
    if (!building || !Number.isFinite(building.x) || !Number.isFinite(building.y)) return [];
    const migratedKind = LEGACY_BUILDING_KIND[building.kind] ?? building.kind;
    const kind: CityBuildingUse = BUILDING_KINDS.has(migratedKind as CityBuildingUse)
      ? migratedKind as CityBuildingUse
      : "residential";
    const footprint = clamp(finiteNumber(building.footprint, 0.012), 0.002, 0.2);
    const district = building.district && ["centre", "midtown", "edge", "outskirts"].includes(building.district)
      ? building.district
      : undefined;
    return [{
      id: safeText(building.id, `building-${index}`, 128),
      name: safeText(building.name, `Building ${index + 1}`),
      kind,
      x: clamp(building.x),
      y: clamp(building.y),
      footprint,
      width: building.width === undefined ? undefined : clamp(finiteNumber(building.width, footprint), 0.002, 0.25),
      height: building.height === undefined ? undefined : clamp(finiteNumber(building.height, footprint * 1.4), 0.002, 0.25),
      rotation: building.rotation === undefined ? undefined : finiteNumber(building.rotation, 0),
      role: typeof building.role === "string" && building.role.trim() ? building.role.trim().slice(0, 120) : undefined,
      district,
      district_id: typeof building.district_id === "string" && building.district_id.trim()
        ? building.district_id.trim().slice(0, 128)
        : undefined,
      source: ENTITY_SOURCES.has(building.source as CityEntitySource) ? building.source : "legacy",
      locked: Boolean(building.locked || building.role),
    }];
  });
  const rawDistricts = Array.isArray(map.districts) ? map.districts : [];
  if (rawDistricts.length > MAX_CITY_DISTRICTS) {
    throw new Error(`City map contains ${rawDistricts.length} districts; the limit is ${MAX_CITY_DISTRICTS}.`);
  }
  const districts = rawDistricts.flatMap((district, index) => {
    if (!district || !Number.isFinite(district.x) || !Number.isFinite(district.y) || !Number.isFinite(district.radius)) return [];
    const migratedKind = LEGACY_DISTRICT_KIND[district.kind] ?? district.kind;
    const kind: CityDistrictUse = DISTRICT_KINDS.has(migratedKind as CityDistrictUse)
      ? migratedKind as CityDistrictUse
      : "mixed";
    if (Array.isArray(district.points) && district.points.length > 256) {
      throw new Error(`District '${safeText(district.name, `District ${index + 1}`)}' contains more than 256 vertices.`);
    }
    const points = Array.isArray(district.points)
      ? district.points.flatMap((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? [{ x: clamp(point.x), y: clamp(point.y) }]
        : [])
      : undefined;
    return [{
      id: safeText(district.id, `district-${index}`, 128),
      name: safeText(district.name, `District ${index + 1}`),
      kind,
      x: clamp(district.x),
      y: clamp(district.y),
      radius: clamp(district.radius, 0.02, 0.5),
      color: typeof district.color === "string" && /^#[0-9a-f]{6}$/i.test(district.color)
        ? district.color
        : "#1f9c73",
      points: points && points.length >= 3 ? points : undefined,
      source: ENTITY_SOURCES.has(district.source as CityEntitySource) ? district.source : "legacy",
      locked: Boolean(district.locked),
    }];
  });
  const rawExternalConnections = Array.isArray(map.external_connections) ? map.external_connections : [];
  if (rawExternalConnections.length > MAX_CITY_ENTRANCES) {
    throw new Error(`City map contains more than ${MAX_CITY_ENTRANCES} external connections.`);
  }
  const externalConnections = rawExternalConnections
    .flatMap((angle) => typeof angle === "number" && Number.isFinite(angle)
      ? [Math.atan2(Math.sin(angle), Math.cos(angle))]
      : []);
  const rawEntrances = Array.isArray(map.entrances) ? map.entrances : [];
  if (rawEntrances.length > MAX_CITY_ENTRANCES) {
    throw new Error(`City map contains more than ${MAX_CITY_ENTRANCES} entrances.`);
  }
  const entrances: CityEntrance[] = rawEntrances.flatMap((entrance, index) => {
    if (!entrance || !Number.isFinite(entrance.angle)) return [];
    return [{
      id: safeText(entrance.id, `entrance-${index}`, 128),
      world_road_id: safeText(entrance.world_road_id, `legacy-road-${index}`, 128),
      angle: Math.atan2(Math.sin(entrance.angle), Math.cos(entrance.angle)),
      road_class: entrance.road_class === "road" ? "road" : "arterial",
    }];
  });
  if (!entrances.length) {
    externalConnections.forEach((angle, index) => entrances.push({
      id: `legacy-entrance-${index}`,
      world_road_id: `legacy-road-${index}`,
      angle,
      road_class: "arterial",
    }));
  }
  const entranceIds = new Set(entrances.map((entrance) => entrance.id));
  const districtIds = new Set(districts.map((district) => district.id));

  return {
    schema_version: 2,
    city_id: cityId,
    city_type: CITY_TYPES.has(map.city_type as CityType) ? map.city_type : "trade",
    size_label: size,
    width: 1,
    height: 1,
    seed: Number.isSafeInteger(map.seed) && map.seed >= 0 ? map.seed : Date.now(),
    scale: clamp(finiteNumber(map.scale, 1), 0.5, 2.5),
    density: clamp(finiteNumber(map.density, 0.85), 0.35, 1.5),
    road_architecture: architecture,
    road_theme: theme,
    external_connections: externalConnections,
    entrances,
    districts,
    roads: roads.map((road) => ({
      ...road,
      external_connection_index:
        road.external_connection_index !== undefined && road.external_connection_index < externalConnections.length
          ? road.external_connection_index
          : undefined,
      external_connection_id: road.external_connection_id && entranceIds.has(road.external_connection_id)
        ? road.external_connection_id
        : undefined,
    })),
    buildings: buildings.map((building) => ({
      ...building,
      district_id: building.district_id && districtIds.has(building.district_id)
        ? building.district_id
        : undefined,
    })),
  };
}

export async function getCityMap(worldId: string, cityId: string): Promise<CityMap | null> {
  const map = await invokeOrThrow<CityMap | null>("get_city_map", {
    worldId,
    cityId,
  });
  return map ? normalizeCityMap(map, cityId) : null;
}

export async function saveCityMap(worldId: string, cityId: string, map: CityMap): Promise<CityMap> {
  const saved = await invokeOrThrow<CityMap>("save_city_map", {
    worldId,
    cityId,
    map: normalizeCityMap(map, cityId),
  });
  return normalizeCityMap(saved, cityId);
}

export async function deleteCityMap(worldId: string, cityId: string): Promise<void> {
  await invokeOrThrow<void>("delete_city_map", { worldId, cityId });
}
