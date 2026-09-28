import { describe, expect, it } from "vitest";
import { indexLinkLabel, makeIndexLink, parseIndexLinks, splitIndexLinkedText } from "./links";

describe("world index links", () => {
  it("round-trips resolved and manual links", () => {
    const value = `Met ${makeIndexLink("Captain Vey", "entry-1")} near ${makeIndexLink("Glass Gate")}.`;
    expect(parseIndexLinks(value)).toEqual([
      { label: "Captain Vey", entryId: "entry-1", suggestedCategory: null },
      { label: "Glass Gate", entryId: null, suggestedCategory: null },
    ]);
    expect(indexLinkLabel(value)).toBe("Met Captain Vey near Glass Gate.");
  });

  it("removes token delimiters from manually entered labels", () => {
    expect(makeIndexLink("  Odd [name] | draft  ")).toBe("[[Odd name  draft]]");
  });

  it("retains a category hint for unresolved field references", () => {
    expect(parseIndexLinks(makeIndexLink("Sun blade", undefined, "item_type"))).toEqual([
      { label: "Sun blade", entryId: null, suggestedCategory: "item_type" },
    ]);
  });

  it("splits display text without losing surrounding prose", () => {
    expect(splitIndexLinkedText("Before [[Gate|index:one]] after.")).toEqual([
      { kind: "text", value: "Before " },
      { kind: "link", label: "Gate", entryId: "one", suggestedCategory: null },
      { kind: "text", value: " after." },
    ]);
  });
});
