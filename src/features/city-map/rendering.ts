import type { CityBuilding, CityDistrict, CityMap } from "../../api/cityMap";

export type CityViewMode = "topdown" | "isometric";

export type CityLayerVisibility = {
  ground: boolean;
  districts: boolean;
  roads: boolean;
  buildings: boolean;
  districtLabels: boolean;
  roadLabels: boolean;
  buildingLabels: boolean;
};

export type CityViewport = {
  /** CSS pixel width. Falls back to the canvas layout width. */
  width?: number;
  /** CSS pixel height. Falls back to the canvas layout height. */
  height?: number;
  /** Device pixels per CSS pixel. */
  dpr?: number;
  /** View scale around the city centre. */
  zoom?: number;
  /** Horizontal pan in CSS pixels. */
  panX?: number;
  /** Vertical pan in CSS pixels. */
  panY?: number;
  /** Minimum presentation space around the city in CSS pixels. */
  padding?: number;
};

export type CityFeatureRef = {
  kind: "district" | "road" | "building";
  id: string;
};

export type CityEditorOverlayOptions = {
  selected?: CityFeatureRef | null;
  hovered?: CityFeatureRef | null;
  showRoadNodes?: boolean;
  roadNodeRoadId?: string | null;
  draftRoad?: ReadonlyArray<{ x: number; y: number }>;
};

export type CityRenderOptions = {
  viewMode?: CityViewMode;
  viewport?: CityViewport;
  layers?: Partial<CityLayerVisibility>;
  overlays?: CityEditorOverlayOptions;
  /** Background outside the mapped city. */
  background?: string;
  /** Isometric y-axis compression. */
  isometricSquash?: number;
  /** Maximum isometric building extrusion in CSS pixels. Set to 0 for a flat view. */
  maxBuildingExtrusion?: number;
  /** Resize the canvas backing bitmap to match the viewport and DPR. */
  resizeCanvas?: boolean;
  /** Clamp inverse-projected pointer coordinates to the city bounds. */
  clampPointerToBounds?: boolean;
  /** Treat coordinates passed to screenToCityPoint as client coordinates. */
  pointerCoordinates?: "client" | "canvas";
};

export type CityRenderStats = {
  contextAvailable: boolean;
  viewMode: CityViewMode;
  viewportWidth: number;
  viewportHeight: number;
  dpr: number;
  zoom: number;
  renderedDistricts: number;
  renderedRoads: number;
  renderedBuildings: number;
  culledBuildings: number;
  renderedLabels: number;
  durationMs: number;
};

export type CityFeatureHit =
  | {
      kind: "building";
      id: string;
      feature: CityBuilding;
      distance: number;
    }
  | {
      kind: "road";
      id: string;
      feature: CityMap["roads"][number];
      distance: number;
      segmentIndex: number;
    }
  | {
      kind: "district";
      id: string;
      feature: CityDistrict;
      distance: number;
    };

export type CityHitTestOptions = {
  /** Normalized city-coordinate tolerance. */
  tolerance?: number;
  include?: Partial<Record<CityFeatureRef["kind"], boolean>>;
};

type Point = { x: number; y: number };
type CityRoad = CityMap["roads"][number];

type Surface = {
  width: number;
  height: number;
  dpr: number;
};

type ViewTransform = {
  mode: CityViewMode;
  width: number;
  height: number;
  centreX: number;
  centreY: number;
  scale: number;
  zoom: number;
  squash: number;
};

type LabelCandidate = {
  text: string;
  point: Point;
  priority: number;
  style: "district" | "road" | "building";
};

const DEFAULT_LAYERS: CityLayerVisibility = {
  ground: true,
  districts: true,
  roads: true,
  buildings: true,
  districtLabels: true,
  roadLabels: true,
  buildingLabels: true,
};

const FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const SQRT_HALF = Math.SQRT1_2;
const TAU = Math.PI * 2;

const DISTRICT_COLORS: Record<string, string> = {
  civic: "#9a774f",
  centre: "#9a774f",
  commercial: "#a66d50",
  market: "#a66d50",
  downtown: "#a66d50",
  residential: "#7f8b67",
  ward: "#817b68",
  edge: "#80866a",
  outskirts: "#7d866a",
  industrial: "#74786f",
  harbor: "#5f7f7b",
  green: "#75865e",
  mixed: "#887c68",
};

const BUILDING_COLORS: Record<NormalizedBuildingKind, string> = {
  residential: "#9e785b",
  commercial: "#b08a54",
  industrial: "#73766e",
  civic: "#a3855f",
  landmark: "#9f614b",
};

type NormalizedBuildingKind =
  | "residential"
  | "commercial"
  | "industrial"
  | "civic"
  | "landmark";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safePositive(value: unknown, fallback: number): number {
  const result = finite(value, fallback);
  return result > 0 ? result : fallback;
}

