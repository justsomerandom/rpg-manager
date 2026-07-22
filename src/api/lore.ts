import { invokeOrThrow } from "./client";

export type LoreBook = {
  id: string;
  world_id: string;
  title: string;
  summary: string;
  created_at: number;
};

export type LoreEntry = {
  id: string;
  book_id: string;
  title: string;
  content: string;
  created_at: number;
};

export async function listLoreBooks(worldId: string): Promise<LoreBook[]> {
  return await invokeOrThrow<LoreBook[]>("list_lore_books", {
    worldId,
  });
}

export async function createLoreBook(
  worldId: string,
  title: string,
  summary: string
): Promise<LoreBook> {
  return await invokeOrThrow<LoreBook>("create_lore_book", {
    worldId,
    title,
    summary,
  });
}

export async function updateLoreBook(
  id: string,
  title: string,
  summary: string
): Promise<LoreBook> {
  return await invokeOrThrow<LoreBook>("update_lore_book", { id, title, summary });
}

export async function deleteLoreBook(id: string): Promise<void> {
  await invokeOrThrow<void>("delete_lore_book", { id });
}

export async function listLoreEntries(bookId: string): Promise<LoreEntry[]> {
  return await invokeOrThrow<LoreEntry[]>("list_lore_entries", {
    bookId,
  });
}

export async function createLoreEntry(
  bookId: string,
  title: string,
  content: string
): Promise<LoreEntry> {
  return await invokeOrThrow<LoreEntry>("create_lore_entry", {
    bookId,
    title,
    content,
  });
}

export async function updateLoreEntry(
  id: string,
  title: string,
  content: string
): Promise<LoreEntry> {
  return await invokeOrThrow<LoreEntry>("update_lore_entry", { id, title, content });
}

export async function deleteLoreEntry(id: string): Promise<void> {
  await invokeOrThrow<void>("delete_lore_entry", { id });
}
