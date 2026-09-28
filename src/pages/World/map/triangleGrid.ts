import type { PixelPoint } from "./types";
import { clamp } from "./math";

export const TRIANGLE_HEIGHT_RATIO = Math.sqrt(3) / 2;
export const TRIANGLE_CENTROID_SPACING = 1 / Math.sqrt(3);

export type TriangleCell = {
  column: number;
  row: number;
  index: number;
};

export type TriangleNeighbor = TriangleCell & {
  heading: number;
};

export function triangleIsUp(column: number, row: number): boolean {
  return (column + row) % 2 === 0;
}

export function triangleGridSize(width: number, height: number, edge = 1) {
  return {
    width: ((width + 1) * edge) / 2,
    height: height * edge * TRIANGLE_HEIGHT_RATIO,
  };
}

export function triangleCellIndex(column: number, row: number, width: number): number {
  return row * width + column;
}

export function triangleCellCenterGrid(column: number, row: number): PixelPoint {
  const up = triangleIsUp(column, row);
  return {
    x: (column + 1) / 2,
    y: (row + (up ? 2 / 3 : 1 / 3)) * TRIANGLE_HEIGHT_RATIO,
  };
}

export function triangleCellCenterNormalized(
  column: number,
  row: number,
  width: number,
  height: number,
): PixelPoint {
  const size = triangleGridSize(width, height);
  const center = triangleCellCenterGrid(column, row);
  return { x: center.x / size.width, y: center.y / size.height };
}

export function triangleVerticesGrid(
  column: number,
  row: number,
  edge = 1,
): [PixelPoint, PixelPoint, PixelPoint] {
  const left = (column * edge) / 2;
  const top = row * edge * TRIANGLE_HEIGHT_RATIO;
  const right = left + edge;
  const middle = left + edge / 2;
  const bottom = top + edge * TRIANGLE_HEIGHT_RATIO;
  return triangleIsUp(column, row)
    ? [
        { x: left, y: bottom },
        { x: middle, y: top },
        { x: right, y: bottom },
      ]
    : [
        { x: left, y: top },
        { x: right, y: top },
        { x: middle, y: bottom },
      ];
}

function pointInTriangle(point: PixelPoint, vertices: readonly PixelPoint[]): boolean {
  const [a, b, c] = vertices;
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < Number.EPSILON) return false;
  const first = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
  const second = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
  const third = 1 - first - second;
  const epsilon = 1e-9;
  return first >= -epsilon && second >= -epsilon && third >= -epsilon;
}

export function normalizedPointToTriangleCell(
  point: PixelPoint,
  width: number,
  height: number,
): TriangleCell {
  const size = triangleGridSize(width, height);
  const gridPoint = {
    x: clamp(point.x) * size.width,
    y: clamp(point.y) * size.height,
  };
  const approximateRow = clamp(Math.floor(gridPoint.y / TRIANGLE_HEIGHT_RATIO), 0, height - 1);
  const approximateColumn = clamp(Math.floor(gridPoint.x * 2), 0, width - 1);
  let nearest: TriangleCell | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (
    let row = Math.max(0, approximateRow - 1);
    row <= Math.min(height - 1, approximateRow + 1);
    row += 1
  ) {
    for (
      let column = Math.max(0, approximateColumn - 2);
      column <= Math.min(width - 1, approximateColumn + 2);
      column += 1
    ) {
      const cell = { column, row, index: triangleCellIndex(column, row, width) };
      if (pointInTriangle(gridPoint, triangleVerticesGrid(column, row))) return cell;
      const center = triangleCellCenterGrid(column, row);
      const distance = Math.hypot(center.x - gridPoint.x, center.y - gridPoint.y);
      if (distance < nearestDistance) {
        nearest = cell;
        nearestDistance = distance;
      }
    }
  }
  return (
    nearest ?? {
      column: approximateColumn,
      row: approximateRow,
      index: triangleCellIndex(approximateColumn, approximateRow, width),
    }
  );
}

export function triangleCellNeighbors(
  column: number,
  row: number,
  width: number,
  height: number,
): TriangleNeighbor[] {
  const candidates: Array<readonly [number, number, number]> = [
    [column - 1, row, triangleIsUp(column, row) ? 3 : 2],
    [column + 1, row, triangleIsUp(column, row) ? 5 : 0],
    [column, row + (triangleIsUp(column, row) ? 1 : -1), triangleIsUp(column, row) ? 1 : 4],
  ];
  return candidates.flatMap(([nextColumn, nextRow, heading]) =>
    nextColumn >= 0 && nextRow >= 0 && nextColumn < width && nextRow < height
      ? [
          {
            column: nextColumn,
            row: nextRow,
            index: triangleCellIndex(nextColumn, nextRow, width),
            heading,
          },
        ]
      : [],
  );
}

export function normalizedToTriangleGridPoint(
  point: PixelPoint,
  width: number,
  height: number,
): PixelPoint {
  const size = triangleGridSize(width, height);
  return { x: point.x * size.width, y: point.y * size.height };
}

export function triangleGridPointToNormalized(
  point: PixelPoint,
  width: number,
  height: number,
): PixelPoint {
  const size = triangleGridSize(width, height);
  return { x: clamp(point.x / size.width), y: clamp(point.y / size.height) };
}

export function traceTrianglePath(
  context: CanvasRenderingContext2D,
  column: number,
  row: number,
  edge: number,
  offset: PixelPoint = { x: 0, y: 0 },
): void {
  const vertices = triangleVerticesGrid(column, row, edge);
  context.beginPath();
  context.moveTo(vertices[0].x + offset.x, vertices[0].y + offset.y);
  context.lineTo(vertices[1].x + offset.x, vertices[1].y + offset.y);
  context.lineTo(vertices[2].x + offset.x, vertices[2].y + offset.y);
  context.closePath();
}
