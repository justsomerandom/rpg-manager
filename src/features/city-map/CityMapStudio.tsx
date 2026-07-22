import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import {
  getCityMap,
  normalizeCityMap,
  saveCityMap,
  type CityBuilding,
  type CityBuildingUse,
  type CityEntrance,
  type CityEntitySource,
  type CityLayout,
  type CityMap,
  type CityRoad,
  type CitySize,
  type CityType,
} from "../../api/cityMap";
import { getErrorMessage } from "../../api/client";
import type { MapCity } from "../../api/worldMap";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ROAD_THEMES, roadName, type RoadTheme } from "../../components/cityRoadNames";
import {
  CITY_LAYOUT_OPTIONS,
  CITY_SIZE_OPTIONS,
  CITY_TYPE_OPTIONS,
  deriveRecommendedCitySize,
  generateCityPlan,
  stableCityRoadPointId,
  type CityGenerationConfig,
} from "./generator";
import { chaikinSmooth, clamp, distance } from "./geometry";
import {
  drawCityMap,
  hitTestCityFeature,
  screenToCityPoint,
  type CityFeatureRef,
  type CityLayerVisibility,
  type CityRenderOptions,
  type CityViewMode,
} from "./rendering";

export type CityMapApproach = {
  worldRoadId: string;
  angle: number;
  roadClass?: "arterial" | "road";
};

type Props = {
  worldId: string;
  city: MapCity;
  externalConnections?: CityMapApproach[];
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
};

type CityTool = "select" | "pan" | "road" | "building";
type StudioMode = "edit" | "presentation";
type DragState =
  | { kind: "pan"; clientX: number; clientY: number }
  | { kind: "building"; id: string; snapshot: CityMap; historyRecorded: boolean }
  | { kind: "road-point"; roadId: string; pointId: string; snapshot: CityMap; historyRecorded: boolean }
  | null;

const DEFAULT_APPROACHES: CityMapApproach[] = [];
const MAX_HISTORY = 16;
const DEFAULT_LAYERS: CityLayerVisibility = {
  ground: true,
  districts: true,
  roads: true,
  buildings: true,
  districtLabels: true,
  roadLabels: false,
  buildingLabels: true,
};

const BUILDING_USES: Array<{ key: CityBuildingUse; label: string; description: string }> = [
  { key: "residential", label: "Residential", description: "Homes and lodging" },
  { key: "commercial", label: "Commercial", description: "Markets and services" },
  { key: "industrial", label: "Industrial", description: "Workshops and production" },
  { key: "civic", label: "Civic", description: "Public institutions" },
  { key: "landmark", label: "Landmark", description: "Named campaign location" },
];

function randomId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === "function") return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizedAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function cityTypeForLocation(city: MapCity): CityType {
  if (city.kind === "port") return "port";
  if (city.kind === "fortress") return "fortress";
  return city.population > 85_000 ? "capital" : city.population < 1_200 ? "rural" : "trade";
}

function configFromMap(map: CityMap, fallbackPopulation: number): CityGenerationConfig {
  const rawLayout = map.road_architecture === "star" ? "radial" : map.road_architecture;
  const layout: CityLayout = rawLayout === "grid" || rawLayout === "ring" || rawLayout === "radial" || rawLayout === "organic"
    ? rawLayout
    : "organic";
  return {
    size: map.size_label ?? deriveRecommendedCitySize(fallbackPopulation),
    cityType: map.city_type ?? "trade",
    layout,
    seed: map.seed,
    density: map.density ?? 0.85,
    scale: map.scale ?? 1,
    roadTheme: (map.road_theme ?? "western") as RoadTheme,
  };
}

function entrancesFor(approaches: readonly CityMapApproach[]): CityEntrance[] {
  return approaches.flatMap((approach) => {
    if (!Number.isFinite(approach.angle) || !approach.worldRoadId.trim()) return [];
    return [{
      id: `entrance-${approach.worldRoadId}`.slice(0, 128),
      world_road_id: approach.worldRoadId.slice(0, 128),
      angle: normalizedAngle(approach.angle),
      road_class: approach.roadClass === "road" ? "road" as const : "arterial" as const,
    }];
  }).slice(0, 1_000).map((entrance, index) => ({
    ...entrance,
    id: entrance.id || `entrance-${index}`,
  }));
}

function attachApproaches(map: CityMap, approaches: readonly CityMapApproach[]): CityMap {
  const entrances = entrancesFor(approaches);
  const angles = entrances.map((entrance) => entrance.angle);
  return {
    ...map,
    external_connections: angles,
    entrances,
    roads: map.roads.map((road) => {
      const index = road.external_connection_index;
      return index !== undefined && index !== null && entrances[index]
        ? { ...road, external_connection_id: entrances[index].id }
        : road;
    }),
  };
}

function applyRoadTheme(map: CityMap, theme: RoadTheme): CityMap {
  return {
    ...map,
    road_theme: theme,
    roads: map.roads.map((road, index) => ({
      ...road,
      name: roadName(theme, index, road.tier ?? 1),
    })),
  };
}

function approachesMatch(map: CityMap, approaches: readonly CityMapApproach[]) {
  const expected = entrancesFor(approaches);
  const current = map.entrances ?? [];
  if (current.length !== expected.length) return false;
  return current.every((entrance, index) =>
    entrance.world_road_id === expected[index]?.world_road_id &&
    Math.abs(normalizedAngle(entrance.angle - (expected[index]?.angle ?? 0))) < 0.0001
  );
}

