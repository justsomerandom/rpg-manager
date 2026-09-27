import type {
  CityBuilding,
  CityDistrict,
  CityLayout,
  CityMap,
  CityRoad,
  CitySize,
  CityTerrainContext,
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
  distancePointToSegment,
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
  {
    key: "capital",
    label: "Capital",
    description: "Ceremonial avenues, civic quarters, and dense mixed wards.",
  },
  {
    key: "trade",
    label: "Trade hub",
    description: "Market-heavy districts gathered around connected thoroughfares.",
  },
  {
    key: "port",
    label: "Port city",
    description: "A harbor quarter backed by commerce, workshops, and housing.",
  },
  {
    key: "fortress",
    label: "Fortress",
    description: "Defensible rings, controlled approaches, and a civic core.",
  },
  {
    key: "industrial",
    label: "Industrial",
    description: "Production districts with direct arterial and freight access.",
  },
  {
    key: "rural",
    label: "Rural settlement",
    description: "A loose, low-rise settlement with green and residential land.",
  },
];

export const CITY_LAYOUT_OPTIONS: ReadonlyArray<{
  key: CityLayout;
  label: string;
  description: string;
}> = [
  {
    key: "organic",
    label: "Organic",
    description: "Curving roads and irregular connectors grown over time.",
  },
  { key: "grid", label: "Grid", description: "Legible blocks with a clear street hierarchy." },
  {
    key: "radial",
    label: "Radial",
    description: "Offset avenues and orbital collectors serving several inner hubs.",
  },
  {
    key: "ring",
    label: "Ring",
    description: "Concentric routes linked by controlled cross-city roads.",
  },
  {
    key: "medieval",
    label: "Medieval core",
    description: "A tight old centre, crooked lanes, later wards, and gate-led growth.",
  },
  {
    key: "market",
    label: "Market town",
    description: "Trade roads widen around a market circuit with irregular back lanes.",
  },
  {
    key: "axial",
    label: "Axial plan",
    description: "A few planned boulevards organize otherwise varied neighborhood streets.",
  },
  {
    key: "garden",
    label: "Garden city",
    description: "Curved neighborhood loops, green wedges, and limited through traffic.",
  },
  {
    key: "canal",
    label: "Canal city",
    description: "Waterside corridors, bridges, and narrow service streets shaped by water.",
  },
  {
    key: "terraced",
    label: "Terraced hillside",
    description: "Contour-following streets joined by sparse steep connectors and stairs.",
  },
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
  {
    key: "village",
    label: "Village",
    description: "A compact settlement with a few local streets.",
    targetBuildings: BUILDING_TARGETS.village,
  },
  {
    key: "town",
    label: "Town",
    description: "Several connected quarters and a developed centre.",
    targetBuildings: BUILDING_TARGETS.town,
  },
  {
    key: "city",
    label: "City",
    description: "A full district network with layered street hierarchy.",
    targetBuildings: BUILDING_TARGETS.city,
  },
  {
    key: "megapolis",
    label: "Metropolis",
    description: "A dense regional centre built for high-level campaigns.",
    targetBuildings: BUILDING_TARGETS.megapolis,
  },
];

export function deriveRecommendedCitySize(population: number): CitySize {
  const safePopulation = Number.isFinite(population) ? Math.max(0, population) : 0;
  if (safePopulation < 1_200) return "village";
  if (safePopulation < 12_000) return "town";
  if (safePopulation < 85_000) return "city";
  return "megapolis";
}

export function recommendedCityLayout(cityType: CityType): CityLayout {
  switch (cityType) {
    case "capital":
      return "axial";
    case "trade":
      return "market";
    case "industrial":
      return "grid";
    case "fortress":
      return "ring";
    case "port":
      return "canal";
    case "rural":
      return "organic";
  }
}

export function cityTypeAvailability(
  cityType: CityType,
  terrain?: CityTerrainContext,
): { available: boolean; reason?: string } {
  if (!terrain) return { available: true };
  if (cityType === "port" && !terrain.coastal) {
    return { available: false, reason: "Requires a coast or navigable waterfront." };
  }
  if (cityType === "fortress" && terrain.elevation < 0.38) {
    return { available: false, reason: "Requires elevated or naturally defensible terrain." };
  }
  return { available: true };
}

export function cityLayoutAvailability(
  layout: CityLayout,
  terrain?: CityTerrainContext,
): { available: boolean; reason?: string } {
  if (!terrain) return { available: true };
  if (layout === "canal" && !terrain.coastal && terrain.moisture < 0.62) {
    return { available: false, reason: "Requires coastal or high-moisture terrain." };
  }
  if (layout === "terraced" && terrain.elevation < 0.5) {
    return { available: false, reason: "Requires substantial elevation." };
  }
  return { available: true };
}

