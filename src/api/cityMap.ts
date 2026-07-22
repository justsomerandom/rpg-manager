import { invokeOrThrow } from "./client";

export type CityRoadPoint = {
  id: string;
  x: number;
  y: number;
};

export type CityRoad = {
  id: string;
  name: string;
  importance: "main" | "secondary" | "alley";
  tier?: 1 | 2 | 3 | 4 | 5;
  external_connection_index?: number;
  points: CityRoadPoint[];
};

export type CityBuilding = {
  id: string;
  name: string;
  kind: "private" | "public" | "market" | "utility";
  x: number;
  y: number;
  footprint: number;
  width?: number;
  height?: number;
  rotation?: number;
  role?: string;
  district?: "centre" | "midtown" | "edge" | "outskirts";
};

export type CitySize = "village" | "town" | "city" | "megapolis";

export type CityDistrict = {
  id: string;
  name: string;
  kind: "centre" | "market" | "downtown" | "ward" | "edge" | "outskirts";
  x: number;
  y: number;
  radius: number;
  color: string;
};

export type CityMap = {
  city_id: string;
  size_label: CitySize;
  width: number;
  height: number;
  seed: number;
  scale?: number;
  road_architecture?: "ring" | "grid" | "star" | "organic";
  road_theme?: "western" | "mediterranean" | "nordic" | "elvish" | "dwarven" | "imperial" | "scifi" | "cyberpunk";
  external_connections?: number[];
  districts?: CityDistrict[];
  roads: CityRoad[];
  buildings: CityBuilding[];
};

const CITY_SIZES: ReadonlySet<CitySize> = new Set(["village", "town", "city", "megapolis"]);
const ROAD_ARCHITECTURES = new Set(["ring", "grid", "star", "organic"]);
const ROAD_THEMES = new Set(["western", "mediterranean", "nordic", "elvish", "dwarven", "imperial", "scifi", "cyberpunk"]);
const BUILDING_KINDS = new Set(["private", "public", "market", "utility"]);
const DISTRICT_KINDS = new Set(["centre", "market", "downtown", "ward", "edge", "outskirts"]);

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
  const architecture = ROAD_ARCHITECTURES.has(map.road_architecture ?? "")
    ? map.road_architecture!
    : "ring";
  // Older backend defaults used "fantasy", which was never a valid naming theme.
  const theme = ROAD_THEMES.has(map.road_theme ?? "") ? map.road_theme! : "elvish";
  const roads = (Array.isArray(map.roads) ? map.roads : []).slice(0, 512).flatMap((road, roadIndex) => {
    if (!road || !Array.isArray(road.points)) return [];
    const points = road.points.slice(0, 1_024).flatMap((point, pointIndex) =>
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
        ? Math.min(31, road.external_connection_index!)
        : undefined,
      points,
    }];
  });
  const buildings = (Array.isArray(map.buildings) ? map.buildings : []).slice(0, 5_000).flatMap((building, index) => {
    if (!building || !Number.isFinite(building.x) || !Number.isFinite(building.y)) return [];
    const kind = BUILDING_KINDS.has(building.kind) ? building.kind : "private";
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
    }];
  });
  const districts = (Array.isArray(map.districts) ? map.districts : []).slice(0, 32).flatMap((district, index) => {
    if (!district || !Number.isFinite(district.x) || !Number.isFinite(district.y) || !Number.isFinite(district.radius)) return [];
    const kind = DISTRICT_KINDS.has(district.kind) ? district.kind : "ward";
    return [{
      id: safeText(district.id, `district-${index}`, 128),
      name: safeText(district.name, `District ${index + 1}`),
      kind,
      x: clamp(district.x),
      y: clamp(district.y),
      radius: clamp(district.radius, 0.02, 0.5),
      color: typeof district.color === "string" && /^#[0-9a-f]{6}$/i.test(district.color)
        ? district.color
        : "#38bdf8",
    }];
  });
  const externalConnections = (Array.isArray(map.external_connections) ? map.external_connections : [])
    .slice(0, 32)
    .flatMap((angle) => typeof angle === "number" && Number.isFinite(angle)
      ? [Math.atan2(Math.sin(angle), Math.cos(angle))]
      : []);

  return {
    city_id: cityId,
    size_label: size,
    width: 1,
    height: 1,
    seed: Number.isSafeInteger(map.seed) && map.seed >= 0 ? map.seed : Date.now(),
    scale: clamp(finiteNumber(map.scale, 1), 0.6, 2),
    road_architecture: architecture,
    road_theme: theme,
    external_connections: externalConnections,
    districts,
    roads: roads.map((road) => ({
      ...road,
      external_connection_index:
        road.external_connection_index !== undefined && road.external_connection_index < externalConnections.length
          ? road.external_connection_index
          : undefined,
    })),
    buildings,
  };
}

export async function getCityMap(cityId: string): Promise<CityMap | null> {
  const map = await invokeOrThrow<CityMap | null>("get_city_map", {
    cityId,
    city_id: cityId,
  });
  return map ? normalizeCityMap(map, cityId) : null;
}

export async function saveCityMap(cityId: string, map: CityMap): Promise<CityMap> {
  const saved = await invokeOrThrow<CityMap>("save_city_map", {
    cityId,
    city_id: cityId,
    map: normalizeCityMap(map, cityId),
  });
  return normalizeCityMap(saved, cityId);
}

export async function deleteCityMap(cityId: string): Promise<void> {
  await invokeOrThrow<void>("delete_city_map", { cityId });
}
