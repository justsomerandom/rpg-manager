import type {
  CityBuilding,
  CityDistrict,
  CityLayout,
  CityMap,
  CityRoad,
  CitySize,
  CityType,
} from "../../api/cityMap";
import type { MapCity } from "../../api/worldMap";
import {
  TAU,
  SeededRandom,
  SpatialHash,
  chaikinSmooth,
  clamp,
  distance,
  distanceSegmentToRectangle,
  hashParts,
  pointOnEllipse,
  polygonCentroid,
  polygonContainsPoint,
  rectangleBounds,
  rectangleInsideEllipse,
  rectanglesOverlap,
  stableId,
  type Bounds,
  type EllipseBoundary,
  type OrientedRectangle,
  type Point,
} from "./geometry";

type RoadTheme = NonNullable<CityMap["road_theme"]>;
type RoadImportance = CityRoad["importance"];
type DistrictKind = Extract<
  CityDistrict["kind"],
  "civic" | "commercial" | "residential" | "industrial" | "harbor" | "green" | "mixed"
>;
type BuildingKind = Extract<
  CityBuilding["kind"],
  "residential" | "commercial" | "industrial" | "civic" | "landmark"
>;

export type CityGenerationConfig = {
  size: CitySize;
  cityType: CityType;
  layout: CityLayout;
  seed: number;
  /** Building density multiplier. Values outside 0.55–1.4 are safely clamped. */
  density: number;
  /** Geographic footprint multiplier. It affects the boundary, not the saved canvas size. */
  scale?: number;
  roadTheme?: RoadTheme;
};

export const CITY_TYPE_OPTIONS: ReadonlyArray<{
  key: CityType;
  label: string;
  description: string;
}> = [
  { key: "capital", label: "Capital", description: "Ceremonial avenues, civic quarters, and dense mixed wards." },
  { key: "trade", label: "Trade hub", description: "Market-heavy districts gathered around connected thoroughfares." },
  { key: "port", label: "Port city", description: "A harbor quarter backed by commerce, workshops, and housing." },
  { key: "fortress", label: "Fortress", description: "Defensible rings, controlled approaches, and a civic core." },
  { key: "industrial", label: "Industrial", description: "Production districts with direct arterial and freight access." },
  { key: "rural", label: "Rural settlement", description: "A loose, low-rise settlement with green and residential land." },
];

export const CITY_LAYOUT_OPTIONS: ReadonlyArray<{
  key: CityLayout;
  label: string;
  description: string;
}> = [
  { key: "organic", label: "Organic", description: "Curving roads and irregular connectors grown over time." },
  { key: "grid", label: "Grid", description: "Legible blocks with a clear street hierarchy." },
  { key: "radial", label: "Radial", description: "Spokes and orbital streets focused on the civic centre." },
  { key: "ring", label: "Ring", description: "Concentric routes linked by controlled cross-city roads." },
];

const BUILDING_TARGETS: Record<CitySize, number> = {
  village: 80,
  town: 240,
  city: 650,
  megapolis: 1_200,
};

export const CITY_SIZE_OPTIONS: ReadonlyArray<{
  key: CitySize;
  label: string;
  description: string;
  targetBuildings: number;
}> = [
  { key: "village", label: "Village", description: "A compact settlement with a few local streets.", targetBuildings: BUILDING_TARGETS.village },
  { key: "town", label: "Town", description: "Several connected quarters and a developed centre.", targetBuildings: BUILDING_TARGETS.town },
  { key: "city", label: "City", description: "A full district network with layered street hierarchy.", targetBuildings: BUILDING_TARGETS.city },
  { key: "megapolis", label: "Metropolis", description: "A dense regional centre built for high-level campaigns.", targetBuildings: BUILDING_TARGETS.megapolis },
];

export function deriveRecommendedCitySize(population: number): CitySize {
  const safePopulation = Number.isFinite(population) ? Math.max(0, population) : 0;
  if (safePopulation < 1_200) return "village";
  if (safePopulation < 12_000) return "town";
  if (safePopulation < 85_000) return "city";
  return "megapolis";
}

export function stableCityFeatureId(
  cityId: string,
  seed: number,
  feature: "road" | "district" | "building",
  index: number,
): string {
  return stableId(feature, seed, cityId, index);
}

export function stableCityRoadPointId(roadId: string, pointIndex: number): string {
  return stableId("point", hashParts(roadId), pointIndex);
}

type RoadDraft = {
  id: string;
  name: string;
  importance: RoadImportance;
  tier: 1 | 2 | 3 | 4 | 5;
  externalConnectionIndex?: number;
  points: Point[];
};