function safeText(value: unknown, fallback = "", maxLength = 80): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function validPoint(point: { x: number; y: number } | undefined | null): point is Point {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function normalizeSeed(seed: unknown): number {
  return (Math.trunc(finite(seed, 1)) >>> 0) || 1;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomUnit(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967296;
}

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function toHex(red: number, green: number, blue: number): string {
  const channel = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function mixColor(first: string, second: string, amount: number): string {
  const a = parseHex(first);
  const b = parseHex(second);
  if (!a || !b) return second;
  const t = clamp(amount, 0, 1);
  return toHex(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  );
}

function alphaColor(color: string, alpha: number): string {
  const channels = parseHex(color) ?? [80, 85, 72];
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${clamp(alpha, 0, 1)})`;
}

function normalizedBuildingKind(kind: CityBuilding["kind"]): NormalizedBuildingKind {
  if (kind === "private") return "residential";
  if (kind === "market") return "commercial";
  if (kind === "utility") return "industrial";
  if (kind === "public") return "civic";
  if (
    kind === "residential" ||
    kind === "commercial" ||
    kind === "industrial" ||
    kind === "civic" ||
    kind === "landmark"
  ) {
    return kind;
  }
  return "residential";
}

function resolvedLayers(layers: CityRenderOptions["layers"]): CityLayerVisibility {
  return { ...DEFAULT_LAYERS, ...layers };
}

function layoutRect(canvas: HTMLCanvasElement): DOMRect | null {
  try {
    return canvas.getBoundingClientRect();
  } catch {
    return null;
  }
}

function resolveSurface(
  canvas: HTMLCanvasElement,
  options: CityRenderOptions,
  resize: boolean
): Surface {
  const rectangle = layoutRect(canvas);
  const browserDpr = typeof window === "undefined" ? 1 : finite(window.devicePixelRatio, 1);
  const dpr = clamp(safePositive(options.viewport?.dpr, browserDpr), 0.5, 4);
  const layoutWidth = rectangle && rectangle.width > 0 ? rectangle.width : canvas.clientWidth;
  const layoutHeight = rectangle && rectangle.height > 0 ? rectangle.height : canvas.clientHeight;
  const width = clamp(
    safePositive(options.viewport?.width, layoutWidth > 0 ? layoutWidth : canvas.width / dpr || 800),
    1,
    16384
  );
  const height = clamp(
    safePositive(options.viewport?.height, layoutHeight > 0 ? layoutHeight : canvas.height / dpr || 600),
    1,
    16384
  );

  if (resize) {
    const bitmapWidth = Math.max(1, Math.round(width * dpr));
    const bitmapHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
    if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  }

  return { width, height, dpr };
}

function projectedLocal(point: Point, mode: CityViewMode, squash: number): Point {
  if (mode === "topdown") return point;
  return {
    x: (point.x - point.y) * SQRT_HALF,
    y: (point.x + point.y) * SQRT_HALF * squash,
  };
}

function createTransform(
  surface: Surface,
  map: Pick<CityMap, "width" | "height">,
  options: CityRenderOptions
): ViewTransform {
  const mode = options.viewMode ?? "topdown";
  const width = safePositive(map.width, 1);
  const height = safePositive(map.height, 1);
  const squash = clamp(finite(options.isometricSquash, 0.56), 0.3, 0.85);
  const zoom = clamp(safePositive(options.viewport?.zoom, 1), 0.2, 12);
  const padding = clamp(
    finite(options.viewport?.padding, Math.max(22, Math.min(surface.width, surface.height) * 0.055)),
    0,
    Math.min(surface.width, surface.height) * 0.44
  );
  const availableWidth = Math.max(1, surface.width - padding * 2);
  const availableHeight = Math.max(1, surface.height - padding * 2);
  const corners = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map((point) => projectedLocal(point, mode, squash));
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  const scale = Math.min(
    availableWidth / Math.max(0.0001, maxX - minX),
    availableHeight / Math.max(0.0001, maxY - minY)
  );
  return {
    mode,
    width,
    height,
    centreX: surface.width / 2 + finite(options.viewport?.panX, 0),
    centreY: surface.height / 2 + finite(options.viewport?.panY, 0),
    scale,
    zoom,
    squash,
  };
}

function cityToScreen(point: Point, transform: ViewTransform): Point {
  const local = {
    x: point.x * transform.width - transform.width / 2,
    y: point.y * transform.height - transform.height / 2,
  };
  const projected = projectedLocal(local, transform.mode, transform.squash);
  const viewScale = transform.scale * transform.zoom;
  return {
    x: transform.centreX + projected.x * viewScale,
    y: transform.centreY + projected.y * viewScale,
  };
}

function screenToCity(point: Point, transform: ViewTransform): Point {
  const viewScale = Math.max(0.0001, transform.scale * transform.zoom);
  const projected = {
    x: (point.x - transform.centreX) / viewScale,
    y: (point.y - transform.centreY) / viewScale,
  };
  let local = projected;
  if (transform.mode === "isometric") {
    const unsquashedY = projected.y / transform.squash;
    local = {
      x: (projected.x + unsquashedY) * SQRT_HALF,
      y: (unsquashedY - projected.x) * SQRT_HALF,
    };
  }
  return {
    x: (local.x + transform.width / 2) / transform.width,
    y: (local.y + transform.height / 2) / transform.height,
  };
}

function polygonPath(context: CanvasRenderingContext2D, points: ReadonlyArray<Point>): void {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
}

function linePath(context: CanvasRenderingContext2D, points: ReadonlyArray<Point>): void {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
}

function mapBoundary(transform: ViewTransform): Point[] {
  return [
    cityToScreen({ x: 0, y: 0 }, transform),
    cityToScreen({ x: 1, y: 0 }, transform),
    cityToScreen({ x: 1, y: 1 }, transform),
    cityToScreen({ x: 0, y: 1 }, transform),
  ];
}

function districtPoints(district: CityDistrict): Point[] {
  const explicit = district.points?.filter(validPoint);
  if (explicit && explicit.length >= 3) return explicit;
  const x = finite(district.x, 0.5);
  const y = finite(district.y, 0.5);
  const radius = clamp(safePositive(district.radius, 0.08), 0.005, 0.75);
  return Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * TAU;
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
  });
}

function polygonCentroid(points: ReadonlyArray<Point>): Point {
  if (!points.length) return { x: 0.5, y: 0.5 };
  let area = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    area += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  if (Math.abs(area) < 0.000001) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  return { x: x / (3 * area), y: y / (3 * area) };
}

function screenBounds(points: ReadonlyArray<Point>): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function drawGround(
  context: CanvasRenderingContext2D,
  surface: Surface,
  transform: ViewTransform,
  map: CityMap,
  background: string
): void {
  context.fillStyle = /^#[0-9a-f]{6}$/i.test(background) ? background : "#0c211b";
  context.fillRect(0, 0, surface.width, surface.height);
  const boundary = mapBoundary(transform);

  context.save();
  context.shadowColor = "rgba(1, 12, 9, 0.48)";
  context.shadowBlur = 22;
  context.shadowOffsetY = 10;
  polygonPath(context, boundary);
  context.fillStyle = "#d7ceb0";
  context.fill();
  context.restore();

  context.save();
  polygonPath(context, boundary);
  context.clip();
  const wash = context.createLinearGradient(0, 0, surface.width, surface.height);
  wash.addColorStop(0, "#e1d8bb");
  wash.addColorStop(0.52, "#d2c8a8");
  wash.addColorStop(1, "#c3b998");
  context.fillStyle = wash;
  context.fillRect(0, 0, surface.width, surface.height);

  const seed = normalizeSeed(map.seed);
  const fleckCount = Math.round(clamp((surface.width * surface.height) / 4200, 100, 360));
  context.fillStyle = "rgba(65, 68, 53, 0.085)";
  context.beginPath();
  for (let index = 0; index < fleckCount; index += 1) {
    const point = cityToScreen(
      { x: randomUnit(seed, index * 3), y: randomUnit(seed, index * 3 + 1) },
      transform
    );
    const radius = 0.3 + randomUnit(seed, index * 3 + 2) * 1.05;
    context.moveTo(point.x + radius, point.y);
    context.arc(point.x, point.y, radius, 0, TAU);
  }
  context.fill();

  context.strokeStyle = "rgba(84, 78, 57, 0.055)";
  context.lineWidth = 0.65;
  context.beginPath();
  for (let index = 0; index < Math.min(42, Math.ceil(fleckCount / 6)); index += 1) {
    const start = cityToScreen(
      { x: randomUnit(seed, 2000 + index * 4), y: randomUnit(seed, 2001 + index * 4) },
      transform
    );
    const length = 4 + randomUnit(seed, 2002 + index * 4) * 16;
    const angle = randomUnit(seed, 2003 + index * 4) * TAU;
    context.moveTo(start.x, start.y);
    context.lineTo(start.x + Math.cos(angle) * length, start.y + Math.sin(angle) * length);
  }
  context.stroke();
  context.restore();

  polygonPath(context, boundary);
  context.strokeStyle = "rgba(54, 54, 42, 0.68)";
  context.lineWidth = 1.5;
  context.stroke();
  polygonPath(context, boundary);
  context.strokeStyle = "rgba(243, 232, 195, 0.55)";
  context.lineWidth = 0.55;
  context.stroke();
}

function districtBaseColor(district: CityDistrict): string {
  const kindColor = DISTRICT_COLORS[district.kind] ?? DISTRICT_COLORS.mixed;
  const savedColor = /^#[0-9a-f]{6}$/i.test(district.color) ? district.color : kindColor;
  return mixColor(savedColor, kindColor, 0.72);
}

function drawDistrictPattern(
  context: CanvasRenderingContext2D,
  kind: CityDistrict["kind"],
  bounds: ReturnType<typeof screenBounds>,
  color: string
): void {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width < 18 || height < 14) return;
  const spacing = clamp(Math.min(width, height) / 5, 9, 18);
  context.strokeStyle = alphaColor(color, 0.26);
  context.fillStyle = alphaColor(color, 0.25);
  context.lineWidth = 0.8;

  if (kind === "green") {
    const columns = Math.min(9, Math.ceil(width / spacing));
    const rows = Math.min(7, Math.ceil(height / spacing));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = bounds.minX + (column + 0.65) * (width / columns);
        const y = bounds.minY + (row + 0.55) * (height / rows);
        context.beginPath();
        context.arc(x, y, 1.25, 0, TAU);
        context.fill();
      }
    }
    return;
  }

  if (kind === "harbor") {
    const rows = Math.min(9, Math.ceil(height / spacing));
    for (let row = 0; row < rows; row += 1) {
      const y = bounds.minY + (row + 0.7) * (height / rows);
      context.beginPath();
      context.moveTo(bounds.minX, y);
      for (let x = bounds.minX; x < bounds.maxX; x += 12) {
        context.quadraticCurveTo(x + 3, y - 2, x + 6, y);
        context.quadraticCurveTo(x + 9, y + 2, x + 12, y);
      }
      context.stroke();
    }
    return;
  }

  const diagonal =
    kind === "industrial" || kind === "commercial" || kind === "market" || kind === "downtown";
  if (diagonal) {
    const span = width + height;
    const lineCount = Math.min(24, Math.ceil(span / spacing));
    for (let index = -2; index < lineCount; index += 1) {
      const offset = index * spacing;
      context.beginPath();
      context.moveTo(bounds.minX + offset - height, bounds.maxY);
      context.lineTo(bounds.minX + offset, bounds.minY);
      context.stroke();
    }
    if (kind === "industrial") {
      for (let index = -2; index < lineCount; index += 1) {
        const offset = index * spacing;
        context.beginPath();
        context.moveTo(bounds.maxX - offset + height, bounds.maxY);
        context.lineTo(bounds.maxX - offset, bounds.minY);
        context.stroke();
      }
    }
    return;
  }

  const rowCount = Math.min(12, Math.ceil(height / spacing));
  for (let row = 0; row < rowCount; row += 1) {
    const y = bounds.minY + (row + 0.7) * (height / rowCount);
    context.setLineDash([Math.max(3, spacing * 0.45), Math.max(4, spacing * 0.55)]);
    context.beginPath();
    context.moveTo(bounds.minX, y);
    context.lineTo(bounds.maxX, y);
    context.stroke();
  }
  context.setLineDash([]);
}

function drawDistricts(
  context: CanvasRenderingContext2D,
  map: CityMap,
  transform: ViewTransform,
  labels: LabelCandidate[]
): number {
  let count = 0;
  for (const district of map.districts ?? []) {
    const points = districtPoints(district);
    if (points.length < 3) continue;
    const projected = points.map((point) => cityToScreen(point, transform));
    const color = districtBaseColor(district);
    polygonPath(context, projected);
    context.fillStyle = alphaColor(color, 0.28);
    context.fill();

    context.save();
    polygonPath(context, projected);
    context.clip();
    drawDistrictPattern(context, district.kind, screenBounds(projected), color);
    context.restore();

    polygonPath(context, projected);
    context.strokeStyle = alphaColor(mixColor(color, "#403e32", 0.42), 0.68);
    context.lineWidth = 1.05;
    context.setLineDash([5, 3]);
    context.stroke();
    context.setLineDash([]);

    const name = safeText(district.name, "District", 52);
    if (name) {
      labels.push({
        text: name,
        point: cityToScreen(polygonCentroid(points), transform),
        priority: district.kind === "civic" || district.kind === "centre" ? 82 : 72,
        style: "district",
      });
    }
    count += 1;
  }
  return count;
}

function projectedRoadPoints(road: CityRoad, transform: ViewTransform): Point[] {
  return road.points.filter(validPoint).map((point) => cityToScreen(point, transform));
}

function roadSurfaceWidth(road: CityRoad, zoom: number): number {
  const base = road.importance === "main" ? 7.2 : road.importance === "secondary" ? 4.7 : 2.4;
  const tier = clamp(finite(road.tier, road.importance === "main" ? 4 : 2), 1, 5);
  const tierOffset = road.importance === "main" ? (tier - 3) * 0.45 : (tier - 2) * 0.2;
  return Math.max(1.3, (base + tierOffset) * clamp(Math.sqrt(zoom), 0.72, 2.1));
}

function roadIsBridge(road: CityRoad): boolean {
  return /\b(bridge|causeway|viaduct)\b/i.test(road.name);
}

function roadIsApproach(road: CityRoad): boolean {
  return road.external_connection_index !== null && road.external_connection_index !== undefined;
}

function roadLayerOrder(road: CityRoad): number {
  if (road.importance === "alley") return 0;
  if (road.importance === "secondary") return 1;
  return 2;
}

function longestRoadSegment(points: ReadonlyArray<Point>): { point: Point; length: number } | null {
  let best: { point: Point; length: number } | null = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!best || length > best.length) {
      best = { point: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, length };
    }
  }
  return best;
}

function drawBridgeSleepers(
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<Point>,
  width: number
): void {
  context.strokeStyle = "rgba(61, 57, 44, 0.72)";
  context.lineWidth = 0.8;
  let drawn = 0;
  for (let index = 0; index < points.length - 1 && drawn < 90; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const spacing = Math.max(5, width * 0.8);
    for (let distance = spacing * 0.65; distance < length; distance += spacing) {
      const x = start.x + (dx * distance) / length;
      const y = start.y + (dy * distance) / length;
      const nx = (-dy / length) * width * 0.63;
      const ny = (dx / length) * width * 0.63;
      context.beginPath();
      context.moveTo(x - nx, y - ny);
      context.lineTo(x + nx, y + ny);
      context.stroke();
      drawn += 1;
      if (drawn >= 90) break;
    }
  }
}

function drawRoads(
  context: CanvasRenderingContext2D,
  map: CityMap,
  transform: ViewTransform,
  labels: LabelCandidate[]
): number {
  const roads = map.roads
    .filter((road) => road.points.filter(validPoint).length >= 2)
    .slice()
    .sort((first, second) => roadLayerOrder(first) - roadLayerOrder(second));
  const projected = roads.map((road) => ({ road, points: projectedRoadPoints(road, transform) }));
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const entry of projected) {
    const width = roadSurfaceWidth(entry.road, transform.zoom);
    linePath(context, entry.points);
    context.strokeStyle = roadIsBridge(entry.road) ? "#49483e" : "#4a4638";
    context.lineWidth = width + (entry.road.importance === "main" ? 3.2 : 2.4);
    context.stroke();
  }
  for (const entry of projected) {
    const width = roadSurfaceWidth(entry.road, transform.zoom);
    linePath(context, entry.points);
    context.strokeStyle = entry.road.importance === "alley"
      ? "#a99d7e"
      : roadIsApproach(entry.road)
        ? "#c9b986"
        : "#c8ba91";
    context.lineWidth = width;
    context.stroke();
  }
  for (const entry of projected) {
    const width = roadSurfaceWidth(entry.road, transform.zoom);
    if (roadIsBridge(entry.road)) {
      drawBridgeSleepers(context, entry.points, width);
    } else if (entry.road.importance === "main" && width >= 5) {
      linePath(context, entry.points);
      context.strokeStyle = "rgba(244, 228, 180, 0.54)";
      context.lineWidth = 0.8;
      context.setLineDash(roadIsApproach(entry.road) ? [6, 5] : [9, 7]);
      context.stroke();
      context.setLineDash([]);
    }

    const name = safeText(entry.road.name, "", 56);
    const segment = longestRoadSegment(entry.points);
    const shouldLabel =
      Boolean(name && segment && segment.length >= 48) &&
      (entry.road.importance === "main" ||
        (entry.road.importance === "secondary" && transform.zoom >= 1.2));
    if (shouldLabel && segment) {
      labels.push({
        text: name,
        point: segment.point,
        priority: roadIsApproach(entry.road) ? 68 : entry.road.importance === "main" ? 62 : 48,
        style: "road",
      });
    }
  }
  return projected.length;
}

function buildingDimensions(building: CityBuilding): { width: number; depth: number; rotation: number } {
  const footprint = clamp(safePositive(building.footprint, 0.012), 0.002, 0.25);
  return {
    width: clamp(safePositive(building.width, footprint), 0.002, 0.25),
    depth: clamp(safePositive(building.height, footprint * 0.82), 0.002, 0.25),
    rotation: finite(building.rotation, 0),
  };
}

function buildingCorners(building: CityBuilding): Point[] {
  const dimensions = buildingDimensions(building);
  const cosine = Math.cos(dimensions.rotation);
  const sine = Math.sin(dimensions.rotation);
  const centreX = finite(building.x, 0.5);
  const centreY = finite(building.y, 0.5);
  return [
    { x: -dimensions.width / 2, y: -dimensions.depth / 2 },
    { x: dimensions.width / 2, y: -dimensions.depth / 2 },
    { x: dimensions.width / 2, y: dimensions.depth / 2 },
    { x: -dimensions.width / 2, y: dimensions.depth / 2 },
  ].map((point) => ({
    x: centreX + point.x * cosine - point.y * sine,
    y: centreY + point.x * sine + point.y * cosine,
  }));
}

function shifted(points: ReadonlyArray<Point>, x: number, y: number): Point[] {
  return points.map((point) => ({ x: point.x + x, y: point.y + y }));
}

function scaledPolygon(points: ReadonlyArray<Point>, amount: number): Point[] {
  const centre = {
    x: points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length),
    y: points.reduce((sum, point) => sum + point.y, 0) / Math.max(1, points.length),
  };
  return points.map((point) => ({
    x: centre.x + (point.x - centre.x) * amount,
    y: centre.y + (point.y - centre.y) * amount,
  }));
}

function outsideViewport(points: ReadonlyArray<Point>, surface: Surface, margin = 24): boolean {
  const bounds = screenBounds(points);
  return (
    bounds.maxX < -margin ||
    bounds.maxY < -margin ||
    bounds.minX > surface.width + margin ||
    bounds.minY > surface.height + margin
  );
}

function elevationForBuilding(
  building: CityBuilding,
  kind: NormalizedBuildingKind,
  transform: ViewTransform,
  maximum: number
): number {
  if (transform.mode !== "isometric" || maximum <= 0) return 0;
  const dimensions = buildingDimensions(building);
  const footprintPixels = Math.sqrt(dimensions.width * dimensions.depth) * transform.scale * transform.zoom;
  const kindFactor = kind === "landmark" ? 1.05 : kind === "civic" ? 0.78 : kind === "industrial" ? 0.48 : 0.58;
  return clamp(1.5 + footprintPixels * kindFactor, 1.5, maximum);
}

function drawBuildingDetail(
  context: CanvasRenderingContext2D,
  roof: ReadonlyArray<Point>,
  kind: NormalizedBuildingKind,
  color: string,
  variation: number
): void {
  if (roof.length < 4) return;
  const bounds = screenBounds(roof);
  if (bounds.maxX - bounds.minX < 4 || bounds.maxY - bounds.minY < 3) return;
  context.strokeStyle = alphaColor(mixColor(color, "#f1ddb1", 0.32), 0.72);
  context.fillStyle = alphaColor(mixColor(color, "#3e4639", 0.3), 0.72);
  context.lineWidth = 0.7;

  if (kind === "residential") {
    const firstMid = { x: (roof[0].x + roof[1].x) / 2, y: (roof[0].y + roof[1].y) / 2 };
    const secondMid = { x: (roof[2].x + roof[3].x) / 2, y: (roof[2].y + roof[3].y) / 2 };
    const alternateFirst = { x: (roof[1].x + roof[2].x) / 2, y: (roof[1].y + roof[2].y) / 2 };
    const alternateSecond = { x: (roof[3].x + roof[0].x) / 2, y: (roof[3].y + roof[0].y) / 2 };
    context.beginPath();
    if (variation > 0.5) {
      context.moveTo(firstMid.x, firstMid.y);
      context.lineTo(secondMid.x, secondMid.y);
    } else {
      context.moveTo(alternateFirst.x, alternateFirst.y);
      context.lineTo(alternateSecond.x, alternateSecond.y);
    }
    context.stroke();
    return;
  }

  const inset = scaledPolygon(roof, kind === "landmark" ? 0.36 : 0.52);
  polygonPath(context, inset);
  if (kind === "commercial") {
    context.stroke();
  } else if (kind === "industrial") {
    context.fill();
    const centre = polygonCentroid(roof);
    context.beginPath();
    context.arc(centre.x, centre.y, 1.1, 0, TAU);
    context.fill();
  } else if (kind === "civic") {
    const centre = polygonCentroid(roof);
    context.beginPath();
    context.moveTo(inset[0].x, inset[0].y);
    context.lineTo(inset[2].x, inset[2].y);
    context.moveTo(inset[1].x, inset[1].y);
    context.lineTo(inset[3].x, inset[3].y);
    context.stroke();
    context.beginPath();
    context.arc(centre.x, centre.y, 1.15, 0, TAU);
    context.fill();
  } else {
    polygonPath(context, inset);
    context.fill();
  }
}

function buildingHasUsefulLabel(building: CityBuilding, kind: NormalizedBuildingKind): boolean {
  if (building.role || kind === "landmark") return true;
  if (kind === "civic" && building.name && !/^building \d+$/i.test(building.name)) return true;
  return building.source === "manual" && Boolean(building.name);
}

function drawBuildings(
  context: CanvasRenderingContext2D,
  map: CityMap,
  surface: Surface,
  transform: ViewTransform,
  labels: LabelCandidate[],
  maxExtrusion: number
): { rendered: number; culled: number } {
  const seed = normalizeSeed(map.seed);
  const buildings = map.buildings
    .filter((building) => Number.isFinite(building.x) && Number.isFinite(building.y))
    .slice();
  if (transform.mode === "isometric") {
    buildings.sort((first, second) => first.x + first.y - (second.x + second.y));
  }
  let rendered = 0;
  let culled = 0;
  for (const building of buildings) {
    const base = buildingCorners(building).map((point) => cityToScreen(point, transform));
    if (outsideViewport(base, surface)) {
      culled += 1;
      continue;
    }
    const kind = normalizedBuildingKind(building.kind);
    const identitySeed = seed ^ hashText(building.id);
    const variation = randomUnit(identitySeed, 0);
    const baseColor = BUILDING_COLORS[kind];
    const color = mixColor(baseColor, variation > 0.58 ? "#c0a276" : "#6f6250", 0.08 + variation * 0.12);
    const elevation = elevationForBuilding(building, kind, transform, maxExtrusion);
    const roof = elevation > 0 ? shifted(base, 0, -elevation) : base;

    polygonPath(context, shifted(base, elevation > 0 ? elevation * 0.5 : 1.3, elevation > 0 ? elevation * 0.72 : 1.8));
    context.fillStyle = "rgba(35, 37, 30, 0.2)";
    context.fill();

    if (elevation > 0) {
      const baseCentre = polygonCentroid(base);
      for (let index = 0; index < base.length; index += 1) {
        const nextIndex = (index + 1) % base.length;
        const midpointY = (base[index].y + base[nextIndex].y) / 2;
        if (midpointY < baseCentre.y - 0.25) continue;
        polygonPath(context, [base[index], base[nextIndex], roof[nextIndex], roof[index]]);
        context.fillStyle = index % 2 === 0
          ? mixColor(color, "#383b35", 0.36)
          : mixColor(color, "#51483c", 0.27);
        context.fill();
      }
    }

    polygonPath(context, roof);
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = "rgba(55, 53, 43, 0.82)";
    context.lineWidth = kind === "landmark" ? 1.25 : 0.75;
    context.stroke();
    drawBuildingDetail(context, roof, kind, color, variation);

    if (buildingHasUsefulLabel(building, kind)) {
      const label = safeText(building.role || building.name, kind === "landmark" ? "Landmark" : "", 58);
      if (label) {
        labels.push({
          text: label,
          point: { x: polygonCentroid(roof).x, y: Math.min(...roof.map((point) => point.y)) - 7 },
          priority: kind === "landmark" ? 110 : kind === "civic" ? 96 : 88,
          style: "building",
        });
      }
    }
    rendered += 1;
  }
  return { rendered, culled };
}

function roundedRectanglePath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function rectanglesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    first.x + first.width < second.x ||
    second.x + second.width < first.x ||
    first.y + first.height < second.y ||
    second.y + second.height < first.y
  );
}

function drawLabels(
  context: CanvasRenderingContext2D,
  labels: LabelCandidate[],
  surface: Surface,
  layers: CityLayerVisibility
): number {
  const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
  let rendered = 0;
  const sorted = labels.slice().sort((first, second) => second.priority - first.priority);
  for (const label of sorted) {
    if (
      (label.style === "district" && !layers.districtLabels) ||
      (label.style === "road" && !layers.roadLabels) ||
      (label.style === "building" && !layers.buildingLabels)
    ) {
      continue;
    }
    const fontSize = label.style === "district" ? 10 : label.style === "road" ? 9 : 10.5;
    const weight = label.style === "road" ? "500" : "650";
    context.font = `${weight} ${fontSize}px ${FONT_STACK}`;
    const text = label.style === "district" ? label.text.toLocaleUpperCase() : label.text;
    const textWidth = context.measureText(text).width;
    const horizontalPadding = label.style === "district" ? 6 : 5;
    const width = textWidth + horizontalPadding * 2;
    const height = fontSize + 7;
    const rectangle = {
      x: label.point.x - width / 2,
      y: label.point.y - height / 2,
      width,
      height,
    };
    if (
      rectangle.x < 3 ||
      rectangle.y < 3 ||
      rectangle.x + rectangle.width > surface.width - 3 ||
      rectangle.y + rectangle.height > surface.height - 3 ||
      occupied.some((existing) => rectanglesOverlap(existing, rectangle))
    ) {
      continue;
    }
    roundedRectanglePath(context, rectangle.x, rectangle.y, rectangle.width, rectangle.height, 4);
    context.fillStyle = label.style === "road" ? "rgba(232, 218, 179, 0.84)" : "rgba(239, 229, 198, 0.9)";
    context.fill();
    context.strokeStyle = label.style === "district" ? "rgba(68, 70, 56, 0.38)" : "rgba(69, 60, 45, 0.3)";
    context.lineWidth = 0.65;
    context.stroke();
    context.fillStyle = label.style === "district" ? "#3f493c" : "#423d31";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, label.point.x, label.point.y + 0.25);
    occupied.push({
      x: rectangle.x - 3,
      y: rectangle.y - 2,
      width: rectangle.width + 6,
      height: rectangle.height + 4,
    });
    rendered += 1;
  }
  return rendered;
}

function drawFeatureOutline(
  context: CanvasRenderingContext2D,
  map: CityMap,
  transform: ViewTransform,
  reference: CityFeatureRef,
  color: string,
  dashed: boolean
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = reference.kind === "road" ? 3.2 : 2.2;
  context.setLineDash(dashed ? [5, 4] : []);
  context.shadowColor = color;
  context.shadowBlur = dashed ? 0 : 7;
  if (reference.kind === "district") {
    const district = map.districts?.find((item) => item.id === reference.id);
    if (district) {
      polygonPath(context, districtPoints(district).map((point) => cityToScreen(point, transform)));
      context.stroke();
    }
  } else if (reference.kind === "road") {
    const road = map.roads.find((item) => item.id === reference.id);
    if (road) {
      linePath(context, projectedRoadPoints(road, transform));
      context.lineWidth += roadSurfaceWidth(road, transform.zoom);
      context.stroke();
    }
  } else {
    const building = map.buildings.find((item) => item.id === reference.id);
    if (building) {
      polygonPath(context, buildingCorners(building).map((point) => cityToScreen(point, transform)));
      context.stroke();
    }
  }
  context.restore();
}

function drawEditorOverlays(
  context: CanvasRenderingContext2D,
  map: CityMap,
  transform: ViewTransform,
  overlays: CityEditorOverlayOptions
): void {
  if (overlays.hovered) {
    drawFeatureOutline(context, map, transform, overlays.hovered, "rgba(244, 218, 143, 0.9)", true);
  }
  if (overlays.selected) {
    drawFeatureOutline(context, map, transform, overlays.selected, "#f0bd58", false);
  }

  const nodeRoadId = overlays.roadNodeRoadId ?? (
    overlays.selected?.kind === "road" ? overlays.selected.id : null
  );
  if (overlays.showRoadNodes && nodeRoadId) {
    const road = map.roads.find((item) => item.id === nodeRoadId);
    if (road) {
      for (const point of road.points.filter(validPoint)) {
        const screen = cityToScreen(point, transform);
        context.beginPath();
        context.arc(screen.x, screen.y, 4.4, 0, TAU);
        context.fillStyle = "#f6e8bb";
        context.fill();
        context.strokeStyle = "#38594b";
        context.lineWidth = 1.7;
        context.stroke();
      }
    }
  }

  const draft = overlays.draftRoad?.filter(validPoint).map((point) => cityToScreen(point, transform)) ?? [];
  if (draft.length) {
    linePath(context, draft);
    context.strokeStyle = "#f0bd58";
    context.lineWidth = 2;
    context.setLineDash([7, 5]);
    context.stroke();
    context.setLineDash([]);
    for (const point of draft) {
      context.beginPath();
      context.arc(point.x, point.y, 3.2, 0, TAU);
      context.fillStyle = "#f0bd58";
      context.fill();
      context.strokeStyle = "#183d31";
      context.lineWidth = 1;
      context.stroke();
    }
  }
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function emptyStats(surface: Surface, options: CityRenderOptions, startedAt: number): CityRenderStats {
  return {
    contextAvailable: false,
    viewMode: options.viewMode ?? "topdown",
    viewportWidth: surface.width,
    viewportHeight: surface.height,
    dpr: surface.dpr,
    zoom: clamp(safePositive(options.viewport?.zoom, 1), 0.2, 12),
    renderedDistricts: 0,
    renderedRoads: 0,
    renderedBuildings: 0,
    culledBuildings: 0,
    renderedLabels: 0,
    durationMs: Math.max(0, now() - startedAt),
  };
}

/**
 * Draws a complete city map. Source geometry is never mutated. Editor overlays are
 * opt-in so the same function can produce both a clean presentation and an editor view.
 */
export function drawCityMap(
  canvas: HTMLCanvasElement,
  map: CityMap,
  options: CityRenderOptions = {}
): CityRenderStats {
  const startedAt = now();
  const surface = resolveSurface(canvas, options, options.resizeCanvas !== false);
  const context = canvas.getContext("2d");
  if (!context) return emptyStats(surface, options, startedAt);
  const transform = createTransform(surface, map, options);
  const layers = resolvedLayers(options.layers);
  const labels: LabelCandidate[] = [];
  let renderedDistricts = 0;
  let renderedRoads = 0;
  let renderedBuildings = 0;
  let culledBuildings = 0;

  context.save();
  context.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0);
  context.clearRect(0, 0, surface.width, surface.height);
  context.imageSmoothingEnabled = true;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  if (layers.ground) {
    drawGround(context, surface, transform, map, options.background ?? "#0c211b");
  } else {
    context.fillStyle = /^#[0-9a-f]{6}$/i.test(options.background ?? "")
      ? options.background!
      : "#0c211b";
    context.fillRect(0, 0, surface.width, surface.height);
  }

  const boundary = mapBoundary(transform);
  context.save();
  polygonPath(context, boundary);
  context.clip();
  if (layers.districts) renderedDistricts = drawDistricts(context, map, transform, labels);
  if (layers.roads) renderedRoads = drawRoads(context, map, transform, labels);
  if (layers.buildings) {
    const buildingResult = drawBuildings(
      context,
      map,
      surface,
      transform,
      labels,
      clamp(finite(options.maxBuildingExtrusion, 11), 0, 28)
    );
    renderedBuildings = buildingResult.rendered;
    culledBuildings = buildingResult.culled;
  }
  context.restore();

  const renderedLabels = drawLabels(context, labels, surface, layers);
  if (options.overlays) drawEditorOverlays(context, map, transform, options.overlays);
  context.restore();

  return {
    contextAvailable: true,
    viewMode: transform.mode,
    viewportWidth: surface.width,
    viewportHeight: surface.height,
    dpr: surface.dpr,
    zoom: transform.zoom,
    renderedDistricts,
    renderedRoads,
    renderedBuildings,
    culledBuildings,
    renderedLabels,
    durationMs: Math.max(0, now() - startedAt),
  };
}

/**
 * Converts either client coordinates (default) or canvas-local CSS pixels to a
 * normalized city coordinate using exactly the transform used by drawCityMap.
 */
export function screenToCityPoint(
  canvas: HTMLCanvasElement,
  map: Pick<CityMap, "width" | "height">,
  screenX: number,
  screenY: number,
  options: CityRenderOptions = {}
): Point | null {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
  const surface = resolveSurface(canvas, options, false);
  const rectangle = layoutRect(canvas);
  const coordinates = options.pointerCoordinates ?? "client";
  const canvasPoint = coordinates === "client"
    ? {
        x: screenX - finite(rectangle?.left, 0),
        y: screenY - finite(rectangle?.top, 0),
      }
    : { x: screenX, y: screenY };
  const point = screenToCity(canvasPoint, createTransform(surface, map, options));
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (options.clampPointerToBounds) {
    return { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
  }
  return point;
}

function pointSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.0000000001) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1
  );
  return Math.hypot(point.x - (start.x + dx * projection), point.y - (start.y + dy * projection));
}

function pointInPolygon(point: Point, polygon: ReadonlyArray<Point>): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonDistance(point: Point, polygon: ReadonlyArray<Point>): number {
  if (pointInPolygon(point, polygon)) return 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(distance, pointSegmentDistance(point, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  return distance;
}

function buildingDistance(point: Point, building: CityBuilding): number {
  const dimensions = buildingDimensions(building);
  const dx = point.x - finite(building.x, 0.5);
  const dy = point.y - finite(building.y, 0.5);
  const cosine = Math.cos(-dimensions.rotation);
  const sine = Math.sin(-dimensions.rotation);
  const localX = dx * cosine - dy * sine;
  const localY = dx * sine + dy * cosine;
  const outsideX = Math.max(Math.abs(localX) - dimensions.width / 2, 0);
  const outsideY = Math.max(Math.abs(localY) - dimensions.depth / 2, 0);
  return Math.hypot(outsideX, outsideY);
}

/**
 * Hit-tests normalized city coordinates. Buildings win over roads, and roads win
 * over districts, matching the editor's expected direct-manipulation priority.
 */
export function hitTestCityFeature(
  map: CityMap,
  point: Point,
  options: CityHitTestOptions = {}
): CityFeatureHit | null {
  if (!validPoint(point)) return null;
  const tolerance = clamp(finite(options.tolerance, 0.012), 0, 0.25);
  const include = {
    building: options.include?.building !== false,
    road: options.include?.road !== false,
    district: options.include?.district !== false,
  };

  if (include.building) {
    let nearest: CityFeatureHit | null = null;
    for (const building of map.buildings) {
      if (!Number.isFinite(building.x) || !Number.isFinite(building.y)) continue;
      const distance = buildingDistance(point, building);
      if (distance <= tolerance && (!nearest || distance < nearest.distance)) {
        nearest = { kind: "building", id: building.id, feature: building, distance };
      }
    }
    if (nearest) return nearest;
  }

  if (include.road) {
    let nearestRoad: CityFeatureHit | null = null;
    for (const road of map.roads) {
      const points = road.points.filter(validPoint);
      for (let index = 0; index < points.length - 1; index += 1) {
        const distance = pointSegmentDistance(point, points[index], points[index + 1]);
        const importanceAllowance = road.importance === "main" ? 0.004 : road.importance === "secondary" ? 0.002 : 0;
        if (distance <= tolerance + importanceAllowance && (!nearestRoad || distance < nearestRoad.distance)) {
          nearestRoad = { kind: "road", id: road.id, feature: road, distance, segmentIndex: index };
        }
      }
    }
    if (nearestRoad) return nearestRoad;
  }

  if (include.district) {
    let nearestDistrict: CityFeatureHit | null = null;
    for (const district of map.districts ?? []) {
      const points = districtPoints(district);
      const distance = polygonDistance(point, points);
      if (distance <= tolerance && (!nearestDistrict || distance < nearestDistrict.distance)) {
        nearestDistrict = { kind: "district", id: district.id, feature: district, distance };
      }
    }
    if (nearestDistrict) return nearestDistrict;
  }

  return null;
}
