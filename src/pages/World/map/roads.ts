import { computeBiome } from "./biome";
import { clamp, pseudoRandom } from "./math";
import type { Biome, MapStateExtended, NetworkAnchor, PixelPoint } from "./types";

/**
 * Tuning knobs for the world-road router. All distance values are measured in
 * map cells, while relief/grade values use the map's normalized 0..1 scale.
 */
export type RoadRoutingOptions = {
  /** Overrides the map seed for deterministic natural variation. */
  seed?: number;
  /** Longest continuous water crossing the router may consider. */
  maxBridgeCells?: number;
  /** Cost multiplier for changes in relief between adjacent cells. */
  slopePenalty?: number;
  /** Cost multiplier for terrain above highAltitudeThreshold. */
  highAltitudePenalty?: number;
  /** Normalized relief at which the high-altitude penalty begins. */
  highAltitudeThreshold?: number;
  /** Cost multiplier for dense vegetation. */
  vegetationPenalty?: number;
  /** Cost multiplier for biome-specific traversal difficulty. */
  biomePenalty?: number;
  /** Cost of each cell in a bridge run. */
  bridgePenalty?: number;
  /** Cost of changing heading, discouraging mechanical zig-zags. */
  turnPenalty?: number;
  /** Base-cost discount when travelling directly on an existing road. */
  existingRoadReward?: number;
  /** Base-cost discount near, but not on, an existing road. */
  existingRoadProximityReward?: number;
  /** Radius in cells in which existing roads attract a new route. */
  existingRoadProximityCells?: number;
  /** Deterministic variation applied to otherwise equivalent terrain. */
  naturalVariation?: number;
  /** Optional normalized polyline that should guide, but not force, a route. */
  guidePoints?: readonly PixelPoint[];
  /** Width of the no-penalty guide corridor in cells. */
  guideCorridorCells?: number;
  /** Cost of moving away from the guide corridor. */
  guideAttraction?: number;
  /** Hard expansion budget for one A* search. */
  maxSearchNodes?: number;
  /** Distance between routed anchors when normalizing a freehand stroke. */
  freehandSampleSpacingCells?: number;
  /** RDP simplification tolerance used on normalized freehand roads. */
  freehandSimplifyToleranceCells?: number;
};

export type RoadRouteResult = {
  points: PixelPoint[];
  distanceCells: number;
  maxGrade: number;
  bridgeCells: number;
  warnings: string[];
  usedFallback: boolean;
};

type ResolvedRoadRoutingOptions = {
  seed: number;
  maxBridgeCells: number;
  slopePenalty: number;
  highAltitudePenalty: number;
  highAltitudeThreshold: number;
  vegetationPenalty: number;
  biomePenalty: number;
  bridgePenalty: number;
  turnPenalty: number;
  existingRoadReward: number;
  existingRoadProximityReward: number;
  existingRoadProximityCells: number;
  naturalVariation: number;
  guidePoints: PixelPoint[];
  guideCorridorCells: number;
  guideAttraction: number;
  maxSearchNodes: number;
  freehandSampleSpacingCells: number;
  freehandSimplifyToleranceCells: number;
};

type RoutingContext = {
  map: MapStateExtended;
  width: number;
  height: number;
  cellCount: number;
  relief: Float32Array;
  vegetation: Float32Array;
  water: Uint8Array;
  invalidTerrain: Uint8Array;
  biomeCost: Float32Array;
  roadDistance: Float32Array | null;
  options: ResolvedRoadRoutingOptions;
};

type SearchNode = {
  stateId: number;
  x: number;
  y: number;
  direction: number;
  waterRun: number;
  g: number;
  score: number;
};

type SearchOutcome = {
  points: PixelPoint[] | null;
  warning?: string;
};

type TraversalAnalysis = {
  bridgeCells: number;
  maxWaterRun: number;
  maxGrade: number;
  maxRelief: number;
};

const SQRT_2 = Math.SQRT2;
const EPSILON = 1e-9;
const MAX_FREEHAND_ANCHORS = 128;
// Weighted A* keeps interactive routes responsive. The value remains below the
// normal cost of open terrain, while allowing an existing-road discount to win.
const HEURISTIC_STEP_COST = 0.68;
const HEURISTIC_WEIGHT = 1.12;

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

const BIOME_TRAVERSAL_COST: Record<Biome, number> = {
  ocean: 4.5,
  shallow: 3.2,
  reef: 4,
  beach: 0.18,
  mangrove: 3.4,
  wetland: 2.8,
  plains: 0,
  meadow: 0.05,
  forest: 0.75,
  rainforest: 1.65,
  boreal_forest: 0.95,
  hilly_forest: 1.15,
  jungle: 1.9,
  swamp: 3.1,
  fen: 2.25,
  savanna: 0.28,
  steppe: 0.12,
  badlands: 1.1,
  desert: 0.72,
  crystal_desert: 1.25,
  salt_flat: 0.08,
  tundra: 0.8,
  icy_plains: 1.1,
  glacier: 2.8,
  mountain: 3.8,
  highland: 1.7,
  hills: 0.85,
  basalt_fields: 2.4,
  lava_lake: 16,
  obsidian_ridge: 5,
  hot_springs: 1.9,
  volcanic_forest: 1.45,
  snow: 2.1,
};