type GeneratedDistrict = CityDistrict & {
  kind: DistrictKind;
  points: Point[];
};

type IndexedRoadSegment = {
  a: Point;
  b: Point;
  corridor: number;
  importance: RoadImportance;
  length: number;
};

type IndexedBuilding = {
  rectangle: OrientedRectangle;
};

type BuildingSlot = {
  segment: IndexedRoadSegment;
  amount: number;
  side: -1 | 1;
  row: number;
};

const SIZE_ORDER: Record<CitySize, number> = {
  village: 0,
  town: 1,
  city: 2,
  megapolis: 3,
};

const ROAD_CORRIDORS: Record<RoadImportance, number> = {
  main: 0.0075,
  secondary: 0.0048,
  alley: 0.0028,
};

const ROAD_NAMES: Record<RoadImportance, readonly string[]> = {
  main: ["Grand Avenue", "King's Road", "High Street", "Crown Way", "Gate Road", "Founders' Avenue", "Meridian Way", "Long Road"],
  secondary: ["Market Street", "Mill Street", "Garden Way", "Temple Street", "Bridge Lane", "Guild Street", "Station Road", "Lantern Street"],
  alley: ["Copper Lane", "Willow Lane", "Mason's Row", "Baker's Row", "Ash Walk", "Orchard Lane", "Wren Close", "Old Passage"],
};

const DISTRICT_COLORS: Record<DistrictKind, string> = {
  civic: "#c8a96b",
  commercial: "#d9985f",
  residential: "#8eb69b",
  industrial: "#8e9892",
  harbor: "#6f9fa6",
  green: "#73a16f",
  mixed: "#a68fb0",
};

const DISTRICT_LABELS: Record<DistrictKind, readonly string[]> = {
  civic: ["Crown Quarter", "Civic Forum", "Temple Ward", "Court District"],
  commercial: ["Market Quarter", "Merchants' Ward", "Exchange District", "Caravan Quarter"],
  residential: ["Garden Ward", "Hearth Ward", "North Ward", "South Ward", "Old Quarter"],
  industrial: ["Foundry Ward", "Makers' Quarter", "Kiln District", "Works Quarter"],
  harbor: ["Harbor Ward", "Dock Quarter", "Wharf District", "Tide Market"],
  green: ["Commons", "Garden District", "Grove Ward", "Pasture Quarter"],
  mixed: ["Old Town", "Crossroads Ward", "Riverside Quarter", "Outer Ward"],
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizedSeed(seed: number): number {
  return Number.isSafeInteger(seed) ? Math.abs(seed) : hashParts(finiteOr(seed, 1));
}

function cityBoundary(size: CitySize, scale: number, cityType: CityType): EllipseBoundary {
  const baseRadius: Record<CitySize, number> = {
    village: 0.3,
    town: 0.355,
    city: 0.405,
    megapolis: 0.447,
  };
  const radius = clamp(baseRadius[size] * Math.sqrt(scale), 0.25, 0.465);
  const horizontalFactor = cityType === "port" ? 1.04 : cityType === "rural" ? 1.06 : 1;
  const verticalFactor = cityType === "fortress" ? 0.97 : 1;
  return {
    x: 0.5,
    y: 0.5,
    radiusX: clamp(radius * horizontalFactor, 0.24, 0.47),
    radiusY: clamp(radius * verticalFactor, 0.24, 0.47),
  };
}

function cleanPolyline(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const normalized = { x: clamp(point.x, 0.01, 0.99), y: clamp(point.y, 0.01, 0.99) };
    const previous = result[result.length - 1];
    if (!previous || distance(previous, normalized) >= 0.002) result.push(normalized);
  }
  return result;
}

function roadTier(importance: RoadImportance, size: CitySize): 1 | 2 | 3 | 4 | 5 {
  if (importance === "alley") return 1;
  if (importance === "secondary") return SIZE_ORDER[size] >= 2 ? 3 : 2;
  return SIZE_ORDER[size] >= 2 ? 5 : 4;
}

