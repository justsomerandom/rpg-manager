import { invoke } from "@tauri-apps/api/core";

export type MapCity = {
  id: string;
  name: string;
  x: number;
  y: number;
  elevation: number;
  population: number;
};

export type RoadPoint = {
  x: number;
  y: number;
};

export type MapRoad = {
  id: string;
  from_city_id: string;
  to_city_id: string;
  points: RoadPoint[];
};

export type MapState = {
  width: number;
  height: number;
  relief: number[];
  moisture: number[];
  water_level: number;
  seed: number;
  cities: MapCity[];
  roads: MapRoad[];
  temperature?: number[];
  vegetation?: number[];
};

export async function getWorldMap(worldId: string): Promise<MapState | null> {
  return await invoke<MapState | null>("get_world_map", { worldId });
}

export async function saveWorldMap(
  worldId: string,
  map: MapState
): Promise<MapState> {
  return await invoke<MapState>("save_world_map", {
    worldId,
    map,
  });
}

