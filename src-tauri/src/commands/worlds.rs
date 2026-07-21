use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::db::AppState;
use crate::models::World;

#[tauri::command]
pub fn list_worlds(state: State<AppState>) -> Result<Vec<World>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, game_system, description, created_at
             FROM worlds
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let worlds_iter = stmt
        .query_map([], |row| {
            Ok(World {
                id: row.get(0)?,
                name: row.get(1)?,
                game_system: row.get(2)?,
                description: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut worlds = Vec::new();
    for w in worlds_iter {
        worlds.push(w.map_err(|e| e.to_string())?);
    }

    Ok(worlds)
}

#[tauri::command]
pub fn create_world(
    state: State<AppState>,
    name: String,
    game_system: String,
) -> Result<World, String> {
    if name.trim().is_empty() {
        return Err("World name cannot be empty".into());
    }

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let game_system = game_system.trim().to_string();

    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO worlds (id, name, game_system, description, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (&id, &name, &game_system, &"", &created_at),
    )
    .map_err(|e| e.to_string())?;

    Ok(World {
        id,
        name,
        game_system,
        description: "".into(),
        created_at,
    })
}

#[tauri::command]
pub fn get_world(state: State<AppState>, id: String) -> Result<World, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, game_system, description, created_at
             FROM worlds WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let world = stmt
        .query_row([id], |row| {
            Ok(World {
                id: row.get(0)?,
                name: row.get(1)?,
                game_system: row.get(2)?,
                description: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(world)
}

#[tauri::command]
pub fn update_world(
    state: State<AppState>,
    id: String,
    name: String,
    game_system: String,
    description: String,
) -> Result<World, String> {
    if name.trim().is_empty() {
        return Err("World name cannot be empty".into());
    }

    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "UPDATE worlds
         SET name = ?1,
             game_system = ?2,
             description = ?3
         WHERE id = ?4",
        (&name, &game_system, &description, &id),
    )
    .map_err(|e| e.to_string())?;

    drop(conn);
    get_world(state, id)
}