function makeRoadNetwork(
  cityId: string,
  size: CitySize,
  layout: CityLayout,
  cityType: CityType,
  seed: number,
  boundary: EllipseBoundary,
  entranceAngles: readonly number[],
): RoadDraft[] {
  const rng = new SeededRandom(hashParts(seed, cityId, "roads", layout, cityType));
  const roads: RoadDraft[] = [];
  let roadIndex = 0;
  const addRoad = (
    importance: RoadImportance,
    rawPoints: readonly Point[],
    externalConnectionIndex?: number,
  ) => {
    const points = cleanPolyline(rawPoints);
    if (points.length < 2) return;
    const id = stableCityFeatureId(cityId, seed, "road", roadIndex);
    const nameChoices = ROAD_NAMES[importance];
    const repeated = Math.floor(roadIndex / nameChoices.length);
    roads.push({
      id,
      name: `${nameChoices[roadIndex % nameChoices.length]}${repeated > 0 ? ` ${repeated + 1}` : ""}`,
      importance,
      tier: roadTier(importance, size),
      externalConnectionIndex,
      points,
    });
    roadIndex += 1;
  };

  const center = { x: boundary.x, y: boundary.y };
  const level = SIZE_ORDER[size];

  if (layout === "grid") {
    const lineCount = [5, 7, 10, 13][level]!;
    const rotation = rng.range(-0.075, 0.075);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const transform = (x: number, y: number): Point => ({
      x: center.x + x * cosine - y * sine,
      y: center.y + x * sine + y * cosine,
    });
    for (let index = 0; index < lineCount; index += 1) {
      const ratio = lineCount === 1 ? 0 : (index / (lineCount - 1)) * 2 - 1;
      const offsetX = ratio * boundary.radiusX * 0.78;
      const offsetY = ratio * boundary.radiusY * 0.78;
      const verticalSpan = boundary.radiusY * Math.sqrt(Math.max(0.05, 1 - (offsetX / boundary.radiusX) ** 2)) * 0.94;
      const horizontalSpan = boundary.radiusX * Math.sqrt(Math.max(0.05, 1 - (offsetY / boundary.radiusY) ** 2)) * 0.94;
      const distanceFromCentre = Math.abs(ratio);
      const importance: RoadImportance = distanceFromCentre < 0.12
        ? "main"
        : index % 3 === 1
          ? "secondary"
          : "alley";
      addRoad(importance, [transform(offsetX, -verticalSpan), transform(offsetX, verticalSpan)]);
      addRoad(importance, [transform(-horizontalSpan, offsetY), transform(horizontalSpan, offsetY)]);
    }
  } else if (layout === "radial") {
    const spokeCount = [6, 8, 11, 14][level]!;
    const startAngle = rng.range(-Math.PI, Math.PI);
    for (let index = 0; index < spokeCount; index += 1) {
      const angle = startAngle + (index / spokeCount) * TAU;
      const importance: RoadImportance = index % Math.max(2, Math.floor(spokeCount / 4)) === 0 ? "main" : "secondary";
      const middle = pointOnEllipse(boundary, angle + rng.range(-0.035, 0.035), 0.5);
      addRoad(importance, [center, middle, pointOnEllipse(boundary, angle, 0.94)]);
    }
    const ringCount = [2, 3, 4, 5][level]!;
    for (let ring = 1; ring <= ringCount; ring += 1) {
      const scale = (ring / (ringCount + 1)) * 0.91;
      const samples = Math.max(18, spokeCount * 2);
      const points = Array.from({ length: samples + 1 }, (_, index) =>
        pointOnEllipse(boundary, startAngle + (index / samples) * TAU, scale),
      );
      addRoad(ring === ringCount ? "main" : ring % 2 === 0 ? "secondary" : "alley", points);
    }
  } else if (layout === "ring") {
    const ringCount = [2, 3, 5, 6][level]!;
    const spokeCount = [4, 6, 8, 10][level]!;
    const startAngle = rng.range(-Math.PI, Math.PI);
    for (let ring = 1; ring <= ringCount; ring += 1) {
      const scale = (ring / ringCount) * 0.91;
      const samples = Math.max(20, spokeCount * 3);
      const points = Array.from({ length: samples + 1 }, (_, index) =>
        pointOnEllipse(boundary, startAngle + (index / samples) * TAU, scale),
      );
      const importance: RoadImportance = ring === 1 || ring === ringCount ? "main" : ring % 2 === 0 ? "secondary" : "alley";
      addRoad(importance, points);
    }
    for (let index = 0; index < spokeCount; index += 1) {
      const angle = startAngle + (index / spokeCount) * TAU;
      addRoad(index % 3 === 0 ? "main" : "secondary", [
        pointOnEllipse(boundary, angle, 0.08),
        pointOnEllipse(boundary, angle + rng.range(-0.025, 0.025), 0.48),
        pointOnEllipse(boundary, angle, 0.93),
      ]);
    }
  } else {
    const arterialCount = [4, 6, 8, 10][level]!;
    const startAngle = rng.range(-Math.PI, Math.PI);
    const arterialAngles: number[] = [];
    const arterialPaths: Point[][] = [];
    for (let index = 0; index < arterialCount; index += 1) {
      const angle = startAngle + (index / arterialCount) * TAU + rng.range(-0.13, 0.13);
      arterialAngles.push(angle);
      const controlA = pointOnEllipse(boundary, angle + rng.range(-0.18, 0.18), 0.28);
      const controlB = pointOnEllipse(boundary, angle + rng.range(-0.12, 0.12), 0.62);
      const smoothed = chaikinSmooth([center, controlA, controlB, pointOnEllipse(boundary, angle, 0.94)], 2);
      arterialPaths.push(smoothed);
      addRoad(index % 3 === 0 ? "main" : "secondary", smoothed);
    }
    const branchLayers = [1, 2, 3, 4][level]!;
    for (let layer = 0; layer < branchLayers; layer += 1) {
      const scale = 0.3 + layer * (0.54 / Math.max(1, branchLayers - 1));
      for (let index = 0; index < arterialAngles.length; index += 1) {
        const angle = arterialAngles[index]!;
        const nextAngle = arterialAngles[(index + 1) % arterialAngles.length]!;
        const startPath = arterialPaths[index]!;
        const endPath = arterialPaths[(index + 1) % arterialPaths.length]!;
        const start = startPath[Math.round(clamp(scale / 0.94) * (startPath.length - 1))]!;
        const end = endPath[Math.round(clamp((scale + rng.range(-0.025, 0.025)) / 0.94) * (endPath.length - 1))]!;
        const middleAngle = angle + Math.atan2(Math.sin(nextAngle - angle), Math.cos(nextAngle - angle)) / 2;
        const control = pointOnEllipse(boundary, middleAngle + rng.range(-0.08, 0.08), scale + rng.range(-0.035, 0.04));
        addRoad(layer === branchLayers - 1 ? "secondary" : "alley", chaikinSmooth([start, control, end], 2));
      }
    }
  }

  entranceAngles.forEach((angle, entranceIndex) => {
    const outer = pointOnEllipse(boundary, angle, 0.995);
    const approach = pointOnEllipse(boundary, angle + rng.range(-0.035, 0.035), 0.72);
    const inner = pointOnEllipse(boundary, angle + rng.range(-0.08, 0.08), 0.3);
    addRoad("main", chaikinSmooth([outer, approach, inner, center], 1), entranceIndex);
  });

  return roads;
}

