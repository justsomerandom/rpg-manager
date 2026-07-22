use chrono::Utc;
use rusqlite::OptionalExtension;
use tauri::State;
use uuid::Uuid;

use crate::db::{ensure_world_exists, AppState};
use crate::models::Character;
use crate::validation::{
    validate_id, validate_json_object, validate_name, validate_text, MAX_JSON_DOCUMENT_BYTES,
    MAX_LONG_TEXT_BYTES,
};

fn map_character(row: &rusqlite::Row<'_>) -> rusqlite::Result<Character> {
    Ok(Character {
        id: row.get(0)?,
        world_id: row.get(1)?,
        name: row.get(2)?,
        notes: row.get(3)?,
        attributes_json: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[tauri::command]
pub fn list_characters(state: State<AppState>, world_id: String) -> Result<Vec<Character>, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, world_id, name, notes, attributes_json, created_at
             FROM characters
             WHERE world_id = ?1
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|e| format!("Failed to load characters: {e}"))?;
    let rows = stmt
        .query_map([&world_id], map_character)
        .map_err(|e| format!("Failed to load characters: {e}"))?;
    let mut characters = Vec::new();
    for row in rows {
        characters.push(row.map_err(|e| format!("Failed to read a character: {e}"))?);
    }
    Ok(characters)
}

#[tauri::command]
pub fn create_character(
    state: State<AppState>,
    world_id: String,
    name: String,
) -> Result<Character, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let name = validate_name(name, "Character name")?;
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
    conn.execute(
        "INSERT INTO characters (id, world_id, name, notes, attributes_json, created_at)
         VALUES (?1, ?2, ?3, '', '{}', ?4)",
        (&id, &world_id, &name, &created_at),
    )
    .map_err(|e| format!("Failed to create character: {e}"))?;
    Ok(Character {
        id,
        world_id,
        name,
        notes: String::new(),
        attributes_json: "{}".into(),
        created_at,
    })
}

#[tauri::command]
pub fn update_character(
    state: State<AppState>,
    id: String,
    name: String,
    notes: String,
    attributes_json: Option<String>,
) -> Result<Character, String> {
    let id = validate_id(id, "Character ID")?;
    let name = validate_name(name, "Character name")?;
    validate_text(&notes, "Character notes", MAX_LONG_TEXT_BYTES)?;
    let attributes_json = attributes_json
        .map(|value| {
            validate_json_object(Some(value), "Character attributes", MAX_JSON_DOCUMENT_BYTES)
        })
        .transpose()?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute(
            "UPDATE characters
             SET name = ?1, notes = ?2, attributes_json = COALESCE(?3, attributes_json)
             WHERE id = ?4",
            (&name, &notes, &attributes_json, &id),
        )
        .map_err(|e| format!("Failed to update character: {e}"))?;
    if affected == 0 {
        return Err("Character not found".into());
    }
    conn.query_row(
        "SELECT id, world_id, name, notes, attributes_json, created_at
         FROM characters WHERE id = ?1",
        [&id],
        map_character,
    )
    .optional()
    .map_err(|e| format!("Failed to load updated character: {e}"))?
    .ok_or_else(|| "Character not found".into())
}

#[tauri::command]
pub fn delete_character(state: State<AppState>, id: String) -> Result<(), String> {
    let id = validate_id(id, "Character ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute("DELETE FROM characters WHERE id = ?1", [&id])
        .map_err(|e| format!("Failed to delete character: {e}"))?;
    if affected == 0 {
        return Err("Character not found".into());
    }
    Ok(())
}
