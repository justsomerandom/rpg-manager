import type { TemplateDefinitionPayload } from "../api/templates";

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

export type CharacterFeatureType =
  | "number_stat"
  | "number_resource"
  | "text"
  | "action"
  | "item_slot"
  | "ability_slot"
  | "custom_entity";

export type CharacterFeature = {
  id: string;
  label: string;
  type: CharacterFeatureType;
  min?: number;
  max?: number;
  entityId?: string;
};

export type TemplateFieldInput = "text" | "number" | "action";

export type TemplateField = {
  id: string;
  label: string;
  inputType: TemplateFieldInput;
};

export type FieldCollectionTemplate = {
  id: string;
  name: string;
  fields: TemplateField[];
};

export type NpcTemplate = {
  id: string;
  name: string;
  role: string;
  notes: string;
};

export type WorldSetupTemplates = {
  character: CharacterFeature[];
  npc: NpcTemplate[];
  item: FieldCollectionTemplate[];
  ability: FieldCollectionTemplate[];
  customEntities: FieldCollectionTemplate[];
};

export type FieldTemplateGroup = "item" | "ability" | "customEntities";
export type WorldSetupSection = "character" | "npc" | FieldTemplateGroup;

export type SetupValidationIssue = {
  message: string;
  step: "details" | "setup";
  section?: WorldSetupSection;
  fieldId?: string;
};

export const MAX_TEMPLATES_PER_SECTION = 100;
export const MAX_FIELDS_PER_TEMPLATE = 100;
export const MAX_CHARACTER_FEATURES = 100;
const MAX_TEMPLATES_PER_WORLD = 500;
const MAX_TEMPLATE_DEFINITION_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_TEMPLATE_BYTES = 8 * 1024 * 1024;

export const FEATURE_OPTIONS: { value: CharacterFeatureType; label: string }[] = [
  { value: "number_stat", label: "Number stat" },
  { value: "number_resource", label: "Number resource" },
  { value: "text", label: "Text" },
  { value: "action", label: "Action" },
  { value: "item_slot", label: "Item slot" },
  { value: "ability_slot", label: "Ability slot" },
  { value: "custom_entity", label: "Custom entity reference" },
];

export const FIELD_TYPE_OPTIONS: { value: TemplateFieldInput; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "action", label: "Action toggle" },
];

export const SETUP_SECTIONS: {
  id: WorldSetupSection;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    id: "character",
    label: "Character sheet",
    shortLabel: "Character fields",
    description: "Shared fields that appear on every player-character sheet.",
  },
  {
    id: "npc",
    label: "NPC starters",
    shortLabel: "NPC templates",
    description: "Reusable non-player character starting points.",
  },
  {
    id: "item",
    label: "Item templates",
    shortLabel: "Item templates",
    description: "Blueprints for equipment, artifacts, and everyday objects.",
  },
  {
    id: "ability",
    label: "Ability templates",
    shortLabel: "Ability templates",
    description: "Structures for spells, talents, and combat moves.",
  },
  {
    id: "customEntities",
    label: "Custom entities",
    shortLabel: "Custom types",
    description: "Setting-specific records such as factions, elements, or schools.",
  },
];

export const buildDefaultFields = (group: FieldTemplateGroup): TemplateField[] => {
  if (group === "item") {
    return [
      { id: makeId(), label: "Name", inputType: "text" },
      { id: makeId(), label: "Description", inputType: "text" },
    ];
  }
  if (group === "ability") {
    return [
      { id: makeId(), label: "Name", inputType: "text" },
      { id: makeId(), label: "Effect", inputType: "text" },
      { id: makeId(), label: "Cost", inputType: "number" },
    ];
  }
  return [
    { id: makeId(), label: "Description", inputType: "text" },
    { id: makeId(), label: "Flavor hook", inputType: "text" },
  ];
};

export const createDefaultWorldSetup = (): WorldSetupTemplates => ({
  character: [
    { id: makeId(), label: "Strength", type: "number_stat", min: 0, max: 10 },
    { id: makeId(), label: "Agility", type: "number_stat", min: 0, max: 10 },
    { id: makeId(), label: "Health", type: "number_resource", min: 0, max: 12 },
  ],
  npc: [
    {
      id: makeId(),
      name: "Town Guard",
      role: "Security detail",
      notes: "Militia posted at the city gate.",
    },
  ],
  item: [{ id: makeId(), name: "Common Item", fields: buildDefaultFields("item") }],
  ability: [
    { id: makeId(), name: "Signature Ability", fields: buildDefaultFields("ability") },
  ],
  customEntities: [
    { id: makeId(), name: "Faction", fields: buildDefaultFields("customEntities") },
  ],
});

export const getSectionCount = (
  templates: WorldSetupTemplates,
  section: WorldSetupSection
) => templates[section].length;