function synchronizeApproaches(
  city: MapCity,
  map: CityMap,
  approaches: readonly CityMapApproach[]
): CityMap {
  if (approachesMatch(map, approaches)) return map;
  const config = configFromMap(map, city.population);
  const generated = attachApproaches(
    applyRoadTheme(generateCityPlan(city, config, [], approaches.map((approach) => approach.angle)), (config.roadTheme ?? "western") as RoadTheme),
    approaches
  );
  const retainedRoads = map.roads.filter((road) =>
    (road.external_connection_index === undefined || road.external_connection_index === null) &&
    !road.external_connection_id
  );
  const approachRoads = generated.roads.filter((road) => road.external_connection_index !== undefined);
  return {
    ...map,
    external_connections: generated.external_connections,
    entrances: generated.entrances,
    roads: [...retainedRoads, ...approachRoads],
  };
}

function featureLabel(feature: CityFeatureRef | null) {
  if (!feature) return "Nothing selected";
  return `${feature.kind[0].toUpperCase()}${feature.kind.slice(1)} selected`;
}

function sourceForManual(): CityEntitySource {
  return "manual";
}

export function CityMapStudio({
  worldId,
  city,
  externalConnections = DEFAULT_APPROACHES,
  onClose,
  onDirtyChange,
  onSavingChange,
}: Props) {
  const [mapData, setMapData] = useState<CityMap | null>(null);
  const [previewMap, setPreviewMap] = useState<CityMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [closeRequested, setCloseRequested] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [previewStale, setPreviewStale] = useState(false);
  const [preserveLocked, setPreserveLocked] = useState(true);
  const [mode, setMode] = useState<StudioMode>("edit");
  const [viewMode, setViewMode] = useState<CityViewMode>("topdown");
  const [activeTool, setActiveTool] = useState<CityTool>("select");
  const [selection, setSelection] = useState<CityFeatureRef | null>(null);
  const [layers, setLayers] = useState<CityLayerVisibility>(DEFAULT_LAYERS);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 900, height: 700 });
  const [draftRoad, setDraftRoad] = useState<Array<{ x: number; y: number }>>([]);
  const [buildingName, setBuildingName] = useState(`${city.name} landmark`);
  const [buildingUse, setBuildingUse] = useState<CityBuildingUse>("landmark");
  const [undoStack, setUndoStack] = useState<CityMap[]>([]);
  const [redoStack, setRedoStack] = useState<CityMap[]>([]);
  const [config, setConfig] = useState<CityGenerationConfig>(() => ({
    size: deriveRecommendedCitySize(city.population),
    cityType: cityTypeForLocation(city),
    layout: "organic",
    seed: Date.now(),
    density: 0.85,
    scale: 1,
    roadTheme: "western",
  }));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const revisionRef = useRef(0);
  const generationJobRef = useRef(0);
  const dragRef = useRef<DragState>(null);
  const roadDrawingRef = useRef(false);
  const draftRoadRef = useRef<Array<{ x: number; y: number }>>([]);

  const displayedMap = generatorOpen && previewMap ? previewMap : mapData;
  const previewActive = Boolean(generatorOpen && previewMap);
  const editable = Boolean(mapData && mode === "edit" && viewMode === "topdown" && !previewActive && !saving);

  const renderOptions = useMemo<CityRenderOptions>(() => ({
    viewMode,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      zoom,
      panX: pan.x,
      panY: pan.y,
      padding: 54,
    },
    layers,
    overlays: mode === "edit" && !previewActive
      ? {
          selected: selection,
          showRoadNodes: selection?.kind === "road",
          roadNodeRoadId: selection?.kind === "road" ? selection.id : null,
          draftRoad,
        }
      : undefined,
    maxBuildingExtrusion: viewMode === "isometric" ? 10 : 0,
  }), [draftRoad, layers, mode, pan.x, pan.y, previewActive, selection, viewMode, viewport.height, viewport.width, zoom]);

  const markDirty = useCallback(() => {
    revisionRef.current += 1;
    setDirty(true);
    setError(null);
  }, []);

  const remember = useCallback((snapshot: CityMap) => {
    setUndoStack((history) => [...history.slice(-(MAX_HISTORY - 1)), snapshot]);
    setRedoStack([]);
  }, []);

  const commitMap = useCallback((next: CityMap, message?: string) => {
    if (mapData) remember(mapData);
    setMapData(next);
    markDirty();
    setSelection(null);
    if (message) setStatus(message);
  }, [mapData, markDirty, remember]);

  const updateConfig = <K extends keyof CityGenerationConfig>(key: K, value: CityGenerationConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setPreviewStale(true);
  };

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
    let cancelled = false;
    setLoading(true);
    setMapData(null);
    setPreviewMap(null);
    setDirty(false);
    setError(null);
    setStatus(null);
    setSelection(null);
    setUndoStack([]);
    setRedoStack([]);
    revisionRef.current = 0;
    const recommended: CityGenerationConfig = {
      size: deriveRecommendedCitySize(city.population),
      cityType: cityTypeForLocation(city),
      layout: "organic",
      seed: Date.now(),
      density: 0.85,
      scale: 1,
      roadTheme: "western",
    };
    getCityMap(worldId, city.id)
      .then((existing) => {
        if (cancelled) return;
        if (existing) {
          const synchronized = synchronizeApproaches(city, existing, externalConnections);
          setConfig(configFromMap(synchronized, city.population));
          setMapData(synchronized);
          if (synchronized !== existing) {
            setDirty(true);
            revisionRef.current += 1;
            setStatus("World-road approaches were updated. Save to keep the synchronized city plan.");
          }
          setGeneratorOpen(false);
        } else {
          const generated = attachApproaches(
            applyRoadTheme(generateCityPlan(city, recommended, [], externalConnections.map((approach) => approach.angle)), (recommended.roadTheme ?? "western") as RoadTheme),
            externalConnections
          );
          setConfig(recommended);
          setPreviewMap(normalizeCityMap(generated, city.id));
          setGeneratorOpen(true);
          setPreviewStale(false);
          setStatus("Review the generated preview, then apply it when the plan is right.");
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(getErrorMessage(caught, "We couldn't load this city plan."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      generationJobRef.current += 1;
    };
  }, [city, externalConnections, loadAttempt, worldId]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const update = () => {
      const bounds = node.getBoundingClientRect();
      setViewport({ width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!displayedMap || !canvasRef.current) return;
    drawCityMap(canvasRef.current, displayedMap, renderOptions);
  }, [displayedMap, renderOptions]);

  const cityPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!displayedMap || !canvasRef.current) return null;
    const point = screenToCityPoint(canvasRef.current, displayedMap, event.clientX, event.clientY, renderOptions);
    if (!point || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
    return point;
  };

  const generatePreview = () => {
    if (generating) return;
    const job = ++generationJobRef.current;
    setGenerating(true);
    setError(null);
    setStatus("Generating roads, districts, and buildings…");
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (generationJobRef.current !== job) return;
        try {
          const locked = preserveLocked
            ? mapData?.buildings.filter((building) => building.locked || building.source === "manual") ?? []
            : [];
          const generated = applyRoadTheme(generateCityPlan(
            city,
            config,
            locked,
            externalConnections.map((approach) => approach.angle)
          ), (config.roadTheme ?? "western") as RoadTheme);
          setPreviewMap(normalizeCityMap(attachApproaches(generated, externalConnections), city.id));
          setPreviewStale(false);
          setStatus("Preview ready. Your saved draft has not changed.");
        } catch (caught) {
          setError(getErrorMessage(caught, "We couldn't generate this city preview."));
        } finally {
          if (generationJobRef.current === job) setGenerating(false);
        }
      }, 0);
    });
  };

  const applyPreview = () => {
    if (!previewMap || previewStale || generating) return;
    commitMap(previewMap, "Generated plan applied locally. Save when you're ready.");
    setPreviewMap(null);
    setGeneratorOpen(false);
  };

  const handleSave = async () => {
    if (!mapData || !dirty || saving) return;
    const snapshot = mapData;
    const saveRevision = revisionRef.current;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveCityMap(worldId, city.id, snapshot);
      if (revisionRef.current === saveRevision) {
        setMapData(saved);
        setDirty(false);
        setStatus("City plan saved. The studio remains open.");
      } else {
        setStatus("An earlier snapshot was saved; newer edits are still unsaved.");
      }
    } catch (caught) {
      setError(getErrorMessage(caught, "We couldn't save this city plan."));
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty) setCloseRequested(true);
    else onClose();
  };

  const handleUndo = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous || !mapData) return;
    setUndoStack((history) => history.slice(0, -1));
    setRedoStack((future) => [...future.slice(-(MAX_HISTORY - 1)), mapData]);
    setMapData(previous);
    markDirty();
    setSelection(null);
    setStatus("Undid the last city edit.");
  };

  const handleRedo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next || !mapData) return;
    setRedoStack((future) => future.slice(0, -1));
    setUndoStack((history) => [...history.slice(-(MAX_HISTORY - 1)), mapData]);
    setMapData(next);
    markDirty();
    setSelection(null);
    setStatus("Redid the city edit.");
  };

  const pushDragHistory = (drag: Exclude<DragState, null>) => {
    if (drag.kind === "pan" || drag.historyRecorded) return drag;
    remember(drag.snapshot);
    return { ...drag, historyRecorded: true };
  };

  const nearestSelectedRoadPoint = (point: { x: number; y: number }) => {
    if (!mapData || selection?.kind !== "road") return null;
    const road = mapData.roads.find((candidate) => candidate.id === selection.id);
    if (!road || road.external_connection_id) return null;
    const threshold = 0.012 / Math.max(zoom, 0.6);
    return road.points.find((candidate) => distance(candidate, point) <= threshold) ?? null;
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!displayedMap || generating) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (event.button !== 0 || activeTool === "pan" || mode === "presentation" || previewActive || viewMode === "isometric") {
      dragRef.current = { kind: "pan", clientX: event.clientX, clientY: event.clientY };
      return;
    }
    const point = cityPoint(event);
    if (!point || !mapData || !editable) return;
    if (activeTool === "road") {
      roadDrawingRef.current = true;
      draftRoadRef.current = [point];
      setDraftRoad([point]);
      setStatus("Draw a local street and release to normalize it.");
      return;
    }
    if (activeTool === "building") {
      const building: CityBuilding = {
        id: randomId("building"),
        name: buildingName.trim().slice(0, 120) || "New building",
        kind: buildingUse,
        x: point.x,
        y: point.y,
        footprint: buildingUse === "landmark" || buildingUse === "civic" ? 0.024 : 0.014,
        width: buildingUse === "landmark" || buildingUse === "civic" ? 0.024 : 0.014,
        height: buildingUse === "industrial" ? 0.021 : 0.017,
        rotation: 0,
        source: sourceForManual(),
        locked: true,
        role: buildingUse === "landmark" ? buildingName.trim().slice(0, 120) : undefined,
      };
      commitMap({ ...mapData, buildings: [...mapData.buildings, building] }, `${building.name} placed.`);
      setSelection({ kind: "building", id: building.id });
      setActiveTool("select");
      return;
    }
    const roadPoint = nearestSelectedRoadPoint(point);
    if (roadPoint && selection?.kind === "road") {
      dragRef.current = { kind: "road-point", roadId: selection.id, pointId: roadPoint.id, snapshot: mapData, historyRecorded: false };
      return;
    }
    const hit = hitTestCityFeature(mapData, point, { tolerance: 0.012 / Math.max(zoom, 0.7) });
    const selected = hit ? { kind: hit.kind, id: hit.id } satisfies CityFeatureRef : null;
    setSelection(selected);
    if (hit?.kind === "building") {
      dragRef.current = { kind: "building", id: hit.id, snapshot: mapData, historyRecorded: false };
    }
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.kind === "pan") {
      const dx = event.clientX - drag.clientX;
      const dy = event.clientY - drag.clientY;
      setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
      dragRef.current = { kind: "pan", clientX: event.clientX, clientY: event.clientY };
      return;
    }
    const point = cityPoint(event);
    if (!point || !mapData) return;
    if (roadDrawingRef.current) {
      const current = draftRoadRef.current;
      const last = current[current.length - 1];
      if (last && distance(last, point) < 0.003) return;
      const next = [...current, point];
      draftRoadRef.current = next;
      setDraftRoad(next);
      return;
    }
    if (drag?.kind === "building") {
      dragRef.current = pushDragHistory(drag);
      setMapData((current) => current ? {
        ...current,
        buildings: current.buildings.map((building) => building.id === drag.id ? { ...building, x: point.x, y: point.y, source: "manual", locked: true } : building),
      } : current);
      markDirty();
    } else if (drag?.kind === "road-point") {
      dragRef.current = pushDragHistory(drag);
      setMapData((current) => current ? {
        ...current,
        roads: current.roads.map((road) => road.id === drag.roadId ? {
          ...road,
          source: "manual",
          locked: true,
          points: road.points.map((candidate) => candidate.id === drag.pointId ? { ...candidate, x: point.x, y: point.y } : candidate),
        } : road),
      } : current);
      markDirty();
    }
  };

  const finishRoadDrawing = () => {
    if (!roadDrawingRef.current || !mapData) return;
    roadDrawingRef.current = false;
    const raw = draftRoadRef.current;
    draftRoadRef.current = [];
    setDraftRoad([]);
    if (raw.length < 2) {
      setStatus("Draw a longer line to create a street.");
      return;
    }
    const smoothed = chaikinSmooth(raw, 2).filter((point, index, points) =>
      index === 0 || distance(point, points[index - 1]) >= 0.002
    );
    if (smoothed.length < 2) return;
    const roadId = randomId("road");
    const road: CityRoad = {
      id: roadId,
      name: `Local Street ${mapData.roads.length + 1}`,
      importance: "secondary",
      tier: 2,
      source: "manual",
      locked: true,
      points: smoothed.map((point, index) => ({
        id: stableCityRoadPointId(roadId, index),
        x: point.x,
        y: point.y,
      })),
    };
    commitMap({ ...mapData, roads: [...mapData.roads, road] }, "Freehand street normalized and added.");
    setSelection({ kind: "road", id: road.id });
    setActiveTool("select");
  };

  const handleCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishRoadDrawing();
    dragRef.current = null;
  };

  const cancelCanvasGesture = () => {
    roadDrawingRef.current = false;
    draftRoadRef.current = [];
    setDraftRoad([]);
    dragRef.current = null;
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setZoom((current) => clamp(current + (event.deltaY > 0 ? -0.1 : 0.1), 0.55, 2.8));
  };

  const updateSelected = (updater: (map: CityMap, feature: CityFeatureRef) => CityMap, message?: string) => {
    if (!mapData || !selection) return;
    commitMap(updater(mapData, selection), message);
    setSelection(selection);
  };

  const removeSelected = () => {
    if (!mapData || !selection) return;
    const next = selection.kind === "building"
      ? { ...mapData, buildings: mapData.buildings.filter((building) => building.id !== selection.id) }
      : selection.kind === "road"
        ? { ...mapData, roads: mapData.roads.filter((road) => road.id !== selection.id || road.external_connection_id) }
        : {
            ...mapData,
            districts: mapData.districts?.filter((district) => district.id !== selection.id),
            buildings: mapData.buildings.map((building) => building.district_id === selection.id
              ? { ...building, district_id: undefined }
              : building),
          };
    commitMap(next, `${selection.kind[0].toUpperCase()}${selection.kind.slice(1)} removed.`);
  };

  const selectedBuilding = selection?.kind === "building"
    ? mapData?.buildings.find((building) => building.id === selection.id) ?? null
    : null;
  const selectedRoad = selection?.kind === "road"
    ? mapData?.roads.find((road) => road.id === selection.id) ?? null
    : null;
  const selectedDistrict = selection?.kind === "district"
    ? mapData?.districts?.find((district) => district.id === selection.id) ?? null
    : null;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-grove-950 text-slate-200" role="status">
        <span className="loading-dot" aria-hidden="true" /> Loading {city.name} City Studio…
      </div>
    );
  }

  if (!displayedMap && error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-grove-950 p-6">
        <section className="glass-panel max-w-lg p-7 text-center" role="alert">
          <p className="section-label">City plan unavailable</p>
          <h2 className="mt-3 font-display text-2xl font-semibold">We could not open {city.name}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">{error}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button type="button" className="secondary-button" onClick={onClose}>Back to world map</button>
            <button type="button" className="primary-button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-[#06110c] text-brand-glow">
      <header className="relative z-20 flex min-h-[4.5rem] shrink-0 items-center justify-between gap-3 border-b border-grove-600/75 bg-grove-900/95 px-3 py-2 shadow-xl backdrop-blur-xl sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button ref={closeButtonRef} type="button" className="secondary-button min-h-11 shrink-0 !px-3" onClick={requestClose} disabled={saving}>
            <span aria-hidden="true">←</span><span className="hidden sm:inline">World map</span>
          </button>
          <div className="min-w-0">
            <p className="section-label">City Studio</p>
            <h2 className="truncate font-display text-lg font-semibold sm:text-xl">{city.name}</h2>
          </div>
          <span className={`hidden rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:inline-flex ${previewActive ? "border-earth-clay/50 bg-earth-clay/10 text-earth-sand" : dirty ? "border-amber-400/40 bg-amber-950/30 text-amber-200" : "border-emerald-400/35 bg-emerald-950/25 text-emerald-200"}`} role="status">
            {previewActive ? "Preview — not applied" : dirty ? "Unsaved changes" : "Saved"}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <div className="flex rounded-xl border border-grove-600 bg-grove-950/70 p-1" role="group" aria-label="Studio mode">
            {(["edit", "presentation"] as const).map((item) => (
              <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)} className={`min-h-9 rounded-lg px-3 text-xs font-semibold capitalize ${mode === item ? "bg-brand text-grove-950" : "text-slate-300 hover:bg-grove-700"}`}>{item}</button>
            ))}
          </div>
          <div className="flex rounded-xl border border-grove-600 bg-grove-950/70 p-1" role="group" aria-label="Map projection">
            {(["topdown", "isometric"] as const).map((item) => (
              <button key={item} type="button" aria-pressed={viewMode === item} onClick={() => setViewMode(item)} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${viewMode === item ? "bg-earth-sand text-grove-950" : "text-slate-300 hover:bg-grove-700"}`}>{item === "topdown" ? "Top-down" : "Isometric"}</button>
            ))}
          </div>
          <button type="button" className="icon-button" aria-label="Undo city edit" title="Undo" disabled={!undoStack.length || previewActive} onClick={handleUndo}>↶</button>
          <button type="button" className="icon-button" aria-label="Redo city edit" title="Redo" disabled={!redoStack.length || previewActive} onClick={handleRedo}>↷</button>
          <button type="button" className="secondary-button min-h-11 whitespace-nowrap" onClick={() => { setGeneratorOpen(true); setPreviewMap(null); setPreviewStale(true); setInspectorOpen(true); }} disabled={saving}>Generate plan</button>
          <button type="button" className="secondary-button min-h-11 whitespace-nowrap xl:hidden" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)}>Inspector</button>
          <button type="button" className="primary-button min-h-11 whitespace-nowrap" onClick={handleSave} disabled={!dirty || saving || !mapData || previewActive}>
            {saving ? "Saving…" : "Save city plan"}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <nav aria-label="City map tools" className="relative z-10 flex w-[4.5rem] shrink-0 flex-col items-center gap-2 border-r border-grove-600/70 bg-grove-900/92 px-2 py-4">
          {([
            ["select", "⌁", "Select and move"],
            ["pan", "✥", "Pan map"],
            ["road", "⌇", "Draw road"],
            ["building", "▣", "Place building"],
          ] as const).map(([tool, icon, label]) => (
            <button key={tool} type="button" aria-label={label} title={label} aria-pressed={activeTool === tool} disabled={mode === "presentation" || viewMode === "isometric" || previewActive} onClick={() => { setActiveTool(tool); setGeneratorOpen(false); setPreviewMap(null); if (tool === "building") setInspectorOpen(true); }} className={`flex min-h-12 w-full flex-col items-center justify-center rounded-xl text-[10px] transition ${activeTool === tool ? "bg-brand text-grove-950 shadow-lg" : "text-slate-300 hover:bg-grove-700 hover:text-white"}`}>
              <span className="text-lg leading-none" aria-hidden="true">{icon}</span><span className="mt-1">{tool === "building" ? "Build" : tool[0].toUpperCase() + tool.slice(1)}</span>
            </button>
          ))}
          <div className="my-1 h-px w-8 bg-grove-600/70" />
          <button type="button" aria-label="Fit city to view" title="Fit view" className="icon-button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>⌂</button>
          <div className="mt-auto text-center text-[10px] text-slate-400">{Math.round(zoom * 100)}%</div>
        </nav>

        <div ref={viewportRef} className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,_#173326_0%,_#07130d_70%)]">
          {displayedMap ? (
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`${previewActive ? "Generated preview" : mode === "edit" ? "Editable plan" : "Presentation view"} of ${city.name}. Use the adjacent tools and inspector for keyboard-accessible editing.`}
              tabIndex={0}
              className="absolute inset-0 h-full w-full touch-none"
              style={{ cursor: activeTool === "pan" || mode === "presentation" ? "grab" : activeTool === "road" || activeTool === "building" ? "crosshair" : "default" }}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={() => cancelCanvasGesture()}
              onLostPointerCapture={() => { dragRef.current = null; }}
              onWheel={handleWheel}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  cancelCanvasGesture();
                  setSelection(null);
                } else if ((event.key === "Delete" || event.key === "Backspace") && selection && editable) {
                  removeSelected();
                } else if (event.key === "+" || event.key === "=") {
                  setZoom((current) => clamp(current + 0.1, 0.55, 2.8));
                } else if (event.key === "-" || event.key === "_") {
                  setZoom((current) => clamp(current - 0.1, 0.55, 2.8));
                } else return;
                event.preventDefault();
              }}
            />
          ) : null}

          <div className="pointer-events-none absolute left-4 top-4 flex max-w-[calc(100%-2rem)] flex-wrap gap-2">
            <span className="rounded-full border border-grove-600/80 bg-grove-950/80 px-3 py-1.5 text-xs text-slate-200 backdrop-blur">{mode === "presentation" ? "Clean presentation" : previewActive ? "Generated preview" : `${activeTool[0].toUpperCase()}${activeTool.slice(1)} tool`}</span>
            {viewMode === "isometric" && <span className="rounded-full border border-earth-clay/40 bg-grove-950/80 px-3 py-1.5 text-xs text-earth-sand backdrop-blur">Read-only projection</span>}
          </div>

          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-grove-600/80 bg-grove-950/85 p-1 shadow-xl backdrop-blur">
            <button type="button" className="icon-button !min-h-9 !min-w-9" aria-label="Zoom out" onClick={() => setZoom((current) => clamp(current - 0.1, 0.55, 2.8))}>−</button>
            <span className="min-w-12 text-center text-xs text-slate-300">{Math.round(zoom * 100)}%</span>
            <button type="button" className="icon-button !min-h-9 !min-w-9" aria-label="Zoom in" onClick={() => setZoom((current) => clamp(current + 0.1, 0.55, 2.8))}>+</button>
          </div>
        </div>

        {inspectorOpen && <button type="button" aria-label="Close city inspector" className="absolute inset-0 z-20 bg-black/55 xl:hidden" onClick={() => setInspectorOpen(false)} />}
        <aside className={`${inspectorOpen ? "absolute inset-y-0 right-0 z-30 block w-[min(22rem,calc(100vw-4.5rem))]" : "hidden"} shrink-0 overflow-y-auto border-l border-grove-600/70 bg-grove-900/97 shadow-2xl xl:relative xl:z-10 xl:block xl:w-[22rem] xl:shadow-none`}>
          <div className="space-y-5 p-5">
            <div className="flex items-center justify-between xl:hidden"><p className="section-label">Inspector</p><button type="button" className="icon-button" aria-label="Close inspector" onClick={() => setInspectorOpen(false)}>×</button></div>
            {error && <div className="status-error" role="alert">{error}</div>}
            {status && <div className="status-info" role="status">{status}</div>}

            {generatorOpen ? (
              <section className="space-y-5" aria-labelledby="city-generator-title">
                <div>
                  <p className="section-label">Staged generator</p>
                  <h3 id="city-generator-title" className="mt-2 font-display text-xl font-semibold">Shape the settlement</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-300">Settings only affect a preview. Your working plan changes only when you choose <strong className="text-brand-glow">Apply generated plan</strong>.</p>
                </div>

                <label className="block space-y-1.5 text-xs font-semibold text-slate-300">City type
                  <select className="input-field" value={config.cityType} onChange={(event) => updateConfig("cityType", event.target.value as CityType)}>
                    {CITY_TYPE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                  <span className="block font-normal leading-5 text-slate-400">{CITY_TYPE_OPTIONS.find((option) => option.key === config.cityType)?.description}</span>
                </label>

                <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Settlement size
                  <select className="input-field" value={config.size} onChange={(event) => updateConfig("size", event.target.value as CitySize)}>
                    {CITY_SIZE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label} · ~{option.targetBuildings} buildings</option>)}
                  </select>
                </label>

                <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Street layout
                  <select className="input-field" value={config.layout} onChange={(event) => updateConfig("layout", event.target.value as CityLayout)}>
                    {CITY_LAYOUT_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                  <span className="block font-normal leading-5 text-slate-400">{CITY_LAYOUT_OPTIONS.find((option) => option.key === config.layout)?.description}</span>
                </label>

                <label className="block space-y-2 text-xs font-semibold text-slate-300">Density <span className="float-right text-earth-sand">{Math.round(config.density * 100)}%</span>
                  <input className="w-full accent-emerald-500" type="range" min={0.55} max={1.4} step={0.05} value={config.density} onChange={(event) => updateConfig("density", Number(event.target.value))} />
                </label>

                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <label className="space-y-1.5 text-xs font-semibold text-slate-300">Seed
                    <input className="input-field" type="number" min={0} step={1} value={config.seed} onChange={(event) => updateConfig("seed", Math.max(0, Math.round(Number(event.target.value) || 0)))} />
                  </label>
                  <button type="button" className="secondary-button self-end !px-3" onClick={() => updateConfig("seed", Date.now())}>New seed</button>
                </div>

                <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Road naming style
                  <select className="input-field" value={config.roadTheme ?? "western"} onChange={(event) => updateConfig("roadTheme", event.target.value as RoadTheme)}>
                    {ROAD_THEMES.map((theme) => <option key={theme.key} value={theme.key}>{theme.label}</option>)}
                  </select>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-grove-600/70 bg-grove-800/35 p-3 text-xs leading-5 text-slate-300">
                  <input className="mt-1 h-4 w-4 accent-emerald-500" type="checkbox" checked={preserveLocked} onChange={(event) => setPreserveLocked(event.target.checked)} />
                  <span><strong className="text-brand-glow">Preserve locked and manual buildings</strong><br />Unsafe overlaps are skipped instead of silently stacked.</span>
                </label>

                <div className="rounded-xl border border-earth-clay/35 bg-earth-clay/10 p-3 text-xs leading-5 text-earth-sand">
                  Applying replaces generated roads, districts, and buildings. It does not save or close the studio.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="secondary-button min-h-11" onClick={generatePreview} disabled={generating}>{generating ? "Generating…" : "Generate preview"}</button>
                  <button type="button" className="primary-button min-h-11" onClick={applyPreview} disabled={!previewMap || previewStale || generating}>Apply generated plan</button>
                </div>
                {previewStale && previewMap && <p className="text-xs text-amber-200">Settings changed. Generate a fresh preview before applying.</p>}
              </section>
            ) : activeTool === "building" && !selection ? (
              <section className="space-y-4">
                <div>
                  <p className="section-label">Building placement</p>
                  <h3 className="mt-2 font-display text-xl font-semibold">Place a campaign location</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-400">Choose the exact use and name, then click once on the top-down map. Placement does not save or close the studio.</p>
                </div>
                <label className="block space-y-1.5 text-xs text-slate-300">Building name
                  <input className="input-field" maxLength={120} value={buildingName} onChange={(event) => setBuildingName(event.target.value)} />
                </label>
                <label className="block space-y-1.5 text-xs text-slate-300">Building use
                  <select className="input-field" value={buildingUse} onChange={(event) => setBuildingUse(event.target.value as CityBuildingUse)}>
                    {BUILDING_USES.map((item) => <option key={item.key} value={item.key}>{item.label} — {item.description}</option>)}
                  </select>
                </label>
                <div className="status-info">Placement is armed. Click the map to place one building; the tool returns to Select afterward.</div>
                <button type="button" className="secondary-button w-full" onClick={() => setActiveTool("select")}>Cancel placement</button>
              </section>
            ) : selectedBuilding ? (
              <section className="space-y-4">
                <div><p className="section-label">Building inspector</p><h3 className="mt-2 font-display text-xl font-semibold">{selectedBuilding.name}</h3></div>
                <label className="block space-y-1.5 text-xs text-slate-300">Name
                  <input className="input-field" value={selectedBuilding.name} onChange={(event) => updateSelected((map, feature) => ({ ...map, buildings: map.buildings.map((building) => building.id === feature.id ? { ...building, name: event.target.value.slice(0, 120), source: "manual", locked: true } : building) }))} />
                </label>
                <label className="block space-y-1.5 text-xs text-slate-300">Use
                  <select className="input-field" value={selectedBuilding.kind} onChange={(event) => updateSelected((map, feature) => ({ ...map, buildings: map.buildings.map((building) => building.id === feature.id ? { ...building, kind: event.target.value as CityBuildingUse, source: "manual", locked: true } : building) }))}>
                    {BUILDING_USES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </label>
                <label className="block space-y-1.5 text-xs text-slate-300">Campaign note
                  <textarea className="input-field min-h-24 resize-y" maxLength={120} value={selectedBuilding.role ?? ""} onChange={(event) => updateSelected((map, feature) => ({ ...map, buildings: map.buildings.map((building) => building.id === feature.id ? { ...building, role: event.target.value.slice(0, 120) || undefined, source: "manual", locked: true } : building) }))} />
                </label>
                <button type="button" className="danger-button w-full" onClick={removeSelected}>Remove building</button>
              </section>
            ) : selectedRoad ? (
              <section className="space-y-4">
                <div><p className="section-label">Road inspector</p><h3 className="mt-2 font-display text-xl font-semibold">{selectedRoad.name}</h3></div>
                <label className="block space-y-1.5 text-xs text-slate-300">Road name
                  <input className="input-field" value={selectedRoad.name} disabled={Boolean(selectedRoad.external_connection_id)} onChange={(event) => updateSelected((map, feature) => ({ ...map, roads: map.roads.map((road) => road.id === feature.id ? { ...road, name: event.target.value.slice(0, 120), source: "manual", locked: true } : road) }))} />
                </label>
                <label className="block space-y-1.5 text-xs text-slate-300">Class
                  <select className="input-field" value={selectedRoad.importance} disabled={Boolean(selectedRoad.external_connection_id)} onChange={(event) => updateSelected((map, feature) => ({ ...map, roads: map.roads.map((road) => road.id === feature.id ? { ...road, importance: event.target.value as CityRoad["importance"], source: "manual", locked: true } : road) }))}>
                    <option value="main">Arterial</option><option value="secondary">Street</option><option value="alley">Lane</option>
                  </select>
                </label>
                <p className="text-xs leading-5 text-slate-400">Drag the visible nodes in top-down Edit mode. World-road approaches are locked to their parent road.</p>
                <button type="button" className="danger-button w-full" disabled={Boolean(selectedRoad.external_connection_id)} onClick={removeSelected}>{selectedRoad.external_connection_id ? "World approach is locked" : "Remove road"}</button>
              </section>
            ) : selectedDistrict ? (
              <section className="space-y-4">
                <div><p className="section-label">District inspector</p><h3 className="mt-2 font-display text-xl font-semibold">{selectedDistrict.name}</h3></div>
                <label className="block space-y-1.5 text-xs text-slate-300">District name
                  <input className="input-field" value={selectedDistrict.name} onChange={(event) => updateSelected((map, feature) => ({ ...map, districts: map.districts?.map((district) => district.id === feature.id ? { ...district, name: event.target.value.slice(0, 120), source: "manual", locked: true } : district) }))} />
                </label>
                <p className="text-xs leading-5 text-slate-400">{selectedDistrict.kind} · {mapData?.buildings.filter((building) => building.district_id === selectedDistrict.id).length ?? 0} buildings</p>
                <button type="button" className="danger-button w-full" onClick={removeSelected}>Remove district</button>
              </section>
            ) : (
              <section className="space-y-5">
                <div><p className="section-label">Plan overview</p><h3 className="mt-2 font-display text-xl font-semibold">Layers & features</h3><p className="mt-2 text-xs leading-5 text-slate-400">{featureLabel(selection)}. Select a feature on the map or from the lists below.</p></div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-grove-600/70 bg-grove-800/35 p-3 text-center"><strong className="block text-lg">{mapData?.roads.length ?? 0}</strong><span className="text-[10px] uppercase tracking-wide text-slate-400">Roads</span></div>
                  <div className="rounded-xl border border-grove-600/70 bg-grove-800/35 p-3 text-center"><strong className="block text-lg">{mapData?.districts?.length ?? 0}</strong><span className="text-[10px] uppercase tracking-wide text-slate-400">Districts</span></div>
                  <div className="rounded-xl border border-grove-600/70 bg-grove-800/35 p-3 text-center"><strong className="block text-lg">{mapData?.buildings.length ?? 0}</strong><span className="text-[10px] uppercase tracking-wide text-slate-400">Buildings</span></div>
                </div>
                <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Feature inspector
                  <select
                    className="input-field"
                    value={selection ? `${selection.kind}:${selection.id}` : ""}
                    onChange={(event) => {
                      const separator = event.target.value.indexOf(":");
                      if (separator < 0) {
                        setSelection(null);
                        return;
                      }
                      const kind = event.target.value.slice(0, separator);
                      const id = event.target.value.slice(separator + 1);
                      if (kind === "district" || kind === "road" || kind === "building") {
                        setSelection({ kind, id });
                      }
                    }}
                  >
                    <option value="">Choose a feature…</option>
                    <optgroup label="Districts">
                      {mapData?.districts?.map((district) => <option key={district.id} value={`district:${district.id}`}>{district.name}</option>)}
                    </optgroup>
                    <optgroup label="Roads">
                      {mapData?.roads.map((road) => <option key={road.id} value={`road:${road.id}`}>{road.name}</option>)}
                    </optgroup>
                    <optgroup label="Buildings">
                      {mapData?.buildings.map((building) => <option key={building.id} value={`building:${building.id}`}>{building.name}</option>)}
                    </optgroup>
                  </select>
                  <span className="block font-normal leading-5 text-slate-400">Keyboard users can open any feature here, then edit it in the inspector.</span>
                </label>
                <div className="space-y-2">
                  {([
                    ["districts", "Districts"], ["roads", "Roads"], ["buildings", "Buildings"], ["districtLabels", "District labels"], ["roadLabels", "Road labels"], ["buildingLabels", "Landmark labels"],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex min-h-10 items-center justify-between rounded-xl border border-grove-600/60 bg-grove-800/25 px-3 text-xs text-slate-300">
                      {label}<input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={layers[key]} onChange={(event) => setLayers((current) => ({ ...current, [key]: event.target.checked }))} />
                    </label>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="section-label">Districts</p>
                  <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {mapData?.districts?.map((district) => <button key={district.id} type="button" className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-grove-700" onClick={() => setSelection({ kind: "district", id: district.id })}><span className="font-semibold text-brand-glow">{district.name}</span><span className="float-right text-slate-400">{district.kind}</span></button>)}
                  </div>
                </div>
              </section>
            )}
          </div>
        </aside>
      </div>

      <footer className="flex min-h-9 shrink-0 items-center justify-between gap-4 border-t border-grove-600/70 bg-grove-950/95 px-4 text-[11px] text-slate-400">
        <span>{previewActive ? "Preview mode — Apply generated plan to edit" : mode === "presentation" ? "Presentation hides editor handles" : `${activeTool[0].toUpperCase()}${activeTool.slice(1)} · right-drag or Pan tool to move`}</span>
        <span>{externalConnections.length} world approach{externalConnections.length === 1 ? "" : "es"} · {viewMode === "topdown" ? "Top-down" : "Isometric 45°"}</span>
      </footer>

      <ConfirmDialog
        open={closeRequested}
        eyebrow="Unsaved city plan"
        title="Leave City Studio?"
        description="Your local city edits have not been saved. Leaving now discards them; saving is a separate action and never closes the studio."
        confirmLabel="Discard and leave"
        danger
        onCancel={() => setCloseRequested(false)}
        onConfirm={() => { setCloseRequested(false); onClose(); }}
      />
    </div>
  );
}
