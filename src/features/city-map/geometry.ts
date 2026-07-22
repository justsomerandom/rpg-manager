export type Point = {
  x: number;
  y: number;
};

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type OrientedRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type EllipseBoundary = {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
};

export const TAU = Math.PI * 2;

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function squaredDistance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function distance(a: Point, b: Point): number {
  return Math.sqrt(squaredDistance(a, b));
}

export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** A stable 32-bit FNV-1a hash with an additional avalanche step. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function hashParts(...parts: Array<string | number>): number {
  return hashString(parts.map(String).join("\u001f"));
}

export function stableId(prefix: string, seed: number, ...parts: Array<string | number>): string {
  const primary = hashParts(prefix, seed, ...parts).toString(36).padStart(7, "0");
  const secondary = hashParts(seed ^ 0x9e3779b9, ...parts, prefix).toString(36).padStart(7, "0");
  return `${prefix}-${primary}${secondary}`;
}

/** Small, fast deterministic generator. Its output is stable across JavaScript runtimes. */
export class SeededRandom {
  private state: number;

  constructor(seed: number | string) {
    const normalized = typeof seed === "string" ? hashString(seed) : seed >>> 0;
    this.state = normalized || 0x6d2b79f5;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  range(min: number, max: number): number {
    return lerp(min, max, this.next());
  }

  integer(min: number, maxInclusive: number): number {
    if (maxInclusive <= min) return min;
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < clamp(probability);
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error("Cannot select from an empty collection.");
    return values[Math.floor(this.next() * values.length)]!;
  }

  fork(...parts: Array<string | number>): SeededRandom {
    return new SeededRandom(hashParts(this.state, ...parts));
  }
}

export function pointOnEllipse(boundary: EllipseBoundary, angle: number, scale = 1): Point {
  return {
    x: boundary.x + Math.cos(angle) * boundary.radiusX * scale,
    y: boundary.y + Math.sin(angle) * boundary.radiusY * scale,
  };
}

export function interpolatePoint(a: Point, b: Point, amount: number): Point {
  return { x: lerp(a.x, b.x, amount), y: lerp(a.y, b.y, amount) };
}

export function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1]!, points[index]!);
  }
  return length;
}

export function sampleSegment(a: Point, b: Point, spacing: number): Point[] {
  const segmentLength = distance(a, b);
  const count = Math.max(1, Math.ceil(segmentLength / Math.max(spacing, 0.0001)));
  return Array.from({ length: count + 1 }, (_, index) => interpolatePoint(a, b, index / count));
}

export function chaikinSmooth(points: readonly Point[], iterations = 1, closed = false): Point[] {
  if (points.length < 3 || iterations <= 0) return points.map((point) => ({ ...point }));
  let result = points.map((point) => ({ ...point }));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const smoothed: Point[] = [];
    if (!closed) smoothed.push(result[0]!);
    const segmentCount = closed ? result.length : result.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const a = result[index]!;
      const b = result[(index + 1) % result.length]!;
      smoothed.push(interpolatePoint(a, b, 0.25), interpolatePoint(a, b, 0.75));
    }
    if (!closed) smoothed.push(result[result.length - 1]!);
    result = smoothed;
  }
  if (closed && result.length > 0) result.push({ ...result[0]! });
  return result;
}

export function distancePointToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return distance(point, a);
  const amount = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared);
  return distance(point, { x: a.x + dx * amount, y: a.y + dy * amount });
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: Point, a: Point, b: Point): boolean {
  const epsilon = 1e-9;
  return (
    Math.abs(orientation(a, b, point)) <= epsilon &&
    point.x >= Math.min(a.x, b.x) - epsilon &&
    point.x <= Math.max(a.x, b.x) + epsilon &&
    point.y >= Math.min(a.y, b.y) - epsilon &&
    point.y <= Math.max(a.y, b.y) + epsilon
  );
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) {
    return true;
  }
  return (
    (Math.abs(abC) <= 1e-9 && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) <= 1e-9 && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) <= 1e-9 && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) <= 1e-9 && pointOnSegment(b, c, d))
  );
}

export function distanceBetweenSegments(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distancePointToSegment(a, c, d),
    distancePointToSegment(b, c, d),
    distancePointToSegment(c, a, b),
    distancePointToSegment(d, a, b),
  );
}

export function rectangleCorners(rectangle: OrientedRectangle): [Point, Point, Point, Point] {
  const halfWidth = rectangle.width / 2;
  const halfHeight = rectangle.height / 2;
  const cosine = Math.cos(rectangle.rotation);
  const sine = Math.sin(rectangle.rotation);
  const transform = (x: number, y: number): Point => ({
    x: rectangle.x + x * cosine - y * sine,
    y: rectangle.y + x * sine + y * cosine,
  });
  return [
    transform(-halfWidth, -halfHeight),
    transform(halfWidth, -halfHeight),
    transform(halfWidth, halfHeight),
    transform(-halfWidth, halfHeight),
  ];
}

