import { invokeOrThrow } from "./client";

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
  } as any);
}

export async function getWorld(id: string): Promise<World> {
  return await invokeOrThrow<World>("get_world", { id });
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
  } as any);
}
