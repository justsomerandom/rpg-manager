import { useId, useRef, useState } from "react";
import type { WorldEntry, WorldEntryCategory } from "../api/worldEntries";
import { findEntryByTitle, makeIndexLink } from "../features/world-index/links";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  entries: WorldEntry[];
  rows: number;
  maxLength: number;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  preferredCategories?: WorldEntryCategory[];
};

export function IndexLinkedTextarea({
  id,
  value,
  onChange,
  entries,
  rows,
  maxLength,
  disabled = false,
  required = false,
  placeholder,
  preferredCategories,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [linkTitle, setLinkTitle] = useState("");
  const eligibleEntries = preferredCategories?.length
    ? entries.filter((entry) => preferredCategories.includes(entry.category))
    : entries;

  const insertLink = () => {
    const title = linkTitle.trim();
    if (!title || disabled) return;
    const entry = findEntryByTitle(eligibleEntries, title);
    const token = makeIndexLink(
      entry?.title ?? title,
      entry?.id,
      !entry && preferredCategories?.length === 1 ? preferredCategories[0] : undefined,
    );
    const element = textareaRef.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const leadingSpace = start > 0 && !/\s/.test(value[start - 1]) ? " " : "";
    const trailingSpace = end < value.length && !/\s/.test(value[end]) ? " " : "";
    const next = `${value.slice(0, start)}${leadingSpace}${token}${trailingSpace}${value.slice(end)}`;
    if (next.length > maxLength) return;
    onChange(next);
    setLinkTitle("");
    requestAnimationFrame(() => {
      const caret = start + leadingSpace.length + token.length + trailingSpace.length;
      element?.focus();
      element?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        id={id}
        className="input-field"
        rows={rows}
        value={value}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-index-link`} className="sr-only">
            Index entry to insert
          </label>
          <input
            id={`${id}-index-link`}
            className="input-field py-1.5 text-xs"
            list={listId}
            value={linkTitle}
            maxLength={180}
            disabled={disabled}
            placeholder="Find an index entry or type a new title…"
            onChange={(event) => setLinkTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                insertLink();
              }
            }}
          />
          <datalist id={listId}>
            {eligibleEntries.map((entry) => (
              <option key={entry.id} value={entry.title}>
                {entry.category.replace(/_/g, " ")}
              </option>
            ))}
          </datalist>
        </div>
        <button
          type="button"
          className="secondary-button shrink-0 text-xs"
          disabled={disabled || !linkTitle.trim()}
          onClick={insertLink}
        >
          Insert index link
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Existing entries are linked directly. A typed title that does not exist is queued for quick
        creation in the Index.
      </p>
    </div>
  );
}
