import { invokeOrThrow } from "./client";

export const WORLD_ENTRY_CATEGORIES = [
  "magic_system",
  "item_type",
  "character_template",
  "faction",
  "region",
  "note",
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
  return await invokeOrThrow<WorldEntry[]>("list_world_entries", {
    worldId,
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
  return await invokeOrThrow<WorldEntry>("create_world_entry", {
    worldId,
    category,
    title,
    summary,
    body,
    metadataJson,
  });
}

export async function updateWorldEntry(
  id: string,
  category: WorldEntryCategory,
  title: string,
  summary: string,
  body: string,
  metadataJson?: string
): Promise<WorldEntry> {
  return await invokeOrThrow<WorldEntry>("update_world_entry", {
    id,
    category,
    title,
    summary,
    body,
    metadataJson,
  });
}

export async function deleteWorldEntry(id: string): Promise<void> {
  await invokeOrThrow("delete_world_entry", { id });
}
