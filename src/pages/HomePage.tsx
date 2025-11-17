import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import { listWorlds, createWorld, type World } from "../api/worlds";
import {
  saveWorldTemplates,
  type TemplateDefinitionPayload,
} from "../api/templates";

type CharacterFeatureType =
  | "number_stat"
  | "number_resource"
  | "text"
  | "action"
  | "item_slot"
  | "ability_slot"
  | "custom_entity";

type CharacterFeatureDraft = {
  id: string;
  label: string;
  type: CharacterFeatureType;
  min?: number;
  max?: number;
  entityId?: string;
};

type TemplateFieldDraft = {
  id: string;
  label: string;
  inputType: "text" | "number" | "action";
};

type CustomEntityValueDraft = {
  id: string;
  value: string;
  flavorText: string;
};

type CustomEntityTemplateDraft = {
  id: string;
  name: string;
  fields: TemplateFieldDraft[];
  values: CustomEntityValueDraft[];
};

const FEATURE_OPTIONS: { value: CharacterFeatureType; label: string }[] = [
  { value: "number_stat", label: "Number · Stat" },
  { value: "number_resource", label: "Number · Resource" },
  { value: "text", label: "Text note" },
  { value: "action", label: "Action trigger" },
  { value: "item_slot", label: "Item slot" },
  { value: "ability_slot", label: "Ability slot" },
  { value: "custom_entity", label: "Custom entity link" },
];

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function defaultCharacterFeatures(): CharacterFeatureDraft[] {
  return [
    { id: generateId(), label: "Strength", type: "number_stat", min: 0, max: 10 },
    { id: generateId(), label: "Agility", type: "number_stat", min: 0, max: 10 },
    {
      id: generateId(),
      label: "Health",
      type: "number_resource",
      min: 0,
      max: 12,
    },
    { id: generateId(), label: "Inventory", type: "item_slot" },
  ];
}

function defaultItemFields(): TemplateFieldDraft[] {
  return [
    { id: generateId(), label: "Name", inputType: "text" },
    { id: generateId(), label: "Description", inputType: "text" },
  ];
}

function defaultAbilityFields(): TemplateFieldDraft[] {
  return [
    { id: generateId(), label: "Name", inputType: "text" },
    { id: generateId(), label: "Effect", inputType: "text" },
    { id: generateId(), label: "Cost", inputType: "text" },
  ];
}

function defaultCustomEntities(): CustomEntityTemplateDraft[] {
  return [
    {
      id: generateId(),
      name: "Faction",
      fields: [{ id: generateId(), label: "Description", inputType: "text" }],
      values: [
        {
          id: generateId(),
          value: "Northern Wardens",
          flavorText: "Stoic guardians of the tundra forts.",
        },
      ],
    },
  ];
}

