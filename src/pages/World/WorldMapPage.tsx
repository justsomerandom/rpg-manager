
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, WheelEvent } from "react";
import { useParams } from "react-router-dom";
import {
  getWorldMap,
  saveWorldMap,
  type MapCity,
  type MapState,
} from "../../api/worldMap";
import { CityMapEditor } from "../../components/CityMapEditor";

const MAP_DEFAULT_SIZE = 96;
const DEFAULT_WATER_LEVEL = 0.42;
const MAP_SIZE_CHOICES = [64, 96, 128, 160];
const TILE_BASE = 28;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.75;
const SNAP_THRESHOLD = 0.03;
const RELIEF_INTENSITY = 0.035;
const CLIMATE_INTENSITY = 0.025;

type Biome =
  | "ocean"
  | "shallow"
  | "reef"
  | "beach"
  | "mangrove"
  | "wetland"
  | "plains"
  | "meadow"
  | "forest"
  | "rainforest"
  | "boreal_forest"
  | "hilly_forest"
  | "jungle"
  | "swamp"
  | "fen"
  | "savanna"
  | "steppe"
  | "badlands"
  | "desert"
  | "crystal_desert"
  | "salt_flat"
  | "tundra"
  | "icy_plains"
  | "glacier"
  | "mountain"
  | "highland"
  | "hills"
  | "basalt_fields"
  | "lava_lake"
  | "obsidian_ridge"
  | "hot_springs"
  | "volcanic_forest"
  | "snow";

type ViewMode = "iso" | "grid";
type ToolGroup = "general" | "biome" | "relief" | "locations";
type BiomeToolMode = "palette" | "moisture" | "temperature" | "vegetation";
type ClimateTarget = "moisture" | "temperature" | "vegetation";
type PrimaryAction =
  | "navigate"
  | "paint-biome"
  | "raise-relief"
  | "lower-relief"
  | "raise-moisture"
  | "lower-moisture"
  | "raise-temperature"
  | "lower-temperature"
  | "raise-vegetation"
  | "lower-vegetation"
  | "place-city"
  | "add-road";

type BrushAction =
  | "paint-biome"
  | "raise-relief"
  | "lower-relief"
  | "raise-moisture"
  | "lower-moisture"
  | "raise-temperature"
  | "lower-temperature"
  | "raise-vegetation"
  | "lower-vegetation";

type PixelPoint = { x: number; y: number };
type PanVector = { x: number; y: number };
type NetworkAnchor = PixelPoint & {
  label: string;
  targetType: "city" | "road" | "free";
  targetId?: string;
};

type MapStateExtended = MapState & {
  temperature: number[];
  vegetation: number[];
};

type OverlayMode = "biomes" | "relief" | "temperature" | "vegetation";

const BRUSH_ACTIONS: ReadonlySet<PrimaryAction> = new Set<PrimaryAction>([
  "paint-biome",
  "raise-relief",
  "lower-relief",
  "raise-moisture",
  "lower-moisture",
  "raise-temperature",
  "lower-temperature",
  "raise-vegetation",
  "lower-vegetation",
]);

const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  general: "General",
  biome: "Biome",
  relief: "Relief",
  locations: "Locations",
};

const PRIMARY_ACTION_LABEL: Record<PrimaryAction, string> = {
  navigate: "Navigate / select",
  "paint-biome": "Paint biome",
  "raise-relief": "Raise relief",
  "lower-relief": "Lower relief",
  "raise-moisture": "Raise humidity",
  "lower-moisture": "Lower humidity",
  "raise-temperature": "Raise temperature",
  "lower-temperature": "Lower temperature",
  "raise-vegetation": "Raise vegetation",
  "lower-vegetation": "Lower vegetation",
  "place-city": "Add city",
  "add-road": "Add road",
};

const ACTION_CURSOR: Record<PrimaryAction, string> = {
  navigate: "grab",
  "paint-biome": "crosshair",
  "raise-relief": "crosshair",
  "lower-relief": "crosshair",
  "raise-moisture": "crosshair",
  "lower-moisture": "crosshair",
  "raise-temperature": "crosshair",
  "lower-temperature": "crosshair",
  "raise-vegetation": "crosshair",
  "lower-vegetation": "crosshair",
  "place-city": "copy",
  "add-road": "cell",
};

const CLIMATE_LAYERS: Array<{
  key: ClimateTarget;
  label: string;
  minLabel: string;
  maxLabel: string;
}> = [
  { key: "moisture", label: "Humidity", minLabel: "Arid", maxLabel: "Wet" },
  { key: "temperature", label: "Temperature", minLabel: "Cold", maxLabel: "Hot" },
  { key: "vegetation", label: "Vegetation", minLabel: "Barren", maxLabel: "Lush" },
];
const BIOME_COLORS: Record<Biome, [number, number, number]> = {
  ocean: [6, 32, 52],
  shallow: [25, 65, 93],
  reef: [41, 99, 126],
  beach: [205, 186, 143],
  mangrove: [39, 91, 80],
  wetland: [48, 96, 71],
  plains: [83, 130, 76],
  meadow: [114, 150, 88],
  forest: [44, 95, 66],
  rainforest: [27, 84, 53],
  boreal_forest: [35, 80, 72],
  hilly_forest: [57, 112, 85],
  jungle: [22, 70, 50],
  swamp: [58, 96, 65],
  fen: [77, 111, 83],
  savanna: [160, 133, 73],
  steppe: [133, 125, 96],
  badlands: [146, 102, 66],
  desert: [213, 174, 98],
  crystal_desert: [228, 198, 171],
  salt_flat: [200, 205, 203],
  tundra: [156, 161, 178],
  icy_plains: [192, 216, 231],
  glacier: [221, 234, 241],
  mountain: [121, 112, 120],
  highland: [107, 126, 112],
  hills: [132, 147, 118],
  basalt_fields: [74, 65, 66],
  lava_lake: [203, 74, 44],
  obsidian_ridge: [44, 38, 46],
  hot_springs: [116, 185, 188],
  volcanic_forest: [72, 102, 71],
  snow: [238, 242, 247],
};

const BIOME_TARGETS: Record<
  Biome,
  { relief: number; moisture: number; temperature: number; vegetation: number }
