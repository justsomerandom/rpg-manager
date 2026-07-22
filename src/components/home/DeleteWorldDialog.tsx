import { useEffect, useRef } from "react";
import type { World } from "../../api/worlds";

type DeleteWorldDialogProps = {
  world: World | null;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (world: World) => void;
};

export function DeleteWorldDialog({
  world,
  deleting,
  error,
  onCancel,
  onConfirm,
}: DeleteWorldDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (world && !dialog.open) {
      dialog.showModal();
      cancelButtonRef.current?.focus();
    } else if (!world && dialog.open) {
      dialog.close();
    }
  }, [world]);

  const cancel = () => {
    if (!deleting) onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby="delete-world-title"
      aria-describedby="delete-world-description"
      aria-busy={deleting}
      className="m-auto w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-2xl border border-grove-600 bg-grove-900 p-0 text-brand-glow shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      {world && (
        <div>
          <div className="p-6 sm:p-7">
            <div
              className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-red-400/35 bg-red-950/45 text-red-200"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
              </svg>
            </div>

            <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-200/80">
              Permanent action
            </p>
            <h2 id="delete-world-title" className="mt-2 font-display text-2xl font-semibold text-brand-glow">
              Delete world?
            </h2>
            <p id="delete-world-description" className="mt-3 text-sm leading-6 text-slate-300">
              This will permanently delete <strong className="font-semibold text-brand-glow break-words">{world.name}</strong> and all of its characters, lore, index entries, and maps. This cannot be undone.
            </p>

            {error && (
              <p className="status-error mt-5" role="alert">
                {error}
              </p>
            )}

            {deleting && (
              <p className="mt-5 flex items-center gap-3 text-sm text-slate-300" role="status">
                <span
                  className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-grove-600 border-t-red-300"
                  aria-hidden="true"
                />
                Deleting {world.name}…
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-grove-600/70 bg-grove-800/55 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <button
              ref={cancelButtonRef}
              type="button"
              className="secondary-button min-h-11"
              disabled={deleting}
              onClick={cancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger-button min-h-11"
              disabled={deleting}
              onClick={() => onConfirm(world)}
            >
              {deleting ? "Deleting…" : "Delete world"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