function isFinitePoint(point: PixelPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointsEqual(a: PixelPoint, b: PixelPoint, epsilon = EPSILON): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

function sanitizePoint(point: PixelPoint): { point: PixelPoint; changed: boolean } {
  const finiteX = Number.isFinite(point.x) ? point.x : 0.5;
  const finiteY = Number.isFinite(point.y) ? point.y : 0.5;
  const safe = { x: clamp(finiteX, 0, 1), y: clamp(finiteY, 0, 1) };
  return {
    point: safe,
    changed: !Number.isFinite(point.x) || !Number.isFinite(point.y) || safe.x !== point.x || safe.y !== point.y,
  };
}

function sanitizeBoundedPolyline(points: readonly PixelPoint[]): {
  points: PixelPoint[];
  changed: boolean;
} {
  const safe: PixelPoint[] = [];
  let changed = false;
  for (const candidate of points) {
    if (!isFinitePoint(candidate)) {
      changed = true;
      continue;
    }
    const point = { x: clamp(candidate.x, 0, 1), y: clamp(candidate.y, 0, 1) };
    if (point.x !== candidate.x || point.y !== candidate.y) changed = true;
    if (!safe.length || !pointsEqual(safe[safe.length - 1], point)) safe.push(point);
    else changed = true;
  }
  return { points: safe, changed };
}

function squaredDistanceToSegment(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const px = point.x - (start.x + dx * t);
  const py = point.y - (start.y + dy * t);
  return px * px + py * py;
}

/**
 * Simplifies a polyline using Ramer-Douglas-Peucker. The tolerance is in the
 * same coordinate space as the provided points. Non-finite points are ignored.
 */
export function simplifyPolyline(
  points: readonly PixelPoint[],
  tolerance: number
): PixelPoint[] {
  const finitePoints = points.filter(isFinitePoint).map((point) => ({ ...point }));
  if (finitePoints.length <= 2 || !Number.isFinite(tolerance) || tolerance <= 0) {
    return finitePoints;
  }

  const keep = new Uint8Array(finitePoints.length);
  keep[0] = 1;
  keep[finitePoints.length - 1] = 1;
  const toleranceSquared = tolerance * tolerance;
  const stack: Array<readonly [number, number]> = [[0, finitePoints.length - 1]];

  while (stack.length) {
    const segment = stack.pop();
    if (!segment) break;
    const [startIndex, endIndex] = segment;
    let furthestIndex = -1;
    let furthestDistance = toleranceSquared;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = squaredDistanceToSegment(
        finitePoints[index],
        finitePoints[startIndex],
        finitePoints[endIndex]
      );
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = index;
      }
    }
    if (furthestIndex >= 0) {
      keep[furthestIndex] = 1;
      stack.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
    }
  }

  return finitePoints.filter((_, index) => keep[index] === 1);
}

/**
 * Resamples a polyline at approximately uniform spacing. The spacing is in the
 * same coordinate space as the points, and both original endpoints are kept.
 */
export function samplePolyline(points: readonly PixelPoint[], spacing: number): PixelPoint[] {
  const finitePoints = points.filter(isFinitePoint).map((point) => ({ ...point }));
  if (finitePoints.length <= 1 || !Number.isFinite(spacing) || spacing <= EPSILON) {
    return finitePoints;
  }

  const cumulative = new Float64Array(finitePoints.length);
  for (let index = 1; index < finitePoints.length; index += 1) {
    cumulative[index] =
      cumulative[index - 1] +
      Math.hypot(
        finitePoints[index].x - finitePoints[index - 1].x,
        finitePoints[index].y - finitePoints[index - 1].y
      );
  }

  const totalLength = cumulative[cumulative.length - 1];
  if (totalLength <= EPSILON) return [finitePoints[0]];

  const sampled: PixelPoint[] = [{ ...finitePoints[0] }];
  let segmentIndex = 1;
  for (let target = spacing; target < totalLength - EPSILON; target += spacing) {
    while (segmentIndex < cumulative.length - 1 && cumulative[segmentIndex] < target) {
      segmentIndex += 1;
    }
    const startDistance = cumulative[segmentIndex - 1];
    const segmentLength = cumulative[segmentIndex] - startDistance;
    if (segmentLength <= EPSILON) continue;
    const t = (target - startDistance) / segmentLength;
    const start = finitePoints[segmentIndex - 1];
    const end = finitePoints[segmentIndex];
    sampled.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    });
  }

  const last = finitePoints[finitePoints.length - 1];
  if (!pointsEqual(sampled[sampled.length - 1], last)) sampled.push({ ...last });
  return sampled;
}

function toGridPoint(point: PixelPoint, width: number, height: number): PixelPoint {
  return { x: point.x * width, y: point.y * height };
}

function fromGridPoint(point: PixelPoint, width: number, height: number): PixelPoint {
  return { x: clamp(point.x / width, 0, 1), y: clamp(point.y / height, 0, 1) };
}

