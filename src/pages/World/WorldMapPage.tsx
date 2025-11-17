import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useParams } from "react-router-dom";
import {
  getWorldMap,
  saveWorldMap,
  type MapCity,
  type MapState,
  type MapRoad
} from "../../api/worldMap";

const MAP_WIDTH = 96;
const MAP_HEIGHT = 96;
const DEFAULT_WATER_LEVEL = 0.42;

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

const BIOME_COLORS: Record<Biome, [number, number, number]> = {
  ocean: [24, 60, 105],
  shallow: [40, 90, 135],
  beach: [208, 190, 140],
  plains: [90, 140, 80],
  forest: [50, 110, 65],
  jungle: [20, 90, 50],
  desert: [200, 170, 95],
  tundra: [150, 150, 170],
  mountain: [120, 110, 110],
  snow: [235, 240, 245],
};

type PixelPoint = { x: number; y: number };

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
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

function smoothRelief(relief: number[], width: number, height: number, iterations = 1) {
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

function generateProceduralMap(seed: number, waterLevel = DEFAULT_WATER_LEVEL): MapState {
  const relief: number[] = new Array(MAP_WIDTH * MAP_HEIGHT);
  const moisture: number[] = new Array(MAP_WIDTH * MAP_HEIGHT);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const nx = x / MAP_WIDTH - 0.5;
      const ny = y / MAP_HEIGHT - 0.5;
      const distance = Math.sqrt(nx * nx + ny * ny);
      const elevation = fbm(nx * 4, ny * 4, seed) - distance * 0.7;
      const moistureValue = fbm(nx * 6 + 100, ny * 6 + 200, seed + 1337);
      const idx = y * MAP_WIDTH + x;
      relief[idx] = clamp(Math.pow(elevation + 0.5, 1.25));
      moisture[idx] = clamp(moistureValue);
    }
  }
  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    relief: smoothRelief(relief, MAP_WIDTH, MAP_HEIGHT, 2),
    moisture,
    water_level: waterLevel,
    seed,
    cities: [],
    roads: [],
  };
}

