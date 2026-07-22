import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { CityDistrict, CityMap, CityRoad, CityRoadPoint, CitySize } from "../api/cityMap";
import { getCityMap, saveCityMap } from "../api/cityMap";
import { getErrorMessage } from "../api/client";
import type { MapCity } from "../api/worldMap";
import { ROAD_THEMES, roadName, type RoadTheme } from "./cityRoadNames";

type Props = {
  worldId: string;
  city: MapCity;
  externalConnections?: number[];
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
};

const EMPTY_CONNECTIONS: number[] = [];

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
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
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
    const orientationIndex = Math.floor(i / 2);
    const orientationCount = i % 2 === 0 ? Math.ceil(avenues / 2) : Math.floor(avenues / 2);
    const gridOffset = ((orientationIndex / Math.max(1, orientationCount - 1)) - 0.5) * radius * 1.7;
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
  externalConnections.forEach((angle, index) => roads.push({ id: randomId(), name: roadName(theme, avenues + index, 4), importance: "main", tier: (size === "megapolis" ? 5 : 3) as 3 | 5, external_connection_index: index, points: [point(radius, angle), point(0.5, angle)] }));
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

function placeSpecialBuilding(
  map: CityMap,
  pending: PendingBuilding,
  coordinates: { x: number; y: number },
  buildingId: string
): CityMap {
  const buildings = [
    ...map.buildings,
    {
      id: buildingId,
      name: pending.name,
      kind: pending.kind,
      x: clamp(coordinates.x, 0.02, 0.98),
      y: clamp(coordinates.y, 0.02, 0.98),
      footprint: pending.kind === "public" || pending.kind === "market" ? 0.035 : 0.022,
      role: pending.role,
      district: pending.district,
    },
  ];

  return { ...map, buildings };
}

function isNamedBuilding(building: CityMap["buildings"][number]) {
  return Boolean(building.role || building.district);
}

function rebuildCityMap(
  city: MapCity,
  current: CityMap,
  options: Partial<{
    size: CitySize;
    scale: number;
    seed: number;
    architecture: RoadArchitecture;
    theme: RoadTheme;
  }> = {},
  externalConnections: number[] = []
) {
  const rebuilt = generateCityMap(
    city,
    options.size ?? current.size_label,
    options.scale ?? current.scale ?? 1,
    options.seed ?? current.seed,
    options.architecture ?? current.road_architecture ?? "ring",
    options.theme ?? (current.road_theme as RoadTheme | undefined) ?? "elvish",
    externalConnections
  );
  return {
    ...rebuilt,
    buildings: [...rebuilt.buildings, ...current.buildings.filter(isNamedBuilding)],
  };
}

function synchronizeExternalConnections(
  city: MapCity,
  map: CityMap,
  externalConnections: number[]
) {
  const previous = map.external_connections ?? [];
  if (
    previous.length === externalConnections.length &&
    previous.every((angle, index) => Math.abs(angle - externalConnections[index]) < 0.0001)
  ) {
    return map;
  }
  const generated = generateCityMap(
    city,
    map.size_label,
    map.scale ?? 1,
    map.seed,
    map.road_architecture ?? "ring",
    (map.road_theme as RoadTheme | undefined) ?? "elvish",
    externalConnections
  );
  const markedConnections = map.roads.filter((road) => road.external_connection_index !== undefined);
  let legacyConnectionIds = new Set<string>();
  if (!markedConnections.length && previous.length && previous.length <= map.roads.length) {
    const tail = map.roads.slice(-previous.length);
    const geometryMatches = tail.every((road, index) => {
      const endpoint = road.points[road.points.length - 1];
      if (!endpoint || road.points.length !== 2 || road.importance !== "main") return false;
      const actual = Math.atan2(endpoint.y - 0.5, endpoint.x - 0.5);
      const difference = Math.atan2(Math.sin(actual - previous[index]), Math.cos(actual - previous[index]));
      return Math.abs(difference) < 0.08;
    });
    if (geometryMatches) legacyConnectionIds = new Set(tail.map((road) => road.id));
  }
  const baseRoads = map.roads.filter(
    (road) => road.external_connection_index === undefined && !legacyConnectionIds.has(road.id)
  );
  const generatedConnections = generated.roads.slice(generated.roads.length - externalConnections.length);
  return {
    ...map,
    external_connections: [...externalConnections],
    roads: [...baseRoads, ...generatedConnections],
  };
}

