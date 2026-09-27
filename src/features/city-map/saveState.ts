export type CitySaveIntent = "none" | "save" | "save-preview" | "generate-and-save";

type CitySaveActionInput = {
  savePhase: "idle" | "generating" | "saving";
  generatingPreview: boolean;
  hasDisplayedMap: boolean;
  generatorOpen: boolean;
  previewReady: boolean;
  dirty: boolean;
};

export type CitySaveAction = {
  intent: CitySaveIntent;
  label: string;
  disabled: boolean;
};

export function citySaveAction({
  savePhase,
  generatingPreview,
  hasDisplayedMap,
  generatorOpen,
  previewReady,
  dirty,
}: CitySaveActionInput): CitySaveAction {
  if (savePhase === "generating") {
    return { intent: "none", label: "Generating & saving…", disabled: true };
  }
  if (savePhase === "saving") {
    return { intent: "none", label: "Saving…", disabled: true };
  }
  if (generatingPreview) {
    return { intent: "none", label: "Generating…", disabled: true };
  }
  if (generatorOpen && !previewReady) {
    return { intent: "generate-and-save", label: "Generate & save plan", disabled: false };
  }
  if (generatorOpen && previewReady) {
    return { intent: "save-preview", label: "Apply & save plan", disabled: false };
  }
  if (hasDisplayedMap && dirty) {
    return { intent: "save", label: "Save city plan", disabled: false };
  }
  if (hasDisplayedMap) {
    return { intent: "none", label: "Saved", disabled: true };
  }
  return { intent: "none", label: "Save unavailable", disabled: true };
}
