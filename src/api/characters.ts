import { invokeOrThrow } from "./client";

export type Character = {
  id: string;
  world_id: string;
  name: string;
  notes: string;
  attributes_json: string;
  created_at: number;
};

export async function listCharacters(worldId: string): Promise<Character[]> {
  return await invokeOrThrow<Character[]>("list_characters", { worldId });
}

export async function createCharacter(
  worldId: string,
  name: string
): Promise<Character> {
  return await invokeOrThrow<Character>("create_character", { worldId, name });
}

export async function updateCharacter(
  id: string,
  name: string,
  notes: string,
  attributesJson?: string
): Promise<Character> {
  return await invokeOrThrow<Character>("update_character", {
    id,
    name,
    notes,
    attributesJson,
  });
}

export async function deleteCharacter(id: string): Promise<void> {
  await invokeOrThrow<void>("delete_character", { id });
}
