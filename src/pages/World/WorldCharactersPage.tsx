import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useBlocker, useParams } from "react-router-dom";
import {
  createCharacter,
  deleteCharacter,
  listCharacters,
  updateCharacter,
  type Character,
} from "../../api/characters";
import { getErrorMessage } from "../../api/client";
import { listWorldTemplates } from "../../api/templates";

type CharacterFeatureType =
  | "number_stat"
  | "number_resource"
  | "text"
  | "action"
  | "item_slot"
  | "ability_slot"
  | "custom_entity";

type CharacterFeature = {
  id: string;
  label: string;
  type: CharacterFeatureType;
  min?: number;
  max?: number;
};

type CharacterTemplate = {
  name: string;
  features: CharacterFeature[];
};

type CharacterAttributes = Record<string, string | number | boolean>;

const FEATURE_LABELS: Record<CharacterFeatureType, string> = {
  number_stat: "Stat",
  number_resource: "Resource",
  text: "Text",
  action: "Action",
  item_slot: "Item slot",
  ability_slot: "Ability slot",
  custom_entity: "Custom reference",
};

const isFeatureType = (value: unknown): value is CharacterFeatureType =>
  typeof value === "string" && value in FEATURE_LABELS;

const parseTemplate = (name: string, rawDefinition: string): CharacterTemplate => {
  const parsed: unknown = JSON.parse(rawDefinition || "{}");
  if (!parsed || typeof parsed !== "object" || !("features" in parsed)) {
    return { name, features: [] };
  }

  const rawFeatures = (parsed as { features?: unknown }).features;
  if (!Array.isArray(rawFeatures)) return { name, features: [] };

  const features = rawFeatures.flatMap((candidate, index): CharacterFeature[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const feature = candidate as Record<string, unknown>;
    if (typeof feature.label !== "string" || !feature.label.trim() || !isFeatureType(feature.type)) {
      return [];
    }
    const min = typeof feature.min === "number" && Number.isFinite(feature.min) ? feature.min : undefined;
    const max = typeof feature.max === "number" && Number.isFinite(feature.max) ? feature.max : undefined;
    return [
      {
        id: typeof feature.id === "string" && feature.id ? feature.id : `feature-${index}`,
        label: feature.label.trim(),
        type: feature.type,
        min,
        max,
      },
    ];
  });

  return { name, features };
};

const parseAttributes = (raw: string): { attributes: CharacterAttributes; invalid: boolean } => {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { attributes: {}, invalid: true };
    }

    const attributes: CharacterAttributes = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === "string" || typeof entry === "boolean") attributes[key] = entry;
      if (typeof entry === "number" && Number.isFinite(entry)) attributes[key] = entry;
    });
    return { attributes, invalid: false };
  } catch {
    return { attributes: {}, invalid: true };
  }
};

const formatFeatureType = (feature: CharacterFeature) => {
  const range =
    typeof feature.min === "number" && typeof feature.max === "number"
      ? ` · ${feature.min}–${feature.max}`
      : "";
  return `${FEATURE_LABELS[feature.type]}${range}`;
};

const attributesEqual = (left: CharacterAttributes, right: CharacterAttributes) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => Object.is(left[key], right[key]));
};

