import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getErrorMessage } from "../../api/client";
import { createWorldWithTemplates, type World } from "../../api/worlds";
import {
  SETUP_SECTIONS,
  buildTemplatePayload,
  createDefaultWorldSetup,
  getSectionCount,
  validateWorldDetails,
  validateWorldSetup,
  type SetupValidationIssue,
  type WorldSetupSection,
  type WorldSetupTemplates,
} from "../../state/worldSetup";
import { WorldSetupEditor } from "../WorldSetupEditor";

type CreateWorldDialogProps = {
  open: boolean;
  onDismiss: () => void;
  onCreated: (world: World) => void;
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
};

type WizardStep = "details" | "setup";

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none">
      <path
        d="m5 5 10 10M15 5 5 15"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="m18.5 16 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" fill="currentColor" />
    </svg>
  );
}

function ArrowIcon({ direction = "right" }: { direction?: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={`h-4 w-4 ${direction === "left" ? "rotate-180" : ""}`}
      fill="none"
    >
      <path d="M4 10h12m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const focusIssue = (issue: SetupValidationIssue, summary: HTMLDivElement | null) => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (issue.fieldId) {
        const directField = document.getElementById(issue.fieldId);
        const nestedField = document
          .getElementById(`setup-field-${issue.fieldId}`)
          ?.querySelector<HTMLElement>("input, select, textarea, button");
        const target = directField ?? nestedField;
        if (target instanceof HTMLElement) {
          target.focus();
          target.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            block: "center",
          });
          return;
        }
      }
      summary?.focus();
    });
  });
};