function simplifyInGridSpace(
  points: readonly PixelPoint[],
  width: number,
  height: number,
  toleranceCells: number
): PixelPoint[] {
  const gridPoints = points.map((point) => toGridPoint(point, width, height));
  return simplifyPolyline(gridPoints, toleranceCells).map((point) =>
    fromGridPoint(point, width, height)
  );
}

function sampleInGridSpace(
  points: readonly PixelPoint[],
  width: number,
  height: number,
  spacingCells: number
): PixelPoint[] {
  const gridPoints = points.map((point) => toGridPoint(point, width, height));
  return samplePolyline(gridPoints, spacingCells).map((point) =>
    fromGridPoint(point, width, height)
  );
}

function finiteOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return clamp(Number.isFinite(value) ? (value as number) : fallback, minimum, maximum);
}

function resolveOptions(
  map: MapStateExtended,
  options: RoadRoutingOptions | undefined,
  cellCount: number
): ResolvedRoadRoutingOptions {
  const waterLevel = Number.isFinite(map.water_level) ? clamp(map.water_level, 0, 1) : 0.42;
  const maxStates = Math.max(1_024, cellCount * 9 * 17);
  const naturalSeed = Number.isFinite(options?.seed)
    ? (options?.seed as number)
    : Number.isFinite(map.seed)
      ? map.seed
      : 1_337;
  const guide = sanitizeBoundedPolyline(options?.guidePoints ?? []).points;
  return {
    seed: naturalSeed,
    maxBridgeCells: Math.floor(finiteOption(options?.maxBridgeCells, 3, 0, 16)),
    slopePenalty: finiteOption(options?.slopePenalty, 155, 0, 2_000),
    highAltitudePenalty: finiteOption(options?.highAltitudePenalty, 58, 0, 1_000),
    highAltitudeThreshold: finiteOption(
      options?.highAltitudeThreshold,
      Math.max(0.66, waterLevel + 0.24),
      0,
      1
    ),
    vegetationPenalty: finiteOption(options?.vegetationPenalty, 0.72, 0, 20),
    biomePenalty: finiteOption(options?.biomePenalty, 0.62, 0, 20),
    bridgePenalty: finiteOption(options?.bridgePenalty, 28, 0, 5_000),
    turnPenalty: finiteOption(options?.turnPenalty, 0.42, 0, 20),
    existingRoadReward: finiteOption(options?.existingRoadReward, 0.58, 0, 0.78),
    existingRoadProximityReward: finiteOption(
      options?.existingRoadProximityReward,
      0.2,
      0,
      0.6
    ),
    existingRoadProximityCells: finiteOption(
      options?.existingRoadProximityCells,
      3.5,
      0,
      24
    ),
    naturalVariation: finiteOption(options?.naturalVariation, 0.2, 0, 0.8),
    guidePoints: guide,
    guideCorridorCells: finiteOption(options?.guideCorridorCells, 2.25, 0, 32),
    guideAttraction: finiteOption(options?.guideAttraction, 0.78, 0, 20),
    maxSearchNodes: Math.floor(
      finiteOption(
        options?.maxSearchNodes,
        Math.min(240_000, Math.max(12_000, cellCount * 8)),
        128,
        maxStates
      )
    ),
    freehandSampleSpacingCells: finiteOption(
      options?.freehandSampleSpacingCells,
      5,
      1,
      32
    ),
    freehandSimplifyToleranceCells: finiteOption(
      options?.freehandSimplifyToleranceCells,
      0.42,
      0,
      3
    ),
  };
}

function cellIndexForPoint(
  point: PixelPoint,
  width: number,
  height: number
): number {
  const x = Math.round(clamp(point.x * width - 0.5, 0, width - 1));
  const y = Math.round(clamp(point.y * height - 0.5, 0, height - 1));
  return y * width + x;
}

function rasterizeSegment(
  start: PixelPoint,
  end: PixelPoint,
  width: number,
  height: number
): number[] {
  const startX = clamp(start.x * width - 0.5, 0, width - 1);
  const startY = clamp(start.y * height - 0.5, 0, height - 1);
  const endX = clamp(end.x * width - 0.5, 0, width - 1);
  const endY = clamp(end.y * height - 0.5, 0, height - 1);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(endX - startX), Math.abs(endY - startY)) * 2));
  const cells: number[] = [];
  let previous = -1;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = Math.round(startX + (endX - startX) * t);
    const y = Math.round(startY + (endY - startY) * t);
    const index = y * width + x;
    if (index !== previous) {
      cells.push(index);
      previous = index;
    }
  }
  return cells;
}

function rasterizePolyline(
  points: readonly PixelPoint[],
  width: number,
  height: number
): number[] {
  if (!points.length) return [];
  if (points.length === 1) return [cellIndexForPoint(points[0], width, height)];
  const cells: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = rasterizeSegment(points[index - 1], points[index], width, height);
    for (const cell of segment) {
      if (cells[cells.length - 1] !== cell) cells.push(cell);
    }
  }
  return cells;
}

