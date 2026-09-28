import type { MapState } from "../../../api/worldMap";
import {
  DEFAULT_WATER_LEVEL,
  MAP_DEFAULT_HEIGHT,
  MAP_DEFAULT_WIDTH,
  MAP_MAX_AXIS,
  MAP_MAX_CELLS,
} from "./constants";
import type { MapStateExtended } from "./types";
import { clamp, fbm } from "./math";
import {
  normalizedPointToTriangleCell,
  triangleCellCenterNormalized,
  triangleCellNeighbors,
  triangleGridSize,
} from "./triangleGrid";

const FBM_MAX = 0.96875;

function signedFbm(x: number, y: number, seed: number) {
  return (fbm(x, y, seed) / FBM_MAX) * 2 - 1;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / Math.max(Number.EPSILON, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function validateWorldMapDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 8 ||
    height < 8 ||
    width > MAP_MAX_AXIS ||
    height > MAP_MAX_AXIS
  ) {
    throw new Error(`Map dimensions must be whole numbers between 8 and ${MAP_MAX_AXIS}.`);
  }
  if (width * height > MAP_MAX_CELLS) {
    throw new Error(
      `Map dimensions may contain at most ${MAP_MAX_CELLS.toLocaleString()} triangular cells.`,
    );
  }
}

export function smoothLayer(values: number[], width: number, height: number, passes = 1) {
  let current = [...values];
  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.slice();
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const index = row * width + column;
        const neighbors = triangleCellNeighbors(column, row, width, height);
        let total = current[index] * 2;
        let weight = 2;
        for (const neighbor of neighbors) {
          total += current[neighbor.index];
          weight += 1;
        }
        next[index] = total / weight;
      }
    }
    current = next;
  }
  return current;
}

export function generateTemperatureLayer(
  width: number,
  height: number,
  seed: number,
  relief?: readonly number[],
) {
  const layer: number[] = new Array(width * height);
  const aspect = triangleGridSize(width, height).width / triangleGridSize(width, height).height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = triangleCellCenterNormalized(x, y, width, height);
      const worldX = (center.x - 0.5) * aspect;
      const worldY = center.y - 0.5;
      const latitude = Math.abs(worldY) * 2;
      const climateNoise = signedFbm(worldX * 2.2 + 50, worldY * 2.2 - 50, seed + 517);
      const index = y * width + x;
      const altitudeCooling = Math.max(0, (relief?.[index] ?? 0.5) - 0.55) * 0.75;
      layer[index] = clamp(0.82 - latitude * 0.68 + climateNoise * 0.12 - altitudeCooling);
    }
  }
  return smoothLayer(layer, width, height, 1);
}

export function generateVegetationLayer(
  width: number,
  height: number,
  seed: number,
  moisture: number[],
  temperature?: readonly number[],
  relief?: readonly number[],
) {
  const layer: number[] = new Array(width * height);
  const aspect = triangleGridSize(width, height).width / triangleGridSize(width, height).height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const center = triangleCellCenterNormalized(x, y, width, height);
      const worldX = (center.x - 0.5) * aspect;
      const worldY = center.y - 0.5;
      const noiseValue = signedFbm(worldX * 3.5 - 80, worldY * 3.5 + 120, seed + 733);
      const climateComfort = 1 - Math.abs((temperature?.[idx] ?? 0.55) - 0.56) * 1.6;
      const altitudePenalty = Math.max(0, (relief?.[idx] ?? 0.5) - 0.62) * 0.7;
      const base =
        (Number.isFinite(moisture[idx]) ? moisture[idx] : 0.5) * 0.66 +
        climateComfort * 0.2 +
        noiseValue * 0.14 -
        altitudePenalty;
      layer[idx] = clamp(base);
    }
  }
  return smoothLayer(layer, width, height, 1);
}

