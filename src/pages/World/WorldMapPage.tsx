import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, WheelEvent } from "react";
import { useParams } from "react-router-dom";
import { CityMapEditor } from "../../components/CityMapEditor";
import {
  getWorldMap,
  saveWorldMap,
  type MapCity,
  type MapState,
} from "../../api/worldMap";

const MAP_DEFAULT_SIZE = 96;
const DEFAULT_WATER_LEVEL = 0.42;
const MAP_SIZE_CHOICES = [64, 96, 128, 160];
const TILE_BASE = 28;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const SNAP_THRESHOLD = 0.025;

type Biome =
  | "ocean"
  | "shallow"
  | "beach"
  | "plains"
  | "forest"
  | "jungle"
  | "desert"
  | "tundra"
  | "mountain"
  | "snow";

type PixelPoint = { x: number; y: number };

type PanVector = { x: number; y: number };

type ToolGroup = "general" | "biome" | "relief" | "locations";

type PrimaryAction =
  | "navigate"
  | "paint-biome"
  | "raise"
  | "lower"
  | "place-city"
  | "add-road";

type BrushAction = "paint-biome" | "raise" | "lower";

type ViewMode = "iso" | "grid";

const BIOME_COLORS: Record<Biome, [number, number, number]> = {
  ocean: [8, 29, 48],
  shallow: [26, 68, 88],
  beach: [210, 189, 140],
  plains: [94, 141, 84],
  forest: [43, 96, 70],
  jungle: [21, 74, 52],
  desert: [201, 163, 92],
  tundra: [151, 154, 170],
  mountain: [120, 111, 118],
  snow: [233, 237, 243],
};

const BIOME_TARGETS: Record<
  Biome,
  {
    relief: number;
    moisture: number;
  }
> = {
  ocean: { relief: 0.15, moisture: 0.8 },
  shallow: { relief: 0.35, moisture: 0.8 },
  beach: { relief: 0.42, moisture: 0.4 },
  plains: { relief: 0.5, moisture: 0.5 },
  forest: { relief: 0.55, moisture: 0.65 },
  jungle: { relief: 0.55, moisture: 0.85 },
  desert: { relief: 0.5, moisture: 0.1 },
  tundra: { relief: 0.65, moisture: 0.2 },
  mountain: { relief: 0.85, moisture: 0.3 },
  snow: { relief: 0.92, moisture: 0.4 },
};

const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  general: "General",
  biome: "Biome",
  relief: "Relief",
  locations: "Locations",
};

const PRIMARY_ACTION_LABEL: Record<PrimaryAction, string> = {
  navigate: "Navigate / select",
  "paint-biome": "Paint biome",
  raise: "Raise relief",
  lower: "Lower relief",
  "place-city": "Add city",
  "add-road": "Add road",
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
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
    value += amplitude * noise2D(x * frequency, y * frequency, seed + i * 97);
    frequency *= 2;
    amplitude *= 0.5;
  }
  return value;
}

function smoothRelief(
  relief: number[],
  width: number,
  height: number,
  iterations = 1
) {
  let current = [...relief];
  for (let i = 0; i < iterations; i += 1) {
    const next = current.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x;
        let total = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            total += current[(y + dy) * width + (x + dx)];
          }
        }
        next[idx] = total / 9;
      }
    }
    current = next;
  }
  return current;
}

function generateProceduralMap(
  seed: number,
  waterLevel = DEFAULT_WATER_LEVEL,
  width = MAP_DEFAULT_SIZE,
  height = MAP_DEFAULT_SIZE
): MapState {
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
  return {
    width,
    height,
    relief: smoothRelief(relief, width, height, 2),
    moisture,
    water_level: waterLevel,
    seed,
    cities: [],
    roads: [],
  };
}

function computeBiome(elevation: number, moisture: number, waterLevel: number): Biome {
  if (elevation <= waterLevel * 0.85) return "ocean";
  if (elevation <= waterLevel) return "shallow";
  if (elevation <= waterLevel + 0.02) return "beach";
  if (elevation > 0.85) return elevation > 0.92 ? "snow" : "mountain";
  if (moisture < 0.2) {
    return elevation < 0.55 ? "desert" : "tundra";
  }
  if (moisture < 0.4) return "plains";
  if (moisture < 0.65) return "forest";
  return "jungle";
}

