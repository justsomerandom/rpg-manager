import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useBlocker, useParams } from "react-router-dom";
import { getErrorMessage } from "../../api/client";
import {
  createWorldEntry,
  deleteWorldEntry,
  listWorldEntries,
  updateWorldEntry,
  WORLD_ENTRY_CATEGORIES,
  type WorldEntry,
  type WorldEntryCategory,
} from "../../api/worldEntries";
import { listWorldTemplates, type TemplateType, type WorldTemplate } from "../../api/templates";
import { useCloseGuard } from "../../hooks/useCloseGuard";

type JsonRecord = Record<string, unknown>;
type ParsedTemplate = WorldTemplate & {
  definition: JsonRecord;
  definitionValid: boolean;
};

type EntryFormState = {
  title: string;
  summary: string;
  body: string;
  tags: string;
  category: WorldEntryCategory;
};

type LegacyWikiEntry = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  templateType: TemplateType | "note";
  updatedAt: number;
};

const TEMPLATE_HEADINGS: Record<TemplateType, string> = {
  character: "Character sheet",
  npc: "NPC templates",
  item: "Item templates",
  ability: "Ability templates",
  custom_entity: "Custom entities",
};

const TEMPLATE_DESCRIPTIONS: Record<TemplateType, string> = {
  character: "The shared playable sheet defined for this world.",
  npc: "Reusable archetypes for people, creatures, and scene roles.",
  item: "Structured equipment and relic blueprints.",
  ability: "Abilities, spells, and combat-move blueprints.",
  custom_entity: "Bespoke structures such as factions, elements, or schools.",
};

const CATEGORY_INFO: Record<WorldEntryCategory, { label: string; description: string }> = {
  note: { label: "General note", description: "A flexible fact, person, event, or table reference." },
  magic_system: { label: "Magic system", description: "Rules, sources, costs, and limits of magic." },
  item_type: { label: "Item or relic", description: "Equipment families, materials, artifacts, and relics." },
  character_template: { label: "Character archetype", description: "Cultures, roles, ancestries, and character concepts." },
  faction: { label: "Faction", description: "Organizations, alliances, and political groups." },
  region: { label: "Region or place", description: "Continents, territories, landmarks, and settlements." },
};

const makeEmptyForm = (): EntryFormState => ({
  title: "",
  summary: "",
  body: "",
  tags: "",
  category: "note",
});

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

const readString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

const normalizeTags = (raw: string | string[]) => {
  const values = Array.isArray(raw) ? raw : raw.split(",");
  const seen = new Set<string>();
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const tag = value.trim().replace(/^#/, "");
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return [];
    seen.add(key);
    return [tag];
  });
};

const normalizeCategory = (value: unknown): WorldEntryCategory =>
  typeof value === "string" && (WORLD_ENTRY_CATEGORIES as readonly string[]).includes(value)
    ? (value as WorldEntryCategory)
    : "note";

const parseMetadata = (raw: string): JsonRecord => {
  try {
    return asRecord(JSON.parse(raw || "{}")) ?? {};
  } catch {
    return {};
  }
};

const getEntryTags = (entry: WorldEntry) => {
  const tags = parseMetadata(entry.metadata_json).tags;
  return Array.isArray(tags) ? normalizeTags(tags.filter((tag): tag is string => typeof tag === "string")) : [];
};

const serializeMetadata = (tags: string[], extra: JsonRecord = {}) => JSON.stringify({ ...extra, tags });

const parseTemplate = (template: WorldTemplate): ParsedTemplate => {
  try {
    const parsed = asRecord(JSON.parse(template.definition_json || "{}"));
    return { ...template, definition: parsed ?? {}, definitionValid: Boolean(parsed) };
  } catch {
    return { ...template, definition: {}, definitionValid: false };
  }
};

const parseLegacyEntries = (raw: string | null): LegacyWikiEntry[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.flatMap((candidate): LegacyWikiEntry[] => {
      const entry = asRecord(candidate);
      if (!entry || typeof entry.id !== "string" || typeof entry.title !== "string") return [];
      const id = entry.id.trim().slice(0, 128);
      if (!id) return [];
      const validTemplateTypes = ["character", "npc", "item", "ability", "custom_entity", "note"];
      const templateType = validTemplateTypes.includes(String(entry.templateType))
        ? (entry.templateType as TemplateType | "note")
        : "note";
      return [
        {
          id,
          title: entry.title.trim().slice(0, 180),
          summary: readString(entry.summary).trim().slice(0, 500),
          tags: Array.isArray(entry.tags)
            ? normalizeTags(entry.tags.filter((tag): tag is string => typeof tag === "string"))
                .slice(0, 32)
                .map((tag) => tag.slice(0, 64))
            : [],
          templateType,
          updatedAt: typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : Date.now(),
        },
      ];
    });
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  } catch {
    return [];
  }
};

