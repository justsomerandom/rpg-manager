import { useEffect, useMemo, useState } from "react";
import type { CityDistrict, CityMap, CityRoad, CityRoadPoint, CitySize } from "../api/cityMap";
import { getCityMap, saveCityMap } from "../api/cityMap";
import type { MapCity } from "../api/worldMap";
import { ROAD_THEMES, roadName, type RoadTheme } from "./cityRoadNames";

type Props = {
  city: MapCity;
  externalConnections?: number[];
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
type RoadArchitecture = "ring" | "grid" | "star" | "organic";

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

function generateDistricts(size: CitySize, scale: number, architecture: RoadArchitecture): CityDistrict[] {
  const count = Math.max(2, Math.min(7, Math.round(({ village: 2, town: 3, city: 5, megapolis: 7 }[size]) * scale)));
  const kinds: CityDistrict["kind"][] = size === "village" ? ["market", "centre", "outskirts"] : size === "town" ? ["market", "centre", "ward", "edge"] : ["downtown", "centre", "ward", "ward", "edge", "outskirts", "outskirts"];
  const colors = ["#38bdf8", "#facc15", "#a78bfa", "#fb7185", "#34d399", "#fb923c", "#94a3b8"];
  return Array.from({ length: count }, (_, index) => {
    const angle = architecture === "grid" ? (index % 2 ? Math.PI / 2 : 0) + Math.PI * (index / count) : (Math.PI * 2 * index) / count;
    const radius = index === 0 ? 0.12 : 0.18 + (index % 3) * 0.075;
    const kind = kinds[index % kinds.length];
    return { id: randomId(), name: kind === "downtown" ? "Downtown" : kind === "market" ? "Market quarter" : `${kind[0].toUpperCase()}${kind.slice(1)} district`, kind, x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius, radius: 0.12 + (index % 2) * 0.025, color: colors[index % colors.length] };
  });
}

function generateCityMap(city: MapCity, size: CitySize, scale = 1, seed = Date.now(), architecture: RoadArchitecture = "ring", theme: RoadTheme = "elvish", externalConnections: number[] = []): CityMap {
  const sizeMeta = CITY_SIZES.find((s) => s.key === size) ?? CITY_SIZES[0];
  const rng = pseudoRandom(seed);
  const roads: CityRoad[] = [];
  const avenues = Math.max(3, Math.round(sizeMeta.avenues * scale));
  const radius = clamp(0.23 + scale * 0.14, 0.28, 0.46);
  for (let i = 0; i < avenues; i += 1) {
    const angle = (Math.PI * 2 * i) / avenues + (rng() - 0.5) * 0.18;
    const tier = (size === "village" ? 1 : Math.min(5, 2 + Math.floor(i / Math.max(1, avenues / 3)))) as 1 | 2 | 3 | 4 | 5;
    const gridOffset = ((i / Math.max(1, avenues - 1)) - 0.5) * radius * 1.7;
    const points = architecture === "grid"
      ? i % 2 === 0
        ? [{ id: randomId(), x: 0.5 + gridOffset, y: 0.5 - radius }, { id: randomId(), x: 0.5 + gridOffset, y: 0.5 + radius }]
        : [{ id: randomId(), x: 0.5 - radius, y: 0.5 + gridOffset }, { id: randomId(), x: 0.5 + radius, y: 0.5 + gridOffset }]
      : [point(architecture === "star" ? 0.01 : 0.08, angle), point(radius * 0.48, angle + (architecture === "organic" ? (rng() - 0.5) * 0.35 : 0)), point(radius, angle)];
    roads.push({
      id: randomId(),
      name: roadName(theme, i, tier),
      importance: "main",
      tier,
      points,
    });
  }
  const rings = architecture === "ring" ? (scale > 1.05 ? 2 : 1) : 0;
  for (let ring = 1; ring <= rings; ring += 1) {
    const ringRadius = radius * (ring / (rings + 1));
    roads.push({ id: randomId(), name: roadName(theme, ring + avenues, 2), importance: "secondary", tier: Math.min(3, ring + 1) as 1 | 2 | 3, points: Array.from({ length: avenues + 1 }, (_, i) => point(ringRadius, (Math.PI * 2 * i) / avenues)) });
  }
  externalConnections.forEach((angle, index) => roads.push({ id: randomId(), name: roadName(theme, avenues + index, 4), importance: "main", tier: (size === "megapolis" ? 5 : 3) as 3 | 5, points: [point(radius, angle), point(0.5, angle)] }));
  const buildings = Array.from({ length: Math.round(sizeMeta.fillers * scale) }, (_, index) => {
    const road = roads[index % roads.length];
    const a = road.points[Math.min(road.points.length - 2, Math.floor(rng() * Math.max(1, road.points.length - 1)))];
    const b = road.points[Math.min(road.points.length - 1, road.points.indexOf(a) + 1)];
    const t = rng(); const x = a.x + (b.x - a.x) * t; const y = a.y + (b.y - a.y) * t;
    const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy) || 1;
    const tier = road.tier ?? 1; const setback = 0.012 + tier * 0.003;
    const side = rng() > 0.5 ? 1 : -1; const bx = clamp(x + (-dy / length) * setback * side); const by = clamp(y + (dx / length) * setback * side);
    const centreDistance = Math.hypot(bx - 0.5, by - 0.5); const kind: "private" | "market" | "utility" = centreDistance < 0.16 && rng() < 0.22 ? "market" : centreDistance > radius * 0.72 && rng() < 0.16 ? "utility" : "private";
    const width = (kind === "market" ? 0.018 : kind === "utility" ? 0.015 : 0.009) + rng() * (kind === "private" ? 0.01 : 0.015); const height = width * (0.7 + rng() * 1.3);
    return { id: randomId(), name: kind === "market" ? "Commercial" : kind === "utility" ? "Industry" : "Residence", kind, x: bx, y: by, footprint: width, width, height, rotation: Math.atan2(dy, dx) };
  });

  return {
    city_id: city.id,
    size_label: size,
    width: 1,
    height: 1,
    seed, scale, road_architecture: architecture, road_theme: theme, external_connections: externalConnections, districts: generateDistricts(size, scale, architecture),
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

export function CityMapEditor({ city, externalConnections = [], onClose }: Props) {
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
  const [selectedResidenceId, setSelectedResidenceId] = useState<string | null>(null);
  const [residentTag, setResidentTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDistricts, setShowDistricts] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getCityMap(city.id)
      .then((existing) => {
        if (!mounted) return;
        if (existing) {
          setMapData(existing);
        } else {
          setMapData(generateCityMap(city, "town", 1, Date.now(), "ring", "elvish", externalConnections));
        }
        setError(null);
      })
      .catch((e) => mounted && setError(String(e)))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [city.id]);

  useEffect(() => {
    setMapData((current) => {
      if (!current) return current;
      const previous = current.external_connections ?? [];
      if (previous.length === externalConnections.length && previous.every((angle, index) => Math.abs(angle - externalConnections[index]) < 0.01)) return current;
      const rebuilt = generateCityMap(city, current.size_label, current.scale ?? 1, current.seed, current.road_architecture ?? "ring", (current.road_theme ?? "elvish") as RoadTheme, externalConnections);
      return { ...rebuilt, buildings: [...rebuilt.buildings, ...current.buildings.filter((building) => building.role || building.kind !== "private")] };
    });
  }, [city, externalConnections]);

  const sizeMeta = useMemo(
    () => CITY_SIZES.find((s) => s.key === mapData?.size_label) ?? CITY_SIZES[1],
    [mapData?.size_label]
  );

  const handleSvgClick = () => {
    if (!mapData || !placingBuilding) return;
    setMapData(placeSpecialBuilding(mapData, placingBuilding));
    setPlacingBuilding(null);
    setShowDistricts(false);
    setBuildingName(`${city.name} Hall`);
  };

  const handleRandomizeRoads = () => {
    if (!mapData) return;
    const seed = Date.now();
    setMapData(generateCityMap(city, mapData.size_label, mapData.scale ?? 1, seed, mapData.road_architecture ?? "ring", (mapData.road_theme ?? "elvish") as RoadTheme, externalConnections));
    setStatus("Regenerated road layout.");
  };

  const handleSizeChange = (size: CitySize) => {
    if (!mapData) return;
    setMapData(generateCityMap(city, size, mapData.scale ?? 1, Date.now(), mapData.road_architecture ?? "ring", (mapData.road_theme ?? "elvish") as RoadTheme, externalConnections));
  };

  const handleScaleChange = (scale: number) => {
    if (!mapData) return;
    setMapData(generateCityMap(city, mapData.size_label, scale, mapData.seed, mapData.road_architecture ?? "ring", (mapData.road_theme ?? "elvish") as RoadTheme, externalConnections));
  };

  const regenerateLayout = (architecture: RoadArchitecture, theme: RoadTheme) => {
    if (!mapData) return;
    setMapData(generateCityMap(city, mapData.size_label, mapData.scale ?? 1, Date.now(), architecture, theme, externalConnections));
  };

  const saveResidentTag = () => {
    if (!mapData || !selectedResidenceId) return;
    setMapData({ ...mapData, buildings: mapData.buildings.map((building) => building.id === selectedResidenceId ? { ...building, role: residentTag.trim() || undefined } : building) });
    setSelectedResidenceId(null);
    setResidentTag("");
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
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
      <div className="glass-panel w-full max-w-6xl h-full max-h-[92vh] flex flex-col overflow-hidden">
        <header className="px-5 py-4 border-b border-grove-600 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {city.name} - City Mapper
            </h2>
            <p className="text-xs text-slate-400">
              Live settlement plan · {externalConnections.length} world-road approach{externalConnections.length === 1 ? "" : "es"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="secondary-button !px-3 !py-1.5"
          >
            Close
          </button>
        </header>
        <div className="flex-1 grid lg:grid-cols-2 overflow-hidden">
          <div className="border-r border-grove-600 p-5 flex flex-col gap-3 overflow-hidden bg-grove-950/30">
            {loading || !mapData ? (
              <p className="text-sm text-slate-400">Loading city map...</p>
            ) : (
              <>
                <svg
                  width={SVG_SIZE}
                  height={SVG_SIZE}
                  viewBox="0 0 1 1"
                  className="w-full max-h-[520px] flex-1 bg-slate-950/60 border border-grove-600 rounded-2xl shadow-inner"
                  onClick={handleSvgClick}
                >
                  <defs>
                    <radialGradient id="city-bg" cx="50%" cy="50%" r="70%">
                      <stop offset="0%" stopColor="#0f172a" />
                      <stop offset="100%" stopColor="#020617" />
                    </radialGradient>
                  </defs>
                  <rect x={0} y={0} width={1} height={1} fill="url(#city-bg)" />
                  {showDistricts && mapData.districts?.map((district) => <g key={district.id}><circle cx={district.x} cy={district.y} r={district.radius} fill={district.color} opacity="0.16" stroke={district.color} strokeWidth="0.003" /><text x={district.x} y={district.y} textAnchor="middle" fontSize="0.018" fill="#f8fafc">{district.name}</text></g>)}
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
                      strokeWidth={0.0025 + (road.tier ?? 1) * 0.0025}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {mapData.buildings.map((building) => (
                    <g key={building.id}>
                      <rect
                        x={building.x - (building.width ?? building.footprint) / 2}
                        y={building.y - (building.height ?? building.footprint * 1.4) / 2}
                        width={building.width ?? building.footprint}
                        height={building.height ?? building.footprint * 1.4}
                        transform={`rotate(${((building.rotation ?? 0) * 180) / Math.PI} ${building.x} ${building.y})`}
                        rx={building.kind === "private" ? 0.001 : 0.004}
                        fill={
                          building.kind === "public"
                            ? "#38bdf8"
                            : building.kind === "market"
                            ? "#fcd34d"
                          : "#ef4444"
                        }
                        opacity={building.kind === "private" ? 0.72 : 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (building.kind === "private") {
                            setSelectedResidenceId(building.id);
                            setResidentTag(building.role ?? "");
                          }
                        }}
                      />
                      {building.role && <text
                        x={building.x + 0.01}
                        y={building.y - 0.01}
                        fontSize="0.018"
                        fill="#e2e8f0"
                      >
                        {building.role}
                      </text>
                      }
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
          <div className="p-5 space-y-5 overflow-y-auto bg-grove-900/30">
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
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="space-y-1 text-slate-400">Street plan
                  <select className="input-field !py-2" value={mapData?.road_architecture ?? "ring"} onChange={(e) => regenerateLayout(e.target.value as RoadArchitecture, (mapData?.road_theme ?? "elvish") as RoadTheme)}>
                    <option value="ring">Ring & radial</option><option value="grid">Grid / orthogonal</option><option value="star">Star / civic core</option><option value="organic">Organic / historic</option>
                  </select>
                </label>
                <label className="space-y-1 text-slate-400">Road names
                  <select className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-2" value={mapData?.road_theme ?? "elvish"} onChange={(e) => regenerateLayout((mapData?.road_architecture ?? "ring") as RoadArchitecture, e.target.value as RoadTheme)}>
                    {ROAD_THEMES.map((theme) => <option key={theme.key} value={theme.key}>{theme.category}: {theme.label}</option>)}
                  </select>
                </label>
              </div>
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
                    setShowDistricts(true);
                    setStatus("Click on the map to place the building.");
                  }}
                  className="text-xs px-3 py-2 rounded bg-emerald-600 text-white"
                >
                  Add special building
                </button>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-grove-700 bg-grove-800/40 px-3 py-2 text-xs">
                <span>{mapData?.districts?.length ?? 0} location districts</span>
                <div className="flex gap-2"><button type="button" onClick={() => setShowDistricts((value) => !value)} className="text-brand-glow">{showDistricts ? "Hide overlay" : "Show overlay"}</button><button type="button" onClick={() => setMapData((current) => current ? { ...current, districts: generateDistricts(current.size_label, current.scale ?? 1, current.road_architecture ?? "ring") } : current)} className="text-earth-sand">Regenerate</button><button type="button" onClick={() => setMapData((current) => current ? { ...current, districts: [] } : current)} className="text-red-300">Remove</button></div>
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
              {selectedResidenceId && <div className="flex gap-2 rounded border border-slate-700 p-2 text-xs"><input className="flex-1 rounded bg-slate-950 px-2 py-1" placeholder="NPC or household tag" value={residentTag} onChange={(e) => setResidentTag(e.target.value)} /><button onClick={saveResidentTag} className="rounded bg-sky-600 px-2">Save tag</button></div>}
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
