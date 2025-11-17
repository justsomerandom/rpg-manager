import { invoke } from "@tauri-apps/api/core";

export const WORLD_ENTRY_CATEGORIES = [
  "magic_system",
  "item_type",
  "character_template",
  "faction",
  "region",
] as const;

export type WorldEntryCategory = (typeof WORLD_ENTRY_CATEGORIES)[number];

export type WorldEntry = {
  id: string;
  world_id: string;
  category: WorldEntryCategory;
  title: string;
  summary: string;
  body: string;
  metadata_json: string;
  created_at: number;
};

export async function listWorldEntries(
  worldId: string,
  category?: WorldEntryCategory
): Promise<WorldEntry[]> {
  return await invoke<WorldEntry[]>("list_world_entries", {
    worldId,
    world_id: worldId,
    category,
  });
}

export async function createWorldEntry(
  worldId: string,
  category: WorldEntryCategory,
  title: string,
  summary: string,
  body: string,
  metadataJson?: string
): Promise<WorldEntry> {
  return await invoke<WorldEntry>("create_world_entry", {
    worldId,
    world_id: worldId,
    category,
    title,
    summary,
    body,
    metadataJson,
    metadata_json: metadataJson,
  } as any);
}

export async function updateWorldEntry(
  id: string,
  title: string,
  summary: string,
  body: string,
  metadataJson?: string
): Promise<WorldEntry> {
  return await invoke<WorldEntry>("update_world_entry", {
    id,
    title,
    summary,
    body,
    metadataJson,
    metadata_json: metadataJson,
  } as any);
}

export async function deleteWorldEntry(id: string): Promise<void> {
  await invoke("delete_world_entry", { id });
}
