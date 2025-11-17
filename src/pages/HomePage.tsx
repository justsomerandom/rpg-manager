import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createWorld, listWorlds, type World } from "../api/worlds";
import { saveWorldTemplates, type TemplateDefinitionPayload } from "../api/templates";

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

type CharacterFeatureType =
  | "number_stat"
  | "number_resource"
  | "text"
  | "action"
  | "item_slot"
  | "ability_slot"
  | "custom_entity";

const FEATURE_OPTIONS: { value: CharacterFeatureType; label: string }[] = [
  { value: "number_stat", label: "Number - Stat" },
  { value: "number_resource", label: "Number - Resource" },
  { value: "text", label: "Text" },
  { value: "action", label: "Action" },
  { value: "item_slot", label: "Item Slot" },
  { value: "ability_slot", label: "Ability Slot" },
  { value: "custom_entity", label: "Custom Entity" },
];

type CharacterFeature = {
  id: string;
  label: string;
  type: CharacterFeatureType;
  min?: number;
  max?: number;
  entityId?: string;
};

type TemplateFieldInput = "text" | "number" | "action";

type TemplateField = {
  id: string;
  label: string;
  inputType: TemplateFieldInput;
};

type FieldCollectionTemplate = {
  id: string;
  name: string;
  fields: TemplateField[];
};

type NPCTemplate = {
  id: string;
  name: string;
  role: string;
  notes: string;
};

type TemplateState = {
  character: CharacterFeature[];
  npc: NPCTemplate[];
  item: FieldCollectionTemplate[];
  ability: FieldCollectionTemplate[];
  customEntities: FieldCollectionTemplate[];
};

type FieldTemplateGroup = "item" | "ability" | "customEntities";

const FIELD_TYPE_OPTIONS: { value: TemplateFieldInput; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "action", label: "Action Toggle" },
];

const buildDefaultFields = (group: FieldTemplateGroup): TemplateField[] => {
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
    { id: makeId(), label: "Flavor Hook", inputType: "text" },
  ];
};

