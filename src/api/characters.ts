import { invoke } from "@tauri-apps/api/core";

export type Character = {
  id: string;
  world_id: string;
  name: string;
  notes: string;
  attributes_json: string;
  created_at: number;
};

export async function listCharacters(worldId: string): Promise<Character[]> {
  return await invoke<Character[]>("list_characters", { worldId });
}

export async function createCharacter(
  worldId: string,
  name: string
): Promise<Character> {
  return await invoke<Character>("create_character", { worldId, name });
}
