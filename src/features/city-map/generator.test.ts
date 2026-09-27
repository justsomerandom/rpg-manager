import { describe, expect, it } from "vitest";
import type { CityBuilding, CityMap, CityRoad } from "../../api/cityMap";
import type { MapCity } from "../../api/worldMap";
import {
  connectCityRoadNetwork,
  evaluateBuildingPlacement,
  generateCityPlan,
  recommendedCityLayout,
  recommendedLandmarkCount,
  type CityGenerationConfig,
} from "./generator";

const city: MapCity = {
  id: "test-city",
  name: "Test City",
  kind: "settlement",
  x: 0.5,
  y: 0.5,
  elevation: 0.5,
  population: 8_000,
};

const baseConfig: CityGenerationConfig = {
  size: "village",
  cityType: "trade",
  layout: "grid",
  seed: 42,
  density: 0.55,
  scale: 1,
  roadTheme: "western",
};

function lineIntersection(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const cdX = d.x - c.x;
  const cdY = d.y - c.y;
  const denominator = abX * cdY - abY * cdX;
  if (Math.abs(denominator) < 1e-9) return null;
  const first = ((c.x - a.x) * cdY - (c.y - a.y) * cdX) / denominator;
  const second = ((c.x - a.x) * abY - (c.y - a.y) * abX) / denominator;
  if (first < -1e-6 || first > 1 + 1e-6 || second < -1e-6 || second > 1 + 1e-6) return null;
  return { x: a.x + abX * first, y: a.y + abY * first };
}

function containsPoint(road: CityRoad, point: { x: number; y: number }) {
  return road.points.some(
    (candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 0.000002,
  );
}

describe("city generation", () => {
  it("is deterministic and does not invent landmarks", () => {
    const first = generateCityPlan(city, baseConfig);
    const second = generateCityPlan(city, baseConfig);
    expect(second).toEqual(first);
    expect(first.buildings.some((building) => building.kind === "landmark")).toBe(false);
  });

  it("turns every proper road crossing into a node on both roads", () => {
    const map = generateCityPlan(city, { ...baseConfig, cityType: "capital", layout: "radial" });
    let checkedIntersections = 0;
    for (let firstRoadIndex = 0; firstRoadIndex < map.roads.length; firstRoadIndex += 1) {
      const firstRoad = map.roads[firstRoadIndex]!;
      for (
        let secondRoadIndex = firstRoadIndex + 1;
        secondRoadIndex < map.roads.length;
        secondRoadIndex += 1
      ) {
        const secondRoad = map.roads[secondRoadIndex]!;
        for (
          let firstPointIndex = 1;
          firstPointIndex < firstRoad.points.length;
          firstPointIndex += 1
        ) {
          for (
            let secondPointIndex = 1;
            secondPointIndex < secondRoad.points.length;
            secondPointIndex += 1
          ) {
            const intersection = lineIntersection(
              firstRoad.points[firstPointIndex - 1]!,
              firstRoad.points[firstPointIndex]!,
              secondRoad.points[secondPointIndex - 1]!,
              secondRoad.points[secondPointIndex]!,
            );
            if (!intersection) continue;
            checkedIntersections += 1;
            expect(containsPoint(firstRoad, intersection)).toBe(true);
            expect(containsPoint(secondRoad, intersection)).toBe(true);
          }
        }
      }
    }
    expect(checkedIntersections).toBeGreaterThan(0);
  });

  it("lets settlement type materially change a chosen layout", () => {
    const rural = generateCityPlan(city, { ...baseConfig, cityType: "rural" });
    const capital = generateCityPlan(city, { ...baseConfig, cityType: "capital" });
    expect(capital.roads.length).toBeGreaterThan(rural.roads.length);
    expect(recommendedCityLayout("fortress")).toBe("ring");
    expect(recommendedCityLayout("industrial")).toBe("grid");
    expect(recommendedLandmarkCount("city", "capital")).toBeGreaterThan(
      recommendedLandmarkCount("city", "rural"),
    );
  });

  it("snaps a hand-drawn street into the existing network", () => {
    const roads: CityRoad[] = [
      {
        id: "existing",
        name: "Existing",
        importance: "main",
        points: [
          { id: "e-1", x: 0.5, y: 0.2 },
          { id: "e-2", x: 0.5, y: 0.8 },
        ],
      },
      {
        id: "drawn",
        name: "Drawn",
        importance: "secondary",
        points: [
          { id: "d-1", x: 0.48, y: 0.4 },
          { id: "d-2", x: 0.8, y: 0.4 },
        ],
      },
    ];
    const connected = connectCityRoadNetwork(roads, "drawn");
    expect(connected[1]!.points[0]).toMatchObject({ x: 0.5, y: 0.4 });
    expect(connected[0]!.points.some((point) => point.x === 0.5 && point.y === 0.4)).toBe(true);
  });

  it("rejects manual buildings placed across roads", () => {
    const map = generateCityPlan(city, baseConfig);
    const roadPoint = map.roads[0]!.points[1]!;
    const building: CityBuilding = {
      id: "manual-building",
      name: "Blocked building",
      kind: "civic",
      x: roadPoint.x,
      y: roadPoint.y,
      footprint: 0.02,
      width: 0.02,
      height: 0.02,
      rotation: 0,
    };
    expect(evaluateBuildingPlacement(map as CityMap, building)).toMatchObject({ valid: false });
  });
});
