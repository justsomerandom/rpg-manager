import { describe, expect, it } from "vitest";
import { citySaveAction } from "./saveState";

const baseState = {
  savePhase: "idle" as const,
  generatingPreview: false,
  hasDisplayedMap: true,
  generatorOpen: false,
  previewReady: false,
  dirty: false,
};

describe("city save action", () => {
  it("generates and saves when the generator has no current preview", () => {
    expect(citySaveAction({ ...baseState, generatorOpen: true })).toEqual({
      intent: "generate-and-save",
      label: "Generate & save plan",
      disabled: false,
    });
  });

  it("applies and saves a current generated preview", () => {
    expect(citySaveAction({ ...baseState, generatorOpen: true, previewReady: true })).toMatchObject(
      { intent: "save-preview", disabled: false },
    );
  });

  it("saves dirty editor changes and clearly labels an unchanged plan", () => {
    expect(citySaveAction({ ...baseState, dirty: true })).toMatchObject({
      intent: "save",
      disabled: false,
    });
    expect(citySaveAction(baseState)).toMatchObject({
      intent: "none",
      label: "Saved",
      disabled: true,
    });
  });
});
