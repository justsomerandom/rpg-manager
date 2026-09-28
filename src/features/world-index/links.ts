import type { WorldEntry } from "../../api/worldEntries";

export type IndexLink = {
  label: string;
  entryId: string | null;
  suggestedCategory: string | null;
};

export type IndexTextPart = { kind: "text"; value: string } | ({ kind: "link" } & IndexLink);

const LINK_PATTERN = /\[\[([^\]|]{1,180})(?:\|(index|new):([^\]]{1,128}))?\]\]/g;

export function makeIndexLink(label: string, entryId?: string, suggestedCategory?: string): string {
  const safeLabel = label
    .trim()
    .split("[")
    .join("")
    .split("]")
    .join("")
    .split("|")
    .join("")
    .slice(0, 180);
  if (!safeLabel) return "";
  if (entryId) return `[[${safeLabel}|index:${entryId}]]`;
  return suggestedCategory ? `[[${safeLabel}|new:${suggestedCategory}]]` : `[[${safeLabel}]]`;
}

export function parseIndexLinks(value: string): IndexLink[] {
  const links: IndexLink[] = [];
  for (const match of value.matchAll(LINK_PATTERN)) {
    links.push({
      label: match[1].trim(),
      entryId: match[2] === "index" ? match[3]?.trim() || null : null,
      suggestedCategory: match[2] === "new" ? match[3]?.trim() || null : null,
    });
  }
  return links;
}

export function splitIndexLinkedText(value: string): IndexTextPart[] {
  const parts: IndexTextPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(LINK_PATTERN)) {
    const index = match.index ?? cursor;
    if (index > cursor) parts.push({ kind: "text", value: value.slice(cursor, index) });
    parts.push({
      kind: "link",
      label: match[1].trim(),
      entryId: match[2] === "index" ? match[3]?.trim() || null : null,
      suggestedCategory: match[2] === "new" ? match[3]?.trim() || null : null,
    });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push({ kind: "text", value: value.slice(cursor) });
  return parts;
}

export function indexLinkLabel(value: string): string {
  const links = parseIndexLinks(value);
  if (
    links.length === 1 &&
    value.trim() ===
      makeIndexLink(
        links[0].label,
        links[0].entryId ?? undefined,
        links[0].suggestedCategory ?? undefined,
      )
  ) {
    return links[0].label;
  }
  return value.replace(LINK_PATTERN, (_token, label: string) => label);
}

export function findEntryByTitle(entries: WorldEntry[], title: string): WorldEntry | undefined {
  const normalized = title.trim().toLocaleLowerCase();
  return entries.find((entry) => entry.title.trim().toLocaleLowerCase() === normalized);
}