function buildDistanceField(
  points: readonly PixelPoint[],
  width: number,
  height: number
): Float32Array | null {
  const cells = rasterizePolyline(points, width, height);
  if (!cells.length) return null;
  const field = new Float32Array(width * height);
  field.fill(Number.POSITIVE_INFINITY);
  for (const cell of cells) field[cell] = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let distance = field[index];
      if (x > 0) distance = Math.min(distance, field[index - 1] + 1);
      if (y > 0) distance = Math.min(distance, field[index - width] + 1);
      if (x > 0 && y > 0) distance = Math.min(distance, field[index - width - 1] + SQRT_2);
      if (x + 1 < width && y > 0) {
        distance = Math.min(distance, field[index - width + 1] + SQRT_2);
      }
      field[index] = distance;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let distance = field[index];
      if (x + 1 < width) distance = Math.min(distance, field[index + 1] + 1);
      if (y + 1 < height) distance = Math.min(distance, field[index + width] + 1);
      if (x + 1 < width && y + 1 < height) {
        distance = Math.min(distance, field[index + width + 1] + SQRT_2);
      }
      if (x > 0 && y + 1 < height) {
        distance = Math.min(distance, field[index + width - 1] + SQRT_2);
      }
      field[index] = distance;
    }
  }
  return field;
}

function buildExistingRoadDistance(
  map: MapStateExtended,
  width: number,
  height: number
): Float32Array | null {
  const field = new Float32Array(width * height);
  field.fill(Number.POSITIVE_INFINITY);
  let hasRoad = false;
  for (const road of map.roads) {
    const points = sanitizeBoundedPolyline(road.points).points;
    if (points.length < 2) continue;
    hasRoad = true;
    for (const cell of rasterizePolyline(points, width, height)) field[cell] = 0;
  }
  if (!hasRoad) return null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let distance = field[index];
      if (x > 0) distance = Math.min(distance, field[index - 1] + 1);
      if (y > 0) distance = Math.min(distance, field[index - width] + 1);
      if (x > 0 && y > 0) distance = Math.min(distance, field[index - width - 1] + SQRT_2);
      if (x + 1 < width && y > 0) {
        distance = Math.min(distance, field[index - width + 1] + SQRT_2);
      }
      field[index] = distance;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let distance = field[index];
      if (x + 1 < width) distance = Math.min(distance, field[index + 1] + 1);
      if (y + 1 < height) distance = Math.min(distance, field[index + width] + 1);
      if (x + 1 < width && y + 1 < height) {
        distance = Math.min(distance, field[index + width + 1] + SQRT_2);
      }
      if (x > 0 && y + 1 < height) {
        distance = Math.min(distance, field[index + width - 1] + SQRT_2);
      }
      field[index] = distance;
    }
  }
  return field;
}

function createRoutingContext(
  map: MapStateExtended,
  options?: RoadRoutingOptions
): { context: RoutingContext | null; warnings: string[] } {
  const width = Math.trunc(map.width);
  const height = Math.trunc(map.height);
  if (
    !Number.isFinite(map.width) ||
    !Number.isFinite(map.height) ||
    width < 1 ||
    height < 1 ||
    width !== map.width ||
    height !== map.height
  ) {
    return { context: null, warnings: ["Map dimensions are invalid; terrain routing was skipped."] };
  }
  const cellCount = width * height;
  if (!Number.isSafeInteger(cellCount) || map.relief.length < cellCount) {
    return { context: null, warnings: ["Relief data is incomplete; terrain routing was skipped."] };
  }

  const resolved = resolveOptions(map, options, cellCount);
  const waterLevel = Number.isFinite(map.water_level) ? clamp(map.water_level, 0, 1) : 0.42;
  const relief = new Float32Array(cellCount);
  const vegetation = new Float32Array(cellCount);
  const water = new Uint8Array(cellCount);
  const invalidTerrain = new Uint8Array(cellCount);
  const biomeCost = new Float32Array(cellCount);
  let invalidCount = 0;

  for (let index = 0; index < cellCount; index += 1) {
    const reliefValue = map.relief[index];
    if (!Number.isFinite(reliefValue)) {
      invalidTerrain[index] = 1;
      invalidCount += 1;
      relief[index] = waterLevel;
    } else {
      relief[index] = clamp(reliefValue, 0, 1);
    }
    const vegetationValue = map.vegetation[index];
    vegetation[index] = Number.isFinite(vegetationValue) ? clamp(vegetationValue, 0, 1) : 0.45;
    water[index] = relief[index] <= waterLevel ? 1 : 0;
    biomeCost[index] = BIOME_TRAVERSAL_COST[computeBiome(map, index)];
  }

  const warnings: string[] = [];
  if (invalidCount > 0) {
    warnings.push(
      `${invalidCount} terrain cell${invalidCount === 1 ? " was" : "s were"} invalid and treated as impassable.`
    );
  }
  return {
    context: {
      map,
      width,
      height,
      cellCount,
      relief,
      vegetation,
      water,
      invalidTerrain,
      biomeCost,
      roadDistance: buildExistingRoadDistance(map, width, height),
      options: resolved,
    },
    warnings,
  };
}

class SearchHeap {
  private readonly nodes: SearchNode[] = [];

  get length(): number {
    return this.nodes.length;
  }

