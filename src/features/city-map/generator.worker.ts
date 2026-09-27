/// <reference lib="webworker" />

import type { CityBuilding, CityTerrainContext } from "../../api/cityMap";
import type { MapCity } from "../../api/worldMap";
import { generateCityPlan, type CityGenerationConfig } from "./generator";

export type CityGenerationWorkerRequest = {
  city: MapCity;
  config: CityGenerationConfig;
  lockedBuildings: CityBuilding[];
  entrances: number[];
  terrain?: CityTerrainContext;
};

export type CityGenerationWorkerResponse =
  { ok: true; map: ReturnType<typeof generateCityPlan> } | { ok: false; error: string };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<CityGenerationWorkerRequest>) => {
  try {
    const { city, config, lockedBuildings, entrances, terrain } = event.data;
    workerScope.postMessage({
      ok: true,
      map: generateCityPlan(city, config, lockedBuildings, entrances, terrain),
    } satisfies CityGenerationWorkerResponse);
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "City generation failed.",
    } satisfies CityGenerationWorkerResponse);
  }
};

export {};