const utf8Length = (value: string) => new TextEncoder().encode(value).length;
const containsControlCharacter = (value: string) => /\p{Cc}/u.test(value);

export function validateWorldDetails(name: string, gameSystem: string): SetupValidationIssue | null {
  const trimmedName = name.trim();
  const trimmedSystem = gameSystem.trim();
  if (!trimmedName) {
    return {
      message: "Enter a name for your world.",
      step: "details",
      fieldId: "world-name",
    };
  }
  if (utf8Length(trimmedName) > 200) {
    return {
      message: "World name must be 200 bytes or fewer.",
      step: "details",
      fieldId: "world-name",
    };
  }
  if (containsControlCharacter(trimmedName)) {
    return {
      message: "World name contains an unsupported control character.",
      step: "details",
      fieldId: "world-name",
    };
  }
  if (utf8Length(trimmedSystem) > 200) {
    return {
      message: "Game system must be 200 bytes or fewer.",
      step: "details",
      fieldId: "world-system",
    };
  }
  if (containsControlCharacter(trimmedSystem)) {
    return {
      message: "Game system contains an unsupported control character.",
      step: "details",
      fieldId: "world-system",
    };
  }
  return null;
}

const duplicateValues = (values: string[]) => {
  const normalized = values.map((value) => value.trim().toLowerCase()).filter(Boolean);
  return new Set(normalized).size !== normalized.length;
};

const setupIssue = (
  message: string,
  section: WorldSetupSection,
  fieldId?: string
): SetupValidationIssue => ({ message, step: "setup", section, fieldId });

