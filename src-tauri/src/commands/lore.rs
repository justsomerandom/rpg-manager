use chrono::Utc;
use rusqlite::OptionalExtension;
use tauri::State;
use uuid::Uuid;

use crate::db::{ensure_lore_book_exists, ensure_world_exists, AppState};
use crate::models::{LoreBook, LoreEntry};
use crate::validation::{
    validate_id, validate_name, validate_text, MAX_LONG_TEXT_BYTES, MAX_SHORT_TEXT_BYTES,
};

fn map_lore_book(row: &rusqlite::Row<'_>) -> rusqlite::Result<LoreBook> {
    Ok(LoreBook {
        id: row.get(0)?,
        world_id: row.get(1)?,
        title: row.get(2)?,
        summary: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn map_lore_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<LoreEntry> {
    Ok(LoreEntry {
        id: row.get(0)?,
        book_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        created_at: row.get(4)?,
    })
}

#[tauri::command]
pub fn list_lore_books(state: State<AppState>, world_id: String) -> Result<Vec<LoreBook>, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, world_id, title, summary, created_at
             FROM world_lore_books
             WHERE world_id = ?1
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| format!("Failed to load lore books: {e}"))?;
    let rows = stmt
        .query_map([&world_id], map_lore_book)
        .map_err(|e| format!("Failed to load lore books: {e}"))?;
    let mut books = Vec::new();
    for row in rows {
        books.push(row.map_err(|e| format!("Failed to read a lore book: {e}"))?);
    }
    Ok(books)
}

#[tauri::command]
pub fn create_lore_book(
    state: State<AppState>,
    world_id: String,
    title: String,
    summary: String,
) -> Result<LoreBook, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let title = validate_name(title, "Lore book title")?;
    validate_text(&summary, "Lore book summary", MAX_SHORT_TEXT_BYTES)?;
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
    conn.execute(
        "INSERT INTO world_lore_books (id, world_id, title, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (&id, &world_id, &title, &summary, &created_at),
    )
    .map_err(|e| format!("Failed to create lore book: {e}"))?;
    Ok(LoreBook {
        id,
        world_id,
        title,
        summary,
        created_at,
    })
}

#[tauri::command]
pub fn update_lore_book(
    state: State<AppState>,
    id: String,
    title: String,
    summary: String,
) -> Result<LoreBook, String> {
    let id = validate_id(id, "Lore book ID")?;
    let title = validate_name(title, "Lore book title")?;
    validate_text(&summary, "Lore book summary", MAX_SHORT_TEXT_BYTES)?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute(
            "UPDATE world_lore_books SET title = ?1, summary = ?2 WHERE id = ?3",
            (&title, &summary, &id),
        )
        .map_err(|e| format!("Failed to update lore book: {e}"))?;
    if affected == 0 {
        return Err("Lore book not found".into());
    }
    conn.query_row(
        "SELECT id, world_id, title, summary, created_at FROM world_lore_books WHERE id = ?1",
        [&id],
        map_lore_book,
    )
    .optional()
    .map_err(|e| format!("Failed to load updated lore book: {e}"))?
    .ok_or_else(|| "Lore book not found".into())
}

#[tauri::command]
pub fn delete_lore_book(state: State<AppState>, id: String) -> Result<(), String> {
    let id = validate_id(id, "Lore book ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute("DELETE FROM world_lore_books WHERE id = ?1", [&id])
        .map_err(|e| format!("Failed to delete lore book: {e}"))?;
    if affected == 0 {
        return Err("Lore book not found".into());
    }
    Ok(())
}

#[tauri::command]
pub fn list_lore_entries(
    state: State<AppState>,
    book_id: String,
) -> Result<Vec<LoreEntry>, String> {
    let book_id = validate_id(book_id, "Lore book ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_lore_book_exists(&conn, &book_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, book_id, title, content, created_at
             FROM world_lore_entries
             WHERE book_id = ?1
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|e| format!("Failed to load lore entries: {e}"))?;
    let rows = stmt
        .query_map([&book_id], map_lore_entry)
        .map_err(|e| format!("Failed to load lore entries: {e}"))?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| format!("Failed to read a lore entry: {e}"))?);
    }
    Ok(entries)
}

#[tauri::command]
pub fn create_lore_entry(
    state: State<AppState>,
    book_id: String,
    title: String,
    content: String,
) -> Result<LoreEntry, String> {
    let book_id = validate_id(book_id, "Lore book ID")?;
    let title = validate_name(title, "Lore entry title")?;
    validate_text(&content, "Lore entry content", MAX_LONG_TEXT_BYTES)?;
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_lore_book_exists(&conn, &book_id)?;
    conn.execute(
        "INSERT INTO world_lore_entries (id, book_id, title, content, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (&id, &book_id, &title, &content, &created_at),
    )
    .map_err(|e| format!("Failed to create lore entry: {e}"))?;
    Ok(LoreEntry {
        id,
        book_id,
        title,
        content,
        created_at,
    })
}

#[tauri::command]
pub fn update_lore_entry(
    state: State<AppState>,
    id: String,
    title: String,
    content: String,
) -> Result<LoreEntry, String> {
    let id = validate_id(id, "Lore entry ID")?;
    let title = validate_name(title, "Lore entry title")?;
    validate_text(&content, "Lore entry content", MAX_LONG_TEXT_BYTES)?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute(
            "UPDATE world_lore_entries SET title = ?1, content = ?2 WHERE id = ?3",
            (&title, &content, &id),
        )
        .map_err(|e| format!("Failed to update lore entry: {e}"))?;
    if affected == 0 {
        return Err("Lore entry not found".into());
    }
    conn.query_row(
        "SELECT id, book_id, title, content, created_at FROM world_lore_entries WHERE id = ?1",
        [&id],
        map_lore_entry,
    )
    .optional()
    .map_err(|e| format!("Failed to load updated lore entry: {e}"))?
    .ok_or_else(|| "Lore entry not found".into())
}

#[tauri::command]
pub fn delete_lore_entry(state: State<AppState>, id: String) -> Result<(), String> {
    let id = validate_id(id, "Lore entry ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute("DELETE FROM world_lore_entries WHERE id = ?1", [&id])
        .map_err(|e| format!("Failed to delete lore entry: {e}"))?;
    if affected == 0 {
        return Err("Lore entry not found".into());
    }
    Ok(())
}