export function generateProceduralMap(
  seed: number,
  waterLevel = DEFAULT_WATER_LEVEL,
  width = MAP_DEFAULT_WIDTH,
  height = MAP_DEFAULT_HEIGHT,
): MapStateExtended {
  validateWorldMapDimensions(width, height);
  const safeSeed = Number.isSafeInteger(seed) && seed >= 0 ? seed : Date.now();
  const safeWaterLevel = clamp(
    Number.isFinite(waterLevel) ? waterLevel : DEFAULT_WATER_LEVEL,
    0.05,
    0.95,
  );
  const relief: number[] = new Array(width * height);
  const moisture: number[] = new Array(width * height);
  const bounds = triangleGridSize(width, height);
  const aspect = bounds.width / bounds.height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = triangleCellCenterNormalized(x, y, width, height);
      const worldX = (center.x - 0.5) * aspect;
      const worldY = center.y - 0.5;
      const warpX = signedFbm(worldX * 1.1 + 18, worldY * 1.1 - 9, safeSeed + 101) * 0.28;
      const warpY = signedFbm(worldX * 1.1 - 27, worldY * 1.1 + 14, safeSeed + 211) * 0.2;
      const warpedX = worldX + warpX;
      const warpedY = worldY + warpY;
      const continental = signedFbm(warpedX * 1.35, warpedY * 1.35, safeSeed);
      const regional = signedFbm(warpedX * 3.4 + 40, warpedY * 3.4 - 35, safeSeed + 541);
      const ridgeNoise = signedFbm(warpedX * 2.35 - 70, warpedY * 2.35 + 55, safeSeed + 887);
      const ridges = Math.pow(clamp(1 - Math.abs(ridgeNoise) * 1.7), 3);
      const edgeDistance = Math.min(center.x, 1 - center.x, center.y, 1 - center.y);
      const oceanShelf = 1 - smoothstep(0.025, 0.15, edgeDistance);
      const elevation =
        0.45 + continental * 0.32 + regional * 0.12 + ridges * 0.28 - oceanShelf * 0.5;
      const moistureNoise = signedFbm(warpedX * 2.7 + 100, warpedY * 2.7 + 200, safeSeed + 1337);
      const prevailingWind = (0.5 - center.x) * 0.09;
      const idx = y * width + x;
      relief[idx] = clamp(elevation);
      moisture[idx] = clamp(
        0.53 + moistureNoise * 0.3 + prevailingWind - Math.max(0, elevation - 0.64) * 0.38,
      );
    }
  }
  const smoothedRelief = smoothLayer(relief, width, height, 2);
  const smoothedMoisture = smoothLayer(moisture, width, height, 1);
  const temperature = generateTemperatureLayer(width, height, safeSeed + 321, smoothedRelief);
  const vegetation = generateVegetationLayer(
    width,
    height,
    safeSeed + 555,
    smoothedMoisture,
    temperature,
    smoothedRelief,
  );
  return {
    grid_kind: "triangle",
    width,
    height,
    relief: smoothedRelief,
    moisture: smoothedMoisture,
    water_level: safeWaterLevel,
    seed: safeSeed,
    cities: [],
    roads: [],
    temperature,
    vegetation,
  };
}

export function normalizeLayer(values: number[], width: number, height: number) {
  const total = width * height;
  const source =
    Array.isArray(values) && values.length === total
      ? values.map((value) => clamp(Number.isFinite(value) ? value : 0.5))
      : new Array(total).fill(0.5);
  const smoothed = smoothLayer(source, width, height, 1);
  let min = Infinity;
  let max = -Infinity;
  for (const value of smoothed) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min || 1;
  return smoothed.map((value) => (value - min) / range);
}