export function HomePage() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [newName, setNewName] = useState("");
  const [gameSystem, setGameSystem] = useState("Custom");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [characterTemplateName, setCharacterTemplateName] = useState("Adventurer");
  const [characterFeatures, setCharacterFeatures] = useState<CharacterFeatureDraft[]>(
    defaultCharacterFeatures()
  );
  const [itemTemplateName, setItemTemplateName] = useState("Equipment");
  const [itemFields, setItemFields] = useState<TemplateFieldDraft[]>(defaultItemFields());
  const [abilityTemplateName, setAbilityTemplateName] = useState("Abilities");
  const [abilityFields, setAbilityFields] =
    useState<TemplateFieldDraft[]>(defaultAbilityFields());
  const [customEntities, setCustomEntities] =
    useState<CustomEntityTemplateDraft[]>(defaultCustomEntities());

  useEffect(() => {
    setLoading(true);
    listWorlds()
      .then(setWorlds)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const validateTemplates = (): string | null => {
    if (characterFeatures.length === 0) {
      return "Add at least one character feature.";
    }
    for (const feature of characterFeatures) {
      if (!feature.label.trim()) {
        return "All character features need labels.";
      }
      if (
        (feature.type === "number_stat" || feature.type === "number_resource") &&
        (typeof feature.min !== "number" || typeof feature.max !== "number")
      ) {
        return "Number features must include min and max.";
      }
      if (feature.type === "custom_entity" && !feature.entityId) {
        return "Custom entity features must be linked to an entity template.";
      }
    }
    for (const field of [...itemFields, ...abilityFields]) {
      if (!field.label.trim()) {
        return "Template fields need labels.";
      }
    }
    for (const entity of customEntities) {
      if (!entity.name.trim()) {
        return "Custom entities require a name.";
      }
      if (entity.values.length === 0) {
        return `Add at least one value to ${entity.name}.`;
      }
      for (const value of entity.values) {
        if (!value.value.trim() || !value.flavorText.trim()) {
          return `Entity ${entity.name} requires value labels and flavor text.`;
        }
      }
    }
    return null;
  };

  const buildTemplatePayload = (): TemplateDefinitionPayload[] => {
    const base: TemplateDefinitionPayload[] = [
      {
        template_type: "character",
        name: characterTemplateName || "Character",
        definition: {
          features: characterFeatures.map(
            ({ id, label, type, min, max, entityId }) => ({
              id,
              label,
              type,
              min,
              max,
              entityId,
            })
          ),
        },
      },
      {
        template_type: "item",
        name: itemTemplateName || "Item",
        definition: {
          fields: itemFields.map((field) => ({
            id: field.id,
            label: field.label,
            inputType: field.inputType,
          })),
        },
      },
      {
        template_type: "ability",
        name: abilityTemplateName || "Ability",
        definition: {
          fields: abilityFields.map((field) => ({
            id: field.id,
            label: field.label,
            inputType: field.inputType,
          })),
        },
      },
    ];

    customEntities.forEach((entity) => {
      base.push({
        template_type: "custom_entity",
        name: entity.name,
        definition: {
          fields: entity.fields,
          values: entity.values,
        },
      });
    });

    return base;
  };

  const handleCreate = async () => {
    const templateIssue = validateTemplates();
    if (templateIssue) {
      setError(templateIssue);
      return;
    }

    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const world = await createWorld(name, gameSystem.trim());
      await saveWorldTemplates(world.id, buildTemplatePayload());
      setWorlds((prev) => [world, ...prev]);
      setNewName("");
      setGameSystem("Custom");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const addCharacterFeature = () => {
    setCharacterFeatures((prev) => [
      ...prev,
      { id: generateId(), label: "New Feature", type: "text" },
    ]);
  };

  const addField = (setter: Dispatch<SetStateAction<TemplateFieldDraft[]>>) => {
    setter((prev) => [
      ...prev,
      { id: generateId(), label: "New Field", inputType: "text" },
    ]);
  };

  const addCustomEntity = () => {
    setCustomEntities((prev) => [
      ...prev,
      {
        id: generateId(),
        name: "Custom Entity",
        fields: [{ id: generateId(), label: "Detail", inputType: "text" }],
        values: [{ id: generateId(), value: "", flavorText: "" }],
      },
    ]);
  };

  const addEntityValue = (entityId: string) => {
    setCustomEntities((prev) =>
      prev.map((entity) =>
        entity.id === entityId
          ? {
              ...entity,
              values: [
                ...entity.values,
                { id: generateId(), value: "", flavorText: "" },
              ],
            }
          : entity
      )
    );
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold mb-1">TTRPG Manager</h1>
        <p className="text-sm text-slate-400">
          Create a world, then lock in character, item, ability, and entity templates.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          World blueprint
        </h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="World name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <input
            className="w-full sm:w-48 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="System (D&D 5e, PF2e, Custom...)"
            value={gameSystem}
            onChange={(e) => setGameSystem(e.target.value)}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="px-4 py-2 rounded bg-sky-600 text-sm disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </section>

      <section className="space-y-4 border border-slate-800 rounded-lg p-4 bg-slate-950/60">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Character template
          </h3>
          <p className="text-xs text-slate-500">
            Define the sheet all player characters will use.
          </p>
        </div>
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
          value={characterTemplateName}
          onChange={(e) => setCharacterTemplateName(e.target.value)}
          placeholder="Template name"
        />
        <div className="space-y-2">
          {characterFeatures.map((feature) => (
            <div
              key={feature.id}
              className="grid md:grid-cols-5 gap-2 items-center text-sm"
            >
              <input
                className="col-span-2 rounded border border-slate-700 bg-slate-900 px-3 py-2"
                value={feature.label}
                onChange={(e) =>
                  setCharacterFeatures((prev) =>
                    prev.map((item) =>
                      item.id === feature.id
                        ? { ...item, label: e.target.value }
                        : item
                    )
                  )
                }
              />
              <select
                className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
                value={feature.type}
                onChange={(e) =>
                  setCharacterFeatures((prev) =>
                    prev.map((item) =>
                      item.id === feature.id
                        ? { ...item, type: e.target.value as CharacterFeatureType }
                        : item
                    )
                  )
                }
              >
                {FEATURE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {(feature.type === "number_stat" ||
                feature.type === "number_resource") && (
                <div className="flex gap-2 text-xs items-center">
                  <input
                    type="number"
                    placeholder="Min"
                    value={feature.min ?? ""}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                    onChange={(e) =>
                      setCharacterFeatures((prev) =>
                        prev.map((item) =>
                          item.id === feature.id
                            ? { ...item, min: Number(e.target.value) }
                            : item
                        )
                      )
                    }
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={feature.max ?? ""}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                    onChange={(e) =>
                      setCharacterFeatures((prev) =>
                        prev.map((item) =>
                          item.id === feature.id
                            ? { ...item, max: Number(e.target.value) }
                            : item
                        )
                      )
                    }
                  />
                </div>
              )}
              {feature.type === "custom_entity" && (
                <select
                  className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs"
                  value={feature.entityId ?? ""}
                  onChange={(e) =>
                    setCharacterFeatures((prev) =>
                      prev.map((item) =>
                        item.id === feature.id
                          ? { ...item, entityId: e.target.value }
                          : item
                      )
                    )
                  }
                >
                  <option value="">Select entity</option>
                  {customEntities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="text-xs text-red-300"
                onClick={() =>
                  setCharacterFeatures((prev) =>
                    prev.filter((item) => item.id !== feature.id)
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="text-xs text-sky-300"
            onClick={addCharacterFeature}
          >
            + Add feature
          </button>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="space-y-3 border border-slate-800 rounded-lg p-4 bg-slate-950/60">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Item template</h3>
            <p className="text-xs text-slate-500">Define fields for equipment items.</p>
          </div>
          <input
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            value={itemTemplateName}
            onChange={(e) => setItemTemplateName(e.target.value)}
          />
          {itemFields.map((field) => (
            <div key={field.id} className="flex gap-2 text-sm">
              <input
                className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
                value={field.label}
                onChange={(e) =>
                  setItemFields((prev) =>
                    prev.map((item) =>
                      item.id === field.id ? { ...item, label: e.target.value } : item
                    )
                  )
                }
              />
              <select
                className="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs"
                value={field.inputType}
                onChange={(e) =>
                  setItemFields((prev) =>
                    prev.map((item) =>
                      item.id === field.id ? { ...item, inputType: e.target.value as TemplateFieldDraft["inputType"] } : item
                    )
                  )
                }
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="action">Action</option>
              </select>
              <button
                className="text-xs text-red-300"
                onClick={() =>
                  setItemFields((prev) => prev.filter((item) => item.id !== field.id))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="text-xs text-sky-300"
            onClick={() => addField(setItemFields)}
          >
            + Add field
          </button>
        </section>

        <section className="space-y-3 border border-slate-800 rounded-lg p-4 bg-slate-950/60">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              Ability template
            </h3>
            <p className="text-xs text-slate-500">Capture actions, spells, or powers.</p>
          </div>
          <input
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            value={abilityTemplateName}
            onChange={(e) => setAbilityTemplateName(e.target.value)}
          />
          {abilityFields.map((field) => (
            <div key={field.id} className="flex gap-2 text-sm">
              <input
                className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
                value={field.label}
                onChange={(e) =>
                  setAbilityFields((prev) =>
                    prev.map((item) =>
                      item.id === field.id ? { ...item, label: e.target.value } : item
                    )
                  )
                }
              />
              <select
                className="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs"
                value={field.inputType}
                onChange={(e) =>
                  setAbilityFields((prev) =>
                    prev.map((item) =>
                      item.id === field.id ? { ...item, inputType: e.target.value as TemplateFieldDraft["inputType"] } : item
                    )
                  )
                }
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="action">Action</option>
              </select>
              <button
                className="text-xs text-red-300"
                onClick={() =>
                  setAbilityFields((prev) =>
                    prev.filter((item) => item.id !== field.id)
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="text-xs text-sky-300"
            onClick={() => addField(setAbilityFields)}
          >
            + Add field
          </button>
        </section>
      </div>

      <section className="space-y-4 border border-slate-800 rounded-lg p-4 bg-slate-950/60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              Custom entities
            </h3>
            <p className="text-xs text-slate-500">
              Build entity taxonomies (houses, elements, factions) with flavor text.
            </p>
          </div>
          <button
            className="text-xs text-sky-300"
            onClick={addCustomEntity}
          >
            + Add custom entity
          </button>
        </div>
        {customEntities.map((entity) => (
          <div key={entity.id} className="border border-slate-800 rounded p-3 space-y-3">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                value={entity.name}
                onChange={(e) =>
                  setCustomEntities((prev) =>
                    prev.map((item) =>
                      item.id === entity.id ? { ...item, name: e.target.value } : item
                    )
                  )
                }
              />
              <button
                className="text-xs text-red-300"
                onClick={() =>
                  setCustomEntities((prev) =>
                    prev.filter((item) => item.id !== entity.id)
                  )
                }
              >
                Remove
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <p className="text-slate-400 font-semibold">Fields</p>
              {entity.fields.map((field) => (
                <div key={field.id} className="flex gap-2">
                  <input
                    className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
                    value={field.label}
                    onChange={(e) =>
                      setCustomEntities((prev) =>
                        prev.map((item) =>
                          item.id === entity.id
                            ? {
                                ...item,
                                fields: item.fields.map((f) =>
                                  f.id === field.id ? { ...f, label: e.target.value } : f
                                ),
                              }
                            : item
                        )
                      )
                    }
                  />
                  <button
                    className="text-red-300"
                    onClick={() =>
                      setCustomEntities((prev) =>
                        prev.map((item) =>
                          item.id === entity.id
                            ? {
                                ...item,
                                fields: item.fields.filter((f) => f.id !== field.id),
                              }
                            : item
                        )
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="text-sky-300"
                onClick={() =>
                  setCustomEntities((prev) =>
                    prev.map((item) =>
                      item.id === entity.id
                        ? {
                            ...item,
                            fields: [
                              ...item.fields,
                              { id: generateId(), label: "Detail", inputType: "text" },
                            ],
                          }
                        : item
                    )
                  )
                }
              >
                + Field
              </button>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-slate-400 font-semibold">Values & flavor text</p>
              {entity.values.map((value) => (
                <div key={value.id} className="grid md:grid-cols-2 gap-2 text-xs">
                  <input
                    className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
                    placeholder="Value (e.g., Ashen Order)"
                    value={value.value}
                    onChange={(e) =>
                      setCustomEntities((prev) =>
                        prev.map((item) =>
                          item.id === entity.id
                            ? {
                                ...item,
                                values: item.values.map((v) =>
                                  v.id === value.id ? { ...v, value: e.target.value } : v
                                ),
                              }
                            : item
                        )
                      )
                    }
                  />
                  <input
                    className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
                    placeholder="Flavor text"
                    value={value.flavorText}
                    onChange={(e) =>
                      setCustomEntities((prev) =>
                        prev.map((item) =>
                          item.id === entity.id
                            ? {
                                ...item,
                                values: item.values.map((v) =>
                                  v.id === value.id
                                    ? { ...v, flavorText: e.target.value }
                                    : v
                                ),
                              }
                            : item
                        )
                      )
                    }
                  />
                  <button
                    className="text-left text-red-300"
                    onClick={() =>
                      setCustomEntities((prev) =>
                        prev.map((item) =>
                          item.id === entity.id
                            ? {
                                ...item,
                                values: item.values.filter((v) => v.id !== value.id),
                              }
                            : item
                        )
                      )
                    }
                  >
                    Remove value
                  </button>
                </div>
              ))}
              <button
                className="text-xs text-sky-300"
                onClick={() => addEntityValue(entity.id)}
              >
                + Value
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Worlds
        </h2>

        {loading && <p className="text-sm text-slate-400">Loading worlds…</p>}
        {error && <p className="text-sm text-red-400">Error: {error}</p>}

        {worlds.length === 0 && !loading && (
          <p className="text-sm text-slate-500">
            No worlds yet. Create one to get started.
          </p>
        )}

        <ul className="space-y-2">
          {worlds.map((w) => (
            <li
              key={w.id}
              className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 hover:border-sky-500"
            >
              <div>
                <p className="text-sm font-medium">{w.name}</p>
                <p className="text-xs text-slate-500">
                  {w.game_system || "System: n/a"}
                </p>
              </div>
              <Link
                to={`/world/${w.id}/overview`}
                className="text-xs px-3 py-1 rounded bg-slate-800 hover:bg-slate-700"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
