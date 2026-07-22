import {
  FEATURE_OPTIONS,
  FIELD_TYPE_OPTIONS,
  MAX_CHARACTER_FEATURES,
  MAX_FIELDS_PER_TEMPLATE,
  MAX_TEMPLATES_PER_SECTION,
  SETUP_SECTIONS,
  buildDefaultFields,
  getSectionCount,
  type CharacterFeatureType,
  type FieldTemplateGroup,
  type NpcTemplate,
  type SetupValidationIssue,
  type TemplateField,
  type TemplateFieldInput,
  type WorldSetupSection,
  type WorldSetupTemplates,
} from "../state/worldSetup";

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

type SetupUpdater = (current: WorldSetupTemplates) => WorldSetupTemplates;

type WorldSetupEditorProps = {
  templates: WorldSetupTemplates;
  activeSection: WorldSetupSection;
  onSectionChange: (section: WorldSetupSection) => void;
  onChange: (updater: SetupUpdater) => void;
  issue: SetupValidationIssue | null;
  errorMessageId: string;
};

const fieldAnchorId = (id: string) => `setup-field-${id}`;

function AddIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RemoveButton({
  label,
  onClick,
  disabled = false,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-red-200 transition hover:bg-red-950/50 hover:text-red-100"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {label}
    </button>
  );
}

function FieldTypeSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: TemplateFieldInput;
  onChange: (value: TemplateFieldInput) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-300">
        Field type
      </label>
      <select
        id={id}
        className="input-field"
        value={value}
        onChange={(event) => onChange(event.target.value as TemplateFieldInput)}
      >
        {FIELD_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CharacterEditor({
  templates,
  onChange,
  issue,
  errorMessageId,
}: Pick<WorldSetupEditorProps, "templates" | "onChange" | "issue" | "errorMessageId">) {
  const updateFeature = (
    featureId: string,
    patch: Partial<WorldSetupTemplates["character"][number]>
  ) => {
    onChange((current) => ({
      ...current,
      character: current.character.map((feature) =>
        feature.id === featureId ? { ...feature, ...patch } : feature
      ),
    }));
  };

  const updateFeatureType = (featureId: string, type: CharacterFeatureType) => {
    onChange((current) => {
      const fallbackEntityId = current.customEntities[0]?.id;
      return {
        ...current,
        character: current.character.map((feature) => {
          if (feature.id !== featureId) return feature;
          const usesRange = type === "number_stat" || type === "number_resource";
          return {
            ...feature,
            type,
            min: usesRange ? feature.min ?? 0 : undefined,
            max: usesRange ? feature.max ?? 10 : undefined,
            entityId:
              type === "custom_entity" ? feature.entityId ?? fallbackEntityId : undefined,
          };
        }),
      };
    });
  };

  const addFeature = () => {
    onChange((current) => ({
      ...current,
      character: [
        ...current.character,
        {
          id: makeId(),
          label: `Field ${current.character.length + 1}`,
          type: "text",
        },
      ],
    }));
  };

  const removeFeature = (featureId: string) => {
    onChange((current) => ({
      ...current,
      character: current.character.filter((feature) => feature.id !== featureId),
    }));
  };

  return (
    <div className="space-y-4">
      {templates.character.length === 0 && (
        <div className="rounded-xl border border-dashed border-grove-600 bg-grove-900/30 p-5 text-sm leading-6 text-slate-300">
          New characters will start with a blank sheet. Add a field if you want a shared structure.
        </div>
      )}
      {templates.character.map((feature, index) => {
        const labelId = `character-label-${feature.id}`;
        const typeId = `character-type-${feature.id}`;
        const usesRange = feature.type === "number_stat" || feature.type === "number_resource";
        const invalid = issue?.fieldId === feature.id;
        return (
          <article
            key={feature.id}
            id={fieldAnchorId(feature.id)}
            className="setup-editor-card"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-earth-sand">Character field {index + 1}</p>
              <RemoveButton label="Remove field" onClick={() => removeFeature(feature.id)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={labelId} className="mb-1.5 block text-sm font-medium text-slate-300">
                  Field label
                </label>
                <input
                  id={labelId}
                  className="input-field"
                  value={feature.label}
                  maxLength={80}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errorMessageId : undefined}
                  onChange={(event) => updateFeature(feature.id, { label: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor={typeId} className="mb-1.5 block text-sm font-medium text-slate-300">
                  Field type
                </label>
                <select
                  id={typeId}
                  className="input-field"
                  value={feature.type}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errorMessageId : undefined}
                  onChange={(event) =>
                    updateFeatureType(feature.id, event.target.value as CharacterFeatureType)
                  }
                >
                  {FEATURE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {usesRange && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`character-min-${feature.id}`}
                    className="mb-1.5 block text-sm font-medium text-slate-300"
                  >
                    Minimum
                  </label>
                  <input
                    id={`character-min-${feature.id}`}
                    type="number"
                    className="input-field"
                    value={feature.min ?? ""}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? errorMessageId : undefined}
                    onChange={(event) => {
                      const value = event.target.value;
                      const parsed = value === "" ? undefined : Number(value);
                      updateFeature(feature.id, {
                        min: typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined,
                      });
                    }}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`character-max-${feature.id}`}
                    className="mb-1.5 block text-sm font-medium text-slate-300"
                  >
                    Maximum
                  </label>
                  <input
                    id={`character-max-${feature.id}`}
                    type="number"
                    className="input-field"
                    value={feature.max ?? ""}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? errorMessageId : undefined}
                    onChange={(event) => {
                      const value = event.target.value;
                      const parsed = value === "" ? undefined : Number(value);
                      updateFeature(feature.id, {
                        max: typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined,
                      });
                    }}
                  />
                </div>
              </div>
            )}

            {feature.type === "custom_entity" && (
              <div>
                <label
                  htmlFor={`character-entity-${feature.id}`}
                  className="mb-1.5 block text-sm font-medium text-slate-300"
                >
                  Referenced entity type
                </label>
                <select
                  id={`character-entity-${feature.id}`}
                  className="input-field"
                  value={feature.entityId ?? ""}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errorMessageId : undefined}
                  onChange={(event) => updateFeature(feature.id, { entityId: event.target.value })}
                >
                  <option value="">Choose an entity type</option>
                  {templates.customEntities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name || "Unnamed custom entity"}
                    </option>
                  ))}
                </select>
                {templates.customEntities.length === 0 && (
                  <p className="mt-2 text-sm text-amber-200">
                    Add a custom entity template before using this field type.
                  </p>
                )}
              </div>
            )}
          </article>
        );
      })}
      <button
        type="button"
        className="secondary-button min-h-11"
        onClick={addFeature}
        disabled={templates.character.length >= MAX_CHARACTER_FEATURES}
        title={
          templates.character.length >= MAX_CHARACTER_FEATURES
            ? `Character sheets are limited to ${MAX_CHARACTER_FEATURES} fields.`
            : undefined
        }
      >
        <AddIcon />
        <span className="ml-2">
          {templates.character.length >= MAX_CHARACTER_FEATURES
            ? "Character field limit reached"
            : "Add character field"}
        </span>
      </button>
    </div>
  );
}