type WeightedKind = readonly [DistrictKind, number];

const DISTRICT_WEIGHTS: Record<CityType, readonly WeightedKind[]> = {
  capital: [["civic", 3], ["commercial", 2], ["residential", 4], ["mixed", 3], ["green", 1], ["industrial", 1]],
  trade: [["commercial", 4], ["residential", 3], ["mixed", 3], ["industrial", 2], ["civic", 1], ["green", 1]],
  port: [["harbor", 3], ["commercial", 3], ["industrial", 2], ["residential", 3], ["mixed", 2], ["civic", 1]],
  fortress: [["civic", 3], ["residential", 3], ["industrial", 2], ["mixed", 2], ["green", 1], ["commercial", 1]],
  industrial: [["industrial", 5], ["residential", 3], ["commercial", 2], ["mixed", 2], ["civic", 1], ["green", 1]],
  rural: [["residential", 4], ["green", 4], ["mixed", 3], ["commercial", 1], ["civic", 1], ["industrial", 1]],
};

function weightedDistrictKind(rng: SeededRandom, cityType: CityType): DistrictKind {
  const weights = DISTRICT_WEIGHTS[cityType];
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = rng.range(0, total);
  for (const [kind, weight] of weights) {
    cursor -= weight;
    if (cursor <= 0) return kind;
  }
  return weights[weights.length - 1]![0];
}

function createDistrictPolygon(
  boundary: EllipseBoundary,
  startAngle: number,
  endAngle: number,
  innerScale: number,
  outerScale: number,
): Point[] {
  const angularSpan = endAngle - startAngle;
  const samples = Math.max(3, Math.ceil(Math.abs(angularSpan) / 0.28));
  const points: Point[] = [];
  for (let index = 0; index <= samples; index += 1) {
    points.push(pointOnEllipse(boundary, startAngle + (angularSpan * index) / samples, innerScale));
  }
  for (let index = samples; index >= 0; index -= 1) {
    points.push(pointOnEllipse(boundary, startAngle + (angularSpan * index) / samples, outerScale));
  }
  return points;
}

