use chrono::Utc;
use rusqlite::{Connection, Row};
use tauri::State;
use uuid::Uuid;

use crate::db::AppState;
use crate::models::WorldEntry;

fn validate_entry_category(category: &str) -> Result<(), String> {
    match category {
        "magic_system" | "item_type" | "character_template" | "faction" | "region" => Ok(()),
        _ => Err("Unsupported world entry category".into()),
    }
}

fn map_world_entry(row: &Row<'_>) -> rusqlite::Result<WorldEntry> {
    Ok(WorldEntry {
        id: row.get(0)?,
        world_id: row.get(1)?,
        category: row.get(2)?,
        title: row.get(3)?,
        summary: row.get(4)?,
        body: row.get(5)?,
        metadata_json: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn fetch_world_entry_by_id(conn: &Connection, entry_id: &str) -> Result<WorldEntry, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
             FROM world_entries
             WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row([entry_id], map_world_entry)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_world_entries(
    state: State<AppState>,
    world_id: String,
    category: Option<String>,
) -> Result<Vec<WorldEntry>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    let mut entries = Vec::new();

    if let Some(cat) = category {
        validate_entry_category(&cat)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
                 FROM world_entries
                 WHERE world_id = ?1 AND category = ?2
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map((&world_id, &cat), |row| map_world_entry(row))
            .map_err(|e| e.to_string())?;

        for entry in iter {
            entries.push(entry.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
                 FROM world_entries
                 WHERE world_id = ?1
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map([&world_id], |row| map_world_entry(row))
            .map_err(|e| e.to_string())?;

        for entry in iter {
            entries.push(entry.map_err(|e| e.to_string())?);
        }
    }

    Ok(entries)
}

#[tauri::command]
pub fn create_world_entry(
    state: State<AppState>,
    world_id: String,
    category: String,
    title: String,
    summary: String,
    body: String,
    metadata_json: Option<String>,
) -> Result<WorldEntry, String> {
    if title.trim().is_empty() {
        return Err("Entry title cannot be empty".into());
    }
    validate_entry_category(&category)?;

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let metadata = metadata_json.unwrap_or_else(|| "{}".into());

    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO world_entries
         (id, world_id, category, title, summary, body, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (
            &id,
            &world_id,
            &category,
            &title,
            &summary,
            &body,
            &metadata,
            &created_at,
        ),
    )
    .map_err(|e| e.to_string())?;

    Ok(WorldEntry {
        id,
        world_id,
        category,
        title,
        summary,
        body,
        metadata_json: metadata,
        created_at,
    })
}

#[tauri::command]
pub fn update_world_entry(
    state: State<AppState>,
    id: String,
    title: String,
    summary: String,
    body: String,
    metadata_json: Option<String>,
) -> Result<WorldEntry, String> {
    if title.trim().is_empty() {
        return Err("Entry title cannot be empty".into());
    }

    let metadata = metadata_json.unwrap_or_else(|| "{}".into());
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "UPDATE world_entries
         SET title = ?1,
             summary = ?2,
             body = ?3,
             metadata_json = ?4
         WHERE id = ?5",
        (&title, &summary, &body, &metadata, &id),
    )
    .map_err(|e| e.to_string())?;

    let entry = fetch_world_entry_by_id(&conn, &id)?;
    Ok(entry)
}

#[tauri::command]
pub fn delete_world_entry(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute("DELETE FROM world_entries WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
