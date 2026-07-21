use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::db::AppState;
use crate::models::Character;

#[tauri::command]
pub fn list_characters(state: State<AppState>, world_id: String) -> Result<Vec<Character>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, world_id, name, notes, attributes_json, created_at
             FROM characters
             WHERE world_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let chars_iter = stmt
        .query_map([&world_id], |row| {
            Ok(Character {
                id: row.get(0)?,
                world_id: row.get(1)?,
                name: row.get(2)?,
                notes: row.get(3)?,
                attributes_json: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for c in chars_iter {
        result.push(c.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
pub fn create_character(
    state: State<AppState>,
    world_id: String,
    name: String,
) -> Result<Character, String> {
    if name.trim().is_empty() {
        return Err("Character name cannot be empty".into());
    }

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();

    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO characters (id, world_id, name, notes, attributes_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&id, &world_id, &name, &"", &"{}", &created_at),
    )
    .map_err(|e| e.to_string())?;

    Ok(Character {
        id,
        world_id,
        name,
        notes: "".into(),
        attributes_json: "{}".into(),
        created_at,
    })
}
