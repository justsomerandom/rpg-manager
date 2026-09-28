import { describe, expect, it } from "vitest";
import { generateProceduralMap, smoothLayer } from "./generation";
import { MAP_DEFAULT_HEIGHT, MAP_DEFAULT_WIDTH, MAP_MAX_CELLS } from "./constants";
import { triangleCellNeighbors, triangleGridSize } from "./triangleGrid";

describe("triangular world generation", () => {
  it("marks generated maps with the triangular grid schema", () => {
    const map = generateProceduralMap(42, 0.42, 12, 10);

    expect(map.grid_kind).toBe("triangle");
    expect(map.relief).toHaveLength(120);
    expect(map.temperature).toHaveLength(120);
  });

  it("uses a landscape lattice by default", () => {
    const bounds = triangleGridSize(MAP_DEFAULT_WIDTH, MAP_DEFAULT_HEIGHT);

    expect(bounds.width / bounds.height).toBeGreaterThan(1.7);
    expect(MAP_DEFAULT_WIDTH * MAP_DEFAULT_HEIGHT).toBeLessThan(MAP_MAX_CELLS);
  });

  it("generates deterministic continents with lower ocean-facing edges", () => {
    const first = generateProceduralMap(2026, 0.42, 48, 24);
    const second = generateProceduralMap(2026, 0.42, 48, 24);
    expect(first.relief).toEqual(second.relief);

    const edge: number[] = [];
    const interior: number[] = [];
    for (let row = 0; row < first.height; row += 1) {
      for (let column = 0; column < first.width; column += 1) {
        const value = first.relief[row * first.width + column]!;
        if (row < 2 || row >= first.height - 2 || column < 2 || column >= first.width - 2) {
          edge.push(value);
        } else if (
          row >= first.height / 4 &&
          row < (first.height * 3) / 4 &&
          column >= first.width / 4 &&
          column < (first.width * 3) / 4
        ) {
          interior.push(value);
        }
      }
    }
    const average = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;

    expect(average(edge)).toBeLessThan(average(interior));
  });

  it("rejects custom dimensions above the rendering budget", () => {
    expect(() => generateProceduralMap(1, 0.42, 256, 256)).toThrow("32,768");
  });

  it("smooths across only the three edge-adjacent triangles", () => {
    const width = 10;
    const height = 10;
    const source = new Array(width * height).fill(0);
    const center = { column: 5, row: 5, index: 5 * width + 5 };
    source[center.index] = 1;

    const smoothed = smoothLayer(source, width, height);
    const influenced = smoothed
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => value > 0)
      .map(({ index }) => index)
      .sort((a, b) => a - b);
    const expected = [
      center.index,
      ...triangleCellNeighbors(center.column, center.row, width, height).map(
        (neighbor) => neighbor.index,
      ),
    ].sort((a, b) => a - b);

    expect(influenced).toEqual(expected);
  });
});