function makeDistricts(
  cityId: string,
  size: CitySize,
  cityType: CityType,
  seed: number,
  boundary: EllipseBoundary,
  entranceAngles: readonly number[],
): GeneratedDistrict[] {
  const rng = new SeededRandom(hashParts(seed, cityId, "districts", cityType));
  const totalCount = [4, 7, 10, 14][SIZE_ORDER[size]]!;
  const centralScale = cityType === "rural" ? 0.19 : cityType === "capital" ? 0.27 : 0.23;
  const centralKind: DistrictKind = cityType === "industrial"
    ? "industrial"
    : cityType === "trade" || cityType === "port"
      ? "commercial"
      : cityType === "rural"
        ? "mixed"
        : "civic";
  const districts: GeneratedDistrict[] = [];
  const kindCounts = new Map<DistrictKind, number>();
  const addDistrict = (kind: DistrictKind, points: Point[]) => {
    const kindIndex = kindCounts.get(kind) ?? 0;
    kindCounts.set(kind, kindIndex + 1);
    const centroid = polygonCentroid(points);
    const radius = Math.max(0.02, ...points.map((point) => distance(point, centroid)));
    const nameChoices = DISTRICT_LABELS[kind];
    const repeated = Math.floor(kindIndex / nameChoices.length);
    const baseName = nameChoices[kindIndex % nameChoices.length]!;
    districts.push({
      id: stableCityFeatureId(cityId, seed, "district", districts.length),
      name: `${baseName}${repeated > 0 ? ` ${repeated + 1}` : ""}`,
      kind,
      x: centroid.x,
      y: centroid.y,
      radius,
      color: DISTRICT_COLORS[kind],
      points,
      source: "generated",
      locked: false,
    });
  };

  const centralPoints = Array.from({ length: 12 }, (_, index) =>
    pointOnEllipse(boundary, (index / 12) * TAU, centralScale),
  );
  addDistrict(centralKind, centralPoints);

  const outerCount = totalCount - 1;
  const originAngle = rng.range(-Math.PI, Math.PI);
  const harborAngle = entranceAngles[0] ?? originAngle;
  let harborAssigned = cityType !== "port";
  for (let index = 0; index < outerCount; index += 1) {
    const startAngle = originAngle + (index / outerCount) * TAU + 0.009;
    const endAngle = originAngle + ((index + 1) / outerCount) * TAU - 0.009;
    const middleAngle = (startAngle + endAngle) / 2;
    const harborDifference = Math.abs(Math.atan2(Math.sin(middleAngle - harborAngle), Math.cos(middleAngle - harborAngle)));
    const kind = !harborAssigned && harborDifference <= Math.PI / Math.max(3, outerCount)
      ? "harbor"
      : weightedDistrictKind(rng, cityType);
    if (kind === "harbor") harborAssigned = true;
    addDistrict(kind, createDistrictPolygon(boundary, startAngle, endAngle, centralScale * 1.08, 0.93));
  }
  if (cityType === "port" && !harborAssigned && districts.length > 1) {
    const replacement = districts[1]!;
    replacement.kind = "harbor";
    replacement.name = DISTRICT_LABELS.harbor[0]!;
    replacement.color = DISTRICT_COLORS.harbor;
  }
  return districts;
}

function finalizeRoads(roads: readonly RoadDraft[]): CityRoad[] {
  return roads.map((road) => ({
    id: road.id,
    name: road.name,
    importance: road.importance,
    tier: road.tier,
    external_connection_index: road.externalConnectionIndex,
    points: road.points.map((point, pointIndex) => ({
      id: stableCityRoadPointId(road.id, pointIndex),
      x: point.x,
      y: point.y,
    })),
    source: "generated",
    locked: false,
  }));
}

function segmentBounds(a: Point, b: Point, padding: number): Bounds {
  return {
    minX: Math.min(a.x, b.x) - padding,
    minY: Math.min(a.y, b.y) - padding,
    maxX: Math.max(a.x, b.x) + padding,
    maxY: Math.max(a.y, b.y) + padding,
  };
}

