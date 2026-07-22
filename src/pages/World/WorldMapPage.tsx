import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import { useBlocker, useParams } from "react-router-dom";
import {
  getWorldMap,
  saveWorldMap,
  type MapCity,
  type MapLocationKind,
} from "../../api/worldMap";
import { getErrorMessage } from "../../api/client";
import { CityMapEditor, type CityMapApproach } from "../../components/CityMapEditor";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useCloseGuard } from "../../hooks/useCloseGuard";
import {
  settlementIcons,
  terrainIcons,
  vegetationIcons,
} from "../../assets/map-icons";
import {
  ACTION_CURSOR,
  BIOME_COLORS,
  BIOME_GROUPS,
  BIOME_TARGETS,
  BRUSH_ACTIONS,
  CLIMATE_INTENSITY,
  CLIMATE_LAYERS,
  DEFAULT_WATER_LEVEL,
  MAP_DEFAULT_SIZE,
  MAP_SIZE_CHOICES,
  MAX_ZOOM,
  MIN_ZOOM,
  PRIMARY_ACTION_LABEL,
  RELIEF_INTENSITY,
  SNAP_THRESHOLD,
  TILE_BASE,
  TOOL_GROUP_LABELS,
} from "./map/constants";
import {
  Biome,
  BiomeToolMode,
  CompiledRenders,
  MapStateExtended,
  NetworkAnchor,
  OverlayMode,
  PanVector,
  PixelPoint,
  PrimaryAction,
  ToolGroup,
  ViewMode,
} from "./map/types";
import { clamp, lerp, pseudoRandom, randomId } from "./map/math";
import {
  buildBiomeGrid,
  buildSmoothPath,
  computeBiome,
  extractBiomeLoops,
  stylizeColor,
} from "./map/biome";
import {
  ensureExtendedMap,
  generateProceduralMap,
  normalizeLayer,
  smoothLayer,
} from "./map/generation";
import {
  normalizeFreehandRoad,
  routeRoad,
  type RoadRouteResult,
} from "./map/roads";

const iconCache = new Map<string, Promise<HTMLImageElement>>();
const MAX_COMPILED_PIXELS = 12_000_000;

type MapConfirmation =
  | { kind: "regenerate" }
  | { kind: "resize" }
  | { kind: "delete-location"; locationId: string }
  | { kind: "delete-road"; roadId: string; dependentCount: number };

function canvasPixelRatio(width: number, height: number, maximum = 2) {
  const requested = Math.min(maximum, Math.max(1, window.devicePixelRatio || 1));
  const pixelBudgetRatio = Math.sqrt(MAX_COMPILED_PIXELS / Math.max(1, width * height));
  return Math.max(0.5, Math.min(requested, pixelBudgetRatio));
}

function loadIcon(url: string): Promise<HTMLImageElement> {
  if (!iconCache.has(url)) {
    iconCache.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
        img.src = url;
      })
    );
  }
  return iconCache.get(url)!;
}


