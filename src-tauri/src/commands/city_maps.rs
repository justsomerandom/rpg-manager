use tauri::State;

use crate::db::AppState;
use crate::json_store::{load_json_by_key, upsert_json_by_key};
use crate::models::CityMap;

#[tauri::command]
pub fn get_city_map(state: State<AppState>, city_id: String) -> Result<Option<CityMap>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    load_json_by_key(&conn, "city_maps", "city_id", &city_id, "map_json")
}

#[tauri::command]
pub fn save_city_map(
    state: State<AppState>,
    city_id: String,
    mut map: CityMap,
) -> Result<CityMap, String> {
    map.city_id = city_id.clone();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    upsert_json_by_key(
        &conn,
        "city_maps",
        "city_id",
        &city_id,
        "map_json",
        "updated_at",
        &map,
    )?;

    Ok(map)
}
