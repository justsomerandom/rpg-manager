import { useEffect, useMemo, useState } from "react";
import type { CityMap, CityRoad, CityRoadPoint, CitySize } from "../api/cityMap";
import { getCityMap, saveCityMap } from "../api/cityMap";
import type { MapCity } from "../api/worldMap";

type Props = {
  city: MapCity;
  onClose: () => void;
};

const CITY_SIZES: { key: CitySize; label: string; baseRoads: number }[] = [
  { key: "village", label: "Village", baseRoads: 3 },
  { key: "town", label: "Town", baseRoads: 5 },
  { key: "city", label: "City", baseRoads: 7 },
  { key: "megapolis", label: "Megapolis", baseRoads: 10 },
];

const BUILDING_TYPES = [
  { key: "private", label: "Private dwelling" },
  { key: "public", label: "Public space" },
  { key: "market", label: "Market / plaza" },
  { key: "utility", label: "Utility / guild" },
] as const;

const SVG_SIZE = 520;

type PendingBuilding = {
  name: string;
  kind: (typeof BUILDING_TYPES)[number]["key"];
};

function randomId() {
  return Math.random().toString(36).slice(2, 9);
}

function pseudoRandom(seed: number) {
  let value = seed % 2147483647;
  return () => {
    value = (value * 48271) % 2147483647;
    return value / 2147483647;
  };
}

function generateRoadPoints(
  count: number,
  rng: () => number
): CityRoadPoint[] {
  const points: CityRoadPoint[] = [];
  const angle = rng() * Math.PI * 2;
  const radiusStep = 0.25 + rng() * 0.25;
  for (let i = 0; i < count; i += 1) {
    const r = Math.min(1, (i + 1) * radiusStep);
    const jitter = (rng() - 0.5) * 0.15;
    points.push({
      id: randomId(),
      x: 0.5 + Math.cos(angle + jitter) * r * 0.5,
      y: 0.5 + Math.sin(angle - jitter) * r * 0.5,
    });
  }
  return points;
}