const defaultTemplates = (): TemplateState => ({
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
  item: [
    {
      id: makeId(),
      name: "Common Item",
      fields: buildDefaultFields("item"),
    },
  ],
  ability: [
    {
      id: makeId(),
      name: "Signature Ability",
      fields: buildDefaultFields("ability"),
    },
  ],
  customEntities: [
    {
      id: makeId(),
      name: "Faction",
      fields: buildDefaultFields("customEntities"),
    },
  ],
});
export function HomePage() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [gameSystem, setGameSystem] = useState("Custom");
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateState>(() => defaultTemplates());

  useEffect(() => {
    setLoading(true);
    listWorlds()
      .then((data) => {
        setWorlds(data);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const customEntityOptions = useMemo(
    () =>
      templates.customEntities.map((entity) => ({
        value: entity.id,
        label: entity.name || "Custom Entity",
      })),
    [templates.customEntities]
  );

  const templatePayload = useMemo<TemplateDefinitionPayload[]>(() => {
    const payload: TemplateDefinitionPayload[] = [
      {
        template_type: "character",
        name: "Character Sheet",
        definition: { features: templates.character },
      },
    ];

    templates.npc.forEach((npc) => {
      payload.push({
        template_type: "npc",
        name: npc.name.trim(),
        definition: { role: npc.role.trim(), notes: npc.notes.trim() },
      });
    });

    templates.item.forEach((template) => {
      payload.push({
        template_type: "item",
        name: template.name.trim(),
        definition: { fields: template.fields },
      });
    });

    templates.ability.forEach((template) => {
      payload.push({
        template_type: "ability",
        name: template.name.trim(),
        definition: { fields: template.fields },
      });
    });

    templates.customEntities.forEach((entity) => {
      payload.push({
        template_type: "custom_entity",
        name: entity.name.trim(),
        definition: { fields: entity.fields },
      });
    });

    return payload;
  }, [templates]);

  const mutateFieldTemplates = (
    group: FieldTemplateGroup,
    updater: (items: FieldCollectionTemplate[]) => FieldCollectionTemplate[]
  ) => {
    setTemplates((prev) => ({
      ...prev,
      [group]: updater(prev[group]),
    }));
  };

  const addFieldTemplate = (group: FieldTemplateGroup) => {
    const labelMap: Record<FieldTemplateGroup, string> = {
      item: "Item Template",
      ability: "Ability Template",
      customEntities: "Custom Entity",
    };
    mutateFieldTemplates(group, (items) => [
      ...items,
      {
        id: makeId(),
        name: `${labelMap[group]} ${items.length + 1}`,
        fields: buildDefaultFields(group),
      },
    ]);
  };

  const handleFieldTemplateNameChange = (
    group: FieldTemplateGroup,
    templateId: string,
    value: string
  ) => {
    mutateFieldTemplates(group, (items) =>
      items.map((template) =>
        template.id === templateId ? { ...template, name: value } : template
      )
    );
  };

  const handleFieldChange = (
    group: FieldTemplateGroup,
    templateId: string,
    fieldId: string,
    patch: Partial<TemplateField>
  ) => {
    mutateFieldTemplates(group, (items) =>
      items.map((template) =>
        template.id === templateId
          ? {
              ...template,
              fields: template.fields.map((field) =>
                field.id === fieldId ? { ...field, ...patch } : field
              ),
            }
          : template
      )
    );
  };

  const handleAddField = (group: FieldTemplateGroup, templateId: string) => {
    mutateFieldTemplates(group, (items) =>
      items.map((template) =>
        template.id === templateId
          ? {
              ...template,
              fields: [
                ...template.fields,
                {
                  id: makeId(),
                  label: `Field ${template.fields.length + 1}`,
                  inputType: "text",
                },
              ],
            }
          : template
      )
    );
  };

  const handleRemoveField = (
    group: FieldTemplateGroup,
    templateId: string,
    fieldId: string
  ) => {
    mutateFieldTemplates(group, (items) =>
      items.map((template) =>
        template.id === templateId
          ? {
              ...template,
              fields: template.fields.filter((field) => field.id !== fieldId),
            }
          : template
      )
    );
  };

  const handleRemoveFieldTemplate = (group: FieldTemplateGroup, templateId: string) => {
    if (group === "customEntities") {
      setTemplates((prev) => ({
        ...prev,
        customEntities: prev.customEntities.filter((entity) => entity.id !== templateId),
        character: prev.character.map((feature) =>
          feature.type === "custom_entity" && feature.entityId === templateId
            ? { ...feature, entityId: undefined }
            : feature
        ),
      }));
      return;
    }
    mutateFieldTemplates(group, (items) => items.filter((template) => template.id !== templateId));
  };

  const addCharacterFeature = () => {
    setTemplates((prev) => ({
      ...prev,
      character: [
        ...prev.character,
        {
          id: makeId(),
          label: `Feature ${prev.character.length + 1}`,
          type: "text",
        },
      ],
    }));
  };

  const removeCharacterFeature = (featureId: string) => {
    setTemplates((prev) => ({
      ...prev,
      character: prev.character.filter((feature) => feature.id !== featureId),
    }));
  };

  const handleFeatureLabelChange = (featureId: string, value: string) => {
    setTemplates((prev) => ({
      ...prev,
      character: prev.character.map((feature) =>
        feature.id === featureId ? { ...feature, label: value } : feature
      ),
    }));
  };

  const handleFeatureTypeChange = (featureId: string, value: CharacterFeatureType) => {
    setTemplates((prev) => {
      const fallbackEntityId = prev.customEntities[0]?.id;
      return {
        ...prev,
        character: prev.character.map((feature) => {
          if (feature.id !== featureId) return feature;
          const requiresRange = value === "number_stat" || value === "number_resource";
          return {
            ...feature,
            type: value,
            min: requiresRange ? feature.min ?? 0 : undefined,
            max: requiresRange ? feature.max ?? 10 : undefined,
            entityId:
              value === "custom_entity" ? feature.entityId ?? fallbackEntityId : undefined,
          };
        }),
      };
    });
  };

  const handleFeatureRangeChange = (
    featureId: string,
    key: "min" | "max",
    value: string
  ) => {
    const numeric = value === "" ? undefined : Number(value);
    setTemplates((prev) => ({
      ...prev,
      character: prev.character.map((feature) =>
        feature.id === featureId ? { ...feature, [key]: numeric } : feature
      ),
    }));
  };

  const handleFeatureEntityChange = (featureId: string, entityId: string) => {
    setTemplates((prev) => ({
      ...prev,
      character: prev.character.map((feature) =>
        feature.id === featureId ? { ...feature, entityId } : feature
      ),
    }));
  };
  const addNpcTemplate = () => {
    setTemplates((prev) => ({
      ...prev,
      npc: [
        ...prev.npc,
        { id: makeId(), name: `NPC ${prev.npc.length + 1}`, role: "", notes: "" },
      ],
    }));
  };

  const updateNpcTemplate = (templateId: string, patch: Partial<NPCTemplate>) => {
    setTemplates((prev) => ({
      ...prev,
      npc: prev.npc.map((npc) => (npc.id === templateId ? { ...npc, ...patch } : npc)),
    }));
  };

  const removeNpcTemplate = (templateId: string) => {
    setTemplates((prev) => ({
      ...prev,
      npc: prev.npc.filter((npc) => npc.id !== templateId),
    }));
  };

  const validateBeforeCreate = (): string | null => {
    if (!newName.trim()) return "World name is required.";
    if (templates.character.length === 0) return "Add at least one character feature.";
    for (const feature of templates.character) {
      if (!feature.label.trim()) return "Each character feature needs a label.";
      if (
        (feature.type === "number_stat" || feature.type === "number_resource") &&
        (typeof feature.min !== "number" || typeof feature.max !== "number")
      ) {
        return "Number features need both minimum and maximum values.";
      }
      if (feature.type === "custom_entity" && !feature.entityId) {
        return "Custom entity features must reference a custom entity template.";
      }
    }

    if (templates.npc.length === 0) return "Add at least one NPC template.";
    for (const npc of templates.npc) {
      if (!npc.name.trim()) return "NPC templates need a name.";
      if (!npc.role.trim()) return "NPC templates should describe a role.";
    }

    const ensureFieldCollections = (
      group: FieldTemplateGroup,
      label: string,
      requireEntry = true
    ) => {
      const collection = templates[group];
      if (requireEntry && collection.length === 0) {
        throw new Error(`Add at least one ${label.toLowerCase()}.`);
      }
      for (const template of collection) {
        if (!template.name.trim()) {
          throw new Error(`${label} requires a name.`);
        }
        if (template.fields.length === 0) {
          throw new Error(`${label} must contain at least one field.`);
        }
        for (const field of template.fields) {
          if (!field.label.trim()) {
            throw new Error(`All fields inside ${label} need labels.`);
          }
        }
      }
    };

    try {
      ensureFieldCollections("item", "Item template");
      ensureFieldCollections("ability", "Ability template");
      ensureFieldCollections("customEntities", "Custom entity template");
    } catch (err) {
      return err instanceof Error ? err.message : "Template validation failed.";
    }

    return null;
  };

  const resetForm = () => {
    setNewName("");
    setGameSystem("Custom");
    setTemplates(defaultTemplates());
  };

  const handleOpenReview = () => {
    if (!newName.trim()) {
      setError("World name is required.");
      return;
    }
    setError(null);
    setReviewOpen(true);
  };

  const handleConfirmCreate = async () => {
    const validationError = validateBeforeCreate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setCreating(true);
    try {
      const world = await createWorld(newName.trim(), gameSystem.trim() || "Custom");
      await saveWorldTemplates(world.id, templatePayload);
      setWorlds((prev) => [...prev, world]);
      resetForm();
      setReviewOpen(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleCloseReview = () => {
    if (!creating) {
      setReviewOpen(false);
    }
  };
  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-100">RPG Manager</h1>
        <p className="text-sm text-slate-400">
          Define worlds, then lock their character, NPC, item, ability, and custom entity templates.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="space-y-3 border border-slate-800 rounded-lg p-4 bg-slate-950/40">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
          World basics
        </h2>
        <p className="text-xs text-slate-500">
          Templates are configured in the confirmation modal. The inventory system is global, so it
          is not part of the character template.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="World name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleOpenReview();
            }}
          />
          <input
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="Game system (Custom, D&D 5e...)"
            value={gameSystem}
            onChange={(e) => setGameSystem(e.target.value)}
          />
          <button
            onClick={handleOpenReview}
            disabled={!newName.trim() || creating}
            className="primary-button"
          >
            {creating ? "Working..." : "Create world"}
          </button>
        </div>
      </section>

      <section className="space-y-3 border border-slate-800 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Existing worlds
        </h2>
        {loading && <p className="text-sm text-slate-400">Loading worlds...</p>}
        {!loading && worlds.length === 0 && (
          <p className="text-sm text-slate-500">No worlds yet. Create one above.</p>
        )}
        <ul className="space-y-2">
          {worlds.map((world) => (
            <li
              key={world.id}
              className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 hover:border-sky-500/60"
            >
              <div>
                <p className="text-sm font-medium text-slate-100">{world.name}</p>
                <p className="text-xs text-slate-500">
                  {world.game_system || "System not specified"}
                </p>
              </div>
              <Link
                to={`/world/${world.id}/overview`}
                className="text-xs rounded bg-slate-800 px-3 py-1 hover:bg-slate-700"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {reviewOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-3 py-6 sm:items-center">
          <div className="w-full max-w-5xl rounded-lg border border-slate-800 bg-slate-950 shadow-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">
                  Confirm templates for {newName || "New World"}
                </h3>
                <p className="text-sm text-slate-400">
                  Adjust every template before saving. Changes apply only to this world.
                </p>
              </div>
              <button
                className="text-xs px-3 py-1 rounded bg-slate-800 hover:bg-slate-700"
                onClick={handleCloseReview}
                disabled={creating}
              >
                Close
              </button>
            </div>

            <section className="space-y-3">
              <header>
                <h4 className="text-sm font-semibold text-slate-200">
                  Character template (shared by all PCs)
                </h4>
                <p className="text-xs text-slate-500">
                  Include stats, resources, actions, ability/item slots, or references to custom
                  entities. Inventory is managed separately and not listed here.
                </p>
              </header>
              <div className="space-y-3">
                {templates.character.map((feature) => (
                  <div
                    key={feature.id}
                    className="rounded border border-slate-800 bg-slate-900/40 p-3 space-y-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                        placeholder="Feature label"
                        value={feature.label}
                        onChange={(e) => handleFeatureLabelChange(feature.id, e.target.value)}
                      />
                      <select
                        className="w-full sm:w-48 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                        value={feature.type}
                        onChange={(e) =>
                          handleFeatureTypeChange(
                            feature.id,
                            e.target.value as CharacterFeatureType
                          )
                        }
                      >
                        {FEATURE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {(feature.type === "number_stat" ||
                      feature.type === "number_resource") && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="number"
                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          placeholder="Min"
                          value={feature.min ?? ""}
                          onChange={(e) => handleFeatureRangeChange(feature.id, "min", e.target.value)}
                        />
                        <input
                          type="number"
                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          placeholder="Max"
                          value={feature.max ?? ""}
                          onChange={(e) => handleFeatureRangeChange(feature.id, "max", e.target.value)}
                        />
                      </div>
                    )}

                    {feature.type === "custom_entity" && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          value={feature.entityId ?? ""}
                          onChange={(e) => handleFeatureEntityChange(feature.id, e.target.value)}
                        >
                          <option value="">Select custom entity</option>
                          {customEntityOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-slate-500 sm:w-48">
                          Custom entities display per-character flavor text later.
                        </p>
                      </div>
                    )}

                    <div className="text-right">
                      <button
                        className="text-xs text-red-300"
                        onClick={() => removeCharacterFeature(feature.id)}
                      >
                        Remove feature
                      </button>
                    </div>
                  </div>
                ))}
                <button className="text-xs text-sky-300" onClick={addCharacterFeature}>
                  + Add feature
                </button>
              </div>
            </section>
            <section className="space-y-3">
              <header>
                <h4 className="text-sm font-semibold text-slate-200">NPC templates</h4>
                <p className="text-xs text-slate-500">
                  Store labeled archetypes for townsfolk, factions, or monsters.
                </p>
              </header>
              <div className="space-y-3">
                {templates.npc.map((npc) => (
                  <div
                    key={npc.id}
                    className="rounded border border-slate-800 bg-slate-900/40 p-3 space-y-2"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                        placeholder="NPC name"
                        value={npc.name}
                        onChange={(e) => updateNpcTemplate(npc.id, { name: e.target.value })}
                      />
                      <input
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                        placeholder="Role / label"
                        value={npc.role}
                        onChange={(e) => updateNpcTemplate(npc.id, { role: e.target.value })}
                      />
                    </div>
                    <textarea
                      className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      rows={3}
                      placeholder="Notes, stat blocks, quirks..."
                      value={npc.notes}
                      onChange={(e) => updateNpcTemplate(npc.id, { notes: e.target.value })}
                    />
                    <div className="text-right">
                      <button
                        className="text-xs text-red-300"
                        onClick={() => removeNpcTemplate(npc.id)}
                      >
                        Remove NPC
                      </button>
                    </div>
                  </div>
                ))}
                <button className="text-xs text-sky-300" onClick={addNpcTemplate}>
                  + Add NPC template
                </button>
              </div>
            </section>
            <section className="space-y-3">
              <header>
                <h4 className="text-sm font-semibold text-slate-200">Item templates</h4>
                <p className="text-xs text-slate-500">
                  Build as many item blueprints as you need. Each field becomes an input when
                  recording an item later.
                </p>
              </header>
              {templates.item.map((template) => (
                <div
                  key={template.id}
                  className="rounded border border-slate-800 bg-slate-900/40 p-3 space-y-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      placeholder="Template name"
                      value={template.name}
                      onChange={(e) =>
                        handleFieldTemplateNameChange("item", template.id, e.target.value)
                      }
                    />
                    <button
                      className="text-xs text-red-300"
                      onClick={() => handleRemoveFieldTemplate("item", template.id)}
                    >
                      Remove template
                    </button>
                  </div>
                  <div className="space-y-2">
                    {template.fields.map((field) => (
                      <div key={field.id} className="flex flex-col gap-2 sm:flex-row">
                        <input
                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          placeholder="Field label"
                          value={field.label}
                          onChange={(e) =>
                            handleFieldChange("item", template.id, field.id, { label: e.target.value })
                          }
                        />
                        <select
                          className="w-full sm:w-40 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          value={field.inputType}
                          onChange={(e) =>
                            handleFieldChange("item", template.id, field.id, {
                              inputType: e.target.value as TemplateFieldInput,
                            })
                          }
                        >
                          {FIELD_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          className="text-xs text-red-300 sm:w-24"
                          disabled={template.fields.length === 1}
                          onClick={() => handleRemoveField("item", template.id, field.id)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="text-xs text-sky-300"
                    onClick={() => handleAddField("item", template.id)}
                  >
                    + Field
                  </button>
                </div>
              ))}
              <button className="text-xs text-sky-300" onClick={() => addFieldTemplate("item")}>
                + Add item template
              </button>
            </section>

            <section className="space-y-3">
              <header>
                <h4 className="text-sm font-semibold text-slate-200">Ability templates</h4>
                <p className="text-xs text-slate-500">
                  Ability templates capture things like spell write ups or combat moves.
                </p>
              </header>
              {templates.ability.map((template) => (
                <div
                  key={template.id}
                  className="rounded border border-slate-800 bg-slate-900/40 p-3 space-y-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      placeholder="Ability template name"
                      value={template.name}
                      onChange={(e) =>
                        handleFieldTemplateNameChange("ability", template.id, e.target.value)
                      }
                    />
                    <button
                      className="text-xs text-red-300"
                      onClick={() => handleRemoveFieldTemplate("ability", template.id)}
                    >
                      Remove template
                    </button>
                  </div>
                  <div className="space-y-2">
                    {template.fields.map((field) => (
                      <div key={field.id} className="flex flex-col gap-2 sm:flex-row">
                        <input
                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          placeholder="Field label"
                          value={field.label}
                          onChange={(e) =>
                            handleFieldChange(
                              "ability",
                              template.id,
                              field.id,
                              { label: e.target.value }
                            )
                          }
                        />
                        <select
                          className="w-full sm:w-40 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          value={field.inputType}
                          onChange={(e) =>
                            handleFieldChange("ability", template.id, field.id, {
                              inputType: e.target.value as TemplateFieldInput,
                            })
                          }
                        >
                          {FIELD_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          className="text-xs text-red-300 sm:w-24"
                          disabled={template.fields.length === 1}
                          onClick={() => handleRemoveField("ability", template.id, field.id)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="text-xs text-sky-300"
                    onClick={() => handleAddField("ability", template.id)}
                  >
                    + Field
                  </button>
                </div>
              ))}
              <button className="text-xs text-sky-300" onClick={() => addFieldTemplate("ability")}>
                + Add ability template
              </button>
            </section>
            <section className="space-y-3">
              <header>
                <h4 className="text-sm font-semibold text-slate-200">Custom entity templates</h4>
                <p className="text-xs text-slate-500">
                  Custom entities (factions, elements, schools, etc.) always have a required name.
                  Use these fields for extra descriptors. Flavor text is entered per entity later.
                </p>
              </header>
              {templates.customEntities.map((entity) => (
                <div
                  key={entity.id}
                  className="rounded border border-slate-800 bg-slate-900/40 p-3 space-y-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      placeholder="Custom entity type (Faction, Element...)"
                      value={entity.name}
                      onChange={(e) =>
                        handleFieldTemplateNameChange("customEntities", entity.id, e.target.value)
                      }
                    />
                    <button
                      className="text-xs text-red-300"
                      onClick={() => handleRemoveFieldTemplate("customEntities", entity.id)}
                    >
                      Remove template
                    </button>
                  </div>
                  <div className="space-y-2">
                    {entity.fields.map((field) => (
                      <div key={field.id} className="flex flex-col gap-2 sm:flex-row">
                        <input
                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          placeholder="Descriptor label"
                          value={field.label}
                          onChange={(e) =>
                            handleFieldChange("customEntities", entity.id, field.id, {
                              label: e.target.value,
                            })
                          }
                        />
                        <button
                          className="text-xs text-red-300 sm:w-24"
                          disabled={entity.fields.length === 1}
                          onClick={() => handleRemoveField("customEntities", entity.id, field.id)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="text-xs text-sky-300"
                    onClick={() => handleAddField("customEntities", entity.id)}
                  >
                    + Descriptor field
                  </button>
                  <p className="text-[11px] text-slate-500">
                    Each entity created later must also include a unique flavor text entry that does
                    not live in the template.
                  </p>
                </div>
              ))}
              <button
                className="text-xs text-sky-300"
                onClick={() => addFieldTemplate("customEntities")}
              >
                + Add custom entity template
              </button>
            </section>

            <div className="flex justify-end gap-2">
              <button className="secondary-button" onClick={handleCloseReview} disabled={creating}>
                Back
              </button>
              <button className="primary-button" onClick={handleConfirmCreate} disabled={creating}>
                {creating ? "Saving..." : "Confirm and save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
