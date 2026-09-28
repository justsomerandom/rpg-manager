import { describe, expect, it } from "vitest";
import { generateProceduralMap, smoothLayer } from "./generation";
import { triangleCellNeighbors } from "./triangleGrid";

describe("triangular world generation", () => {
  it("marks generated maps with the triangular grid schema", () => {
    const map = generateProceduralMap(42, 0.42, 12, 10);

    expect(map.grid_kind).toBe("triangle");
    expect(map.relief).toHaveLength(120);
    expect(map.temperature).toHaveLength(120);
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