function NpcEditor({
  templates,
  onChange,
  issue,
  errorMessageId,
}: Pick<WorldSetupEditorProps, "templates" | "onChange" | "issue" | "errorMessageId">) {
  const updateNpc = (id: string, patch: Partial<NpcTemplate>) => {
    onChange((current) => ({
      ...current,
      npc: current.npc.map((npc) => (npc.id === id ? { ...npc, ...patch } : npc)),
    }));
  };

  const addNpc = () => {
    onChange((current) => ({
      ...current,
      npc: [
        ...current.npc,
        { id: makeId(), name: `NPC ${current.npc.length + 1}`, role: "", notes: "" },
      ],
    }));
  };

  const removeNpc = (id: string) => {
    onChange((current) => ({
      ...current,
      npc: current.npc.filter((npc) => npc.id !== id),
    }));
  };

  return (
    <div className="space-y-4">
      {templates.npc.length === 0 && (
        <div className="rounded-xl border border-dashed border-grove-600 bg-grove-900/30 p-5 text-sm leading-6 text-slate-300">
          No NPC templates will be included in this world's starting structure.
        </div>
      )}
      {templates.npc.map((npc, index) => (
        <article key={npc.id} id={fieldAnchorId(npc.id)} className="setup-editor-card">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-earth-sand">NPC template {index + 1}</p>
            <RemoveButton label="Remove NPC" onClick={() => removeNpc(npc.id)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`npc-name-${npc.id}`} className="mb-1.5 block text-sm font-medium text-slate-300">
                Template name
              </label>
              <input
                id={`npc-name-${npc.id}`}
                className="input-field"
                value={npc.name}
                maxLength={200}
                aria-invalid={issue?.fieldId === npc.id || undefined}
                aria-describedby={issue?.fieldId === npc.id ? errorMessageId : undefined}
                onChange={(event) => updateNpc(npc.id, { name: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`npc-role-${npc.id}`} className="mb-1.5 block text-sm font-medium text-slate-300">
                Role or label
              </label>
              <input
                id={`npc-role-${npc.id}`}
                className="input-field"
                value={npc.role}
                maxLength={300}
                aria-invalid={issue?.fieldId === npc.id || undefined}
                aria-describedby={issue?.fieldId === npc.id ? errorMessageId : undefined}
                onChange={(event) => updateNpc(npc.id, { role: event.target.value })}
              />
            </div>
          </div>
          <div>
            <label htmlFor={`npc-notes-${npc.id}`} className="mb-1.5 block text-sm font-medium text-slate-300">
              Starting notes
            </label>
            <textarea
              id={`npc-notes-${npc.id}`}
              className="input-field min-h-24 resize-y"
              value={npc.notes}
              maxLength={5_000}
              aria-invalid={issue?.fieldId === npc.id || undefined}
              aria-describedby={issue?.fieldId === npc.id ? errorMessageId : undefined}
              onChange={(event) => updateNpc(npc.id, { notes: event.target.value })}
            />
          </div>
        </article>
      ))}
      <button
        type="button"
        className="secondary-button min-h-11"
        onClick={addNpc}
        disabled={templates.npc.length >= MAX_TEMPLATES_PER_SECTION}
        title={
          templates.npc.length >= MAX_TEMPLATES_PER_SECTION
            ? `NPC templates are limited to ${MAX_TEMPLATES_PER_SECTION}.`
            : undefined
        }
      >
        <AddIcon />
        <span className="ml-2">
          {templates.npc.length >= MAX_TEMPLATES_PER_SECTION
            ? "NPC template limit reached"
            : "Add NPC template"}
        </span>
      </button>
    </div>
  );
}

const GROUP_COPY: Record<
  FieldTemplateGroup,
  { singular: string; empty: string; field: string }
> = {
  item: {
    singular: "item template",
    empty: "No item blueprints will be included in this world's starting structure.",
    field: "item field",
  },
  ability: {
    singular: "ability template",
    empty: "No ability blueprints will be included in this world's starting structure.",
    field: "ability field",
  },
  customEntities: {
    singular: "custom entity template",
    empty: "No custom record types will be included in this world's starting structure.",
    field: "descriptor field",
  },
};

function CollectionEditor({
  group,
  templates,
  onChange,
  issue,
  errorMessageId,
}: Pick<WorldSetupEditorProps, "templates" | "onChange" | "issue" | "errorMessageId"> & {
  group: FieldTemplateGroup;
}) {
  const copy = GROUP_COPY[group];
  const collection = templates[group];

  const mutateCollection = (
    updater: (items: WorldSetupTemplates[FieldTemplateGroup]) => WorldSetupTemplates[FieldTemplateGroup]
  ) => {
    onChange((current) => ({ ...current, [group]: updater(current[group]) }));
  };

  const addTemplate = () => {
    const defaultNames: Record<FieldTemplateGroup, string> = {
      item: "Item Template",
      ability: "Ability Template",
      customEntities: "Custom Entity",
    };
    mutateCollection((items) => [
      ...items,
      {
        id: makeId(),
        name: `${defaultNames[group]} ${items.length + 1}`,
        fields: buildDefaultFields(group),
      },
    ]);
  };

  const updateTemplateName = (templateId: string, name: string) => {
    mutateCollection((items) =>
      items.map((template) => (template.id === templateId ? { ...template, name } : template))
    );
  };

  const updateField = (templateId: string, fieldId: string, patch: Partial<TemplateField>) => {
    mutateCollection((items) =>
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

  const addField = (templateId: string) => {
    mutateCollection((items) =>
      items.map((template) =>
        template.id === templateId
          ? {
              ...template,
              fields: [
                ...template.fields,
                {
                  id: makeId(),
                  label: `Field ${template.fields.length + 1}`,
                  inputType: "text" as const,
                },
              ],
            }
          : template
      )
    );
  };

  const removeField = (templateId: string, fieldId: string) => {
    mutateCollection((items) =>
      items.map((template) =>
        template.id === templateId
          ? { ...template, fields: template.fields.filter((field) => field.id !== fieldId) }
          : template
      )
    );
  };

  const removeTemplate = (templateId: string) => {
    mutateCollection((items) => items.filter((template) => template.id !== templateId));
  };

  return (
    <div className="space-y-4">
      {collection.length === 0 && (
        <div className="rounded-xl border border-dashed border-grove-600 bg-grove-900/30 p-5 text-sm leading-6 text-slate-300">
          {copy.empty}
        </div>
      )}
      {collection.map((template, templateIndex) => {
        const referenced =
          group === "customEntities" &&
          templates.character.some(
            (feature) => feature.type === "custom_entity" && feature.entityId === template.id
          );
        return (
          <article key={template.id} id={fieldAnchorId(template.id)} className="setup-editor-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`${group}-name-${template.id}`}
                  className="mb-1.5 block text-sm font-medium text-slate-300"
                >
                  Template {templateIndex + 1} name
                </label>
                <input
                  id={`${group}-name-${template.id}`}
                  className="input-field"
                  value={template.name}
                  maxLength={200}
                  aria-invalid={issue?.fieldId === template.id || undefined}
                  aria-describedby={issue?.fieldId === template.id ? errorMessageId : undefined}
                  onChange={(event) => updateTemplateName(template.id, event.target.value)}
                />
              </div>
              <RemoveButton
                label="Remove template"
                onClick={() => removeTemplate(template.id)}
                disabled={referenced}
                title={referenced ? "Remove its character-sheet reference first." : undefined}
              />
            </div>
            {referenced && (
              <p className="text-sm text-amber-200">
                This entity is referenced by a character field and cannot be removed yet.
              </p>
            )}

            <div className="space-y-3 border-t border-grove-700/70 pt-4">
              {template.fields.map((field, fieldIndex) => (
                <div
                  key={field.id}
                  id={fieldAnchorId(field.id)}
                  className="grid gap-3 rounded-xl bg-grove-900/35 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end"
                >
                  <div>
                    <label
                      htmlFor={`${group}-field-${field.id}`}
                      className="mb-1.5 block text-sm font-medium text-slate-300"
                    >
                      {copy.field.charAt(0).toUpperCase() + copy.field.slice(1)} {fieldIndex + 1}
                    </label>
                    <input
                      id={`${group}-field-${field.id}`}
                      className="input-field"
                      value={field.label}
                      maxLength={80}
                      aria-invalid={issue?.fieldId === field.id || undefined}
                      aria-describedby={issue?.fieldId === field.id ? errorMessageId : undefined}
                      onChange={(event) =>
                        updateField(template.id, field.id, { label: event.target.value })
                      }
                    />
                  </div>
                  <FieldTypeSelect
                    id={`${group}-field-type-${field.id}`}
                    value={field.inputType}
                    onChange={(inputType) => updateField(template.id, field.id, { inputType })}
                  />
                  <RemoveButton
                    label="Remove field"
                    onClick={() => removeField(template.id, field.id)}
                    disabled={template.fields.length === 1}
                    title={
                      template.fields.length === 1
                        ? "A template needs at least one field."
                        : undefined
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                className="secondary-button min-h-11"
                onClick={() => addField(template.id)}
                disabled={template.fields.length >= MAX_FIELDS_PER_TEMPLATE}
                title={
                  template.fields.length >= MAX_FIELDS_PER_TEMPLATE
                    ? `Templates are limited to ${MAX_FIELDS_PER_TEMPLATE} fields.`
                    : undefined
                }
              >
                <AddIcon />
                <span className="ml-2">
                  {template.fields.length >= MAX_FIELDS_PER_TEMPLATE
                    ? "Field limit reached"
                    : "Add field"}
                </span>
              </button>
            </div>
          </article>
        );
      })}
      <button
        type="button"
        className="secondary-button min-h-11"
        onClick={addTemplate}
        disabled={collection.length >= MAX_TEMPLATES_PER_SECTION}
        title={
          collection.length >= MAX_TEMPLATES_PER_SECTION
            ? `This section is limited to ${MAX_TEMPLATES_PER_SECTION} templates.`
            : undefined
        }
      >
        <AddIcon />
        <span className="ml-2">
          {collection.length >= MAX_TEMPLATES_PER_SECTION
            ? "Template limit reached"
            : `Add ${copy.singular}`}
        </span>
      </button>
    </div>
  );
}

export function WorldSetupEditor({
  templates,
  activeSection,
  onSectionChange,
  onChange,
  issue,
  errorMessageId,
}: WorldSetupEditorProps) {
  const activeMeta = SETUP_SECTIONS.find((section) => section.id === activeSection)!;

  return (
    <div className="grid min-h-0 gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav
        aria-label="World setup sections"
        className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0"
      >
        {SETUP_SECTIONS.map((section) => {
          const active = section.id === activeSection;
          return (
            <button
              key={section.id}
              id={`setup-tab-${section.id}`}
              type="button"
              aria-pressed={active}
              className={`flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm font-medium transition lg:w-full ${
                active
                  ? "border-brand/60 bg-brand/15 text-brand-glow"
                  : "border-transparent text-slate-300 hover:border-grove-600 hover:bg-grove-800/60 hover:text-white"
              }`}
              onClick={() => onSectionChange(section.id)}
            >
              <span>{section.shortLabel}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  active ? "bg-brand/20 text-emerald-100" : "bg-grove-700 text-slate-300"
                }`}
              >
                {getSectionCount(templates, section.id)}
              </span>
            </button>
          );
        })}
      </nav>

      <section
        id={`setup-panel-${activeSection}`}
        aria-labelledby={`setup-heading-${activeSection}`}
        className="min-w-0 outline-none"
      >
        <header className="mb-4 border-b border-grove-700/70 pb-4">
          <h3
            id={`setup-heading-${activeSection}`}
            className="font-display text-xl font-semibold text-brand-glow"
          >
            {activeMeta.label}
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">{activeMeta.description}</p>
        </header>
        {activeSection === "character" && (
          <CharacterEditor
            templates={templates}
            onChange={onChange}
            issue={issue}
            errorMessageId={errorMessageId}
          />
        )}
        {activeSection === "npc" && (
          <NpcEditor
            templates={templates}
            onChange={onChange}
            issue={issue}
            errorMessageId={errorMessageId}
          />
        )}
        {(activeSection === "item" ||
          activeSection === "ability" ||
          activeSection === "customEntities") && (
          <CollectionEditor
            group={activeSection}
            templates={templates}
            onChange={onChange}
            issue={issue}
            errorMessageId={errorMessageId}
          />
        )}
      </section>
    </div>
  );
}
