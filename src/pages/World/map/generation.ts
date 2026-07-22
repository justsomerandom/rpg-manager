import type { MapState } from "../../../api/worldMap";
import { DEFAULT_WATER_LEVEL, MAP_DEFAULT_SIZE } from "./constants";
import type { MapStateExtended } from "./types";
import { clamp, fbm } from "./math";

export function smoothLayer(values: number[], width: number, height: number, passes = 1) {
  let current = [...values];
  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        let total = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            total += current[(y + dy) * width + (x + dx)];
          }
        }
        next[y * width + x] = total / 9;
      }
    }
    current = next;
  }
  return current;
}

export function generateTemperatureLayer(width: number, height: number, seed: number) {
  const layer: number[] = new Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1) - 0.5;
      const ny = y / Math.max(1, height - 1) - 0.5;
      const base = 0.6 - Math.abs(ny) * 0.7;
      const noiseValue = fbm(nx * 3 + 50, ny * 3 - 50, seed + 517);
      layer[y * width + x] = clamp(base + noiseValue * 0.35);
    }
  }
  return smoothLayer(layer, width, height, 1);
}

export function generateVegetationLayer(
  width: number,
  height: number,
  seed: number,
  moisture: number[]
) {
  const layer: number[] = new Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const nx = x / Math.max(1, width - 1) - 0.5;
      const ny = y / Math.max(1, height - 1) - 0.5;
      const noiseValue = fbm(nx * 4 - 80, ny * 4 + 120, seed + 733);
      const base = (Number.isFinite(moisture[idx]) ? moisture[idx] : 0.5) * 0.6 + (1 - Math.abs(ny)) * 0.2 + noiseValue * 0.2;
      layer[idx] = clamp(base);
    }
  }
  return smoothLayer(layer, width, height, 1);
}

export function generateProceduralMap(
  seed: number,
  waterLevel = DEFAULT_WATER_LEVEL,
  width = MAP_DEFAULT_SIZE,
  height = MAP_DEFAULT_SIZE
): MapStateExtended {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > 256 || height > 256) {
    throw new Error("Map dimensions must be whole numbers between 8 and 256.");
  }
  const safeSeed = Number.isSafeInteger(seed) && seed >= 0 ? seed : Date.now();
  const safeWaterLevel = clamp(Number.isFinite(waterLevel) ? waterLevel : DEFAULT_WATER_LEVEL, 0.05, 0.95);
  const relief: number[] = new Array(width * height);
  const moisture: number[] = new Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1) - 0.5;
      const ny = y / Math.max(1, height - 1) - 0.5;
      const distance = Math.sqrt(nx * nx + ny * ny);
      const elevation = fbm(nx * 4, ny * 4, safeSeed) - distance * 0.7;
      const moistureValue = fbm(nx * 6 + 100, ny * 6 + 200, safeSeed + 1337);
      const idx = y * width + x;
      relief[idx] = clamp(Math.pow(elevation + 0.5, 1.25));
      moisture[idx] = clamp(moistureValue);
    }
  }
  const temperature = generateTemperatureLayer(width, height, safeSeed + 321);
  const vegetation = generateVegetationLayer(width, height, safeSeed + 555, moisture);
  return {
    width,
    height,
    relief: smoothLayer(relief, width, height, 2),
    moisture,
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
  const source = Array.isArray(values) && values.length === total
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
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > 256 || height > 256) {
    throw new Error("Saved map dimensions are invalid or unsupported (expected 8-256 cells per side).");
  }
  const total = width * height;
  const extended = map as MapStateExtended;
  const seed = Number.isSafeInteger(map.seed) && map.seed >= 0 ? map.seed : Date.now();
  const waterLevel = clamp(Number.isFinite(map.water_level) ? map.water_level : DEFAULT_WATER_LEVEL, 0.05, 0.95);
  const fallback = generateProceduralMap(seed, waterLevel, width, height);
  const sanitizeLayer = (values: unknown, fallbackValues: number[]) =>
    Array.isArray(values) && values.length === total
      ? values.map((value, index) =>
          typeof value === "number" && Number.isFinite(value)
            ? clamp(value)
            : fallbackValues[index]
        )
      : fallbackValues;
  const relief = sanitizeLayer(map.relief, fallback.relief);
  const moisture = sanitizeLayer(map.moisture, fallback.moisture);
  const temperature =
    sanitizeLayer(extended.temperature, generateTemperatureLayer(width, height, seed + 777));
  const vegetation =
    sanitizeLayer(extended.vegetation, generateVegetationLayer(width, height, seed + 999, moisture));
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
    const x = clamp(city.x, 0.5 / width, 1 - 0.5 / width);
    const y = clamp(city.y, 0.5 / height, 1 - 0.5 / height);
    const gridX = clamp(Math.floor(x * width), 0, width - 1);
    const gridY = clamp(Math.floor(y * height), 0, height - 1);
    return [{
      id: typeof city.id === "string" && city.id ? city.id.slice(0, 128) : `city-${index}`,
      name: typeof city.name === "string" && city.name.trim() ? city.name.trim().slice(0, 120) : `City ${index + 1}`,
      kind: locationKinds.has(city.kind ?? "") ? city.kind : "settlement",
      x,
      y,
      elevation: Number.isFinite(city.elevation) ? clamp(city.elevation) : relief[gridY * width + gridX] ?? 0,
      population: Number.isFinite(city.population) ? Math.max(0, Math.round(city.population)) : 0,
    }];
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
        : []
    );
    if (points.length < 2) return [];
    return [{
      id: typeof road.id === "string" && road.id ? road.id.slice(0, 128) : `road-${index}`,
      from_city_id: typeof road.from_city_id === "string" && road.from_city_id.trim()
        ? road.from_city_id.trim().slice(0, 128)
        : `road-${index}-start`,
      to_city_id: typeof road.to_city_id === "string" && road.to_city_id.trim()
        ? road.to_city_id.trim().slice(0, 128)
        : `road-${index}-end`,
      points,
    }];
  });
  return {
    ...map,
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
    compiled_iso: compiledImage(extended.compiled_iso),
    compiled_updated_at: Number.isFinite(extended.compiled_updated_at)
      ? extended.compiled_updated_at
      : undefined,
  };
}
