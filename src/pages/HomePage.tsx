import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getErrorMessage } from "../api/client";
import { createWorldWithTemplates, deleteWorld, listWorlds, type World } from "../api/worlds";
import type { TemplateDefinitionPayload } from "../api/templates";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateState>(() => defaultTemplates());
  const [reloadKey, setReloadKey] = useState(0);
  const [deletingWorldId, setDeletingWorldId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listWorlds()
      .then((data) => {
        if (!cancelled) setWorlds(data);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(getErrorMessage(error, "We couldn't load your worlds."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!reviewOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating) {
        event.preventDefault();
        setReviewOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [creating, reviewOpen]);

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
        template_type: "npc",
        name: npc.name.trim(),
        definition: { role: npc.role.trim(), notes: npc.notes.trim() },
      });
    });

    templates.item.forEach((template) => {
      payload.push({
        template_type: "item",
        name: template.name.trim(),
        definition: {
          fields: template.fields.map((field) => ({ ...field, label: field.label.trim() })),
        },
      });
    });

    templates.ability.forEach((template) => {
      payload.push({
        template_type: "ability",
        name: template.name.trim(),
        definition: {
          fields: template.fields.map((field) => ({ ...field, label: field.label.trim() })),
        },
      });
    });

    templates.customEntities.forEach((entity) => {
      payload.push({
        template_type: "custom_entity",
        name: entity.name.trim(),
        definition: {
          fields: entity.fields.map((field) => ({ ...field, label: field.label.trim() })),
        },
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
    const parsed = value === "" ? undefined : Number(value);
    const numeric = typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
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
    const worldName = newName.trim();
    if (!worldName) return "World name is required.";
    if (worldName.length > 120) return "World name must be 120 characters or fewer.";
    if (gameSystem.trim().length > 120) return "Game system must be 120 characters or fewer.";

    const allIds = [
      ...templates.character.map((feature) => feature.id),
      ...templates.npc.map((npc) => npc.id),
      ...templates.item.flatMap((template) => [template.id, ...template.fields.map((field) => field.id)]),
      ...templates.ability.flatMap((template) => [template.id, ...template.fields.map((field) => field.id)]),
      ...templates.customEntities.flatMap((template) => [template.id, ...template.fields.map((field) => field.id)]),
    ];
    if (new Set(allIds).size !== allIds.length) {
      return "Template identifiers must be unique. Remove and recreate the duplicated field.";
    }

    const hasDuplicate = (values: string[]) => {
      const normalized = values
        .map((value) => value.trim().toLocaleLowerCase())
        .filter(Boolean);
      return new Set(normalized).size !== normalized.length;
    };

    if (hasDuplicate(templates.character.map((feature) => feature.label))) {
      return "Character feature labels must be unique.";
    }
    for (const feature of templates.character) {
      if (!feature.label.trim()) return "Each character feature needs a label.";
      if (feature.label.trim().length > 80) return "Character feature labels must be 80 characters or fewer.";
      if (
        (feature.type === "number_stat" || feature.type === "number_resource") &&
        (typeof feature.min !== "number" ||
          !Number.isFinite(feature.min) ||
          typeof feature.max !== "number" ||
          !Number.isFinite(feature.max))
      ) {
        return `“${feature.label.trim()}” needs finite minimum and maximum values.`;
      }
      if (
        (feature.type === "number_stat" || feature.type === "number_resource") &&
        feature.min! > feature.max!
      ) {
        return `“${feature.label.trim()}” cannot have a minimum above its maximum.`;
      }
      if (
        feature.type === "custom_entity" &&
        (!feature.entityId || !templates.customEntities.some((entity) => entity.id === feature.entityId))
      ) {
        return "Custom entity features must reference a custom entity template.";
      }
    }

    if (hasDuplicate(templates.npc.map((npc) => npc.name))) return "NPC template names must be unique.";
    for (const npc of templates.npc) {
      if (!npc.name.trim()) return "NPC templates need a name.";
      if (npc.name.trim().length > 120) return "NPC template names must be 120 characters or fewer.";
      if (npc.role.trim().length > 300) return "NPC roles must be 300 characters or fewer.";
      if (npc.notes.trim().length > 5000) return "NPC notes must be 5,000 characters or fewer.";
    }

    const ensureFieldCollections = (
      group: FieldTemplateGroup,
      label: string
    ) => {
      const collection = templates[group];
      if (hasDuplicate(collection.map((template) => template.name))) {
        throw new Error(`${label} names must be unique.`);
      }
      for (const template of collection) {
        if (!template.name.trim()) {
          throw new Error(`${label} requires a name.`);
        }
        if (template.name.trim().length > 120) {
          throw new Error(`${label} names must be 120 characters or fewer.`);
        }
        if (template.fields.length === 0) {
          throw new Error(`${label} must contain at least one field.`);
        }
        if (hasDuplicate(template.fields.map((field) => field.label))) {
          throw new Error(`Field labels inside “${template.name.trim()}” must be unique.`);
        }
        for (const field of template.fields) {
          if (!field.label.trim()) {
            throw new Error(`All fields inside ${label} need labels.`);
          }
          if (field.label.trim().length > 80) {
            throw new Error(`Field labels inside ${label} must be 80 characters or fewer.`);
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

  const handleOpenReview = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!newName.trim()) {
      setFormError("World name is required.");
      return;
    }
    setFormError(null);
    setReviewError(null);
    setMessage(null);
    setReviewOpen(true);
  };

  const handleConfirmCreate = async () => {
    const validationError = validateBeforeCreate();
    if (validationError) {
      setReviewError(validationError);
      return;
    }

    setCreating(true);
    setReviewError(null);
    try {
      const world = await createWorldWithTemplates(
        newName.trim(),
        gameSystem.trim() || "Custom",
        templatePayload
      );
      setWorlds((prev) => [world, ...prev]);
      resetForm();
      setReviewOpen(false);
      setMessage(`“${world.name}” was created.`);
    } catch (error) {
      setReviewError(getErrorMessage(error, "We couldn't create this world."));
    } finally {
      setCreating(false);
    }
  };

  const handleCloseReview = () => {
    if (!creating) {
      setReviewOpen(false);
    }
  };

  const handleDeleteWorld = async (world: World) => {
    if (deletingWorldId || creating) return;
    const confirmed = window.confirm(
      `Delete “${world.name}” and all of its characters, lore, index entries, and maps? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingWorldId(world.id);
    setFormError(null);
    setMessage(null);
    try {
      await deleteWorld(world.id);
      setWorlds((current) => current.filter((candidate) => candidate.id !== world.id));
      setMessage(`“${world.name}” was deleted.`);
    } catch (error) {
      setFormError(getErrorMessage(error, "We couldn't delete that world."));
    } finally {
      setDeletingWorldId(null);
    }
  };
  return (
    <div className="page-shell max-w-7xl mx-auto p-2 sm:p-6">
      <header className="page-header">
        <div>
          <p className="section-label">Your campaign workspace</p>
          <h1 className="page-title mt-1">RPG Manager</h1>
          <p className="page-description mt-2">
            Create a world, choose its starting structures, and keep every campaign resource together.
          </p>
        </div>
      </header>

      <div aria-live="polite">
        {formError && <p className="status-error" role="alert">{formError}</p>}
        {message && <p className="status-success">{message}</p>}
      </div>

      <section className="section-card space-y-4">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
          World basics
        </h2>
        <p className="text-xs text-slate-500">
          Review the optional character, NPC, item, ability, and custom-entity structures before creation.
        </p>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end" onSubmit={handleOpenReview}>
          <div>
            <label htmlFor="new-world-name" className="block text-xs font-semibold text-slate-400 mb-1">
              World name <span aria-hidden="true">*</span>
            </label>
            <input
              id="new-world-name"
              className="input-field"
              placeholder="The Shattered Coast"
              value={newName}
              maxLength={120}
              required
              onChange={(event) => {
                setNewName(event.target.value);
                setFormError(null);
              }}
            />
          </div>
          <div>
            <label htmlFor="new-world-system" className="block text-xs font-semibold text-slate-400 mb-1">Game system</label>
            <input
              id="new-world-system"
              className="input-field"
              placeholder="Custom, D&D 5e, Pathfinder…"
              value={gameSystem}
              maxLength={120}
              onChange={(event) => setGameSystem(event.target.value)}
            />
          </div>
          <button type="submit" disabled={!newName.trim() || creating} className="primary-button">
            Review setup
          </button>
        </form>
      </section>

      <section className="section-card space-y-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Existing worlds
        </h2>
        {loading && <p className="text-sm text-slate-400" role="status">Loading worlds…</p>}
        {!loading && loadError && (
          <div className="space-y-2">
            <p className="status-error" role="alert">{loadError}</p>
            <button type="button" className="secondary-button text-xs" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
          </div>
        )}
        {!loading && !loadError && worlds.length === 0 && (
          <p className="text-sm text-slate-500">No worlds yet. Create one above.</p>
        )}
        <ul className="space-y-2">
          {worlds.map((world) => (
            <li
              key={world.id}
              className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 hover:border-sky-500/60"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-100">{world.name}</p>
                <p className="text-xs text-slate-500">
                  {world.game_system || "System not specified"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link
                  to={`/world/${world.id}/overview`}
                  className="text-xs rounded bg-slate-800 px-3 py-2 hover:bg-slate-700"
                >
                  Open
                </Link>
                <button
                  type="button"
                  className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                  onClick={() => handleDeleteWorld(world)}
                  disabled={Boolean(deletingWorldId || creating)}
                  aria-label={`Delete ${world.name}`}
                >
                  {deletingWorldId === world.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {reviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-3 py-6 sm:items-center"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) handleCloseReview();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="world-review-title"
            aria-describedby="world-review-description"
            tabIndex={-1}
            className="w-full max-w-5xl rounded-lg border border-slate-800 bg-slate-950 shadow-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6 outline-none"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 id="world-review-title" className="text-lg font-semibold text-slate-100">
                  Confirm templates for {newName || "New World"}
                </h2>
                <p id="world-review-description" className="text-sm text-slate-400">
                  Review the starting structure. Optional template groups can be removed entirely.
                </p>
              </div>
              <button
                type="button"
                className="text-xs px-3 py-1 rounded bg-slate-800 hover:bg-slate-700"
                onClick={handleCloseReview}
                disabled={creating}
              >
                Close
              </button>
            </div>

            {reviewError && <p className="status-error" role="alert" aria-live="assertive">{reviewError}</p>}

            <section className="space-y-3">
              <header>
                <h3 className="text-sm font-semibold text-slate-200">
                  Character template (shared by all PCs)
                </h3>
                <p className="text-xs text-slate-500">
                  Include stats, resources, actions, slots, or references to custom entities.
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
                        aria-label="Character feature label"
                        value={feature.label}
                        maxLength={80}
                        onChange={(e) => handleFeatureLabelChange(feature.id, e.target.value)}
                      />
                      <select
                        className="w-full sm:w-48 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                        aria-label={`${feature.label || "Character feature"} type`}
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
                          aria-label={`${feature.label || "Character feature"} minimum`}
                          value={feature.min ?? ""}
                          onChange={(e) => handleFeatureRangeChange(feature.id, "min", e.target.value)}
                        />
                        <input
                          type="number"
                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          placeholder="Max"
                          aria-label={`${feature.label || "Character feature"} maximum`}
                          value={feature.max ?? ""}
                          onChange={(e) => handleFeatureRangeChange(feature.id, "max", e.target.value)}
                        />
                      </div>
                    )}

                    {feature.type === "custom_entity" && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          aria-label={`${feature.label || "Character feature"} custom entity`}
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
                        <p className="text-xs text-slate-500 sm:w-48">Choose which custom structure this field references.</p>
                      </div>
                    )}

                    <div className="text-right">
                      <button
                        type="button"
                        className="text-xs text-red-300"
                        onClick={() => removeCharacterFeature(feature.id)}
                      >
                        Remove feature
                      </button>
                    </div>
                  </div>
                ))}
                <button type="button" className="text-xs text-sky-300" onClick={addCharacterFeature}>
                  + Add feature
                </button>
              </div>
            </section>
            <section className="space-y-3">
              <header>
                <h3 className="text-sm font-semibold text-slate-200">NPC templates</h3>
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
                        aria-label="NPC template name"
                        value={npc.name}
                        maxLength={120}
                        onChange={(e) => updateNpcTemplate(npc.id, { name: e.target.value })}
                      />
                      <input
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                        placeholder="Role / label"
                        aria-label={`${npc.name || "NPC template"} role`}
                        value={npc.role}
                        maxLength={300}
                        onChange={(e) => updateNpcTemplate(npc.id, { role: e.target.value })}
                      />
                    </div>
                    <textarea
                      className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      rows={3}
                      placeholder="Notes, stat blocks, quirks..."
                      aria-label={`${npc.name || "NPC template"} notes`}
                      value={npc.notes}
                      maxLength={5000}
                      onChange={(e) => updateNpcTemplate(npc.id, { notes: e.target.value })}
                    />
                    <div className="text-right">
                      <button
                        type="button"
                        className="text-xs text-red-300"
                        onClick={() => removeNpcTemplate(npc.id)}
                      >
                        Remove NPC
                      </button>
                    </div>
                  </div>
                ))}
                <button type="button" className="text-xs text-sky-300" onClick={addNpcTemplate}>
                  + Add NPC template
                </button>
              </div>
            </section>
            <section className="space-y-3">
              <header>
                <h3 className="text-sm font-semibold text-slate-200">Item templates</h3>
                <p className="text-xs text-slate-500">
                  Define reusable item blueprints and the fields each blueprint contains.
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
                      aria-label="Item template name"
                      value={template.name}
                      maxLength={120}
                      onChange={(e) =>
                        handleFieldTemplateNameChange("item", template.id, e.target.value)
                      }
                    />
                    <button
                      type="button"
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
                          aria-label={`${template.name || "Item template"} field label`}
                          value={field.label}
                          maxLength={80}
                          onChange={(e) =>
                            handleFieldChange("item", template.id, field.id, { label: e.target.value })
                          }
                        />
                        <select
                          className="w-full sm:w-40 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          value={field.inputType}
                          aria-label={`${field.label || "Item field"} input type`}
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
                          type="button"
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
                    type="button"
                    className="text-xs text-sky-300"
                    onClick={() => handleAddField("item", template.id)}
                  >
                    + Field
                  </button>
                </div>
              ))}
              <button type="button" className="text-xs text-sky-300" onClick={() => addFieldTemplate("item")}>
                + Add item template
              </button>
            </section>

            <section className="space-y-3">
              <header>
                <h3 className="text-sm font-semibold text-slate-200">Ability templates</h3>
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
                      aria-label="Ability template name"
                      value={template.name}
                      maxLength={120}
                      onChange={(e) =>
                        handleFieldTemplateNameChange("ability", template.id, e.target.value)
                      }
                    />
                    <button
                      type="button"
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
                          aria-label={`${template.name || "Ability template"} field label`}
                          value={field.label}
                          maxLength={80}
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
                          aria-label={`${field.label || "Ability field"} input type`}
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
                          type="button"
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
                    type="button"
                    className="text-xs text-sky-300"
                    onClick={() => handleAddField("ability", template.id)}
                  >
                    + Field
                  </button>
                </div>
              ))}
              <button type="button" className="text-xs text-sky-300" onClick={() => addFieldTemplate("ability")}>
                + Add ability template
              </button>
            </section>
            <section className="space-y-3">
              <header>
                <h3 className="text-sm font-semibold text-slate-200">Custom entity templates</h3>
                <p className="text-xs text-slate-500">
                  Model setting-specific structures such as factions, elements, or schools.
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
                      aria-label="Custom entity template name"
                      value={entity.name}
                      maxLength={120}
                      onChange={(e) =>
                        handleFieldTemplateNameChange("customEntities", entity.id, e.target.value)
                      }
                    />
                    <button
                      type="button"
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
                          aria-label={`${entity.name || "Custom entity"} field label`}
                          value={field.label}
                          maxLength={80}
                          onChange={(e) =>
                            handleFieldChange("customEntities", entity.id, field.id, {
                              label: e.target.value,
                            })
                          }
                        />
                        <select
                          className="w-full sm:w-40 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          value={field.inputType}
                          aria-label={`${field.label || "Custom entity field"} input type`}
                          onChange={(event) =>
                            handleFieldChange("customEntities", entity.id, field.id, {
                              inputType: event.target.value as TemplateFieldInput,
                            })
                          }
                        >
                          {FIELD_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
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
                    type="button"
                    className="text-xs text-sky-300"
                    onClick={() => handleAddField("customEntities", entity.id)}
                  >
                    + Descriptor field
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-xs text-sky-300"
                onClick={() => addFieldTemplate("customEntities")}
              >
                + Add custom entity template
              </button>
            </section>

            <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
              <button type="button" className="secondary-button" onClick={handleCloseReview} disabled={creating}>
                Back
              </button>
              <button type="button" className="primary-button" onClick={handleConfirmCreate} disabled={creating}>
                {creating ? "Creating…" : "Create world"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
