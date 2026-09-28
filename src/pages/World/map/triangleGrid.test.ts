import { describe, expect, it } from "vitest";
import {
  normalizedPointToTriangleCell,
  triangleCellCenterNormalized,
  triangleCellNeighbors,
  triangleGridSize,
  triangleIsUp,
} from "./triangleGrid";

describe("triangular world grid", () => {
  it("alternates orientation across columns and rows", () => {
    expect(triangleIsUp(0, 0)).toBe(true);
    expect(triangleIsUp(1, 0)).toBe(false);
    expect(triangleIsUp(0, 1)).toBe(false);
  });

  it("round-trips every triangle centroid through hit testing", () => {
    const width = 18;
    const height = 12;
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const center = triangleCellCenterNormalized(column, row, width, height);
        expect(normalizedPointToTriangleCell(center, width, height)).toEqual({
          column,
          row,
          index: row * width + column,
        });
      }
    }
  });

  it("uses three edge neighbors for interior cells", () => {
    expect(triangleCellNeighbors(5, 5, 12, 12)).toHaveLength(3);
    expect(triangleCellNeighbors(0, 0, 12, 12)).toHaveLength(2);
  });

  it("reports the real triangular lattice bounds", () => {
    expect(triangleGridSize(9, 4)).toMatchObject({ width: 5 });
    expect(triangleGridSize(9, 4).height).toBeCloseTo(2 * Math.sqrt(3));
  });
});
