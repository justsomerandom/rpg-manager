import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useBlocker, useOutletContext, useParams } from "react-router-dom";
import { getErrorMessage } from "../../api/client";
import { getWorld, updateWorld, type World } from "../../api/worlds";

type WorldOutletContext = {
  world: World | null;
  setWorld: Dispatch<SetStateAction<World | null>>;
};

const sameWorldDetails = (left: World | null, right: World | null) =>
  Boolean(
    left &&
      right &&
      left.name === right.name &&
      left.game_system === right.game_system &&
      left.description === right.description
  );

export function WorldOverviewPage() {
  const { worldId } = useParams();
  const outletContext = useOutletContext<WorldOutletContext | undefined>();
  const [world, setWorld] = useState<World | null>(null);
  const [savedWorld, setSavedWorld] = useState<World | null>(null);
  const [loading, setLoading] = useState(Boolean(worldId));
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!worldId) {
      setWorld(null);
      setSavedWorld(null);
      setLoadError("This page needs a valid world.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaveMessage(null);
    setWorld(null);

    getWorld(worldId)
      .then((loadedWorld) => {
        if (cancelled) return;
        setWorld(loadedWorld);
        setSavedWorld(loadedWorld);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(getErrorMessage(error, "We couldn't load this world."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey, worldId]);

  const dirty = Boolean(world && savedWorld && !sameWorldDetails(world, savedWorld));
  const nameIsValid = Boolean(world?.name.trim());
  const blocker = useBlocker(dirty && !saving);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("Discard your unsaved campaign changes and leave this page?")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  const updateDraft = (patch: Partial<Pick<World, "name" | "game_system" | "description">>) => {
    setWorld((current) => (current ? { ...current, ...patch } : current));
    setSaveError(null);
    setSaveMessage(null);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!world || !worldId || saving) return;

    const name = world.name.trim();
    if (!name) {
      setSaveError("World name is required.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const updated = await updateWorld(worldId, {
        name,
        game_system: world.game_system.trim(),
        description: world.description.trim(),
      });
      setWorld(updated);
      setSavedWorld(updated);
      outletContext?.setWorld(updated);
      setSaveMessage("Campaign details saved.");
    } catch (error) {
      setSaveError(getErrorMessage(error, "We couldn't save your changes."));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="status-info" role="status" aria-live="polite">
        Loading campaign…
      </p>
    );
  }

  if (!world) {
    return (
      <div className="page-shell max-w-4xl">
        <div className="section-card space-y-3" role="alert">
          <h2 className="text-lg font-semibold text-slate-100">Campaign unavailable</h2>
          <p className="status-error">{loadError ?? "World not found."}</p>
          {worldId && (
            <button type="button" className="secondary-button" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell max-w-4xl">
      <header className="page-header">
        <div>
          <p className="section-label">Campaign settings</p>
          <h1 className="page-title mt-1">Campaign overview</h1>
          <p className="page-description mt-2">
            Keep the campaign name, ruleset, and table-ready pitch in one place.
          </p>
        </div>
      </header>

      <div aria-live="polite">
        {saveError && <p className="status-error" role="alert">{saveError}</p>}
        {saveMessage && <p className="status-success">{saveMessage}</p>}
      </div>

      <form className="section-card space-y-5" onSubmit={handleSave}>
        <div>
          <label htmlFor="world-name" className="block text-xs font-semibold text-slate-400 mb-1">
            World name <span aria-hidden="true">*</span>
          </label>
          <input
            id="world-name"
            className="input-field"
            value={world.name}
            required
            maxLength={120}
            aria-invalid={!nameIsValid}
            onChange={(event) => updateDraft({ name: event.target.value })}
          />
        </div>

        <div>
          <label htmlFor="world-game-system" className="block text-xs font-semibold text-slate-400 mb-1">
            Game system
          </label>
          <input
            id="world-game-system"
            className="input-field"
            placeholder="Custom, D&D 5e, Pathfinder…"
            value={world.game_system}
            maxLength={120}
            onChange={(event) => updateDraft({ game_system: event.target.value })}
          />
        </div>

        <div>
          <label htmlFor="world-description" className="block text-xs font-semibold text-slate-400 mb-1">
            Description or pitch
          </label>
          <textarea
            id="world-description"
            rows={6}
            className="input-field"
            placeholder="Summarize the premise, tone, themes, and player-facing hook."
            value={world.description}
            maxLength={5000}
            onChange={(event) => updateDraft({ description: event.target.value })}
          />
          <p className="mt-1 text-right text-[11px] text-slate-500">
            {world.description.length.toLocaleString()} / 5,000
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || !dirty || !nameIsValid}
            className="primary-button"
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
          {dirty && <p className="text-xs text-amber-300">You have unsaved changes.</p>}
        </div>
      </form>
    </div>
  );
}
