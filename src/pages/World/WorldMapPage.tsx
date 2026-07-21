import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, WheelEvent } from "react";
import { useParams } from "react-router-dom";
import {
  getWorldMap,
  saveWorldMap,
  type MapCity,
} from "../../api/worldMap";
import { CityMapEditor } from "../../components/CityMapEditor";
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
  ClimateTarget,
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

const iconCache = new Map<string, Promise<HTMLImageElement>>();

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
  alpha = 0.1
) {
  const noiseCanvas = document.createElement("canvas");
  noiseCanvas.width = 96;
  noiseCanvas.height = 96;
  const nctx = noiseCanvas.getContext("2d");
  if (!nctx) return;
  const image = nctx.createImageData(noiseCanvas.width, noiseCanvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
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
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
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

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(224,196,128,0.9)";
  map.roads.forEach((road) => {
    if (!road.points.length) return;
    ctx.beginPath();
    road.points.forEach((point, index) => {
      const px = point.x * map.width * cellSize;
      const py = point.y * map.height * cellSize;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });

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
            ctx.drawImage(img, cx - vegSize / 2, cy - vegSize / 2, vegSize, vegSize);
          })
        );
      }
      if (terrainUrl && pseudoRandom(x, y, map.seed + 707) > 0.72) {
        const size = Math.max(14, cellSize * 0.9);
        iconPromises.push(
          loadIcon(terrainUrl).then((img) => {
            ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
          })
        );
      }
      x += step;
    }
    y += baseStep;
  }

  map.cities.forEach((city) => {
    const tier = cityTier(city.population);
    const iconUrl = settlementIcons[tier];
    const px = city.x * map.width * cellSize;
    const py = city.y * map.height * cellSize;
    const size = Math.max(18, cellSize * 1.1);
    iconPromises.push(
      loadIcon(iconUrl).then((img) => {
        ctx.drawImage(img, px - size / 2, py - size / 2, size, size);
      })
    );
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = `${Math.max(11, cellSize * 0.4)}px 'Space Grotesk', sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(city.name, px, py - size * 0.75);
    ctx.restore();
  });

  await Promise.all(iconPromises);
  applyFantasyOverlay(ctx, width, height);
  applyNoiseOverlay(ctx, width, height, 0.08);
  return canvas.toDataURL("image/png");
}

async function drawCompiledIso(map: MapStateExtended): Promise<string> {
  const tileWidth = Math.max(16, Math.floor(1400 / (map.width + map.height)));
  const tileHeight = tileWidth / 2;
  const logicalWidth = Math.max(960, Math.floor(tileWidth * (map.width + map.height)));
  const logicalHeight = Math.max(720, Math.floor(tileHeight * (map.width + map.height)));
  const canvas = document.createElement("canvas");
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
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

  ctx.fillStyle = "#0a0b0d";
  ctx.fillRect(0, 0, width, height);

  const originX = width / 2;
  const originY = tileHeight * 2;
  const sumCenter = (map.width - 1 + map.height - 1) / 2;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const idx = y * map.width + x;
      const biome = computeBiome(map, idx);
      const color = stylizeColor(BIOME_COLORS[biome]);
      const isoX = (x + y - sumCenter) * (tileWidth / 2) + originX;
      const isoY = (y - x) * (tileHeight / 2) + originY;
      ctx.beginPath();
      ctx.moveTo(isoX, isoY);
      ctx.lineTo(isoX + tileWidth / 2, isoY + tileHeight / 2);
      ctx.lineTo(isoX, isoY + tileHeight);
      ctx.lineTo(isoX - tileWidth / 2, isoY + tileHeight / 2);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(8,25,19,0.28)";
      ctx.stroke();
    }
  }

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(224,196,128,0.85)";
  map.roads.forEach((road) => {
    if (!road.points.length) return;
    ctx.beginPath();
    road.points.forEach((point, index) => {
      const px =
        ((point.x * map.width + point.y * map.height - sumCenter) * (tileWidth / 2)) + originX;
      const py =
        (point.y * map.height - point.x * map.width) * (tileHeight / 2) + originY;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });

  const iconPromises: Promise<void>[] = [];
  const vegetationStep = Math.max(3, Math.floor(Math.min(map.width, map.height) / 9));
  for (let y = vegetationStep / 2; y < map.height; y += vegetationStep) {
    for (let x = vegetationStep / 2; x < map.width; x += vegetationStep) {
      const idx = Math.min(map.height - 1, Math.floor(y)) * map.width + Math.min(map.width - 1, Math.floor(x));
      const biome = computeBiome(map, idx);
      const vegLevel = map.vegetation[idx];
      const vegUrl = vegetationIcons[biome];
      const terrainUrl = terrainIconForBiome(biome);
      const densityFactor = lerp(0.5, 1.6, 1 - vegLevel);
      const jitterX = (pseudoRandom(x, y, map.seed + 404) - 0.5) * tileWidth * 0.5;
      const jitterY = (pseudoRandom(x, y, map.seed + 505) - 0.5) * tileHeight * 0.8;
      const gx = x + jitterX / tileWidth;
      const gy = y + jitterY / tileHeight;
      const isoX = (gx + gy - sumCenter) * (tileWidth / 2) + originX;
      const isoY = (gy - gx) * (tileHeight / 2) + originY;
      const vegSize = Math.max(12, tileWidth * 0.9);
      if (vegUrl && pseudoRandom(x, y, map.seed + 1516) < vegLevel + 0.2) {
        iconPromises.push(
          loadIcon(vegUrl).then((img) => {
            ctx.drawImage(img, isoX - vegSize / 2, isoY - vegSize / 2, vegSize, vegSize);
          })
        );
      }
      if (terrainUrl && pseudoRandom(x, y, map.seed + 909) > 0.72) {
        const size = Math.max(16, tileWidth * 1.1);
        iconPromises.push(
          loadIcon(terrainUrl).then((img) => {
            ctx.drawImage(img, isoX - size / 2, isoY - size / 2, size, size);
          })
        );
      }
      x += Math.max(2, Math.round(vegetationStep * densityFactor)) - vegetationStep;
    }
  }

  map.cities.forEach((city) => {
    const tier = cityTier(city.population);
    const iconUrl = settlementIcons[tier];
    const px =
      ((city.x * map.width + city.y * map.height - sumCenter) * (tileWidth / 2)) + originX;
    const py =
      (city.y * map.height - city.x * map.width) * (tileHeight / 2) + originY;
    const size = Math.max(22, tileWidth * 1.35);
    iconPromises.push(
      loadIcon(iconUrl).then((img) => {
        ctx.drawImage(img, px - size / 2, py - size / 2, size, size);
      })
    );
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = `${Math.max(12, tileWidth * 0.45)}px 'Space Grotesk', sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(city.name, px, py - size * 0.85);
    ctx.restore();
  });

  await Promise.all(iconPromises);
  applyFantasyOverlay(ctx, width, height);
  applyNoiseOverlay(ctx, width, height, 0.08);
  return canvas.toDataURL("image/png");
}