function generateCityMap(city: MapCity, size: CitySize, seed = Date.now()): CityMap {
  const sizeMeta = CITY_SIZES.find((s) => s.key === size) ?? CITY_SIZES[0];
  const rng = pseudoRandom(seed);
  const roads: CityRoad[] = [];
  const primaryRoads = Math.max(sizeMeta.baseRoads - 2, 2);
  for (let i = 0; i < sizeMeta.baseRoads; i += 1) {
    const importance = i < primaryRoads ? "main" : "secondary";
    roads.push({
      id: randomId(),
      name: `${importance === "main" ? "Avenue" : "Street"} ${i + 1}`,
      importance,
      points: generateRoadPoints(4 + Math.floor(rng() * 3), rng),
    });
  }

  return {
    city_id: city.id,
    size_label: size,
    width: 1,
    height: 1,
    seed,
    roads,
    buildings: [],
  };
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function integrateBuildingWithRoads(
  map: CityMap,
  pending: PendingBuilding,
  coordinates: { x: number; y: number }
): CityMap {
  const buildings = [
    ...map.buildings,
    {
      id: randomId(),
      name: pending.name,
      kind: pending.kind,
      x: coordinates.x,
      y: coordinates.y,
      footprint: pending.kind === "public" ? 0.07 : 0.04,
    },
  ];

  const roads = map.roads.map((road) => ({ ...road, points: road.points.slice() }));
  if (pending.kind === "private" || pending.kind === "utility") {
    // add a small alley branching off the closest road
    const target =
      roads
        .map((road) => ({
          road,
          dist: road.points.reduce(
            (min, point) =>
              Math.min(min, Math.hypot(point.x - coordinates.x, point.y - coordinates.y)),
            Number.MAX_VALUE
          ),
        }))
        .sort((a, b) => a.dist - b.dist)[0]?.road ?? roads[0];
    const lastPoint = target.points[target.points.length - 1];
    const stubId = randomId();
    const alley = {
      id: stubId,
      name: `${pending.name} Lane`,
      importance: "alley" as const,
      points: [
        {
          id: randomId(),
          x: lastPoint ? (lastPoint.x + coordinates.x) / 2 : coordinates.x,
          y: lastPoint ? (lastPoint.y + coordinates.y) / 2 : coordinates.y,
        },
        { id: randomId(), x: coordinates.x, y: coordinates.y },
      ],
    };
    roads.push(alley);
  } else {
    const mainRoad =
      roads.find((road) => road.importance === "main") ?? roads[0];
    if (mainRoad) {
      const insertIndex = Math.floor(mainRoad.points.length / 2);
      mainRoad.points.splice(insertIndex, 0, {
        id: randomId(),
        x: coordinates.x,
        y: coordinates.y,
      });
    }
  }

  return { ...map, roads, buildings };
}

export function CityMapEditor({ city, onClose }: Props) {
  const [mapData, setMapData] = useState<CityMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [placingBuilding, setPlacingBuilding] = useState<PendingBuilding | null>(null);
  const [buildingName, setBuildingName] = useState(`${city.name} Hall`);
  const [buildingKind, setBuildingKind] =
    useState<(typeof BUILDING_TYPES)[number]["key"]>("public");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getCityMap(city.id)
      .then((existing) => {
        if (!mounted) return;
        if (existing) {
          setMapData(existing);
        } else {
          setMapData(generateCityMap(city, "town"));
        }
        setError(null);
      })
      .catch((e) => mounted && setError(String(e)))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [city]);

  const sizeMeta = useMemo(
    () => CITY_SIZES.find((s) => s.key === mapData?.size_label) ?? CITY_SIZES[1],
    [mapData?.size_label]
  );

  const handleSvgClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!mapData || !placingBuilding) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width);
    const y = clamp((event.clientY - rect.top) / rect.height);
    setMapData(
      integrateBuildingWithRoads(mapData, placingBuilding, { x, y })
    );
    setPlacingBuilding(null);
    setBuildingName(`${city.name} Hall`);
  };

  const handleRandomizeRoads = () => {
    if (!mapData) return;
    const seed = Date.now();
    setMapData({
      ...mapData,
      seed,
      roads: generateCityMap(city, mapData.size_label, seed).roads,
    });
    setStatus("Regenerated road layout.");
  };

  const handleSizeChange = (size: CitySize) => {
    if (!mapData) return;
    setMapData({
      ...mapData,
      size_label: size,
    });
  };

  const updateRoadPoint = (roadId: string, pointId: string, patch: Partial<CityRoadPoint>) => {
    if (!mapData) return;
    setMapData({
      ...mapData,
      roads: mapData.roads.map((road) =>
        road.id !== roadId
          ? road
          : {
              ...road,
              points: road.points.map((point) =>
                point.id === pointId ? { ...point, ...patch } : point
              ),
            }
      ),
    });
  };

  const addRoadPoint = (roadId: string) => {
    if (!mapData) return;
    setMapData({
      ...mapData,
      roads: mapData.roads.map((road) =>
        road.id !== roadId
          ? road
          : {
              ...road,
              points: [
                ...road.points,
                {
                  id: randomId(),
                  x: clamp(road.points[road.points.length - 1]?.x ?? 0.5 + 0.05),
                  y: clamp(road.points[road.points.length - 1]?.y ?? 0.5 + 0.05),
                },
              ],
            }
      ),
    });
  };

  const removeBuilding = (id: string) => {
    if (!mapData) return;
    setMapData({
      ...mapData,
      buildings: mapData.buildings.filter((b) => b.id !== id),
    });
  };

  const handleSave = async () => {
    if (!mapData) return;
    setSaving(true);
    try {
      await saveCityMap(city.id, mapData);
      setStatus("City map saved.");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-5xl h-full max-h-[90vh] flex flex-col overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {city.name} · City Mapper
            </h2>
            <p className="text-xs text-slate-400">
              Sculpt roads and districts for this settlement.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400"
          >
            Close
          </button>
        </header>
        <div className="flex-1 grid lg:grid-cols-2 overflow-hidden">
          <div className="border-r border-slate-800 p-4 flex flex-col gap-3 overflow-hidden">
            {loading || !mapData ? (
              <p className="text-sm text-slate-400">Loading city map…</p>
            ) : (
              <>
                <svg
                  width={SVG_SIZE}
                  height={SVG_SIZE}
                  viewBox="0 0 1 1"
                  className="w-full max-h-[320px] bg-slate-950/60 border border-slate-800 rounded"
                  onClick={handleSvgClick}
                >
                  <defs>
                    <radialGradient id="city-bg" cx="50%" cy="50%" r="70%">
                      <stop offset="0%" stopColor="#0f172a" />
                      <stop offset="100%" stopColor="#020617" />
                    </radialGradient>
                  </defs>
                  <rect x={0} y={0} width={1} height={1} fill="url(#city-bg)" />
                  {mapData.roads.map((road) => (
                    <polyline
                      key={road.id}
                      points={road.points.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke={
                        road.importance === "main"
                          ? "#f97316"
                          : road.importance === "secondary"
                          ? "#facc15"
                          : "#94a3b8"
                      }
                      strokeWidth={road.importance === "main" ? 0.01 : 0.005}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {mapData.buildings.map((building) => (
                    <g key={building.id}>
                      <circle
                        cx={building.x}
                        cy={building.y}
                        r={0.01}
                        fill={
                          building.kind === "public"
                            ? "#38bdf8"
                            : building.kind === "market"
                            ? "#fcd34d"
                            : "#ef4444"
                        }
                      />
                      <text
                        x={building.x + 0.01}
                        y={building.y - 0.01}
                        fontSize="0.018"
                        fill="#e2e8f0"
                      >
                        {building.name}
                      </text>
                    </g>
                  ))}
                </svg>
                {placingBuilding && (
                  <p className="text-xs text-amber-300">
                    Click on the map to place {placingBuilding.name}.
                  </p>
                )}
              </>
            )}
          </div>
          <div className="p-4 space-y-4 overflow-y-auto">
            {error && <p className="text-xs text-red-400">Error: {error}</p>}
            {status && (
              <p className="text-xs text-sky-300 bg-sky-900/10 border border-sky-900 px-3 py-2 rounded">
                {status}
              </p>
            )}
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase text-slate-400 tracking-wide">
                  Size
                </label>
                <select
                  value={mapData?.size_label ?? "town"}
                  onChange={(e) => handleSizeChange(e.target.value as CitySize)}
                  className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
                >
                  {CITY_SIZES.map((size) => (
                    <option key={size.key} value={size.key}>
                      {size.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleRandomizeRoads}
                  className="text-xs px-3 py-1.5 rounded border border-slate-600"
                >
                  Randomize roads
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                {sizeMeta.label}: {sizeMeta.baseRoads} base roads.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                Buildings
              </h3>
              <div className="flex gap-2 text-sm flex-wrap">
                <input
                  className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
                  placeholder="Building name"
                  value={buildingName}
                  onChange={(e) => setBuildingName(e.target.value)}
                />
                <select
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs"
                  value={buildingKind}
                  onChange={(e) =>
                    setBuildingKind(e.target.value as PendingBuilding["kind"])
                  }
                >
                  {BUILDING_TYPES.map((type) => (
                    <option key={type.key} value={type.key}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (!buildingName.trim()) return;
                    setPlacingBuilding({
                      name: buildingName.trim(),
                      kind: buildingKind,
                    });
                    setStatus("Click on the map to place the building.");
                  }}
                  className="text-xs px-3 py-2 rounded bg-emerald-600 text-white"
                >
                  Place building
                </button>
              </div>
              <ul className="space-y-1 text-xs text-slate-300 max-h-28 overflow-y-auto pr-1">
                {mapData?.buildings.map((building) => (
                  <li
                    key={building.id}
                    className="flex items-center justify-between border border-slate-800 rounded px-2 py-1"
                  >
                    <span>
                      {building.name} · {building.kind}
                    </span>
                    <button
                      className="text-[10px] text-red-300"
                      onClick={() => removeBuilding(building.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                Roads
              </h3>
              <div className="space-y-3">
                {mapData?.roads.map((road) => (
                  <details
                    key={road.id}
                    className="border border-slate-800 rounded"
                  >
                    <summary className="px-3 py-2 text-xs text-slate-200 flex justify-between cursor-pointer">
                      <span>
                        {road.name} · {road.importance}
                      </span>
                      <span>{road.points.length} pts</span>
                    </summary>
                    <div className="px-3 py-2 space-y-2 text-[11px] text-slate-400">
                      {road.points.map((point) => (
                        <div key={point.id} className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1">
                            X
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              value={point.x}
                              onChange={(e) =>
                                updateRoadPoint(road.id, point.id, {
                                  x: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            Y
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              value={point.y}
                              onChange={(e) =>
                                updateRoadPoint(road.id, point.id, {
                                  y: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        </div>
                      ))}
                      <button
                        onClick={() => addRoadPoint(road.id)}
                        className="text-[10px] text-sky-300"
                      >
                        + Add waypoint
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            </section>
            <div className="flex justify-between items-center">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded bg-sky-600 text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save city map"}
              </button>
              <p className="text-[10px] text-slate-500">
                Roads render as editable curves. Drag sliders to adjust control points.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
