/// <reference lib="webworker" />

import type { MapState } from "../../../api/worldMap";
import { ensureExtendedMap, generateProceduralMap } from "./generation";
import type { MapStateExtended } from "./types";

export type WorldMapWorkerRequest =
  | { kind: "prepare"; map: MapState }
  | { kind: "generate"; seed: number; waterLevel: number; width: number; height: number };

export type WorldMapWorkerResponse =
  { ok: true; map: MapStateExtended } | { ok: false; error: string };

self.onmessage = (event: MessageEvent<WorldMapWorkerRequest>) => {
  try {
    const request = event.data;
    const map =
      request.kind === "prepare"
        ? ensureExtendedMap(request.map)
        : generateProceduralMap(request.seed, request.waterLevel, request.width, request.height);
    self.postMessage({ ok: true, map } satisfies WorldMapWorkerResponse);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "World-map processing failed.",
    } satisfies WorldMapWorkerResponse);
  }
};
