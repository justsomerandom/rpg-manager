import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listWorlds, createWorld, type World } from "../api/worlds";

export function HomePage() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [newName, setNewName] = useState("");
  const [gameSystem, setGameSystem] = useState("Custom");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listWorlds()
      .then(setWorlds)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const world = await createWorld(name, gameSystem.trim());
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

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold mb-1">TTRPG Manager</h1>
        <p className="text-sm text-slate-400">
          Manage your campaigns and worlds locally.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Create world
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