// Kept temporarily as a reusable editor renderer; baked previews use the shared top-down source.
void drawCompiledIso;

async function generateCompiledRenders(map: MapStateExtended): Promise<CompiledRenders> {
  const extended = ensureExtendedMap(map);
  const grid = await drawCompiledGrid(extended);
  // The alternate asset is intentionally a rotated version of the same
  // cartographic render, keeping every feature and label in sync with top-down.
  const image = await loadIcon(grid);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalHeight || 1;
  canvas.height = image.naturalWidth || 1;
  const ctx = canvas.getContext("2d");
  if (ctx && image.naturalWidth) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  }
  const iso = ctx && image.naturalWidth ? canvas.toDataURL("image/png") : grid;
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
  }
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pixelRatio = window.devicePixelRatio ?? 1;
  canvas.width = viewport.width * pixelRatio;
  canvas.height = viewport.height * pixelRatio;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  const tileWidth = TILE_BASE * zoom;
  const tileHeight = tileWidth / 2;
  const originX = viewport.width / 2 + pan.x;
  const originY = tileHeight + pan.y;
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

  const drawRoad = (points: PixelPoint[], stroke: string) => {
    if (points.length === 0) return;
    ctx.beginPath();
    const first = points[0];
    const startX =
      ((first.x * map.width + first.y * map.height - sumCenter) *
        (tileWidth / 2)) +
      originX;
    const startY =
      (first.y * map.height - first.x * map.width) * (tileHeight / 2) + originY;
    ctx.moveTo(startX, startY);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      const px =
        ((point.x * map.width + point.y * map.height - sumCenter) *
          (tileWidth / 2)) +
        originX;
      const py =
        (point.y * map.height - point.x * map.width) * (tileHeight / 2) +
        originY;
      ctx.lineTo(px, py);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  };

  map.roads.forEach((road) => drawRoad(road.points, "rgba(224,196,128,0.85)"));
  if (roadDraftStart) {
    drawRoad([roadDraftStart], "rgba(255,198,109,0.8)");
  }

  map.cities.forEach((city) => {
    const isoX =
      ((city.x * map.width + city.y * map.height - sumCenter) *
        (tileWidth / 2)) +
      originX;
    const isoY =
      (city.y * map.height - city.x * map.width) * (tileHeight / 2) + originY;
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
  }
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pixelRatio = window.devicePixelRatio ?? 1;
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
  const cx = clamp(point.x, 0, 0.9999) * (width - 1);
  const cy = clamp(point.y, 0, 0.9999) * (height - 1);
  const radius = Math.max(1, Math.round(brushSize * Math.min(width, height)));
  const copy: MapStateExtended = {
    ...map,
    relief: [...map.relief],
    moisture: [...map.moisture],
    temperature: [...map.temperature],
    vegetation: [...map.vegetation],
  };
  const target = BIOME_TARGETS[selectedBiome];

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

function buildRoadBetweenAnchors(
  map: MapStateExtended,
  from: PixelPoint,
  to: PixelPoint
) {
  const width = map.width;
  const height = map.height;
  const startX = clamp(from.x, 0, 0.9999) * width - 0.5;
  const startY = clamp(from.y, 0, 0.9999) * height - 0.5;
  const endX = clamp(to.x, 0, 0.9999) * width - 0.5;
  const endY = clamp(to.y, 0, 0.9999) * height - 0.5;

  const start = { x: Math.round(startX), y: Math.round(startY) };
  const goal = { x: Math.round(endX), y: Math.round(endY) };

  const maxBridgeCells = 2;

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, { x: number; y: number }>();
  const waterRun = new Map<string, number>();

  const key = (x: number, y: number) => `${x},${y}`;
  const heuristic = (x: number, y: number) => Math.hypot(goal.x - x, goal.y - y);
  const reliefAt = (x: number, y: number) => map.relief[y * width + x];
  const vegetationAt = (x: number, y: number) => map.vegetation[y * width + x] ?? 0;

  const open: Array<{ x: number; y: number }> = [start];
  gScore.set(key(start.x, start.y), 0);
  waterRun.set(key(start.x, start.y), isWaterCell(map, start.x, start.y) ? 1 : 0);

  while (open.length > 0) {
    // Keep roads broadly direct; terrain bends them only where the grade demands it.
    let currentIndex = 0;
    let currentBest = open[0];
    let currentBestF = (gScore.get(key(currentBest.x, currentBest.y)) ?? Infinity) + heuristic(currentBest.x, currentBest.y) * 1.35;
    for (let i = 1; i < open.length; i += 1) {
      const node = open[i];
      const score = (gScore.get(key(node.x, node.y)) ?? Infinity) + heuristic(node.x, node.y) * 1.35;
      if (score < currentBestF) {
        currentBest = node;
        currentBestF = score;
        currentIndex = i;
      }
    }

    const currentKey = key(currentBest.x, currentBest.y);
    open.splice(currentIndex, 1);

    if (currentBest.x === goal.x && currentBest.y === goal.y) {
      // Reconstruct path.
      const path: PixelPoint[] = [];
      let iterKey: string | undefined = currentKey;
      while (iterKey) {
        const [ix, iy] = iterKey.split(",").map(Number);
        path.push({
          x: (ix + 0.5) / width,
          y: (iy + 0.5) / height,
        });
        const prev = cameFrom.get(iterKey);
        iterKey = prev ? key(prev.x, prev.y) : undefined;
      }
      return path.reverse();
    }

    const currentRelief = reliefAt(currentBest.x, currentBest.y);
    const currentWaterRun = waterRun.get(currentKey) ?? 0;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = currentBest.x + dx;
        const ny = currentBest.y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

        const diagonal = dx !== 0 && dy !== 0;
        const stepBase = diagonal ? Math.SQRT2 : 1;
        const nextRelief = reliefAt(nx, ny);
        const slopeDiff = Math.abs(nextRelief - currentRelief);
        const vegetation = vegetationAt(nx, ny);

        const nextIsWater = isWaterCell(map, nx, ny);
        const nextWaterRun = nextIsWater ? currentWaterRun + 1 : 0;
        if (nextIsWater && nextWaterRun > maxBridgeCells) continue;

        // Grade is direction-neutral: ascents and descents both avoid steep cells.
        const altitudePenalty = Math.max(0, nextRelief - 0.64) ** 2 * 95;
        const slopePenalty = slopeDiff * slopeDiff * 165 + Math.max(0, slopeDiff - 0.035) * 24;
        const vegetationPenalty = vegetation * 1.25;
        // Water is treated as an exceptional bridge choice: only a dramatically
        // shorter route can outweigh it, and continuous crossings remain capped.
        const waterPenalty = nextIsWater ? 900 * nextWaterRun : 0;

        const tentativeG =
          (gScore.get(currentKey) ?? Infinity) +
          stepBase +
          slopePenalty +
          altitudePenalty +
          vegetationPenalty +
          waterPenalty;

        const neighborKey = key(nx, ny);
        if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
          cameFrom.set(neighborKey, { x: currentBest.x, y: currentBest.y });
          gScore.set(neighborKey, tentativeG);
          waterRun.set(neighborKey, nextWaterRun);
          if (!open.find((node) => node.x === nx && node.y === ny)) {
            open.push({ x: nx, y: ny });
          }
        }
      }
    }
  }

  // Fallback: straight line if no path found.
  return [
    { x: clamp(from.x, 0, 0.9999), y: clamp(from.y, 0, 0.9999) },
    { x: clamp(to.x, 0, 0.9999), y: clamp(to.y, 0, 0.9999) },
  ];
}