export function CityMapEditor({
  worldId,
  city,
  externalConnections = EMPTY_CONNECTIONS,
  onClose,
  onDirtyChange,
  onSavingChange,
}: Props) {
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
  const [dirty, setDirty] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const revisionRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const applyEdit = useCallback((updater: (current: CityMap) => CityMap) => {
    revisionRef.current += 1;
    setMapData((current) => {
      if (!current) return current;
      return updater(current);
    });
    setDirty(true);
    setError(null);
    setStatus(null);
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [onSavingChange, saving]);

  useEffect(() => () => {
    onDirtyChange?.(false);
    onSavingChange?.(false);
  }, [onDirtyChange, onSavingChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setMapData(null);
    setError(null);
    setStatus(null);
    setDirty(false);
    revisionRef.current = 0;
    setBuildingName(`${city.name} Hall`);
    getCityMap(worldId, city.id)
      .then((existing) => {
        if (!mounted) return;
        if (existing) {
          setMapData(existing);
          setDirty(false);
        } else {
          setMapData(generateCityMap(city, "town", 1, Date.now(), "ring", "elvish", externalConnections));
          setDirty(true);
        }
        setError(null);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(getErrorMessage(e, "We couldn't load this city map."));
        setMapData(null);
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [city.id, externalConnections, loadAttempt, worldId]);

  useEffect(() => {
    if (loading || !mapData) return;
    const synchronized = synchronizeExternalConnections(city, mapData, externalConnections);
    if (synchronized === mapData) return;
    revisionRef.current += 1;
    setMapData(synchronized);
    setDirty(true);
    setStatus("World-road approaches updated; save to keep this city plan in sync.");
  }, [city, externalConnections, loading, mapData]);

  const sizeMeta = useMemo(
    () => CITY_SIZES.find((s) => s.key === mapData?.size_label) ?? CITY_SIZES[1],
    [mapData?.size_label]
  );
  const namedBuildings = useMemo(
    () => mapData?.buildings.filter(isNamedBuilding) ?? [],
    [mapData?.buildings]
  );

  const handleSvgClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!mapData || !placingBuilding || saving) return;
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    const buildingId = randomId();
    applyEdit((current) => placeSpecialBuilding(current, placingBuilding, point, buildingId));
    setPlacingBuilding(null);
    setShowDistricts(false);
    setBuildingName(`${city.name} Hall`);
    setStatus(`${placingBuilding.name} placed. Save the city map to keep it.`);
  };

  const placeInSelectedDistrict = () => {
    if (!placingBuilding) return;
    const fallbackPoint: Record<District, { x: number; y: number }> = {
      centre: { x: 0.5, y: 0.5 },
      midtown: { x: 0.67, y: 0.5 },
      edge: { x: 0.79, y: 0.5 },
      outskirts: { x: 0.9, y: 0.5 },
    };
    if (!mapData) return;
    const buildingId = randomId();
    applyEdit((current) => placeSpecialBuilding(
      current,
      placingBuilding,
      fallbackPoint[placingBuilding.district ?? "centre"],
      buildingId
    ));
    setStatus(`${placingBuilding.name} placed. Save the city map to keep it.`);
    setPlacingBuilding(null);
    setShowDistricts(false);
    setBuildingName(`${city.name} Hall`);
  };

  const handleRandomizeRoads = () => {
    if (!mapData) return;
    const seed = Date.now();
    const next = rebuildCityMap(city, mapData, { seed }, externalConnections);
    applyEdit(() => next);
    setStatus("Regenerated road layout.");
  };

  const handleSizeChange = (size: CitySize) => {
    if (!mapData) return;
    const next = rebuildCityMap(city, mapData, { size, seed: Date.now() }, externalConnections);
    applyEdit(() => next);
  };

  const handleScaleChange = (scale: number) => {
    if (!mapData) return;
    const next = rebuildCityMap(city, mapData, { scale }, externalConnections);
    applyEdit(() => next);
  };

  const regenerateLayout = (architecture: RoadArchitecture, theme: RoadTheme) => {
    if (!mapData) return;
    const next = rebuildCityMap(city, mapData, { architecture, theme, seed: Date.now() }, externalConnections);
    applyEdit(() => next);
  };

  const handleThemeChange = (theme: RoadTheme) => {
    applyEdit((current) => ({
      ...current,
      road_theme: theme,
      roads: current.roads.map((road, index) => ({
        ...road,
        name: roadName(theme, index, road.tier ?? 1),
      })),
    }));
  };

  const handleRegenerateDistricts = () => {
    if (!mapData) return;
    const districts = generateDistricts(
      mapData.size_label,
      mapData.scale ?? 1,
      mapData.road_architecture ?? "ring"
    );
    applyEdit((current) => ({ ...current, districts }));
  };

  const saveResidentTag = () => {
    if (!mapData || !selectedResidenceId) return;
    applyEdit((current) => ({ ...current, buildings: current.buildings.map((building) => building.id === selectedResidenceId ? { ...building, role: residentTag.trim().slice(0, 120) || undefined } : building) }));
    setSelectedResidenceId(null);
    setResidentTag("");
  };

  const updateRoadPoint = (roadId: string, pointId: string, patch: Partial<CityRoadPoint>) => {
    if (!mapData) return;
    if (mapData.roads.find((road) => road.id === roadId)?.external_connection_index !== undefined) {
      setStatus("World-road approaches are synchronized from the world map and cannot be reshaped here.");
      return;
    }
    applyEdit((current) => ({
      ...current,
      roads: current.roads.map((road) =>
        road.id !== roadId
          ? road
          : {
              ...road,
              points: road.points.map((point) =>
                point.id === pointId ? { ...point, x: clamp(patch.x ?? point.x), y: clamp(patch.y ?? point.y) } : point
              ),
            }
      ),
    }));
  };

  const addRoadPoint = (roadId: string) => {
    if (!mapData) return;
    if (mapData.roads.find((road) => road.id === roadId)?.external_connection_index !== undefined) {
      setStatus("World-road approaches are synchronized from the world map and cannot be reshaped here.");
      return;
    }
    const pointId = randomId();
    applyEdit((current) => ({
      ...current,
      roads: current.roads.map((road) =>
        road.id !== roadId
          ? road
          : {
              ...road,
              points: [
                ...road.points,
                {
                  id: pointId,
                  x: clamp((road.points[road.points.length - 1]?.x ?? 0.5) + 0.05),
                  y: clamp((road.points[road.points.length - 1]?.y ?? 0.5) + 0.05),
                },
              ],
            }
      ),
    }));
  };

  const removeRoadPoint = (roadId: string, pointId: string) => {
    if (mapData?.roads.find((road) => road.id === roadId)?.external_connection_index !== undefined) {
      setStatus("World-road approaches are synchronized from the world map and cannot be reshaped here.");
      return;
    }
    applyEdit((current) => ({
      ...current,
      roads: current.roads.map((road) =>
        road.id === roadId && road.points.length > 2
          ? { ...road, points: road.points.filter((point) => point.id !== pointId) }
          : road
      ),
    }));
  };

  const removeRoad = (roadId: string) => {
    if (mapData?.roads.find((road) => road.id === roadId)?.external_connection_index !== undefined) {
      setStatus("Remove the connected world road to remove this city approach.");
      return;
    }
    applyEdit((current) => ({
      ...current,
      roads: current.roads.filter((road) => road.id !== roadId),
    }));
  };

  const removeBuilding = (id: string) => {
    if (!mapData) return;
    applyEdit((current) => ({
      ...current,
      buildings: current.buildings.filter((b) => b.id !== id),
    }));
  };

  const handleSave = async () => {
    if (!mapData) return;
    const snapshot = mapData;
    setSaving(true);
    setError(null);
    const saveRevision = revisionRef.current;
    try {
      const saved = await saveCityMap(worldId, city.id, snapshot);
      if (revisionRef.current === saveRevision) {
        setMapData(saved);
        setDirty(false);
        setStatus("City map saved.");
      } else {
        setStatus("Saved an earlier snapshot; newer edits are still unsaved.");
      }
    } catch (e) {
      setError(getErrorMessage(e, "We couldn't save this city map."));
    } finally {
      setSaving(false);
    }
  };

  const handleRequestClose = () => {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved changes to this city map?")) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-2 sm:p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="city-map-title"
        aria-busy={loading || saving}
        tabIndex={-1}
        className="glass-panel w-full max-w-6xl h-full max-h-[96vh] sm:max-h-[92vh] flex flex-col overflow-hidden"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            handleRequestClose();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
          ) ?? [])].filter((element) => element.getClientRects().length > 0);
          if (!focusable.length) {
            event.preventDefault();
            dialogRef.current?.focus();
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="px-5 py-4 border-b border-grove-600 flex items-center justify-between">
          <div>
            <h2 id="city-map-title" className="text-lg font-semibold text-white">
              {city.name} - City Mapper
            </h2>
            <p className="text-xs text-slate-400">
              Live settlement plan · {externalConnections.length} world-road approach{externalConnections.length === 1 ? "" : "es"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs ${dirty ? "text-amber-300" : "text-emerald-300"}`} role="status">
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleRequestClose}
              disabled={saving}
              className="secondary-button !px-3 !py-1.5 disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto lg:grid lg:grid-cols-2 lg:overflow-hidden">
          <div className="min-h-[360px] lg:min-h-0 lg:border-r border-grove-600 p-3 sm:p-5 flex flex-col gap-3 overflow-hidden bg-grove-950/30">
            {loading ? (
              <div className="flex flex-1 items-center justify-center" role="status">
                <p className="text-sm text-slate-400">Loading city map…</p>
              </div>
            ) : !mapData ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-red-300">The city map could not be loaded.</p>
                <button type="button" className="secondary-button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                  Try again
                </button>
              </div>
            ) : (
              <>
                <svg
                  width={SVG_SIZE}
                  height={SVG_SIZE}
                  viewBox="0 0 1 1"
                  role={placingBuilding ? "application" : "img"}
                  aria-label={placingBuilding ? `Choose a position for ${placingBuilding.name}` : `Street and building plan for ${city.name}`}
                  className={`w-full max-h-[520px] flex-1 bg-slate-950/60 border border-grove-600 rounded-2xl shadow-inner ${placingBuilding ? "cursor-crosshair ring-2 ring-amber-400/50" : ""}`}
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
                            : building.kind === "utility"
                            ? "#ef4444"
                            : "#cbd5e1"
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
                  <div className="flex flex-wrap items-center gap-2 text-xs text-amber-300">
                    <span>Click the map to place {placingBuilding.name} exactly.</span>
                    <button type="button" className="rounded border border-amber-500/50 px-2 py-1" onClick={placeInSelectedDistrict}>Place in {placingBuilding.district}</button>
                    <button type="button" className="rounded border border-slate-600 px-2 py-1 text-slate-300" onClick={() => { setPlacingBuilding(null); setShowDistricts(false); setStatus("Building placement cancelled."); }}>Cancel</button>
                  </div>
                )}
              </>
            )}
          </div>
          <fieldset disabled={!mapData || loading || saving} className="p-3 sm:p-5 space-y-5 lg:overflow-y-auto bg-grove-900/30 disabled:opacity-70">
            {error && <p role="alert" className="text-xs text-red-300 border border-red-900/60 bg-red-950/30 rounded px-3 py-2">{error}</p>}
            {status && (
              <p role="status" className="text-xs text-sky-300 bg-sky-900/10 border border-sky-900 px-3 py-2 rounded">
                {status}
              </p>
            )}
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <label htmlFor="city-size" className="text-xs uppercase text-slate-400 tracking-wide">
                  Size
                </label>
                <select
                  id="city-size"
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
                  type="button"
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
                <input aria-label="Settlement scale" type="range" min={0.6} max={2} step={0.1} value={mapData?.scale ?? 1} onChange={(e) => handleScaleChange(Number(e.target.value))} />
                <span>{(mapData?.scale ?? 1).toFixed(1)}x</span>
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="space-y-1 text-slate-400">Street plan
                  <select className="input-field !py-2" value={mapData?.road_architecture ?? "ring"} onChange={(e) => regenerateLayout(e.target.value as RoadArchitecture, (mapData?.road_theme ?? "elvish") as RoadTheme)}>
                    <option value="ring">Ring & radial</option><option value="grid">Grid / orthogonal</option><option value="star">Star / civic core</option><option value="organic">Organic / historic</option>
                  </select>
                </label>
                <label className="space-y-1 text-slate-400">Road names
                  <select className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-2" value={mapData?.road_theme ?? "elvish"} onChange={(e) => handleThemeChange(e.target.value as RoadTheme)}>
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
                  aria-label="Building name"
                  className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
                  placeholder="Building name"
                  value={buildingName}
                  onChange={(e) => setBuildingName(e.target.value)}
                />
                <select
                  aria-label="Building type"
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
                  type="button"
                  onClick={() => {
                    if (!buildingName.trim()) return;
                    setPlacingBuilding({
                      name: buildingName.trim().slice(0, 120),
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
                <div className="flex gap-2"><button type="button" onClick={() => setShowDistricts((value) => !value)} className="text-brand-glow">{showDistricts ? "Hide overlay" : "Show overlay"}</button><button type="button" onClick={handleRegenerateDistricts} className="text-earth-sand">Regenerate</button><button type="button" onClick={() => applyEdit((current) => ({ ...current, districts: [] }))} className="text-red-300">Remove</button></div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <select aria-label="Special building role" className="rounded border border-slate-700 bg-slate-900 px-2 py-2" value={specialType} onChange={(e) => setSpecialType(e.target.value)}>
                  {SPECIAL_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
                <select aria-label="Building district" className="rounded border border-slate-700 bg-slate-900 px-2 py-2" value={district} onChange={(e) => setDistrict(e.target.value as District)}>
                  <option value="centre">City centre</option><option value="midtown">Midtown</option><option value="edge">Edge</option><option value="outskirts">Outskirts</option>
                </select>
              </div>
              <p className="text-[11px] text-slate-500">
                {mapData?.buildings.length ?? 0} total buildings · {namedBuildings.length} named or assigned
              </p>
              <ul className="space-y-1 text-xs text-slate-300 max-h-28 overflow-y-auto pr-1">
                {namedBuildings.map((building) => (
                  <li
                    key={building.id}
                    className="flex items-center justify-between border border-slate-800 rounded px-2 py-1"
                  >
                    <span>
                      {building.name} - {building.role ?? building.kind}{building.district ? ` (${building.district})` : ""}
                    </span>
                    <button
                      type="button"
                      className="text-[10px] text-red-300"
                      onClick={() => removeBuilding(building.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {!namedBuildings.length && <li className="text-slate-500">No named buildings yet.</li>}
              </ul>
              {selectedResidenceId && <div className="flex gap-2 rounded border border-slate-700 p-2 text-xs"><input aria-label="Resident or household tag" className="flex-1 rounded bg-slate-950 px-2 py-1" placeholder="NPC or household tag" value={residentTag} onChange={(e) => setResidentTag(e.target.value)} /><button type="button" onClick={saveResidentTag} className="rounded bg-sky-600 px-2">Save tag</button><button type="button" onClick={() => { setSelectedResidenceId(null); setResidentTag(""); }} className="rounded border border-slate-600 px-2">Cancel</button></div>}
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
                        {road.name} - {road.importance}{road.external_connection_index !== undefined ? " · world approach" : ""}
                      </span>
                      <span>{road.points.length} pts</span>
                    </summary>
                    <div className="px-3 py-2 space-y-2 text-[11px] text-slate-400">
                      <label className="flex flex-col gap-1">
                        Road name
                        <input
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
                          value={road.name}
                          maxLength={120}
                          onChange={(event) => applyEdit((current) => ({
                            ...current,
                            roads: current.roads.map((item) => item.id === road.id ? { ...item, name: event.target.value } : item),
                          }))}
                        />
                      </label>
                      {road.points.map((point, pointIndex) => (
                        <div key={point.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                          <label className="flex flex-col gap-1">
                            Point {pointIndex + 1} X
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              value={point.x}
                              disabled={road.external_connection_index !== undefined}
                              onChange={(e) =>
                                updateRoadPoint(road.id, point.id, {
                                  x: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            Point {pointIndex + 1} Y
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              value={point.y}
                              disabled={road.external_connection_index !== undefined}
                              onChange={(e) =>
                                updateRoadPoint(road.id, point.id, {
                                  y: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <button
                            type="button"
                            aria-label={`Remove waypoint ${pointIndex + 1} from ${road.name}`}
                            disabled={road.points.length <= 2 || road.external_connection_index !== undefined}
                            onClick={() => removeRoadPoint(road.id, point.id)}
                            className="rounded border border-red-900/60 px-2 py-1 text-red-300 disabled:opacity-30"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2">
                        <button type="button" disabled={road.external_connection_index !== undefined} onClick={() => addRoadPoint(road.id)} className="text-[10px] text-sky-300 disabled:opacity-40">
                          + Add waypoint
                        </button>
                        <button type="button" disabled={road.external_connection_index !== undefined} onClick={() => { if (window.confirm(`Remove ${road.name}?`)) removeRoad(road.id); }} className="text-[10px] text-red-300 disabled:opacity-40">
                          Remove road
                        </button>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </section>
            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="px-4 py-2 rounded bg-sky-600 text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : dirty ? "Save city map" : "Saved"}
              </button>
              <p className="text-[10px] text-slate-500">
                Roads render as editable paths. Drag sliders to adjust waypoints.
              </p>
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
