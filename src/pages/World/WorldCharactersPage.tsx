import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  listCharacters,
  createCharacter,
  type Character,
} from "../../api/characters";
import { listWorldTemplates } from "../../api/templates";

type CharacterTemplate = {
  name: string;
  features: Array<{ id: string; label: string; type: string }>;
};

export function WorldCharactersPage() {
  const { worldId } = useParams();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<CharacterTemplate | null>(null);
  const [templateLoading, setTemplateLoading] = useState(true);

  useEffect(() => {
    if (!worldId) return;
    setLoading(true);
    listCharacters(worldId)
      .then((chars) => {
        setCharacters(chars);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [worldId]);

  useEffect(() => {
    if (!worldId) return;
    setTemplateLoading(true);
    listWorldTemplates(worldId, "character")
      .then((templates) => {
        if (templates.length === 0) {
          setTemplate(null);
          return;
        }
        try {
          const definition = JSON.parse(templates[0].definition_json || "{}");
          setTemplate({
            name: templates[0].name,
            features: definition.features ?? [],
          });
        } catch {
          setTemplate(null);
        }
      })
      .catch(() => setTemplate(null))
      .finally(() => setTemplateLoading(false));
  }, [worldId]);

  const handleCreate = async () => {
    if (!worldId) return;
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const c = await createCharacter(worldId, name);
      setCharacters((prev) => [...prev, c]);
      setNewName("");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-bold mb-2">Player Characters</h2>
        <p className="text-slate-300 text-sm">
          All heroes share a universal sheet defined during world creation. Standard
          inventory slots are automatically added outside of the template.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">Error: {error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading characters...</p>}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Add character
        </h3>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="Character name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="px-3 py-2 rounded bg-sky-600 text-xs disabled:opacity-50"
          >
            {creating ? "Adding..." : "Add"}
          </button>
        </div>
      </section>

      <section className="space-y-3 border border-slate-800 rounded-lg p-4 bg-slate-950/50">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Character template overview
        </h3>
        {templateLoading ? (
          <p className="text-sm text-slate-500">Loading template...</p>
        ) : template ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-200 font-semibold">{template.name}</p>
            <ul className="space-y-1 text-xs text-slate-300">
              {template.features.map((feature) => (
                <li key={feature.id} className="flex justify-between border-b border-slate-800/70 py-1">
                  <span>{feature.label}</span>
                  <span className="text-slate-500">{feature.type}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No template stored for this world.</p>
        )}
        <p className="text-[11px] text-slate-500">
          Inventory packs (backpack, pouches, etc.) are standard and do not appear here.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Characters
        </h3>
        {characters.length === 0 && !loading && (
          <p className="text-sm text-slate-500">No characters yet. Add one above.</p>
        )}
        <ul className="space-y-2">
          {characters.map((c) => (
            <li
              key={c.id}
              className="rounded border border-slate-800 px-3 py-2 flex justify-between items-center"
            >
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-slate-500">ID: {c.id.slice(0, 8)}...</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