function drawMap(canvas: HTMLCanvasElement, map: MapState) {
  canvas.width = map.width;
  canvas.height = map.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(map.width, map.height);
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const idx = y * map.width + x;
      const biome = computeBiome(map.relief[idx], map.moisture[idx], map.water_level);
      const [r, g, b] = BIOME_COLORS[biome];
      const pixelIndex = idx * 4;
      image.data[pixelIndex] = r;
      image.data[pixelIndex + 1] = g;
      image.data[pixelIndex + 2] = b;
      image.data[pixelIndex + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(215, 180, 130, 0.8)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  map.roads.forEach((road) => {
    if (road.points.length < 2) return;
    ctx.beginPath();
    road.points.forEach((point, index) => {
      const px = point.x * map.width;
      const py = point.y * map.height;
      if (index === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.stroke();
  });

  map.cities.forEach((city) => {
    const px = city.x * map.width;
    const py = city.y * map.height;
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.font = "3px Inter, sans-serif";
    ctx.fillText(city.name.slice(0, 12), px + 2, py - 2);
  });
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function distance(a: PixelPoint, b: PixelPoint) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function findNearestCity(cities: MapCity[], target: MapCity) {
  let best: MapCity | null = null;
  let bestDistance = Number.MAX_VALUE;
  for (const city of cities) {
    const d = distance({ x: city.x, y: city.y }, { x: target.x, y: target.y });
    if (d < bestDistance) {
      best = city;
      bestDistance = d;
    }
  }
  return best;
}

function buildRoadPath(map: MapState, from: MapCity, to: MapCity): Array<{ x: number; y: number }> | null {
  const width = map.width;
  const height = map.height;
  const startX = Math.round(from.x * (width - 1));
  const startY = Math.round(from.y * (height - 1));
  const goalX = Math.round(to.x * (width - 1));
  const goalY = Math.round(to.y * (height - 1));
  const startIndex = startY * width + startX;
  const goalIndex = goalY * width + goalX;

  const gScore = new Array(width * height).fill(Number.MAX_VALUE);
  const fScore = new Array(width * height).fill(Number.MAX_VALUE);
  const cameFrom = new Array(width * height).fill(-1);

  const open: number[] = [startIndex];
  gScore[startIndex] = 0;
  fScore[startIndex] = distance(
    { x: startX, y: startY },
    { x: goalX, y: goalY }
  );

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ];

  while (open.length) {
    open.sort((a, b) => fScore[a] - fScore[b]);
    const current = open.shift();
    if (current === undefined) break;
    if (current === goalIndex) {
      const path: PixelPoint[] = [];
      let node = current;
      while (node !== -1) {
        const x = node % width;
        const y = Math.floor(node / width);
        path.push({ x, y });
        node = cameFrom[node];
      }
      path.reverse();
      return path.map((point) => ({
        x: (point.x + 0.5) / width,
        y: (point.y + 0.5) / height,
      }));
    }

    const currentHeight = map.relief[current];
    const cx = current % width;
    const cy = Math.floor(current / width);

    for (const [dx, dy] of neighbors) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighborIndex = ny * width + nx;
      const heightCost = Math.abs(map.relief[neighborIndex] - currentHeight) * 50;
      const waterPenalty = map.relief[neighborIndex] < map.water_level ? 25 : 0;
      const stepCost = Math.hypot(dx, dy) + heightCost + waterPenalty;
      const tentativeG = gScore[current] + stepCost;
      if (tentativeG < gScore[neighborIndex]) {
        cameFrom[neighborIndex] = current;
        gScore[neighborIndex] = tentativeG;
        fScore[neighborIndex] =
          tentativeG +
          distance({ x: nx, y: ny }, { x: goalX, y: goalY }) *
            (1 + Math.abs(map.relief[neighborIndex] - map.relief[startIndex]) * 30);
        if (!open.includes(neighborIndex)) {
          open.push(neighborIndex);
        }
      }
    }
  }
  return null;
}

function addCityToMap(map: MapState, name: string, xRatio: number, yRatio: number): MapState {
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

  const roads: MapRoad[] = [...map.roads];
  if (map.cities.length > 0) {
    const nearest = findNearestCity(map.cities, city);
    if (nearest) {
      const path = buildRoadPath(map, nearest, city);
      if (path && path.length > 1) {
        roads.push({
          id: randomId(),
          from_city_id: nearest.id,
          to_city_id: city.id,
          points: path,
        });
      }
    }
  }

  return {
    ...map,
    cities: [...map.cities, city],
    roads,
  };
}

type EditorMode = "view" | "place-city";

export function WorldMapPage() {
  const { worldId } = useParams();
  const [mapState, setMapState] = useState<MapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("view");
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingCityName, setPendingCityName] = useState("New City");
  const [selectedCity, setSelectedCity] = useState<MapCity | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!worldId) return;
    setLoading(true);
    getWorldMap(worldId)
      .then((map) => {
        if (map) {
          setMapState(map);
        } else {
          setMapState(generateProceduralMap(Math.floor(Math.random() * 1_000_000)));
        }
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [worldId]);

  useEffect(() => {
    if (mapState && canvasRef.current) {
      drawMap(canvasRef.current, mapState);
    }
  }, [mapState]);

  const mapInfo = useMemo(() => {
    if (!mapState) return null;
    return {
      cityCount: mapState.cities.length,
      roadCount: mapState.roads.length,
      highestPeak: Math.max(...mapState.relief),
    };
  }, [mapState]);

  const handleGenerateMap = () => {
    const newSeed = Math.floor(Math.random() * 1_000_000);
    setMapState(generateProceduralMap(newSeed, mapState?.water_level ?? DEFAULT_WATER_LEVEL));
    setStatusMessage("Generated new terrain with fresh relief, biomes, and seed.");
  };

  const handleNaturalize = () => {
    if (!mapState) return;
    setMapState({
      ...mapState,
      relief: smoothRelief(mapState.relief, mapState.width, mapState.height, 1),
    });
    setStatusMessage("Smoothed elevation to naturalize cliffs and plateaus.");
  };

  const handleWaterChange = (value: number) => {
    if (!mapState) return;
    setMapState({ ...mapState, water_level: value });
  };

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!mapState || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;

    if (editorMode === "place-city") {
      const name =
        pendingCityName.trim() || `City ${mapState.cities.length + 1}`;
      const nextMap = addCityToMap(mapState, name, xRatio, yRatio);
      setMapState(nextMap);
      setEditorMode("view");
      setPendingCityName("");
      setStatusMessage(`Placed ${name} and generated an elevation-aware road.`);
      return;
    }

    const clickedCity = mapState.cities.find(
      (city) => distance(city, { x: xRatio, y: yRatio }) < 0.02
    );
    if (clickedCity) {
      setSelectedCity(clickedCity);
    } else {
      setSelectedCity(null);
    }
  };

  const handleSaveMap = async () => {
    if (!worldId || !mapState) return;
    setSaving(true);
    try {
      await saveWorldMap(worldId, mapState);
      setStatusMessage("Saved map state, cities, and roads.");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!worldId) {
    return <p className="text-sm text-red-400">World not found.</p>;
  }

  if (loading) {
    return <p className="text-sm text-slate-400">Loading map data...</p>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="space-y-1">
        <h2 className="text-lg font-bold">World Atlas</h2>
        <p className="text-sm text-slate-300">
          Procedural relief, water tables, and biome paints with city+road overlays.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">Error: {error}</p>}
      {statusMessage && (
        <p className="text-xs text-sky-300 bg-sky-900/20 px-3 py-2 rounded border border-sky-800">
          {statusMessage}
        </p>
      )}

      <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between">
          <div className="space-y-0.5 text-sm">
            <p className="text-slate-200 font-medium">Atlas View</p>
            <p className="text-slate-500 text-xs">
              Click cities to inspect or toggle editor to sculpt terrain.
            </p>
          </div>
          <button
            className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400"
            onClick={() => setEditorOpen((prev) => !prev)}
          >
            {editorOpen ? "Close editor" : "Edit map"}
          </button>
        </div>

        <div
          className="relative"
          onClick={handleCanvasClick}
          style={{ cursor: editorMode === "place-city" ? "crosshair" : "pointer" }}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full block"
            style={{
              width: "100%",
              height: "540px",
              imageRendering: "pixelated",
            }}
          />
          {mapState && (
            <div className="absolute inset-0 pointer-events-none">
              {mapState.cities.map((city) => (
                <div
                  key={city.id}
                  className="absolute text-[10px] text-yellow-200 font-semibold"
                  style={{
                    left: `${city.x * 100}%`,
                    top: `${city.y * 100}%`,
                    transform: "translate(-50%, -120%)",
                  }}
                >
                  {city.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editorOpen && mapState && (
        <section className="space-y-4 border border-slate-800 rounded-lg p-4 bg-slate-950/60">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">
                Terrain & Biomes
              </h3>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleGenerateMap}
                  className="px-3 py-2 rounded bg-sky-600 text-xs"
                >
                  Auto-generate map
                </button>
                <button
                  onClick={handleNaturalize}
                  className="px-3 py-2 rounded border border-slate-600 text-xs"
                >
                  Naturalize relief
                </button>
              </div>
              <label className="block text-xs text-slate-400">
                Water level ({mapState.water_level.toFixed(2)})
              </label>
              <input
                type="range"
                min={0.2}
                max={0.7}
                step={0.01}
                value={mapState.water_level}
                onChange={(e) => handleWaterChange(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">
                City Grid
              </h3>
              <div className="flex flex-col gap-2">
                <input
                  className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  placeholder="City name"
                  value={pendingCityName}
                  onChange={(e) => setPendingCityName(e.target.value)}
                />
                <button
                  onClick={() =>
                    setEditorMode(editorMode === "place-city" ? "view" : "place-city")
                  }
                  className={`px-3 py-2 rounded text-xs ${
                    editorMode === "place-city"
                      ? "bg-amber-600 text-black"
                      : "bg-slate-800"
                  }`}
                >
                  {editorMode === "place-city"
                    ? "Click on map to confirm city"
                    : "Add city & auto-road"}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            <span>Seed: {mapState.seed}</span>
            <span>Cells: {mapState.width}×{mapState.height}</span>
            <span>Cities: {mapInfo?.cityCount ?? 0}</span>
            <span>Roads: {mapInfo?.roadCount ?? 0}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSaveMap}
              disabled={saving}
              className="px-4 py-2 rounded bg-emerald-600 text-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save map"}
            </button>
            <button
              onClick={() => {
                setMapState((prev) =>
                  prev ? { ...prev, cities: [], roads: [] } : prev
                );
                setStatusMessage("Cleared cities and roads.");
              }}
              className="px-4 py-2 rounded border border-slate-700 text-sm"
            >
              Clear settlements
            </button>
          </div>
        </section>
      )}

      {selectedCity && (
        <section className="border border-slate-800 rounded-lg p-4 bg-slate-950/50 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {selectedCity.name}
              </h3>
              <p className="text-xs text-slate-500">
                Elevation: {(selectedCity.elevation * 1000).toFixed(0)} m · Population{" "}
                {selectedCity.population.toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => setSelectedCity(null)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Close
            </button>
          </div>
          <div className="bg-slate-900 rounded p-3 text-xs text-slate-400 min-h-[120px]">
            City map editor coming soon. For now, this panel serves as the entry point for
            district notes, encounters, and trade routes.
          </div>
        </section>
      )}
    </div>
  );
}
