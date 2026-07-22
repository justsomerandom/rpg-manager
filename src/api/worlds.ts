import { invokeOrThrow } from "./client";
import type { TemplateDefinitionPayload } from "./templates";

export type World = {
  id: string;
  name: string;
  game_system: string;
  description: string;
  created_at: number;
};

export async function listWorlds(): Promise<World[]> {
  return await invokeOrThrow<World[]>("list_worlds");
}

export async function createWorld(name: string, gameSystem: string): Promise<World> {
  return await invokeOrThrow<World>("create_world", {
    name,
    gameSystem,
  });
}

export async function createWorldWithTemplates(
  name: string,
  gameSystem: string,
  templates: TemplateDefinitionPayload[]
): Promise<World> {
  return await invokeOrThrow<World>("create_world_with_templates", {
    name,
    gameSystem,
    templates,
  });
}

export async function getWorld(id: string): Promise<World> {
  return await invokeOrThrow<World>("get_world", { id });
}

export async function deleteWorld(id: string): Promise<void> {
  await invokeOrThrow<void>("delete_world", { id });
}

export async function updateWorld(
  id: string,
  world: Pick<World, "name" | "game_system" | "description">
): Promise<World> {
  return await invokeOrThrow<World>("update_world", {
    id,
    name: world.name,
    gameSystem: world.game_system,
    description: world.description,
  });
}