function gridToIso(
  gridX: number,
  gridY: number,
  tileWidth: number,
  tileHeight: number,
  originX: number,
  originY: number
) {
  const x = (gridX - gridY) * (tileWidth / 2) + originX;
  const y = (gridX + gridY) * (tileHeight / 2) + originY;
  return { x, y };
}

function isoToGrid(
  isoX: number,
  isoY: number,
  tileWidth: number,
  tileHeight: number,
  originX: number,
  originY: number
) {
  const dx = (isoX - originX) / (tileWidth / 2);
  const dy = (isoY - originY) / (tileHeight / 2);
  const gridX = (dy + dx) / 2;
  const gridY = (dy - dx) / 2;
  return { gridX, gridY };
}

function drawIsometricMap(
  canvas: HTMLCanvasElement | null,
  map: MapState,
  zoom: number,
  pan: PanVector,
  viewport: { width: number; height: number },
  highlightCityId?: string | null,
  roadDraftStart?: PixelPoint | null
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const pixelRatio = window.devicePixelRatio ?? 1;
  const canvasWidth = viewport.width * pixelRatio;
  const canvasHeight = viewport.height * pixelRatio;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  const tileWidth = TILE_BASE * zoom;
  const tileHeight = tileWidth / 2;
  const originX = viewport.width / 2 + pan.x;
  const originY = tileHeight + pan.y;

  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "rgba(11, 37, 25, 0.38)";

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const idx = y * map.width + x;
      const relief = map.relief[idx];
      const moisture = map.moisture[idx];
      const biome = computeBiome(relief, moisture, map.water_level);
      const color = BIOME_COLORS[biome];
      const { x: isoX, y: isoY } = gridToIso(
        x,
        y,
        tileWidth,
        tileHeight,
        originX,
        originY
      );
      ctx.beginPath();
      ctx.moveTo(isoX, isoY);
      ctx.lineTo(isoX + tileWidth / 2, isoY + tileHeight / 2);
      ctx.lineTo(isoX, isoY + tileHeight);
      ctx.lineTo(isoX - tileWidth / 2, isoY + tileHeight / 2);
      ctx.closePath();
      ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(224, 196, 128, 0.8)";
  map.roads.forEach((road) => {
    if (road.points.length === 0) return;
    ctx.beginPath();
    const first = road.points[0];
    const { x: startX, y: startY } = gridToIso(
      first.x * map.width,
      first.y * map.height,
      tileWidth,
      tileHeight,
      originX,
      originY
    );
    ctx.moveTo(startX, startY);
    for (let i = 1; i < road.points.length; i += 1) {
      const point = road.points[i];
      const { x: px, y: py } = gridToIso(
        point.x * map.width,
        point.y * map.height,
        tileWidth,
        tileHeight,
        originX,
        originY
      );
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  });

  if (roadDraftStart) {
    const { x, y } = gridToIso(
      roadDraftStart.x * map.width,
      roadDraftStart.y * map.height,
      tileWidth,
      tileHeight,
      originX,
      originY
    );
    ctx.fillStyle = "rgba(255, 198, 109, 0.8)";
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  map.cities.forEach((city) => {
    const { x, y } = gridToIso(
      city.x * map.width,
      city.y * map.height,
      tileWidth,
      tileHeight,
      originX,
      originY
    );
    ctx.fillStyle = city.id === highlightCityId ? "#ffe066" : "#e3f2db";
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.font = "12px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(city.name, x, y - 12);
  });
}

function drawGridMap(
  canvas: HTMLCanvasElement | null,
  map: MapState,
  zoom: number,
  pan: PanVector,
  viewport: { width: number; height: number },
  highlightCityId?: string | null,
  roadDraftStart?: PixelPoint | null
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

  const cellSize = TILE_BASE * zoom;
  ctx.fillStyle = "#04120b";
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const idx = y * map.width + x;
      const relief = map.relief[idx];
      const moisture = map.moisture[idx];
      const biome = computeBiome(relief, moisture, map.water_level);
      const color = BIOME_COLORS[biome];
      const screenX = x * cellSize + pan.x;
      const screenY = y * cellSize + pan.y;
      ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      ctx.fillRect(screenX, screenY, cellSize + 1, cellSize + 1);
    }
  }

  ctx.strokeStyle = "rgba(224, 196, 128, 0.8)";
  ctx.lineWidth = 2;
  map.roads.forEach((road) => {
    if (road.points.length === 0) return;
    ctx.beginPath();
    const first = road.points[0];
    ctx.moveTo(first.x * map.width * cellSize + pan.x, first.y * map.height * cellSize + pan.y);
    for (let i = 1; i < road.points.length; i += 1) {
      const point = road.points[i];
      ctx.lineTo(point.x * map.width * cellSize + pan.x, point.y * map.height * cellSize + pan.y);
    }
    ctx.stroke();
  });

  if (roadDraftStart) {
    ctx.fillStyle = "rgba(255, 198, 109, 0.8)";
    ctx.beginPath();
    ctx.arc(
      roadDraftStart.x * map.width * cellSize + pan.x,
      roadDraftStart.y * map.height * cellSize + pan.y,
      6,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  map.cities.forEach((city) => {
    const screenX = city.x * map.width * cellSize + pan.x;
    const screenY = city.y * map.height * cellSize + pan.y;
    ctx.fillStyle = city.id === highlightCityId ? "#ffe066" : "#e3f2db";
    ctx.beginPath();
    ctx.arc(screenX, screenY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.font = "12px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(city.name, screenX, screenY - 12);
  });
}

function applyBrushToMap(
  map: MapState,
  action: BrushAction,
  biome: Biome,
  coords: PixelPoint,
  radius: number
): MapState {
  const copy = { ...map, relief: [...map.relief], moisture: [...map.moisture] };
  const width = copy.width;
  const height = copy.height;
  const centerX = Math.round(coords.x * width);
  const centerY = Math.round(coords.y * height);
  const brushRadius = Math.max(1, Math.round(radius * width));

  for (let y = centerY - brushRadius; y <= centerY + brushRadius; y += 1) {
    for (let x = centerX - brushRadius; x <= centerX + brushRadius; x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > brushRadius) continue;
      const idx = y * width + x;
      const falloff = 1 - distance / brushRadius;
      if (action === "raise") {
        copy.relief[idx] = clamp(copy.relief[idx] + falloff * 0.01);
      } else if (action === "lower") {
        copy.relief[idx] = clamp(copy.relief[idx] - falloff * 0.01);
      } else {
        copy.relief[idx] = clamp(copy.relief[idx] + (BIOME_TARGETS[biome].relief - copy.relief[idx]) * falloff);
        copy.moisture[idx] = clamp(
          copy.moisture[idx] + (BIOME_TARGETS[biome].moisture - copy.moisture[idx]) * falloff
        );
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

function buildRoadPath(map: MapState, from: MapCity, to: MapCity) {
  const steps = 20;
  const path: PixelPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const currentX = from.x + (to.x - from.x) * t;
    const currentY = from.y + (to.y - from.y) * t;
    path.push({ x: currentX, y: currentY });
  }

  // If no map provided, fall back to straight line
  if (!map) return path;

  const width = map.width;
  const height = map.height;

  const sampleRelief = (p: PixelPoint) => {
    const gx = clamp(p.x, 0, 0.9999) * (width - 1);
    const gy = clamp(p.y, 0, 0.9999) * (height - 1);
    const idx = Math.round(gy) * width + Math.round(gx);
    return map.relief[Math.max(0, Math.min(map.relief.length - 1, idx))] ?? 0;
  };

  // Parameters controlling smoothing and penalty behavior
  const RELIEF_CHANGE_THRESHOLD = 0.08; // small changes under this are tolerated
  const SMOOTH_PASSES = 6; // number of smoothing iterations
  const BASE_SMOOTH_FACTOR = 0.5; // how much we move toward neighbor average when penalized

  // Iteratively smooth points where relief changes are large, and strongly penalize
  // back-to-back (sign-changing) relief deltas to avoid sharp up-down sequences.
  for (let pass = 0; pass < SMOOTH_PASSES; pass += 1) {
    // don't touch endpoints (they anchor to city positions)
    for (let i = 1; i < path.length - 1; i += 1) {
      const prev = path[i - 1];
      const cur = path[i];
      const next = path[i + 1];

      const rPrev = sampleRelief(prev);
      const rCur = sampleRelief(cur);
      const rNext = sampleRelief(next);

      const d1 = rCur - rPrev;
      const d2 = rNext - rCur;

      // magnitude of relief change around this point
      const mag = Math.max(Math.abs(d1), Math.abs(d2));

      if (mag <= RELIEF_CHANGE_THRESHOLD) {
        // small changes — no special smoothing needed
        continue;
      }

      // detect back-to-back (sign change) steep transitions (e.g., up then down)
      const signChange = d1 * d2 < 0 ? 1 : 0;

      // penalty scales with how much over the threshold we are and increases if sign changes
      const penalty = Math.min(1, (mag - RELIEF_CHANGE_THRESHOLD) / (1 - RELIEF_CHANGE_THRESHOLD));
      const moveAmount = Math.min(1, BASE_SMOOTH_FACTOR * (0.5 + penalty) * (1 + signChange * 1.2));

      // move current point toward the average of its neighbors to reduce sharp relief deltas
      const avgX = (prev.x + next.x) * 0.5;
      const avgY = (prev.y + next.y) * 0.5;
      cur.x = cur.x * (1 - moveAmount) + avgX * moveAmount;
      cur.y = cur.y * (1 - moveAmount) + avgY * moveAmount;
    }
  }

  return path;
}

function findAttachmentTarget(map: MapState, city: MapCity) {
  let bestCity: MapCity = {...city};
  let bestDist = Infinity;
  map.cities.forEach((existing) => {
    const d = distance({ x: existing.x, y: existing.y }, { x: city.x, y: city.y });
    if (d < bestDist) {
      bestDist = d;
      bestCity = existing;
    } else if (d === bestDist && bestCity) {
      if (existing.population > bestCity.population) {
        bestCity = existing;
      }
    }
  });
  if (bestCity.id !== city.id) {
    return {
      type: "city" as const,
      id: bestCity.id,
      name: bestCity.name,
      x: bestCity.x,
      y: bestCity.y,
    };
  }
  return null;
}

function addCityToMap(
  map: MapState,
  name: string,
  xRatio: number,
  yRatio: number
): MapState {
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

  const roads = map.roads.map((road) => ({
    ...road,
    points: road.points.map((point) => ({ ...point })),
  }));

  if (map.cities.length > 0 || map.roads.length > 0) {
    const target = findAttachmentTarget(map, city);
    if (target) {
      const anchorCity = map.cities.find((c) => c.id === target.id);
      if (anchorCity) {
        const path = buildRoadPath(map, anchorCity, city);
        if (path && path.length > 1) {
          roads.push({
            id: randomId(),
            from_city_id: anchorCity.id,
            to_city_id: city.id,
            points: path,
          });
        }
      }
    }
  }

  return {
    ...map,
    cities: [...map.cities, city],
    roads,
  };
}

function snapToNetwork(map: MapState, point: PixelPoint) {
  let snapped: PixelPoint & {
    label: string;
    targetId: string;
  } = { ...point, label: "Point", targetId: randomId() };
  let bestDist = SNAP_THRESHOLD;

  map.cities.forEach((city) => {
    const d = distance(point, { x: city.x, y: city.y });
    if (d < bestDist) {
      bestDist = d;
      snapped = { x: city.x, y: city.y, label: city.name, targetId: city.id };
    }
  });

  map.roads.forEach((road) => {
    road.points.forEach((segmentPoint) => {
      const d = distance(point, segmentPoint);
      if (d < bestDist) {
        bestDist = d;
        snapped = {
          x: segmentPoint.x,
          y: segmentPoint.y,
          label: "Road point",
          targetId: road.id,
        };
      }
    });
  });
  return snapped;
}

export function WorldMapPage() {
  const { worldId } = useParams();
  const [mapState, setMapState] = useState<MapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedBiome, setSelectedBiome] = useState<Biome>("plains");
  const [brushSize, setBrushSize] = useState(0.05);
  const [selectedCity, setSelectedCity] = useState<MapCity | null>(null);
  const [cityEditorCity, setCityEditorCity] = useState<MapCity | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<PanVector>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isBrushing, setIsBrushing] = useState(false);
  const [roadDraftStart, setRoadDraftStart] = useState<
    (PixelPoint & { label: string, targetId: string }) | null
  >(null);
  const [desiredSize, setDesiredSize] = useState(MAP_DEFAULT_SIZE);
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolGroup, setToolGroup] = useState<ToolGroup>("general");
  const [reliefAction, setReliefAction] = useState<BrushAction>("raise");
  const [locationAction, setLocationAction] = useState<PrimaryAction>("navigate");
  const [viewMode, setViewMode] = useState<ViewMode>("iso");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });

  const primaryAction = useMemo<PrimaryAction>(() => {
    switch (toolGroup) {
      case "biome":
        return "paint-biome";
      case "relief":
        return reliefAction;
      case "locations":
        return locationAction;
      default:
        return "navigate";
    }
  }, [toolGroup, reliefAction, locationAction]);

  const isBrushAction =
    primaryAction === "paint-biome" ||
    primaryAction === "raise" ||
    primaryAction === "lower";

  useEffect(() => {
    if (toolGroup !== "locations") {
      setRoadDraftStart(null);
      setLocationAction("navigate");
    }
    if (toolGroup !== "relief") {
      setReliefAction("raise");
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
          setMapState(map);
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
    if (viewMode === "iso") {
      drawIsometricMap(
        canvas,
        mapState,
        zoom,
        panOffset,
        viewportSize,
        selectedCity?.id,
        roadDraftStart
      );
    } else {
      drawGridMap(
        canvas,
        mapState,
        zoom,
        panOffset,
        viewportSize,
        selectedCity?.id,
        roadDraftStart
      );
    }
  }, [mapState, zoom, panOffset, viewportSize, selectedCity, roadDraftStart, viewMode]);

  const mapInfo = useMemo(() => {
    if (!mapState) return null;
    return {
      cityCount: mapState.cities.length,
      roadCount: mapState.roads.length,
      highestPeak: Math.max(...mapState.relief),
    };
  }, [mapState]);

  const handleGenerateMap = () => {
    if (!mapState) return;
    const next = generateProceduralMap(Date.now(), mapState.water_level, mapState.width, mapState.height);
    setMapState(next);
    setStatusMessage("Generated new terrain.");
  };

  const handleNaturalize = () => {
    if (!mapState) return;
    setMapState((prev) =>
      prev
        ? {
            ...prev,
            relief: smoothRelief(prev.relief, prev.width, prev.height, 1),
          }
        : prev
    );
    setStatusMessage("Smoothed elevation.");
  };

  const handleWaterChange = (value: number) => {
    if (!mapState) return;
    setMapState({ ...mapState, water_level: value });
  };

  const handleSaveMap = async () => {
    if (!worldId || !mapState) return;
    setSaving(true);
    try {
      const saved = await saveWorldMap(worldId, mapState);
      setMapState(saved);
      setStatusMessage("Saved map state.");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleResizeMap = () => {
    if (!mapState) return;
    const next = generateProceduralMap(Date.now(), mapState.water_level, desiredSize, desiredSize);
    setMapState(next);
    setStatusMessage(`Rebuilt map at ${desiredSize} x ${desiredSize}.`);
  };

  const screenToMapPoint = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!mapState || !canvasRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      if (viewMode === "grid") {
        const cellSize = TILE_BASE * zoom;
        const gridX = (localX - panOffset.x) / cellSize;
        const gridY = (localY - panOffset.y) / cellSize;
        const normX = clamp(gridX / mapState.width, 0, 0.9999);
        const normY = clamp(gridY / mapState.height, 0, 0.9999);
        return { x: normX, y: normY };
      }
      const tileWidth = TILE_BASE * zoom;
      const tileHeight = tileWidth / 2;
      const originX = viewportSize.width / 2 + panOffset.x;
      const originY = tileHeight + panOffset.y;
      const { gridX, gridY } = isoToGrid(localX, localY, tileWidth, tileHeight, originX, originY);
      const normX = clamp(gridX / mapState.width, 0, 0.9999);
      const normY = clamp(gridY / mapState.height, 0, 0.9999);
      return { x: normX, y: normY };
    },
    [mapState, panOffset, viewportSize, zoom, viewMode]
  );

  const applyBrushAt = (event: MouseEvent<HTMLDivElement>) => {
    if (!isBrushAction) return;
    const coords = screenToMapPoint(event);
    if (!coords || !mapState) return;
    setMapState((prev) =>
      prev ? applyBrushToMap(prev, primaryAction as BrushAction, selectedBiome, coords, brushSize) : prev
    );
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => clamp(prev + delta, MIN_ZOOM, MAX_ZOOM));
  };

  const beginPan = (clientX: number, clientY: number) => {
    setIsPanning(true);
    lastPanRef.current = { x: clientX, y: clientY };
  };

  const endGestures = () => {
    setIsPanning(false);
    setIsBrushing(false);
    lastPanRef.current = null;
  };

  const handleCanvasMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button === 2) {
      event.preventDefault();
      beginPan(event.clientX, event.clientY);
      return;
    }
    if (event.button !== 0) return;
    if (isBrushAction) {
      setIsBrushing(true);
      applyBrushAt(event);
    }
  };

  const handleCanvasMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (isPanning && lastPanRef.current) {
      const dx = event.clientX - lastPanRef.current.x;
      const dy = event.clientY - lastPanRef.current.y;
      setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (isBrushing) {
      applyBrushAt(event);
    }
  };

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isBrushAction) return;
    const coords = screenToMapPoint(event);
    if (!coords || !mapState) return;
    if (primaryAction === "navigate") {
      const clickedCity = mapState.cities.find((city) => distance(city, coords) < 0.02);
      setSelectedCity(clickedCity ?? null);
      return;
    }
    if (primaryAction === "place-city") {
      const name = `City ${mapState.cities.length + 1}`;
      setMapState((prev) => (prev ? addCityToMap(prev, name, coords.x, coords.y) : prev));
      setStatusMessage(`Placed ${name} and connected it to the road network.`);
      setSelectedCity(null);
      return;
    }
    if (primaryAction === "add-road") {
      const snapped = snapToNetwork(mapState, coords);
      if (!roadDraftStart) {
        setRoadDraftStart(snapped);
        setStatusMessage(`Road start set near ${snapped.label}. Select an end point.`);
        return;
      }
      const path = buildRoadPath(
        mapState,
        {
          id: "start",
          name: "Start",
          x: roadDraftStart.x,
          y: roadDraftStart.y,
          elevation: 0,
          population: 0,
        },
        {
          id: "end",
          name: "End",
          x: snapped.x,
          y: snapped.y,
          elevation: 0,
          population: 0,
        }
      );
      if (path && path.length > 1) {
        setMapState((prev) =>
          prev
            ? {
                ...prev,
                roads: [
                  ...prev.roads,
                  {
                    id: randomId(),
                    from_city_id: roadDraftStart.targetId,
                    to_city_id: snapped.targetId,
                    points: path,
                  },
                ],
              }
            : prev
        );
        setStatusMessage("Road added between points.");
      } else {
        setStatusMessage("Unable to route road between those points.");
      }
      setRoadDraftStart(null);
    }
  };

  const cursorStyle = useMemo(() => {
    if (isPanning) return "grabbing";
    if (primaryAction === "add-road" || primaryAction === "place-city") return "pointer";
    if (isBrushAction) return "crosshair";
    return "grab";
  }, [isPanning, primaryAction, isBrushAction]);

  const renderGeneralPanel = () => (
    <>
      <section className="space-y-2 mt-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-brand-glow">View</h3>
            <p className="text-xs text-earth-sand/70">Zoom {zoom.toFixed(2)} • Pan to explore</p>
          </div>
          <button
            className="text-[11px] text-earth-sand/70 hover:text-white"
            onClick={() => {
              setPanOffset({ x: 0, y: 0 });
              setZoom(1);
            }}
          >
            Reset
          </button>
        </div>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-full"
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-brand-glow">Terrain synthesis</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleGenerateMap} className="primary-button text-xs">
            Auto-generate
          </button>
          <button onClick={handleNaturalize} className="secondary-button text-xs">
            Naturalize relief
          </button>
        </div>
        <label className="block text-xs text-earth-sand/70">
          Water level ({mapState?.water_level.toFixed(2)})
        </label>
        <input
          type="range"
          min={0.2}
          max={0.7}
          step={0.01}
          value={mapState?.water_level ?? DEFAULT_WATER_LEVEL}
          onChange={(e) => handleWaterChange(Number(e.target.value))}
          className="w-full"
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-brand-glow">Grid & metrics</h3>
        <label className="text-xs text-earth-sand/70">Map resolution</label>
        <div className="flex gap-2">
          <select
            className="flex-1 rounded border border-grove-700 bg-grove-800 px-3 py-2 text-sm"
            value={desiredSize}
            onChange={(e) => setDesiredSize(Number(e.target.value))}
          >
            {MAP_SIZE_CHOICES.map((size) => (
              <option key={size} value={size}>
                {size} × {size}
              </option>
            ))}
          </select>
          <button onClick={handleResizeMap} className="secondary-button text-xs">
            Apply
          </button>
        </div>
        <div className="space-y-1 text-xs text-earth-sand/70">
          <p>Seed: {mapState?.seed}</p>
          <p>
            Cells: {mapState?.width} × {mapState?.height}
          </p>
          <p>Cities: {mapInfo?.cityCount ?? 0}</p>
          <p>Roads: {mapInfo?.roadCount ?? 0}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSaveMap}
            disabled={saving}
            className="primary-button text-xs disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save map"}
          </button>
          <button
            onClick={() => {
              setMapState((prev) => (prev ? { ...prev, cities: [], roads: [] } : prev));
              setStatusMessage("Cleared cities and roads.");
            }}
            className="secondary-button text-xs"
          >
            Clear settlements
          </button>
        </div>
      </section>
    </>
  );

  const renderBiomePanel = () => (
    <section className="space-y-3 mt-2">
      <div>
        <h3 className="text-sm font-semibold text-brand-glow">Biome brush</h3>
        <p className="text-xs text-earth-sand/70">
          Paint regional colors and moisture bands. Brush is the active primary action.
        </p>
      </div>
      <div className="flex gap-2 text-xs items-center">
        <label className="text-earth-sand/80 uppercase tracking-wide">Biome</label>
        <select
          className="flex-1 rounded border border-grove-700 bg-grove-800 px-2 py-1"
          value={selectedBiome}
          onChange={(e) => setSelectedBiome(e.target.value as Biome)}
        >
          {(
            [
              "ocean",
              "shallow",
              "beach",
              "plains",
              "forest",
              "jungle",
              "desert",
              "tundra",
              "mountain",
              "snow",
            ] as Biome[]
          ).map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-earth-sand/70">Brush size</label>
        <input
          type="range"
          min={0.01}
          max={0.15}
          step={0.01}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="w-full"
        />
      </div>
    </section>
  );

  const renderReliefPanel = () => (
    <section className="space-y-3 mt-2">
      <div>
        <h3 className="text-sm font-semibold text-brand-glow">Relief sculpting</h3>
        <p className="text-xs text-earth-sand/70">Raise or lower elevation with soft brushes.</p>
      </div>
      <div className="flex gap-2">
        {(["raise", "lower"] as BrushAction[]).map((action) => (
          <button
            key={action}
            onClick={() => setReliefAction(action)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              reliefAction === action
                ? "border-brand bg-brand/20 text-brand-glow"
                : "border-grove-700 text-earth-sand/70 hover:text-white"
            }`}
          >
            {action === "raise" ? "Raise" : "Lower"}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <label className="text-xs text-earth-sand/70">Brush size</label>
        <input
          type="range"
          min={0.01}
          max={0.15}
          step={0.01}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="w-full"
        />
      </div>
    </section>
  );

  const renderLocationsPanel = () => (
    <section className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-brand-glow">Locations</h3>
          <p className="text-xs text-earth-sand/70">
            Place settlements or lay roads. Primary action defaults to navigation.
          </p>
        </div>
        <div className="flex gap-1">
          {([
            "navigate",
            "place-city",
            "add-road",
          ] as PrimaryAction[]).map((action) => (
            <button
              key={action}
              onClick={() => setLocationAction(action)}
              className={`text-[11px] px-3 py-1 rounded-full border transition ${
                locationAction === action
                  ? "border-brand bg-brand/20 text-brand-glow"
                  : "border-grove-700 text-earth-sand/70 hover:text-white"
              }`}
            >
              {PRIMARY_ACTION_LABEL[action]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {mapState?.cities.length === 0 ? (
          <p className="text-xs text-earth-sand/60">
            No settlements yet. Switch to “Add city” and click the map to create one.
          </p>
        ) : (
          mapState?.cities.map((city) => (
            <div
              key={city.id}
              className="rounded border border-grove-700/70 px-3 py-2 text-xs text-earth-sand/80 flex items-center justify-between gap-2"
            >
              <div>
                <p className="text-sm text-brand-glow">{city.name}</p>
                <p>Pop. {city.population.toLocaleString()}</p>
              </div>
              <div className="flex flex-col gap-1">
                <button
                  className="text-[11px] text-earth-sand/70 hover:text-white"
                  onClick={() => setSelectedCity(city)}
                >
                  Inspect
                </button>
                <button
                  className="text-[11px] text-earth-sand/70 hover:text-white"
                  onClick={() => setCityEditorCity(city)}
                >
                  City map
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );

  const renderSidebarContent = () => {
    switch (toolGroup) {
      case "biome":
        return renderBiomePanel();
      case "relief":
        return renderReliefPanel();
      case "locations":
        return renderLocationsPanel();
      default:
        return renderGeneralPanel();
    }
  };

  if (!worldId) {
    return <p className="text-sm text-red-400 p-6">World not found.</p>;
  }

  if (loading || !mapState) {
    return <p className="text-sm text-earth-sand/70 p-6">Loading world map...</p>;
  }

  return (
    <div className="relative w-full h-full bg-brand-deep text-brand-glow overflow-hidden">
      <div
        ref={viewportRef}
        className="absolute inset-0"
        style={{ cursor: cursorStyle }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={handleWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={endGestures}
        onMouseLeave={endGestures}
        onClick={handleCanvasClick}
      >
        <canvas ref={canvasRef} className="block select-none" />
      </div>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex gap-2 rounded-full bg-grove-900/90 px-5 py-3 shadow-panel backdrop-blur">
        {(Object.keys(TOOL_GROUP_LABELS) as ToolGroup[]).map((group) => (
          <button
            key={group}
            onClick={() => setToolGroup(group)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              toolGroup === group
                ? "bg-brand text-black shadow-lg"
                : "text-brand-glow/70 hover:text-brand-glow hover:bg-brand/10"
            }`}
          >
            {TOOL_GROUP_LABELS[group]}
          </button>
        ))}
      </div>

      <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
        <button
          className="text-xs px-3 py-1.5 rounded-full border border-grove-700 bg-grove-900/80 hover:text-white"
          onClick={() => setViewMode((prev) => (prev === "iso" ? "grid" : "iso"))}
        >
          Change view
        </button>
      </div>

      {statusMessage && (
        <div className="absolute top-4 left-4 z-30 bg-grove-900/80 border border-earth-clay text-xs px-4 py-2 rounded shadow-lg flex items-center gap-3">
          <span>{statusMessage}</span>
          <button
            className="text-[11px] text-earth-sand/70 hover:text-white"
            onClick={() => setStatusMessage(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="absolute top-4 right-32 z-30 bg-red-900/70 border border-red-500 text-xs px-4 py-2 rounded shadow-lg">
          Error: {error}
        </div>
      )}

      <aside
        className={`absolute top-20 bottom-4 left-4 z-20 transition-all duration-300 ${
          sidebarOpen ? "w-96" : "w-14"
        }`}
      >
        <div className="h-full rounded-3xl bg-grove-900/85 border border-grove-700 shadow-panel backdrop-blur flex flex-col">
          <button
            className="text-[11px] text-earth-sand/70 hover:text-white self-end px-4 py-2"
            onClick={() => setSidebarOpen((prev) => !prev)}
          >
            {sidebarOpen ? "<" : ">"}
          </button>
          <div
            className={`flex-1 overflow-y-auto space-y-6 px-6 pb-6 transition-opacity ${
              sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            {renderSidebarContent()}
          </div>
        </div>
      </aside>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-grove-900/80 border border-grove-700 text-xs text-earth-sand/80 shadow-panel">
        Primary: {PRIMARY_ACTION_LABEL[primaryAction]} • Secondary: Navigate / pan
      </div>

      {roadDraftStart && primaryAction === "add-road" && (
        <p className="absolute bottom-4 left-4 text-[11px] text-earth-sand/80 z-30">
          Road start near {roadDraftStart.label}. Click another node to complete.
        </p>
      )}

      {selectedCity && (
        <div className="absolute bottom-6 right-6 z-30 w-80 rounded-2xl border border-grove-700 bg-grove-900/90 p-4 shadow-panel space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-brand-glow">{selectedCity.name}</h3>
              <p className="text-xs text-earth-sand/70">
                Elevation {(selectedCity.elevation * 1000).toFixed(0)} m · Pop. {selectedCity.population.toLocaleString()}
              </p>
            </div>
            <button className="text-[11px] text-earth-sand/70" onClick={() => setSelectedCity(null)}>
              Close
            </button>
          </div>
          <p className="text-xs text-earth-sand/70">
            Open the city mapper to sketch plazas and alleys. Civic buildings snap to main roads,
            private estates spawn winding paths automatically.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setCityEditorCity(selectedCity)} className="primary-button text-xs">
              City mapper
            </button>
            <button
              onClick={() => setStatusMessage(`Focused view on ${selectedCity.name}.`)}
              className="secondary-button text-xs"
            >
              Set focus
            </button>
          </div>
        </div>
      )}

      {cityEditorCity && (
        <CityMapEditor city={cityEditorCity} onClose={() => setCityEditorCity(null)} />
      )}
    </div>
  );
}