  push(node: SearchNode): void {
    this.nodes.push(node);
    let index = this.nodes.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.isBefore(node, this.nodes[parent])) break;
      this.nodes[index] = this.nodes[parent];
      index = parent;
    }
    this.nodes[index] = node;
  }

  pop(): SearchNode | undefined {
    const first = this.nodes[0];
    const last = this.nodes.pop();
    if (!first || !last || this.nodes.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.nodes.length) break;
      const right = left + 1;
      const child =
        right < this.nodes.length && this.isBefore(this.nodes[right], this.nodes[left])
          ? right
          : left;
      if (!this.isBefore(this.nodes[child], last)) break;
      this.nodes[index] = this.nodes[child];
      index = child;
    }
    this.nodes[index] = last;
    return first;
  }

  private isBefore(a: SearchNode, b: SearchNode): boolean {
    if (Math.abs(a.score - b.score) > EPSILON) return a.score < b.score;
    if (Math.abs(a.g - b.g) > EPSILON) return a.g < b.g;
    return a.stateId < b.stateId;
  }
}

function stateIdFor(
  cellIndex: number,
  waterRun: number,
  direction: number,
  maxBridgeCells: number
): number {
  return ((cellIndex * (maxBridgeCells + 1) + waterRun) * 9) + direction + 1;
}

function cellIndexFromState(stateId: number, maxBridgeCells: number): number {
  return Math.floor(Math.floor(stateId / 9) / (maxBridgeCells + 1));
}

function octileDistance(x: number, y: number, goalX: number, goalY: number): number {
  const dx = Math.abs(goalX - x);
  const dy = Math.abs(goalY - y);
  const diagonal = Math.min(dx, dy);
  return Math.max(dx, dy) + (SQRT_2 - 1) * diagonal;
}

function headingPenalty(previousDirection: number, nextDirection: number, weight: number): number {
  if (previousDirection < 0 || previousDirection === nextDirection || weight <= 0) return 0;
  const previous = DIRECTIONS[previousDirection];
  const next = DIRECTIONS[nextDirection];
  const previousLength = previous[0] !== 0 && previous[1] !== 0 ? SQRT_2 : 1;
  const nextLength = next[0] !== 0 && next[1] !== 0 ? SQRT_2 : 1;
  const cosine = (previous[0] * next[0] + previous[1] * next[1]) / (previousLength * nextLength);
  return weight * (1 - clamp(cosine, -1, 1));
}