const legacyCategory = (type: LegacyWikiEntry["templateType"]): WorldEntryCategory => {
  if (type === "character") return "character_template";
  if (type === "item") return "item_type";
  return "note";
};

const renderDefinitionRows = (template: ParsedTemplate): ReactNode => {
  if (!template.definitionValid) {
    return <p className="status-error">This template contains invalid JSON.</p>;
  }

  if (template.template_type === "npc") {
    return (
      <dl className="grid gap-1 text-xs text-slate-300">
        <div><dt className="inline text-slate-500">Role: </dt><dd className="inline">{readString(template.definition.role, "Not specified")}</dd></div>
        <div><dt className="inline text-slate-500">Notes: </dt><dd className="inline whitespace-pre-wrap">{readString(template.definition.notes, "None")}</dd></div>
      </dl>
    );
  }

  const key = template.template_type === "character" ? "features" : "fields";
  const rows = Array.isArray(template.definition[key]) ? template.definition[key] : [];
  if (rows.length === 0) return <p className="text-xs text-slate-500">No fields defined.</p>;

  return (
    <ul className="space-y-1 text-xs text-slate-300">
      {rows.map((row, index) => {
        const value = asRecord(row) ?? {};
        const label = readString(value.label, `Field ${index + 1}`);
        const type = readString(value.type || value.inputType, "text").replace(/_/g, " ");
        return (
          <li key={`${readString(value.id, `${template.id}-${index}`)}-${index}`} className="flex justify-between gap-3 border-b border-slate-800/70 py-1 last:border-0">
            <span>{label}</span>
            <span className="text-slate-500">{type}</span>
          </li>
        );
      })}
    </ul>
  );
};

