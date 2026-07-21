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
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
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
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
      const noiseValue = fbm(nx * 4 - 80, ny * 4 + 120, seed + 733);
      const base = moisture[idx] * 0.6 + (1 - Math.abs(ny)) * 0.2 + noiseValue * 0.2;
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
  const relief: number[] = new Array(width * height);
  const moisture: number[] = new Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
      const distance = Math.sqrt(nx * nx + ny * ny);
      const elevation = fbm(nx * 4, ny * 4, seed) - distance * 0.7;
      const moistureValue = fbm(nx * 6 + 100, ny * 6 + 200, seed + 1337);
      const idx = y * width + x;
      relief[idx] = clamp(Math.pow(elevation + 0.5, 1.25));
      moisture[idx] = clamp(moistureValue);
    }
  }
  const temperature = generateTemperatureLayer(width, height, seed + 321);
  const vegetation = generateVegetationLayer(width, height, seed + 555, moisture);
  return {
    width,
    height,
    relief: smoothLayer(relief, width, height, 2),
    moisture,
    water_level: waterLevel,
    seed,
    cities: [],
    roads: [],
    temperature,
    vegetation,
  };
}

export function normalizeLayer(values: number[], width: number, height: number) {
  const smoothed = smoothLayer(values, width, height, 1);
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
  const width = map.width;
  const height = map.height;
  const total = width * height;
  const extended = map as MapStateExtended;
  const moisture =
    map.moisture.length === total ? map.moisture : new Array(total).fill(0.5);
  const temperature =
    extended.temperature && extended.temperature.length === total
      ? extended.temperature
      : generateTemperatureLayer(width, height, map.seed + 777);
  const vegetation =
    extended.vegetation && extended.vegetation.length === total
      ? extended.vegetation
      : generateVegetationLayer(width, height, map.seed + 999, moisture);
  return {
    ...map,
    moisture,
    temperature,
    vegetation,
  };
}