export function recommendedLandmarkCount(size: CitySize, cityType: CityType): number {
  const baseline: Record<CitySize, number> = { village: 1, town: 2, city: 4, megapolis: 7 };
  const modifier: Record<CityType, number> = {
    capital: 2,
    trade: 1,
    port: 1,
    fortress: 1,
    industrial: 0,
    rural: -1,
  };
  return Math.max(0, baseline[size] + modifier[cityType]);
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

type RoadSegmentDraft = {
  roadIndex: number;
  segmentIndex: number;
  a: Point;
  b: Point;
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
  main: [
    "Grand Avenue",
    "King's Road",
    "High Street",
    "Crown Way",
    "Gate Road",
    "Founders' Avenue",
    "Meridian Way",
    "Long Road",
  ],
  secondary: [
    "Market Street",
    "Mill Street",
    "Garden Way",
    "Temple Street",
    "Bridge Lane",
    "Guild Street",
    "Station Road",
    "Lantern Street",
  ],
  alley: [
    "Copper Lane",
    "Willow Lane",
    "Mason's Row",
    "Baker's Row",
    "Ash Walk",
    "Orchard Lane",
    "Wren Close",
    "Old Passage",
  ],
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

function typeAdjustedCount(base: number, cityType: CityType): number {
  const multiplier: Record<CityType, number> = {
    capital: 1.18,
    trade: 1.08,
    port: 1,
    fortress: 0.92,
    industrial: 1.12,
    rural: 0.72,
  };
  return Math.max(3, Math.round(base * multiplier[cityType]));
}

function makeRoadNetwork(
  cityId: string,
  size: CitySize,
  layout: CityLayout,
  cityType: CityType,
  seed: number,
  boundary: EllipseBoundary,
  entranceAngles: readonly number[],
  terrain?: CityTerrainContext,
): RoadDraft[] {
  const rng = new SeededRandom(hashParts(seed, cityId, "roads", layout, cityType));
  const roads: RoadDraft[] = [];
  let roadIndex = 0;
  const addRoad = (
    importance: RoadImportance,
    rawPoints: readonly Point[],
    externalConnectionIndex?: number,
  ) => {
    let shapedPoints = [...rawPoints];
    if (shapedPoints.length === 2) {
      const [start, end] = shapedPoints as [Point, Point];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const segmentLength = Math.max(0.0001, Math.hypot(dx, dy));
      const entropy = importance === "main" ? 0.004 : importance === "secondary" ? 0.008 : 0.012;
      const offset = rng.range(-entropy, entropy);
      shapedPoints = [
        start,
        {
          x: (start.x + end.x) / 2 + (-dy / segmentLength) * offset,
          y: (start.y + end.y) / 2 + (dx / segmentLength) * offset,
        },
        end,
      ];
    }
    const points = cleanPolyline(shapedPoints);
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
  const loopPoints = (
    scale: number,
    samples: number,
    startAngle: number,
    irregularity = 0,
  ): Point[] =>
    Array.from({ length: samples + 1 }, (_, index) => {
      const angle = startAngle + (index / samples) * TAU;
      const wave =
        irregularity > 0
          ? Math.sin(angle * 3 + seed * 0.0001) * irregularity +
            Math.sin(angle * 5 - seed * 0.00013) * irregularity * 0.45
          : 0;
      return pointOnEllipse(boundary, angle, scale + wave);
    });

  if (layout === "grid") {
    const lineCount = typeAdjustedCount([5, 7, 10, 13][level]!, cityType);
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
      const verticalSpan =
        boundary.radiusY * Math.sqrt(Math.max(0.05, 1 - (offsetX / boundary.radiusX) ** 2)) * 0.94;
      const horizontalSpan =
        boundary.radiusX * Math.sqrt(Math.max(0.05, 1 - (offsetY / boundary.radiusY) ** 2)) * 0.94;
      const distanceFromCentre = Math.abs(ratio);
      const importance: RoadImportance =
        distanceFromCentre < 0.12 ? "main" : index % 3 === 1 ? "secondary" : "alley";
      addRoad(importance, [transform(offsetX, -verticalSpan), transform(offsetX, verticalSpan)]);
      addRoad(importance, [
        transform(-horizontalSpan, offsetY),
        transform(horizontalSpan, offsetY),
      ]);
    }
  } else if (layout === "radial") {
    const spokeCount = typeAdjustedCount([6, 8, 11, 14][level]!, cityType);
    const startAngle = rng.range(-Math.PI, Math.PI);
    const innerScale = cityType === "rural" ? 0.2 : 0.16;
    const innerSamples = Math.max(16, spokeCount * 2);
    const innerLoop = loopPoints(innerScale, innerSamples, startAngle, 0.012);
    addRoad("secondary", innerLoop);
    for (let index = 0; index < spokeCount; index += 1) {
      const nominalAngle = startAngle + (index / spokeCount) * TAU;
      const angle = nominalAngle + rng.range(-0.055, 0.055);
      const importance: RoadImportance =
        index % Math.max(2, Math.floor(spokeCount / 4)) === 0 ? "main" : "secondary";
      const inner = innerLoop[Math.round((index / spokeCount) * innerSamples)]!;
      const middle = pointOnEllipse(boundary, angle + rng.range(-0.065, 0.065), 0.54);
      addRoad(importance, chaikinSmooth([inner, middle, pointOnEllipse(boundary, angle, 0.94)], 1));
    }
    const ringCount = Math.max(1, typeAdjustedCount([1, 2, 3, 4][level]!, cityType));
    for (let ring = 1; ring <= ringCount; ring += 1) {
      const scale = innerScale + (ring / (ringCount + 1)) * (0.91 - innerScale);
      const samples = Math.max(18, spokeCount * 2);
      const points = loopPoints(scale, samples, startAngle + ring * 0.035, 0.008);
      addRoad(ring === ringCount ? "main" : ring % 2 === 0 ? "secondary" : "alley", points);
    }
  } else if (layout === "ring") {
    const ringCount = Math.max(2, typeAdjustedCount([2, 3, 5, 6][level]!, cityType));
    const spokeCount = typeAdjustedCount([4, 6, 8, 10][level]!, cityType);
    const startAngle = rng.range(-Math.PI, Math.PI);
    for (let ring = 1; ring <= ringCount; ring += 1) {
      const scale = (ring / ringCount) * 0.91;
      const samples = Math.max(20, spokeCount * 3);
      const points = loopPoints(scale, samples, startAngle + ring * 0.025, 0.006);
      const importance: RoadImportance =
        ring === 1 || ring === ringCount ? "main" : ring % 2 === 0 ? "secondary" : "alley";
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
  } else if (layout === "medieval") {
    const startAngle = rng.range(-Math.PI, Math.PI);
    const gateCount = typeAdjustedCount([4, 5, 7, 9][level]!, cityType);
    const coreLoop = loopPoints(0.16, Math.max(18, gateCount * 3), startAngle, 0.025);
    addRoad("secondary", coreLoop);
    addRoad("alley", loopPoints(0.29, 24, startAngle + 0.08, 0.035));
    addRoad("secondary", loopPoints(0.5, 30, startAngle - 0.05, 0.028));
    for (let index = 0; index < gateCount; index += 1) {
      const angle = startAngle + (index / gateCount) * TAU + rng.range(-0.12, 0.12);
      const inner = coreLoop[Math.round((index / gateCount) * (coreLoop.length - 1))]!;
      const middleA = pointOnEllipse(boundary, angle + rng.range(-0.2, 0.2), 0.38);
      const middleB = pointOnEllipse(boundary, angle + rng.range(-0.12, 0.12), 0.67);
      addRoad(
        index % 3 === 0 ? "main" : "secondary",
        chaikinSmooth([inner, middleA, middleB, pointOnEllipse(boundary, angle, 0.95)], 2),
      );
    }
    const laneCount = [5, 8, 12, 16][level]!;
    for (let index = 0; index < laneCount; index += 1) {
      const angle = startAngle + rng.range(0, TAU);
      const span = rng.range(0.35, 0.8);
      addRoad(
        "alley",
        chaikinSmooth(
          [
            pointOnEllipse(boundary, angle, rng.range(0.2, 0.42)),
            pointOnEllipse(boundary, angle + rng.range(0.18, 0.42), span * 0.72),
            pointOnEllipse(boundary, angle + rng.range(0.3, 0.58), span),
          ],
          1,
        ),
      );
    }
  } else if (layout === "market") {
    const marketAngle = rng.range(-0.22, 0.22);
    const cosine = Math.cos(marketAngle);
    const sine = Math.sin(marketAngle);
    const marketPoint = (angle: number, scale = 1): Point => {
      const x = Math.cos(angle) * boundary.radiusX * 0.34 * scale;
      const y = Math.sin(angle) * boundary.radiusY * 0.19 * scale;
      return { x: center.x + x * cosine - y * sine, y: center.y + x * sine + y * cosine };
    };
    const marketRing = Array.from({ length: 25 }, (_, index) => marketPoint((index / 24) * TAU));
    addRoad("main", marketRing);
    const approachCount = typeAdjustedCount([4, 6, 8, 10][level]!, cityType);
    for (let index = 0; index < approachCount; index += 1) {
      const angle = marketAngle + (index / approachCount) * TAU + rng.range(-0.1, 0.1);
      const inner = marketRing[Math.round((index / approachCount) * 24)]!;
      addRoad(
        index % 3 === 0 ? "main" : "secondary",
        chaikinSmooth(
          [
            inner,
            pointOnEllipse(boundary, angle + rng.range(-0.1, 0.1), 0.55),
            pointOnEllipse(boundary, angle, 0.95),
          ],
          1,
        ),
      );
    }
    addRoad("secondary", loopPoints(0.58, 28, marketAngle, 0.025));
    addRoad("alley", loopPoints(0.78, 32, marketAngle + 0.04, 0.02));
  } else if (layout === "axial") {
    const axisAngle = rng.range(-0.32, 0.32);
    const axisCount = level >= 2 ? 3 : 2;
    for (let axis = 0; axis < axisCount; axis += 1) {
      const angle = axisAngle + (axis * Math.PI) / Math.max(2, axisCount);
      const offset = axis === 0 ? 0 : rng.range(-0.05, 0.05);
      const perpendicular = angle + Math.PI / 2;
      const origin = {
        x: center.x + Math.cos(perpendicular) * offset,
        y: center.y + Math.sin(perpendicular) * offset,
      };
      const span = Math.max(boundary.radiusX, boundary.radiusY) * 0.92;
      addRoad("main", [
        { x: origin.x - Math.cos(angle) * span, y: origin.y - Math.sin(angle) * span },
        { x: origin.x + Math.cos(angle) * span, y: origin.y + Math.sin(angle) * span },
      ]);
    }
    const crossCount = typeAdjustedCount([5, 7, 10, 13][level]!, cityType);
    for (let index = 0; index < crossCount; index += 1) {
      const ratio = (index / Math.max(1, crossCount - 1)) * 1.5 - 0.75;
      const offset = ratio * boundary.radiusX;
      const along = { x: Math.cos(axisAngle), y: Math.sin(axisAngle) };
      const across = { x: -along.y, y: along.x };
      const origin = { x: center.x + along.x * offset, y: center.y + along.y * offset };
      const span = boundary.radiusY * rng.range(0.42, 0.78);
      addRoad(index % 3 === 1 ? "secondary" : "alley", [
        { x: origin.x - across.x * span, y: origin.y - across.y * span },
        { x: origin.x + across.x * span, y: origin.y + across.y * span },
      ]);
    }
  } else if (layout === "garden") {
    const neighborhoodCount = [3, 4, 6, 8][level]!;
    const startAngle = rng.range(-Math.PI, Math.PI);
    const neighborhoodEntries: Point[] = [];
    const innerLoop = loopPoints(0.2, 20, startAngle, 0.018);
    addRoad("secondary", innerLoop);
    for (let index = 0; index < neighborhoodCount; index += 1) {
      const angle = startAngle + (index / neighborhoodCount) * TAU + rng.range(-0.12, 0.12);
      const hub = pointOnEllipse(boundary, angle, rng.range(0.46, 0.66));
      const radiusX = boundary.radiusX * rng.range(0.12, 0.18);
      const radiusY = boundary.radiusY * rng.range(0.1, 0.15);
      const neighborhoodLoop = cleanPolyline(
        Array.from({ length: 17 }, (_, pointIndex) => {
          const loopAngle = (pointIndex / 16) * TAU;
          return {
            x: hub.x + Math.cos(loopAngle) * radiusX,
            y: hub.y + Math.sin(loopAngle) * radiusY,
          };
        }),
      );
      const entryAngle =
        (Math.atan2(Math.sin(angle + Math.PI), Math.cos(angle + Math.PI)) + TAU) % TAU;
      const entryIndex = Math.round((entryAngle / TAU) * 16);
      neighborhoodEntries.push(neighborhoodLoop[entryIndex]!);
      addRoad(index % 3 === 0 ? "secondary" : "alley", neighborhoodLoop);
    }
    neighborhoodEntries.forEach((entry, index) => {
      const next = neighborhoodEntries[(index + 1) % neighborhoodEntries.length]!;
      const inner = innerLoop[Math.round((index / neighborhoodEntries.length) * 20)]!;
      const control = pointOnEllipse(
        boundary,
        startAngle + ((index + 0.5) / neighborhoodEntries.length) * TAU,
        0.38,
      );
      addRoad("secondary", chaikinSmooth([inner, control, entry], 1));
      addRoad(index % 2 === 0 ? "main" : "secondary", chaikinSmooth([entry, control, next], 2));
    });
  } else if (layout === "canal") {
    const coastAngle =
      terrain?.coastal && Number.isFinite(terrain.coast_angle)
        ? terrain.coast_angle!
        : rng.range(-Math.PI, Math.PI);
    const corridorAngle = coastAngle + Math.PI / 2;
    const along = { x: Math.cos(corridorAngle), y: Math.sin(corridorAngle) };
    const across = { x: -along.y, y: along.x };
    const corridorCount = [3, 4, 6, 8][level]!;
    for (let index = 0; index < corridorCount; index += 1) {
      const ratio = (index / Math.max(1, corridorCount - 1)) * 1.25 - 0.75;
      const origin = {
        x: center.x + across.x * boundary.radiusY * ratio,
        y: center.y + across.y * boundary.radiusY * ratio,
      };
      const span = Math.max(boundary.radiusX, boundary.radiusY) * rng.range(0.68, 0.9);
      const bend = rng.range(-0.035, 0.035);
      addRoad(index % 3 === 0 ? "main" : "secondary", [
        { x: origin.x - along.x * span, y: origin.y - along.y * span },
        { x: origin.x + across.x * bend, y: origin.y + across.y * bend },
        { x: origin.x + along.x * span, y: origin.y + along.y * span },
      ]);
    }
    const bridgeCount = [3, 4, 5, 7][level]!;
    for (let index = 0; index < bridgeCount; index += 1) {
      const ratio = (index / Math.max(1, bridgeCount - 1)) * 1.4 - 0.7;
      const origin = {
        x: center.x + along.x * boundary.radiusX * ratio,
        y: center.y + along.y * boundary.radiusX * ratio,
      };
      const span = boundary.radiusY * rng.range(0.55, 0.82);
      addRoad(index % 2 === 0 ? "secondary" : "alley", [
        { x: origin.x - across.x * span, y: origin.y - across.y * span },
        { x: origin.x + across.x * span, y: origin.y + across.y * span },
      ]);
    }
  } else if (layout === "terraced") {
    const slopeAngle =
      terrain?.coastal && Number.isFinite(terrain.coast_angle)
        ? terrain.coast_angle! + Math.PI
        : rng.range(-Math.PI, Math.PI);
    const terraceCount = typeAdjustedCount([4, 6, 8, 11][level]!, cityType);
    addRoad("main", [
      pointOnEllipse(boundary, slopeAngle, 0.1),
      pointOnEllipse(boundary, slopeAngle + rng.range(-0.035, 0.035), 0.96),
    ]);
    for (let terrace = 1; terrace <= terraceCount; terrace += 1) {
      const scale = 0.14 + (terrace / terraceCount) * 0.78;
      const span = Math.PI * rng.range(0.9, 1.45);
      const start = slopeAngle - span / 2 + rng.range(-0.08, 0.08);
      const samples = Math.max(8, Math.round(span / 0.13));
      addRoad(
        terrace % 3 === 0 ? "secondary" : "alley",
        Array.from({ length: samples + 1 }, (_, index) =>
          pointOnEllipse(
            boundary,
            start + (index / samples) * span,
            scale + Math.sin(index * 0.7) * 0.006,
          ),
        ),
      );
    }
    const connectorCount = [3, 4, 6, 7][level]!;
    for (let index = 0; index < connectorCount; index += 1) {
      const angle = slopeAngle + Math.PI / 2 + (index / connectorCount) * Math.PI;
      addRoad(
        index % 3 === 0 ? "main" : "secondary",
        chaikinSmooth(
          [
            pointOnEllipse(boundary, angle + rng.range(-0.08, 0.08), 0.16),
            pointOnEllipse(boundary, angle + rng.range(-0.05, 0.05), 0.52),
            pointOnEllipse(boundary, angle, 0.94),
          ],
          1,
        ),
      );
    }
  } else {
    const arterialCount = typeAdjustedCount([4, 6, 8, 10][level]!, cityType);
    const startAngle = rng.range(-Math.PI, Math.PI);
    const arterialAngles: number[] = [];
    const arterialPaths: Point[][] = [];
    const innerSamples = Math.max(16, arterialCount * 2);
    const innerLoop = loopPoints(0.16, innerSamples, startAngle, 0.024);
    addRoad("secondary", innerLoop);
    for (let index = 0; index < arterialCount; index += 1) {
      const angle = startAngle + (index / arterialCount) * TAU + rng.range(-0.13, 0.13);
      arterialAngles.push(angle);
      const hub = innerLoop[Math.round((index / arterialCount) * innerSamples)]!;
      const controlA = pointOnEllipse(boundary, angle + rng.range(-0.18, 0.18), 0.3);
      const controlB = pointOnEllipse(boundary, angle + rng.range(-0.12, 0.12), 0.62);
      const smoothed = chaikinSmooth(
        [hub, controlA, controlB, pointOnEllipse(boundary, angle, 0.94)],
        2,
      );
      arterialPaths.push(smoothed);
      addRoad(index % 3 === 0 ? "main" : "secondary", smoothed);
    }
    const branchLayers = Math.max(
      1,
      Math.round([1, 2, 3, 4][level]! * (cityType === "rural" ? 0.7 : 1)),
    );
    for (let layer = 0; layer < branchLayers; layer += 1) {
      const scale = 0.3 + layer * (0.54 / Math.max(1, branchLayers - 1));
      for (let index = 0; index < arterialAngles.length; index += 1) {
        const angle = arterialAngles[index]!;
        const nextAngle = arterialAngles[(index + 1) % arterialAngles.length]!;
        const startPath = arterialPaths[index]!;
        const endPath = arterialPaths[(index + 1) % arterialPaths.length]!;
        const start = startPath[Math.round(clamp(scale / 0.94) * (startPath.length - 1))]!;
        const end =
          endPath[
            Math.round(clamp((scale + rng.range(-0.025, 0.025)) / 0.94) * (endPath.length - 1))
          ]!;
        const middleAngle =
          angle + Math.atan2(Math.sin(nextAngle - angle), Math.cos(nextAngle - angle)) / 2;
        const control = pointOnEllipse(
          boundary,
          middleAngle + rng.range(-0.08, 0.08),
          scale + rng.range(-0.035, 0.04),
        );
        addRoad(
          layer === branchLayers - 1 ? "secondary" : "alley",
          chaikinSmooth([start, control, end], 2),
        );
      }
    }
  }

  // Each settlement type gets a recognizable structural layer regardless of the selected layout.
  if (cityType === "capital") {
    const avenueAngle = rng.range(-0.18, 0.18);
    const perpendicular = avenueAngle + Math.PI / 2;
    const avenueCentre = {
      x: center.x + Math.cos(perpendicular) * boundary.radiusX * 0.06,
      y: center.y + Math.sin(perpendicular) * boundary.radiusY * 0.06,
    };
    const span = Math.max(boundary.radiusX, boundary.radiusY) * 0.9;
    addRoad("main", [
      {
        x: avenueCentre.x - Math.cos(avenueAngle) * span,
        y: avenueCentre.y - Math.sin(avenueAngle) * span,
      },
      {
        x: avenueCentre.x + Math.cos(avenueAngle) * span,
        y: avenueCentre.y + Math.sin(avenueAngle) * span,
      },
    ]);
    addRoad("secondary", loopPoints(0.25, 24, avenueAngle, 0.008));
  } else if (cityType === "trade") {
    const marketRing = Array.from({ length: 25 }, (_, index) =>
      pointOnEllipse(boundary, (index / 24) * TAU, 0.3),
    );
    addRoad("main", marketRing);
  } else if (cityType === "fortress") {
    const defensiveRing = Array.from({ length: 37 }, (_, index) =>
      pointOnEllipse(boundary, (index / 36) * TAU, 0.96),
    );
    addRoad("main", defensiveRing);
  } else if (cityType === "industrial") {
    const freightAngle = rng.range(-0.16, 0.16);
    for (const [index, offset] of [-0.28, 0.08, 0.32].entries()) {
      const perpendicular = freightAngle + Math.PI / 2;
      const origin = {
        x: center.x + Math.cos(perpendicular) * boundary.radiusX * offset,
        y: center.y + Math.sin(perpendicular) * boundary.radiusY * offset,
      };
      const span = Math.max(boundary.radiusX, boundary.radiusY) * 0.9;
      addRoad(index === 1 ? "main" : "secondary", [
        {
          x: origin.x - Math.cos(freightAngle) * span,
          y: origin.y - Math.sin(freightAngle) * span,
        },
        {
          x: origin.x + Math.cos(freightAngle) * span,
          y: origin.y + Math.sin(freightAngle) * span,
        },
      ]);
    }
  } else if (cityType === "port") {
    const coastAngle =
      terrain?.coastal && Number.isFinite(terrain.coast_angle)
        ? terrain.coast_angle!
        : (entranceAngles[0] ?? -Math.PI / 2);
    const waterfront = Array.from({ length: 17 }, (_, index) =>
      pointOnEllipse(boundary, coastAngle - Math.PI * 0.52 + (index / 16) * Math.PI * 1.04, 0.82),
    );
    addRoad("main", waterfront);
    addRoad("main", [
      pointOnEllipse(boundary, coastAngle, 0.94),
      pointOnEllipse(boundary, coastAngle + rng.range(-0.12, 0.12), 0.18),
    ]);
  }

  entranceAngles.forEach((angle, entranceIndex) => {
    const outer = pointOnEllipse(boundary, angle, 0.995);
    const approach = pointOnEllipse(boundary, angle + rng.range(-0.035, 0.035), 0.72);
    const inner = pointOnEllipse(boundary, angle + rng.range(-0.08, 0.08), 0.3);
    const localHub = pointOnEllipse(boundary, angle + rng.range(-0.16, 0.16), 0.16);
    addRoad("main", chaikinSmooth([outer, approach, inner, localHub], 1), entranceIndex);
  });

  return roads;
}

function segmentIntersection(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): { point: Point; firstAmount: number; secondAmount: number } | null {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const cdX = d.x - c.x;
  const cdY = d.y - c.y;
  const denominator = abX * cdY - abY * cdX;
  if (Math.abs(denominator) < 1e-10) return null;
  const acX = c.x - a.x;
  const acY = c.y - a.y;
  const firstAmount = (acX * cdY - acY * cdX) / denominator;
  const secondAmount = (acX * abY - acY * abX) / denominator;
  const epsilon = 1e-7;
  if (
    firstAmount < -epsilon ||
    firstAmount > 1 + epsilon ||
    secondAmount < -epsilon ||
    secondAmount > 1 + epsilon
  ) {
    return null;
  }
  const x = Math.round((a.x + abX * clamp(firstAmount)) * 1_000_000) / 1_000_000;
  const y = Math.round((a.y + abY * clamp(firstAmount)) * 1_000_000) / 1_000_000;
  return {
    point: { x, y },
    firstAmount: clamp(firstAmount),
    secondAmount: clamp(secondAmount),
  };
}

/** Inserts identical nodes into every road that crosses another road. */
export function planarizeRoadNetwork(roads: readonly RoadDraft[]): RoadDraft[] {
  const index = new SpatialHash<RoadSegmentDraft>(0.045);
  const splits = roads.map((road) =>
    road.points.slice(0, -1).map(() => [] as Array<{ amount: number; point: Point }>),
  );

  roads.forEach((road, roadIndex) => {
    for (let segmentIndex = 0; segmentIndex < road.points.length - 1; segmentIndex += 1) {
      const a = road.points[segmentIndex]!;
      const b = road.points[segmentIndex + 1]!;
      const segment: RoadSegmentDraft = { roadIndex, segmentIndex, a, b };
      const bounds = segmentBounds(a, b, 0.000001);
      for (const other of index.query(bounds)) {
        if (other.roadIndex === roadIndex) continue;
        const intersection = segmentIntersection(a, b, other.a, other.b);
        if (!intersection) continue;
        splits[roadIndex]![segmentIndex]!.push({
          amount: intersection.firstAmount,
          point: intersection.point,
        });
        splits[other.roadIndex]![other.segmentIndex]!.push({
          amount: intersection.secondAmount,
          point: intersection.point,
        });
      }
      index.insert(segment, bounds);
    }
  });

  return roads.map((road, roadIndex) => {
    const points: Point[] = [];
    for (let segmentIndex = 0; segmentIndex < road.points.length - 1; segmentIndex += 1) {
      const a = road.points[segmentIndex]!;
      const b = road.points[segmentIndex + 1]!;
      const candidates = [
        { amount: 0, point: a },
        ...splits[roadIndex]![segmentIndex]!,
        { amount: 1, point: b },
      ].sort((left, right) => left.amount - right.amount);
      for (const candidate of candidates) {
        const previous = points[points.length - 1];
        if (!previous || distance(previous, candidate.point) > 0.000001)
          points.push(candidate.point);
      }
    }
    return { ...road, points };
  });
}

function nearestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return a;
  const amount = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared);
  return { x: a.x + dx * amount, y: a.y + dy * amount };
}

export function connectCityRoadNetwork(
  roads: readonly CityRoad[],
  targetRoadId: string,
): CityRoad[] {
  const target = roads.find((road) => road.id === targetRoadId);
  if (!target || target.points.length < 2) return [...roads];
  const snappedPoints = target.points.map((point) => ({ x: point.x, y: point.y }));
  for (const endpointIndex of [0, snappedPoints.length - 1]) {
    const endpoint = snappedPoints[endpointIndex]!;
    let nearest: Point | null = null;
    let nearestDistance = 0.025;
    for (const road of roads) {
      if (road.id === targetRoadId) continue;
      for (let index = 1; index < road.points.length; index += 1) {
        const a = road.points[index - 1]!;
        const b = road.points[index]!;
        const candidateDistance = distancePointToSegment(endpoint, a, b);
        if (candidateDistance >= nearestDistance) continue;
        nearestDistance = candidateDistance;
        nearest = nearestPointOnSegment(endpoint, a, b);
      }
    }
    if (nearest) snappedPoints[endpointIndex] = nearest;
  }

  const drafts: RoadDraft[] = roads.map((road) => ({
    id: road.id,
    name: road.name,
    importance: road.importance,
    tier: road.tier ?? 2,
    externalConnectionIndex: road.external_connection_index ?? undefined,
    points:
      road.id === targetRoadId
        ? snappedPoints
        : road.points.map((point) => ({ x: point.x, y: point.y })),
  }));
  const connected = planarizeRoadNetwork(drafts);
  return connected.map((draft, roadIndex) => ({
    ...roads[roadIndex]!,
    points: draft.points.map((point, pointIndex) => ({
      id: stableCityRoadPointId(draft.id, pointIndex),
      x: point.x,
      y: point.y,
    })),
  }));
}

export type BuildingPlacementResult =
  { valid: true; districtId?: string } | { valid: false; reason: string };

export function evaluateBuildingPlacement(
  map: CityMap,
  candidate: CityBuilding,
  ignoreBuildingId?: string,
): BuildingPlacementResult {
  const rectangle = rectangleForBuilding(candidate);
  if (!rectangle) return { valid: false, reason: "The building dimensions are invalid." };
  const boundary = cityBoundary(map.size_label, map.scale ?? 1, map.city_type ?? "trade");
  if (!rectangleInsideEllipse(rectangle, boundary, 0.005)) {
    return { valid: false, reason: "Buildings must stay inside the settlement boundary." };
  }
  const { spatialIndex } = indexRoadSegments(
    map.roads.map((road) => ({
      id: road.id,
      name: road.name,
      importance: road.importance,
      tier: road.tier ?? 2,
      points: road.points,
    })),
  );
  if (!clearsRoads(rectangle, spatialIndex)) {
    return { valid: false, reason: "That footprint overlaps a road corridor." };
  }
  for (const building of map.buildings) {
    if (building.id === ignoreBuildingId) continue;
    const other = rectangleForBuilding(building);
    if (other && rectanglesOverlap(rectangle, other, 0.0014)) {
      return { valid: false, reason: `That footprint overlaps ${building.name}.` };
    }
  }
  if (map.terrain?.coastal && Number.isFinite(map.terrain.coast_angle)) {
    const coastX = Math.cos(map.terrain.coast_angle!);
    const coastY = Math.sin(map.terrain.coast_angle!);
    const normalizedX = (rectangle.x - boundary.x) / boundary.radiusX;
    const normalizedY = (rectangle.y - boundary.y) / boundary.radiusY;
    if (normalizedX * coastX + normalizedY * coastY > 0.82) {
      return { valid: false, reason: "Buildings cannot be placed in the water." };
    }
  }
  const point = { x: rectangle.x, y: rectangle.y };
  const district = map.districts?.find((item) => {
    const polygon =
      item.points && item.points.length >= 3
        ? item.points
        : Array.from({ length: 24 }, (_, index) => ({
            x: item.x + Math.cos((index / 24) * TAU) * item.radius,
            y: item.y + Math.sin((index / 24) * TAU) * item.radius,
          }));
    return polygonContainsPoint(point, polygon);
  });
  return { valid: true, districtId: district?.id };
}

type WeightedKind = readonly [DistrictKind, number];

const DISTRICT_WEIGHTS: Record<CityType, readonly WeightedKind[]> = {
  capital: [
    ["civic", 3],
    ["commercial", 2],
    ["residential", 4],
    ["mixed", 3],
    ["green", 1],
    ["industrial", 1],
  ],
  trade: [
    ["commercial", 4],
    ["residential", 3],
    ["mixed", 3],
    ["industrial", 2],
    ["civic", 1],
    ["green", 1],
  ],
  port: [
    ["harbor", 3],
    ["commercial", 3],
    ["industrial", 2],
    ["residential", 3],
    ["mixed", 2],
    ["civic", 1],
  ],
  fortress: [
    ["civic", 3],
    ["residential", 3],
    ["industrial", 2],
    ["mixed", 2],
    ["green", 1],
    ["commercial", 1],
  ],
  industrial: [
    ["industrial", 5],
    ["residential", 3],
    ["commercial", 2],
    ["mixed", 2],
    ["civic", 1],
    ["green", 1],
  ],
  rural: [
    ["residential", 4],
    ["green", 4],
    ["mixed", 3],
    ["commercial", 1],
    ["civic", 1],
    ["industrial", 1],
  ],
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
  terrain?: CityTerrainContext,
): GeneratedDistrict[] {
  const rng = new SeededRandom(hashParts(seed, cityId, "districts", cityType));
  const totalCount = [4, 7, 10, 14][SIZE_ORDER[size]]!;
  const centralScale = cityType === "rural" ? 0.19 : cityType === "capital" ? 0.27 : 0.23;
  const centralKind: DistrictKind =
    cityType === "industrial"
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
  const harborAngle =
    terrain?.coastal && Number.isFinite(terrain.coast_angle)
      ? terrain.coast_angle!
      : (entranceAngles[0] ?? originAngle);
  let harborAssigned = cityType !== "port";
  for (let index = 0; index < outerCount; index += 1) {
    const startAngle = originAngle + (index / outerCount) * TAU + 0.009;
    const endAngle = originAngle + ((index + 1) / outerCount) * TAU - 0.009;
    const middleAngle = (startAngle + endAngle) / 2;
    const harborDifference = Math.abs(
      Math.atan2(Math.sin(middleAngle - harborAngle), Math.cos(middleAngle - harborAngle)),
    );
    const kind =
      !harborAssigned && harborDifference <= Math.PI / Math.max(3, outerCount)
        ? "harbor"
        : weightedDistrictKind(rng, cityType);
    if (kind === "harbor") harborAssigned = true;
    addDistrict(
      kind,
      createDistrictPolygon(boundary, startAngle, endAngle, centralScale * 1.08, 0.93),
    );
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
      const segment: IndexedRoadSegment = {
        a,
        b,
        corridor,
        importance: road.importance,
        length: segmentLength,
      };
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
  return roadIndex
    .query(rectangleBounds(rectangle, 0.012))
    .every(
      (segment) =>
        distanceSegmentToRectangle(segment.a, segment.b, rectangle) >
        segment.corridor + extraClearance,
    );
}

function findDistrict(point: Point, districts: readonly GeneratedDistrict[]): GeneratedDistrict {
  const containing = districts.find((district) => polygonContainsPoint(point, district.points));
  if (containing) return containing;
  return districts.reduce(
    (nearest, district) =>
      distance(point, district) < distance(point, nearest) ? district : nearest,
    districts[0]!,
  );
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

const CIVIC_BUILDING_NAMES: Record<CityType, readonly string[]> = {
  capital: [
    "Assembly Hall",
    "High Court",
    "City Archive",
    "Central Watch House",
    "Public Baths",
    "Civic Granary",
  ],
  trade: [
    "Guildhall",
    "Weigh House",
    "Customs Office",
    "Market Court",
    "Caravan Office",
    "Town Watch",
  ],
  port: [
    "Harbourmaster's Office",
    "Customs House",
    "Dock Watch",
    "Sailors' Chapel",
    "Tide Hall",
    "Rescue Station",
  ],
  fortress: [
    "Garrison Hall",
    "Armoury",
    "Command House",
    "Gate Watch",
    "Infirmary",
    "Supply Office",
  ],
  industrial: [
    "Works Office",
    "Safety Hall",
    "Guild Registry",
    "Fire Watch",
    "Public Infirmary",
    "Workers' Hall",
  ],
  rural: [
    "Meeting Hall",
    "Village Shrine",
    "Common Granary",
    "Well House",
    "Parish House",
    "Village Watch",
  ],
};

function generatedBuildingName(kind: BuildingKind, cityType: CityType, count: number): string {
  if (kind !== "civic") {
    return `${kind[0]!.toUpperCase()}${kind.slice(1)} ${String(count).padStart(3, "0")}`;
  }
  const names = CIVIC_BUILDING_NAMES[cityType];
  const baseName = names[(count - 1) % names.length]!;
  const cycle = Math.floor((count - 1) / names.length);
  return cycle === 0 ? baseName : `${baseName} ${cycle + 1}`;
}

function chooseBuildingKind(
  rng: SeededRandom,
  districtKind: DistrictKind,
  cityType: CityType,
): BuildingKind {
  const base = BUILDING_WEIGHTS[districtKind];
  const modifiers = TYPE_BUILDING_MODIFIERS[cityType];
  // Landmarks are deliberate campaign content. Generation reserves a recommendation but never
  // invents named locations that a game master did not choose.
  const entries = (Object.keys(base) as BuildingKind[])
    .filter((kind) => kind !== "landmark")
    .map((kind) => [kind, base[kind] * (modifiers[kind] ?? 1)] as const);
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
    if (
      !rectangle ||
      !rectangleInsideEllipse(rectangle, boundary, 0.006) ||
      !clearsRoads(rectangle, roadIndex)
    )
      continue;
    const bounds = rectangleBounds(rectangle, 0.0028);
    const overlaps = buildingIndex
      .query(bounds)
      .some((other) => rectanglesOverlap(rectangle, other.rectangle, 0.0014));
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
  terrain?: CityTerrainContext,
): CityBuilding[] {
  const rng = new SeededRandom(
    hashParts(seed, cityId, "buildings", size, cityType, density, scale),
  );
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
    if (terrain?.coastal && Number.isFinite(terrain.coast_angle)) {
      const coastX = Math.cos(terrain.coast_angle!);
      const coastY = Math.sin(terrain.coast_angle!);
      const normalizedX = (rectangle.x - boundary.x) / boundary.radiusX;
      const normalizedY = (rectangle.y - boundary.y) / boundary.radiusY;
      if (normalizedX * coastX + normalizedY * coastY > 0.82) continue;
    }
    if (!rectangleInsideEllipse(rectangle, boundary, 0.005)) continue;
    if (!polygonContainsPoint({ x: rectangle.x, y: rectangle.y }, district.points)) continue;
    if (!clearsRoads(rectangle, roadIndex)) continue;
    const paddedBounds = rectangleBounds(rectangle, 0.0027);
    const overlaps = buildingIndex
      .query(paddedBounds)
      .some((other) => rectanglesOverlap(rectangle, other.rectangle, 0.00135));
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
      name: generatedBuildingName(kind, cityType, kindCounters[kind]),
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
    if (
      normalized.every(
        (existing) =>
          Math.abs(Math.atan2(Math.sin(existing - angle), Math.cos(existing - angle))) > 0.035,
      )
    ) {
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
  terrain?: CityTerrainContext,
): CityMap {
  const seed = normalizedSeed(config.seed);
  const density = clamp(finiteOr(config.density, 1), 0.55, 1.4);
  const scale = clamp(finiteOr(config.scale, 1), 0.75, 1.3);
  const connections = normalizedEntrances(entrances);
  const boundary = cityBoundary(config.size, scale, config.cityType);
  const roadDrafts = planarizeRoadNetwork(
    makeRoadNetwork(
      city.id,
      config.size,
      config.layout,
      config.cityType,
      seed,
      boundary,
      connections,
      terrain,
    ),
  );
  const districts = makeDistricts(
    city.id,
    config.size,
    config.cityType,
    seed,
    boundary,
    connections,
    terrain,
  );
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
    terrain,
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
    terrain,
    districts,
    roads: finalizeRoads(roadDrafts),
    buildings,
    city_type: config.cityType,
    density,
    schema_version: 2,
  };
}