export function ensureExtendedMap(map: MapState): MapStateExtended {
  const width = Number(map.width);
  const height = Number(map.height);
  validateWorldMapDimensions(width, height);
  const total = width * height;
  const extended = map as MapStateExtended;
  const seed = Number.isSafeInteger(map.seed) && map.seed >= 0 ? map.seed : Date.now();
  const waterLevel = clamp(
    Number.isFinite(map.water_level) ? map.water_level : DEFAULT_WATER_LEVEL,
    0.05,
    0.95,
  );
  let generatedFallback: MapStateExtended | null = null;
  const generated = () => {
    generatedFallback ??= generateProceduralMap(seed, waterLevel, width, height);
    return generatedFallback;
  };
  const sanitizeLayer = (values: unknown, fallbackValues: () => number[]) => {
    if (!Array.isArray(values) || values.length !== total) return fallbackValues();
    let fallback: number[] | null = null;
    return values.map((value, index) => {
      if (typeof value === "number" && Number.isFinite(value)) return clamp(value);
      fallback ??= fallbackValues();
      return fallback[index];
    });
  };
  const relief = sanitizeLayer(map.relief, () => generated().relief);
  const moisture = sanitizeLayer(map.moisture, () => generated().moisture);
  const temperature = sanitizeLayer(extended.temperature, () =>
    generateTemperatureLayer(width, height, seed + 777, relief),
  );
  const vegetation = sanitizeLayer(extended.vegetation, () =>
    generateVegetationLayer(width, height, seed + 999, moisture, temperature, relief),
  );
  const compiledImage = (value: unknown) =>
    typeof value === "string" &&
    value.length <= 24 * 1024 * 1024 &&
    /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(value)
      ? value
      : undefined;
  const rawCities = Array.isArray(map.cities) ? map.cities : [];
  if (rawCities.length > 10_000) {
    throw new Error(`Saved map contains ${rawCities.length} locations; the limit is 10,000.`);
  }
  const locationKinds = new Set(["settlement", "port", "fortress", "ruin", "landmark"]);
  const cities = rawCities.flatMap((city, index) => {
    if (!city || !Number.isFinite(city.x) || !Number.isFinite(city.y)) return [];
    const x = clamp(city.x);
    const y = clamp(city.y);
    const cell = normalizedPointToTriangleCell({ x, y }, width, height);
    return [
      {
        id: typeof city.id === "string" && city.id ? city.id.slice(0, 128) : `city-${index}`,
        name:
          typeof city.name === "string" && city.name.trim()
            ? city.name.trim().slice(0, 120)
            : `City ${index + 1}`,
        kind: locationKinds.has(city.kind ?? "") ? city.kind : "settlement",
        x,
        y,
        elevation: Number.isFinite(city.elevation)
          ? clamp(city.elevation)
          : (relief[cell.index] ?? 0),
        population: Number.isFinite(city.population) ? Math.max(0, Math.round(city.population)) : 0,
      },
    ];
  });
  const rawRoads = Array.isArray(map.roads) ? map.roads : [];
  if (rawRoads.length > 25_000) {
    throw new Error(`Saved map contains ${rawRoads.length} roads; the limit is 25,000.`);
  }
  let totalRoadPoints = 0;
  const roads = rawRoads.flatMap((road, index) => {
    if (!road || !Array.isArray(road.points)) return [];
    totalRoadPoints += road.points.length;
    if (totalRoadPoints > 500_000) {
      throw new Error("Saved map contains more than 500,000 road points.");
    }
    const points = road.points.flatMap((point) =>
      point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? [{ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }]
        : [],
    );
    if (points.length < 2) return [];
    return [
      {
        id: typeof road.id === "string" && road.id ? road.id.slice(0, 128) : `road-${index}`,
        from_city_id:
          typeof road.from_city_id === "string" && road.from_city_id.trim()
            ? road.from_city_id.trim().slice(0, 128)
            : `road-${index}-start`,
        to_city_id:
          typeof road.to_city_id === "string" && road.to_city_id.trim()
            ? road.to_city_id.trim().slice(0, 128)
            : `road-${index}-end`,
        points,
      },
    ];
  });
  return {
    ...map,
    grid_kind: "triangle",
    width,
    height,
    seed,
    water_level: waterLevel,
    relief,
    moisture,
    temperature,
    vegetation,
    cities,
    roads,
    compiled_grid: compiledImage(extended.compiled_grid),
    compiled_updated_at: Number.isFinite(extended.compiled_updated_at)
      ? extended.compiled_updated_at
      : undefined,
  };
}
