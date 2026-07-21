use tauri::State;

use crate::db::AppState;
use crate::json_store::{load_json_by_key, upsert_json_by_key};
use crate::models::MapState;

#[tauri::command]
pub fn get_world_map(state: State<AppState>, world_id: String) -> Result<Option<MapState>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    load_json_by_key(&conn, "world_maps", "world_id", &world_id, "map_json")
}

#[tauri::command]
pub fn save_world_map(
    state: State<AppState>,
    world_id: String,
    map: MapState,
) -> Result<MapState, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    upsert_json_by_key(
        &conn,
        "world_maps",
        "world_id",
        &world_id,
        "map_json",
        "updated_at",
        &map,
    )?;
    Ok(map)
}
