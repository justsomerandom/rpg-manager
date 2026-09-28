import type { MapStateExtended, Biome } from "./types";
import { BIOME_TARGETS } from "./constants";

const LAND_BIOMES = Object.keys(BIOME_TARGETS).filter(
  (biome) => !["ocean", "shallow", "reef", "beach", "mangrove", "wetland"].includes(biome),
) as Biome[];

export function computeBiome(map: MapStateExtended, idx: number): Biome {
  const relief = map.relief[idx];
  const moisture = map.moisture[idx];
  const temperature = map.temperature[idx];
  const vegetation = map.vegetation[idx];
  const seaLevel = map.water_level;

  if (![relief, moisture, temperature, vegetation, seaLevel].every(Number.isFinite)) {
    return "plains";
  }

  const depth = relief - seaLevel;
  if (depth <= -0.12) return "ocean";
  if (depth <= -0.025) {
    if (moisture >= 0.84 && temperature >= 0.62 && vegetation >= 0.58) {
      return "mangrove";
    }
    if (temperature >= 0.58 && vegetation >= 0.34) return "reef";
    return "shallow";
  }
  if (depth <= 0.035) {
    if (moisture >= 0.72 && vegetation >= 0.52) return "wetland";
    if (temperature >= 0.62 && moisture < 0.72) return "beach";
    return "reef";
  }

  let nearest: Biome = "plains";
  let nearestScore = Infinity;
  for (const biome of LAND_BIOMES) {
    const target = BIOME_TARGETS[biome];
    const reliefDelta = relief - target.relief;
    const moistureDelta = moisture - target.moisture;
    const temperatureDelta = temperature - target.temperature;
    const vegetationDelta = vegetation - target.vegetation;
    const score =
      reliefDelta * reliefDelta * 1.8 +
      moistureDelta * moistureDelta +
      temperatureDelta * temperatureDelta * 1.15 +
      vegetationDelta * vegetationDelta * 0.8;
    if (score < nearestScore) {
      nearestScore = score;
      nearest = biome;
    }
  }
  return nearest;
}

export function buildBiomeGrid(map: MapStateExtended): Biome[] {
  const grid: Biome[] = new Array(map.width * map.height);
  for (let i = 0; i < grid.length; i += 1) {
    grid[i] = computeBiome(map, i);
  }
  return grid;
}
