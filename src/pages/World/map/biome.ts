import type { MapStateExtended, Biome } from "./types";
import { BIOME_TARGETS } from "./constants";
import { pseudoRandom } from "./math";

const LAND_BIOMES = Object.keys(BIOME_TARGETS).filter(
  (biome) => !["ocean", "shallow", "reef", "beach", "mangrove", "wetland"].includes(biome)
) as Biome[];

export function stylizeColor(color: [number, number, number]) {
  const [r, g, b] = color;
  const tinted = [r * 0.9 + 20, g * 0.94 + 14, b * 0.88 + 24];
  return `rgb(${Math.min(255, tinted[0])},${Math.min(255, tinted[1])},${Math.min(
    255,
    tinted[2]
  )})`;
}

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

export function extractBiomeLoops(
  biomeGrid: Biome[],
  width: number,
  height: number,
  target: Biome
): Array<Array<[number, number]>> {
  type Edge = [[number, number], [number, number]];
  const edges: Edge[] = [];
  const idxFor = (x: number, y: number) => y * width + x;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (biomeGrid[idxFor(x, y)] !== target) continue;
      if (y === 0 || biomeGrid[idxFor(x, y - 1)] !== target) {
        edges.push([[x, y], [x + 1, y]]);
      }
      if (x === width - 1 || biomeGrid[idxFor(x + 1, y)] !== target) {
        edges.push([[x + 1, y], [x + 1, y + 1]]);
      }
      if (y === height - 1 || biomeGrid[idxFor(x, y + 1)] !== target) {
        edges.push([[x + 1, y + 1], [x, y + 1]]);
      }
      if (x === 0 || biomeGrid[idxFor(x - 1, y)] !== target) {
        edges.push([[x, y + 1], [x, y]]);
      }
    }
  }

  const adjacency = new Map<string, Array<[number, number]>>();
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  for (const edge of edges) {
    const startKey = key(edge[0]);
    if (!adjacency.has(startKey)) adjacency.set(startKey, []);
    adjacency.get(startKey)!.push(edge[1]);
  }

  const loops: Array<Array<[number, number]>> = [];
  const parseKey = (k: string): [number, number] => {
    const [sx, sy] = k.split(",").map(Number);
    return [sx, sy];
  };

  while (adjacency.size > 0) {
    const [startKey] = adjacency.entries().next().value as [string, [number, number][]];
    const startPoint = parseKey(startKey);
    const path: Array<[number, number]> = [startPoint];
    let currentKey = startKey;
    let safety = 0;
    while (safety < 100000) {
      safety += 1;
      const list = adjacency.get(currentKey);
      if (!list || list.length === 0) {
        adjacency.delete(currentKey);
        break;
      }
      const next = list.pop()!;
      if (list.length === 0) adjacency.delete(currentKey);
      path.push(next);
      const nextKey = key(next);
      if (nextKey === startKey) {
        break;
      }
      currentKey = nextKey;
    }
    if (path.length >= 3) {
      loops.push(path);
    }
  }
  return loops;
}

export function buildSmoothPath(
  loop: Array<[number, number]>,
  cellSize: number,
  jitterScale: number,
  seed: number
): Path2D {
  const normalizedLoop =
    loop.length > 1 &&
    loop[0][0] === loop[loop.length - 1][0] &&
    loop[0][1] === loop[loop.length - 1][1]
      ? loop.slice(0, -1)
      : loop;
  const jittered = normalizedLoop.map(([x, y], idx) => {
    const jx = (pseudoRandom(x + idx * 3, y + seed, seed + 17) - 0.5) * cellSize * jitterScale;
    const jy = (pseudoRandom(x + seed, y + idx * 7, seed + 33) - 0.5) * cellSize * jitterScale;
    return { x: x * cellSize + jx, y: y * cellSize + jy };
  });

  const n = jittered.length;
  const path = new Path2D();
  if (n < 3) return path;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const start = mid(jittered[n - 1], jittered[0]);
  path.moveTo(start.x, start.y);
  for (let i = 0; i < n; i += 1) {
    const current = jittered[i];
    const next = jittered[(i + 1) % n];
    const endpoint = mid(current, next);
    path.quadraticCurveTo(current.x, current.y, endpoint.x, endpoint.y);
  }
  path.closePath();
  return path;
}
