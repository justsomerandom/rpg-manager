import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import {
  listWorldTemplates,
  type TemplateType,
  type WorldTemplate,
} from "../../api/templates";

type ParsedTemplate = WorldTemplate & { definition: any };
type WikiEntry = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  templateType: TemplateType | "note";
  updatedAt: number;
};

const TEMPLATE_HEADINGS: Record<TemplateType, string> = {
  character: "Character",
  npc: "NPC templates",
  item: "Item",
  ability: "Ability",
  custom_entity: "Custom entities",
};

const TEMPLATE_DESCRIPTIONS: Record<TemplateType, string> = {
  character: "Shared playable sheet locked at world creation.",
  npc: "Reusable archetypes to drop into scenes.",
  item: "Structured equipment write-ups.",
  ability: "Abilities, spells, or combat maneuvers.",
  custom_entity: "Factions, elements, or bespoke lore tags.",
};

const FILTER_OPTIONS: Array<TemplateType | "note" | "all"> = [
  "all",
  "character",
  "npc",
  "item",
  "ability",
  "custom_entity",
  "note",
];

const defaultFormState = {
  title: "",
  summary: "",
  tags: "",
  templateType: "note" as TemplateType | "note",
};

export function WorldIndexPage() {
  const { worldId } = useParams();
  const [templates, setTemplates] = useState<ParsedTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<TemplateType | "note" | "all">("all");
  const [wikiEntries, setWikiEntries] = useState<WikiEntry[]>([]);
  const [editingEntry, setEditingEntry] = useState<WikiEntry | null>(null);
  const [formState, setFormState] = useState(defaultFormState);

  useEffect(() => {
    if (!worldId) return;
    setLoading(true);
    listWorldTemplates(worldId)
      .then((data) => {
        setTemplates(
          data.map((template) => {
            let definition: any = {};
            try {
              definition = JSON.parse(template.definition_json);
            } catch {
              definition = {};
            }
            return { ...template, definition };
          })
        );
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [worldId]);

  useEffect(() => {
    if (!worldId) return;
    try {
      const raw = localStorage.getItem(`wiki_entries_${worldId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as WikiEntry[];
        setWikiEntries(parsed);
      } else {
        setWikiEntries([]);
      }
    } catch {
      setWikiEntries([]);
    }
  }, [worldId]);

  useEffect(() => {
    if (!worldId) return;
    localStorage.setItem(`wiki_entries_${worldId}`, JSON.stringify(wikiEntries));
  }, [wikiEntries, worldId]);

  const grouped = useMemo(() => {
    const base: Record<TemplateType, ParsedTemplate[]> = {
      character: [],
      npc: [],
      item: [],
      ability: [],
      custom_entity: [],
    };
    templates.forEach((template) => {
      const key = template.template_type as TemplateType;
      if (base[key]) {
        base[key].push(template);
      }
    });
    return base;
  }, [templates]);

  const templateMatches = useMemo(() => {
    if (!searchTerm.trim()) return grouped;
    const query = searchTerm.toLowerCase();
    const base: Record<TemplateType, ParsedTemplate[]> = {
      character: [],
      npc: [],
      item: [],
      ability: [],
      custom_entity: [],
    };
    (Object.keys(grouped) as TemplateType[]).forEach((type) => {
      base[type] = grouped[type].filter((template) => {
        const haystack = `${template.name} ${JSON.stringify(template.definition ?? {})}`.toLowerCase();
        return haystack.includes(query);
      });
    });
    return base;
  }, [grouped, searchTerm]);

  const filteredEntries = useMemo(() => {
    const query = searchTerm.toLowerCase();
    return wikiEntries.filter((entry) => {
      const matchesFilter =
        filter === "all" || entry.templateType === filter;
      const haystack = `${entry.title} ${entry.summary} ${entry.tags.join(" ")}`.toLowerCase();
      return matchesFilter && (query.length === 0 || haystack.includes(query));
    });
  }, [wikiEntries, searchTerm, filter]);

  const handleSaveEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = formState.title.trim();
    const summary = formState.summary.trim();
    if (!title || !summary) return;
    const tags = formState.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (editingEntry) {
      setWikiEntries((prev) =>
        prev.map((entry) =>
          entry.id === editingEntry.id
            ? {
                ...entry,
                title,
                summary,
                tags,
                templateType: formState.templateType,
                updatedAt: Date.now(),
              }
            : entry
        )
      );
    } else {
      setWikiEntries((prev) => [
        {
          id: crypto.randomUUID(),
          title,
          summary,
          tags,
          templateType: formState.templateType,
          updatedAt: Date.now(),
        },
        ...prev,
      ]);
    }

    setFormState(defaultFormState);
    setEditingEntry(null);
  };

  const handleEditEntry = (entry: WikiEntry) => {
    setEditingEntry(entry);
    setFormState({
      title: entry.title,
      summary: entry.summary,
      tags: entry.tags.join(", "),
      templateType: entry.templateType,
    });
  };

  const handleDeleteEntry = (entryId: string) => {
    setWikiEntries((prev) => prev.filter((entry) => entry.id !== entryId));
    if (editingEntry?.id === entryId) {
      setEditingEntry(null);
      setFormState(defaultFormState);
    }
  };

  if (!worldId) {
    return <p className="text-sm text-red-400">World not found.</p>;
  }

  const templateData = searchTerm.trim() ? templateMatches : grouped;

  return (
    <div className="h-full w-full flex flex-col space-y-5 overflow-hidden">
      <header className="page-header shrink-0"><div><p className="section-label">Campaign codex</p><h2 className="page-title mt-1">World index</h2><p className="page-description mt-2">
          Keep a diegetic wiki of factions, relics, and NPCs while referencing locked-in templates.
        </p></div></header>

      {error && <p className="text-sm text-red-400">Error: {error}</p>}
      {loading && <p className="text-xs text-earth-sand/70">Loading template definitions...</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          className="input-field"
          placeholder="Search wiki entries or templates"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select
          className="rounded-lg border border-grove-700 bg-grove-800 px-3 py-2 text-sm text-brand-glow"
          value={filter}
          onChange={(e) => setFilter(e.target.value as TemplateType | "note" | "all")}
        >
          {FILTER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All entries" : option === "note" ? "Wiki notes" : TEMPLATE_HEADINGS[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 grid gap-6 overflow-hidden lg:grid-cols-[2fr_1fr]">
        <section className="glass-panel bg-grove-900/60 border border-grove-700 p-5 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-brand-glow">Codex entries</h3>
              <p className="text-xs text-earth-sand/70">
                {filteredEntries.length} entry{filteredEntries.length === 1 ? "" : "ies"}
              </p>
            </div>
          </div>
          <div className="mt-4 flex-1 overflow-y-auto pr-2 space-y-3">
            {filteredEntries.length === 0 ? (
              <p className="text-sm text-earth-sand/60">
                No entries yet. Use the panel on the right to start documenting people, places, and items.
              </p>
            ) : (
              filteredEntries.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-2xl border border-grove-700 bg-grove-800/60 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between text-[11px] text-earth-sand/70">
                    <span>
                      {entry.templateType === "note"
                        ? "Lore note"
                        : TEMPLATE_HEADINGS[entry.templateType]}
                    </span>
                    <span>{new Date(entry.updatedAt).toLocaleString()}</span>
                  </div>
                  <h4 className="text-lg font-semibold text-brand-glow">{entry.title}</h4>
                  <p className="text-sm text-earth-sand/80">{entry.summary}</p>
                  {entry.tags.length > 0 && (
                    <p className="text-xs text-earth-sand/60">
                      Tags: {entry.tags.map((tag) => `#${tag}`).join(" ")}
                    </p>
                  )}
                  <div className="flex gap-3 text-[11px] text-earth-sand/70">
                    <button onClick={() => handleEditEntry(entry)} className="hover:text-white">
                      Edit
                    </button>
                    <button onClick={() => handleDeleteEntry(entry.id)} className="hover:text-earth-clay">
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <div className="space-y-6 overflow-y-auto pr-2">
          <section className="glass-panel bg-grove-900/60 border border-grove-700 p-5 space-y-4">
            <header className="space-y-1">
              <h3 className="text-lg font-semibold text-brand-glow">
                {editingEntry ? "Edit entry" : "New entry"}
              </h3>
              <p className="text-xs text-earth-sand/70">
                Draft lore, items, or NPCs with tags for fast searching.
              </p>
            </header>
            <form className="space-y-3" onSubmit={handleSaveEntry}>
              <input
                className="input-field"
                placeholder="Title"
                value={formState.title}
                onChange={(e) => setFormState((prev) => ({ ...prev, title: e.target.value }))}
              />
              <textarea
                className="input-field"
                rows={4}
                placeholder="Summary or lore snippet"
                value={formState.summary}
                onChange={(e) => setFormState((prev) => ({ ...prev, summary: e.target.value }))}
              />
              <select
                className="rounded-lg border border-grove-700 bg-grove-800 px-3 py-2 text-sm text-brand-glow w-full"
                value={formState.templateType}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    templateType: e.target.value as TemplateType | "note",
                  }))
                }
              >
                <option value="note">General lore note</option>
                {(Object.keys(TEMPLATE_HEADINGS) as TemplateType[]).map((type) => (
                  <option key={type} value={type}>
                    Link to {TEMPLATE_HEADINGS[type]}
                  </option>
                ))}
              </select>
              <input
                className="input-field"
                placeholder="Tags (comma separated)"
                value={formState.tags}
                onChange={(e) => setFormState((prev) => ({ ...prev, tags: e.target.value }))}
              />
              <div className="flex gap-2">
                <button type="submit" className="primary-button text-sm">
                  {editingEntry ? "Update entry" : "Add entry"}
                </button>
                {editingEntry && (
                  <button
                    type="button"
                    className="secondary-button text-sm"
                    onClick={() => {
                      setEditingEntry(null);
                      setFormState(defaultFormState);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="glass-panel bg-grove-900/60 border border-grove-700 p-5 space-y-4 max-h-[55vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-brand-glow">Template reference</h3>
            {(Object.keys(templateData) as TemplateType[]).map((type) => (
              <article key={type} className="space-y-2 border border-grove-700/60 rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-brand-glow">
                      {TEMPLATE_HEADINGS[type]}
                    </p>
                    <p className="text-[11px] text-earth-sand/70">{TEMPLATE_DESCRIPTIONS[type]}</p>
                  </div>
                  <span className="text-xs text-earth-sand/60">
                    {templateData[type].length} stored
                  </span>
                </div>
                {templateData[type].length === 0 ? (
                  <p className="text-xs text-earth-sand/60">No templates persisted yet.</p>
                ) : (
                  templateData[type].map((template) => (
                    <div key={template.id} className="rounded-xl bg-grove-800/50 border border-grove-700/60 p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs text-earth-sand/70">
                        <span className="text-brand-glow">{template.name}</span>
                        <span>{new Date(template.created_at * 1000).toLocaleDateString()}</span>
                      </div>
                      {type === "character" && (
                        <ul className="text-xs text-earth-sand/80 space-y-1">
                          {template.definition.features?.map((feature: any) => (
                            <li key={feature.id} className="flex justify-between gap-2">
                              <span>{feature.label}</span>
                              <span className="text-earth-sand/60">{feature.type}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {type === "npc" && (
                        <p className="text-xs text-earth-sand/80">
                          Role: <span className="text-brand-glow">{template.definition.role || "Unknown"}</span>
                          <br />
                          Notes: {template.definition.notes || "n/a"}
                        </p>
                      )}
                      {type !== "character" && type !== "npc" && type !== "custom_entity" && (
                        <ul className="text-xs text-earth-sand/80 space-y-1">
                          {template.definition.fields?.map((field: any) => (
                            <li key={field.id} className="flex justify-between gap-2">
                              <span>{field.label}</span>
                              <span className="text-earth-sand/60">{field.inputType}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {type === "custom_entity" && (
                        <ul className="text-xs text-earth-sand/80 space-y-1">
                          {template.definition.fields?.map((field: any) => (
                            <li key={field.id}>{field.label}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                )}
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
