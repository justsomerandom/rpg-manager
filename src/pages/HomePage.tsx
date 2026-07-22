import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Link, useBlocker } from "react-router-dom";
import { getErrorMessage } from "../api/client";
import { deleteWorld, listWorlds, type World } from "../api/worlds";
import cityIcon from "../assets/map-icons/settlements/city.svg";
import mountainIcon from "../assets/map-icons/terrain/mountain.svg";
import forestIcon from "../assets/map-icons/vegetation/forest.svg";
import { DeleteWorldDialog } from "../components/home/DeleteWorldDialog";
import { useCloseGuard, type CloseGuardRequest } from "../hooks/useCloseGuard";

const loadCreateWorldDialog = () => import("../components/home/CreateWorldDialog");
const CreateWorldDialog = lazy(() =>
  loadCreateWorldDialog().then((module) => ({ default: module.CreateWorldDialog }))
);

const worldDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatCreatedDate(timestamp: number) {
  const date = new Date(timestamp * 1_000);
  return Number.isFinite(date.getTime()) ? worldDateFormatter.format(date) : "Date unavailable";
}

function createdDateTime(timestamp: number) {
  const date = new Date(timestamp * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function BrandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-7 w-7" fill="none">
      <path
        d="M24 4 41 13.8v20.4L24 44 7 34.2V13.8L24 4Z"
        fill="currentColor"
        fillOpacity=".12"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="m24 11 5 12-5 14-5-14 5-12Z" fill="currentColor" fillOpacity=".22" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="24" cy="24" r="3" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M4 10h12m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M4 6h12M8 6V4h4v2M6.5 6l.7 10h5.6l.7-10M8.5 9v4m3-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StorageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M4 6c0-1.1 2.7-2 6-2s6 .9 6 2-2.7 2-6 2-6-.9-6-2Zm0 0v4c0 1.1 2.7 2 6 2s6-.9 6-2V6m-12 4v4c0 1.1 2.7 2 6 2s6-.9 6-2v-4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function WorldGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className="h-16 w-16" fill="none">
      <circle cx="32" cy="32" r="23" stroke="currentColor" strokeWidth="1.5" opacity=".7" />
      <path d="M12 35c7-6 11-3 16-8 6-6 11-2 23-7M17 47c7-8 13-6 19-12 5-5 9-3 16-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
      <path d="m32 17 4.5 11L32 46l-4.5-18L32 17Z" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="32" cy="32" r="2.5" fill="currentColor" />
    </svg>
  );
}

function NavigationGuardDialog({
  open,
  pending,
  onStay,
  onLeave,
}: {
  open: boolean;
  pending: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby="leave-draft-title"
      aria-describedby="leave-draft-description"
      className="world-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onStay();
      }}
    >
      <section className="dialog-surface mx-auto max-w-md overflow-hidden">
        <div className="p-6 sm:p-7">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M12 8v5m0 3.5v.1M4.7 19h14.6a1.5 1.5 0 0 0 1.3-2.25L13.3 4a1.5 1.5 0 0 0-2.6 0L3.4 16.75A1.5 1.5 0 0 0 4.7 19Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <h2 id="leave-draft-title" className="font-display text-2xl font-semibold text-brand-glow">
            {pending ? "World creation is still running" : "Leave without this draft?"}
          </h2>
          <p id="leave-draft-description" className="mt-2 text-sm leading-6 text-slate-300">
            {pending
              ? "Wait for creation to finish before leaving this page. This protects the world from an incomplete setup."
              : "Your world details and template changes have not been created. Leaving now will discard them."}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-grove-700 bg-grove-900/70 px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" className="secondary-button min-h-11" autoFocus onClick={onStay}>
            {pending ? "Wait here" : "Keep editing"}
          </button>
          {!pending && (
            <button type="button" className="danger-button min-h-11" onClick={onLeave}>
              Discard draft and leave
            </button>
          )}
        </div>
      </section>
    </dialog>
  );
}

