use chrono::Utc;
use rusqlite::OptionalExtension;
use tauri::State;

use crate::db::AppState;
use crate::models::CityMap;

#[tauri::command]
pub fn get_city_map(state: State<AppState>, city_id: String) -> Result<Option<CityMap>, String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT map_json FROM city_maps WHERE city_id = ?1")
        .map_err(|e| e.to_string())?;

    let map_json: Option<String> = stmt
        .query_row([&city_id], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(json) = map_json {
        let parsed: CityMap =
            serde_json::from_str(&json).map_err(|e| format!("Invalid city map JSON: {e}"))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn save_city_map(
    state: State<AppState>,
    city_id: String,
    mut map: CityMap,
) -> Result<CityMap, String> {
    map.city_id = city_id.clone();
    let encoded =
        serde_json::to_string(&map).map_err(|e| format!("Failed to encode city map: {e}"))?;

    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO city_maps (city_id, map_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(city_id) DO UPDATE SET
            map_json = excluded.map_json,
            updated_at = excluded.updated_at",
        (&city_id, &encoded, &Utc::now().timestamp()),
    )
    .map_err(|e| e.to_string())?;

    Ok(map)
}
