use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Row};
use tauri::State;
use uuid::Uuid;

use crate::db::{ensure_world_exists, AppState};
use crate::models::WorldEntry;
use crate::validation::{
    validate_id, validate_json_object, validate_name, validate_text, MAX_JSON_DOCUMENT_BYTES,
    MAX_LONG_TEXT_BYTES, MAX_SHORT_TEXT_BYTES,
};

fn validate_entry_category(category: String) -> Result<String, String> {
    let category = category.trim().to_owned();
    match category.as_str() {
        "note" | "magic_system" | "item_type" | "character_template" | "faction" | "region" => {
            Ok(category)
        }
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
    conn.query_row(
        "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
         FROM world_entries WHERE id = ?1",
        [entry_id],
        map_world_entry,
    )
    .optional()
    .map_err(|e| format!("Failed to load world entry: {e}"))?
    .ok_or_else(|| "World entry not found".into())
}

#[tauri::command]
pub fn list_world_entries(
    state: State<AppState>,
    world_id: String,
    category: Option<String>,
) -> Result<Vec<WorldEntry>, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let category = category.map(validate_entry_category).transpose()?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
    let mut entries = Vec::new();
    if let Some(category) = category {
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
                 FROM world_entries
                 WHERE world_id = ?1 AND category = ?2
                 ORDER BY created_at DESC, id DESC",
            )
            .map_err(|e| format!("Failed to load world entries: {e}"))?;
        let rows = stmt
            .query_map((&world_id, &category), map_world_entry)
            .map_err(|e| format!("Failed to load world entries: {e}"))?;
        for row in rows {
            entries.push(row.map_err(|e| format!("Failed to read a world entry: {e}"))?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
                 FROM world_entries
                 WHERE world_id = ?1
                 ORDER BY created_at DESC, id DESC",
            )
            .map_err(|e| format!("Failed to load world entries: {e}"))?;
        let rows = stmt
            .query_map([&world_id], map_world_entry)
            .map_err(|e| format!("Failed to load world entries: {e}"))?;
        for row in rows {
            entries.push(row.map_err(|e| format!("Failed to read a world entry: {e}"))?);
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
    let world_id = validate_id(world_id, "World ID")?;
    let category = validate_entry_category(category)?;
    let title = validate_name(title, "Entry title")?;
    validate_text(&summary, "Entry summary", MAX_SHORT_TEXT_BYTES)?;
    validate_text(&body, "Entry body", MAX_LONG_TEXT_BYTES)?;
    let metadata_json =
        validate_json_object(metadata_json, "Entry metadata", MAX_JSON_DOCUMENT_BYTES)?;
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
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
            &metadata_json,
            &created_at,
        ),
    )
    .map_err(|e| format!("Failed to create world entry: {e}"))?;
    Ok(WorldEntry {
        id,
        world_id,
        category,
        title,
        summary,
        body,
        metadata_json,
        created_at,
    })
}

#[tauri::command]
pub fn update_world_entry(
    state: State<AppState>,
    id: String,
    category: Option<String>,
    title: String,
    summary: String,
    body: String,
    metadata_json: Option<String>,
) -> Result<WorldEntry, String> {
    let id = validate_id(id, "World entry ID")?;
    let category = category.map(validate_entry_category).transpose()?;
    let title = validate_name(title, "Entry title")?;
    validate_text(&summary, "Entry summary", MAX_SHORT_TEXT_BYTES)?;
    validate_text(&body, "Entry body", MAX_LONG_TEXT_BYTES)?;
    let metadata_json =
        validate_json_object(metadata_json, "Entry metadata", MAX_JSON_DOCUMENT_BYTES)?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute(
            "UPDATE world_entries
             SET category = COALESCE(?1, category), title = ?2, summary = ?3, body = ?4, metadata_json = ?5
             WHERE id = ?6",
            (&category, &title, &summary, &body, &metadata_json, &id),
        )
        .map_err(|e| format!("Failed to update world entry: {e}"))?;
    if affected == 0 {
        return Err("World entry not found".into());
    }
    fetch_world_entry_by_id(&conn, &id)
}

#[tauri::command]
pub fn delete_world_entry(state: State<AppState>, id: String) -> Result<(), String> {
    let id = validate_id(id, "World entry ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute("DELETE FROM world_entries WHERE id = ?1", [&id])
        .map_err(|e| format!("Failed to delete world entry: {e}"))?;
    if affected == 0 {
        return Err("World entry not found".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supports_general_notes_but_rejects_unknown_categories() {
        assert_eq!(validate_entry_category(" note ".into()).unwrap(), "note");
        assert!(validate_entry_category("unknown".into()).is_err());
    }
}
