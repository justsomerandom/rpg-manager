use rusqlite::OptionalExtension;
use tauri::State;

use crate::db::{city_ids_from_map_json, AppState};
use crate::json_store::{load_json_by_key, upsert_json_by_key};
use crate::models::CityMap;
use crate::validation::validate_id;

fn find_city_owner(conn: &rusqlite::Connection, city_id: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT world_id, map_json FROM world_maps")
        .map_err(|e| format!("Failed to inspect world maps: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to inspect world maps: {e}"))?;
    let mut owner = None;
    for row in rows {
        let (world_id, json) = row.map_err(|e| format!("Failed to inspect world maps: {e}"))?;
        if city_ids_from_map_json(&json).iter().any(|id| id == city_id) {
            if owner.as_ref().is_some_and(|existing| existing != &world_id) {
                return Err(format!(
                    "City ID '{city_id}' appears in more than one world"
                ));
            }
            owner = Some(world_id);
        }
    }
    Ok(owner)
}

#[tauri::command]
pub fn get_city_map(state: State<AppState>, city_id: String) -> Result<Option<CityMap>, String> {
    let city_id = validate_id(city_id, "City ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let mut map: Option<CityMap> =
        load_json_by_key(&conn, "city_maps", "city_id", &city_id, "map_json")?;
    if let Some(map) = &mut map {
        if map.city_id != city_id {
            return Err("Saved city map does not match the requested city".into());
        }
        map.normalize_and_validate()
            .map_err(|e| format!("Saved city map is invalid: {e}"))?;
    }
    Ok(map)
}

#[tauri::command]
pub fn save_city_map(
    state: State<AppState>,
    city_id: String,
    mut map: CityMap,
) -> Result<CityMap, String> {
    let city_id = validate_id(city_id, "City ID")?;
    map.city_id = city_id.clone();
    map.normalize_and_validate()?;
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let discovered_owner = find_city_owner(&conn, &city_id)?;
    let existing_owner: Option<String> = conn
        .query_row(
            "SELECT world_id FROM city_maps WHERE city_id = ?1",
            [&city_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to inspect city map ownership: {e}"))?
        .flatten();
    if let (Some(existing), Some(discovered)) = (&existing_owner, &discovered_owner) {
        if existing != discovered {
            return Err("City map ownership conflicts with the saved world map".into());
        }
    }
    let owner = discovered_owner.or(existing_owner);
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start city map save: {e}"))?;
    upsert_json_by_key(
        &tx,
        "city_maps",
        "city_id",
        &city_id,
        "map_json",
        "updated_at",
        &map,
    )
    .map_err(|e| format!("Failed to save city map: {e}"))?;
    if let Some(owner) = owner {
        tx.execute(
            "UPDATE city_maps SET world_id = ?1 WHERE city_id = ?2",
            (&owner, &city_id),
        )
        .map_err(|e| format!("Failed to link city map ownership: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit city map: {e}"))?;
    Ok(map)
}

#[tauri::command]
pub fn delete_city_map(state: State<AppState>, city_id: String) -> Result<(), String> {
    let city_id = validate_id(city_id, "City ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    conn.execute("DELETE FROM city_maps WHERE city_id = ?1", [&city_id])
        .map_err(|e| format!("Failed to delete city map: {e}"))?;
    Ok(())
}
