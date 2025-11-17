import { invoke } from "@tauri-apps/api/core";

export type CityRoadPoint = {
  id: string;
  x: number;
  y: number;
};

export type CityRoad = {
  id: string;
  name: string;
  importance: "main" | "secondary" | "alley";
  points: CityRoadPoint[];
};

export type CityBuilding = {
  id: string;
  name: string;
  kind: "private" | "public" | "market" | "utility";
  x: number;
  y: number;
  footprint: number;
};

export type CitySize = "village" | "town" | "city" | "megapolis";

export type CityMap = {
  city_id: string;
  size_label: CitySize;
  width: number;
  height: number;
  seed: number;
  roads: CityRoad[];
  buildings: CityBuilding[];
};

export async function getCityMap(cityId: string): Promise<CityMap | null> {
  return await invoke<CityMap | null>("get_city_map", {
    cityId,
    city_id: cityId,
  });
}

export async function saveCityMap(cityId: string, map: CityMap): Promise<CityMap> {
  return await invoke<CityMap>("save_city_map", {
    cityId,
    city_id: cityId,
    map,
  });
}