> = {
  ocean: { relief: 0.05, moisture: 0.95, temperature: 0.45, vegetation: 0.2 },
  shallow: { relief: 0.15, moisture: 0.85, temperature: 0.5, vegetation: 0.35 },
  reef: { relief: 0.18, moisture: 0.8, temperature: 0.55, vegetation: 0.4 },
  beach: { relief: 0.22, moisture: 0.55, temperature: 0.65, vegetation: 0.25 },
  mangrove: { relief: 0.27, moisture: 0.95, temperature: 0.7, vegetation: 0.85 },
  wetland: { relief: 0.3, moisture: 0.88, temperature: 0.55, vegetation: 0.8 },
  plains: { relief: 0.45, moisture: 0.55, temperature: 0.6, vegetation: 0.55 },
  meadow: { relief: 0.42, moisture: 0.58, temperature: 0.55, vegetation: 0.6 },
  forest: { relief: 0.5, moisture: 0.65, temperature: 0.55, vegetation: 0.75 },
  rainforest: { relief: 0.55, moisture: 0.9, temperature: 0.8, vegetation: 0.9 },
  boreal_forest: { relief: 0.58, moisture: 0.55, temperature: 0.35, vegetation: 0.75 },
  hilly_forest: { relief: 0.65, moisture: 0.6, temperature: 0.55, vegetation: 0.7 },
  jungle: { relief: 0.5, moisture: 0.85, temperature: 0.78, vegetation: 0.86 },
  swamp: { relief: 0.35, moisture: 0.9, temperature: 0.6, vegetation: 0.8 },
  fen: { relief: 0.38, moisture: 0.82, temperature: 0.45, vegetation: 0.72 },
  savanna: { relief: 0.48, moisture: 0.45, temperature: 0.7, vegetation: 0.4 },
  steppe: { relief: 0.43, moisture: 0.35, temperature: 0.5, vegetation: 0.32 },
  badlands: { relief: 0.6, moisture: 0.25, temperature: 0.7, vegetation: 0.18 },
  desert: { relief: 0.52, moisture: 0.1, temperature: 0.82, vegetation: 0.1 },
  crystal_desert: { relief: 0.57, moisture: 0.12, temperature: 0.7, vegetation: 0.08 },
  salt_flat: { relief: 0.4, moisture: 0.1, temperature: 0.65, vegetation: 0.05 },
  tundra: { relief: 0.6, moisture: 0.28, temperature: 0.2, vegetation: 0.2 },
  icy_plains: { relief: 0.42, moisture: 0.35, temperature: 0.17, vegetation: 0.18 },
  glacier: { relief: 0.65, moisture: 0.3, temperature: 0.1, vegetation: 0.1 },
  mountain: { relief: 0.88, moisture: 0.35, temperature: 0.35, vegetation: 0.25 },
  highland: { relief: 0.75, moisture: 0.45, temperature: 0.45, vegetation: 0.4 },
  hills: { relief: 0.65, moisture: 0.5, temperature: 0.5, vegetation: 0.5 },
  basalt_fields: { relief: 0.78, moisture: 0.22, temperature: 0.85, vegetation: 0.15 },
  lava_lake: { relief: 0.82, moisture: 0.2, temperature: 0.95, vegetation: 0.05 },
  obsidian_ridge: { relief: 0.92, moisture: 0.18, temperature: 0.8, vegetation: 0.05 },
  hot_springs: { relief: 0.72, moisture: 0.6, temperature: 0.7, vegetation: 0.45 },
  volcanic_forest: { relief: 0.68, moisture: 0.65, temperature: 0.7, vegetation: 0.65 },
  snow: { relief: 0.92, moisture: 0.4, temperature: 0.15, vegetation: 0.15 },
};

const BIOME_GROUPS: Array<{ label: string; description: string; biomes: Biome[] }> = [
  {
    label: "Oceanic",
    description: "Seas, coasts, and river mouths",
    biomes: ["ocean", "shallow", "reef", "beach", "mangrove", "wetland"],
  },
  {
    label: "Temperate",
    description: "Mild climates, mixed woodlands",
    biomes: ["plains", "meadow", "forest", "hilly_forest", "savanna", "fen"],
  },
  {
    label: "Tropical",
    description: "Warm lush regions",
    biomes: ["jungle", "rainforest", "swamp", "volcanic_forest"],
  },
  {
    label: "Arid",
    description: "Dry windswept lands",
    biomes: ["steppe", "badlands", "desert", "crystal_desert", "salt_flat"],
  },
  {
    label: "Polar",
    description: "Frozen tundra and snow fields",
    biomes: ["tundra", "icy_plains", "glacier", "snow"],
  },
  {
    label: "Highlands",
    description: "Elevated ridges and slopes",
    biomes: ["highland", "hills", "mountain", "boreal_forest"],
  },
  {
    label: "Volcanic",
    description: "Heat, magma, and thermal pools",
    biomes: ["basalt_fields", "lava_lake", "obsidian_ridge", "hot_springs"],
  },
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function pseudoRandom(x: number, y: number, seed: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 0.001) * 43758.5453;
  return s - Math.floor(s);
}

function noise2D(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const topRight = pseudoRandom(xi + 1, yi + 1, seed);
  const topLeft = pseudoRandom(xi, yi + 1, seed);
  const bottomRight = pseudoRandom(xi + 1, yi, seed);
  const bottomLeft = pseudoRandom(xi, yi, seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const top = topLeft + u * (topRight - topLeft);
  const bottom = bottomLeft + u * (bottomRight - bottomLeft);
  return bottom + v * (top - bottom);
}

function fbm(x: number, y: number, seed: number) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < 5; i += 1) {
    value += amplitude * noise2D(x * frequency, y * frequency, seed + i * 79);
    frequency *= 2;
    amplitude *= 0.5;
  }
  return value;
}

