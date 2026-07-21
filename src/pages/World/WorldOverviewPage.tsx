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
    return <p className="status-info">Loading campaign…</p>;
  }
  if (!world) {
    return <p className="text-sm text-red-400">World not found.</p>;
  }

  return (
    <div className="page-shell max-w-4xl">
      <header className="page-header"><div><p className="section-label">Campaign settings</p><h2 className="page-title mt-1">Campaign overview</h2><p className="page-description mt-2">
          Basic metadata for this world. We'll add PCs, timelines and session
          tracking here later.
        </p></div></header>

      {error && <p className="status-error">{error}</p>}

      <div className="section-card space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">
            World name
          </label>
          <input
            className="input-field"
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
            className="input-field"
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
            className="input-field"
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
          className="primary-button self-start"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