function indexRoadSegments(roads: readonly RoadDraft[]): {
  segments: IndexedRoadSegment[];
  spatialIndex: SpatialHash<IndexedRoadSegment>;
} {
  const segments: IndexedRoadSegment[] = [];
  const spatialIndex = new SpatialHash<IndexedRoadSegment>(0.045);
  for (const road of roads) {
    const corridor = ROAD_CORRIDORS[road.importance];
    for (let index = 1; index < road.points.length; index += 1) {
      const a = road.points[index - 1]!;
      const b = road.points[index]!;
      const segmentLength = distance(a, b);
      if (segmentLength < 0.002) continue;
      const segment: IndexedRoadSegment = { a, b, corridor, importance: road.importance, length: segmentLength };
      segments.push(segment);
      spatialIndex.insert(segment, segmentBounds(a, b, corridor + 0.004));
    }
  }
  return { segments, spatialIndex };
}

function rectangleForBuilding(building: CityBuilding): OrientedRectangle | null {
  const width = finiteOr(building.width ?? undefined, finiteOr(building.footprint, 0.012));
  const height = finiteOr(building.height ?? undefined, finiteOr(building.footprint, width));
  const rotation = finiteOr(building.rotation ?? undefined, 0);
  if (
    !Number.isFinite(building.x) ||
    !Number.isFinite(building.y) ||
    width < 0.002 ||
    height < 0.002 ||
    width > 0.12 ||
    height > 0.12
  ) {
    return null;
  }
  return { x: building.x, y: building.y, width, height, rotation };
}

function clearsRoads(
  rectangle: OrientedRectangle,
  roadIndex: SpatialHash<IndexedRoadSegment>,
  extraClearance = 0.0018,
): boolean {
  return roadIndex.query(rectangleBounds(rectangle, 0.012)).every((segment) =>
    distanceSegmentToRectangle(segment.a, segment.b, rectangle) > segment.corridor + extraClearance,
  );
}

function findDistrict(point: Point, districts: readonly GeneratedDistrict[]): GeneratedDistrict {
  const containing = districts.find((district) => polygonContainsPoint(point, district.points));
  if (containing) return containing;
  return districts.reduce((nearest, district) =>
    distance(point, district) < distance(point, nearest) ? district : nearest,
  districts[0]!);
}

const BUILDING_WEIGHTS: Record<DistrictKind, Record<BuildingKind, number>> = {
  civic: { residential: 18, commercial: 18, industrial: 2, civic: 48, landmark: 14 },
  commercial: { residential: 18, commercial: 62, industrial: 6, civic: 9, landmark: 5 },
  residential: { residential: 80, commercial: 11, industrial: 2, civic: 6, landmark: 1 },
  industrial: { residential: 10, commercial: 9, industrial: 72, civic: 7, landmark: 2 },
  harbor: { residential: 12, commercial: 40, industrial: 38, civic: 7, landmark: 3 },
  green: { residential: 36, commercial: 7, industrial: 2, civic: 40, landmark: 15 },
  mixed: { residential: 49, commercial: 25, industrial: 10, civic: 12, landmark: 4 },
};

const TYPE_BUILDING_MODIFIERS: Record<CityType, Partial<Record<BuildingKind, number>>> = {
  capital: { civic: 1.7, landmark: 1.8, commercial: 1.15 },
  trade: { commercial: 1.8, industrial: 1.12 },
  port: { commercial: 1.35, industrial: 1.45 },
  fortress: { civic: 1.45, industrial: 1.25, landmark: 1.25 },
  industrial: { industrial: 2, commercial: 1.1 },
  rural: { residential: 1.4, civic: 1.15, industrial: 0.7 },
};

