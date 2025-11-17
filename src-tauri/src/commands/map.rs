use chrono::Utc;
use rusqlite::OptionalExtension;
use tauri::State;

use crate::db::AppState;
use crate::models::MapState;

#[tauri::command]
pub fn get_world_map(
    state: State<AppState>,
    world_id: String,
) -> Result<Option<MapState>, String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT map_json FROM world_maps WHERE world_id = ?1")
        .map_err(|e| e.to_string())?;

    let map_json: Option<String> = stmt
        .query_row([&world_id], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(json) = map_json {
        let parsed: MapState =
            serde_json::from_str(&json).map_err(|e| format!("Invalid map JSON: {e}"))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn save_world_map(
    state: State<AppState>,
    world_id: String,
    map: MapState,
) -> Result<MapState, String> {
    let encoded =
        serde_json::to_string(&map).map_err(|e| format!("Failed to encode map: {e}"))?;
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;

    conn.execute(
        "INSERT INTO world_maps (world_id, map_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(world_id) DO UPDATE SET
            map_json = excluded.map_json,
            updated_at = excluded.updated_at",
        (&world_id, &encoded, &Utc::now().timestamp()),
    )
    .map_err(|e| e.to_string())?;

    Ok(map)
}