export function WorldIndexPage() {
  const { worldId } = useParams();
  const editorRef = useRef<HTMLElement>(null);
  const [templates, setTemplates] = useState<ParsedTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(Boolean(worldId));
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateReloadKey, setTemplateReloadKey] = useState(0);

  const [entries, setEntries] = useState<WorldEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(Boolean(worldId));
  const [entriesLoadFailed, setEntriesLoadFailed] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [entryReloadKey, setEntryReloadKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<WorldEntryCategory | "all">("all");
  const [editingEntry, setEditingEntry] = useState<WorldEntry | null>(null);
  const [formState, setFormState] = useState<EntryFormState>(() => makeEmptyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [legacyEntries, setLegacyEntries] = useState<LegacyWikiEntry[]>([]);
  const [legacyDismissed, setLegacyDismissed] = useState(false);
  const [importingLegacy, setImportingLegacy] = useState(false);

  useEffect(() => {
    if (!worldId) {
      setTemplates([]);
      setTemplatesLoading(false);
      return;
    }
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplates([]);
    setTemplatesError(null);
    listWorldTemplates(worldId)
      .then((data) => {
        if (!cancelled) setTemplates(data.map(parseTemplate));
      })
      .catch((error) => {
        if (!cancelled) setTemplatesError(getErrorMessage(error, "We couldn't load template references."));
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateReloadKey, worldId]);

  useEffect(() => {
    if (!worldId) {
      setEntries([]);
      setEntriesLoading(false);
      setEntriesLoadFailed(true);
      setEntriesError("This page needs a valid world.");
      return;
    }
    let cancelled = false;
    setEntriesLoading(true);
    setEntries([]);
    setEntriesLoadFailed(false);
    setEntriesError(null);
    listWorldEntries(worldId)
      .then((data) => {
        if (!cancelled) {
          setEntries(data.map((entry) => ({ ...entry, category: normalizeCategory(entry.category) })));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setEntriesLoadFailed(true);
          setEntriesError(getErrorMessage(error, "We couldn't load the world index."));
        }
      })
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryReloadKey, worldId]);

  useEffect(() => {
    setEditingEntry(null);
    setFormState(makeEmptyForm());
    setMessage(null);
    setLegacyDismissed(false);
    if (!worldId) {
      setLegacyEntries([]);
      return;
    }
    try {
      setLegacyEntries(parseLegacyEntries(localStorage.getItem(`wiki_entries_${worldId}`)));
    } catch {
      setLegacyEntries([]);
    }
  }, [worldId]);

  const importedLegacyIds = useMemo(() => {
    const ids = new Set<string>();
    entries.forEach((entry) => {
      const id = parseMetadata(entry.metadata_json).legacyLocalId;
      if (typeof id === "string") ids.add(id);
    });
    return ids;
  }, [entries]);

  const pendingLegacyEntries = useMemo(
    () => legacyEntries.filter((entry) => !importedLegacyIds.has(entry.id)),
    [importedLegacyIds, legacyEntries]
  );

  const groupedTemplates = useMemo(() => {
    const grouped: Record<TemplateType, ParsedTemplate[]> = {
      character: [],
      npc: [],
      item: [],
      ability: [],
      custom_entity: [],
    };
    templates.forEach((template) => grouped[template.template_type]?.push(template));
    return grouped;
  }, [templates]);

  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();

  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (filter !== "all" && entry.category !== filter) return false;
        if (!normalizedSearch) return true;
        const haystack = `${entry.title} ${entry.summary} ${entry.body} ${getEntryTags(entry).join(" ")}`.toLocaleLowerCase();
        return haystack.includes(normalizedSearch);
      }),
    [entries, filter, normalizedSearch]
  );

  const filteredTemplates = useMemo(() => {
    if (!normalizedSearch) return groupedTemplates;
    const result: Record<TemplateType, ParsedTemplate[]> = {
      character: [],
      npc: [],
      item: [],
      ability: [],
      custom_entity: [],
    };
    (Object.keys(groupedTemplates) as TemplateType[]).forEach((type) => {
      result[type] = groupedTemplates[type].filter((template) =>
        `${template.name} ${JSON.stringify(template.definition)}`.toLocaleLowerCase().includes(normalizedSearch)
      );
    });
    return result;
  }, [groupedTemplates, normalizedSearch]);

  const originalFormState = useMemo<EntryFormState | null>(() => {
    if (!editingEntry) return null;
    return {
      title: editingEntry.title,
      summary: editingEntry.summary,
      body: editingEntry.body,
      tags: getEntryTags(editingEntry).join(", "),
      category: editingEntry.category,
    };
  }, [editingEntry]);

  const formDirty = editingEntry
    ? Boolean(
        originalFormState &&
          (formState.title !== originalFormState.title ||
            formState.summary !== originalFormState.summary ||
            formState.body !== originalFormState.body ||
            formState.category !== originalFormState.category ||
            normalizeTags(formState.tags).join("\u0000") !== normalizeTags(originalFormState.tags).join("\u0000"))
      )
    : Boolean(formState.title || formState.summary || formState.body || formState.tags || formState.category !== "note");

  const navigationBlocked = formDirty || saving || importingLegacy || Boolean(deletingId);
  const blocker = useBlocker(navigationBlocked);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (saving || importingLegacy || deletingId) {
      window.alert("An index operation is still in progress. Wait for it to finish before leaving this page.");
      blocker.reset();
      return;
    }
    if (window.confirm("Discard the unsaved index entry and leave this page?")) blocker.proceed();
    else blocker.reset();
  }, [blocker, deletingId, importingLegacy, saving]);

  useCloseGuard({
    active: navigationBlocked,
    pending: Boolean(saving || importingLegacy || deletingId),
    pendingMessage: "An index operation is still in progress. Wait for it to finish before leaving this page.",
    confirmMessage: "Discard the unsaved index entry and leave this page?",
  });

  const resetEditor = () => {
    setEditingEntry(null);
    setFormState(makeEmptyForm());
  };

  const confirmDiscard = () =>
    !formDirty || window.confirm("Discard your unsaved changes to this index entry?");

  const handleSaveEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !worldId ||
      entriesLoading ||
      entriesLoadFailed ||
      saving ||
      deletingId ||
      importingLegacy
    ) return;
    const title = formState.title.trim();
    if (!title) {
      setEntriesError("Entry title is required.");
      return;
    }

    const tags = normalizeTags(formState.tags);
    setSaving(true);
    setEntriesError(null);
    setMessage(null);
    try {
      if (editingEntry) {
        const updated = await updateWorldEntry(
          editingEntry.id,
          formState.category,
          title,
          formState.summary.trim(),
          formState.body.trim(),
          serializeMetadata(tags, parseMetadata(editingEntry.metadata_json))
        );
        setEntries((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
        setMessage(`“${updated.title}” was updated.`);
      } else {
        const created = await createWorldEntry(
          worldId,
          formState.category,
          title,
          formState.summary.trim(),
          formState.body.trim(),
          serializeMetadata(tags)
        );
        setEntries((current) => [created, ...current]);
        setMessage(`“${created.title}” was added to the index.`);
      }
      resetEditor();
    } catch (error) {
      setEntriesError(getErrorMessage(error, "We couldn't save that index entry."));
    } finally {
      setSaving(false);
    }
  };

  const handleEditEntry = (entry: WorldEntry) => {
    if (editingEntry?.id === entry.id) return;
    if (!confirmDiscard()) return;
    setEditingEntry(entry);
    setFormState({
      title: entry.title,
      summary: entry.summary,
      body: entry.body,
      tags: getEntryTags(entry).join(", "),
      category: normalizeCategory(entry.category),
    });
    setEntriesError(null);
    setMessage(null);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const handleDeleteEntry = async (entry: WorldEntry) => {
    if (deletingId || saving || importingLegacy) return;
    const discardsDraft = editingEntry?.id === entry.id && formDirty;
    if (
      !window.confirm(
        `Delete “${entry.title}”? This cannot be undone.${
          discardsDraft ? " Your unsaved edits to this entry will also be discarded." : ""
        }`
      )
    ) return;
    setDeletingId(entry.id);
    setEntriesError(null);
    setMessage(null);
    try {
      await deleteWorldEntry(entry.id);
      setEntries((current) => current.filter((candidate) => candidate.id !== entry.id));
      if (editingEntry?.id === entry.id) resetEditor();
      setMessage(`“${entry.title}” was deleted.`);
    } catch (error) {
      setEntriesError(getErrorMessage(error, "We couldn't delete that index entry."));
    } finally {
      setDeletingId(null);
    }
  };

  const handleImportLegacy = async () => {
    if (
      !worldId ||
      importingLegacy ||
      saving ||
      deletingId ||
      entriesLoading ||
      entriesLoadFailed ||
      pendingLegacyEntries.length === 0
    ) return;
    setImportingLegacy(true);
    setEntriesError(null);
    setMessage(null);
    const imported: WorldEntry[] = [];
    let remaining: LegacyWikiEntry[] = [];

    for (let index = 0; index < pendingLegacyEntries.length; index += 1) {
      const legacy = pendingLegacyEntries[index];
      try {
        const created = await createWorldEntry(
          worldId,
          legacyCategory(legacy.templateType),
          legacy.title.trim() || "Untitled legacy note",
          legacy.summary.trim(),
          "",
          serializeMetadata(legacy.tags, {
            legacyLocalId: legacy.id,
            legacyTemplateType: legacy.templateType,
            legacyUpdatedAt: legacy.updatedAt,
          })
        );
        imported.push(created);
      } catch (error) {
        remaining = pendingLegacyEntries.slice(index);
        setEntriesError(getErrorMessage(error, "The legacy-note import stopped before it finished."));
        break;
      }
    }

    if (imported.length > 0) setEntries((current) => [...imported.reverse(), ...current]);
    try {
      const storageKey = `wiki_entries_${worldId}`;
      if (remaining.length === 0) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(remaining));
    } catch {
      setEntriesError("Notes were imported, but the legacy browser copy could not be cleared. Imported IDs will prevent duplicates.");
    }
    setLegacyEntries(remaining);
    if (remaining.length === 0) setMessage(`${imported.length} legacy note${imported.length === 1 ? " was" : "s were"} imported into SQLite.`);
    setImportingLegacy(false);
  };

  if (!worldId) {
    return <p className="status-error" role="alert">This page needs a valid world.</p>;
  }

  return (
    <div className="page-shell max-w-7xl">
      <header className="page-header">
        <div>
          <p className="section-label">Campaign codex</p>
          <h1 className="page-title mt-1">World index</h1>
          <p className="page-description mt-2">
            Build a searchable reference for places, factions, systems, relics, and table notes.
          </p>
        </div>
      </header>

      {!entriesLoading && !entriesLoadFailed && pendingLegacyEntries.length > 0 && !legacyDismissed && (
        <section className="section-card border-amber-500/40 space-y-3" aria-labelledby="legacy-import-heading">
          <div>
            <h2 id="legacy-import-heading" className="text-sm font-semibold text-amber-200">Local notes found</h2>
            <p className="mt-1 text-xs text-slate-400">
              {pendingLegacyEntries.length} note{pendingLegacyEntries.length === 1 ? " is" : "s are"} stored in the older browser-only format. Import them into the campaign database so they are backed up with the rest of this world.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="primary-button text-xs" onClick={handleImportLegacy} disabled={importingLegacy}>
              {importingLegacy ? "Importing…" : "Import notes"}
            </button>
            <button type="button" className="secondary-button text-xs" onClick={() => setLegacyDismissed(true)} disabled={importingLegacy}>
              Not now
            </button>
          </div>
        </section>
      )}

      <div aria-live="polite">
        {entriesError && <p className="status-error" role="alert">{entriesError}</p>}
        {message && <p className="status-success">{message}</p>}
      </div>

      <section className="section-card space-y-3" aria-label="Search and filter the world index">
        <div className="grid gap-3 sm:grid-cols-[1fr_15rem]">
          <div>
            <label htmlFor="index-search" className="sr-only">Search index entries and templates</label>
            <input
              id="index-search"
              type="search"
              className="input-field"
              placeholder="Search titles, body text, tags, or templates"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="index-filter" className="sr-only">Filter index entries by category</label>
            <select
              id="index-filter"
              className="input-field"
              value={filter}
              onChange={(event) => setFilter(event.target.value as WorldEntryCategory | "all")}
            >
              <option value="all">All categories</option>
              {WORLD_ENTRY_CATEGORIES.map((category) => (
                <option key={category} value={category}>{CATEGORY_INFO[category].label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
        <aside ref={editorRef} className="section-card space-y-4 lg:order-2 lg:sticky lg:top-4" aria-labelledby="index-editor-heading">
          <header>
            <h2 id="index-editor-heading" className="text-lg font-semibold text-slate-100">
              {editingEntry ? "Edit index entry" : "New index entry"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">Only the title is required; add detail now or grow the entry over time.</p>
          </header>
          <form className="space-y-3" onSubmit={handleSaveEntry}>
            <div>
              <label htmlFor="index-entry-title" className="block text-xs font-semibold text-slate-400 mb-1">Title <span aria-hidden="true">*</span></label>
              <input
                id="index-entry-title"
                className="input-field"
                value={formState.title}
                maxLength={180}
                required
                disabled={entriesLoading || entriesLoadFailed || saving || Boolean(deletingId) || importingLegacy}
                onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="index-entry-category" className="block text-xs font-semibold text-slate-400 mb-1">Category</label>
              <select
                id="index-entry-category"
                className="input-field"
                value={formState.category}
                disabled={entriesLoading || entriesLoadFailed || saving || Boolean(deletingId) || importingLegacy}
                onChange={(event) => setFormState((current) => ({ ...current, category: event.target.value as WorldEntryCategory }))}
              >
                {WORLD_ENTRY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{CATEGORY_INFO[category].label}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">{CATEGORY_INFO[formState.category].description}</p>
            </div>
            <div>
              <label htmlFor="index-entry-summary" className="block text-xs font-semibold text-slate-400 mb-1">Quick summary</label>
              <textarea
                id="index-entry-summary"
                className="input-field"
                rows={2}
                maxLength={500}
                value={formState.summary}
                disabled={entriesLoading || entriesLoadFailed || saving || Boolean(deletingId) || importingLegacy}
                onChange={(event) => setFormState((current) => ({ ...current, summary: event.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="index-entry-body" className="block text-xs font-semibold text-slate-400 mb-1">Full entry</label>
              <textarea
                id="index-entry-body"
                className="input-field"
                rows={8}
                maxLength={20000}
                placeholder="Write the detailed, table-ready reference here…"
                value={formState.body}
                disabled={entriesLoading || entriesLoadFailed || saving || Boolean(deletingId) || importingLegacy}
                onChange={(event) => setFormState((current) => ({ ...current, body: event.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="index-entry-tags" className="block text-xs font-semibold text-slate-400 mb-1">Tags</label>
              <input
                id="index-entry-tags"
                className="input-field"
                placeholder="politics, session 4, unresolved"
                value={formState.tags}
                maxLength={500}
                disabled={entriesLoading || entriesLoadFailed || saving || Boolean(deletingId) || importingLegacy}
                onChange={(event) => setFormState((current) => ({ ...current, tags: event.target.value }))}
              />
              <p className="mt-1 text-[11px] text-slate-500">Separate tags with commas.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="primary-button" disabled={entriesLoading || entriesLoadFailed || saving || Boolean(deletingId) || importingLegacy || !formState.title.trim()}>
                {saving ? "Saving…" : editingEntry ? "Save changes" : "Add to index"}
              </button>
              {(editingEntry || formDirty) && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={saving || Boolean(deletingId) || importingLegacy}
                  onClick={() => {
                    if (confirmDiscard()) resetEditor();
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </aside>

        <section className="section-card space-y-4 lg:order-1" aria-labelledby="codex-entries-heading">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="codex-entries-heading" className="text-lg font-semibold text-slate-100">Codex entries</h2>
              {!entriesLoading && <p className="text-xs text-slate-500">{filteredEntries.length} shown · {entries.length} total</p>}
            </div>
            {entriesLoadFailed && (
              <button type="button" className="secondary-button text-xs" onClick={() => setEntryReloadKey((key) => key + 1)}>Reload entries</button>
            )}
          </div>

          {entriesLoading ? (
            <p className="text-sm text-slate-400" role="status">Loading index entries…</p>
          ) : entriesLoadFailed ? (
            <p className="text-sm text-slate-500">The index is unavailable. Reload it to try again.</p>
          ) : filteredEntries.length === 0 ? (
            <p className="text-sm text-slate-500">
              {entries.length === 0 ? "No index entries yet. Use the editor to create the first one." : "No entries match the current search and category."}
            </p>
          ) : (
            <div className="space-y-3">
              {filteredEntries.map((entry) => {
                const tags = getEntryTags(entry);
                return (
                  <article key={entry.id} className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 space-y-3">
                    <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">{CATEGORY_INFO[entry.category]?.label ?? entry.category}</p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-100">{entry.title}</h3>
                      </div>
                      <time className="shrink-0 text-[11px] text-slate-500" dateTime={new Date(entry.created_at * 1000).toISOString()}>
                        {new Date(entry.created_at * 1000).toLocaleDateString()}
                      </time>
                    </header>
                    {entry.summary && <p className="text-sm font-medium text-slate-300">{entry.summary}</p>}
                    {entry.body && <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-400">{entry.body}</p>}
                    {tags.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
                        {tags.map((tag) => <li key={tag} className="rounded-full bg-slate-800 px-2 py-1 text-[11px] text-slate-300">#{tag}</li>)}
                      </ul>
                    )}
                    <div className="flex gap-3 text-xs">
                      <button type="button" className="text-sky-300 hover:text-sky-200" onClick={() => handleEditEntry(entry)} disabled={Boolean(saving || deletingId || importingLegacy)}>Edit</button>
                      <button
                        type="button"
                        className="text-red-300 hover:text-red-200 disabled:opacity-50"
                        onClick={() => handleDeleteEntry(entry)}
                        disabled={Boolean(saving || deletingId || importingLegacy)}
                        aria-label={`Delete ${entry.title}`}
                      >
                        {deletingId === entry.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="section-card space-y-4" aria-labelledby="template-reference-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="template-reference-heading" className="text-lg font-semibold text-slate-100">Template reference</h2>
            <p className="mt-1 text-xs text-slate-500">Read-only structures created with this world. The search above filters their names and fields.</p>
          </div>
          {templatesError && <button type="button" className="secondary-button text-xs" onClick={() => setTemplateReloadKey((key) => key + 1)}>Reload templates</button>}
        </div>

        {templatesLoading ? (
          <p className="text-sm text-slate-400" role="status">Loading template definitions…</p>
        ) : templatesError ? (
          <p className="status-error" role="alert">{templatesError}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(filteredTemplates) as TemplateType[]).map((type) => (
              <article key={type} className="rounded-xl border border-slate-800 p-4 space-y-3">
                <header>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-100">{TEMPLATE_HEADINGS[type]}</h3>
                    <span className="text-xs text-slate-500">{filteredTemplates[type].length}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{TEMPLATE_DESCRIPTIONS[type]}</p>
                </header>
                {filteredTemplates[type].length === 0 ? (
                  <p className="text-xs text-slate-500">{normalizedSearch ? "No matching templates." : "No templates stored."}</p>
                ) : (
                  <div className="space-y-2">
                    {filteredTemplates[type].map((template) => (
                      <div key={template.id} className="rounded border border-slate-800 bg-slate-900/30 p-3 space-y-2">
                        <h4 className="text-sm font-medium text-slate-200">{template.name}</h4>
                        {renderDefinitionRows(template)}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