function findAttachmentTarget(map: MapStateExtended, city: MapCity): NetworkAnchor | null {
  let best: NetworkAnchor | null = null;
  let bestDist = Infinity;
  map.cities.forEach((existing) => {
    const d = distance(
      { x: existing.x, y: existing.y },
      { x: city.x, y: city.y }
    );
    if (d < bestDist) {
      bestDist = d;
      best = {
        x: existing.x,
        y: existing.y,
        label: existing.name,
        targetType: "city",
        targetId: existing.id,
      };
    }
  });
  map.roads.forEach((road) => {
    road.points.forEach((point) => {
      const d = distance(point, { x: city.x, y: city.y });
      if (d < bestDist) {
        bestDist = d;
        best = {
          ...point,
          label: "Road node",
          targetType: "road",
          targetId: road.id,
        };
      }
    });
  });
  return best;
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
  xRatio: number,
  yRatio: number
): { map: MapStateExtended; city: MapCity } {
  const width = map.width;
  const height = map.height;
  const clickedX = Math.round(clamp(xRatio, 0, 0.9999) * width - 0.5);
  const clickedY = Math.round(clamp(yRatio, 0, 0.9999) * height - 0.5);
  let gridX = clickedX;
  let gridY = clickedY;
  // Snap a water click to the nearest usable land tile instead of creating an
  // unreachable city marker offshore.
  for (let radius = 0; radius <= 8 && isWaterCell(map, gridX, gridY); radius += 1) {
    let candidate: { x: number; y: number } | null = null;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = clickedX + dx;
        const y = clickedY + dy;
        if (x < 0 || y < 0 || x >= width || y >= height || isWaterCell(map, x, y)) continue;
        if (!candidate || Math.abs(dx) + Math.abs(dy) < Math.abs(candidate.x - clickedX) + Math.abs(candidate.y - clickedY)) candidate = { x, y };
      }
    }
    if (candidate) { gridX = candidate.x; gridY = candidate.y; }
  }
  const idx = gridY * width + gridX;
  const elevation = map.relief[idx];
  const city: MapCity = {
    id: randomId(),
    name,
    x: (gridX + 0.5) / width,
    y: (gridY + 0.5) / height,
    elevation,
    population: Math.floor(500 + Math.random() * 4500),
  };
  let roads = map.roads.map((road) => ({
    ...road,
    points: road.points.map((point) => ({ ...point })),
  }));
  const target = findAttachmentTarget(map, city);
  if (target && distance(target, city) <= 0.28) {
    const path = buildRoadBetweenAnchors(map, target, { x: city.x, y: city.y });
    roads = [
      ...roads,
      {
        id: randomId(),
        from_city_id: target.targetType === "city" ? target.targetId ?? "" : "",
        to_city_id: city.id,
        points: path,
      },
    ];
  }
  return {
    map: {
      ...map,
      cities: [...map.cities, city],
      roads,
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
    road.points.forEach((segmentPoint, index) => {
      const d = distance(point, segmentPoint);
      if (d < bestDist) {
        bestDist = d;
        best = {
          x: segmentPoint.x,
          y: segmentPoint.y,
          label: `Road pt ${index + 1}`,
          targetType: "road",
          targetId: road.id,
        };
      }
    });
  });
  return best;
}