function smoothLayer(values: number[], width: number, height: number, passes = 1) {
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
function generateTemperatureLayer(width: number, height: number, seed: number) {
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

function generateVegetationLayer(width: number, height: number, seed: number, moisture: number[]) {
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

function generateProceduralMap(
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

function normalizeLayer(values: number[], width: number, height: number) {
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

function ensureExtendedMap(map: MapState): MapStateExtended {
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
function computeBiome(map: MapStateExtended, idx: number): Biome {
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

function drawIsometricMap(
  canvas: HTMLCanvasElement | null,
  map: MapStateExtended,
  zoom: number,
  pan: PanVector,
  viewport: { width: number; height: number },
  highlightCityId?: string | null,
  roadDraftStart?: PixelPoint | null,
  overlayMode: OverlayMode = "biomes",
  overlayRanges?: {
    relief?: { min: number; max: number };
    temperature?: { min: number; max: number };
    vegetation?: { min: number; max: number };
  }
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pixelRatio = window.devicePixelRatio ?? 1;
  canvas.width = viewport.width * pixelRatio;
  canvas.height = viewport.height * pixelRatio;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  const tileWidth = TILE_BASE * zoom;
  const tileHeight = tileWidth / 2;
  const originX = viewport.width / 2 + pan.x;
  const originY = tileHeight + pan.y;
  const sumCenter = (map.width - 1 + map.height - 1) / 2;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const idx = y * map.width + x;
      const biome = computeBiome(map, idx);
      const color = BIOME_COLORS[biome];
      const isoX = (x + y - sumCenter) * (tileWidth / 2) + originX;
      const isoY = (y - x) * (tileHeight / 2) + originY;
      ctx.beginPath();
      ctx.moveTo(isoX, isoY);
      ctx.lineTo(isoX + tileWidth / 2, isoY + tileHeight / 2);
      ctx.lineTo(isoX, isoY + tileHeight);
      ctx.lineTo(isoX - tileWidth / 2, isoY + tileHeight / 2);
      ctx.closePath();
      const baseColor = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.fillStyle = baseColor;
      ctx.fill();

      if (overlayMode !== "biomes" && overlayRanges) {
        let overlay: string | null = null;
        if (overlayMode === "relief" && overlayRanges.relief) {
          overlay = reliefOverlayColor(map, map.relief[idx], overlayRanges.relief);
        } else if (overlayMode === "temperature" && overlayRanges.temperature) {
          overlay = temperatureOverlayColor(map.temperature[idx], overlayRanges.temperature);
        } else if (overlayMode === "vegetation" && overlayRanges.vegetation) {
          overlay = vegetationOverlayColor(map.vegetation[idx], overlayRanges.vegetation);
        }
        if (overlay) {
          ctx.save();
          ctx.fillStyle = overlay;
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.strokeStyle = "rgba(8,25,19,0.35)";
      ctx.stroke();
    }
  }

  const drawRoad = (points: PixelPoint[], stroke: string) => {
    if (points.length === 0) return;
    ctx.beginPath();
    const first = points[0];
    const startX =
      ((first.x * map.width + first.y * map.height - sumCenter) *
        (tileWidth / 2)) +
      originX;
    const startY =
      (first.y * map.height - first.x * map.width) * (tileHeight / 2) + originY;
    ctx.moveTo(startX, startY);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      const px =
        ((point.x * map.width + point.y * map.height - sumCenter) *
          (tileWidth / 2)) +
        originX;
      const py =
        (point.y * map.height - point.x * map.width) * (tileHeight / 2) +
        originY;
      ctx.lineTo(px, py);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  };

  map.roads.forEach((road) => drawRoad(road.points, "rgba(224,196,128,0.85)"));
  if (roadDraftStart) {
    drawRoad([roadDraftStart], "rgba(255,198,109,0.8)");
  }

  map.cities.forEach((city) => {
    const isoX =
      ((city.x * map.width + city.y * map.height - sumCenter) *
        (tileWidth / 2)) +
      originX;
    const isoY =
      (city.y * map.height - city.x * map.width) * (tileHeight / 2) + originY;
    ctx.fillStyle = city.id === highlightCityId ? "#ffe066" : "#e3f2db";
    ctx.beginPath();
    ctx.arc(isoX, isoY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = "12px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(city.name, isoX, isoY - 12);
  });
}

function drawGridMap(
  canvas: HTMLCanvasElement | null,
  map: MapStateExtended,
  zoom: number,
  pan: PanVector,
  viewport: { width: number; height: number },
  highlightCityId?: string | null,
  roadDraftStart?: PixelPoint | null,
  overlayMode: OverlayMode = "biomes",
  overlayRanges?: {
    relief?: { min: number; max: number };
    temperature?: { min: number; max: number };
    vegetation?: { min: number; max: number };
  }
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pixelRatio = window.devicePixelRatio ?? 1;
  canvas.width = viewport.width * pixelRatio;
  canvas.height = viewport.height * pixelRatio;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = "#030c07";
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const cellSize = TILE_BASE * zoom;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const idx = y * map.width + x;
      const biome = computeBiome(map, idx);
      const color = BIOME_COLORS[biome];
      const px = x * cellSize + pan.x;
      const py = y * cellSize + pan.y;
      ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.fillRect(px, py, cellSize + 1, cellSize + 1);
      if (overlayMode !== "biomes" && overlayRanges) {
        let overlay: string | null = null;
        if (overlayMode === "relief" && overlayRanges.relief) {
          overlay = reliefOverlayColor(map, map.relief[idx], overlayRanges.relief);
        } else if (overlayMode === "temperature" && overlayRanges.temperature) {
          overlay = temperatureOverlayColor(map.temperature[idx], overlayRanges.temperature);
        } else if (overlayMode === "vegetation" && overlayRanges.vegetation) {
          overlay = vegetationOverlayColor(map.vegetation[idx], overlayRanges.vegetation);
        }
        if (overlay) {
          ctx.fillStyle = overlay;
          ctx.fillRect(px, py, cellSize + 1, cellSize + 1);
        }
      }
    }
  }

  const totalWidth = map.width * cellSize;
  const totalHeight = map.height * cellSize;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = 0; gx <= map.width; gx += 1) {
    const px = gx * cellSize + pan.x;
    ctx.moveTo(px, pan.y);
    ctx.lineTo(px, pan.y + totalHeight);
  }
  for (let gy = 0; gy <= map.height; gy += 1) {
    const py = gy * cellSize + pan.y;
    ctx.moveTo(pan.x, py);
    ctx.lineTo(pan.x + totalWidth, py);
  }
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(224,196,128,0.85)";
  map.roads.forEach((road) => {
    ctx.beginPath();
    road.points.forEach((point, index) => {
      const px = point.x * map.width * cellSize + pan.x;
      const py = point.y * map.height * cellSize + pan.y;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });
  if (roadDraftStart) {
    ctx.fillStyle = "rgba(255,198,109,0.8)";
    ctx.beginPath();
    ctx.arc(
      roadDraftStart.x * map.width * cellSize + pan.x,
      roadDraftStart.y * map.height * cellSize + pan.y,
      5,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  map.cities.forEach((city) => {
    const px = city.x * map.width * cellSize + pan.x;
    const py = city.y * map.height * cellSize + pan.y;
    ctx.fillStyle = city.id === highlightCityId ? "#ffe066" : "#e3f2db";
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = "12px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(city.name, px, py - 10);
  });
}
function applyBrushToMap(
  map: MapStateExtended,
  point: PixelPoint,
  action: PrimaryAction,
  selectedBiome: Biome,
  brushSize: number
): MapStateExtended {
  if (!BRUSH_ACTIONS.has(action)) return map;
  const width = map.width;
  const height = map.height;
  const cx = clamp(point.x, 0, 0.9999) * (width - 1);
  const cy = clamp(point.y, 0, 0.9999) * (height - 1);
  const radius = Math.max(1, Math.round(brushSize * Math.min(width, height)));
  const copy: MapStateExtended = {
    ...map,
    relief: [...map.relief],
    moisture: [...map.moisture],
    temperature: [...map.temperature],
    vegetation: [...map.vegetation],
  };
  const target = BIOME_TARGETS[selectedBiome];

  for (
    let y = Math.max(0, Math.floor(cy - radius));
    y <= Math.min(height - 1, Math.ceil(cy + radius));
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.floor(cx - radius));
      x <= Math.min(width - 1, Math.ceil(cx + radius));
      x += 1
    ) {
      const dx = (x - cx) / radius;
      const dy = (y - cy) / radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 1) continue;
      const falloff = 1 - distance * distance;
      const idx = y * width + x;
      switch (action) {
        case "paint-biome":
          copy.relief[idx] = clamp(
            copy.relief[idx] +
              (target.relief - copy.relief[idx]) * falloff * 0.5
          );
          copy.moisture[idx] = clamp(
            copy.moisture[idx] +
              (target.moisture - copy.moisture[idx]) * falloff * 0.5
          );
          copy.temperature[idx] = clamp(
            copy.temperature[idx] +
              (target.temperature - copy.temperature[idx]) * falloff * 0.5
          );
          copy.vegetation[idx] = clamp(
            copy.vegetation[idx] +
              (target.vegetation - copy.vegetation[idx]) * falloff * 0.5
          );
          break;
        case "raise-relief":
          copy.relief[idx] = clamp(copy.relief[idx] + falloff * RELIEF_INTENSITY);
          break;
        case "lower-relief":
          copy.relief[idx] = clamp(copy.relief[idx] - falloff * RELIEF_INTENSITY);
          break;
        case "raise-moisture":
          copy.moisture[idx] = clamp(
            copy.moisture[idx] + falloff * CLIMATE_INTENSITY
          );
          break;
        case "lower-moisture":
          copy.moisture[idx] = clamp(
            copy.moisture[idx] - falloff * CLIMATE_INTENSITY
          );
          break;
        case "raise-temperature":
          copy.temperature[idx] = clamp(
            copy.temperature[idx] + falloff * CLIMATE_INTENSITY
          );
          break;
        case "lower-temperature":
          copy.temperature[idx] = clamp(
            copy.temperature[idx] - falloff * CLIMATE_INTENSITY
          );
          break;
        case "raise-vegetation":
          copy.vegetation[idx] = clamp(
            copy.vegetation[idx] + falloff * (CLIMATE_INTENSITY + 0.01)
          );
          break;
        case "lower-vegetation":
          copy.vegetation[idx] = clamp(
            copy.vegetation[idx] - falloff * (CLIMATE_INTENSITY + 0.01)
          );
          break;
      }
    }
  }
  return copy;
}

function distance(a: PixelPoint, b: PixelPoint) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function computeReliefRange(map: MapStateExtended) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < map.relief.length; i += 1) {
    const v = map.relief[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function computeRange(values: number[]) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function sampleRelief(map: MapStateExtended, point: PixelPoint) {
  const width = map.width;
  const height = map.height;
  const x = clamp(point.x, 0, 0.9999) * (width - 1);
  const y = clamp(point.y, 0, 0.9999) * (height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const sx = x - x0;
  const sy = y - y0;
  const v00 = map.relief[y0 * width + x0];
  const v10 = map.relief[y0 * width + x1];
  const v01 = map.relief[y1 * width + x0];
  const v11 = map.relief[y1 * width + x1];
  const i1 = lerp(v00, v10, sx);
  const i2 = lerp(v01, v11, sx);
  return lerp(i1, i2, sy);
}

function sampleVegetation(map: MapStateExtended, point: PixelPoint) {
  const width = map.width;
  const height = map.height;
  const x = clamp(point.x, 0, 0.9999) * (width - 1);
  const y = clamp(point.y, 0, 0.9999) * (height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const sx = x - x0;
  const sy = y - y0;
  const v00 = map.vegetation[y0 * width + x0] ?? 0;
  const v10 = map.vegetation[y0 * width + x1] ?? 0;
  const v01 = map.vegetation[y1 * width + x0] ?? 0;
  const v11 = map.vegetation[y1 * width + x1] ?? 0;
  const i1 = lerp(v00, v10, sx);
  const i2 = lerp(v01, v11, sx);
  return lerp(i1, i2, sy);
}

function sampleSlope(map: MapStateExtended, point: PixelPoint) {
  const eps = 1 / Math.min(map.width, map.height);
  const forward = sampleRelief(map, {
    x: clamp(point.x + eps, 0, 0.9999),
    y: point.y,
  });
  const backward = sampleRelief(map, {
    x: clamp(point.x - eps, 0, 0.9999),
    y: point.y,
  });
  const up = sampleRelief(map, {
    x: point.x,
    y: clamp(point.y - eps, 0, 0.9999),
  });
  const down = sampleRelief(map, {
    x: point.x,
    y: clamp(point.y + eps, 0, 0.9999),
  });
  return {
    dx: forward - backward,
    dy: down - up,
  };
}

function sampleVegetationGradient(map: MapStateExtended, point: PixelPoint) {
  const eps = 1 / Math.min(map.width, map.height);
  const forward = sampleVegetation(map, {
    x: clamp(point.x + eps, 0, 0.9999),
    y: point.y,
  });
  const backward = sampleVegetation(map, {
    x: clamp(point.x - eps, 0, 0.9999),
    y: point.y,
  });
  const up = sampleVegetation(map, {
    x: point.x,
    y: clamp(point.y - eps, 0, 0.9999),
  });
  const down = sampleVegetation(map, {
    x: point.x,
    y: clamp(point.y + eps, 0, 0.9999),
  });
  return {
    dx: forward - backward,
    dy: down - up,
  };
}

function isWaterCell(map: MapStateExtended, x: number, y: number) {
  const idx = y * map.width + x;
  return map.relief[idx] <= map.water_level;
}

function reliefOverlayColor(
  map: MapStateExtended,
  reliefValue: number,
  range: { min: number; max: number }
) {
  const seaLevel = map.water_level;
  const min = Math.min(range.min, seaLevel);
  const max = Math.max(range.max, seaLevel + 0.0001);
  const t = clamp((reliefValue - seaLevel) / (max - seaLevel), 0, 1);
  const hue = lerp(220, 20, t); // deep blue to warm amber
  const light = lerp(25, 70, t);
  const sat = lerp(70, 90, t);
  return `hsla(${hue}, ${sat}%, ${light}%, 0.95)`;
}

function temperatureOverlayColor(value: number, range: { min: number; max: number }) {
  const t = clamp((value - range.min) / (range.max - range.min || 1), 0, 1);
  const hue = lerp(210, 5, t); // cold blue to hot red
  const sat = 80;
  const light = lerp(30, 70, t);
  return `hsla(${hue}, ${sat}%, ${light}%, 0.95)`;
}

function vegetationOverlayColor(value: number, range: { min: number; max: number }) {
  const t = clamp((value - range.min) / (range.max - range.min || 1), 0, 1);
  const hue = lerp(35, 130, t); // dry earth to lush green
  const sat = lerp(70, 85, t);
  const light = lerp(25, 65, t);
  return `hsla(${hue}, ${sat}%, ${light}%, 0.95)`;
}

function buildRoadBetweenAnchors(
  map: MapStateExtended,
  from: PixelPoint,
  to: PixelPoint
) {
  const width = map.width;
  const height = map.height;
  const startX = clamp(from.x, 0, 0.9999) * (width - 1);
  const startY = clamp(from.y, 0, 0.9999) * (height - 1);
  const endX = clamp(to.x, 0, 0.9999) * (width - 1);
  const endY = clamp(to.y, 0, 0.9999) * (height - 1);

  const start = { x: Math.round(startX), y: Math.round(startY) };
  const goal = { x: Math.round(endX), y: Math.round(endY) };

  const maxBridgeCells = 2;

  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const cameFrom = new Map<string, { x: number; y: number }>();
  const waterRun = new Map<string, number>();

  const key = (x: number, y: number) => `${x},${y}`;
  const heuristic = (x: number, y: number) => Math.hypot(goal.x - x, goal.y - y);
  const reliefAt = (x: number, y: number) => map.relief[y * width + x];
  const vegetationAt = (x: number, y: number) => map.vegetation[y * width + x] ?? 0;

  const open: Array<{ x: number; y: number }> = [start];
  gScore.set(key(start.x, start.y), 0);
  fScore.set(key(start.x, start.y), heuristic(start.x, start.y));
  waterRun.set(key(start.x, start.y), isWaterCell(map, start.x, start.y) ? 1 : 0);

  while (open.length > 0) {
    // Find node with lowest fScore.
    let currentIndex = 0;
    let currentBest = open[0];
    let currentBestF = fScore.get(key(currentBest.x, currentBest.y)) ?? Infinity;
    for (let i = 1; i < open.length; i += 1) {
      const node = open[i];
      const score = fScore.get(key(node.x, node.y)) ?? Infinity;
      if (score < currentBestF) {
        currentBest = node;
        currentBestF = score;
        currentIndex = i;
      }
    }

    const currentKey = key(currentBest.x, currentBest.y);
    open.splice(currentIndex, 1);

    if (currentBest.x === goal.x && currentBest.y === goal.y) {
      // Reconstruct path.
      const path: PixelPoint[] = [];
      let iterKey: string | undefined = currentKey;
      while (iterKey) {
        const [ix, iy] = iterKey.split(",").map(Number);
        path.push({
          x: (ix + 0.5) / width,
          y: (iy + 0.5) / height,
        });
        const prev = cameFrom.get(iterKey);
        iterKey = prev ? key(prev.x, prev.y) : undefined;
      }
      return path.reverse();
    }

    const currentRelief = reliefAt(currentBest.x, currentBest.y);
    const prev = cameFrom.get(currentKey);
    const prevRelief = prev ? reliefAt(prev.x, prev.y) : currentRelief;
    const currentWaterRun = waterRun.get(currentKey) ?? 0;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = currentBest.x + dx;
        const ny = currentBest.y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

        const diagonal = dx !== 0 && dy !== 0;
        const stepBase = diagonal ? Math.SQRT2 : 1;
        const nextRelief = reliefAt(nx, ny);
        const slopeDiff = Math.abs(nextRelief - currentRelief);
        const continuous =
          Math.sign(nextRelief - currentRelief) === Math.sign(currentRelief - prevRelief) &&
          Math.abs(nextRelief - currentRelief) > 0.01;
        const vegetation = vegetationAt(nx, ny);

        const nextIsWater = isWaterCell(map, nx, ny);
        const nextWaterRun = nextIsWater ? currentWaterRun + 1 : 0;
        if (nextIsWater && nextWaterRun > maxBridgeCells) continue;

        const slopePenalty = slopeDiff * 18;
        const continuousPenalty = continuous ? Math.abs(nextRelief - currentRelief) * 30 : 0;
        const vegetationPenalty = vegetation * 6;
        const waterPenalty = nextIsWater ? 80 * nextWaterRun : 0;

        const tentativeG =
          (gScore.get(currentKey) ?? Infinity) +
          stepBase +
          slopePenalty +
          continuousPenalty +
          vegetationPenalty +
          waterPenalty;

        const neighborKey = key(nx, ny);
        if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
          cameFrom.set(neighborKey, { x: currentBest.x, y: currentBest.y });
          gScore.set(neighborKey, tentativeG);
          fScore.set(neighborKey, tentativeG + heuristic(nx, ny) * 1.1);
          waterRun.set(neighborKey, nextWaterRun);
          if (!open.find((node) => node.x === nx && node.y === ny)) {
            open.push({ x: nx, y: ny });
          }
        }
      }
    }
  }

  // Fallback: straight line if no path found.
  return [
    { x: clamp(from.x, 0, 0.9999), y: clamp(from.y, 0, 0.9999) },
    { x: clamp(to.x, 0, 0.9999), y: clamp(to.y, 0, 0.9999) },
  ];
}

function findAttachmentTarget(map: MapStateExtended, city: MapCity): NetworkAnchor | null {
  let best: NetworkAnchor | null = null;
  let bestDist = Infinity;
  map.cities.forEach((existing) => {
    const d = distance(
      { x: existing.x, y: existing.y },
      { x: city.x, y: city.y }
    );
    if (d < bestDist) {
      bestDist = d;
      best = {
        x: existing.x,
        y: existing.y,
        label: existing.name,
        targetType: "city",
        targetId: existing.id,
      };
    }
  });
  map.roads.forEach((road) => {
    road.points.forEach((point) => {
      const d = distance(point, { x: city.x, y: city.y });
      if (d < bestDist) {
        bestDist = d;
        best = {
          ...point,
          label: "Road node",
          targetType: "road",
          targetId: road.id,
        };
      }
    });
  });
  return best;
}

function addCityToMap(
  map: MapStateExtended,
  name: string,
  xRatio: number,
  yRatio: number
): MapStateExtended {
  const width = map.width;
  const height = map.height;
  const gridX = clamp(xRatio, 0, 0.9999) * (width - 1);
  const gridY = clamp(yRatio, 0, 0.9999) * (height - 1);
  const idx = Math.round(gridY) * width + Math.round(gridX);
  const elevation = map.relief[idx];
  const city: MapCity = {
    id: randomId(),
    name,
    x: (Math.round(gridX) + 0.5) / width,
    y: (Math.round(gridY) + 0.5) / height,
    elevation,
    population: Math.floor(500 + Math.random() * 4500),
  };
  let roads = map.roads.map((road) => ({
    ...road,
    points: road.points.map((point) => ({ ...point })),
  }));
  const target = findAttachmentTarget(map, city);
  if (target) {
    const path = buildRoadBetweenAnchors(map, target, { x: city.x, y: city.y });
    roads = [
      ...roads,
      {
        id: randomId(),
        from_city_id: target.targetId ?? city.id,
        to_city_id: city.id,
        points: path,
      },
    ];
  }
  return {
    ...map,
    cities: [...map.cities, city],
    roads,
  };
}

function snapToNetwork(map: MapStateExtended, point: PixelPoint): NetworkAnchor {
  let best: NetworkAnchor = {
    ...point,
    label: "Free point",
    targetType: "free",
  };
  let bestDist = SNAP_THRESHOLD;
  map.cities.forEach((city) => {
    const d = distance(point, { x: city.x, y: city.y });
    if (d < bestDist) {
      bestDist = d;
      best = {
        x: city.x,
        y: city.y,
        label: city.name,
        targetType: "city",
        targetId: city.id,
      };
    }
  });
  map.roads.forEach((road) => {
    road.points.forEach((segmentPoint, index) => {
      const d = distance(point, segmentPoint);
      if (d < bestDist) {
        bestDist = d;
        best = {
          x: segmentPoint.x,
          y: segmentPoint.y,
          label: `Road pt ${index + 1}`,
          targetType: "road",
          targetId: road.id,
        };
      }
    });
  });
  return best;
}

function addManualRoad(
  map: MapStateExtended,
  start: NetworkAnchor,
  end: NetworkAnchor
): MapStateExtended {
  if (start.x === end.x && start.y === end.y) return map;
  const path = buildRoadBetweenAnchors(map, start, end);
  const roadId = randomId();
  return {
    ...map,
    roads: [
      ...map.roads,
      {
        id: roadId,
        from_city_id: start.targetId ?? roadId,
        to_city_id: end.targetId ?? `${roadId}-end`,
        points: path,
      },
    ],
  };
}
export function WorldMapPage() {
  const { worldId } = useParams();
  const [mapState, setMapState] = useState<MapStateExtended | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedBiome, setSelectedBiome] = useState<Biome>("plains");
  const [biomeToolMode, setBiomeToolMode] = useState<BiomeToolMode>("palette");
  const [climateTarget, setClimateTarget] = useState<ClimateTarget>("moisture");
  const [climateDirection, setClimateDirection] = useState<"raise" | "lower">("raise");
  const [brushSize, setBrushSize] = useState(0.05);
  const [selectedCity, setSelectedCity] = useState<MapCity | null>(null);
  const [cityEditorCity, setCityEditorCity] = useState<MapCity | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<PanVector>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isBrushing, setIsBrushing] = useState(false);
  const [roadDraftStart, setRoadDraftStart] = useState<NetworkAnchor | null>(null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("biomes");
  const [desiredSize, setDesiredSize] = useState(MAP_DEFAULT_SIZE);
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolGroup, setToolGroup] = useState<ToolGroup>("general");
  const [reliefAction, setReliefAction] = useState<"raise" | "lower">("raise");
  const [locationAction, setLocationAction] = useState<PrimaryAction>("navigate");
  const [viewMode, setViewMode] = useState<ViewMode>("iso");
  const [draftCityName, setDraftCityName] = useState("New City");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);

  const primaryAction = useMemo<PrimaryAction>(() => {
    if (toolGroup === "biome") {
      if (biomeToolMode === "palette") return "paint-biome";
      const direction = climateDirection === "raise" ? "raise" : "lower";
      return `${direction}-${climateTarget}` as PrimaryAction;
    }
    if (toolGroup === "relief") {
      return reliefAction === "raise" ? "raise-relief" : "lower-relief";
    }
    if (toolGroup === "locations") {
      return locationAction;
    }
    return "navigate";
  }, [toolGroup, biomeToolMode, climateDirection, climateTarget, reliefAction, locationAction]);

  const isBrushAction = BRUSH_ACTIONS.has(primaryAction);
  const cursorStyle = isPanning ? "grabbing" : ACTION_CURSOR[primaryAction];

  useEffect(() => {
    if (!statusMessage) return;
    const id = window.setTimeout(() => setStatusMessage(null), 2600);
    return () => window.clearTimeout(id);
  }, [statusMessage]);

  useEffect(() => {
    if (toolGroup !== "locations") {
      setLocationAction("navigate");
      setRoadDraftStart(null);
    }
  }, [toolGroup]);

  useEffect(() => {
    if (locationAction !== "add-road") {
      setRoadDraftStart(null);
    }
  }, [locationAction]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setViewportSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!worldId) return;
    setLoading(true);
    getWorldMap(worldId)
      .then((map) => {
        if (map) {
          setMapState(ensureExtendedMap(map));
        } else {
          setMapState(generateProceduralMap(Date.now()));
        }
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [worldId]);

  useEffect(() => {
    if (!mapState) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reliefRange = computeReliefRange(mapState);
    const temperatureRange = computeRange(mapState.temperature);
    const vegetationRange = computeRange(mapState.vegetation);
    const overlayRanges =
      overlayMode === "biomes"
        ? undefined
        : {
            relief: reliefRange,
            temperature: temperatureRange,
            vegetation: vegetationRange,
          };
    if (viewMode === "iso") {
      drawIsometricMap(
        canvas,
        mapState,
        zoom,
        panOffset,
        viewportSize,
        selectedCity?.id,
        roadDraftStart ?? undefined,
        overlayMode,
        overlayRanges
      );
    } else {
      drawGridMap(
        canvas,
        mapState,
        zoom,
        panOffset,
        viewportSize,
        selectedCity?.id,
        roadDraftStart ?? undefined,
        overlayMode,
        overlayRanges
      );
    }
  }, [
    mapState,
    zoom,
    panOffset,
    viewportSize,
    selectedCity,
    roadDraftStart,
    viewMode,
    overlayMode,
  ]);

  const mapInfo = useMemo(() => {
    if (!mapState) return null;
    const avgTemperature =
      mapState.temperature.reduce((acc, value) => acc + value, 0) /
      mapState.temperature.length;
    return {
      cityCount: mapState.cities.length,
      roadCount: mapState.roads.length,
      highestPeak: Math.max(...mapState.relief),
      avgTemperature,
    };
  }, [mapState]);
  const handleGenerateMap = () => {
    setMapState(
      generateProceduralMap(
        Date.now(),
        mapState?.water_level ?? DEFAULT_WATER_LEVEL,
        mapState?.width ?? MAP_DEFAULT_SIZE,
        mapState?.height ?? MAP_DEFAULT_SIZE
      )
    );
    setStatusMessage("Generated new terrain.");
  };

  const handleNaturalizeRelief = () => {
    setMapState((prev) =>
      prev
        ? {
            ...prev,
            relief: smoothLayer(prev.relief, prev.width, prev.height, 1),
          }
        : prev
    );
    setStatusMessage("Smoothed elevation.");
  };

  const handleNormalizeLayer = (layer: "moisture" | "temperature" | "vegetation") => {
    setMapState((prev) =>
      prev
        ? {
            ...prev,
            [layer]: normalizeLayer(prev[layer], prev.width, prev.height),
          }
        : prev
    );
    setStatusMessage(`Normalized ${layer}.`);
  };

  const handleWaterChange = (value: number) => {
    setMapState((prev) => (prev ? { ...prev, water_level: value } : prev));
  };

  const handleSaveMap = async () => {
    if (!worldId || !mapState) return;
    setSaving(true);
    try {
      const saved = await saveWorldMap(worldId, mapState);
      setMapState(ensureExtendedMap(saved));
      setStatusMessage("Saved map state.");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleResizeMap = () => {
    const next = generateProceduralMap(
      Date.now(),
      mapState?.water_level ?? DEFAULT_WATER_LEVEL,
      desiredSize,
      desiredSize
    );
    setMapState(next);
    setStatusMessage(`Rebuilt map at ${desiredSize} x ${desiredSize}.`);
  };

  const screenToMapPoint = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!mapState || !canvasRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      if (viewMode === "grid") {
        const cellSize = TILE_BASE * zoom;
        const gridX = (localX - panOffset.x) / (cellSize * mapState.width);
        const gridY = (localY - panOffset.y) / (cellSize * mapState.height);
        return {
          x: clamp(gridX, 0, 0.9999),
          y: clamp(gridY, 0, 0.9999),
        };
      }
      const tileWidth = TILE_BASE * zoom;
      const tileHeight = tileWidth / 2;
      const originX = viewportSize.width / 2 + panOffset.x;
      const originY = tileHeight + panOffset.y;
      const dx = localX - originX;
      const dy = localY - originY;
      const sumCenter = (mapState.width - 1 + mapState.height - 1) / 2;
      const gridX = sumCenter / 2 + dx / tileWidth - dy / tileHeight;
      const gridY = sumCenter / 2 + dx / tileWidth + dy / tileHeight;
      return {
        x: clamp(gridX / mapState.width, 0, 0.9999),
        y: clamp(gridY / mapState.height, 0, 0.9999),
      };
    },
    [mapState, viewMode, zoom, panOffset, viewportSize]
  );

  const handleBrush = useCallback(
    (point: PixelPoint | null) => {
      if (!point || !mapState) return;
      setMapState((prev) =>
        prev
          ? applyBrushToMap(prev, point, primaryAction, selectedBiome, brushSize)
          : prev
      );
    },
    [mapState, primaryAction, selectedBiome, brushSize]
  );

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => clamp(prev + delta, MIN_ZOOM, MAX_ZOOM));
  };

  const handlePointerDown = (event: MouseEvent<HTMLCanvasElement>) => {
    if (event.button === 2) {
      setIsPanning(true);
      lastPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (primaryAction === "navigate") {
      setIsPanning(true);
      lastPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (isBrushAction) {
      const point = screenToMapPoint(event);
      handleBrush(point);
      setIsBrushing(true);
      return;
    }
    if (primaryAction === "place-city") {
      const point = screenToMapPoint(event);
      if (point && mapState) {
        const name = draftCityName.trim() || `City ${mapState.cities.length + 1}`;
        setMapState(addCityToMap(mapState, name, point.x, point.y));
        setDraftCityName(`City ${mapState.cities.length + 2}`);
        setStatusMessage(`Added ${name}`);
      }
      return;
    }
    if (primaryAction === "add-road") {
      const point = screenToMapPoint(event);
      if (!point || !mapState) return;
      const snapped = snapToNetwork(mapState, point);
      if (!roadDraftStart) {
        setRoadDraftStart(snapped);
        setStatusMessage(`Road anchor: ${snapped.label}`);
      } else {
        setMapState(addManualRoad(mapState, roadDraftStart, snapped));
        setRoadDraftStart(null);
        setStatusMessage("Road segment added.");
      }
    }
  };

  const handlePointerMove = (event: MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const last = lastPanRef.current;
      if (last) {
        const dx = event.clientX - last.x;
        const dy = event.clientY - last.y;
        setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      }
      lastPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (isBrushing) {
      handleBrush(screenToMapPoint(event));
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    setIsBrushing(false);
    lastPanRef.current = null;
  };

  const handleSelectCity = (city: MapCity) => {
    setSelectedCity(city);
    setStatusMessage(`Selected ${city.name}`);
  };

  const handleViewToggle = () => {
    setViewMode((prev) => (prev === "iso" ? "grid" : "iso"));
  };

  const handleSidebarToggle = () => {
    setSidebarOpen((prev) => !prev);
  };
  const renderGeneralPanel = () => (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-earth-sand/60">
          Map status
        </p>
        <div className="rounded-xl border border-earth-clay/40 p-4 bg-black/30 text-sm space-y-1">
          <p>Cities: {mapInfo?.cityCount ?? 0}</p>
          <p>Roads: {mapInfo?.roadCount ?? 0}</p>
          <p>
            Peak: {(mapInfo?.highestPeak ?? 0).toFixed(2)}  |  Avg temp:
            {(mapInfo?.avgTemperature ?? 0).toFixed(2)}
          </p>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <button onClick={handleGenerateMap} className="primary-button" type="button">
          Generate terrain
        </button>
        <button
          onClick={handleSaveMap}
          className="secondary-button"
          type="button"
          disabled={saving}
        >
          {saving ? "Saving..." : "Save map"}
        </button>
      </section>
      <section className="space-y-2 text-sm">
        <label className="flex items-center justify-between gap-4">
          <span>Water level</span>
          <input
            type="range"
            min={0.05}
            max={0.8}
            step={0.01}
            value={mapState?.water_level ?? DEFAULT_WATER_LEVEL}
            onChange={(event) => handleWaterChange(Number(event.target.value))}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>View</span>
          <button
            type="button"
            onClick={handleViewToggle}
            className="px-3 py-1 rounded border border-brand/50 text-xs"
          >
            {viewMode === "iso" ? "Isometric" : "Top-down"}
          </button>
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>Overlay</span>
          <select
            className="px-3 py-1 rounded border border-earth-clay/40 bg-black/40 text-xs"
            value={overlayMode}
            onChange={(event) => setOverlayMode(event.target.value as OverlayMode)}
          >
            <option value="biomes">Biomes</option>
            <option value="relief">Relief</option>
            <option value="temperature">Temperature</option>
            <option value="vegetation">Vegetation</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
      </section>
      <section className="space-y-3 text-sm">
        <label className="flex flex-col gap-1">
          Map size
          <select
            className="input-field"
            value={desiredSize}
            onChange={(event) => setDesiredSize(Number(event.target.value))}
          >
            {MAP_SIZE_CHOICES.map((size) => (
              <option key={size} value={size}>
                {size} x {size}
              </option>
            ))}
          </select>
        </label>
        <button onClick={handleResizeMap} className="secondary-button">
          Rebuild at size
        </button>
        <button onClick={handleNaturalizeRelief} className="secondary-button">
          Smooth relief
        </button>
      </section>
    </div>
  );

  const renderBiomePanel = () => (
    <div className="space-y-5 text-sm">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-earth-sand/60 mb-3">
          Brush mode
        </p>
        <div className="grid grid-cols-4 gap-2">
          {["palette", "moisture", "temperature", "vegetation"].map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBiomeToolMode(mode as BiomeToolMode)}
              className={`px-3 py-2 rounded border ${
                biomeToolMode === mode
                  ? "border-brand bg-brand/10"
                  : "border-earth-clay/30"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      {biomeToolMode === "palette" ? (
        <div className="space-y-3">
          {BIOME_GROUPS.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-earth-sand/60">
                {group.label}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {group.biomes.map((biome) => (
                  <button
                    key={biome}
                    type="button"
                    onClick={() => setSelectedBiome(biome)}
                    className={`rounded border px-2 py-1 text-xs ${
                      selectedBiome === biome
                        ? "border-brand bg-brand/15 text-brand-glow"
                        : "border-earth-clay/30"
                    }`}
                  >
                    {biome.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {CLIMATE_LAYERS.map((layer) => (
            <button
              key={layer.key}
              type="button"
              onClick={() => setClimateTarget(layer.key)}
              className={`w-full text-left px-3 py-2 rounded border ${
                climateTarget === layer.key
                  ? "border-brand bg-brand/15"
                  : "border-earth-clay/30"
              }`}
            >
              <p className="text-xs uppercase tracking-[0.2em] text-earth-sand/60">
                {layer.label}
              </p>
              <p>
                {layer.minLabel} ? {layer.maxLabel}
              </p>
            </button>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setClimateDirection("raise")}
              className={`flex-1 rounded border px-3 py-2 ${
                climateDirection === "raise"
                  ? "border-brand bg-brand/15"
                  : "border-earth-clay/30"
              }`}
            >
              Raise
            </button>
            <button
              type="button"
              onClick={() => setClimateDirection("lower")}
              className={`flex-1 rounded border px-3 py-2 ${
                climateDirection === "lower"
                  ? "border-brand bg-brand/15"
                  : "border-earth-clay/30"
              }`}
            >
              Lower
            </button>
          </div>
        </div>
      )}
      <label className="flex flex-col gap-1">
        Brush size
        <input
          type="range"
          min={0.01}
          max={0.2}
          step={0.01}
          value={brushSize}
          onChange={(event) => setBrushSize(Number(event.target.value))}
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        {CLIMATE_LAYERS.map((layer) => (
          <button
            key={layer.key}
            type="button"
            onClick={() => handleNormalizeLayer(layer.key)}
            className="text-[11px] rounded border border-earth-clay/40 px-2 py-1"
          >
            Normalize {layer.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderReliefPanel = () => (
    <div className="space-y-4 text-sm">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setReliefAction("raise")}
          className={`flex-1 rounded border px-3 py-2 ${
            reliefAction === "raise"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Raise
        </button>
        <button
          type="button"
          onClick={() => setReliefAction("lower")}
          className={`flex-1 rounded border px-3 py-2 ${
            reliefAction === "lower"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Lower
        </button>
      </div>
      <label className="flex flex-col gap-1">
        Brush size
        <input
          type="range"
          min={0.01}
          max={0.2}
          step={0.01}
          value={brushSize}
          onChange={(event) => setBrushSize(Number(event.target.value))}
        />
      </label>
      <div className="space-y-2">
        <button onClick={handleNaturalizeRelief} className="secondary-button">
          Smooth relief
        </button>
        <button
          onClick={() => handleNormalizeLayer("vegetation")}
          className="secondary-button"
        >
          Normalize vegetation
        </button>
      </div>
      <p className="text-xs text-earth-sand/70">
        Relief brushes push or erode the terrain. Right click at any time to pan.
      </p>
    </div>
  );

  const renderLocationsPanel = () => (
    <div className="space-y-4 text-sm">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setLocationAction("navigate")}
          className={`flex-1 rounded border px-3 py-2 ${
            locationAction === "navigate"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Navigate
        </button>
        <button
          type="button"
          onClick={() => setLocationAction("place-city")}
          className={`flex-1 rounded border px-3 py-2 ${
            locationAction === "place-city"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Add city
        </button>
        <button
          type="button"
          onClick={() => setLocationAction("add-road")}
          className={`flex-1 rounded border px-3 py-2 ${
            locationAction === "add-road"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Add road
        </button>
      </div>
      <label className="flex flex-col gap-1">
        City label
        <input
          className="input-field"
          value={draftCityName}
          onChange={(event) => setDraftCityName(event.target.value)}
        />
      </label>
      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
        {mapState?.cities.map((city) => (
          <button
            key={city.id}
            type="button"
            onClick={() => handleSelectCity(city)}
            className={`w-full text-left px-3 py-2 rounded border ${
              selectedCity?.id === city.id
                ? "border-brand bg-brand/15"
                : "border-earth-clay/30"
            }`}
          >
            <p className="text-sm font-semibold">{city.name}</p>
            <p className="text-xs text-earth-sand/70">
              {(city.x * mapState.width).toFixed(1)}  |  {(city.y * mapState.height).toFixed(1)}
            </p>
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!selectedCity}
        onClick={() => selectedCity && setCityEditorCity(selectedCity)}
        className="secondary-button disabled:opacity-40"
      >
        Open city mapper
      </button>
      <p className="text-xs text-earth-sand/70">
        Road tool snaps to cities or road nodes. Right click always pans.
      </p>
    </div>
  );

  const renderPanel = () => {
    if (!mapState) return null;
    switch (toolGroup) {
      case "general":
        return renderGeneralPanel();
      case "biome":
        return renderBiomePanel();
      case "relief":
        return renderReliefPanel();
      case "locations":
        return renderLocationsPanel();
      default:
        return null;
    }
  };
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-earth-sand/70">
        Loading map...
      </div>
    );
  }

  if (!mapState) {
    return (
      <div className="h-full w-full flex items-center justify-center text-red-200">
        Failed to load map data.
      </div>
    );
  }

  return (
    <div className="h-full w-full relative text-earth-sand bg-black">
      <div className="absolute inset-0 flex">
        <div
          className={`h-full bg-grove-950/95 text-sm transition-all duration-200 border-r border-earth-clay/20 ${
            sidebarOpen ? "w-80" : "w-10"
          }`}
        >
          <div className="flex items-center justify-between px-2 py-2 border-b border-earth-clay/20">
            {sidebarOpen && (
              <p className="text-xs uppercase tracking-[0.3em] text-earth-sand/60">
                Tools
              </p>
            )}
            <button
              type="button"
              className="text-lg text-earth-sand/80"
              onClick={handleSidebarToggle}
            >
              {sidebarOpen ? "<" : ">"}
            </button>
          </div>
          {sidebarOpen ? (
            <div className="flex flex-col h-full">
              <div className="flex gap-1 p-2">
                {(Object.entries(TOOL_GROUP_LABELS) as [ToolGroup, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setToolGroup(key)}
                    className={`flex-1 rounded-full px-3 py-2 text-xs ${
                      toolGroup === key
                        ? "bg-brand text-black font-semibold"
                        : "bg-transparent border border-earth-clay/30 text-earth-sand/70"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {renderPanel()}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex-1 relative">
          <div
            ref={viewportRef}
            className="h-full w-full relative bg-gradient-to-br from-black via-brand-deep to-black"
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0"
              style={{ cursor: cursorStyle }}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
              onWheel={handleWheel}
              onContextMenu={(event) => event.preventDefault()}
            />
            <div className="absolute top-4 right-4 bg-black/70 backdrop-blur rounded-xl border border-earth-clay/30 px-4 py-3 text-xs space-y-1">
              <p>
                Primary: {PRIMARY_ACTION_LABEL[primaryAction]}  |  Secondary: Pan
              </p>
              <p>View: {viewMode === "iso" ? "Isometric" : "Grid"}</p>
              {roadDraftStart && <p>Road anchor: {roadDraftStart.label}</p>}
            </div>
            {statusMessage && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 text-earth-sand px-4 py-2 rounded-full text-xs border border-brand/40">
                {statusMessage}
              </div>
            )}
            {error && (
              <div className="absolute bottom-6 right-6 bg-red-500/80 text-sm px-3 py-2 rounded">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
      {cityEditorCity ? (
        <CityMapEditor city={cityEditorCity} onClose={() => setCityEditorCity(null)} />
      ) : null}
    </div>
  );
}


