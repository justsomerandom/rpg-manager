import type { MapStateExtended, Biome } from "./types";
import { pseudoRandom } from "./math";

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

  if (relief <= seaLevel * 0.8) return "ocean";
  if (relief <= seaLevel * 0.9) {
    if (moisture > 0.8) return "mangrove";
    return moisture > 0.4 ? "shallow" : "reef";
  }
  if (relief <= seaLevel + 0.03) {
    if (moisture > 0.75) return "wetland";
    return temperature > 0.65 ? "beach" : "reef";
  }
  if (relief > 0.92) {
    if (temperature > 0.75) return "obsidian_ridge";
    return temperature < 0.2 ? "snow" : "mountain";
  }
  if (relief > 0.85 && temperature > 0.7) {
    return vegetation < 0.25 ? "lava_lake" : "hot_springs";
  }
  if (relief > 0.75) {
    if (temperature < 0.3) return "glacier";
    return moisture > 0.55 ? "highland" : "hills";
  }
  if (temperature < 0.2) {
    return vegetation > 0.35 ? "boreal_forest" : "tundra";
  }
  if (moisture > 0.9) {
    return temperature > 0.65 ? "rainforest" : "swamp";
  }
  if (moisture > 0.75) {
    return vegetation > 0.65 ? "forest" : "hilly_forest";
  }
  if (moisture > 0.6) {
    return vegetation > 0.5 ? "meadow" : "plains";
  }
  if (moisture > 0.45) {
    return temperature > 0.6 ? "savanna" : "plains";
  }
  if (moisture > 0.3) {
    return temperature > 0.55 ? "steppe" : "icy_plains";
  }
  if (temperature > 0.75) {
    return vegetation < 0.25 ? "crystal_desert" : "desert";
  }
  if (vegetation < 0.2) {
    return relief > 0.55 ? "basalt_fields" : "salt_flat";
  }
  return "badlands";
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
  const jittered = loop.map(([x, y], idx) => {
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
    const next = jittered[(i + 1) % n];
    const c2 = mid(next, jittered[(i + 2) % n]);
    path.quadraticCurveTo(next.x, next.y, c2.x, c2.y);
    if (i === n - 2) {
      path.quadraticCurveTo(jittered[n - 1].x, jittered[n - 1].y, start.x, start.y);
      break;
    }
  }
  path.closePath();
  return path;
}