export function validateWorldSetup(
  name: string,
  gameSystem: string,
  templates: WorldSetupTemplates
): SetupValidationIssue | null {
  const detailsIssue = validateWorldDetails(name, gameSystem);
  if (detailsIssue) return detailsIssue;

  const allIds = [
    ...templates.character.map((feature) => feature.id),
    ...templates.npc.map((npc) => npc.id),
    ...templates.item.flatMap((template) => [template.id, ...template.fields.map((field) => field.id)]),
    ...templates.ability.flatMap((template) => [template.id, ...template.fields.map((field) => field.id)]),
    ...templates.customEntities.flatMap((template) => [
      template.id,
      ...template.fields.map((field) => field.id),
    ]),
  ];
  if (new Set(allIds).size !== allIds.length) {
    return setupIssue(
      "Two setup fields share an identifier. Remove and recreate the duplicated field.",
      "character"
    );
  }

  if (templates.character.length > MAX_CHARACTER_FEATURES) {
    return setupIssue(
      `A character sheet can contain at most ${MAX_CHARACTER_FEATURES} starting fields.`,
      "character"
    );
  }

  if (duplicateValues(templates.character.map((feature) => feature.label))) {
    return setupIssue("Character field labels must be unique.", "character");
  }
  for (const feature of templates.character) {
    const label = feature.label.trim();
    if (!label) return setupIssue("Every character field needs a label.", "character", feature.id);
    if (label.length > 80) {
      return setupIssue("Character field labels must be 80 characters or fewer.", "character", feature.id);
    }
    if (
      (feature.type === "number_stat" || feature.type === "number_resource") &&
      (typeof feature.min !== "number" ||
        !Number.isFinite(feature.min) ||
        typeof feature.max !== "number" ||
        !Number.isFinite(feature.max))
    ) {
      return setupIssue(`“${label}” needs a valid minimum and maximum.`, "character", feature.id);
    }
    if (
      (feature.type === "number_stat" || feature.type === "number_resource") &&
      feature.min! > feature.max!
    ) {
      return setupIssue(`“${label}” cannot have a minimum above its maximum.`, "character", feature.id);
    }
    if (
      feature.type === "custom_entity" &&
      (!feature.entityId ||
        !templates.customEntities.some((entity) => entity.id === feature.entityId))
    ) {
      return setupIssue(
        `“${label}” must reference an existing custom entity template.`,
        "character",
        feature.id
      );
    }
  }

  if (duplicateValues(templates.npc.map((npc) => npc.name))) {
    return setupIssue("NPC template names must be unique.", "npc");
  }
  if (templates.npc.length > MAX_TEMPLATES_PER_SECTION) {
    return setupIssue(
      `A world can contain at most ${MAX_TEMPLATES_PER_SECTION} starter NPC templates.`,
      "npc"
    );
  }
  for (const npc of templates.npc) {
    const nameValue = npc.name.trim();
    if (!nameValue) return setupIssue("Every NPC template needs a name.", "npc", npc.id);
    if (utf8Length(nameValue) > 200) {
      return setupIssue("NPC template names must be 200 bytes or fewer.", "npc", npc.id);
    }
    if (containsControlCharacter(nameValue)) {
      return setupIssue("NPC template names contain an unsupported control character.", "npc", npc.id);
    }
    if (npc.role.trim().length > 300) {
      return setupIssue("NPC roles must be 300 characters or fewer.", "npc", npc.id);
    }
    if (npc.notes.trim().length > 5_000) {
      return setupIssue("NPC notes must be 5,000 characters or fewer.", "npc", npc.id);
    }
  }

  const collectionLabels: Record<FieldTemplateGroup, string> = {
    item: "Item template",
    ability: "Ability template",
    customEntities: "Custom entity template",
  };

  for (const section of ["item", "ability", "customEntities"] as const) {
    const collection = templates[section];
    const collectionLabel = collectionLabels[section];
    if (collection.length > MAX_TEMPLATES_PER_SECTION) {
      return setupIssue(
        `${collectionLabel} is limited to ${MAX_TEMPLATES_PER_SECTION} entries.`,
        section
      );
    }
    if (duplicateValues(collection.map((template) => template.name))) {
      return setupIssue(`${collectionLabel} names must be unique.`, section);
    }
    for (const template of collection) {
      const nameValue = template.name.trim();
      if (!nameValue) {
        return setupIssue(`${collectionLabel} requires a name.`, section, template.id);
      }
      if (utf8Length(nameValue) > 200) {
        return setupIssue(`${collectionLabel} names must be 200 bytes or fewer.`, section, template.id);
      }
      if (containsControlCharacter(nameValue)) {
        return setupIssue(
          `${collectionLabel} names contain an unsupported control character.`,
          section,
          template.id
        );
      }
      if (template.fields.length === 0) {
        return setupIssue(`${collectionLabel} must contain at least one field.`, section, template.id);
      }
      if (template.fields.length > MAX_FIELDS_PER_TEMPLATE) {
        return setupIssue(
          `“${nameValue}” can contain at most ${MAX_FIELDS_PER_TEMPLATE} fields.`,
          section,
          template.id
        );
      }
      if (duplicateValues(template.fields.map((field) => field.label))) {
        return setupIssue(`Field labels inside “${nameValue}” must be unique.`, section, template.id);
      }
      for (const field of template.fields) {
        if (!field.label.trim()) {
          return setupIssue(`Every field inside “${nameValue}” needs a label.`, section, field.id);
        }
        if (field.label.trim().length > 80) {
          return setupIssue(
            `Field labels inside “${nameValue}” must be 80 characters or fewer.`,
            section,
            field.id
          );
        }
      }
    }
  }


  const payload = buildTemplatePayload(templates);
  if (payload.length > MAX_TEMPLATES_PER_WORLD) {
    return setupIssue(
      `A world can contain at most ${MAX_TEMPLATES_PER_WORLD} templates.`,
      "character"
    );
  }
  let totalDefinitionBytes = 0;
  for (const template of payload) {
    const definition = {
      ...(template.definition as Record<string, unknown>),
      template_key: template.client_key,
    };
    const definitionBytes = utf8Length(JSON.stringify(definition));
    const section: WorldSetupSection =
      template.template_type === "custom_entity"
        ? "customEntities"
        : template.template_type === "character"
          ? "character"
          : template.template_type;
    if (definitionBytes > MAX_TEMPLATE_DEFINITION_BYTES) {
      return setupIssue(
        `“${template.name}” is too large. Reduce its fields or notes before creating the world.`,
        section
      );
    }
    totalDefinitionBytes += definitionBytes;
  }
  if (totalDefinitionBytes > MAX_TOTAL_TEMPLATE_BYTES) {
    return setupIssue(
      "This starter setup is too large. Remove some templates, fields, or notes before creating the world.",
      "character"
    );
  }
  return null;
}

type KeyedTemplateDefinitionPayload = TemplateDefinitionPayload & { client_key: string };

export function buildTemplatePayload(
  templates: WorldSetupTemplates
): KeyedTemplateDefinitionPayload[] {
  const payload: KeyedTemplateDefinitionPayload[] = [
    {
      client_key: "character-sheet",
      template_type: "character",
      name: "Character Sheet",
      definition: {
        features: templates.character.map((feature) => ({
          ...feature,
          label: feature.label.trim(),
        })),
      },
    },
  ];

  templates.npc.forEach((npc) => {
    payload.push({
      client_key: npc.id,
      template_type: "npc",
      name: npc.name.trim(),
      definition: { role: npc.role.trim(), notes: npc.notes.trim() },
    });
  });

  (["item", "ability", "customEntities"] as const).forEach((group) => {
    const templateType = group === "customEntities" ? "custom_entity" : group;
    templates[group].forEach((template) => {
      payload.push({
        client_key: template.id,
        template_type: templateType,
        name: template.name.trim(),
        definition: {
          fields: template.fields.map((field) => ({
            ...field,
            label: field.label.trim(),
          })),
        },
      });
    });
  });

  return payload;
}
