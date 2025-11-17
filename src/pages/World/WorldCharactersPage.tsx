import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  listCharacters,
  createCharacter,
  type Character,
} from "../../api/characters";

export function WorldCharactersPage() {
  const { worldId } = useParams();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

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
          We'll plug templates, attributes and inventories here later.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">Error: {error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading characters…</p>}

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

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Characters
        </h3>
        {characters.length === 0 && !loading && (
          <p className="text-sm text-slate-500">
            No characters yet. Add one above.
          </p>
        )}
        <ul className="space-y-2">
          {characters.map((c) => (
            <li
              key={c.id}
              className="rounded border border-slate-800 px-3 py-2 flex justify-between items-center"
            >
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-slate-500">
                  ID: {c.id.slice(0, 8)}…
                </p>
              </div>
              {/* Later: button to open detail panel / sheet */}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
