import { invoke } from "@tauri-apps/api/core";

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
  return await invoke<LoreBook[]>("list_lore_books", {
    worldId,
    world_id: worldId,
  });
}

export async function createLoreBook(
  worldId: string,
  title: string,
  summary: string
): Promise<LoreBook> {
  return await invoke<LoreBook>("create_lore_book", {
    worldId,
    world_id: worldId,
    title,
    summary,
  });
}

export async function listLoreEntries(bookId: string): Promise<LoreEntry[]> {
  return await invoke<LoreEntry[]>("list_lore_entries", {
    bookId,
    book_id: bookId,
  });
}

export async function createLoreEntry(
  bookId: string,
  title: string,
  content: string
): Promise<LoreEntry> {
  return await invoke<LoreEntry>("create_lore_entry", {
    bookId,
    book_id: bookId,
    title,
    content,
  });
}