const formatAttributeValue = (value: CharacterAttributes[string]) => {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

export function WorldCharactersPage() {
  const { worldId } = useParams();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(Boolean(worldId));
  const [charactersLoadFailed, setCharactersLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [charactersError, setCharactersError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [template, setTemplate] = useState<CharacterTemplate | null>(null);
  const [templateLoading, setTemplateLoading] = useState(Boolean(worldId));
  const [charactersReloadKey, setCharactersReloadKey] = useState(0);
  const [templateReloadKey, setTemplateReloadKey] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAttributes, setEditAttributes] = useState<CharacterAttributes>({});
  const [invalidStoredAttributes, setInvalidStoredAttributes] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setEditingId(null);
    setEditName("");
    setEditNotes("");
    setEditAttributes({});
    setInvalidStoredAttributes(false);
    if (!worldId) {
      setCharacters([]);
      setLoading(false);
      setCharactersLoadFailed(true);
      setCharactersError("This page needs a valid world.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setCharactersLoadFailed(false);
    setCharactersError(null);
    listCharacters(worldId)
      .then((loadedCharacters) => {
        if (!cancelled) setCharacters(loadedCharacters);
      })
      .catch((error) => {
        if (!cancelled) {
          setCharactersLoadFailed(true);
          setCharactersError(getErrorMessage(error, "We couldn't load the character roster."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [charactersReloadKey, worldId]);

  useEffect(() => {
    if (!worldId) {
      setTemplate(null);
      setTemplateLoading(false);
      return;
    }

    let cancelled = false;
    setTemplateLoading(true);
    setTemplateError(null);
    listWorldTemplates(worldId, "character")
      .then((templates) => {
        if (cancelled) return;
        if (templates.length === 0) {
          setTemplate(null);
          return;
        }
        try {
          setTemplate(parseTemplate(templates[0].name, templates[0].definition_json));
        } catch {
          setTemplate(null);
          setTemplateError("The saved character template is invalid and cannot be rendered.");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTemplate(null);
          setTemplateError(getErrorMessage(error, "We couldn't load the character template."));
        }
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [templateReloadKey, worldId]);

  const editingCharacter = useMemo(
    () => characters.find((character) => character.id === editingId) ?? null,
    [characters, editingId]
  );
  const editDirty = useMemo(() => {
    if (!editingCharacter) return false;
    const original = parseAttributes(editingCharacter.attributes_json).attributes;
    return (
      editName !== editingCharacter.name ||
      editNotes !== editingCharacter.notes ||
      !attributesEqual(editAttributes, original)
    );
  }, [editAttributes, editName, editNotes, editingCharacter]);

  const blocker = useBlocker(editDirty && !savingId);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("Discard the unsaved character-sheet changes and leave this page?")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!worldId || creating || loading) return;
    const name = newName.trim();
    if (!name) {
      setCharactersError("Character name is required.");
      return;
    }

    setCreating(true);
    setCharactersError(null);
    setMessage(null);
    try {
      const character = await createCharacter(worldId, name);
      setCharacters((current) => [...current, character]);
      setNewName("");
      startEditing(character);
      setMessage(`${character.name} was added to the roster.`);
    } catch (error) {
      setCharactersError(getErrorMessage(error, "We couldn't create that character."));
    } finally {
      setCreating(false);
    }
  };

  const startEditing = (character: Character) => {
    if (editingId && editingId !== character.id && editDirty) {
      if (!window.confirm("Discard the unsaved changes to the current character sheet?")) return;
    }
    const parsed = parseAttributes(character.attributes_json);
    setEditingId(character.id);
    setEditName(character.name);
    setEditNotes(character.notes);
    setEditAttributes(parsed.attributes);
    setInvalidStoredAttributes(parsed.invalid);
    setCharactersError(null);
    setMessage(null);
  };

  const resetEditor = () => {
    setEditingId(null);
    setEditName("");
    setEditNotes("");
    setEditAttributes({});
    setInvalidStoredAttributes(false);
  };

  const cancelEditing = () => {
    if (!editDirty || window.confirm("Discard your unsaved character-sheet changes?")) resetEditor();
  };

  const setAttribute = (featureId: string, value: string | number | boolean | undefined) => {
    setEditAttributes((current) => {
      const next = { ...current };
      if (value === undefined || value === "") delete next[featureId];
      else next[featureId] = value;
      return next;
    });
  };

  const handleUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingCharacter || savingId) return;
    const name = editName.trim();
    if (!name) {
      setCharactersError("Character name is required.");
      return;
    }

    setSavingId(editingCharacter.id);
    setCharactersError(null);
    setMessage(null);
    try {
      const updated = await updateCharacter(
        editingCharacter.id,
        name,
        editNotes.trim(),
        JSON.stringify(editAttributes)
      );
      setCharacters((current) =>
        current.map((character) => (character.id === updated.id ? updated : character))
      );
      resetEditor();
      setMessage(`${updated.name}'s sheet was saved.`);
    } catch (error) {
      setCharactersError(getErrorMessage(error, "We couldn't save that character sheet."));
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (character: Character) => {
    if (deletingId || savingId) return;
    const confirmed = window.confirm(
      `Delete “${character.name}”? This permanently removes their notes and sheet data.`
    );
    if (!confirmed) return;

    setDeletingId(character.id);
    setCharactersError(null);
    setMessage(null);
    try {
      await deleteCharacter(character.id);
      setCharacters((current) => current.filter((item) => item.id !== character.id));
      if (editingId === character.id) resetEditor();
      setMessage(`${character.name} was deleted.`);
    } catch (error) {
      setCharactersError(getErrorMessage(error, "We couldn't delete that character."));
    } finally {
      setDeletingId(null);
    }
  };

  const renderFeatureInput = (feature: CharacterFeature) => {
    const inputId = `character-${editingId}-${feature.id}`;
    const value = editAttributes[feature.id];

    if (feature.type === "action") {
      return (
        <label
          key={feature.id}
          htmlFor={inputId}
          className="flex items-center justify-between gap-4 rounded border border-slate-800 px-3 py-2"
        >
          <span>
            <span className="block text-sm font-medium text-slate-200">{feature.label}</span>
            <span className="block text-[11px] text-slate-500">Action toggle</span>
          </span>
          <input
            id={inputId}
            type="checkbox"
            className="h-4 w-4 accent-emerald-500"
            checked={value === true}
            onChange={(event) => setAttribute(feature.id, event.target.checked)}
          />
        </label>
      );
    }

    if (feature.type === "number_stat" || feature.type === "number_resource") {
      return (
        <div key={feature.id}>
          <label htmlFor={inputId} className="block text-xs font-semibold text-slate-400 mb-1">
            {feature.label} <span className="font-normal text-slate-500">({formatFeatureType(feature)})</span>
          </label>
          <input
            id={inputId}
            className="input-field"
            type="number"
            min={feature.min}
            max={feature.max}
            value={typeof value === "number" ? value : ""}
            onChange={(event) => {
              const next = event.target.value;
              const numeric = next === "" ? undefined : Number(next);
              setAttribute(feature.id, typeof numeric === "number" && Number.isFinite(numeric) ? numeric : undefined);
            }}
          />
        </div>
      );
    }

    return (
      <div key={feature.id}>
        <label htmlFor={inputId} className="block text-xs font-semibold text-slate-400 mb-1">
          {feature.label} <span className="font-normal text-slate-500">({FEATURE_LABELS[feature.type]})</span>
        </label>
        <input
          id={inputId}
          className="input-field"
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(event) => setAttribute(feature.id, event.target.value)}
          maxLength={500}
        />
      </div>
    );
  };

  return (
    <div className="page-shell max-w-5xl">
      <header className="page-header">
        <div>
          <p className="section-label">Party roster</p>
          <h1 className="page-title mt-1">Player characters</h1>
          <p className="page-description mt-2">
            Create heroes and keep their world-specific sheet values and notes up to date.
          </p>
        </div>
      </header>

      <div aria-live="polite">
        {charactersError && <p className="status-error" role="alert">{charactersError}</p>}
        {message && <p className="status-success">{message}</p>}
      </div>

      <section className="section-card space-y-3" aria-labelledby="add-character-heading">
        <h3 id="add-character-heading" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Add character
        </h3>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleCreate}>
          <div className="flex-1">
            <label htmlFor="new-character-name" className="sr-only">Character name</label>
            <input
              id="new-character-name"
              className="input-field"
              placeholder="Character name"
              value={newName}
              maxLength={120}
              required
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={creating || loading || !worldId || !newName.trim()}
            className="primary-button"
          >
            {creating ? "Adding…" : "Add character"}
          </button>
        </form>
      </section>

      <section className="section-card space-y-3" aria-labelledby="character-template-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id="character-template-heading" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Character template
            </h3>
            <p className="mt-1 text-xs text-slate-500">This sheet structure is shared by every hero in the world.</p>
          </div>
          {templateError && (
            <button type="button" className="secondary-button text-xs" onClick={() => setTemplateReloadKey((key) => key + 1)}>
              Retry template
            </button>
          )}
        </div>
        {templateLoading ? (
          <p className="text-sm text-slate-500" role="status">Loading template…</p>
        ) : templateError ? (
          <p className="status-error" role="alert">{templateError}</p>
        ) : template ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-200">{template.name}</p>
            {template.features.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {template.features.map((feature) => (
                  <li key={feature.id} className="flex justify-between gap-3 rounded border border-slate-800 px-3 py-2 text-xs">
                    <span className="text-slate-300">{feature.label}</span>
                    <span className="text-slate-500">{formatFeatureType(feature)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">This template has no usable fields.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No character template is stored for this world. Names and notes can still be managed.</p>
        )}
      </section>

      <section className="section-card space-y-3" aria-labelledby="characters-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="characters-heading" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Characters
            </h3>
            {!loading && <p className="mt-1 text-xs text-slate-500">{characters.length} in this party</p>}
          </div>
          {charactersLoadFailed && worldId && (
            <button type="button" className="secondary-button text-xs" onClick={() => setCharactersReloadKey((key) => key + 1)}>
              Reload roster
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-slate-400" role="status">Loading characters…</p>
        ) : characters.length === 0 ? (
          <p className="text-sm text-slate-500">No characters yet. Add the first hero above.</p>
        ) : (
          <ul className="space-y-3">
            {characters.map((character) => {
              const isEditing = character.id === editingId;
              return (
                <li key={character.id} className="rounded border border-slate-800 p-4">
                  {isEditing ? (
                    <form className="space-y-4" onSubmit={handleUpdate}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor={`edit-name-${character.id}`} className="block text-xs font-semibold text-slate-400 mb-1">
                            Character name <span aria-hidden="true">*</span>
                          </label>
                          <input
                            id={`edit-name-${character.id}`}
                            className="input-field"
                            value={editName}
                            maxLength={120}
                            required
                            onChange={(event) => setEditName(event.target.value)}
                          />
                        </div>
                        <div>
                          <label htmlFor={`edit-notes-${character.id}`} className="block text-xs font-semibold text-slate-400 mb-1">
                            Notes
                          </label>
                          <textarea
                            id={`edit-notes-${character.id}`}
                            className="input-field"
                            rows={3}
                            value={editNotes}
                            maxLength={5000}
                            placeholder="Background, goals, conditions, table notes…"
                            onChange={(event) => setEditNotes(event.target.value)}
                          />
                        </div>
                      </div>

                      {invalidStoredAttributes && (
                        <p className="status-error" role="alert">
                          The previous sheet data was invalid. Saving will replace it with the values below.
                        </p>
                      )}

                      {template && template.features.length > 0 && (
                        <fieldset className="space-y-3">
                          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sheet values</legend>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {template.features.map(renderFeatureInput)}
                          </div>
                        </fieldset>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <button type="submit" className="primary-button" disabled={savingId === character.id || !editName.trim()}>
                          {savingId === character.id ? "Saving…" : "Save sheet"}
                        </button>
                        <button type="button" className="secondary-button" disabled={savingId === character.id} onClick={cancelEditing}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-100">{character.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Added {new Date(character.created_at * 1000).toLocaleDateString()}
                        </p>
                        {character.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{character.notes}</p>}
                        {template && (() => {
                          const attributes = parseAttributes(character.attributes_json).attributes;
                          const populated = template.features.filter((feature) => attributes[feature.id] !== undefined);
                          return populated.length > 0 ? (
                            <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                              {populated.map((feature) => (
                                <div key={feature.id} className="flex justify-between gap-3 border-b border-slate-800/60 py-1">
                                  <dt className="text-slate-500">{feature.label}</dt>
                                  <dd className="max-w-48 truncate text-slate-300">{formatAttributeValue(attributes[feature.id])}</dd>
                                </div>
                              ))}
                            </dl>
                          ) : null;
                        })()}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button type="button" className="secondary-button text-xs" onClick={() => startEditing(character)} disabled={Boolean(savingId || deletingId)}>
                          Edit sheet
                        </button>
                        <button
                          type="button"
                          className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                          onClick={() => handleDelete(character)}
                          disabled={Boolean(savingId || deletingId)}
                          aria-label={`Delete ${character.name}`}
                        >
                          {deletingId === character.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
