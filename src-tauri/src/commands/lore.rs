use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::db::AppState;
use crate::models::{LoreBook, LoreEntry};

#[tauri::command]
pub fn list_lore_books(state: State<AppState>, world_id: String) -> Result<Vec<LoreBook>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, world_id, title, summary, created_at
             FROM world_lore_books
             WHERE world_id = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&world_id], |row| {
            Ok(LoreBook {
                id: row.get(0)?,
                world_id: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut books = Vec::new();
    for row in rows {
        books.push(row.map_err(|e| e.to_string())?);
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
    if title.trim().is_empty() {
        return Err("Lore book title cannot be empty".into());
    }

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO world_lore_books (id, world_id, title, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (&id, &world_id, &title, &summary, &created_at),
    )
    .map_err(|e| e.to_string())?;

    Ok(LoreBook {
        id,
        world_id,
        title,
        summary,
        created_at,
    })
}

#[tauri::command]
pub fn list_lore_entries(
    state: State<AppState>,
    book_id: String,
) -> Result<Vec<LoreEntry>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, book_id, title, content, created_at
             FROM world_lore_entries
             WHERE book_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&book_id], |row| {
            Ok(LoreEntry {
                id: row.get(0)?,
                book_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
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
    if title.trim().is_empty() {
        return Err("Lore entry title cannot be empty".into());
    }
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO world_lore_entries (id, book_id, title, content, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (&id, &book_id, &title, &content, &created_at),
    )
    .map_err(|e| e.to_string())?;

    Ok(LoreEntry {
        id,
        book_id,
        title,
        content,
        created_at,
    })
}