function routeSearch(
  context: RoutingContext,
  from: PixelPoint,
  to: PixelPoint,
  guidePoints: readonly PixelPoint[]
): SearchOutcome {
  const { width, height, options } = context;
  const startCell = cellIndexForPoint(from, width, height);
  const goalCell = cellIndexForPoint(to, width, height);
  if (context.invalidTerrain[startCell] || context.invalidTerrain[goalCell]) {
    return { points: null, warning: "A road anchor lies on invalid terrain." };
  }
  if (startCell === goalCell) return { points: pointsEqual(from, to) ? [from] : [from, to] };

  const startWaterRun = context.water[startCell] ? 1 : 0;
  if (startWaterRun > options.maxBridgeCells) {
    return { points: null, warning: "The road starts in water, but bridging is disabled." };
  }

  const startX = startCell % width;
  const startY = Math.floor(startCell / width);
  const goalX = goalCell % width;
  const goalY = Math.floor(goalCell / width);
  const fullGuide = sanitizeBoundedPolyline([from, ...guidePoints, to]).points;
  const guideDistance = buildDistanceField(fullGuide, width, height);
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const open = new SearchHeap();
  const startState = stateIdFor(startCell, startWaterRun, -1, options.maxBridgeCells);
  const initialHeuristic =
    octileDistance(startX, startY, goalX, goalY) * HEURISTIC_STEP_COST * HEURISTIC_WEIGHT;
  gScore.set(startState, 0);
  open.push({
    stateId: startState,
    x: startX,
    y: startY,
    direction: -1,
    waterRun: startWaterRun,
    g: 0,
    score: initialHeuristic,
  });

  let expanded = 0;
  while (open.length > 0) {
    const current = open.pop();
    if (!current) break;
    const knownG = gScore.get(current.stateId);
    if (knownG === undefined || current.g > knownG + EPSILON) continue;
    expanded += 1;
    if (expanded > options.maxSearchNodes) {
      return {
        points: null,
        warning: `Road search reached its ${options.maxSearchNodes.toLocaleString()}-node safety limit.`,
      };
    }

    const currentCell = current.y * width + current.x;
    if (currentCell === goalCell) {
      const reversed: PixelPoint[] = [];
      let state: number | undefined = current.stateId;
      while (state !== undefined) {
        const cell = cellIndexFromState(state, options.maxBridgeCells);
        reversed.push({
          x: ((cell % width) + 0.5) / width,
          y: (Math.floor(cell / width) + 0.5) / height,
        });
        state = cameFrom.get(state);
      }
      const points = reversed.reverse();
      points[0] = from;
      points[points.length - 1] = to;
      return { points };
    }

    const currentRelief = context.relief[currentCell];
    for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
      const [dx, dy] = DIRECTIONS[direction];
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const cell = y * width + x;
      if (context.invalidTerrain[cell]) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && !context.water[cell]) {
        const sideA = current.y * width + x;
        const sideB = y * width + current.x;
        if (context.water[sideA] && context.water[sideB]) continue;
      }

      const isWater = context.water[cell] === 1;
      const waterRun = isWater ? current.waterRun + 1 : 0;
      if (waterRun > options.maxBridgeCells) continue;
      const stepDistance = diagonal ? SQRT_2 : 1;
      const relief = context.relief[cell];
      const grade = Math.abs(relief - currentRelief) / stepDistance;
      const coherentNoise = pseudoRandom(x / 3.2, y / 3.2, options.seed + 71) - 0.5;
      const edgeNoise =
        pseudoRandom(x + current.x * 0.37, y + current.y * 0.61, options.seed + 193) - 0.5;
      const variation = options.naturalVariation * (coherentNoise * 1.35 + edgeNoise * 0.65);

      let roadDiscount = 0;
      const roadDistance = context.roadDistance?.[cell];
      if (roadDistance !== undefined && Number.isFinite(roadDistance)) {
        if (roadDistance <= 0.01) {
          roadDiscount = options.existingRoadReward;
        } else if (
          options.existingRoadProximityCells > 0 &&
          roadDistance < options.existingRoadProximityCells
        ) {
          roadDiscount =
            options.existingRoadProximityReward *
            (1 - roadDistance / options.existingRoadProximityCells);
        }
      }
      const baseCost = stepDistance * Math.max(0.22, 1 + variation - roadDiscount);
      const slopeCost =
        options.slopePenalty * grade * grade +
        Math.max(0, grade - 0.07) * options.slopePenalty * 0.42;
      const altitude = Math.max(0, relief - options.highAltitudeThreshold);
      const altitudeCost = altitude * altitude * options.highAltitudePenalty;
      const vegetationCost = context.vegetation[cell] * options.vegetationPenalty;
      const biomeCost = context.biomeCost[cell] * options.biomePenalty;
      const bridgeCost = isWater
        ? options.bridgePenalty * (1 + Math.max(0, waterRun - 1) * 0.55)
        : 0;
      const turnCost = headingPenalty(current.direction, direction, options.turnPenalty);
      let guideCost = 0;
      const distanceFromGuide = guideDistance?.[cell];
      if (distanceFromGuide !== undefined && Number.isFinite(distanceFromGuide)) {
        const outsideCorridor = Math.max(0, distanceFromGuide - options.guideCorridorCells);
        guideCost = outsideCorridor * options.guideAttraction;
        if (outsideCorridor <= 0 && options.guideCorridorCells > 0) {
          guideCost +=
            (distanceFromGuide / options.guideCorridorCells) * options.guideAttraction * 0.06;
        }
      }

      const tentativeG =
        current.g +
        baseCost +
        slopeCost +
        altitudeCost +
        vegetationCost +
        biomeCost +
        bridgeCost +
        turnCost +
        guideCost;
      const stateId = stateIdFor(cell, waterRun, direction, options.maxBridgeCells);
      if (tentativeG + EPSILON >= (gScore.get(stateId) ?? Number.POSITIVE_INFINITY)) continue;

      gScore.set(stateId, tentativeG);
      cameFrom.set(stateId, current.stateId);
      const heuristic =
        octileDistance(x, y, goalX, goalY) * HEURISTIC_STEP_COST * HEURISTIC_WEIGHT;
      open.push({
        stateId,
        x,
        y,
        direction,
        waterRun,
        g: tentativeG,
        score: tentativeG + heuristic,
      });
    }
  }

  return {
    points: null,
    warning: `No route satisfies the ${options.maxBridgeCells}-cell bridge limit.`,
  };
}

function analyzeTraversal(context: RoutingContext, points: readonly PixelPoint[]): TraversalAnalysis {
  const cells = rasterizePolyline(points, context.width, context.height);
  let bridgeCells = 0;
  let waterRun = 0;
  let maxWaterRun = 0;
  let maxGrade = 0;
  let maxRelief = 0;
  let previousCell = -1;
  for (const cell of cells) {
    const relief = context.relief[cell];
    maxRelief = Math.max(maxRelief, relief);
    if (context.water[cell]) {
      bridgeCells += 1;
      waterRun += 1;
      maxWaterRun = Math.max(maxWaterRun, waterRun);
    } else {
      waterRun = 0;
    }
    if (previousCell >= 0) {
      const previousX = previousCell % context.width;
      const previousY = Math.floor(previousCell / context.width);
      const x = cell % context.width;
      const y = Math.floor(cell / context.width);
      const step = Math.max(1, Math.hypot(x - previousX, y - previousY));
      maxGrade = Math.max(maxGrade, Math.abs(relief - context.relief[previousCell]) / step);
    }
    previousCell = cell;
  }
  return { bridgeCells, maxWaterRun, maxGrade, maxRelief };
}

function polylineDistanceCells(
  points: readonly PixelPoint[],
  width: number,
  height: number
): number {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += Math.hypot(
      (points[index].x - points[index - 1].x) * width,
      (points[index].y - points[index - 1].y) * height
    );
  }
  return distance;
}

