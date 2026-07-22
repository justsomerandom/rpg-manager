import { invokeOrThrow } from "./client";

export type TemplateType =
  | "character"
  | "npc"
  | "item"
  | "ability"
  | "custom_entity";

export type WorldTemplate = {
  id: string;
  world_id: string;
  template_type: TemplateType;
  name: string;
  definition_json: string;
  created_at: number;
};

export type TemplateDefinitionPayload = {
  template_type: TemplateType;
  name: string;
  definition: unknown;
};

export async function listWorldTemplates(
  worldId: string,
  templateType?: TemplateType
): Promise<WorldTemplate[]> {
  return await invokeOrThrow<WorldTemplate[]>("list_world_templates", {
    worldId,
    templateType,
  });
}

export async function saveWorldTemplates(
  worldId: string,
  templates: TemplateDefinitionPayload[]
): Promise<WorldTemplate[]> {
  return await invokeOrThrow<WorldTemplate[]>("save_world_templates", {
    worldId,
    templates,
  });
}
