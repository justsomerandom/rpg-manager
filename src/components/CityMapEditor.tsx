import { useEffect, useMemo, useState } from "react";
import type { CityMap, CityRoad, CityRoadPoint, CitySize } from "../api/cityMap";
import { getCityMap, saveCityMap } from "../api/cityMap";
import type { MapCity } from "../api/worldMap";

type Props = {
  city: MapCity;
  onClose: () => void;
};

const CITY_SIZES: { key: CitySize; label: string; avenues: number; fillers: number }[] = [
  { key: "village", label: "Village", avenues: 3, fillers: 16 },
  { key: "town", label: "Town", avenues: 4, fillers: 42 },
  { key: "city", label: "City", avenues: 6, fillers: 100 },
  { key: "megapolis", label: "Megapolis", avenues: 8, fillers: 220 },
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
  role?: string;
  district?: District;
};

type District = "centre" | "midtown" | "edge" | "outskirts";
const SPECIAL_TYPES = ["Palace / keep", "Temple", "Market hall", "Guildhall", "Barracks", "Library", "Harbour", "Academy"];

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

function point(radius: number, angle: number) {
  return { id: randomId(), x: clamp(0.5 + Math.cos(angle) * radius), y: clamp(0.5 + Math.sin(angle) * radius) };
}

function generateCityMap(city: MapCity, size: CitySize, scale = 1, seed = Date.now()): CityMap {
  const sizeMeta = CITY_SIZES.find((s) => s.key === size) ?? CITY_SIZES[0];
  const rng = pseudoRandom(seed);
  const roads: CityRoad[] = [];
  const avenues = Math.max(3, Math.round(sizeMeta.avenues * scale));
  const radius = clamp(0.23 + scale * 0.14, 0.28, 0.46);
  for (let i = 0; i < avenues; i += 1) {
    const angle = (Math.PI * 2 * i) / avenues + (rng() - 0.5) * 0.18;
    roads.push({
      id: randomId(),
      name: `Radial Avenue ${i + 1}`,
      importance: "main",
      points: [point(0.025, angle), point(radius * 0.42, angle + (rng() - 0.5) * 0.12), point(radius, angle)],
    });
  }
  const rings = scale > 1.05 ? 2 : 1;
  for (let ring = 1; ring <= rings; ring += 1) {
    const ringRadius = radius * (ring / (rings + 1));
    roads.push({ id: randomId(), name: ring === 1 ? "Market Ring" : "Outer Ring", importance: "secondary", points: Array.from({ length: avenues + 1 }, (_, i) => point(ringRadius, (Math.PI * 2 * i) / avenues)) });
  }
  const buildings = Array.from({ length: Math.round(sizeMeta.fillers * scale) }, () => {
    const angle = rng() * Math.PI * 2;
    const spread = 0.06 + Math.sqrt(rng()) * radius * 0.92;
    return { id: randomId(), name: "Residence", kind: "private" as const, x: clamp(0.5 + Math.cos(angle) * spread), y: clamp(0.5 + Math.sin(angle) * spread), footprint: 0.009 + rng() * 0.008 };
  });

  return {
    city_id: city.id,
    size_label: size,
    width: 1,
    height: 1,
    seed, scale,
    roads,
    buildings,
  };
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function placeSpecialBuilding(map: CityMap, pending: PendingBuilding, rngSeed = Date.now()): CityMap {
  const rng = pseudoRandom(rngSeed);
  const radius = pending.district === "centre" ? 0.04 : pending.district === "midtown" ? 0.17 : pending.district === "edge" ? 0.3 : 0.4;
  const angle = rng() * Math.PI * 2;
  const coordinates = { x: clamp(0.5 + Math.cos(angle) * radius), y: clamp(0.5 + Math.sin(angle) * radius) };
  const buildings = [
    ...map.buildings,
    {
      id: randomId(),
      name: pending.name,
      kind: pending.kind,
      x: coordinates.x,
      y: coordinates.y,
      footprint: pending.kind === "public" || pending.kind === "market" ? 0.035 : 0.022,
      role: pending.role,
      district: pending.district,
    },
  ];

  return { ...map, buildings };
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
  const [specialType, setSpecialType] = useState(SPECIAL_TYPES[0]);
  const [district, setDistrict] = useState<District>("centre");
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
  }, [city.id]);

  const sizeMeta = useMemo(
    () => CITY_SIZES.find((s) => s.key === mapData?.size_label) ?? CITY_SIZES[1],
    [mapData?.size_label]
  );

  const handleSvgClick = () => {
    if (!mapData || !placingBuilding) return;
    setMapData(placeSpecialBuilding(mapData, placingBuilding));
    setPlacingBuilding(null);
    setBuildingName(`${city.name} Hall`);
  };

  const handleRandomizeRoads = () => {
    if (!mapData) return;
    const seed = Date.now();
    setMapData(generateCityMap(city, mapData.size_label, mapData.scale ?? 1, seed));
    setStatus("Regenerated road layout.");
  };

  const handleSizeChange = (size: CitySize) => {
    if (!mapData) return;
    setMapData({
      ...mapData,
      size_label: size,
    });
  };

  const handleScaleChange = (scale: number) => {
    if (!mapData) return;
    setMapData(generateCityMap(city, mapData.size_label, scale, mapData.seed));
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
              {city.name} - City Mapper
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
              <p className="text-sm text-slate-400">Loading city map...</p>
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
                    Click to generate {placingBuilding.name} in the selected district.
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
                {sizeMeta.label}: {sizeMeta.avenues} base avenues and {sizeMeta.fillers} filler buildings.
              </p>
              <label className="flex items-center gap-3 text-xs text-slate-400">
                Settlement scale
                <input type="range" min={0.6} max={2} step={0.1} value={mapData?.scale ?? 1} onChange={(e) => handleScaleChange(Number(e.target.value))} />
                <span>{(mapData?.scale ?? 1).toFixed(1)}x</span>
              </label>
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
                      role: specialType,
                      district,
                    });
                    setStatus("Click on the map to place the building.");
                  }}
                  className="text-xs px-3 py-2 rounded bg-emerald-600 text-white"
                >
                  Add special building
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <select className="rounded border border-slate-700 bg-slate-900 px-2 py-2" value={specialType} onChange={(e) => setSpecialType(e.target.value)}>
                  {SPECIAL_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
                <select className="rounded border border-slate-700 bg-slate-900 px-2 py-2" value={district} onChange={(e) => setDistrict(e.target.value as District)}>
                  <option value="centre">City centre</option><option value="midtown">Midtown</option><option value="edge">Edge</option><option value="outskirts">Outskirts</option>
                </select>
              </div>
              <ul className="space-y-1 text-xs text-slate-300 max-h-28 overflow-y-auto pr-1">
                {mapData?.buildings.map((building) => (
                  <li
                    key={building.id}
                    className="flex items-center justify-between border border-slate-800 rounded px-2 py-1"
                  >
                    <span>
                      {building.name} - {building.role ?? building.kind}{building.district ? ` (${building.district})` : ""}
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
                        {road.name} - {road.importance}
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
                {saving ? "Saving..." : "Save city map"}
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