function chooseBuildingKind(rng: SeededRandom, districtKind: DistrictKind, cityType: CityType): BuildingKind {
  const base = BUILDING_WEIGHTS[districtKind];
  const modifiers = TYPE_BUILDING_MODIFIERS[cityType];
  const entries = (Object.keys(base) as BuildingKind[]).map((kind) => [kind, base[kind] * (modifiers[kind] ?? 1)] as const);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = rng.range(0, total);
  for (const [kind, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return kind;
  }
  return "residential";
}

function districtBuildProbability(kind: DistrictKind): number {
  if (kind === "green") return 0.22;
  if (kind === "civic") return 0.72;
  if (kind === "harbor") return 0.9;
  return 1;
}

function buildingDimensions(
  rng: SeededRandom,
  size: CitySize,
  kind: BuildingKind,
): { width: number; height: number } {
  const baseRange: Record<CitySize, readonly [number, number]> = {
    village: [0.011, 0.019],
    town: [0.0085, 0.0155],
    city: [0.0065, 0.0125],
    megapolis: [0.0052, 0.0102],
  };
  const [minimum, maximum] = baseRange[size];
  const kindScale: Record<BuildingKind, number> = {
    residential: 1,
    commercial: 1.16,
    industrial: 1.42,
    civic: 1.32,
    landmark: 1.65,
  };
  const width = rng.range(minimum, maximum) * kindScale[kind];
  const aspect = kind === "industrial" ? rng.range(0.65, 1.7) : rng.range(0.72, 1.35);
  return { width, height: clamp(width * aspect, minimum * 0.7, maximum * 1.75) };
}

function makeBuildingSlots(
  rng: SeededRandom,
  size: CitySize,
  segments: readonly IndexedRoadSegment[],
): BuildingSlot[] {
  const spacing: Record<CitySize, number> = {
    village: 0.018,
    town: 0.0135,
    city: 0.0102,
    megapolis: 0.0082,
  };
  const rowCount = size === "megapolis" ? 5 : size === "city" ? 4 : 2;
  const roadFrequency: Record<RoadImportance, number> = { main: 0.85, secondary: 1, alley: 1 };
  const slots: BuildingSlot[] = [];
  for (const segment of segments) {
    if (!rng.chance(roadFrequency[segment.importance])) continue;
    const slotCount = Math.floor(segment.length / spacing[size]);
    if (slotCount <= 0) continue;
    const phase = rng.range(-0.16, 0.16);
    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const amount = clamp((slotIndex + 0.5 + phase) / slotCount, 0.045, 0.955);
      for (let row = 0; row < rowCount; row += 1) {
        slots.push({ segment, amount, side: -1, row }, { segment, amount, side: 1, row });
      }
    }
  }
  for (let index = slots.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.integer(0, index);
    const current = slots[index]!;
    slots[index] = slots[swapIndex]!;
    slots[swapIndex] = current;
  }
  return slots;
}

function safeLockedBuildings(
  buildings: readonly CityBuilding[],
  boundary: EllipseBoundary,
  roadIndex: SpatialHash<IndexedRoadSegment>,
  buildingIndex: SpatialHash<IndexedBuilding>,
): CityBuilding[] {
  const preserved: CityBuilding[] = [];
  const seenIds = new Set<string>();
  for (const building of buildings) {
    if (!building.locked && building.source !== "manual") continue;
    if (seenIds.has(building.id)) continue;
    const rectangle = rectangleForBuilding(building);
    if (!rectangle || !rectangleInsideEllipse(rectangle, boundary, 0.006) || !clearsRoads(rectangle, roadIndex)) continue;
    const bounds = rectangleBounds(rectangle, 0.0028);
    const overlaps = buildingIndex.query(bounds).some((other) => rectanglesOverlap(rectangle, other.rectangle, 0.0014));
    if (overlaps) continue;
    const indexed = { rectangle };
    buildingIndex.insert(indexed, rectangleBounds(rectangle));
    seenIds.add(building.id);
    preserved.push({
      ...building,
      source: building.source ?? "manual",
      locked: building.locked ?? true,
    });
  }
  return preserved;
}