export function CreateWorldDialog({
  open,
  onDismiss,
  onCreated,
  onDirtyChange,
  onPendingChange,
}: CreateWorldDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const creatingRef = useRef(false);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<WizardStep>("details");
  const [name, setName] = useState("");
  const [gameSystem, setGameSystem] = useState("Custom");
  const [templates, setTemplates] = useState<WorldSetupTemplates>(() =>
    createDefaultWorldSetup()
  );
  const [templateDirty, setTemplateDirty] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [activeSection, setActiveSection] = useState<WorldSetupSection>("character");
  const [issue, setIssue] = useState<SetupValidationIssue | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [resetUndoTemplates, setResetUndoTemplates] =
    useState<WorldSetupTemplates | null>(null);

  const dirty =
    Boolean(name.trim()) || (gameSystem.trim() || "Custom") !== "Custom" || templateDirty;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => nameInputRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const summaryItems = useMemo(
    () =>
      SETUP_SECTIONS.map((section) => ({
        ...section,
        count: getSectionCount(templates, section.id),
      })),
    [templates]
  );

  const resetDraft = () => {
    setStep("details");
    setName("");
    setGameSystem("Custom");
    setTemplates(createDefaultWorldSetup());
    setTemplateDirty(false);
    setCustomizing(false);
    setActiveSection("character");
    setIssue(null);
    setRequestError(null);
    setConfirmDiscard(false);
    setResetUndoTemplates(null);
    onDirtyChange(false);
  };

  const discardAndDismiss = () => {
    if (creatingRef.current) return;
    resetDraft();
    onDismiss();
  };

  const requestDismiss = () => {
    if (creatingRef.current) return;
    if (dirty) {
      discardReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmDiscard(true);
      return;
    }
    discardAndDismiss();
  };

  const keepEditing = () => {
    setConfirmDiscard(false);
    window.requestAnimationFrame(() => {
      (discardReturnFocusRef.current ?? nameInputRef.current)?.focus();
    });
  };

  const handleContinue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextIssue = validateWorldDetails(name, gameSystem);
    if (nextIssue) {
      setIssue(nextIssue);
      focusIssue(nextIssue, errorSummaryRef.current);
      return;
    }
    setIssue(null);
    setRequestError(null);
    setStep("setup");
  };

  const handleTemplateChange = (
    updater: (current: WorldSetupTemplates) => WorldSetupTemplates
  ) => {
    setTemplates(updater);
    setTemplateDirty(true);
    setResetUndoTemplates(null);
    setIssue(null);
    setRequestError(null);
  };

  const resetTemplates = () => {
    setResetUndoTemplates(templates);
    setTemplates(createDefaultWorldSetup());
    setTemplateDirty(false);
    setCustomizing(false);
    setActiveSection("character");
    setIssue(null);
    setRequestError(null);
  };

  const undoTemplateReset = () => {
    if (!resetUndoTemplates) return;
    setTemplates(resetUndoTemplates);
    setTemplateDirty(true);
    setResetUndoTemplates(null);
    setRequestError(null);
    setIssue(null);
  };

  const handleCreate = async () => {
    if (creatingRef.current) return;
    const nextIssue = validateWorldSetup(name, gameSystem, templates);
    if (nextIssue) {
      setIssue(nextIssue);
      setRequestError(null);
      setStep(nextIssue.step);
      if (nextIssue.section) {
        setCustomizing(true);
        setActiveSection(nextIssue.section);
      }
      focusIssue(nextIssue, errorSummaryRef.current);
      return;
    }

    creatingRef.current = true;
    onPendingChange(true);
    setCreating(true);
    setIssue(null);
    setRequestError(null);
    try {
      const world = await createWorldWithTemplates(
        name.trim(),
        gameSystem.trim() || "Custom",
        buildTemplatePayload(templates)
      );
      resetDraft();
      onCreated(world);
    } catch (error) {
      setRequestError(getErrorMessage(error, "We couldn't create this world."));
      window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
    } finally {
      creatingRef.current = false;
      onPendingChange(false);
      setCreating(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="world-dialog"
      role={confirmDiscard ? "alertdialog" : undefined}
      aria-labelledby={confirmDiscard ? "discard-world-title" : "create-world-title"}
      aria-describedby={confirmDiscard ? "discard-world-description" : "create-world-description"}
      onCancel={(event) => {
        event.preventDefault();
        if (confirmDiscard) keepEditing();
        else requestDismiss();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !confirmDiscard) requestDismiss();
      }}
    >
      {confirmDiscard ? (
        <section className="dialog-surface mx-auto max-w-md overflow-hidden">
          <div className="p-6 sm:p-7">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <path d="M12 8v5m0 3.5v.1M4.7 19h14.6a1.5 1.5 0 0 0 1.3-2.25L13.3 4a1.5 1.5 0 0 0-2.6 0L3.4 16.75A1.5 1.5 0 0 0 4.7 19Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <h2 id="discard-world-title" className="font-display text-2xl font-semibold text-brand-glow">
              Discard this world draft?
            </h2>
            <p id="discard-world-description" className="mt-2 text-sm leading-6 text-slate-300">
              Your world details and any template changes will be removed. No world has been created yet.
            </p>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-grove-700 bg-grove-900/70 px-6 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="secondary-button min-h-11"
              autoFocus
              onClick={keepEditing}
            >
              Keep editing
            </button>
            <button type="button" className="danger-button min-h-11" onClick={discardAndDismiss}>
              Discard draft
            </button>
          </div>
        </section>
      ) : (
        <section className="dialog-surface flex max-h-[min(92vh,900px)] w-full max-w-5xl flex-col overflow-hidden">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-grove-700/80 px-5 py-4 sm:px-7 sm:py-5">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-earth-sand/80">
                <span>New world</span>
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-grove-600" />
                <span>Step {step === "details" ? "1" : "2"} of 2</span>
              </div>
              <h2 id="create-world-title" className="truncate font-display text-2xl font-semibold text-brand-glow sm:text-3xl">
                {step === "details" ? "Name your next world" : `Set up ${name.trim() || "your world"}`}
              </h2>
              <p id="create-world-description" className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
                {step === "details"
                  ? "Start with the essentials. You can change these details inside the world later."
                  : "Use the ready-made starter structure, or tailor it before creating the world."}
              </p>
            </div>
            <button
              type="button"
              className="icon-button shrink-0"
              aria-label="Cancel world creation"
              onClick={requestDismiss}
              disabled={creating}
            >
              <CloseIcon />
            </button>
          </header>

          <div className="h-1 shrink-0 bg-grove-800">
            <div
              className={`h-full bg-gradient-to-r from-brand to-emerald-300 transition-[width] duration-300 ${
                step === "details" ? "w-1/2" : "w-full"
              }`}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            {(issue || requestError) && (
              <div
                ref={errorSummaryRef}
                id="world-setup-error"
                tabIndex={-1}
                className="status-error mb-5 outline-none"
                role="alert"
                aria-live="assertive"
              >
                <p className="font-semibold">Check this setup</p>
                <p className="mt-1">{issue?.message ?? requestError}</p>
              </div>
            )}

            <fieldset disabled={creating} aria-busy={creating}>
              {step === "details" && (
                <form id="world-details-form" onSubmit={handleContinue} className="mx-auto max-w-2xl space-y-6">
                  <div className="rounded-2xl border border-grove-600/70 bg-grove-900/35 p-5 sm:p-6">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-emerald-200">
                      <SparkIcon />
                    </div>
                    <div>
                      <label htmlFor="world-name" className="mb-2 block text-sm font-semibold text-brand-glow">
                        World name <span className="text-emerald-300" aria-hidden="true">*</span>
                      </label>
                      <input
                        ref={nameInputRef}
                        id="world-name"
                        className="input-field text-base"
                        placeholder="The Shattered Coast"
                        value={name}
                        maxLength={200}
                        autoComplete="off"
                        aria-invalid={issue?.fieldId === "world-name" || undefined}
                        aria-describedby={
                          issue?.fieldId === "world-name"
                            ? "world-name-help world-setup-error"
                            : "world-name-help"
                        }
                        onChange={(event) => {
                          setName(event.target.value);
                          setIssue(null);
                          setRequestError(null);
                        }}
                      />
                      <p id="world-name-help" className="mt-2 text-sm leading-5 text-slate-400">
                        This is the title shown in your world library and workspace navigation.
                      </p>
                    </div>
                    <div className="mt-5">
                      <label htmlFor="world-system" className="mb-2 block text-sm font-semibold text-brand-glow">
                        Game system
                      </label>
                      <input
                        id="world-system"
                        className="input-field"
                        placeholder="Custom, D&D 5e, Pathfinder…"
                        value={gameSystem}
                        maxLength={200}
                        autoComplete="off"
                        aria-invalid={issue?.fieldId === "world-system" || undefined}
                        aria-describedby={
                          issue?.fieldId === "world-system"
                            ? "world-system-help world-setup-error"
                            : "world-system-help"
                        }
                        onChange={(event) => {
                          setGameSystem(event.target.value);
                          setIssue(null);
                          setRequestError(null);
                        }}
                      />
                      <p id="world-system-help" className="mt-2 text-sm leading-5 text-slate-400">
                        Leave this blank to use a system-neutral custom setup.
                      </p>
                    </div>
                  </div>
                </form>
              )}

              {step === "setup" && !customizing && (
                <div className="mx-auto max-w-3xl space-y-5">
                  <div className="flex flex-col gap-4 rounded-2xl border border-brand/25 bg-brand/10 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-200/80">World details</p>
                      <p className="mt-1 break-words font-display text-xl font-semibold text-brand-glow">{name.trim()}</p>
                      <p className="mt-1 text-sm text-slate-300">{gameSystem.trim() || "Custom"}</p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button min-h-11 shrink-0"
                      onClick={() => {
                        setIssue(null);
                        setStep("details");
                      }}
                    >
                      Edit details
                    </button>
                  </div>

                  <div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h3 className="font-display text-xl font-semibold text-brand-glow">Starter setup</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-300">
                          These defaults make the workspace useful immediately. Customize them now or use them as-is.
                        </p>
                      </div>
                      {templateDirty && (
                        <button
                          type="button"
                          className="min-h-11 rounded-xl px-3 text-sm font-medium text-earth-sand transition hover:bg-grove-700/70 hover:text-white"
                          onClick={resetTemplates}
                        >
                          Reset starter setup
                        </button>
                      )}
                    </div>
                    {resetUndoTemplates && (
                      <div className="status-info mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="status">
                        <span>The starter setup was reset to its defaults.</span>
                        <button
                          type="button"
                          className="min-h-10 shrink-0 rounded-lg px-3 text-sm font-semibold text-emerald-100 transition hover:bg-brand/15"
                          onClick={undoTemplateReset}
                        >
                          Undo reset
                        </button>
                      </div>
                    )}
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      {summaryItems.map((item) => (
                        <div key={item.id} className="rounded-xl border border-grove-600/70 bg-grove-900/45 p-4">
                          <p className="text-2xl font-semibold text-brand-glow">{item.count}</p>
                          <p className="mt-1 text-sm font-medium text-slate-200">{item.shortLabel}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl border border-grove-600 bg-grove-800/50 px-5 py-3 text-left transition hover:border-brand/60 hover:bg-grove-800"
                    onClick={() => setCustomizing(true)}
                  >
                    <span>
                      <span className="block text-sm font-semibold text-brand-glow">
                        {templateDirty ? "Continue customizing templates" : "Customize templates"}
                      </span>
                      <span className="mt-1 block text-sm text-slate-400">
                        Change character fields, NPCs, items, abilities, or custom record types.
                      </span>
                    </span>
                    <ArrowIcon />
                  </button>
                </div>
              )}

              {step === "setup" && customizing && (
                <div>
                  <div className="mb-5 flex flex-col gap-3 border-b border-grove-700/70 pb-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-earth-sand/80">Advanced setup</p>
                      <p className="mt-1 text-sm text-slate-300">
                        Work through one template group at a time. Your changes stay in place as you switch sections.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button min-h-11 shrink-0"
                      onClick={() => {
                        setIssue(null);
                        setCustomizing(false);
                      }}
                    >
                      Done customizing
                    </button>
                  </div>
                  <WorldSetupEditor
                    templates={templates}
                    activeSection={activeSection}
                    issue={issue?.step === "setup" ? issue : null}
                    errorMessageId="world-setup-error"
                    onSectionChange={(section) => {
                      setActiveSection(section);
                      setIssue(null);
                    }}
                    onChange={handleTemplateChange}
                  />
                </div>
              )}
            </fieldset>
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-grove-700/80 bg-grove-900/90 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <button
              type="button"
              className="secondary-button min-h-11"
              onClick={requestDismiss}
              disabled={creating}
            >
              Cancel
            </button>
            {step === "details" ? (
              <button
                type="submit"
                form="world-details-form"
                className="primary-button min-h-11 gap-2"
                disabled={creating}
              >
                Continue
                <ArrowIcon />
              </button>
            ) : (
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <button
                  type="button"
                  className="secondary-button min-h-11 gap-2"
                  onClick={() => {
                    setIssue(null);
                    setStep("details");
                  }}
                  disabled={creating}
                >
                  <ArrowIcon direction="left" />
                  Back to details
                </button>
                <button
                  type="button"
                  className="primary-button min-h-11 min-w-36 gap-2"
                  onClick={handleCreate}
                  disabled={creating}
                >
                  {creating ? (
                    <>
                      <span className="loading-dot !mr-0" />
                      Creating world…
                    </>
                  ) : (
                    <>
                      Create world
                      <ArrowIcon />
                    </>
                  )}
                </button>
              </div>
            )}
          </footer>
        </section>
      )}
    </dialog>
  );
}
