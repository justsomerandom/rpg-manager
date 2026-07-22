use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use tauri::State;

use crate::db::{city_ids_from_map_json_checked, ensure_world_exists, AppState};
use crate::json_store::{encode_json, load_json_by_key};
use crate::models::CityMap;
use crate::validation::validate_id;

fn ensure_city_belongs_to_world(
    conn: &Connection,
    world_id: &str,
    city_id: &str,
) -> Result<(), String> {
    ensure_world_exists(conn, world_id)?;
    let map_json: Option<String> = conn
        .query_row(
            "SELECT map_json FROM world_maps WHERE world_id = ?1",
            [world_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to inspect the world map: {e}"))?;
    let map_json = map_json.ok_or_else(|| {
        "Save the world map before opening or saving one of its city plans".to_owned()
    })?;
    let city_ids = city_ids_from_map_json_checked(&map_json)
        .map_err(|e| format!("Saved world map is invalid: {e}"))?;
    if city_ids.iter().any(|candidate| candidate == city_id) {
        Ok(())
    } else {
        Err("City does not belong to the specified world's saved map".into())
    }
}

fn stored_city_owner(conn: &Connection, city_id: &str) -> Result<Option<Option<String>>, String> {
    conn.query_row(
        "SELECT world_id FROM city_maps WHERE city_id = ?1",
        [city_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map_err(|e| format!("Failed to inspect city map ownership: {e}"))
}

fn require_matching_owner(stored_owner: Option<String>, world_id: &str) -> Result<(), String> {
    match stored_owner {
        Some(owner) if owner == world_id => Ok(()),
        Some(_) => Err("City plan belongs to another world".into()),
        None => Err("City plan has no owner and must be repaired by the database migration".into()),
    }
}

fn get_city_map_record(
    conn: &Connection,
    world_id: &str,
    city_id: &str,
) -> Result<Option<CityMap>, String> {
    ensure_city_belongs_to_world(conn, world_id, city_id)?;
    let Some(owner) = stored_city_owner(conn, city_id)? else {
        return Ok(None);
    };
    require_matching_owner(owner, world_id)?;

    let mut map: CityMap = load_json_by_key(conn, "city_maps", "city_id", city_id, "map_json")?
        .ok_or_else(|| "City plan disappeared while it was being loaded".to_owned())?;
    if map.city_id != city_id {
        return Err("Saved city map does not match the requested city".into());
    }
    map.normalize_and_validate()
        .map_err(|e| format!("Saved city map is invalid: {e}"))?;
    Ok(Some(map))
}

fn save_city_map_record(
    conn: &Connection,
    world_id: &str,
    city_id: &str,
    mut map: CityMap,
) -> Result<CityMap, String> {
    ensure_city_belongs_to_world(conn, world_id, city_id)?;
    map.city_id = city_id.to_owned();
    map.normalize_and_validate()?;

    if let Some(owner) = stored_city_owner(conn, city_id)? {
        require_matching_owner(owner, world_id)?;
    }

    let encoded = encode_json(&map)?;
    conn.execute(
        "INSERT INTO city_maps (city_id, world_id, map_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(city_id) DO UPDATE SET
            world_id = excluded.world_id,
            map_json = excluded.map_json,
            updated_at = excluded.updated_at",
        (city_id, world_id, &encoded, Utc::now().timestamp()),
    )
    .map_err(|e| format!("Failed to save city map: {e}"))?;
    Ok(map)
}

fn delete_city_map_record(conn: &Connection, world_id: &str, city_id: &str) -> Result<(), String> {
    ensure_world_exists(conn, world_id)?;
    let Some(owner) = stored_city_owner(conn, city_id)? else {
        // Deletion is intentionally idempotent because saving a parent world
        // map already removes plans for cities removed from that map.
        return Ok(());
    };
    require_matching_owner(owner, world_id)?;
    conn.execute(
        "DELETE FROM city_maps WHERE city_id = ?1 AND world_id = ?2",
        (city_id, world_id),
    )
    .map_err(|e| format!("Failed to delete city map: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_city_map(
    state: State<AppState>,
    world_id: String,
    city_id: String,
) -> Result<Option<CityMap>, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let city_id = validate_id(city_id, "City ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    get_city_map_record(&conn, &world_id, &city_id)
}

#[tauri::command]
pub fn save_city_map(
    state: State<AppState>,
    world_id: String,
    city_id: String,
    map: CityMap,
) -> Result<CityMap, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let city_id = validate_id(city_id, "City ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    save_city_map_record(&conn, &world_id, &city_id, map)
}

#[tauri::command]
pub fn delete_city_map(
    state: State<AppState>,
    world_id: String,
    city_id: String,
) -> Result<(), String> {
    let world_id = validate_id(world_id, "World ID")?;
    let city_id = validate_id(city_id, "City ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    delete_city_map_record(&conn, &world_id, &city_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;
    use crate::models::{CityBuilding, CityDistrict, CityRoad};

    fn city_map(city_id: &str) -> CityMap {
        CityMap {
            city_id: city_id.into(),
            size_label: "town".into(),
            width: 1,
            height: 1,
            seed: 42,
            scale: 1.0,
            road_architecture: "ring".into(),
            road_theme: "elvish".into(),
            external_connections: vec![],
            districts: Vec::<CityDistrict>::new(),
            roads: Vec::<CityRoad>::new(),
            buildings: Vec::<CityBuilding>::new(),
        }
    }

    fn database_with_city() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        init_db(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO worlds (id, name, created_at) VALUES ('world-1', 'World', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO world_maps (world_id, map_json, updated_at)
             VALUES ('world-1', '{\"cities\":[{\"id\":\"city-1\"}]}', 1)",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn city_plans_round_trip_only_through_their_own_world() {
        let conn = database_with_city();
        save_city_map_record(&conn, "world-1", "city-1", city_map("city-1")).unwrap();

        let loaded = get_city_map_record(&conn, "world-1", "city-1")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.city_id, "city-1");
        let owner: String = conn
            .query_row(
                "SELECT world_id FROM city_maps WHERE city_id = 'city-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, "world-1");
    }

    #[test]
    fn rejects_a_city_that_is_not_in_the_specified_saved_world_map() {
        let conn = database_with_city();
        let error =
            save_city_map_record(&conn, "world-1", "not-in-world", city_map("not-in-world"))
                .err()
                .expect("a city outside the saved map must be rejected");
        assert!(error.contains("does not belong"));
    }

    #[test]
    fn cannot_read_or_delete_another_worlds_city_plan() {
        let conn = database_with_city();
        conn.execute(
            "INSERT INTO worlds (id, name, created_at) VALUES ('world-2', 'Other', 2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO world_maps (world_id, map_json, updated_at)
             VALUES ('world-2', '{\"cities\":[{\"id\":\"city-1\"}]}', 1)",
            [],
        )
        .unwrap();
        save_city_map_record(&conn, "world-1", "city-1", city_map("city-1")).unwrap();

        assert!(get_city_map_record(&conn, "world-2", "city-1")
            .err()
            .expect("cross-world reads must fail")
            .contains("another world"));
        assert!(delete_city_map_record(&conn, "world-2", "city-1")
            .unwrap_err()
            .contains("another world"));
        assert!(get_city_map_record(&conn, "world-1", "city-1")
            .unwrap()
            .is_some());
    }

    #[test]
    fn deletion_is_scoped_and_idempotent_after_parent_cleanup() {
        let conn = database_with_city();
        save_city_map_record(&conn, "world-1", "city-1", city_map("city-1")).unwrap();
        delete_city_map_record(&conn, "world-1", "city-1").unwrap();
        delete_city_map_record(&conn, "world-1", "city-1").unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM city_maps", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
