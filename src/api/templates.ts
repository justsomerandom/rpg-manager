import { invoke } from "@tauri-apps/api/core";

export type TemplateType = "character" | "item" | "ability" | "custom_entity";

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
  return await invoke<WorldTemplate[]>("list_world_templates", {
    worldId,
    world_id: worldId,
    templateType,
    template_type: templateType,
  });
}

export async function saveWorldTemplates(
  worldId: string,
  templates: TemplateDefinitionPayload[]
): Promise<WorldTemplate[]> {
  return await invoke<WorldTemplate[]>("save_world_templates", {
    worldId,
    world_id: worldId,
    templates,
  });
}
