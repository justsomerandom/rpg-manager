import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  createWorldEntry,
  deleteWorldEntry,
  listWorldEntries,
  updateWorldEntry,
  type WorldEntry,
  type WorldEntryCategory,
} from "../../api/worldEntries";

type CollectionCategory = Exclude<WorldEntryCategory, "magic_system">;

const MAGIC_SYSTEM_TITLE = "Magic System";

const TEMPLATE_SECTIONS: {
  key: CollectionCategory;
  label: string;
  hint: string;
}[] = [
  {
    key: "item_type",
    label: "Item Types",
    hint: "Define crafting materials, relic classes, or loot tables unique to this world.",
  },
  {
    key: "character_template",
    label: "Character Templates",
    hint: "Store reusable NPC/PC scaffolds like guild adepts, veteran monsters, or ancestry packages.",
  },
  {
    key: "faction",
    label: "Factions",
    hint: "Track organizations vying for power: guilds, empires, covens, or rebellion cells.",
  },
  {
    key: "region",
    label: "Regions",
    hint: "Describe continents, planar realms, or city districts the party will explore.",
  },
];

type FormState = Record<CollectionCategory, { title: string; summary: string }>;

const defaultFormState = TEMPLATE_SECTIONS.reduce<FormState>((acc, section) => {
  acc[section.key] = { title: "", summary: "" };
  return acc;
}, {} as FormState);

export function WorldIndexPage() {
  const { worldId } = useParams();
  const [entries, setEntries] = useState<WorldEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [magicDraft, setMagicDraft] = useState("");
  const [magicEntryId, setMagicEntryId] = useState<string | null>(null);
  const [savingMagic, setSavingMagic] = useState(false);
  const [createForms, setCreateForms] = useState<FormState>(defaultFormState);
  const [creatingCategory, setCreatingCategory] =
    useState<CollectionCategory | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!worldId) return;
    setLoading(true);
    listWorldEntries(worldId)
      .then((data) => {
        setEntries(data);
        const magic = data.find((entry) => entry.category === "magic_system");
        setMagicEntryId(magic ? magic.id : null);
        setMagicDraft(magic ? magic.body : "");
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [worldId]);

  const groupedEntries = useMemo(() => {
    const base: Record<WorldEntryCategory, WorldEntry[]> = {
      magic_system: [],
      item_type: [],
      character_template: [],
      faction: [],
      region: [],
    };
    for (const entry of entries) {
      base[entry.category].push(entry);
    }
    return base;
  }, [entries]);

  const upsertEntry = (entry: WorldEntry) => {
    setEntries((prev) => {
      const filtered = prev.filter((existing) => existing.id !== entry.id);
      return [entry, ...filtered];
    });
  };

  const handleSaveMagicSystem = async () => {
    if (!worldId) return;
    const summary = magicDraft.trim().slice(0, 180);
    setSavingMagic(true);
    try {
      const entry = magicEntryId
        ? await updateWorldEntry(magicEntryId, MAGIC_SYSTEM_TITLE, summary, magicDraft)
        : await createWorldEntry(
            worldId,
            "magic_system",
            MAGIC_SYSTEM_TITLE,
            summary,
            magicDraft
          );
      upsertEntry(entry);
      setMagicEntryId(entry.id);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingMagic(false);
    }
  };

  const handleCreateEntry = async (category: CollectionCategory) => {
    if (!worldId) return;
    const { title, summary } = createForms[category];
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setCreatingCategory(category);
    try {
      const entry = await createWorldEntry(
        worldId,
        category,
        trimmedTitle,
        summary.trim(),
        ""
      );
      upsertEntry(entry);
      setCreateForms((prev) => ({
        ...prev,
        [category]: { title: "", summary: "" },
      }));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreatingCategory(null);
    }
  };

  const handleDeleteEntry = async (entry: WorldEntry) => {
    setDeletingId(entry.id);
    try {
      await deleteWorldEntry(entry.id);
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      if (entry.category === "magic_system") {
        setMagicEntryId(null);
        setMagicDraft("");
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeletingId(null);
    }
  };

  if (!worldId) {
    return <p className="text-sm text-red-400">World not found.</p>;
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-lg font-bold mb-2">World Templates</h2>
        <p className="text-slate-300 text-sm">
          Capture your setting&#39;s building blocks: magic, gear, factions, and
          regions.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">Error: {error}</p>}
      {loading && (
        <p className="text-sm text-slate-400">Loading worldbuilding data...</p>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Magic System
          </h3>
          <p className="text-xs text-slate-500">
            Outline spellcasting rules, limitations, and sources of power.
          </p>
        </div>
        <textarea
          rows={6}
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
          placeholder="Describe schools, costs, backlash, catalysts..."
          value={magicDraft}
          onChange={(e) => setMagicDraft(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSaveMagicSystem}
            disabled={savingMagic}
            className="px-4 py-2 rounded bg-sky-600 text-sm disabled:opacity-50"
          >
            {savingMagic
              ? "Saving..."
              : magicEntryId
              ? "Update Magic System"
              : "Save Magic System"}
          </button>
          {magicEntryId && (
            <button
              onClick={() => {
                const entry = entries.find((e) => e.id === magicEntryId);
                if (entry) {
                  handleDeleteEntry(entry);
                }
              }}
              disabled={deletingId === magicEntryId}
              className="px-4 py-2 rounded border border-slate-600 text-sm disabled:opacity-50"
            >
              {deletingId === magicEntryId ? "Clearing..." : "Clear outline"}
            </button>
          )}
        </div>
      </section>

      {TEMPLATE_SECTIONS.map((section) => {
        const items = groupedEntries[section.key];
        return (
          <section key={section.key} className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-200">
                {section.label}
              </h3>
              <p className="text-xs text-slate-500">{section.hint}</p>
            </div>

            <div className="rounded border border-slate-800 p-4 space-y-3 bg-slate-950/50">
              <h4 className="text-xs font-semibold uppercase text-slate-400">
                Add {section.label}
              </h4>
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Name"
                value={createForms[section.key].title}
                onChange={(e) =>
                  setCreateForms((prev) => ({
                    ...prev,
                    [section.key]: {
                      ...prev[section.key],
                      title: e.target.value,
                    },
                  }))
                }
              />
              <textarea
                rows={2}
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Short summary or mechanical notes"
                value={createForms[section.key].summary}
                onChange={(e) =>
                  setCreateForms((prev) => ({
                    ...prev,
                    [section.key]: {
                      ...prev[section.key],
                      summary: e.target.value,
                    },
                  }))
                }
              />
              <button
                onClick={() => handleCreateEntry(section.key)}
                disabled={
                  creatingCategory === section.key ||
                  !createForms[section.key].title.trim()
                }
                className="px-3 py-2 rounded bg-sky-600 text-xs disabled:opacity-50"
              >
                {creatingCategory === section.key ? "Adding..." : "Add entry"}
              </button>
            </div>

            <div className="space-y-2">
              {items.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No {section.label.toLowerCase()} yet.
                </p>
              ) : (
                items.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded border border-slate-800 px-4 py-3 flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-100">
                        {entry.title}
                      </p>
                      <p className="text-xs text-slate-400">
                        {entry.summary || "No summary provided."}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteEntry(entry)}
                      disabled={deletingId === entry.id}
                      className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                    >
                      {deletingId === entry.id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