function makeBuildings(
  cityId: string,
  size: CitySize,
  cityType: CityType,
  seed: number,
  density: number,
  scale: number,
  boundary: EllipseBoundary,
  roads: readonly RoadDraft[],
  districts: readonly GeneratedDistrict[],
  lockedBuildings: readonly CityBuilding[],
): CityBuilding[] {
  const rng = new SeededRandom(hashParts(seed, cityId, "buildings", size, cityType, density, scale));
  const { segments, spatialIndex: roadIndex } = indexRoadSegments(roads);
  if (segments.length === 0) return [];
  const buildingIndex = new SpatialHash<IndexedBuilding>(0.027);
  const preserved = safeLockedBuildings(lockedBuildings, boundary, roadIndex, buildingIndex);
  const target = Math.max(
    preserved.length,
    Math.round(BUILDING_TARGETS[size] * density * Math.sqrt(scale)),
  );
  const buildings: CityBuilding[] = [...preserved];
  const usedBuildingIds = new Set(preserved.map((building) => building.id));
  const kindCounters: Record<BuildingKind, number> = {
    residential: 0,
    commercial: 0,
    industrial: 0,
    civic: 0,
    landmark: 0,
  };
  const slots = makeBuildingSlots(rng, size, segments);

  for (const slot of slots) {
    if (buildings.length >= target) break;
    const { segment, amount } = slot;
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    const segmentLength = Math.max(0.0001, segment.length);
    const roadPoint = { x: segment.a.x + dx * amount, y: segment.a.y + dy * amount };
    const side = slot.side;
    const tangentAngle = Math.atan2(dy, dx);
    const provisionalPoint = {
      x: roadPoint.x + (-dy / segmentLength) * side * (segment.corridor + 0.013),
      y: roadPoint.y + (dx / segmentLength) * side * (segment.corridor + 0.013),
    };
    const district = findDistrict(provisionalPoint, districts);
    if (!rng.chance(districtBuildProbability(district.kind))) continue;
    const kind = chooseBuildingKind(rng, district.kind, cityType);
    const dimensions = buildingDimensions(rng, size, kind);
    const setback =
      segment.corridor +
      dimensions.height / 2 +
      rng.range(0.0024, 0.0042) +
      slot.row * (dimensions.height * 1.18 + 0.0025);
    const rectangle: OrientedRectangle = {
      x: roadPoint.x + (-dy / segmentLength) * side * setback,
      y: roadPoint.y + (dx / segmentLength) * side * setback,
      width: dimensions.width,
      height: dimensions.height,
      rotation: tangentAngle + rng.range(-0.065, 0.065),
    };
    if (!rectangleInsideEllipse(rectangle, boundary, 0.005)) continue;
    if (!polygonContainsPoint({ x: rectangle.x, y: rectangle.y }, district.points)) continue;
    if (!clearsRoads(rectangle, roadIndex)) continue;
    const paddedBounds = rectangleBounds(rectangle, 0.0027);
    const overlaps = buildingIndex.query(paddedBounds).some((other) =>
      rectanglesOverlap(rectangle, other.rectangle, 0.00135),
    );
    if (overlaps) continue;

    const generatedIndex = buildings.length - preserved.length;
    kindCounters[kind] += 1;
    let id = stableCityFeatureId(cityId, seed, "building", generatedIndex);
    let collisionIndex = 0;
    while (usedBuildingIds.has(id)) {
      collisionIndex += 1;
      id = stableId("building", seed, cityId, "generated", generatedIndex, collisionIndex);
    }
    const building: CityBuilding = {
      id,
      name: `${kind[0]!.toUpperCase()}${kind.slice(1)} ${String(kindCounters[kind]).padStart(3, "0")}`,
      kind,
      x: rectangle.x,
      y: rectangle.y,
      footprint: Math.max(rectangle.width, rectangle.height),
      width: rectangle.width,
      height: rectangle.height,
      rotation: rectangle.rotation,
      district_id: district.id,
      source: "generated",
      locked: false,
    };
    buildings.push(building);
    usedBuildingIds.add(id);
    const indexed = { rectangle };
    buildingIndex.insert(indexed, rectangleBounds(rectangle));
  }
  return buildings;
}

function normalizedEntrances(entrances: readonly number[]): number[] {
  const normalized: number[] = [];
  for (const value of entrances.slice(0, 32)) {
    if (!Number.isFinite(value)) continue;
    const angle = Math.atan2(Math.sin(value), Math.cos(value));
    if (normalized.every((existing) => Math.abs(Math.atan2(Math.sin(existing - angle), Math.cos(existing - angle))) > 0.035)) {
      normalized.push(angle);
    }
  }
  return normalized;
}

export function generateCityPlan(
  city: MapCity,
  config: CityGenerationConfig,
  existingLockedBuildings: readonly CityBuilding[] = [],
  entrances: readonly number[] = [],
): CityMap {
  const seed = normalizedSeed(config.seed);
  const density = clamp(finiteOr(config.density, 1), 0.55, 1.4);
  const scale = clamp(finiteOr(config.scale, 1), 0.75, 1.3);
  const connections = normalizedEntrances(entrances);
  const boundary = cityBoundary(config.size, scale, config.cityType);
  const roadDrafts = makeRoadNetwork(
    city.id,
    config.size,
    config.layout,
    config.cityType,
    seed,
    boundary,
    connections,
  );
  const districts = makeDistricts(city.id, config.size, config.cityType, seed, boundary, connections);
  const buildings = makeBuildings(
    city.id,
    config.size,
    config.cityType,
    seed,
    density,
    scale,
    boundary,
    roadDrafts,
    districts,
    existingLockedBuildings,
  );

  return {
    city_id: city.id,
    size_label: config.size,
    width: 1,
    height: 1,
    seed,
    scale,
    road_architecture: config.layout,
    road_theme: config.roadTheme ?? "western",
    external_connections: connections,
    districts,
    roads: finalizeRoads(roadDrafts),
    buildings,
    city_type: config.cityType,
    density,
    schema_version: 2,
  };
}
