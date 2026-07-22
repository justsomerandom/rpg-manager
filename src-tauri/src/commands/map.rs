use std::collections::HashSet;

use rusqlite::OptionalExtension;
use tauri::State;

use crate::db::{city_ids_from_map_json, ensure_world_exists, AppState};
use crate::json_store::{load_json_by_key, upsert_json_by_key};
use crate::models::MapState;
use crate::validation::validate_id;

#[tauri::command]
pub fn get_world_map(state: State<AppState>, world_id: String) -> Result<Option<MapState>, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
    let mut map: Option<MapState> =
        load_json_by_key(&conn, "world_maps", "world_id", &world_id, "map_json")?;
    if let Some(map) = &mut map {
        map.normalize_and_validate()
            .map_err(|e| format!("Saved world map is invalid: {e}"))?;
    }
    Ok(map)
}

#[tauri::command]
pub fn save_world_map(
    state: State<AppState>,
    world_id: String,
    mut map: MapState,
) -> Result<MapState, String> {
    let world_id = validate_id(world_id, "World ID")?;
    map.normalize_and_validate()?;
    let current_city_ids: HashSet<String> = map.cities.iter().map(|city| city.id.clone()).collect();
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start map save: {e}"))?;

    let previous_json: Option<String> = tx
        .query_row(
            "SELECT map_json FROM world_maps WHERE world_id = ?1",
            [&world_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to inspect the previous map: {e}"))?;
    upsert_json_by_key(
        &tx,
        "world_maps",
        "world_id",
        &world_id,
        "map_json",
        "updated_at",
        &map,
    )
    .map_err(|e| format!("Failed to save world map: {e}"))?;

    if let Some(previous_json) = previous_json {
        for removed_city_id in city_ids_from_map_json(&previous_json)
            .into_iter()
            .filter(|city_id| !current_city_ids.contains(city_id))
        {
            tx.execute(
                "DELETE FROM city_maps
                 WHERE city_id = ?1 AND (world_id = ?2 OR world_id IS NULL)",
                (&removed_city_id, &world_id),
            )
            .map_err(|e| format!("Failed to clean up a removed city's map: {e}"))?;
        }
    }

    for city_id in &current_city_ids {
        let conflicting_owner: Option<String> = tx
            .query_row(
                "SELECT world_id FROM city_maps
                 WHERE city_id = ?1 AND world_id IS NOT NULL AND world_id != ?2",
                (city_id, &world_id),
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to verify city map ownership: {e}"))?;
        if conflicting_owner.is_some() {
            return Err(format!(
                "City ID '{city_id}' is already owned by another world"
            ));
        }
        tx.execute(
            "UPDATE city_maps SET world_id = ?1 WHERE city_id = ?2",
            (&world_id, city_id),
        )
        .map_err(|e| format!("Failed to link a city map to its world: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit world map: {e}"))?;
    Ok(map)
}
