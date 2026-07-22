use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension};
use tauri::State;

use crate::db::{
    city_ids_from_map_json, city_ids_from_map_json_checked, ensure_world_exists, AppState,
};
use crate::json_store::{load_json_by_key, upsert_json_by_key};
use crate::models::MapState;
use crate::validation::validate_id;

const MAX_CROSS_WORLD_CITY_IDS_TO_CHECK: usize = 1_000_000;

fn ensure_no_cross_world_city_id_collisions(
    conn: &Connection,
    world_id: &str,
    current_city_ids: &HashSet<String>,
) -> Result<(), String> {
    if current_city_ids.is_empty() {
        return Ok(());
    }

    let mut stmt = conn
        .prepare(
            "SELECT world_maps.world_id, worlds.name, world_maps.map_json
             FROM world_maps
             JOIN worlds ON worlds.id = world_maps.world_id
             WHERE world_maps.world_id != ?1",
        )
        .map_err(|e| format!("Failed to inspect other world maps: {e}"))?;
    let rows = stmt
        .query_map([world_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Failed to inspect other world maps: {e}"))?;

    let mut inspected_city_count = 0usize;
    for row in rows {
        let (other_world_id, other_world_name, map_json) =
            row.map_err(|e| format!("Failed to inspect another world map: {e}"))?;
        let other_city_ids = city_ids_from_map_json_checked(&map_json).map_err(|e| {
            format!(
                "Cannot verify city ownership because the saved map for '{other_world_name}' ({other_world_id}) is invalid: {e}"
            )
        })?;
        inspected_city_count = inspected_city_count
            .checked_add(other_city_ids.len())
            .ok_or_else(|| {
                "Saved world maps contain too many cities to verify safely".to_owned()
            })?;
        if inspected_city_count > MAX_CROSS_WORLD_CITY_IDS_TO_CHECK {
            return Err(format!(
                "Cannot verify more than {MAX_CROSS_WORLD_CITY_IDS_TO_CHECK} cities across saved world maps"
            ));
        }
        if let Some(city_id) = other_city_ids
            .into_iter()
            .find(|city_id| current_city_ids.contains(city_id))
        {
            return Err(format!(
                "City ID '{city_id}' is already used by world '{other_world_name}' ({other_world_id})"
            ));
        }
    }
    Ok(())
}

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

    ensure_no_cross_world_city_id_collisions(&tx, &world_id, &current_city_ids)?;

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
                 WHERE city_id = ?1 AND world_id = ?2",
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;

    #[test]
    fn rejects_city_ids_already_present_in_another_world_map() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_db(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO worlds (id, name, created_at) VALUES ('world-1', 'One', 1);
             INSERT INTO worlds (id, name, created_at) VALUES ('world-2', 'Two', 2);
             INSERT INTO world_maps (world_id, map_json, updated_at)
                VALUES ('world-2', '{\"cities\":[{\"id\":\"shared-city\"}]}', 1);",
        )
        .unwrap();

        let city_ids = HashSet::from(["shared-city".to_owned()]);
        let error =
            ensure_no_cross_world_city_id_collisions(&conn, "world-1", &city_ids).unwrap_err();
        assert!(error.contains("already used by world 'Two'"));

        let distinct_ids = HashSet::from(["different-city".to_owned()]);
        ensure_no_cross_world_city_id_collisions(&conn, "world-1", &distinct_ids).unwrap();
    }
}
