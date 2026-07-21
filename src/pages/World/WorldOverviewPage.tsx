import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getWorld, updateWorld, type World } from "../../api/worlds";

export function WorldOverviewPage() {
  const { worldId } = useParams();
  const [world, setWorld] = useState<World | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!worldId) return;
    setLoading(true);
    getWorld(worldId)
      .then((w) => {
        setWorld(w);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [worldId]);

  const handleSave = async () => {
    if (!world || !worldId) return;
    setSaving(true);
    try {
      const updated = await updateWorld(worldId, {
        name: world.name,
        game_system: world.game_system,
        description: world.description,
      });
      setWorld(updated);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-400">Loading world...</p>;
  }
  if (!world) {
    return <p className="text-sm text-red-400">World not found.</p>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold mb-2">Campaign Overview</h2>
        <p className="text-slate-300 text-sm">
          Basic metadata for this world. We'll add PCs, timelines and session
          tracking here later.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">Error: {error}</p>}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">
            World name
          </label>
          <input
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            value={world.name}
            onChange={(e) =>
              setWorld((prev) => (prev ? { ...prev, name: e.target.value } : prev))
            }
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">
            Game system
          </label>
          <input
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            value={world.game_system}
            onChange={(e) =>
              setWorld((prev) =>
                prev ? { ...prev, game_system: e.target.value } : prev
              )
            }
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">
            Description / pitch
          </label>
          <textarea
            rows={5}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="Short pitch, themes, vibes..."
            value={world.description}
            onChange={(e) =>
              setWorld((prev) =>
                prev ? { ...prev, description: e.target.value } : prev
              )
            }
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded bg-sky-600 text-sm disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
