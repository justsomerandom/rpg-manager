import { useEffect, useId, useRef, type ReactNode } from "react";

type ConfirmDialogProps = {
  open: boolean;
  eyebrow?: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  eyebrow = "Review change",
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const cancel = () => {
    if (!busy) onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      className="m-auto w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-3xl border border-grove-600/90 bg-grove-900 p-0 text-brand-glow shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      {open && (
        <div>
          <div className="p-6 sm:p-7">
            <div className={`mb-5 flex h-11 w-11 items-center justify-center rounded-xl border ${danger ? "border-red-400/35 bg-red-950/45 text-red-200" : "border-earth-clay/40 bg-earth-clay/10 text-earth-sand"}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d={danger ? "M12 3 2.8 20h18.4L12 3Zm0 6v5m0 3h.01" : "M12 3v12m0 4h.01M5 8.5 12 3l7 5.5"} />
              </svg>
            </div>
            <p className={`text-xs font-bold uppercase tracking-[0.16em] ${danger ? "text-red-200/80" : "text-earth-sand/75"}`}>{eyebrow}</p>
            <h2 id={titleId} className="mt-2 font-display text-2xl font-semibold text-brand-glow">{title}</h2>
            <div id={descriptionId} className="mt-3 text-sm leading-6 text-slate-300">{description}</div>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-grove-600/70 bg-grove-800/55 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <button ref={cancelRef} type="button" className="secondary-button min-h-11" disabled={busy} onClick={cancel}>
              {cancelLabel}
            </button>
            <button type="button" className={`${danger ? "danger-button" : "primary-button"} min-h-11`} disabled={busy} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