function addManualRoad(
  map: MapStateExtended,
  start: NetworkAnchor,
  end: NetworkAnchor
): MapStateExtended {
  if (start.x === end.x && start.y === end.y) return map;
  const path = buildRoadBetweenAnchors(map, start, end);
  const roadId = randomId();
  return {
    ...map,
    roads: [
      ...map.roads,
      {
        id: roadId,
        from_city_id: start.targetId ?? roadId,
        to_city_id: end.targetId ?? `${roadId}-end`,
        points: path,
      },
    ],
  };
}
export function WorldMapPage() {
  const { worldId } = useParams();
  const [mapState, setMapState] = useState<MapStateExtended | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedBiome, setSelectedBiome] = useState<Biome>("plains");
  const [biomeToolMode, setBiomeToolMode] = useState<BiomeToolMode>("palette");
  const [climateTarget, setClimateTarget] = useState<ClimateTarget>("moisture");
  const [climateDirection, setClimateDirection] = useState<"raise" | "lower">("raise");
  const [brushSize, setBrushSize] = useState(0.05);
  const [selectedCity, setSelectedCity] = useState<MapCity | null>(null);
  const [cityEditorCity, setCityEditorCity] = useState<MapCity | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<PanVector>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isBrushing, setIsBrushing] = useState(false);
  const [roadDraftStart, setRoadDraftStart] = useState<NetworkAnchor | null>(null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("biomes");
  const [desiredSize, setDesiredSize] = useState(MAP_DEFAULT_SIZE);
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolGroup, setToolGroup] = useState<ToolGroup>("general");
  const [reliefAction, setReliefAction] = useState<"raise" | "lower">("raise");
  const [locationAction, setLocationAction] = useState<PrimaryAction>("navigate");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [draftCityName, setDraftCityName] = useState("New City");
  const [compiledView, setCompiledView] = useState(true);
  const compiledPreferenceRef = useRef(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);

  const derivedPrimaryAction = useMemo<PrimaryAction>(() => {
    if (toolGroup === "biome") {
      if (biomeToolMode === "palette") return "paint-biome";
      const direction = climateDirection === "raise" ? "raise" : "lower";
      return `${direction}-${climateTarget}` as PrimaryAction;
    }
    if (toolGroup === "relief") {
      return reliefAction === "raise" ? "raise-relief" : "lower-relief";
    }
      if (toolGroup === "locations") {
        return locationAction;
      }
      return "navigate";
    }, [toolGroup, biomeToolMode, climateDirection, climateTarget, reliefAction, locationAction]);

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
      setRoadDraftStart(null);
    }
  }, [toolGroup]);

  useEffect(() => {
    if (viewMode !== "grid") setViewMode("grid");
  }, [viewMode]);

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
    if (locationAction !== "add-road") {
      setRoadDraftStart(null);
    }
  }, [locationAction]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setViewportSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!worldId) return;
    setLoading(true);
    getWorldMap(worldId)
      .then((map) => {
        if (map) {
          setMapState(ensureExtendedMap(map));
        } else {
          setMapState(generateProceduralMap(Date.now()));
        }
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [worldId]);

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
        overlayRanges
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
        overlayRanges
      );
    }
  }, [
    mapState,
    zoom,
    panOffset,
    viewportSize,
      selectedCity,
      roadDraftStart,
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
      highestPeak: Math.max(...mapState.relief),
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
    if (!mapState || !cityEditorCity) return [];
    return mapState.roads.flatMap((road) => {
      if (road.points.length < 2) return [];
      const first = road.points[0];
      const last = road.points[road.points.length - 1];
      const cityAtStart = road.from_city_id === cityEditorCity.id || distance(first, cityEditorCity) < 0.025;
      const cityAtEnd = road.to_city_id === cityEditorCity.id || distance(last, cityEditorCity) < 0.025;
      if (cityAtStart) {
        const next = road.points[1];
        return [Math.atan2(next.y - first.y, next.x - first.x)];
      }
      if (cityAtEnd) {
        const previous = road.points[road.points.length - 2];
        return [Math.atan2(previous.y - last.y, previous.x - last.x)];
      }
      return [];
    });
  }, [mapState, cityEditorCity]);

  const handleGenerateMap = () => {
    setMapState(
      generateProceduralMap(
        Date.now(),
        mapState?.water_level ?? DEFAULT_WATER_LEVEL,
        mapState?.width ?? MAP_DEFAULT_SIZE,
        mapState?.height ?? MAP_DEFAULT_SIZE
      )
    );
    setStatusMessage("Generated new terrain.");
  };

  const handleNaturalizeRelief = () => {
    setMapState((prev) =>
      prev
        ? {
            ...prev,
            relief: smoothLayer(prev.relief, prev.width, prev.height, 1),
          }
        : prev
    );
    setStatusMessage("Smoothed elevation.");
  };

  const handleNormalizeLayer = (layer: "moisture" | "temperature" | "vegetation") => {
    setMapState((prev) =>
      prev
        ? {
            ...prev,
            [layer]: normalizeLayer(prev[layer], prev.width, prev.height),
          }
        : prev
    );
    setStatusMessage(`Normalized ${layer}.`);
  };

  const handleWaterChange = (value: number) => {
    setMapState((prev) => (prev ? { ...prev, water_level: value } : prev));
  };

  const handleSaveMap = async () => {
    if (!worldId || !mapState) return;
    setSaving(true);
    try {
      setStatusMessage("Rendering compiled maps\u2026");
      const compiled = await generateCompiledRenders(mapState);
      const payload = {
        ...mapState,
        compiled_grid: compiled.grid,
        compiled_iso: compiled.iso,
        compiled_updated_at: Date.now(),
      };
      const saved = await saveWorldMap(worldId, payload);
      setMapState(ensureExtendedMap(saved));
      setStatusMessage("Saved map and compiled renders.");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleResizeMap = () => {
    const next = generateProceduralMap(
      Date.now(),
      mapState?.water_level ?? DEFAULT_WATER_LEVEL,
      desiredSize,
      desiredSize
    );
    setMapState(next);
    setStatusMessage(`Rebuilt map at ${desiredSize} x ${desiredSize}.`);
  };

  const screenToMapPoint = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!mapState || !canvasRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      if (viewMode === "grid") {
        const cellSize = TILE_BASE * zoom;
        const gridX = (localX - panOffset.x) / cellSize;
        const gridY = (localY - panOffset.y) / cellSize;
        return {
          x: clamp((gridX + 0.5) / mapState.width, 0.5 / mapState.width, 1 - 0.5 / mapState.width),
          y: clamp((gridY + 0.5) / mapState.height, 0.5 / mapState.height, 1 - 0.5 / mapState.height),
        };
      }
      const tileWidth = TILE_BASE * zoom;
      const tileHeight = tileWidth / 2;
      const originX = viewportSize.width / 2 + panOffset.x;
      const originY = tileHeight + panOffset.y;
      const dx = localX - originX;
      const dy = localY - originY;
      const sumCenter = (mapState.width - 1 + mapState.height - 1) / 2;
      const gridX = sumCenter / 2 + dx / tileWidth - dy / tileHeight;
      const gridY = sumCenter / 2 + dx / tileWidth + dy / tileHeight;
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
      setMapState((prev) =>
        prev
          ? applyBrushToMap(prev, point, primaryAction, selectedBiome, brushSize)
          : prev
      );
    },
    [mapState, primaryAction, selectedBiome, brushSize]
  );

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => clamp(prev + delta, MIN_ZOOM, MAX_ZOOM));
  };

  const handlePointerDown = (event: MouseEvent<HTMLCanvasElement>) => {
    if (cityEditorCity) return;
    if (event.button === 2) {
      setIsPanning(true);
      lastPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (primaryAction === "navigate") {
      const point = screenToMapPoint(event);
      if (point && mapState && event.button === 0) {
        const nearest = findNearestCity(mapState, point, 0.035);
        if (nearest) {
          setSelectedCity(nearest);
          setStatusMessage(`Selected ${nearest.name}`);
        }
      }
      setIsPanning(true);
      lastPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (isBrushAction) {
      const point = screenToMapPoint(event);
      handleBrush(point);
      setIsBrushing(true);
      return;
    }
    if (primaryAction === "place-city") {
      const point = screenToMapPoint(event);
      if (point && mapState) {
        const name = draftCityName.trim() || `City ${mapState.cities.length + 1}`;
        const next = addCityToMap(mapState, name, point.x, point.y);
        setMapState(next.map);
        setSelectedCity(next.city);
        setCityEditorCity(next.city);
        setDraftCityName(`City ${mapState.cities.length + 2}`);
        setStatusMessage(`Added ${name}`);
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
        setMapState(addManualRoad(mapState, roadDraftStart, snapped));
        setRoadDraftStart(null);
        setStatusMessage("Road segment added.");
      }
    }
  };

  const handlePointerMove = (event: MouseEvent<HTMLCanvasElement>) => {
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
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    setIsBrushing(false);
    lastPanRef.current = null;
  };

  const handleSelectCity = (city: MapCity) => {
    setSelectedCity(city);
    setStatusMessage(`Selected ${city.name}`);
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
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <button onClick={handleGenerateMap} className="primary-button" type="button">
          Generate terrain
        </button>
        <button
          onClick={handleSaveMap}
          className="secondary-button"
          type="button"
          disabled={saving}
        >
          {saving ? "Saving..." : "Save map"}
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
            {compiledAvailable ? "View compiled map" : "Save to compile"}
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
            : "Save to bake top-down and isometric renders."}
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
            onChange={(event) => handleWaterChange(Number(event.target.value))}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>View</span>
          <button
            type="button"
            onClick={handleViewToggle}
            className="px-3 py-1 rounded border border-brand/50 text-xs"
          >
            {viewMode === "iso" ? "Isometric" : "Top-down"}
          </button>
        </label>
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
        <button onClick={handleResizeMap} className="secondary-button">
          Rebuild at size
        </button>
        <button onClick={handleNaturalizeRelief} className="secondary-button">
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
          {["palette", "moisture", "temperature", "vegetation"].map((mode) => (
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
              {mode}
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
                    className={`rounded border px-2 py-1 text-xs ${
                      selectedBiome === biome
                        ? "border-brand bg-brand/15 text-brand-glow"
                        : "border-earth-clay/30"
                    }`}
                  >
                    {biome.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {CLIMATE_LAYERS.map((layer) => (
            <button
              key={layer.key}
              type="button"
              onClick={() => setClimateTarget(layer.key)}
              className={`w-full text-left px-3 py-2 rounded border ${
                climateTarget === layer.key
                  ? "border-brand bg-brand/15"
                  : "border-earth-clay/30"
              }`}
            >
              <p className="text-xs uppercase tracking-[0.2em] text-earth-sand/60">
                {layer.label}
              </p>
              <p>{`${layer.minLabel} -> ${layer.maxLabel}`}</p>
            </button>
          ))}
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
      <div className="flex gap-2">
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
        <button onClick={handleNaturalizeRelief} className="secondary-button">
          Smooth relief
        </button>
        <button
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
          Add city
        </button>
        <button
          type="button"
          onClick={() => setLocationAction("add-road")}
          className={`flex-1 rounded border px-3 py-2 ${
            locationAction === "add-road"
              ? "border-brand bg-brand/15"
              : "border-earth-clay/30"
          }`}
        >
          Add road
        </button>
      </div>
      <label className="flex flex-col gap-1">
        City label
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
            <p className="text-xs text-earth-sand/70">
              {(city.x * mapState.width).toFixed(1)}  |  {(city.y * mapState.height).toFixed(1)}
            </p>
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!selectedCity}
        onClick={() => selectedCity && setCityEditorCity(selectedCity)}
        className="secondary-button disabled:opacity-40"
      >
        Open city mapper
      </button>
      <p className="text-xs text-earth-sand/70">
        Road tool snaps to cities or road nodes. Right click always pans.
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
            : "Save the map to bake fresh renders."}
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
      case "locations":
        return renderLocationsPanel();
      default:
        return null;
    }
  };
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-earth-sand/70">
        Loading map...
      </div>
    );
  }

  if (!mapState) {
    return (
      <div className="h-full w-full flex items-center justify-center text-red-200">
        Failed to load map data.
      </div>
    );
  }

  return (
    <div className="h-full w-full relative text-earth-sand bg-black">
      <div className="absolute inset-0 flex">
        <div
          className={`h-full bg-grove-950/95 text-sm transition-all duration-200 border-r border-earth-clay/20 ${
            sidebarOpen ? "w-80" : "w-10"
          }`}
        >
          <div className="flex items-center justify-between px-2 py-2 border-b border-earth-clay/20">
            {sidebarOpen && (
              <p className="text-xs uppercase tracking-[0.3em] text-earth-sand/60">
                Tools
              </p>
            )}
            <button
              type="button"
              className="text-lg text-earth-sand/80"
              onClick={handleSidebarToggle}
            >
              {sidebarOpen ? "<" : ">"}
            </button>
          </div>
          {sidebarOpen ? (
            <div className="flex flex-col h-full">
              <div className="flex gap-1 p-2">
                {(Object.entries(TOOL_GROUP_LABELS) as [ToolGroup, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setToolGroup(key)}
                    className={`flex-1 rounded-full px-3 py-2 text-xs ${
                      toolGroup === key
                        ? "bg-brand text-black font-semibold"
                        : "bg-transparent border border-earth-clay/30 text-earth-sand/70"
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
                Save the map to bake the compiled render.
              </div>
            ) : null}
            <canvas
              ref={canvasRef}
              className="absolute inset-0"
              style={{
                cursor: cursorStyle,
                opacity: compiledView ? 0.01 : 1,
                pointerEvents: "auto",
              }}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
              onWheel={handleWheel}
              onContextMenu={(event) => event.preventDefault()}
            />
            <div className="absolute top-4 right-4 bg-black/70 backdrop-blur rounded-xl border border-earth-clay/30 px-4 py-3 text-xs space-y-1">
              <p>
                {compiledView
                  ? "Compiled preview \u2014 navigation only"
                  : `Primary: ${PRIMARY_ACTION_LABEL[primaryAction]}  |  Secondary: Pan`}
              </p>
              <p>View: {viewMode === "iso" ? "Isometric" : "Grid"}</p>
              {compiledView && compiledTimestamp && (
                <p>Last baked: {compiledTimestamp}</p>
              )}
              {roadDraftStart && <p>Road anchor: {roadDraftStart.label}</p>}
            </div>
            {statusMessage && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 text-earth-sand px-4 py-2 rounded-full text-xs border border-brand/40">
                {statusMessage}
              </div>
            )}
            {error && (
              <div className="absolute bottom-6 right-6 bg-red-500/80 text-sm px-3 py-2 rounded">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
      {cityEditorCity ? (
        <CityMapEditor city={cityEditorCity} externalConnections={cityExternalConnections} onClose={() => setCityEditorCity(null)} />
      ) : null}
    </div>
  );
}
