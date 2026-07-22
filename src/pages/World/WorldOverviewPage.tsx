import { useEffect, useState, type FormEvent } from "react";
import { useBlocker, useOutletContext, useParams } from "react-router-dom";
import { getErrorMessage } from "../../api/client";
import { updateWorld, type World } from "../../api/worlds";
import { useCloseGuard } from "../../hooks/useCloseGuard";
import type { WorldOutletContext } from "./WorldLayout";

const sameWorldDetails = (left: World, right: World) =>
  left.name === right.name &&
  left.game_system === right.game_system &&
  left.description === right.description;

export function WorldOverviewPage() {
  const { worldId } = useParams();
  const { world: layoutWorld, setWorld: setLayoutWorld } = useOutletContext<WorldOutletContext>();
  const [world, setWorld] = useState<World>(() => layoutWorld);
  const [savedWorld, setSavedWorld] = useState<World>(() => layoutWorld);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!worldId || layoutWorld.id !== worldId) return;
    setWorld(layoutWorld);
    setSavedWorld(layoutWorld);
    setSaveError(null);
    setSaveMessage(null);
  }, [layoutWorld.id, worldId]);

  const dirty = !sameWorldDetails(world, savedWorld);
  const nameIsValid = Boolean(world.name.trim());
  const navigationBlocked = dirty || saving;
  const blocker = useBlocker(navigationBlocked);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (saving) {
      window.alert("Your campaign is still being saved. Wait for it to finish before leaving this page.");
      blocker.reset();
      return;
    }
    if (window.confirm("Discard your unsaved campaign changes and leave this page?")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker, saving]);

  useCloseGuard({
    active: navigationBlocked,
    pending: saving,
    pendingMessage: "Your campaign is still being saved. Wait for it to finish before leaving this page.",
    confirmMessage: "Discard your unsaved campaign changes and leave this page?",
  });

  const updateDraft = (patch: Partial<Pick<World, "name" | "game_system" | "description">>) => {
    setWorld((current) => (current ? { ...current, ...patch } : current));
    setSaveError(null);
    setSaveMessage(null);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!worldId || layoutWorld.id !== worldId || world.id !== worldId || saving) return;

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
      setLayoutWorld(updated);
      setSaveMessage("Campaign details saved.");
    } catch (error) {
      setSaveError(getErrorMessage(error, "We couldn't save your changes."));
    } finally {
      setSaving(false);
    }
  };

  if (!worldId || layoutWorld.id !== worldId || world.id !== worldId) {
    return (
      <p className="status-info" role="status" aria-live="polite">
        Loading campaign…
      </p>
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
            disabled={saving}
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
            disabled={saving}
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
            disabled={saving}
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