function smoothPolyline(points: readonly PixelPoint[], strength: number): PixelPoint[] {
  if (points.length < 3 || strength <= 0) return points.map((point) => ({ ...point }));
  const smoothed: PixelPoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const midpoint = {
      x: (previous.x + next.x) / 2,
      y: (previous.y + next.y) / 2,
    };
    smoothed.push({
      x: clamp(current.x + (midpoint.x - current.x) * strength, 0, 1),
      y: clamp(current.y + (midpoint.y - current.y) * strength, 0, 1),
    });
  }
  smoothed.push({ ...points[points.length - 1] });
  return smoothed;
}

function isSafeReplacement(
  context: RoutingContext,
  original: readonly PixelPoint[],
  candidate: readonly PixelPoint[]
): boolean {
  if (candidate.length < 2) return false;
  const originalAnalysis = analyzeTraversal(context, original);
  const candidateAnalysis = analyzeTraversal(context, candidate);
  return (
    candidateAnalysis.maxWaterRun <= originalAnalysis.maxWaterRun &&
    candidateAnalysis.bridgeCells <= originalAnalysis.bridgeCells &&
    candidateAnalysis.maxGrade <= Math.max(0.1, originalAnalysis.maxGrade + 0.025) &&
    candidateAnalysis.maxRelief <= originalAnalysis.maxRelief + 0.025
  );
}

function normalizeRoutedPolyline(
  context: RoutingContext,
  points: readonly PixelPoint[],
  toleranceCells: number
): PixelPoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  let normalized = points.map((point) => ({ ...point }));
  const smoothed = smoothPolyline(normalized, 0.16);
  if (isSafeReplacement(context, normalized, smoothed)) normalized = smoothed;
  if (toleranceCells > 0) {
    const simplified = simplifyInGridSpace(
      normalized,
      context.width,
      context.height,
      toleranceCells
    );
    if (isSafeReplacement(context, normalized, simplified)) normalized = simplified;
  }
  normalized[0] = { ...points[0] };
  normalized[normalized.length - 1] = { ...points[points.length - 1] };
  return normalized;
}

function appendWarningsForTraversal(
  warnings: string[],
  analysis: TraversalAnalysis,
  usedFallback: boolean
): void {
  if (analysis.bridgeCells > 0) {
    warnings.push(
      usedFallback
        ? `The unrouted fallback guide crosses ${analysis.bridgeCells} water cell${analysis.bridgeCells === 1 ? "" : "s"}; review it before saving.`
        : `Route requires ${analysis.bridgeCells} bridge cell${analysis.bridgeCells === 1 ? "" : "s"}.`
    );
  }
  if (analysis.maxGrade > 0.12) {
    warnings.push(`Route crosses steep terrain (maximum normalized grade ${analysis.maxGrade.toFixed(2)}).`);
  }
}

function dedupeWarnings(warnings: readonly string[]): string[] {
  return Array.from(new Set(warnings.filter((warning) => warning.trim().length > 0)));
}

function resultForPoints(
  context: RoutingContext,
  points: readonly PixelPoint[],
  warnings: readonly string[],
  usedFallback: boolean
): RoadRouteResult {
  const safe = sanitizeBoundedPolyline(points).points;
  const analysis = analyzeTraversal(context, safe);
  const allWarnings = [...warnings];
  appendWarningsForTraversal(allWarnings, analysis, usedFallback);
  return {
    points: safe,
    distanceCells: polylineDistanceCells(safe, context.width, context.height),
    maxGrade: analysis.maxGrade,
    bridgeCells: analysis.bridgeCells,
    warnings: dedupeWarnings(allWarnings),
    usedFallback,
  };
}

function fallbackGuide(
  width: number,
  height: number,
  from: PixelPoint,
  to: PixelPoint,
  guidePoints: readonly PixelPoint[],
  toleranceCells: number
): PixelPoint[] {
  const sanitized = sanitizeBoundedPolyline([from, ...guidePoints, to]).points;
  let guide = simplifyInGridSpace(sanitized, width, height, toleranceCells);
  if (guide.length < 2 && !pointsEqual(from, to)) guide = [from, to];
  if (guide.length) {
    guide[0] = from;
    guide[guide.length - 1] = to;
  }
  return guide;
}

function fallbackWithoutContext(
  from: PixelPoint,
  to: PixelPoint,
  guidePoints: readonly PixelPoint[],
  warnings: readonly string[]
): RoadRouteResult {
  const points = sanitizeBoundedPolyline([from, ...guidePoints, to]).points;
  return {
    points,
    distanceCells: 0,
    maxGrade: 0,
    bridgeCells: 0,
    warnings: dedupeWarnings([
      ...warnings,
      "No terrain-aware route was produced; the normalized guide is returned for manual review.",
    ]),
    usedFallback: true,
  };
}

/**
 * Finds a deterministic terrain-aware road between two normalized map points.
 * NetworkAnchor is accepted directly so snapped cities and road nodes retain
 * their exact endpoint coordinates.
 */