export function rectangleBounds(rectangle: OrientedRectangle, padding = 0): Bounds {
  const corners = rectangleCorners(rectangle);
  return {
    minX: Math.min(...corners.map((point) => point.x)) - padding,
    minY: Math.min(...corners.map((point) => point.y)) - padding,
    maxX: Math.max(...corners.map((point) => point.x)) + padding,
    maxY: Math.max(...corners.map((point) => point.y)) + padding,
  };
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function projectPolygon(points: readonly Point[], axis: Point): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const projection = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return { min, max };
}

export function rectanglesOverlap(a: OrientedRectangle, b: OrientedRectangle, padding = 0): boolean {
  const first: OrientedRectangle = { ...a, width: a.width + padding * 2, height: a.height + padding * 2 };
  const second: OrientedRectangle = { ...b, width: b.width + padding * 2, height: b.height + padding * 2 };
  const firstCorners = rectangleCorners(first);
  const secondCorners = rectangleCorners(second);
  const axes = [
    { x: Math.cos(first.rotation), y: Math.sin(first.rotation) },
    { x: -Math.sin(first.rotation), y: Math.cos(first.rotation) },
    { x: Math.cos(second.rotation), y: Math.sin(second.rotation) },
    { x: -Math.sin(second.rotation), y: Math.cos(second.rotation) },
  ];
  return axes.every((axis) => {
    const firstProjection = projectPolygon(firstCorners, axis);
    const secondProjection = projectPolygon(secondCorners, axis);
    return firstProjection.max >= secondProjection.min && secondProjection.max >= firstProjection.min;
  });
}

function toRectangleLocal(point: Point, rectangle: OrientedRectangle): Point {
  const dx = point.x - rectangle.x;
  const dy = point.y - rectangle.y;
  const cosine = Math.cos(-rectangle.rotation);
  const sine = Math.sin(-rectangle.rotation);
  return { x: dx * cosine - dy * sine, y: dx * sine + dy * cosine };
}

export function distanceSegmentToRectangle(a: Point, b: Point, rectangle: OrientedRectangle): number {
  const localA = toRectangleLocal(a, rectangle);
  const localB = toRectangleLocal(b, rectangle);
  const halfWidth = rectangle.width / 2;
  const halfHeight = rectangle.height / 2;
  const inside = (point: Point) => Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfHeight;
  if (inside(localA) || inside(localB)) return 0;
  const corners: [Point, Point, Point, Point] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < corners.length; index += 1) {
    minimum = Math.min(
      minimum,
      distanceBetweenSegments(localA, localB, corners[index]!, corners[(index + 1) % corners.length]!),
    );
  }
  return minimum;
}

export function rectangleInsideEllipse(rectangle: OrientedRectangle, boundary: EllipseBoundary, inset = 0): boolean {
  const radiusX = Math.max(0.0001, boundary.radiusX - inset);
  const radiusY = Math.max(0.0001, boundary.radiusY - inset);
  return rectangleCorners(rectangle).every((point) => {
    const normalizedX = (point.x - boundary.x) / radiusX;
    const normalizedY = (point.y - boundary.y) / radiusY;
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  });
}

export function polygonContainsPoint(point: Point, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current]!;
    const b = polygon[previous]!;
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(polygon: readonly Point[]): Point {
  if (polygon.length === 0) return { x: 0.5, y: 0.5 };
  let signedArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    const cross = current.x * next.y - next.x * current.y;
    signedArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  if (Math.abs(signedArea) <= Number.EPSILON) {
    return {
      x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
      y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
    };
  }
  return { x: x / (signedArea * 3), y: y / (signedArea * 3) };
}

export class SpatialHash<T> {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<T>>();

  constructor(cellSize = 0.04) {
    this.cellSize = Math.max(0.001, cellSize);
  }

  private coordinates(bounds: Bounds): Array<[number, number]> {
    const minX = Math.floor(bounds.minX / this.cellSize);
    const minY = Math.floor(bounds.minY / this.cellSize);
    const maxX = Math.floor(bounds.maxX / this.cellSize);
    const maxY = Math.floor(bounds.maxY / this.cellSize);
    const coordinates: Array<[number, number]> = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) coordinates.push([x, y]);
    }
    return coordinates;
  }

  insert(item: T, bounds: Bounds): void {
    for (const [x, y] of this.coordinates(bounds)) {
      const key = `${x}:${y}`;
      const cell = this.cells.get(key) ?? new Set<T>();
      cell.add(item);
      this.cells.set(key, cell);
    }
  }

  query(bounds: Bounds): T[] {
    const found = new Set<T>();
    for (const [x, y] of this.coordinates(bounds)) {
      const cell = this.cells.get(`${x}:${y}`);
      if (cell) for (const item of cell) found.add(item);
    }
    return [...found];
  }
}
