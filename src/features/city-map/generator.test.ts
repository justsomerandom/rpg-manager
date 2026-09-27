import { describe, expect, it } from "vitest";
import type { CityBuilding, CityMap, CityRoad } from "../../api/cityMap";
import type { MapCity } from "../../api/worldMap";
import {
  CITY_LAYOUT_OPTIONS,
  cityLayoutAvailability,
  cityTypeAvailability,
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

function maximumRoadsAtOneNode(roads: readonly CityRoad[]) {
  const nodes = new Map<string, Set<string>>();
  for (const road of roads) {
    for (const point of road.points) {
      const key = `${point.x.toFixed(6)}:${point.y.toFixed(6)}`;
      const roadIds = nodes.get(key) ?? new Set<string>();
      roadIds.add(road.id);
      nodes.set(key, roadIds);
    }
  }
  return Math.max(0, ...[...nodes.values()].map((roadIds) => roadIds.size));
}

function connectedRoadComponentCount(roads: readonly CityRoad[]) {
  const roadIndexesByNode = new Map<string, number[]>();
  roads.forEach((road, roadIndex) => {
    for (const point of road.points) {
      const key = `${point.x.toFixed(6)}:${point.y.toFixed(6)}`;
      const indexes = roadIndexesByNode.get(key) ?? [];
      indexes.push(roadIndex);
      roadIndexesByNode.set(key, indexes);
    }
  });
  const adjacency = roads.map(() => new Set<number>());
  for (const indexes of roadIndexesByNode.values()) {
    for (const left of indexes) {
      for (const right of indexes) {
        if (left !== right) adjacency[left]!.add(right);
      }
    }
  }
  const visited = new Set<number>();
  let components = 0;
  roads.forEach((_, start) => {
    if (visited.has(start)) return;
    components += 1;
    const pending = [start];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...adjacency[current]!.values());
    }
  });
  return components;
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

  it("supports varied historical and planned layouts without central mega-junctions", () => {
    const terrain = {
      coastal: true,
      coast_angle: Math.PI / 2,
      elevation: 0.7,
      moisture: 0.75,
      temperature: 0.5,
      vegetation: 0.55,
    };
    const layouts = CITY_LAYOUT_OPTIONS.map((option) => option.key);
    expect(layouts).toHaveLength(10);
    for (const layout of layouts) {
      const map = generateCityPlan(
        city,
        { ...baseConfig, layout, cityType: "trade" },
        [],
        [],
        terrain,
      );
      expect(map.roads.length, layout).toBeGreaterThan(3);
      expect(connectedRoadComponentCount(map.roads), layout).toBe(1);
    }
    const radial = generateCityPlan(city, {
      ...baseConfig,
      size: "megapolis",
      cityType: "capital",
      layout: "radial",
      density: 0.55,
    });
    expect(maximumRoadsAtOneNode(radial.roads)).toBeLessThanOrEqual(4);
    expect(connectedRoadComponentCount(radial.roads)).toBe(1);
  });

  it("uses terrain to gate specialized types and layouts", () => {
    const inland = {
      coastal: false,
      elevation: 0.2,
      moisture: 0.3,
      temperature: 0.5,
      vegetation: 0.4,
    };
    expect(cityTypeAvailability("port", inland).available).toBe(false);
    expect(cityTypeAvailability("fortress", inland).available).toBe(false);
    expect(cityLayoutAvailability("canal", inland).available).toBe(false);
    expect(cityLayoutAvailability("terraced", inland).available).toBe(false);
    expect(cityLayoutAvailability("medieval", inland).available).toBe(true);
  });

  it("gives generated civic buildings functional names", () => {
    const map = generateCityPlan(city, {
      ...baseConfig,
      size: "town",
      cityType: "capital",
      layout: "axial",
      density: 0.85,
    });
    const civicBuildings = map.buildings.filter((building) => building.kind === "civic");
    expect(civicBuildings.length).toBeGreaterThan(0);
    expect(civicBuildings.every((building) => !/^civic \d+$/i.test(building.name))).toBe(true);
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