function NativeCloseGuardDialog({
  request,
  onDismiss,
  onConfirm,
}: {
  request: CloseGuardRequest | null;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmable = request?.kind === "confirm";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    else if (!request && dialog.open) dialog.close();
  }, [request]);

  const title =
    request?.kind === "confirm"
      ? "Close and discard this draft?"
      : request?.kind === "pending"
        ? "Please wait before closing"
        : "The application stayed open";

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby="native-close-title"
      aria-describedby="native-close-description"
      className="world-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <section className="dialog-surface mx-auto max-w-md overflow-hidden">
        <div className="p-6 sm:p-7">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M12 8v5m0 3.5v.1M4.7 19h14.6a1.5 1.5 0 0 0 1.3-2.25L13.3 4a1.5 1.5 0 0 0-2.6 0L3.4 16.75A1.5 1.5 0 0 0 4.7 19Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <h2 id="native-close-title" className="font-display text-2xl font-semibold text-brand-glow">
            {title}
          </h2>
          <p id="native-close-description" className="mt-2 text-sm leading-6 text-slate-300">
            {request?.message}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-grove-700 bg-grove-900/70 px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" className="secondary-button min-h-11" autoFocus onClick={onDismiss}>
            {confirmable ? "Keep app open" : "Okay"}
          </button>
          {confirmable && (
            <button type="button" className="danger-button min-h-11" onClick={onConfirm}>
              Discard draft and close
            </button>
          )}
        </div>
      </section>
    </dialog>
  );
}

