import { describe, expect, it } from "vitest";
import { routeRoad } from "./roads";
import {
  normalizedPointToTriangleCell,
  normalizedToTriangleGridPoint,
  triangleCellCenterNormalized,
  triangleCellNeighbors,
} from "./triangleGrid";
import type { MapStateExtended } from "./types";

function openMap(width = 18, height = 14): MapStateExtended {
  const cells = width * height;
  return {
    grid_kind: "triangle",
    width,
    height,
    relief: new Array(cells).fill(0.58),
    moisture: new Array(cells).fill(0.5),
    temperature: new Array(cells).fill(0.55),
    vegetation: new Array(cells).fill(0.35),
    water_level: 0.4,
    seed: 17,
    cities: [],
    roads: [],
  };
}

function cellsCrossedByPolyline(map: MapStateExtended, points: Array<{ x: number; y: number }>) {
  const crossed: ReturnType<typeof normalizedPointToTriangleCell>[] = [];
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1]!;
    const end = points[pointIndex]!;
    const gridStart = normalizedToTriangleGridPoint(start, map.width, map.height);
    const gridEnd = normalizedToTriangleGridPoint(end, map.width, map.height);
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(gridEnd.x - gridStart.x, gridEnd.y - gridStart.y) * 24),
    );
    for (let step = pointIndex === 1 ? 0 : 1; step <= steps; step += 1) {
      const progress = step / steps;
      const cell = normalizedPointToTriangleCell(
        {
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        },
        map.width,
        map.height,
      );
      if (crossed[crossed.length - 1]?.index !== cell.index) crossed.push(cell);
    }
  }
  return crossed;
}

describe("triangular road routing", () => {
  it("routes through edge-adjacent triangle cells deterministically", () => {
    const map = openMap();
    const start = triangleCellCenterNormalized(2, 2, map.width, map.height);
    const end = triangleCellCenterNormalized(14, 10, map.width, map.height);
    const first = routeRoad(map, start, end, { maxBridgeCells: 0, naturalVariation: 0 });
    const second = routeRoad(map, start, end, { maxBridgeCells: 0, naturalVariation: 0 });
    expect(first.usedFallback).toBe(false);
    expect(first.points).toEqual(second.points);
    expect(first.points.length).toBeGreaterThan(2);

    const cells = cellsCrossedByPolyline(map, first.points);
    for (let index = 1; index < cells.length; index += 1) {
      const previous = cells[index - 1]!;
      const current = cells[index]!;
      const neighbors = triangleCellNeighbors(previous.column, previous.row, map.width, map.height);
      expect(neighbors.some((neighbor) => neighbor.index === current.index)).toBe(true);
    }
  });
});
