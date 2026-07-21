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

export async function getCityMap(cityId: string): Promise<CityMap | null> {
  return await invokeOrThrow<CityMap | null>("get_city_map", {
    cityId,
    city_id: cityId,
  });
}

export async function saveCityMap(cityId: string, map: CityMap): Promise<CityMap> {
  return await invokeOrThrow<CityMap>("save_city_map", {
    cityId,
    city_id: cityId,
    map,
  });
}