export function HomePage() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<World | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [pendingFocusWorldId, setPendingFocusWorldId] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const collectionRevisionRef = useRef(0);
  const deletingIdsRef = useRef<Set<string>>(new Set());
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null);

  const navigationBlocked = createDirty || creating;
  const blocker = useBlocker(navigationBlocked);
  const deletionPending = deletingIds.size > 0;
  const closePending = creating || deletionPending;

  const { closeRequest, dismissCloseRequest, confirmCloseRequest } = useCloseGuard({
    active: navigationBlocked || deletionPending,
    pending: closePending,
    pendingMessage: creating
      ? "Your world is still being created. Wait for it to finish before closing the application."
      : "A world is still being deleted. Wait for it to finish before closing the application.",
    confirmMessage: "Discard this unsaved world draft and close the application?",
    interactive: true,
  });

  useEffect(() => {
    const requestId = ++loadRequestRef.current;
    const startingRevision = collectionRevisionRef.current;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    listWorlds()
      .then((loadedWorlds) => {
        if (cancelled || requestId !== loadRequestRef.current) return;
        if (startingRevision !== collectionRevisionRef.current) {
          setReloadKey((current) => current + 1);
          return;
        }
        setWorlds(loadedWorlds);
      })
      .catch((error) => {
        if (cancelled || requestId !== loadRequestRef.current) return;
        if (startingRevision !== collectionRevisionRef.current) {
          setReloadKey((current) => current + 1);
          return;
        }
        setLoadError(getErrorMessage(error, "We couldn't load your world library."));
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    const preloadTimer = window.setTimeout(() => {
      void loadCreateWorldDialog();
    }, 800);
    return () => window.clearTimeout(preloadTimer);
  }, []);

  useEffect(() => {
    if (!pendingFocusWorldId) return;
    const target = document.getElementById(`open-world-${pendingFocusWorldId}`);
    if (target instanceof HTMLElement) {
      target.focus();
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
    } else {
      libraryHeadingRef.current?.focus();
    }
    setPendingFocusWorldId(null);
  }, [pendingFocusWorldId, worlds]);

  const openCreateDialog = (event: ReactMouseEvent<HTMLButtonElement>) => {
    void loadCreateWorldDialog();
    createTriggerRef.current = event.currentTarget;
    setMessage(null);
    setCreateOpen(true);
  };

  const dismissCreateDialog = useCallback(() => {
    setCreateOpen(false);
    window.requestAnimationFrame(() => createTriggerRef.current?.focus());
  }, []);

  const handleWorldCreated = useCallback((world: World) => {
    collectionRevisionRef.current += 1;
    setWorlds((current) => [world, ...current.filter((candidate) => candidate.id !== world.id)]);
    setLoadError(null);
    setCreateDirty(false);
    setCreateOpen(false);
    setMessage(`“${world.name}” is ready.`);
    setPendingFocusWorldId(world.id);
  }, []);

  const requestDelete = (event: ReactMouseEvent<HTMLButtonElement>, world: World) => {
    deleteTriggerRef.current = event.currentTarget;
    setMessage(null);
    setDeleteErrors((current) => {
      const next = { ...current };
      delete next[world.id];
      return next;
    });
    setDeleteTarget(world);
  };

  const cancelDelete = () => {
    if (deleteTarget && deletingIds.has(deleteTarget.id)) return;
    setDeleteTarget(null);
    window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  };

  const confirmDelete = async (world: World) => {
    if (deletingIdsRef.current.has(world.id)) return;
    deletingIdsRef.current.add(world.id);
    setDeletingIds((current) => new Set(current).add(world.id));
    setDeleteErrors((current) => {
      const next = { ...current };
      delete next[world.id];
      return next;
    });
    setMessage(null);

    try {
      await deleteWorld(world.id);
      collectionRevisionRef.current += 1;
      setWorlds((current) => current.filter((candidate) => candidate.id !== world.id));
      setLoadError(null);
      setDeleteTarget(null);
      setMessage(`“${world.name}” was deleted.`);
      window.requestAnimationFrame(() => libraryHeadingRef.current?.focus());
    } catch (error) {
      setDeleteErrors((current) => ({
        ...current,
        [world.id]: getErrorMessage(error, "We couldn't delete this world."),
      }));
    } finally {
      deletingIdsRef.current.delete(world.id);
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(world.id);
        return next;
      });
    }
  };

  const worldCountLabel = `${worlds.length} ${worlds.length === 1 ? "world" : "worlds"}`;
  const initialLoading = loading && worlds.length === 0;
  const initialLoadFailed = !loading && Boolean(loadError) && worlds.length === 0;

  return (
    <main className="home-page">
      <div className="home-atmosphere" aria-hidden="true" />
      <div className="home-container">
        <header className="home-masthead">
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-emblem text-emerald-200">
              <BrandMark />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-semibold tracking-tight text-brand-glow">
                RPG Manager
              </p>
              <p className="hidden text-xs text-slate-400 sm:block">Campaigns, lore, and maps in one place</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div
              className="hidden min-h-10 items-center gap-2 rounded-xl border border-grove-600/70 bg-grove-900/55 px-3 text-xs font-medium text-slate-300 md:flex"
              title="Your campaign data is stored on this device."
            >
              <StorageIcon />
              Stored locally
            </div>
            <button type="button" className="primary-button min-h-11 gap-2" onClick={openCreateDialog}>
              <PlusIcon />
              <span>New world</span>
            </button>
          </div>
        </header>

        <section className="home-hero" aria-labelledby="world-library-heading">
          <div className="max-w-3xl">
            <p className="section-label">Campaign library</p>
            <h1
              id="world-library-heading"
              ref={libraryHeadingRef}
              tabIndex={-1}
              className="mt-3 rounded-lg font-display text-4xl font-semibold leading-[1.08] tracking-tight text-brand-glow outline-none focus-visible:ring-2 focus-visible:ring-earth-sand focus-visible:ring-offset-4 focus-visible:ring-offset-grove-900 sm:text-5xl"
            >
              Choose your world
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              Return to an existing campaign, or begin a new setting with a structure that is ready when you are.
            </p>
          </div>
          <div className="world-count-pill" aria-label={worldCountLabel}>
            <span className="h-2 w-2 rounded-full bg-brand shadow-[0_0_12px_rgba(31,156,115,.85)]" />
            {loading && worlds.length > 0 ? "Refreshing…" : worldCountLabel}
          </div>
        </section>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {deletionPending
            ? `Deleting ${deletingIds.size} ${deletingIds.size === 1 ? "world" : "worlds"}`
            : ""}
        </div>

        {message && (
          <div className="status-success flex items-center justify-between gap-4" role="status">
            <span>{message}</span>
            <button
              type="button"
              className="min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-900/50"
              onClick={() => setMessage(null)}
              aria-label="Dismiss notification"
            >
              Dismiss
            </button>
          </div>
        )}

        {loadError && worlds.length > 0 && (
          <div className="status-warning flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>{loadError} Your current library remains available.</span>
            <button type="button" className="secondary-button min-h-11 shrink-0" onClick={() => setReloadKey((key) => key + 1)}>
              Retry loading
            </button>
          </div>
        )}

        <section aria-label="Your worlds" aria-busy={loading}>
          {initialLoading && (
            <div className="world-grid" role="status" aria-label="Loading your worlds">
              {[0, 1, 2].map((item) => (
                <div key={item} className="world-card overflow-hidden" aria-hidden="true">
                  <div className="h-28 animate-pulse bg-grove-700/55" />
                  <div className="space-y-3 p-5">
                    <div className="h-5 w-2/3 animate-pulse rounded bg-grove-700" />
                    <div className="h-4 w-1/3 animate-pulse rounded bg-grove-700/70" />
                    <div className="h-10 animate-pulse rounded bg-grove-800" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {initialLoadFailed && (
            <div className="library-state-card" role="alert">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-400/25 bg-red-950/25 text-red-200">
                <WorldGlyph />
              </div>
              <h2 className="mt-5 font-display text-2xl font-semibold text-brand-glow">Your library could not be loaded</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-300">{loadError}</p>
              <button type="button" className="primary-button mt-6 min-h-11" onClick={() => setReloadKey((key) => key + 1)}>
                Try again
              </button>
            </div>
          )}

          {!loading && !loadError && worlds.length === 0 && (
            <div className="library-state-card overflow-hidden">
              <div className="empty-landscape" aria-hidden="true">
                <img src={mountainIcon} alt="" className="h-16 w-16 opacity-70" />
                <img src={forestIcon} alt="" className="h-14 w-14 -translate-y-1 opacity-90" />
                <img src={cityIcon} alt="" className="h-12 w-12 opacity-80" />
              </div>
              <h2 className="mt-5 font-display text-2xl font-semibold text-brand-glow">Your first world is waiting</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-300">
                Build a campaign home for characters, lore, maps, and the details that make a setting feel alive.
              </p>
              <button type="button" className="primary-button mt-6 min-h-11 gap-2" onClick={openCreateDialog}>
                <PlusIcon />
                Create your first world
              </button>
            </div>
          )}

          {worlds.length > 0 && (
            <ul className="world-grid">
              {worlds.map((world) => {
                const deleting = deletingIds.has(world.id);
                const deleteError = deleteErrors[world.id];
                const dateTime = createdDateTime(world.created_at);
                return (
                  <li key={world.id} className="min-w-0">
                    <article className="world-card group" aria-busy={deleting}>
                      <div className="world-card-art" aria-hidden="true">
                        <div className="world-card-orbit world-card-orbit-one" />
                        <div className="world-card-orbit world-card-orbit-two" />
                        <div className="relative z-[1] text-emerald-100/80">
                          <WorldGlyph />
                        </div>
                        <span className="relative z-[1] rounded-full border border-white/10 bg-grove-900/70 px-3 py-1 text-xs font-semibold text-earth-sand backdrop-blur">
                          {world.game_system.trim() || "Custom system"}
                        </span>
                      </div>
                      <div className="flex min-h-[14.5rem] flex-col p-5">
                        <div className="min-w-0">
                          <h2 className="break-words font-display text-xl font-semibold leading-7 text-brand-glow">
                            {world.name}
                          </h2>
                          <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-slate-400">
                            {world.description.trim() || "No description yet — open the world to begin shaping its story."}
                          </p>
                        </div>
                        <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                            <path d="M5 3v3m10-3v3M3.5 8h13M5 5h10a2 2 0 0 1 2 2v9H3V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          </svg>
                          <span>Created </span>
                          <time dateTime={dateTime}>{formatCreatedDate(world.created_at)}</time>
                        </div>

                        {deleteError && (
                          <p className="mt-4 rounded-xl border border-red-400/35 bg-red-950/30 px-3 py-2 text-sm leading-5 text-red-100" role="alert">
                            {deleteError}
                          </p>
                        )}

                        <div className="mt-auto flex items-center justify-between gap-3 border-t border-grove-700/70 pt-4">
                          <Link
                            id={`open-world-${world.id}`}
                            to={`/world/${world.id}/overview`}
                            className={`inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-1 text-sm font-semibold text-emerald-200 transition hover:text-emerald-100 ${
                              deleting ? "pointer-events-none opacity-50" : ""
                            }`}
                            aria-label={`Open ${world.name}`}
                            aria-disabled={deleting || undefined}
                            tabIndex={deleting ? -1 : undefined}
                          >
                            <span>Open world</span>
                            <ArrowIcon />
                          </Link>
                          <button
                            id={`delete-world-${world.id}`}
                            type="button"
                            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-400 transition hover:bg-red-950/35 hover:text-red-200"
                            onClick={(event) => requestDelete(event, world)}
                            disabled={deleting}
                            aria-label={`Delete ${world.name}`}
                          >
                            <TrashIcon />
                            <span>{deleting ? "Deleting…" : "Delete"}</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {createOpen && (
        <Suspense fallback={null}>
          <CreateWorldDialog
            open
            onDismiss={dismissCreateDialog}
            onCreated={handleWorldCreated}
            onDirtyChange={setCreateDirty}
            onPendingChange={setCreating}
          />
        </Suspense>
      )}
      <DeleteWorldDialog
        world={deleteTarget}
        deleting={Boolean(deleteTarget && deletingIds.has(deleteTarget.id))}
        error={deleteTarget ? deleteErrors[deleteTarget.id] ?? null : null}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
      <NavigationGuardDialog
        open={blocker.state === "blocked"}
        pending={creating}
        onStay={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
        onLeave={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
      <NativeCloseGuardDialog
        request={closeRequest}
        onDismiss={dismissCloseRequest}
        onConfirm={() => void confirmCloseRequest()}
      />
    </main>
  );
}