export function routeRoad(
  map: MapStateExtended,
  from: PixelPoint | NetworkAnchor,
  to: PixelPoint | NetworkAnchor,
  options?: RoadRoutingOptions
): RoadRouteResult {
  const safeFrom = sanitizePoint(from);
  const safeTo = sanitizePoint(to);
  const setup = createRoutingContext(map, options);
  const warnings = [...setup.warnings];
  if (safeFrom.changed || safeTo.changed) {
    warnings.push("One or more road anchors were outside the map and were clamped to its bounds.");
  }
  if (pointsEqual(safeFrom.point, safeTo.point)) {
    warnings.push("Road anchors are too close to create a route.");
    if (!setup.context) {
      return fallbackWithoutContext(safeFrom.point, safeTo.point, [], warnings);
    }
    return resultForPoints(setup.context, [safeFrom.point], warnings, true);
  }
  if (!setup.context) {
    return fallbackWithoutContext(
      safeFrom.point,
      safeTo.point,
      options?.guidePoints ?? [],
      warnings
    );
  }

  const context = setup.context;
  const outcome = routeSearch(context, safeFrom.point, safeTo.point, context.options.guidePoints);
  if (!outcome.points) {
    if (outcome.warning) warnings.push(outcome.warning);
    warnings.push(
      "No terrain-safe route was found; the normalized guide is returned only for manual review."
    );
    const guide = fallbackGuide(
      context.width,
      context.height,
      safeFrom.point,
      safeTo.point,
      context.options.guidePoints,
      context.options.freehandSimplifyToleranceCells
    );
    return resultForPoints(context, guide, warnings, true);
  }

  const normalized = normalizeRoutedPolyline(
    context,
    outcome.points,
    Math.min(0.32, context.options.freehandSimplifyToleranceCells)
  );
  return resultForPoints(context, normalized, warnings, false);
}

/**
 * Converts a freehand stroke into a compact road. The stroke is simplified and
 * sampled into anchors, then each section is terrain-routed inside a soft guide
 * corridor. Hazards can therefore push the road away from the user's hand while
 * the overall drawn shape is retained.
 */
export function normalizeFreehandRoad(
  map: MapStateExtended,
  rawPoints: readonly PixelPoint[],
  options?: RoadRoutingOptions
): RoadRouteResult {
  const sanitized = sanitizeBoundedPolyline(rawPoints);
  const setup = createRoutingContext(map, options);
  const warnings = [...setup.warnings];
  if (sanitized.changed) {
    warnings.push("Invalid or out-of-bounds stroke samples were removed or clamped.");
  }
  if (sanitized.points.length < 2) {
    warnings.push("Draw a longer stroke to create a road.");
    const point = sanitized.points[0] ?? { x: 0.5, y: 0.5 };
    if (!setup.context) return fallbackWithoutContext(point, point, [], warnings);
    return resultForPoints(setup.context, [point], warnings, true);
  }
  if (!setup.context) {
    return fallbackWithoutContext(
      sanitized.points[0],
      sanitized.points[sanitized.points.length - 1],
      sanitized.points.slice(1, -1),
      warnings
    );
  }

  const context = setup.context;
  const simplifiedStroke = simplifyInGridSpace(
    sanitized.points,
    context.width,
    context.height,
    context.options.freehandSimplifyToleranceCells
  );
  let anchors = sampleInGridSpace(
    simplifiedStroke,
    context.width,
    context.height,
    context.options.freehandSampleSpacingCells
  );
  if (anchors.length > MAX_FREEHAND_ANCHORS) {
    const totalLength = polylineDistanceCells(
      simplifiedStroke,
      context.width,
      context.height
    );
    anchors = sampleInGridSpace(
      simplifiedStroke,
      context.width,
      context.height,
      Math.max(context.options.freehandSampleSpacingCells, totalLength / (MAX_FREEHAND_ANCHORS - 1))
    );
    warnings.push("The stroke was downsampled to keep road generation responsive.");
  }
  if (anchors.length < 2) {
    warnings.push("The normalized stroke is too short to create a road.");
    return resultForPoints(context, anchors, warnings, true);
  }

  const routed: PixelPoint[] = [];
  let usedFallback = false;
  for (let index = 1; index < anchors.length; index += 1) {
    const start = anchors[index - 1];
    const end = anchors[index];
    const outcome = routeSearch(context, start, end, [start, end]);
    let segment: PixelPoint[];
    if (outcome.points) {
      segment = outcome.points;
    } else {
      usedFallback = true;
      if (outcome.warning) warnings.push(outcome.warning);
      warnings.push(
        "A stroke section could not be terrain-routed; the guide is returned only for manual review."
      );
      // The editor never commits fallback geometry. Stop after the first failed
      // section instead of spending the remaining search budget on a result the
      // user cannot safely add.
      return resultForPoints(context, simplifiedStroke, warnings, true);
    }
    for (const point of segment) {
      if (!routed.length || !pointsEqual(routed[routed.length - 1], point)) routed.push(point);
    }
  }

  const normalized = normalizeRoutedPolyline(
    context,
    routed,
    context.options.freehandSimplifyToleranceCells
  );
  normalized[0] = { ...sanitized.points[0] };
  normalized[normalized.length - 1] = { ...sanitized.points[sanitized.points.length - 1] };
  return resultForPoints(context, normalized, warnings, usedFallback);
}
