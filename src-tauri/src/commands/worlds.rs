use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use tauri::State;
use uuid::Uuid;

use super::templates::{insert_prepared_templates, prepare_templates};
use crate::db::{city_ids_from_map_json, AppState};
use crate::models::{TemplateInput, World};
use crate::validation::{
    validate_id, validate_name, validate_optional_label, validate_text, MAX_LONG_TEXT_BYTES,
    MAX_SHORT_TEXT_BYTES,
};

fn map_world(row: &rusqlite::Row<'_>) -> rusqlite::Result<World> {
    Ok(World {
        id: row.get(0)?,
        name: row.get(1)?,
        game_system: row.get(2)?,
        description: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn insert_world(conn: &Connection, name: String, game_system: String) -> Result<World, String> {
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO worlds (id, name, game_system, description, created_at)
         VALUES (?1, ?2, ?3, '', ?4)",
        (&id, &name, &game_system, &created_at),
    )
    .map_err(|e| format!("Failed to create world: {e}"))?;
    Ok(World {
        id,
        name,
        game_system,
        description: String::new(),
        created_at,
    })
}

fn validate_world_fields(name: String, game_system: String) -> Result<(String, String), String> {
    Ok((
        validate_name(name, "World name")?,
        validate_optional_label(game_system, "Game system", MAX_SHORT_TEXT_BYTES.min(200))?,
    ))
}

#[tauri::command]
pub fn list_worlds(state: State<AppState>) -> Result<Vec<World>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, game_system, description, created_at
             FROM worlds
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| format!("Failed to load worlds: {e}"))?;
    let rows = stmt
        .query_map([], map_world)
        .map_err(|e| format!("Failed to load worlds: {e}"))?;
    let mut worlds = Vec::new();
    for row in rows {
        worlds.push(row.map_err(|e| format!("Failed to read a world: {e}"))?);
    }
    Ok(worlds)
}

#[tauri::command]
pub fn create_world(
    state: State<AppState>,
    name: String,
    game_system: String,
) -> Result<World, String> {
    let (name, game_system) = validate_world_fields(name, game_system)?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    insert_world(&conn, name, game_system)
}

#[tauri::command]
pub fn create_world_with_templates(
    state: State<AppState>,
    name: String,
    game_system: String,
    templates: Vec<TemplateInput>,
) -> Result<World, String> {
    let (name, game_system) = validate_world_fields(name, game_system)?;
    let templates = prepare_templates(templates)?;
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start world creation: {e}"))?;
    let world = insert_world(&tx, name, game_system)?;
    insert_prepared_templates(&tx, &world.id, templates)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit world creation: {e}"))?;
    Ok(world)
}

#[tauri::command]
pub fn get_world(state: State<AppState>, id: String) -> Result<World, String> {
    let id = validate_id(id, "World ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    conn.query_row(
        "SELECT id, name, game_system, description, created_at
         FROM worlds WHERE id = ?1",
        [&id],
        map_world,
    )
    .optional()
    .map_err(|e| format!("Failed to load world: {e}"))?
    .ok_or_else(|| "World not found".into())
}

#[tauri::command]
pub fn update_world(
    state: State<AppState>,
    id: String,
    name: String,
    game_system: String,
    description: String,
) -> Result<World, String> {
    let id = validate_id(id, "World ID")?;
    let (name, game_system) = validate_world_fields(name, game_system)?;
    validate_text(&description, "World description", MAX_LONG_TEXT_BYTES)?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute(
            "UPDATE worlds SET name = ?1, game_system = ?2, description = ?3 WHERE id = ?4",
            (&name, &game_system, &description, &id),
        )
        .map_err(|e| format!("Failed to update world: {e}"))?;
    if affected == 0 {
        return Err("World not found".into());
    }
    conn.query_row(
        "SELECT id, name, game_system, description, created_at FROM worlds WHERE id = ?1",
        [&id],
        map_world,
    )
    .map_err(|e| format!("Failed to load updated world: {e}"))
}

#[tauri::command]
pub fn delete_world(state: State<AppState>, id: String) -> Result<(), String> {
    let id = validate_id(id, "World ID")?;
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    delete_world_record(&mut conn, &id)
}

fn delete_world_record(conn: &mut Connection, id: &str) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start world deletion: {e}"))?;

    let map_json: Option<String> = tx
        .query_row(
            "SELECT map_json FROM world_maps WHERE world_id = ?1",
            [&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to inspect the world's map: {e}"))?;
    if let Some(map_json) = map_json {
        for city_id in city_ids_from_map_json(&map_json) {
            tx.execute(
                "DELETE FROM city_maps WHERE city_id = ?1 AND world_id = ?2",
                (&city_id, id),
            )
            .map_err(|e| format!("Failed to remove a city map: {e}"))?;
        }
    }
    tx.execute("DELETE FROM city_maps WHERE world_id = ?1", [&id])
        .map_err(|e| format!("Failed to remove owned city maps: {e}"))?;
    let affected = tx
        .execute("DELETE FROM worlds WHERE id = ?1", [&id])
        .map_err(|e| format!("Failed to delete world: {e}"))?;
    if affected == 0 {
        return Err("World not found".into());
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit world deletion: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;

    #[test]
    fn world_and_templates_can_be_committed_atomically() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_db(&mut conn).unwrap();
        let tx = conn.transaction().unwrap();
        let world = insert_world(&tx, "World".into(), "Custom".into()).unwrap();
        let prepared = prepare_templates(vec![TemplateInput {
            template_type: "character".into(),
            name: "Sheet".into(),
            client_key: None,
            definition: serde_json::json!({"fields": []}),
        }])
        .unwrap();
        insert_prepared_templates(&tx, &world.id, prepared).unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM world_templates WHERE world_id = ?1",
                [&world.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn deleting_a_world_cleans_its_owned_city_maps() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_db(&mut conn).unwrap();
        let world = insert_world(&conn, "World".into(), "Custom".into()).unwrap();
        conn.execute(
            "INSERT INTO world_maps (world_id, map_json, updated_at)
             VALUES (?1, '{\"cities\":[{\"id\":\"city-1\"}]}', 1)",
            [&world.id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO city_maps (city_id, world_id, map_json, updated_at)
             VALUES ('city-1', ?1, '{}', 1)",
            [&world.id],
        )
        .unwrap();

        delete_world_record(&mut conn, &world.id).unwrap();
        let worlds: i64 = conn
            .query_row("SELECT count(*) FROM worlds", [], |row| row.get(0))
            .unwrap();
        let city_maps: i64 = conn
            .query_row("SELECT count(*) FROM city_maps", [], |row| row.get(0))
            .unwrap();
        assert_eq!(worlds, 0);
        assert_eq!(city_maps, 0);
    }
}