function drawCoastlineGlimmer(
  map: MapStateExtended,
  ctx: CanvasRenderingContext2D,
  cellSize: number
) {
  const sea = map.water_level;
  const threshold = 0.06;
  ctx.save();
  ctx.strokeStyle = "rgba(241, 221, 182, 0.22)";
  ctx.lineWidth = Math.max(1, cellSize * 0.05);
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const idx = y * map.width + x;
      const elev = map.relief[idx];
      if (Math.abs(elev - sea) > threshold) continue;
      const jitterX = (pseudoRandom(x, y, map.seed + 2025) - 0.5) * cellSize * 0.5;
      const jitterY = (pseudoRandom(x, y, map.seed + 6066) - 0.5) * cellSize * 0.5;
      const px = x * cellSize + jitterX;
      const py = y * cellSize + jitterY;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + cellSize * 0.35, py + cellSize * 0.15);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function applyNoiseOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  alpha = 0.1
) {
  const noiseCanvas = document.createElement("canvas");
  noiseCanvas.width = 96;
  noiseCanvas.height = 96;
  const nctx = noiseCanvas.getContext("2d");
  if (!nctx) return;
  const image = nctx.createImageData(noiseCanvas.width, noiseCanvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const pixel = i / 4;
    const v = Math.floor(pseudoRandom(pixel % noiseCanvas.width, Math.floor(pixel / noiseCanvas.width), seed + 9187) * 255);
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  nctx.putImageData(image, 0, 0);
  const pattern = ctx.createPattern(noiseCanvas, "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function applyFantasyOverlay(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(255, 240, 210, 0.15)");
  gradient.addColorStop(1, "rgba(12, 18, 16, 0.35)");
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) / 3,
    width / 2,
    height / 2,
    Math.max(width, height) / 1.05
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.save();
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function cityTier(population: number): keyof typeof settlementIcons {
  if (population > 600000) return "megapolis";
  if (population > 180000) return "city";
  if (population > 60000) return "town";
  if (population > 12000) return "village";
  return "hamlet";
}

function locationIcon(city: MapCity) {
  if (city.kind === "port") return settlementIcons.port;
  if (city.kind === "fortress") return settlementIcons.fort;
  if (city.kind === "ruin") return settlementIcons.ruin;
  return settlementIcons[cityTier(city.population)];
}

function terrainIconForBiome(biome: Biome): string | null {
  switch (biome) {
    case "mountain":
    case "snow":
      return terrainIcons.mountain;
    case "highland":
      return terrainIcons.range;
    case "hills":
      return terrainIcons.hills;
    case "basalt_fields":
      return terrainIcons.badlands_spire;
    case "lava_lake":
    case "obsidian_ridge":
    case "volcanic_forest":
      return terrainIcons.volcano;
    case "glacier":
    case "icy_plains":
      return terrainIcons.glacier;
    case "hot_springs":
      return terrainIcons.hot_spring;
    case "crystal_desert":
      return terrainIcons.crystal_peak;
    case "desert":
    case "salt_flat":
      return terrainIcons.dunes;
    default:
      return null;
  }
}

async function drawCompiledGrid(map: MapStateExtended): Promise<string> {
  const cellSize = Math.max(8, Math.floor(920 / Math.max(map.width, map.height)));
  const logicalWidth = Math.max(640, Math.floor(map.width * cellSize));
  const logicalHeight = Math.max(640, Math.floor(map.height * cellSize));
  const canvas = document.createElement("canvas");
  const pixelRatio = canvasPixelRatio(logicalWidth, logicalHeight);
  canvas.width = Math.floor(logicalWidth * pixelRatio);
  canvas.height = Math.floor(logicalHeight * pixelRatio);
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(pixelRatio, pixelRatio);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const width = logicalWidth;
  const height = logicalHeight;

  ctx.fillStyle = "#070807";
  ctx.fillRect(0, 0, width, height);

  const biomeGrid = buildBiomeGrid(map);
  const uniqueBiomes = Array.from(new Set(biomeGrid));
  const watery = new Set<Biome>(["ocean", "shallow", "reef", "beach", "wetland", "mangrove"]);
  uniqueBiomes.forEach((biome, biomeIndex) => {
    const loops = extractBiomeLoops(biomeGrid, map.width, map.height, biome);
    const color = stylizeColor(BIOME_COLORS[biome]);
    ctx.fillStyle = color;
    loops.forEach((loop, loopIndex) => {
      const jitterScale = watery.has(biome) ? 0.48 : 0.26;
      const path = buildSmoothPath(loop, cellSize, jitterScale, map.seed + biomeIndex * 41 + loopIndex * 13);
      ctx.fill(path);
    });
  });
  drawCoastlineGlimmer(map, ctx, cellSize);

  // Compiled maps are cartographic images, not editor grids. Boundary paths
  // above provide the landmass definition without exposing source tiles.

  const strokeRoads = (stroke: string, width: number) => map.roads.forEach((road) => {
    if (!road.points.length) return;
    ctx.beginPath();
    road.points.forEach((point, index) => {
      const px = point.x * map.width * cellSize;
      const py = point.y * map.height * cellSize;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  });
  strokeRoads("rgba(45,38,28,0.88)", Math.max(3, cellSize * 0.24));
  strokeRoads("rgba(230,205,154,0.95)", Math.max(1.4, cellSize * 0.12));

  const iconPromises: Promise<void>[] = [];
  const baseStep = Math.max(3, Math.floor(Math.min(map.width, map.height) / 9));
  for (let y = baseStep / 2; y < map.height; ) {
    for (let x = baseStep / 2; x < map.width; ) {
      const idx = Math.min(map.height - 1, Math.floor(y)) * map.width + Math.min(map.width - 1, Math.floor(x));
      const biome = computeBiome(map, idx);
      const vegLevel = map.vegetation[idx];
      const densityFactor = lerp(0.45, 1.6, 1 - vegLevel);
      const step = Math.max(2, Math.round(baseStep * densityFactor));
      const vegUrl = vegetationIcons[biome];
      const terrainUrl = terrainIconForBiome(biome);
      const jitterX = (pseudoRandom(x, y, map.seed + 101) - 0.5) * cellSize * 0.6;
      const jitterY = (pseudoRandom(x, y, map.seed + 303) - 0.5) * cellSize * 0.6;
      const cx = x * cellSize + jitterX;
      const cy = y * cellSize + jitterY;
      const vegSize = Math.max(10, cellSize * 0.7);
      if (vegUrl && pseudoRandom(x, y, map.seed + 1515) < vegLevel + 0.2) {
        iconPromises.push(
          loadIcon(vegUrl).then((img) => {
            if (img.naturalWidth) ctx.drawImage(img, cx - vegSize / 2, cy - vegSize / 2, vegSize, vegSize);
          })
        );
      }
      if (terrainUrl && pseudoRandom(x, y, map.seed + 707) > 0.72) {
        const size = Math.max(14, cellSize * 0.9);
        iconPromises.push(
          loadIcon(terrainUrl).then((img) => {
            if (img.naturalWidth) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
          })
        );
      }
      x += step;
    }
    y += baseStep;
  }

  const cityLabels: Array<{ name: string; x: number; y: number; size: number }> = [];
  map.cities.forEach((city) => {
    const iconUrl = locationIcon(city);
    const px = city.x * map.width * cellSize;
    const py = city.y * map.height * cellSize;
    const size = Math.max(18, cellSize * 1.1);
    iconPromises.push(
      loadIcon(iconUrl).then((img) => {
        if (img.naturalWidth) ctx.drawImage(img, px - size / 2, py - size / 2, size, size);
      })
    );
    cityLabels.push({ name: city.name, x: px, y: py, size });
  });

  await Promise.all(iconPromises);
  cityLabels.forEach((label) => {
    ctx.save();
    ctx.font = `600 ${Math.max(11, cellSize * 0.4)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = Math.max(2, cellSize * 0.1);
    ctx.strokeStyle = "rgba(238,225,196,0.9)";
    ctx.strokeText(label.name, label.x, label.y - label.size * 0.72);
    ctx.fillStyle = "rgba(32,39,29,0.96)";
    ctx.fillText(label.name, label.x, label.y - label.size * 0.72);
    ctx.restore();
  });
  applyFantasyOverlay(ctx, width, height);
  applyNoiseOverlay(ctx, width, height, map.seed, 0.08);
  return canvas.toDataURL("image/png");
}

async function drawCompiledIso(map: MapStateExtended, topDownDataUrl: string): Promise<string> {
  const source = await loadIcon(topDownDataUrl);
  if (!source.naturalWidth || !source.naturalHeight) return "";
  const diagonal = Math.ceil(Math.hypot(source.naturalWidth, source.naturalHeight));
  const logicalWidth = Math.max(960, diagonal + 140);
  const logicalHeight = Math.max(720, Math.ceil(diagonal * 0.58) + 180);
  const canvas = document.createElement("canvas");
  const pixelRatio = canvasPixelRatio(logicalWidth, logicalHeight);
  canvas.width = Math.floor(logicalWidth * pixelRatio);
  canvas.height = Math.floor(logicalHeight * pixelRatio);
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(pixelRatio, pixelRatio);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const width = logicalWidth;
  const height = logicalHeight;

  ctx.fillStyle = "#07130d";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2 - 12);
  ctx.scale(1, 0.56);
  ctx.rotate(Math.PI / 4);
  const sourceScale = Math.min(
    (width - 160) / diagonal,
    (height - 170) / (diagonal * 0.56)
  );
  ctx.scale(sourceScale, sourceScale);
  ctx.shadowColor = "rgba(0,0,0,0.72)";
  ctx.shadowBlur = 38 / Math.max(sourceScale, 0.1);
  ctx.shadowOffsetY = 28 / Math.max(sourceScale, 0.1);
  ctx.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2);
  ctx.restore();
  applyFantasyOverlay(ctx, width, height);
  applyNoiseOverlay(ctx, width, height, map.seed + 1, 0.08);
  return canvas.toDataURL("image/png");
}

async function generateCompiledRenders(map: MapStateExtended): Promise<CompiledRenders> {
  const extended = ensureExtendedMap(map);
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  const grid = await drawCompiledGrid(extended);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  const iso = await drawCompiledIso(extended, grid);
  return { grid, iso };
}

function drawIsometricMap(
  canvas: HTMLCanvasElement | null,
  map: MapStateExtended,
  zoom: number,
  pan: PanVector,
  viewport: { width: number; height: number },
  highlightCityId?: string | null,
  roadDraftStart?: PixelPoint | null,
  overlayMode: OverlayMode = "biomes",
  overlayRanges?: {
    relief?: { min: number; max: number };
    temperature?: { min: number; max: number };
    vegetation?: { min: number; max: number };
  },
  freehandDraft: readonly PixelPoint[] = []
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pixelRatio = canvasPixelRatio(viewport.width, viewport.height);
  canvas.width = viewport.width * pixelRatio;
  canvas.height = viewport.height * pixelRatio;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  const tileWidth = TILE_BASE * zoom;
  const tileHeight = tileWidth / 2;
  const originX = viewport.width / 2 + pan.x;
  const originY = viewport.height / 2 - tileHeight / 2 + pan.y;
  const sumCenter = (map.width - 1 + map.height - 1) / 2;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const idx = y * map.width + x;
      const biome = computeBiome(map, idx);
      const color = BIOME_COLORS[biome];
      const isoX = (x + y - sumCenter) * (tileWidth / 2) + originX;
      const isoY = (y - x) * (tileHeight / 2) + originY;
      ctx.beginPath();
      ctx.moveTo(isoX, isoY);
      ctx.lineTo(isoX + tileWidth / 2, isoY + tileHeight / 2);
      ctx.lineTo(isoX, isoY + tileHeight);
      ctx.lineTo(isoX - tileWidth / 2, isoY + tileHeight / 2);
      ctx.closePath();
      const baseColor = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.fillStyle = baseColor;
      ctx.fill();

      if (overlayMode !== "biomes" && overlayRanges) {
        let overlay: string | null = null;
        if (overlayMode === "relief" && overlayRanges.relief) {
          overlay = reliefOverlayColor(map, map.relief[idx], overlayRanges.relief);
        } else if (overlayMode === "temperature" && overlayRanges.temperature) {
          overlay = temperatureOverlayColor(map.temperature[idx], overlayRanges.temperature);
        } else if (overlayMode === "vegetation" && overlayRanges.vegetation) {
          overlay = vegetationOverlayColor(map.vegetation[idx], overlayRanges.vegetation);
        }
        if (overlay) {
          ctx.save();
          ctx.fillStyle = overlay;
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.strokeStyle = "rgba(8,25,19,0.35)";
      ctx.stroke();
    }
  }

  const drawRoad = (points: readonly PixelPoint[], stroke: string) => {
    if (points.length === 0) return;
    ctx.beginPath();
    const first = points[0];
    const firstGridX = first.x * map.width - 0.5;
    const firstGridY = first.y * map.height - 0.5;
    const startX = ((firstGridX + firstGridY - sumCenter) * (tileWidth / 2)) + originX;
    const startY = (firstGridY - firstGridX) * (tileHeight / 2) + originY + tileHeight / 2;
    ctx.moveTo(startX, startY);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      const gridX = point.x * map.width - 0.5;
      const gridY = point.y * map.height - 0.5;
      const px = ((gridX + gridY - sumCenter) * (tileWidth / 2)) + originX;
      const py = (gridY - gridX) * (tileHeight / 2) + originY + tileHeight / 2;
      ctx.lineTo(px, py);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  };

  map.roads.forEach((road) => drawRoad(road.points, "rgba(224,196,128,0.85)"));
  if (freehandDraft.length > 1) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    drawRoad(freehandDraft, "rgba(255,214,142,0.95)");
    ctx.restore();
  }
  if (roadDraftStart) {
    drawRoad([roadDraftStart], "rgba(255,198,109,0.8)");
  }

  map.cities.forEach((city) => {
    const gridX = city.x * map.width - 0.5;
    const gridY = city.y * map.height - 0.5;
    const isoX = ((gridX + gridY - sumCenter) * (tileWidth / 2)) + originX;
    const isoY = (gridY - gridX) * (tileHeight / 2) + originY + tileHeight / 2;
    ctx.fillStyle = city.id === highlightCityId ? "#ffe066" : "#e3f2db";
    ctx.beginPath();
    ctx.arc(isoX, isoY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = "12px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(city.name, isoX, isoY - 12);
  });
}

function drawGridMap(
  canvas: HTMLCanvasElement | null,
  map: MapStateExtended,
  zoom: number,
  pan: PanVector,
  viewport: { width: number; height: number },
  highlightCityId?: string | null,
  roadDraftStart?: PixelPoint | null,
  overlayMode: OverlayMode = "biomes",
  overlayRanges?: {
    relief?: { min: number; max: number };
    temperature?: { min: number; max: number };
    vegetation?: { min: number; max: number };
  },
  freehandDraft: readonly PixelPoint[] = []
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pixelRatio = canvasPixelRatio(viewport.width, viewport.height);
  canvas.width = viewport.width * pixelRatio;
  canvas.height = viewport.height * pixelRatio;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = "#030c07";
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const cellSize = TILE_BASE * zoom;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const idx = y * map.width + x;
      const biome = computeBiome(map, idx);
      const color = BIOME_COLORS[biome];
      const px = x * cellSize + pan.x;
      const py = y * cellSize + pan.y;
      ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.fillRect(px, py, cellSize + 1, cellSize + 1);
      if (overlayMode !== "biomes" && overlayRanges) {
        let overlay: string | null = null;
        if (overlayMode === "relief" && overlayRanges.relief) {
          overlay = reliefOverlayColor(map, map.relief[idx], overlayRanges.relief);
        } else if (overlayMode === "temperature" && overlayRanges.temperature) {
          overlay = temperatureOverlayColor(map.temperature[idx], overlayRanges.temperature);
        } else if (overlayMode === "vegetation" && overlayRanges.vegetation) {
          overlay = vegetationOverlayColor(map.vegetation[idx], overlayRanges.vegetation);
        }
        if (overlay) {
          ctx.fillStyle = overlay;
          ctx.fillRect(px, py, cellSize + 1, cellSize + 1);
        }
      }
    }
  }

  const totalWidth = map.width * cellSize;
  const totalHeight = map.height * cellSize;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = 0; gx <= map.width; gx += 1) {
    const px = gx * cellSize + pan.x;
    ctx.moveTo(px, pan.y);
    ctx.lineTo(px, pan.y + totalHeight);
  }
  for (let gy = 0; gy <= map.height; gy += 1) {
    const py = gy * cellSize + pan.y;
    ctx.moveTo(pan.x, py);
    ctx.lineTo(pan.x + totalWidth, py);
  }
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(224,196,128,0.85)";
  map.roads.forEach((road) => {
    ctx.beginPath();
    road.points.forEach((point, index) => {
      const px = point.x * map.width * cellSize + pan.x;
      const py = point.y * map.height * cellSize + pan.y;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });
  if (freehandDraft.length > 1) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(255,214,142,0.95)";
    ctx.beginPath();
    freehandDraft.forEach((point, index) => {
      const px = point.x * map.width * cellSize + pan.x;
      const py = point.y * map.height * cellSize + pan.y;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
  }
  if (roadDraftStart) {
    ctx.fillStyle = "rgba(255,198,109,0.8)";
    ctx.beginPath();
    ctx.arc(
      roadDraftStart.x * map.width * cellSize + pan.x,
      roadDraftStart.y * map.height * cellSize + pan.y,
      5,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  map.cities.forEach((city) => {
    const px = city.x * map.width * cellSize + pan.x;
    const py = city.y * map.height * cellSize + pan.y;
    ctx.fillStyle = city.id === highlightCityId ? "#ffe066" : "#e3f2db";
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = "12px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(city.name, px, py - 10);
  });
}
function invalidateCompiledMap(map: MapStateExtended): MapStateExtended {
  if (!map.compiled_grid && !map.compiled_iso && !map.compiled_updated_at) return map;
  return {
    ...map,
    compiled_grid: undefined,
    compiled_iso: undefined,
    compiled_updated_at: undefined,
  };
}

function applyBrushToMap(
  map: MapStateExtended,
  point: PixelPoint,
  action: PrimaryAction,
  selectedBiome: Biome,
  brushSize: number
): MapStateExtended {
  if (!BRUSH_ACTIONS.has(action)) return map;
  const width = map.width;
  const height = map.height;
  const cx = clamp(point.x * width - 0.5, 0, width - 1);
  const cy = clamp(point.y * height - 0.5, 0, height - 1);
  const radius = Math.max(1, Math.round(brushSize * Math.min(width, height)));
  const copy: MapStateExtended = {
    ...invalidateCompiledMap(map),
    relief: [...map.relief],
    moisture: [...map.moisture],
    temperature: [...map.temperature],
    vegetation: [...map.vegetation],
  };
  const target = { ...BIOME_TARGETS[selectedBiome] };
  switch (selectedBiome) {
    case "ocean":
      target.relief = clamp(map.water_level - 0.16);
      break;
    case "shallow":
      target.relief = clamp(map.water_level - 0.06);
      break;
    case "mangrove":
      target.relief = clamp(map.water_level - 0.045);
      break;
    case "reef":
      target.relief = clamp(map.water_level + 0.005);
      break;
    case "beach":
      target.relief = clamp(map.water_level + 0.018);
      break;
    case "wetland":
      target.relief = clamp(map.water_level + 0.028);
      break;
  }

  for (
    let y = Math.max(0, Math.floor(cy - radius));
    y <= Math.min(height - 1, Math.ceil(cy + radius));
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.floor(cx - radius));
      x <= Math.min(width - 1, Math.ceil(cx + radius));
      x += 1
    ) {
      const dx = (x - cx) / radius;
      const dy = (y - cy) / radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 1) continue;
      const falloff = 1 - distance * distance;
      const idx = y * width + x;
      switch (action) {
        case "paint-biome":
          copy.relief[idx] = clamp(
            copy.relief[idx] +
              (target.relief - copy.relief[idx]) * falloff * 0.5
          );
          copy.moisture[idx] = clamp(
            copy.moisture[idx] +
              (target.moisture - copy.moisture[idx]) * falloff * 0.5
          );
          copy.temperature[idx] = clamp(
            copy.temperature[idx] +
              (target.temperature - copy.temperature[idx]) * falloff * 0.5
          );
          copy.vegetation[idx] = clamp(
            copy.vegetation[idx] +
              (target.vegetation - copy.vegetation[idx]) * falloff * 0.5
          );
          break;
        case "raise-relief":
          copy.relief[idx] = clamp(copy.relief[idx] + falloff * RELIEF_INTENSITY);
          break;
        case "lower-relief":
          copy.relief[idx] = clamp(copy.relief[idx] - falloff * RELIEF_INTENSITY);
          break;
        case "raise-moisture":
          copy.moisture[idx] = clamp(
            copy.moisture[idx] + falloff * CLIMATE_INTENSITY
          );
          break;
        case "lower-moisture":
          copy.moisture[idx] = clamp(
            copy.moisture[idx] - falloff * CLIMATE_INTENSITY
          );
          break;
        case "raise-temperature":
          copy.temperature[idx] = clamp(
            copy.temperature[idx] + falloff * CLIMATE_INTENSITY
          );
          break;
        case "lower-temperature":
          copy.temperature[idx] = clamp(
            copy.temperature[idx] - falloff * CLIMATE_INTENSITY
          );
          break;
        case "raise-vegetation":
          copy.vegetation[idx] = clamp(
            copy.vegetation[idx] + falloff * (CLIMATE_INTENSITY + 0.01)
          );
          break;
        case "lower-vegetation":
          copy.vegetation[idx] = clamp(
            copy.vegetation[idx] - falloff * (CLIMATE_INTENSITY + 0.01)
          );
          break;
      }
    }
  }
  return copy;
}

function distance(a: PixelPoint, b: PixelPoint) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function closestPointOnSegment(point: PixelPoint, start: PixelPoint, end: PixelPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { ...start };
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared);
  return { x: start.x + dx * t, y: start.y + dy * t };
}

function computeReliefRange(map: MapStateExtended) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < map.relief.length; i += 1) {
    const v = map.relief[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function computeRange(values: number[]) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function isWaterCell(map: MapStateExtended, x: number, y: number) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  const idx = y * map.width + x;
  return map.relief[idx] <= map.water_level;
}

function reliefOverlayColor(
  map: MapStateExtended,
  reliefValue: number,
  range: { min: number; max: number }
) {
  const seaLevel = map.water_level;
  const min = Math.min(range.min, seaLevel);
  const max = Math.max(range.max, seaLevel + 0.0001);
  const t = clamp((reliefValue - min) / (max - min), 0, 1);
  const hue = lerp(220, 20, t); // deep blue to warm amber
  const light = lerp(25, 70, t);
  const sat = lerp(70, 90, t);
  return `hsla(${hue}, ${sat}%, ${light}%, 0.95)`;
}

function temperatureOverlayColor(value: number, range: { min: number; max: number }) {
  const t = clamp((value - range.min) / (range.max - range.min || 1), 0, 1);
  const hue = lerp(210, 5, t); // cold blue to hot red
  const sat = 80;
  const light = lerp(30, 70, t);
  return `hsla(${hue}, ${sat}%, ${light}%, 0.95)`;
}

function vegetationOverlayColor(value: number, range: { min: number; max: number }) {
  const t = clamp((value - range.min) / (range.max - range.min || 1), 0, 1);
  const hue = lerp(35, 130, t); // dry earth to lush green
  const sat = lerp(70, 85, t);
  const light = lerp(25, 65, t);
  return `hsla(${hue}, ${sat}%, ${light}%, 0.95)`;
}

function findNearestCity(
  map: MapStateExtended,
  point: PixelPoint,
  threshold = 0.04
): MapCity | null {
  let best: MapCity | null = null;
  let bestDist = threshold;
  map.cities.forEach((city) => {
    const d = distance(point, { x: city.x, y: city.y });
    if (d < bestDist) {
      bestDist = d;
      best = city;
    }
  });
  return best;
}

function addCityToMap(
  map: MapStateExtended,
  name: string,
  kind: MapLocationKind,
  xRatio: number,
  yRatio: number
): { map: MapStateExtended; city: MapCity | null } {
  const width = map.width;
  const height = map.height;
  const clickedX = Math.round(clamp(xRatio, 0, 0.9999) * width - 0.5);
  const clickedY = Math.round(clamp(yRatio, 0, 0.9999) * height - 0.5);
  let gridX = clickedX;
  let gridY = clickedY;
  if (isWaterCell(map, gridX, gridY)) {
    let candidate: { x: number; y: number; distance: number } | null = null;
    const searchRadius = Math.min(12, Math.max(width, height));
    for (let y = Math.max(0, clickedY - searchRadius); y <= Math.min(height - 1, clickedY + searchRadius); y += 1) {
      for (let x = Math.max(0, clickedX - searchRadius); x <= Math.min(width - 1, clickedX + searchRadius); x += 1) {
        if (isWaterCell(map, x, y)) continue;
        const candidateDistance = (x - clickedX) ** 2 + (y - clickedY) ** 2;
        if (!candidate || candidateDistance < candidate.distance) {
          candidate = { x, y, distance: candidateDistance };
        }
      }
    }
    if (!candidate) return { map, city: null };
    gridX = candidate.x;
    gridY = candidate.y;
  }
  const idx = gridY * width + gridX;
  const elevation = map.relief[idx];
  const city: MapCity = {
    id: randomId(),
    name: name.trim().slice(0, 120),
    kind,
    x: (gridX + 0.5) / width,
    y: (gridY + 0.5) / height,
    elevation,
    population: kind === "settlement" || kind === "port"
      ? Math.floor(500 + pseudoRandom(gridX, gridY, map.seed + map.cities.length * 17) * 4500)
      : 0,
  };
  return {
    map: {
      ...invalidateCompiledMap(map),
      cities: [...map.cities, city],
      roads: map.roads,
    },
    city,
  };
}

function snapToNetwork(map: MapStateExtended, point: PixelPoint): NetworkAnchor {
  let best: NetworkAnchor = {
    ...point,
    label: "Free point",
    targetType: "free",
  };
  let bestDist = SNAP_THRESHOLD;
  map.cities.forEach((city) => {
    const d = distance(point, { x: city.x, y: city.y });
    if (d < bestDist) {
      bestDist = d;
      best = {
        x: city.x,
        y: city.y,
        label: city.name,
        targetType: "city",
        targetId: city.id,
      };
    }
  });
  map.roads.forEach((road) => {
    for (let index = 1; index < road.points.length; index += 1) {
      const segmentPoint = closestPointOnSegment(point, road.points[index - 1], road.points[index]);
      const d = distance(point, segmentPoint);
      if (d < bestDist) {
        bestDist = d;
        best = {
          x: segmentPoint.x,
          y: segmentPoint.y,
          label: `Road segment ${index}`,
          targetType: "road",
          targetId: road.id,
        };
      }
    }
  });
  return best;
}

function addManualRoad(
  map: MapStateExtended,
  start: NetworkAnchor,
  end: NetworkAnchor,
  options: { naturalVariation: number; maxBridgeCells: number }
): { map: MapStateExtended; result: RoadRouteResult } {
  const result = routeRoad(map, start, end, {
    ...options,
    seed: map.seed + map.roads.length * 7_919,
  });
  if (result.usedFallback || result.points.length < 2) return { map, result };
  const roadId = randomId();
  return {
    result,
    map: {
      ...invalidateCompiledMap(map),
      roads: [
        ...map.roads,
        {
          id: roadId,
          from_city_id: start.targetId ?? roadId,
          to_city_id: end.targetId ?? `${roadId}-end`,
          points: result.points,
        },
      ],
    },
  };
}

function collectDependentRoadIds(
  roads: MapStateExtended["roads"],
  initialRoadIds: Iterable<string>
) {
  const removed = new Set(initialRoadIds);
  const dependents = new Map<string, string[]>();
  for (const road of roads) {
    for (const endpointId of [road.from_city_id, road.to_city_id]) {
      if (!endpointId) continue;
      const connected = dependents.get(endpointId);
      if (connected) connected.push(road.id);
      else dependents.set(endpointId, [road.id]);
    }
  }
  const queue = [...removed];
  for (let index = 0; index < queue.length; index += 1) {
    for (const roadId of dependents.get(queue[index]) ?? []) {
      if (!removed.has(roadId)) {
        removed.add(roadId);
        queue.push(roadId);
      }
    }
  }
  return removed;
}

export function WorldMapPage() {
  const { worldId } = useParams();
  const [mapState, setMapState] = useState<MapStateExtended | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedBiome, setSelectedBiome] = useState<Biome>("plains");
  const [biomeToolMode, setBiomeToolMode] = useState<BiomeToolMode>("palette");
  const [climateDirection, setClimateDirection] = useState<"raise" | "lower">("raise");
  const [brushSize, setBrushSize] = useState(0.05);
  const [selectedCity, setSelectedCity] = useState<MapCity | null>(null);
  const [cityEditorCity, setCityEditorCity] = useState<MapCity | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<PanVector>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isBrushing, setIsBrushing] = useState(false);
  const [roadDraftStart, setRoadDraftStart] = useState<NetworkAnchor | null>(null);
  const [roadToolMode, setRoadToolMode] = useState<"auto" | "freehand" | "select">("auto");
  const [freehandDraft, setFreehandDraft] = useState<PixelPoint[]>([]);
  const freehandDraftRef = useRef<PixelPoint[]>([]);
  const freehandActiveRef = useRef(false);
  const [roadNaturalness, setRoadNaturalness] = useState(0.22);
  const [allowBridges, setAllowBridges] = useState(true);
  const [roadReport, setRoadReport] = useState<string | null>(null);
  const [roadFromId, setRoadFromId] = useState("");
  const [roadToId, setRoadToId] = useState("");
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("biomes");
  const [desiredSize, setDesiredSize] = useState(MAP_DEFAULT_SIZE);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [cityEditorDirty, setCityEditorDirty] = useState(false);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolGroup, setToolGroup] = useState<ToolGroup>("general");
  const [reliefAction, setReliefAction] = useState<"raise" | "lower">("raise");
  const [locationAction, setLocationAction] = useState<PrimaryAction>("navigate");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [draftCityName, setDraftCityName] = useState("New City");
  const [draftLocationKind, setDraftLocationKind] = useState<MapLocationKind>("settlement");
  const [selectedCityName, setSelectedCityName] = useState("");
  const [selectedCityPopulation, setSelectedCityPopulation] = useState("");
  const [selectedLocationKind, setSelectedLocationKind] = useState<MapLocationKind>("settlement");
  const [compiledView, setCompiledView] = useState(true);
  const [cityEditorSaving, setCityEditorSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<MapStateExtended[]>([]);
  const [redoStack, setRedoStack] = useState<MapStateExtended[]>([]);
  const [confirmation, setConfirmation] = useState<MapConfirmation | null>(null);
  const [navigationConfirmationOpen, setNavigationConfirmationOpen] = useState(false);
  const compiledPreferenceRef = useRef(false);
  const revisionRef = useRef(0);
  const activeWorldIdRef = useRef(worldId);
  activeWorldIdRef.current = worldId;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);

  const markEdited = useCallback(() => {
    revisionRef.current += 1;
    setDirty(true);
    setError(null);
    setPreviewWarning(null);
  }, []);

  const rememberSnapshot = useCallback((snapshot: MapStateExtended) => {
    setUndoStack((current) => [...current.slice(-11), snapshot]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setMapState((active) => {
        if (active) setRedoStack((future) => [...future.slice(-11), active]);
        return previous;
      });
      revisionRef.current += 1;
      setDirty(true);
      setError(null);
      setStatusMessage("Undid the last map edit.");
      return current.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack((current) => {
      const next = current[current.length - 1];
      if (!next) return current;
      setMapState((active) => {
        if (active) setUndoStack((history) => [...history.slice(-11), active]);
        return next;
      });
      revisionRef.current += 1;
      setDirty(true);
      setError(null);
      setStatusMessage("Redid the map edit.");
      return current.slice(0, -1);
    });
  }, []);

  const mutationPending = saving || compiling || cityEditorSaving;
  const navigationBlocked = dirty || cityEditorDirty || mutationPending;
  const blocker = useBlocker(navigationBlocked);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (mutationPending) {
      setStatusMessage("A map save is still in progress. Wait for it to finish before leaving.");
      blocker.reset();
      return;
    }
    setNavigationConfirmationOpen(true);
  }, [blocker, mutationPending]);

  useCloseGuard({
    active: navigationBlocked,
    pending: mutationPending,
    pendingMessage: "A map save is still in progress. Wait for it to finish before closing the app.",
    confirmMessage: "Discard unsaved world or city map changes and close the app?",
  });

  const derivedPrimaryAction = useMemo<PrimaryAction>(() => {
    if (toolGroup === "biome") {
      if (biomeToolMode === "palette") return "paint-biome";
      const direction = climateDirection === "raise" ? "raise" : "lower";
      return `${direction}-${biomeToolMode}` as PrimaryAction;
    }
    if (toolGroup === "relief") {
      return reliefAction === "raise" ? "raise-relief" : "lower-relief";
    }
    if (toolGroup === "roads") {
      if (roadToolMode === "auto") return "add-road";
      if (roadToolMode === "freehand") return "draw-road";
      return "navigate";
    }
      if (toolGroup === "locations") {
        return locationAction;
      }
      return "navigate";
    }, [toolGroup, biomeToolMode, climateDirection, reliefAction, roadToolMode, locationAction]);

  const primaryAction = compiledView ? "navigate" : derivedPrimaryAction;

  const isBrushAction = !compiledView && BRUSH_ACTIONS.has(primaryAction);
  const cursorStyle = compiledView
    ? "default"
    : isPanning
    ? "grabbing"
    : ACTION_CURSOR[primaryAction];

  useEffect(() => {
    if (!statusMessage) return;
    const id = window.setTimeout(() => setStatusMessage(null), 2600);
    return () => window.clearTimeout(id);
  }, [statusMessage]);

  useEffect(() => {
    if (toolGroup !== "locations") {
      setLocationAction("navigate");
    }
    if (toolGroup !== "roads") {
      setRoadDraftStart(null);
      freehandDraftRef.current = [];
      setFreehandDraft([]);
    }
  }, [toolGroup]);

  useEffect(() => {
    if (compiledView) {
      setToolGroup("general");
      setLocationAction("navigate");
      setRoadDraftStart(null);
      setIsBrushing(false);
    }
  }, [compiledView]);

  useEffect(() => {
    if (!mapState) {
      setCompiledView(false);
      compiledPreferenceRef.current = false;
      return;
    }
    const available = !!(mapState.compiled_grid && mapState.compiled_iso);
    if (!available) {
      setCompiledView(false);
      compiledPreferenceRef.current = false;
      return;
    }
    if (!compiledPreferenceRef.current) {
      setCompiledView(true);
    }
  }, [mapState]);

  useEffect(() => {
    if (roadToolMode !== "auto" || toolGroup !== "roads") {
      setRoadDraftStart(null);
    }
  }, [roadToolMode, toolGroup]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const updateSize = () => {
      const bounds = node.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      });
    };
    if (typeof ResizeObserver === "undefined") {
      updateSize();
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setViewportSize({
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height)),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    activeWorldIdRef.current = worldId;
    setSaving(false);
    setCompiling(false);
    if (!worldId) {
      setMapState(null);
      setError("No world was selected.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setMapState(null);
    setError(null);
    setPreviewWarning(null);
    setSelectedCity(null);
    setSelectedCityName("");
    setSelectedCityPopulation("");
    setCityEditorCity(null);
    setDirty(false);
    setCityEditorDirty(false);
    setCityEditorSaving(false);
    setUndoStack([]);
    setRedoStack([]);
    setFreehandDraft([]);
    freehandDraftRef.current = [];
    revisionRef.current = 0;
    getWorldMap(worldId)
      .then((map) => {
        if (cancelled) return;
        if (map) {
          setMapState(ensureExtendedMap(map));
          setDirty(false);
        } else {
          setMapState(generateProceduralMap(Date.now()));
          setDirty(true);
        }
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(getErrorMessage(e, "We couldn't load this world map."));
        setMapState(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [worldId, loadAttempt]);

  useEffect(() => {
    if (!mapState || compiledView) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reliefRange = computeReliefRange(mapState);
    const temperatureRange = computeRange(mapState.temperature);
    const vegetationRange = computeRange(mapState.vegetation);
    const overlayRanges =
      overlayMode === "biomes"
        ? undefined
        : {
            relief: reliefRange,
            temperature: temperatureRange,
            vegetation: vegetationRange,
          };
    if (viewMode === "iso") {
      drawIsometricMap(
        canvas,
        mapState,
        zoom,
        panOffset,
        viewportSize,
        selectedCity?.id,
        roadDraftStart ?? undefined,
        overlayMode,
        overlayRanges,
        freehandDraft
      );
    } else {
      drawGridMap(
        canvas,
        mapState,
        zoom,
        panOffset,
        viewportSize,
        selectedCity?.id,
        roadDraftStart ?? undefined,
        overlayMode,
        overlayRanges,
        freehandDraft
      );
    }
  }, [
    mapState,
    zoom,
    panOffset,
    viewportSize,
      selectedCity,
      roadDraftStart,
      freehandDraft,
      viewMode,
      overlayMode,
      compiledView,
    ]);

  const mapInfo = useMemo(() => {
    if (!mapState) return null;
    const avgTemperature =
      mapState.temperature.reduce((acc, value) => acc + value, 0) /
      mapState.temperature.length;
    return {
      cityCount: mapState.cities.length,
      roadCount: mapState.roads.length,
      highestPeak: computeReliefRange(mapState).max,
      avgTemperature,
    };
  }, [mapState]);
  const compiledAvailable = !!(mapState?.compiled_grid && mapState?.compiled_iso);
  const compiledTimestamp = mapState?.compiled_updated_at
    ? new Date(mapState.compiled_updated_at).toLocaleString()
    : null;
  const compiledImage =
    viewMode === "iso" ? mapState?.compiled_iso ?? null : mapState?.compiled_grid ?? null;
  const compiledTransform = useMemo(
    () => `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
    [panOffset.x, panOffset.y, zoom]
  );
  const cityExternalConnections = useMemo(() => {
    if (!mapState || !cityEditorCity) return [] as CityMapApproach[];
    return mapState.roads.flatMap((road) => {
      if (road.points.length < 2) return [];
      const first = road.points[0];
      const last = road.points[road.points.length - 1];
      const cityAtStart = road.from_city_id === cityEditorCity.id || distance(first, cityEditorCity) < 0.025;
      const cityAtEnd = road.to_city_id === cityEditorCity.id || distance(last, cityEditorCity) < 0.025;
      if (cityAtStart) {
        const next = road.points[1];
        return [{ worldRoadId: road.id, angle: Math.atan2(next.y - first.y, next.x - first.x), roadClass: "arterial" as const }];
      }
      if (cityAtEnd) {
        const previous = road.points[road.points.length - 2];
        return [{ worldRoadId: road.id, angle: Math.atan2(previous.y - last.y, previous.x - last.x), roadClass: "arterial" as const }];
      }
      return [];
    });
  }, [mapState, cityEditorCity]);

  const generateMap = () => {
    if (mapState) rememberSnapshot(mapState);
    markEdited();
    setMapState(
      generateProceduralMap(
        Date.now(),
        mapState?.water_level ?? DEFAULT_WATER_LEVEL,
        mapState?.width ?? MAP_DEFAULT_SIZE,
        mapState?.height ?? MAP_DEFAULT_SIZE
      )
    );
    setSelectedCity(null);
    setSelectedCityName("");
    setSelectedCityPopulation("");
    setCityEditorCity(null);
    setStatusMessage("Generated new terrain.");
  };

  const handleGenerateMap = () => {
    if (mapState && (mapState.cities.length > 0 || mapState.roads.length > 0 || dirty)) {
      setConfirmation({ kind: "regenerate" });
      return;
    }
    generateMap();
  };

  const handleNaturalizeRelief = () => {
    if (mapState) rememberSnapshot(mapState);
    markEdited();
    setMapState((prev) =>
      prev
        ? {
            ...invalidateCompiledMap(prev),
            relief: smoothLayer(prev.relief, prev.width, prev.height, 1),
          }
        : prev
    );
    setStatusMessage("Smoothed elevation.");
  };

  const handleNormalizeLayer = (layer: "moisture" | "temperature" | "vegetation") => {
    if (mapState) rememberSnapshot(mapState);
    markEdited();
    setMapState((prev) =>
      prev
        ? {
            ...invalidateCompiledMap(prev),
            [layer]: normalizeLayer(prev[layer], prev.width, prev.height),
          }
        : prev
    );
    setStatusMessage(`Normalized ${layer}.`);
  };

  const handleWaterChange = (value: number) => {
    markEdited();
    setMapState((prev) => (prev ? { ...invalidateCompiledMap(prev), water_level: clamp(value, 0.05, 0.8) } : prev));
  };

  const handleSaveMap = async () => {
    if (!worldId || !mapState || saving) return;
    const saveWorldId = worldId;
    setSaving(true);
    setError(null);
    setPreviewWarning(null);
    const snapshot = ensureExtendedMap(mapState);
    const saveRevision = revisionRef.current;
    try {
      const savedSource = ensureExtendedMap(await saveWorldMap(saveWorldId, snapshot));
      const isActiveWorld = () => activeWorldIdRef.current === saveWorldId;
      if (isActiveWorld() && revisionRef.current === saveRevision) {
        setMapState(savedSource);
        setDirty(false);
        setStatusMessage("Map saved.");
      } else if (isActiveWorld()) {
        setStatusMessage("Saved an earlier snapshot; newer edits are still unsaved.");
      }
    } catch (e) {
      if (activeWorldIdRef.current === saveWorldId) {
        setError(getErrorMessage(e, "We couldn't save this world map."));
      }
    } finally {
      if (activeWorldIdRef.current === saveWorldId) setSaving(false);
    }
  };

  const handleCompileMap = async () => {
    if (!mapState || compiling || saving) return;
    const compileWorldId = worldId;
    const snapshot = ensureExtendedMap(mapState);
    const compileRevision = revisionRef.current;
    setCompiling(true);
    setError(null);
    setPreviewWarning(null);
    setStatusMessage("Rendering presentation views…");
    try {
      const compiled = await generateCompiledRenders(snapshot);
      if (!compiled.grid || !compiled.iso) throw new Error("The renderer returned an empty image.");
      if (activeWorldIdRef.current !== compileWorldId || revisionRef.current !== compileRevision) {
        if (activeWorldIdRef.current !== compileWorldId) return;
        setPreviewWarning("The source changed while rendering, so the outdated presentation was discarded. Render again when your edits are ready.");
        return;
      }
      revisionRef.current += 1;
      setMapState((current) => current ? {
        ...current,
        compiled_grid: compiled.grid,
        compiled_iso: compiled.iso,
        compiled_updated_at: Date.now(),
      } : current);
      setDirty(true);
      setCompiledView(true);
      compiledPreferenceRef.current = true;
      setStatusMessage("Presentation rendered. Save the map to keep it.");
    } catch (compileError) {
      if (activeWorldIdRef.current === compileWorldId) {
        setPreviewWarning(getErrorMessage(compileError, "We couldn't render the presentation views."));
      }
    } finally {
      if (activeWorldIdRef.current === compileWorldId) setCompiling(false);
    }
  };

  const resizeMap = () => {
    if (mapState) rememberSnapshot(mapState);
    markEdited();
    const next = generateProceduralMap(
      Date.now(),
      mapState?.water_level ?? DEFAULT_WATER_LEVEL,
      desiredSize,
      desiredSize
    );
    setMapState(next);
    setSelectedCity(null);
    setSelectedCityName("");
    setSelectedCityPopulation("");
    setCityEditorCity(null);
    setStatusMessage(`Rebuilt map at ${desiredSize} × ${desiredSize}.`);
  };

  const handleResizeMap = () => {
    if (mapState && (mapState.cities.length > 0 || mapState.roads.length > 0 || dirty)) {
      setConfirmation({ kind: "resize" });
      return;
    }
    resizeMap();
  };

  const screenToMapPoint = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!mapState || !canvasRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      if (viewMode === "grid") {
        const cellSize = TILE_BASE * zoom;
        const gridX = (localX - panOffset.x) / cellSize;
        const gridY = (localY - panOffset.y) / cellSize;
        if (gridX < 0 || gridY < 0 || gridX > mapState.width || gridY > mapState.height) {
          return null;
        }
        return {
          x: clamp(gridX / mapState.width, 0.5 / mapState.width, 1 - 0.5 / mapState.width),
          y: clamp(gridY / mapState.height, 0.5 / mapState.height, 1 - 0.5 / mapState.height),
        };
      }
      const tileWidth = TILE_BASE * zoom;
      const tileHeight = tileWidth / 2;
      const originX = viewportSize.width / 2 + panOffset.x;
      const originY = viewportSize.height / 2 - tileHeight / 2 + panOffset.y;
      const dx = localX - originX;
      const dy = localY - originY - tileHeight / 2;
      const sumCenter = (mapState.width - 1 + mapState.height - 1) / 2;
      const gridX = sumCenter / 2 + dx / tileWidth - dy / tileHeight;
      const gridY = sumCenter / 2 + dx / tileWidth + dy / tileHeight;
      if (
        gridX < -0.5 ||
        gridY < -0.5 ||
        gridX > mapState.width - 0.5 ||
        gridY > mapState.height - 0.5
      ) {
        return null;
      }
      return {
        x: clamp((gridX + 0.5) / mapState.width, 0.5 / mapState.width, 1 - 0.5 / mapState.width),
        y: clamp((gridY + 0.5) / mapState.height, 0.5 / mapState.height, 1 - 0.5 / mapState.height),
      };
    },
    [mapState, viewMode, zoom, panOffset, viewportSize]
  );

  const handleBrush = useCallback(
    (point: PixelPoint | null) => {
      if (!point || !mapState) return;
      markEdited();
      setMapState((prev) =>
        prev
          ? applyBrushToMap(prev, point, primaryAction, selectedBiome, brushSize)
          : prev
      );
    },
    [mapState, markEdited, primaryAction, selectedBiome, brushSize]
  );

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => clamp(prev + delta, MIN_ZOOM, MAX_ZOOM));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (cityEditorCity || saving) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (event.button !== 0) {
      setIsPanning(true);
      lastPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (primaryAction === "navigate") {
      const point = screenToMapPoint(event);
      if (!compiledView && point && mapState) {
        const nearest = findNearestCity(mapState, point, 0.035);
        if (nearest) {
          setSelectedCity(nearest);
          setSelectedCityName(nearest.name);
          setSelectedCityPopulation(String(nearest.population));
          setSelectedLocationKind(nearest.kind ?? "settlement");
          setStatusMessage(`Selected ${nearest.name}`);
        }
      }
      setIsPanning(true);
      lastPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (isBrushAction) {
      const point = screenToMapPoint(event);
      if (!point || !mapState) return;
      rememberSnapshot(mapState);
      handleBrush(point);
      setIsBrushing(true);
      return;
    }
    if (primaryAction === "draw-road") {
      const point = screenToMapPoint(event);
      if (!point || !mapState) return;
      freehandActiveRef.current = true;
      freehandDraftRef.current = [point];
      setFreehandDraft([point]);
      setRoadReport(null);
      setStatusMessage("Draw the road's course, then release to normalize it.");
      return;
    }
    if (primaryAction === "place-city") {
      const point = screenToMapPoint(event);
      if (point && mapState) {
        const name = draftCityName.trim() || `City ${mapState.cities.length + 1}`;
        const next = addCityToMap(mapState, name, draftLocationKind, point.x, point.y);
        if (!next.city) {
          setStatusMessage("Choose land or a coast with land within 12 cells.");
          return;
        }
        if (findNearestCity(mapState, next.city, 0.5 / Math.min(mapState.width, mapState.height))) {
          setStatusMessage("A city already occupies that location.");
          return;
        }
        rememberSnapshot(mapState);
        markEdited();
        setMapState(next.map);
        setSelectedCity(next.city);
        setSelectedCityName(next.city.name);
        setSelectedCityPopulation(String(next.city.population));
        setSelectedLocationKind(next.city.kind ?? "settlement");
        setDraftCityName(`City ${mapState.cities.length + 2}`);
        setStatusMessage(`Added ${name}. Save the world map before opening its city plan.`);
      }
      return;
    }
    if (primaryAction === "add-road") {
      const point = screenToMapPoint(event);
      if (!point || !mapState) return;
      const snapped = snapToNetwork(mapState, point);
      if (!roadDraftStart) {
        setRoadDraftStart(snapped);
        setStatusMessage(`Road anchor: ${snapped.label}`);
      } else {
        const routed = addManualRoad(mapState, roadDraftStart, snapped, {
          naturalVariation: roadNaturalness,
          maxBridgeCells: allowBridges ? 3 : 0,
        });
        if (routed.map === mapState) {
          setRoadReport(routed.result.warnings.join(" ") || "Choose a different endpoint for this road.");
          setStatusMessage("No safe route was added.");
          return;
        }
        rememberSnapshot(mapState);
        markEdited();
        setMapState(routed.map);
        setRoadDraftStart(null);
        setRoadReport(
          `${routed.result.distanceCells.toFixed(0)} cells · max grade ${routed.result.maxGrade.toFixed(2)}${
            routed.result.bridgeCells ? ` · ${routed.result.bridgeCells} bridge cells` : ""
          }${routed.result.warnings.length ? ` — ${routed.result.warnings.join(" ")}` : ""}`
        );
        setStatusMessage("Terrain-aware road added.");
      }
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const last = lastPanRef.current;
      if (last) {
        const dx = event.clientX - last.x;
        const dy = event.clientY - last.y;
        setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      }
      lastPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (isBrushing) {
      handleBrush(screenToMapPoint(event));
      return;
    }
    if (freehandActiveRef.current && mapState) {
      const point = screenToMapPoint(event);
      if (!point) return;
      const current = freehandDraftRef.current;
      const last = current[current.length - 1];
      if (last && distance(last, point) < 0.25 / Math.max(mapState.width, mapState.height)) return;
      const next = [...current, point];
      freehandDraftRef.current = next;
      setFreehandDraft(next);
    }
  };

  const handlePointerUp = (event?: ReactPointerEvent<HTMLCanvasElement>) => {
    const finishingFreehand = freehandActiveRef.current;
    if (finishingFreehand) freehandActiveRef.current = false;
    if (event?.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    setIsBrushing(false);
    lastPanRef.current = null;
    if (!finishingFreehand || !mapState) return;
    const raw = freehandDraftRef.current;
    freehandDraftRef.current = [];
    setFreehandDraft([]);
    if (raw.length < 2) {
      setRoadReport("Draw a longer line to create a road.");
      return;
    }
    const start = snapToNetwork(mapState, raw[0]);
    const end = snapToNetwork(mapState, raw[raw.length - 1]);
    const guidedStroke = [start, ...raw.slice(1, -1), end];
    const result = normalizeFreehandRoad(mapState, guidedStroke, {
      seed: mapState.seed + mapState.roads.length * 7_919,
      naturalVariation: roadNaturalness,
      maxBridgeCells: allowBridges ? 3 : 0,
      guideCorridorCells: 2.5,
      guideAttraction: 1.15,
    });
    if (result.usedFallback || result.points.length < 2) {
      setRoadReport(result.warnings.join(" ") || "No terrain-safe road matched that stroke.");
      setStatusMessage("No safe road was added. Adjust the stroke or bridge policy and try again.");
      return;
    }
    const roadId = randomId();
    rememberSnapshot(mapState);
    markEdited();
    setMapState({
      ...invalidateCompiledMap(mapState),
      roads: [...mapState.roads, {
        id: roadId,
        from_city_id: start.targetId ?? roadId,
        to_city_id: end.targetId ?? `${roadId}-end`,
        points: result.points,
      }],
    });
    setRoadReport(
      `${result.distanceCells.toFixed(0)} cells · normalized from ${raw.length} samples · max grade ${result.maxGrade.toFixed(2)}${
        result.bridgeCells ? ` · ${result.bridgeCells} bridge cells` : ""
      }${result.warnings.length ? ` — ${result.warnings.join(" ")}` : ""}`
    );
    setStatusMessage("Freehand road normalized and added.");
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const hadActiveGesture = freehandActiveRef.current || isBrushing || isPanning;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    setIsBrushing(false);
    lastPanRef.current = null;
    freehandActiveRef.current = false;
    freehandDraftRef.current = [];
    setFreehandDraft([]);
    if (hadActiveGesture) setStatusMessage("Map gesture cancelled.");
  };

  const handleSelectCity = (city: MapCity) => {
    setSelectedCity(city);
    setSelectedCityName(city.name);
    setSelectedCityPopulation(String(city.population));
    setSelectedLocationKind(city.kind ?? "settlement");
    setStatusMessage(`Selected ${city.name}`);
  };

  const handleCreateRoadFromLocations = () => {
    if (!mapState || !roadFromId || !roadToId || roadFromId === roadToId) {
      setRoadReport("Choose two different locations for the route.");
      return;
    }
    const from = mapState.cities.find((city) => city.id === roadFromId);
    const to = mapState.cities.find((city) => city.id === roadToId);
    if (!from || !to) {
      setRoadReport("One of the selected locations no longer exists.");
      return;
    }
    const routed = addManualRoad(
      mapState,
      { x: from.x, y: from.y, label: from.name, targetType: "city", targetId: from.id },
      { x: to.x, y: to.y, label: to.name, targetType: "city", targetId: to.id },
      { naturalVariation: roadNaturalness, maxBridgeCells: allowBridges ? 3 : 0 }
    );
    if (routed.map === mapState) {
      setRoadReport(routed.result.warnings.join(" ") || "No safe route was found.");
      return;
    }
    rememberSnapshot(mapState);
    markEdited();
    setMapState(routed.map);
    setRoadReport(
      `${from.name} → ${to.name}: ${routed.result.distanceCells.toFixed(0)} cells, max grade ${routed.result.maxGrade.toFixed(2)}${
        routed.result.bridgeCells ? `, ${routed.result.bridgeCells} bridge cells` : ""
      }${routed.result.warnings.length ? `. ${routed.result.warnings.join(" ")}` : ""}`
    );
    setStatusMessage(`Connected ${from.name} to ${to.name}.`);
  };

  const handleUpdateSelectedCity = () => {
    if (!selectedCity) return;
    const name = selectedCityName.trim().slice(0, 120);
    const population = Number(selectedCityPopulation);
    if (!name) {
      setError("City name is required.");
      return;
    }
    if (!Number.isFinite(population) || population < 0 || population > 2_000_000_000) {
      setError("Population must be between 0 and 2,000,000,000.");
      return;
    }
    const updated = { ...selectedCity, name, kind: selectedLocationKind, population: Math.round(population) };
    if (mapState) rememberSnapshot(mapState);
    markEdited();
    setMapState((current) => current ? {
      ...invalidateCompiledMap(current),
      cities: current.cities.map((city) => city.id === updated.id ? updated : city),
    } : current);
    setSelectedCity(updated);
    setCityEditorCity((current) => current?.id === updated.id ? updated : current);
    setStatusMessage(`Updated ${name}.`);
  };

  const deleteLocation = (locationId: string) => {
    if (!mapState) return;
    const deleted = mapState.cities.find((city) => city.id === locationId);
    if (!deleted) return;
    const endpointThreshold = 0.75 / Math.min(mapState.width, mapState.height);
    const directlyConnectedRoadIds = mapState.roads.flatMap((road) => {
      const first = road.points[0];
      const last = road.points[road.points.length - 1];
      return road.from_city_id === deleted.id ||
        road.to_city_id === deleted.id ||
        (first && distance(first, deleted) < endpointThreshold) ||
        (last && distance(last, deleted) < endpointThreshold)
        ? [road.id]
        : [];
    });
    const removedRoadIds = collectDependentRoadIds(mapState.roads, directlyConnectedRoadIds);
    rememberSnapshot(mapState);
    markEdited();
    setMapState((current) => current ? {
      ...invalidateCompiledMap(current),
      cities: current.cities.filter((city) => city.id !== deleted.id),
      roads: current.roads.filter((road) => !removedRoadIds.has(road.id)),
    } : current);
    setSelectedCity(null);
    setSelectedCityName("");
    setSelectedCityPopulation("");
    setCityEditorCity((current) => current?.id === deleted.id ? null : current);
    setStatusMessage(`${deleted.name} removed. Save the map to commit deletion.`);
  };

  const handleDeleteSelectedCity = () => {
    if (!selectedCity || !mapState) return;
    setConfirmation({ kind: "delete-location", locationId: selectedCity.id });
  };

  const deleteRoad = (roadId: string) => {
    if (!mapState) return;
    const removedRoadIds = collectDependentRoadIds(mapState.roads, [roadId]);
    rememberSnapshot(mapState);
    markEdited();
    setRoadDraftStart(null);
    setMapState((current) => current ? {
      ...invalidateCompiledMap(current),
      roads: current.roads.filter((road) => !removedRoadIds.has(road.id)),
    } : current);
    setStatusMessage(
      `${removedRoadIds.size} road${removedRoadIds.size === 1 ? "" : "s"} removed. Save the map to commit deletion.`
    );
  };

  const handleRemoveWorldRoad = (roadId: string) => {
    if (!mapState) return;
    const dependentCount = collectDependentRoadIds(mapState.roads, [roadId]).size - 1;
    setConfirmation({ kind: "delete-road", roadId, dependentCount });
  };

  const confirmMapChange = () => {
    if (!confirmation) return;
    const action = confirmation;
    setConfirmation(null);
    if (action.kind === "regenerate") generateMap();
    else if (action.kind === "resize") resizeMap();
    else if (action.kind === "delete-location") deleteLocation(action.locationId);
    else deleteRoad(action.roadId);
  };

  const handleViewToggle = () => {
    setViewMode((prev) => (prev === "iso" ? "grid" : "iso"));
  };

  const handleSidebarToggle = () => {
    setSidebarOpen((prev) => !prev);
  };
  const renderGeneralPanel = () => (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-earth-sand/60">
          Map status
        </p>
        <div className="rounded-xl border border-earth-clay/40 p-4 bg-black/30 text-sm space-y-1">
          <p>Cities: {mapInfo?.cityCount ?? 0}</p>
          <p>Roads: {mapInfo?.roadCount ?? 0}</p>
          <p>
            Peak: {(mapInfo?.highestPeak ?? 0).toFixed(2)}  |  Avg temp:
            {(mapInfo?.avgTemperature ?? 0).toFixed(2)}
          </p>
          <p className={dirty ? "text-amber-300" : "text-emerald-300"} role="status">
            {dirty ? "Unsaved map changes" : "Source map saved"}
          </p>
          <p className={compiledAvailable ? "text-emerald-300" : "text-amber-300"}>
            {compiledAvailable ? "Previews current" : "Previews need compiling"}
          </p>
        </div>
        {previewWarning && (
          <p role="alert" className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            {previewWarning}
          </p>
        )}
      </section>
      <section className="grid grid-cols-2 gap-3">
        <button onClick={handleGenerateMap} className="primary-button" type="button">
          Generate terrain
        </button>
        <button
          onClick={handleCompileMap}
          className="secondary-button"
          type="button"
          disabled={saving || compiling}
        >
          {compiling ? "Rendering…" : compiledAvailable ? "Refresh presentation" : "Render presentation"}
        </button>
      </section>
      <section className="space-y-2 text-sm">
        <div className="flex gap-2">
          <button
            onClick={() => {
              compiledPreferenceRef.current = true;
              setCompiledView(true);
            }}
            className="primary-button flex-1 disabled:opacity-50"
            type="button"
            disabled={!compiledAvailable || !mapState?.compiled_iso || !mapState?.compiled_grid}
          >
            {compiledAvailable ? "View presentation" : "Render presentation first"}
          </button>
          <button
            type="button"
            onClick={() => {
              compiledPreferenceRef.current = true;
              setCompiledView(false);
            }}
            className="secondary-button flex-1"
            disabled={!compiledView}
          >
            Back to editor
          </button>
        </div>
        <p className="text-[11px] text-earth-sand/60">
          {compiledAvailable
            ? `Last baked: ${compiledTimestamp ?? "unknown"}`
            : "Render creates top-down and isometric previews; Save persists them."}
        </p>
      </section>
      <section className="space-y-2 text-sm">
        <label className="flex items-center justify-between gap-4">
          <span>Water level</span>
          <input
            type="range"
            min={0.05}
            max={0.8}
            step={0.01}
            value={mapState?.water_level ?? DEFAULT_WATER_LEVEL}
            onPointerDown={() => { if (mapState) rememberSnapshot(mapState); }}
            onChange={(event) => handleWaterChange(Number(event.target.value))}
          />
        </label>
        <div className="flex items-center justify-between gap-4">
          <span>View</span>
          <button
            type="button"
            onClick={handleViewToggle}
            className="px-3 py-1 rounded border border-brand/50 text-xs"
          >
            Switch to {viewMode === "iso" ? "Top-down" : "Isometric"}
          </button>
        </div>
        <label className="flex items-center justify-between gap-4">
          <span>Overlay</span>
          <select
            className="px-3 py-1 rounded border border-earth-clay/40 bg-black/40 text-xs"
            value={overlayMode}
            onChange={(event) => setOverlayMode(event.target.value as OverlayMode)}
          >
            <option value="biomes">Biomes</option>
            <option value="relief">Relief</option>
            <option value="temperature">Temperature</option>
            <option value="vegetation">Vegetation</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
      </section>
      <section className="space-y-3 text-sm">
        <label className="flex flex-col gap-1">
          Map size
          <select
            className="input-field"
            value={desiredSize}
            onChange={(event) => setDesiredSize(Number(event.target.value))}
          >
            {MAP_SIZE_CHOICES.map((size) => (
              <option key={size} value={size}>
                {size} x {size}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={handleResizeMap} className="secondary-button">
          Rebuild at size
        </button>
        <button type="button" onClick={handleNaturalizeRelief} className="secondary-button">
          Smooth relief
        </button>
      </section>
    </div>
  );

  const renderBiomePanel = () => (
    <div className="space-y-5 text-sm">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-earth-sand/60 mb-3">
          Brush mode
        </p>
        <div className="grid grid-cols-4 gap-2">
          {(["palette", "moisture", "temperature", "vegetation"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBiomeToolMode(mode as BiomeToolMode)}
              className={`px-3 py-2 rounded border ${
                biomeToolMode === mode
                  ? "border-brand bg-brand/10"
                  : "border-earth-clay/30"
              }`}
            >
              {mode === "palette" ? "Biomes" : mode === "moisture" ? "Humidity" : `${mode[0].toUpperCase()}${mode.slice(1)}`}
            </button>
          ))}
        </div>
      </div>
      {biomeToolMode === "palette" ? (
        <div className="space-y-3">
          {BIOME_GROUPS.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-earth-sand/60">
                {group.label}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {group.biomes.map((biome) => (
                  <button
                    key={biome}
                    type="button"
                    onClick={() => setSelectedBiome(biome)}
                  className={`flex min-h-10 items-center gap-2 rounded-xl border px-2 py-1 text-left text-xs ${
                      selectedBiome === biome
                        ? "border-brand bg-brand/15 text-brand-glow"
                        : "border-earth-clay/30"
                  }`}
                  >
                    <span className="h-4 w-4 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: `rgb(${BIOME_COLORS[biome].join(",")})` }} aria-hidden="true" />
                    <span className="capitalize">{biome.replace(/_/g, " ")}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-grove-600/70 bg-grove-800/25 p-3">
            <p className="text-xs font-semibold capitalize text-brand-glow">{biomeToolMode === "moisture" ? "Humidity" : biomeToolMode}</p>
            <p className="mt-1 text-xs text-slate-400">{(() => { const layer = CLIMATE_LAYERS.find((item) => item.key === biomeToolMode); return layer ? `${layer.minLabel} → ${layer.maxLabel}` : ""; })()}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setClimateDirection("raise")}
              className={`flex-1 rounded border px-3 py-2 ${
                climateDirection === "raise"
                  ? "border-brand bg-brand/15"
                  : "border-earth-clay/30"
              }`}
            >
              Raise
            </button>
            <button
              type="button"
              onClick={() => setClimateDirection("lower")}
              className={`flex-1 rounded border px-3 py-2 ${
                climateDirection === "lower"
                  ? "border-brand bg-brand/15"
                  : "border-earth-clay/30"
              }`}
            >
              Lower
            </button>
          </div>
        </div>
      )}
      <label className="flex flex-col gap-1">
        Brush size
        <input
          type="range"
          min={0.01}
          max={0.2}
          step={0.01}
          value={brushSize}
          onChange={(event) => setBrushSize(Number(event.target.value))}
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        {CLIMATE_LAYERS.map((layer) => (
          <button
            key={layer.key}
            type="button"
            onClick={() => handleNormalizeLayer(layer.key)}
            className="text-[11px] rounded border border-earth-clay/40 px-2 py-1"
          >
            Normalize {layer.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderReliefPanel = () => (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setReliefAction("raise")}
          className={`flex-1 rounded border px-3 py-2 ${
            reliefAction === "raise"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Raise
        </button>
        <button
          type="button"
          onClick={() => setReliefAction("lower")}
          className={`flex-1 rounded border px-3 py-2 ${
            reliefAction === "lower"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Lower
        </button>
      </div>
      <label className="flex flex-col gap-1">
        Brush size
        <input
          type="range"
          min={0.01}
          max={0.2}
          step={0.01}
          value={brushSize}
          onChange={(event) => setBrushSize(Number(event.target.value))}
        />
      </label>
      <div className="space-y-2">
        <button type="button" onClick={handleNaturalizeRelief} className="secondary-button">
          Smooth relief
        </button>
        <button
          type="button"
          onClick={() => handleNormalizeLayer("vegetation")}
          className="secondary-button"
        >
          Normalize vegetation
        </button>
      </div>
      <p className="text-xs text-earth-sand/70">
        Relief brushes push or erode the terrain. Right click at any time to pan.
      </p>
    </div>
  );

  const renderRoadsPanel = () => (
    <div className="space-y-5 text-sm">
      <section className="space-y-3">
        <div>
          <p className="section-label">Road builder</p>
          <p className="mt-2 text-xs leading-5 text-slate-300">Routes weigh grade, altitude, water, vegetation, biomes, and the existing network. Unsafe fallbacks are never added.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([
            ["auto", "Auto route"],
            ["freehand", "Freehand"],
            ["select", "Navigate"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={roadToolMode === mode}
              onClick={() => { setRoadToolMode(mode); setRoadDraftStart(null); setRoadReport(null); }}
              className={`min-h-11 rounded-xl border px-2 text-xs font-semibold ${roadToolMode === mode ? "border-brand bg-brand/15 text-emerald-100" : "border-grove-600 text-slate-300 hover:bg-grove-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {roadToolMode === "auto" && (
        <section className="space-y-3 rounded-2xl border border-grove-600/70 bg-grove-800/25 p-4">
          <p className="text-xs font-semibold text-brand-glow">Canvas route</p>
          <p className="text-xs leading-5 text-slate-400">Choose a start point, then an endpoint. Both snap to nearby locations and roads.</p>
          {roadDraftStart && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-earth-clay/35 bg-earth-clay/10 px-3 py-2 text-xs text-earth-sand">
              <span>Start: {roadDraftStart.label}</span>
              <button type="button" className="rounded-lg px-2 py-1 hover:bg-grove-700" onClick={() => setRoadDraftStart(null)}>Cancel</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[11px] text-slate-400">From location
              <select className="input-field !py-2" value={roadFromId} onChange={(event) => setRoadFromId(event.target.value)}>
                <option value="">Choose…</option>
                {mapState?.cities.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[11px] text-slate-400">To location
              <select className="input-field !py-2" value={roadToId} onChange={(event) => setRoadToId(event.target.value)}>
                <option value="">Choose…</option>
                {mapState?.cities.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
          </div>
          <button type="button" className="secondary-button w-full" onClick={handleCreateRoadFromLocations} disabled={!roadFromId || !roadToId || roadFromId === roadToId}>Create terrain-aware route</button>
        </section>
      )}

      {roadToolMode === "freehand" && (
        <section className="rounded-2xl border border-grove-600/70 bg-grove-800/25 p-4">
          <p className="text-xs font-semibold text-brand-glow">Draw the desired course</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">Press, trace the route, and release. The stroke is simplified, resampled, and gently redirected around steep or impassable terrain.</p>
        </section>
      )}

      <section className="space-y-3">
        <label className="block text-xs text-slate-300">Natural variation <span className="float-right text-earth-sand">{Math.round(roadNaturalness * 100)}%</span>
          <input className="mt-2 w-full accent-emerald-500" type="range" min={0} max={0.6} step={0.05} value={roadNaturalness} onChange={(event) => setRoadNaturalness(Number(event.target.value))} />
        </label>
        <label className="flex min-h-11 items-center justify-between rounded-xl border border-grove-600/70 bg-grove-800/25 px-3 text-xs text-slate-300">
          Allow short bridges
          <input className="h-4 w-4 accent-emerald-500" type="checkbox" checked={allowBridges} onChange={(event) => setAllowBridges(event.target.checked)} />
        </label>
      </section>

      {roadReport && <div className="status-info text-xs leading-5" role="status">{roadReport}</div>}

      <section className="space-y-2">
        <div className="flex items-center justify-between"><p className="section-label">Road network</p><span className="text-xs text-slate-400">{mapState?.roads.length ?? 0}</span></div>
        <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
          {mapState?.roads.map((road, index) => (
            <div key={road.id} className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-grove-600/60 bg-grove-800/20 px-3 text-xs">
              <span><strong className="font-semibold text-brand-glow">Road {index + 1}</strong><span className="ml-2 text-slate-400">{road.points.length} points</span></span>
              <button type="button" className="rounded-lg px-2 py-1 text-red-200 hover:bg-red-950/35" aria-label={`Remove road ${index + 1}`} onClick={() => handleRemoveWorldRoad(road.id)}>Remove</button>
            </div>
          ))}
          {!mapState?.roads.length && <p className="rounded-xl border border-dashed border-grove-600 px-3 py-5 text-center text-xs text-slate-400">No roads yet.</p>}
        </div>
      </section>
    </div>
  );

  const renderLocationsPanel = () => (
    <div className="space-y-4 text-sm">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setLocationAction("navigate")}
          className={`flex-1 rounded border px-3 py-2 ${
            locationAction === "navigate"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Navigate
        </button>
        <button
          type="button"
          onClick={() => setLocationAction("place-city")}
          className={`flex-1 rounded border px-3 py-2 ${
            locationAction === "place-city"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Add location
        </button>
      </div>
      <label className="flex flex-col gap-1">
        Location type
        <select className="input-field" value={draftLocationKind} onChange={(event) => setDraftLocationKind(event.target.value as MapLocationKind)}>
          <option value="settlement">Settlement</option>
          <option value="port">Port</option>
          <option value="fortress">Fortress</option>
          <option value="ruin">Ruin</option>
          <option value="landmark">Landmark</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Location label
        <input
          className="input-field"
          value={draftCityName}
          onChange={(event) => setDraftCityName(event.target.value)}
        />
      </label>
      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
        {mapState?.cities.map((city) => (
          <button
            key={city.id}
            type="button"
            onClick={() => handleSelectCity(city)}
            className={`w-full text-left px-3 py-2 rounded border ${
              selectedCity?.id === city.id
                ? "border-brand bg-brand/15"
                : "border-earth-clay/30"
            }`}
          >
            <p className="text-sm font-semibold">{city.name}</p>
            <p className="text-xs capitalize text-earth-sand/70">{city.kind ?? "settlement"} · {(city.x * mapState.width).toFixed(1)}, {(city.y * mapState.height).toFixed(1)}</p>
          </button>
        ))}
        {!mapState?.cities.length && <p className="text-xs text-earth-sand/60">No locations placed yet.</p>}
      </div>
      {selectedCity && (
        <section className="space-y-2 rounded-xl border border-earth-clay/30 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-earth-sand/60">Selected location</p>
          <label className="flex flex-col gap-1">
            Type
            <select className="input-field" value={selectedLocationKind} onChange={(event) => setSelectedLocationKind(event.target.value as MapLocationKind)}>
              <option value="settlement">Settlement</option><option value="port">Port</option><option value="fortress">Fortress</option><option value="ruin">Ruin</option><option value="landmark">Landmark</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Name
            <input className="input-field" maxLength={120} value={selectedCityName} onChange={(event) => setSelectedCityName(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            Population
            <input className="input-field" type="number" min={0} max={2_000_000_000} step={1} value={selectedCityPopulation} onChange={(event) => setSelectedCityPopulation(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={handleUpdateSelectedCity} className="primary-button">Apply details</button>
            {(selectedLocationKind === "settlement" || selectedLocationKind === "port" || selectedLocationKind === "fortress") && <button
              type="button"
              onClick={() => setCityEditorCity(selectedCity)}
              className="secondary-button"
              disabled={dirty || saving}
              title={dirty ? "Save the world map before editing this city's plan." : undefined}
            >
              Open City Studio
            </button>}
          </div>
          {dirty && (
            <p className="text-xs text-amber-300">Save the world map before opening this location's city plan.</p>
          )}
          <button type="button" onClick={handleDeleteSelectedCity} className="w-full rounded border border-red-800/70 px-3 py-2 text-red-300">
            Remove location and connected roads
          </button>
        </section>
      )}
      <p className="text-xs text-earth-sand/70">
        Add only places the selected location. Roads and city plans are separate tools.
      </p>
    </div>
  );

  const renderCompiledPanel = () => (
    <div className="space-y-4 text-sm">
      <section className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-earth-sand/60">
          Compiled view
        </p>
        <p className="text-earth-sand/80">
          Using baked top-down / isometric renders with grading and noise.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setCompiledView(false)} className="secondary-button flex-1">
            Return to editor
          </button>
          <button type="button" onClick={handleViewToggle} className="primary-button flex-1">
            Switch to {viewMode === "iso" ? "Top-down" : "Isometric"}
          </button>
        </div>
        <p className="text-[11px] text-earth-sand/60">
          {compiledTimestamp
            ? `Last baked: ${compiledTimestamp}`
            : "Render presentation to create both views, then save to persist them."}
        </p>
      </section>
      <section className="space-y-2">
        <p className="text-xs uppercase tracking-[0.25em] text-earth-sand/60">
          Locations
        </p>
        <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {mapState?.cities.map((city) => (
            <button
              key={city.id}
              type="button"
              onClick={() => handleSelectCity(city)}
              className={`w-full text-left px-3 py-2 rounded border ${
                selectedCity?.id === city.id
                  ? "border-brand bg-brand/15"
                  : "border-earth-clay/30"
              }`}
            >
              <p className="text-sm font-semibold">{city.name}</p>
              <p className="text-xs text-earth-sand/70">
                {(city.x * (mapState?.width ?? 0)).toFixed(1)}  |  {(city.y * (mapState?.height ?? 0)).toFixed(1)}
              </p>
            </button>
          ))}
          {!mapState?.cities.length && (
            <p className="text-xs text-earth-sand/60">No cities placed yet.</p>
          )}
        </div>
      </section>
    </div>
  );

  const renderPanel = () => {
    if (!mapState) return null;
    if (compiledView) return renderCompiledPanel();
    switch (toolGroup) {
      case "general":
        return renderGeneralPanel();
      case "biome":
        return renderBiomePanel();
      case "relief":
        return renderReliefPanel();
      case "roads":
        return renderRoadsPanel();
      case "locations":
        return renderLocationsPanel();
      default:
        return null;
    }
  };
  if (loading) {
    return (
      <div role="status" className="h-full w-full flex items-center justify-center text-earth-sand/70">
        Loading map…
      </div>
    );
  }

  if (!mapState) {
    return (
      <div className="h-full w-full flex flex-col gap-3 items-center justify-center text-center text-red-200">
        <p role="alert">{error ?? "Failed to load map data."}</p>
        <button type="button" className="secondary-button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#050c08] pt-[4.75rem] text-earth-sand">
      <header className="relative z-30 flex min-h-[4.25rem] shrink-0 items-center justify-between gap-3 border-y border-grove-600/70 bg-grove-900/95 px-3 py-2 shadow-xl backdrop-blur-xl sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className="icon-button shrink-0 sm:hidden" aria-label={sidebarOpen ? "Close map tools" : "Open map tools"} aria-expanded={sidebarOpen} onClick={handleSidebarToggle}>☰</button>
          <div className="min-w-0">
            <p className="section-label">Map Studio</p>
            <p className="truncate font-display text-lg font-semibold text-brand-glow">World cartography</p>
          </div>
          <span className={`hidden rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:inline-flex ${dirty ? "border-amber-400/40 bg-amber-950/30 text-amber-200" : "border-emerald-400/35 bg-emerald-950/25 text-emerald-200"}`} role="status">
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <div className="hidden rounded-xl border border-grove-600 bg-grove-950/70 p-1 md:flex" role="group" aria-label="Map mode">
            <button type="button" aria-pressed={!compiledView} onClick={() => { compiledPreferenceRef.current = true; setCompiledView(false); }} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${!compiledView ? "bg-brand text-grove-950" : "text-slate-300 hover:bg-grove-700"}`}>Edit</button>
            <button type="button" aria-pressed={compiledView} disabled={!compiledAvailable} onClick={() => { compiledPreferenceRef.current = true; setCompiledView(true); }} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${compiledView ? "bg-brand text-grove-950" : "text-slate-300 hover:bg-grove-700"}`}>Presentation</button>
          </div>
          <div className="hidden rounded-xl border border-grove-600 bg-grove-950/70 p-1 lg:flex" role="group" aria-label="Map projection">
            <button type="button" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${viewMode === "grid" ? "bg-earth-sand text-grove-950" : "text-slate-300 hover:bg-grove-700"}`}>Top-down</button>
            <button type="button" aria-pressed={viewMode === "iso"} onClick={() => setViewMode("iso")} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${viewMode === "iso" ? "bg-earth-sand text-grove-950" : "text-slate-300 hover:bg-grove-700"}`}>Isometric</button>
          </div>
          <button type="button" className="icon-button" aria-label="Undo map edit" title="Undo" onClick={handleUndo} disabled={!undoStack.length || compiledView || saving || compiling}>↶</button>
          <button type="button" className="icon-button" aria-label="Redo map edit" title="Redo" onClick={handleRedo} disabled={!redoStack.length || compiledView || saving || compiling}>↷</button>
          <button type="button" className="secondary-button min-h-11 whitespace-nowrap" onClick={handleCompileMap} disabled={saving || compiling}>{compiling ? "Rendering…" : compiledAvailable ? "Refresh presentation" : "Render presentation"}</button>
          <button type="button" className="primary-button min-h-11 whitespace-nowrap" onClick={handleSaveMap} disabled={saving || compiling || !dirty}>{saving ? "Saving…" : "Save map"}</button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
      <div className="absolute inset-0 flex">
        {sidebarOpen && <button type="button" aria-label="Close map tools" className="absolute inset-0 z-10 bg-black/55 sm:hidden" onClick={() => setSidebarOpen(false)} />}
        <div
          className={`absolute inset-y-0 left-0 z-20 h-full flex-col border-r border-grove-600/70 bg-grove-900/97 text-sm shadow-2xl transition-all duration-200 sm:relative sm:z-auto sm:flex sm:shadow-none ${
            sidebarOpen ? "flex w-[min(23rem,calc(100vw-3rem))]" : "hidden sm:w-[4.25rem]"
          }`}
        >
          <div className="flex min-h-12 items-center justify-between border-b border-grove-600/70 px-3 py-2">
            {sidebarOpen && (
              <p className="section-label">
                {compiledView ? "Presentation" : "Map tools"}
              </p>
            )}
            <button
              type="button"
              aria-label={sidebarOpen ? "Collapse map tools" : "Expand map tools"}
              aria-expanded={sidebarOpen}
              className="icon-button !min-h-9 !min-w-9"
              onClick={handleSidebarToggle}
            >
              {sidebarOpen ? "‹" : "›"}
            </button>
          </div>
          {sidebarOpen ? (
            <div className="flex flex-1 min-h-0 flex-col">
              <div className="grid grid-cols-2 gap-2 border-b border-grove-600/60 p-3">
                {(Object.entries(TOOL_GROUP_LABELS) as [ToolGroup, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={toolGroup === key}
                    onClick={() => setToolGroup(key)}
                    className={`min-h-10 rounded-xl border px-3 py-2 text-xs font-semibold ${
                      toolGroup === key
                        ? "bg-brand text-black font-semibold"
                        : "border-grove-600 bg-grove-800/25 text-slate-300 hover:bg-grove-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {renderPanel()}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex-1 relative">
          <div
            ref={viewportRef}
            className="h-full w-full relative bg-gradient-to-br from-black via-brand-deep to-black"
          >
            {compiledView && compiledImage ? (
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <img
                  src={compiledImage}
                  alt="Compiled world map"
                  className="h-full w-full object-contain select-none pointer-events-none"
                  style={{
                    transform: compiledTransform,
                    transformOrigin: "center center",
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-br from-black/25 via-transparent to-black/35 pointer-events-none" />
              </div>
            ) : null}
            {compiledView && !compiledImage ? (
              <div className="absolute inset-0 flex items-center justify-center text-earth-sand/70 text-sm">
                Render the presentation views, then save if you want to keep them.
              </div>
            ) : null}
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="World map editor. Use the adjacent tool panels for keyboard-accessible controls; arrow keys pan, plus and minus zoom, and Escape cancels a road gesture."
              tabIndex={0}
              className="absolute inset-0"
              style={{
                cursor: cursorStyle,
                opacity: compiledView ? 0 : 1,
                pointerEvents: "auto",
                touchAction: "none",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onKeyDown={(event) => {
                const panStep = event.shiftKey ? 80 : 32;
                if (event.key === "ArrowLeft") setPanOffset((current) => ({ ...current, x: current.x + panStep }));
                else if (event.key === "ArrowRight") setPanOffset((current) => ({ ...current, x: current.x - panStep }));
                else if (event.key === "ArrowUp") setPanOffset((current) => ({ ...current, y: current.y + panStep }));
                else if (event.key === "ArrowDown") setPanOffset((current) => ({ ...current, y: current.y - panStep }));
                else if (event.key === "+" || event.key === "=") setZoom((current) => clamp(current + 0.1, MIN_ZOOM, MAX_ZOOM));
                else if (event.key === "-" || event.key === "_") setZoom((current) => clamp(current - 0.1, MIN_ZOOM, MAX_ZOOM));
                else if (event.key === "Escape") {
                  setRoadDraftStart(null);
                  freehandActiveRef.current = false;
                  freehandDraftRef.current = [];
                  setFreehandDraft([]);
                }
                else return;
                event.preventDefault();
              }}
              onWheel={handleWheel}
              onContextMenu={(event) => event.preventDefault()}
            />
            <div className="pointer-events-none absolute right-4 top-4 max-w-[calc(100%-2rem)] space-y-1 rounded-xl border border-grove-600/75 bg-grove-950/80 px-4 py-3 text-xs text-slate-200 shadow-xl backdrop-blur">
              <p>
                {compiledView
                  ? "Presentation preview — navigation only"
                  : `Primary: ${PRIMARY_ACTION_LABEL[primaryAction]}  |  Secondary: Pan`}
              </p>
              <p>View: {viewMode === "iso" ? "Isometric" : "Top-down"}</p>
              {compiledView && compiledTimestamp && (
                <p>Last baked: {compiledTimestamp}</p>
              )}
              {roadDraftStart && <p>Road anchor: {roadDraftStart.label}</p>}
            </div>
            {statusMessage && (
              <div role="status" className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 text-earth-sand px-4 py-2 rounded-full text-xs border border-brand/40">
                {statusMessage}
              </div>
            )}
            {error && (
              <div role="alert" className="absolute bottom-6 right-6 max-w-[calc(100%-2rem)] bg-red-800/90 text-sm px-3 py-2 rounded">
                {error}
              </div>
            )}
            {previewWarning && (
              <div role="alert" className="absolute bottom-6 right-6 max-w-md rounded-xl border border-amber-400/40 bg-amber-950/90 px-4 py-3 text-xs leading-5 text-amber-100 shadow-xl">
                {previewWarning}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
      <footer className="flex min-h-9 shrink-0 items-center justify-between gap-4 border-t border-grove-600/70 bg-grove-950/95 px-4 text-[11px] text-slate-400">
        <span>{compiledView ? "Presentation mode" : `${TOOL_GROUP_LABELS[toolGroup]} · ${PRIMARY_ACTION_LABEL[primaryAction]}`} · right-drag to pan</span>
        <span>{mapState.width}×{mapState.height} · {mapState.cities.length} location{mapState.cities.length === 1 ? "" : "s"} · {mapState.roads.length} road{mapState.roads.length === 1 ? "" : "s"} · {Math.round(zoom * 100)}%</span>
      </footer>
      {cityEditorCity && worldId ? (
        <CityMapEditor
          key={cityEditorCity.id}
          worldId={worldId}
          city={cityEditorCity}
          externalConnections={cityExternalConnections}
          onDirtyChange={setCityEditorDirty}
          onSavingChange={setCityEditorSaving}
          onClose={() => {
            setCityEditorDirty(false);
            setCityEditorSaving(false);
            setCityEditorCity(null);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(confirmation)}
        eyebrow={confirmation?.kind === "delete-road" || confirmation?.kind === "delete-location" ? "Remove map content" : "Replace map content"}
        title={confirmation?.kind === "resize" ? `Rebuild at ${desiredSize} × ${desiredSize}?` : confirmation?.kind === "regenerate" ? "Generate new terrain?" : confirmation?.kind === "delete-location" ? "Remove this location?" : "Remove this road?"}
        description={
          confirmation?.kind === "resize" || confirmation?.kind === "regenerate"
            ? "This replaces terrain, climate, locations, roads, and any linked city plans after you save. You can undo the local change before saving."
            : confirmation?.kind === "delete-location"
              ? `This removes ${mapState.cities.find((city) => city.id === confirmation.locationId)?.name ?? "the location"}, every connected road branch, and its city plan after the world map is saved.`
              : confirmation?.kind === "delete-road" && confirmation.dependentCount > 0
                ? `This removes the selected road and ${confirmation.dependentCount} dependent branch${confirmation.dependentCount === 1 ? "" : "es"}. You can undo before saving.`
                : "This removes the selected road. You can undo before saving."
        }
        confirmLabel={confirmation?.kind === "resize" ? "Rebuild map" : confirmation?.kind === "regenerate" ? "Generate terrain" : confirmation?.kind === "delete-location" ? "Remove location" : "Remove road"}
        danger
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmMapChange}
      />
      <ConfirmDialog
        open={navigationConfirmationOpen}
        eyebrow="Unsaved map changes"
        title="Leave Map Studio?"
        description="Your unsaved world-map or city-plan changes will be discarded. Save first if you want to keep this work."
        confirmLabel="Discard and leave"
        cancelLabel="Stay in Map Studio"
        danger
        onCancel={() => {
          setNavigationConfirmationOpen(false);
          if (blocker.state === "blocked") blocker.reset();
        }}
        onConfirm={() => {
          setNavigationConfirmationOpen(false);
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
    </div>
  );
}
