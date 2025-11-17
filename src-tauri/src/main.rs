#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;
use uuid::Uuid;

struct AppState {
    conn: Mutex<Connection>,
}

#[derive(Serialize)]
struct World {
    id: String,
    name: String,
    game_system: String,
    description: String,
    created_at: i64,
}

#[derive(Serialize)]
struct Character {
    id: String,
    world_id: String,
    name: String,
    notes: String,
    attributes_json: String,
    created_at: i64,
}

#[derive(Serialize)]
struct WorldEntry {
    id: String,
    world_id: String,
    category: String,
    title: String,
    summary: String,
    body: String,
    metadata_json: String,
    created_at: i64,
}

#[derive(Serialize)]
struct WorldTemplate {
    id: String,
    world_id: String,
    template_type: String,
    name: String,
    definition_json: String,
    created_at: i64,
}

#[derive(Deserialize)]
struct TemplateInput {
    template_type: String,
    name: String,
    definition: Value,
}

#[derive(Serialize)]
struct LoreBook {
    id: String,
    world_id: String,
    title: String,
    summary: String,
    created_at: i64,
}

#[derive(Serialize)]
struct LoreEntry {
    id: String,
    book_id: String,
    title: String,
    content: String,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct MapCity {
    id: String,
    name: String,
    x: f64,
    y: f64,
    elevation: f64,
    population: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct RoadPoint {
    x: f64,
    y: f64,
}

#[derive(Serialize, Deserialize, Clone)]
struct MapRoad {
    id: String,
    from_city_id: String,
    to_city_id: String,
    points: Vec<RoadPoint>,
}

#[derive(Serialize, Deserialize)]
struct MapState {
    width: u32,
    height: u32,
    relief: Vec<f32>,
    moisture: Vec<f32>,
    water_level: f32,
    seed: u64,
    cities: Vec<MapCity>,
    roads: Vec<MapRoad>,
}

fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    // make sure FKs work
    conn.execute("PRAGMA foreign_keys = ON;", [])?;

    // worlds
    conn.execute(
        "CREATE TABLE IF NOT EXISTS worlds (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            game_system TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // characters (PCs for now, NPCs later)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            name TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            attributes_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS world_entries (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_world_entries_world_category
         ON world_entries(world_id, category)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS world_maps (
            world_id TEXT PRIMARY KEY,
            map_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS world_templates (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            template_type TEXT NOT NULL,
            name TEXT NOT NULL,
            definition_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_world_templates_world_type
         ON world_templates(world_id, template_type)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS world_lore_books (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS world_lore_entries (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(book_id) REFERENCES world_lore_books(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_world_lore_books_world
         ON world_lore_books(world_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_world_lore_entries_book
         ON world_lore_entries(book_id)",
        [],
    )?;

    Ok(())
}

#[tauri::command]
fn list_worlds(state: tauri::State<AppState>) -> Result<Vec<World>, String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;

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
fn create_world(
    state: tauri::State<AppState>,
    name: String,
    game_system: String,
) -> Result<World, String> {
    if name.trim().is_empty() {
        return Err("World name cannot be empty".into());
    }

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let game_system = game_system.trim().to_string();

    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
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
fn get_world(state: tauri::State<AppState>, id: String) -> Result<World, String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;

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
fn update_world(
    state: tauri::State<AppState>,
    id: String,
    name: String,
    game_system: String,
    description: String,
) -> Result<World, String> {
    if name.trim().is_empty() {
        return Err("World name cannot be empty".into());
    }

    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "UPDATE worlds
         SET name = ?1,
             game_system = ?2,
             description = ?3
         WHERE id = ?4",
        (&name, &game_system, &description, &id),
    )
    .map_err(|e| e.to_string())?;

    // return the updated record
    drop(conn);
    get_world(state, id)
}

fn validate_entry_category(category: &str) -> Result<(), String> {
    match category {
        "magic_system" | "item_type" | "character_template" | "faction" | "region" => Ok(()),
        _ => Err("Unsupported world entry category".into()),
    }
}

fn map_world_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorldEntry> {
    Ok(WorldEntry {
        id: row.get(0)?,
        world_id: row.get(1)?,
        category: row.get(2)?,
        title: row.get(3)?,
        summary: row.get(4)?,
        body: row.get(5)?,
        metadata_json: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn fetch_world_entry_by_id(
    conn: &Connection,
    entry_id: &str,
) -> Result<WorldEntry, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
         FROM world_entries
         WHERE id = ?1",
    )?;

    stmt.query_row([entry_id], map_world_entry)
}

#[tauri::command]
fn list_characters(
    state: tauri::State<AppState>,
    world_id: String,
) -> Result<Vec<Character>, String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, world_id, name, notes, attributes_json, created_at
             FROM characters
             WHERE world_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let chars_iter = stmt
        .query_map([&world_id], |row| {
            Ok(Character {
                id: row.get(0)?,
                world_id: row.get(1)?,
                name: row.get(2)?,
                notes: row.get(3)?,
                attributes_json: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for c in chars_iter {
        result.push(c.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn create_character(
    state: tauri::State<AppState>,
    world_id: String,
    name: String,
) -> Result<Character, String> {
    if name.trim().is_empty() {
        return Err("Character name cannot be empty".into());
    }

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();

    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO characters (id, world_id, name, notes, attributes_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&id, &world_id, &name, &"", &"{}", &created_at),
    )
    .map_err(|e| e.to_string())?;

    Ok(Character {
        id,
        world_id,
        name,
        notes: "".into(),
        attributes_json: "{}".into(),
        created_at,
    })
}

#[tauri::command]
fn list_world_entries(
    state: tauri::State<AppState>,
    world_id: String,
    category: Option<String>,
) -> Result<Vec<WorldEntry>, String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    let mut entries = Vec::new();

    if let Some(cat) = category {
        validate_entry_category(&cat)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
                 FROM world_entries
                 WHERE world_id = ?1 AND category = ?2
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map((&world_id, &cat), |row| map_world_entry(row))
            .map_err(|e| e.to_string())?;

        for entry in iter {
            entries.push(entry.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
                 FROM world_entries
                 WHERE world_id = ?1
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map([&world_id], |row| map_world_entry(row))
            .map_err(|e| e.to_string())?;

        for entry in iter {
            entries.push(entry.map_err(|e| e.to_string())?);
        }
    }

    Ok(entries)
}

#[tauri::command]
fn create_world_entry(
    state: tauri::State<AppState>,
    world_id: String,
    category: String,
    title: String,
    summary: String,
    body: String,
    metadata_json: Option<String>,
) -> Result<WorldEntry, String> {
    if title.trim().is_empty() {
        return Err("Entry title cannot be empty".into());
    }
    validate_entry_category(&category)?;

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let metadata = metadata_json.unwrap_or_else(|| "{}".into());

    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO world_entries
         (id, world_id, category, title, summary, body, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (
            &id,
            &world_id,
            &category,
            &title,
            &summary,
            &body,
            &metadata,
            &created_at,
        ),
    )
    .map_err(|e| e.to_string())?;

    Ok(WorldEntry {
        id,
        world_id,
        category,
        title,
        summary,
        body,
        metadata_json: metadata,
        created_at,
    })
}

#[tauri::command]
fn update_world_entry(
    state: tauri::State<AppState>,
    id: String,
    title: String,
    summary: String,
    body: String,
    metadata_json: Option<String>,
) -> Result<WorldEntry, String> {
    if title.trim().is_empty() {
        return Err("Entry title cannot be empty".into());
    }

    let metadata = metadata_json.unwrap_or_else(|| "{}".into());
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "UPDATE world_entries
         SET title = ?1,
             summary = ?2,
             body = ?3,
             metadata_json = ?4
         WHERE id = ?5",
        (&title, &summary, &body, &metadata, &id),
    )
    .map_err(|e| e.to_string())?;

    let entry = fetch_world_entry_by_id(&conn, &id).map_err(|e| e.to_string())?;
    Ok(entry)
}

#[tauri::command]
fn delete_world_entry(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute("DELETE FROM world_entries WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_world_templates(
    state: tauri::State<AppState>,
    world_id: String,
    template_type: Option<String>,
) -> Result<Vec<WorldTemplate>, String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;

    let mut templates = Vec::new();
    if let Some(t_type) = template_type {
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, template_type, name, definition_json, created_at
                 FROM world_templates
                 WHERE world_id = ?1 AND template_type = ?2
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map((&world_id, &t_type), |row| {
                Ok(WorldTemplate {
                    id: row.get(0)?,
                    world_id: row.get(1)?,
                    template_type: row.get(2)?,
                    name: row.get(3)?,
                    definition_json: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            templates.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, template_type, name, definition_json, created_at
                 FROM world_templates
                 WHERE world_id = ?1
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([&world_id], |row| {
                Ok(WorldTemplate {
                    id: row.get(0)?,
                    world_id: row.get(1)?,
                    template_type: row.get(2)?,
                    name: row.get(3)?,
                    definition_json: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            templates.push(row.map_err(|e| e.to_string())?);
        }
    }

    Ok(templates)
}

#[tauri::command]
fn save_world_templates(
    state: tauri::State<AppState>,
    world_id: String,
    templates: Vec<TemplateInput>,
) -> Result<Vec<WorldTemplate>, String> {
    let mut conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

    tx.execute(
        "DELETE FROM world_templates WHERE world_id = ?1",
        [&world_id],
    )
    .map_err(|e| e.to_string())?;

    let mut inserted = Vec::new();
    for input in templates {
        if input.name.trim().is_empty() {
            return Err("Template name cannot be empty".into());
        }

        let definition_json = serde_json::to_string(&input.definition)
            .map_err(|e| format!("Invalid template definition: {e}"))?;
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().timestamp();

        tx.execute(
            "INSERT INTO world_templates
             (id, world_id, template_type, name, definition_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (
                &id,
                &world_id,
                &input.template_type,
                &input.name,
                &definition_json,
                &created_at,
            ),
        )
        .map_err(|e| e.to_string())?;

        inserted.push(WorldTemplate {
            id,
            world_id: world_id.clone(),
            template_type: input.template_type,
            name: input.name,
            definition_json,
            created_at,
        });
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit templates: {e}"))?;

    Ok(inserted)
}

#[tauri::command]
fn list_lore_books(
    state: tauri::State<AppState>,
    world_id: String,
) -> Result<Vec<LoreBook>, String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, world_id, title, summary, created_at
             FROM world_lore_books
             WHERE world_id = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&world_id], |row| {
            Ok(LoreBook {
                id: row.get(0)?,
                world_id: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut books = Vec::new();
    for row in rows {
        books.push(row.map_err(|e| e.to_string())?);
    }
    Ok(books)
}

#[tauri::command]
fn create_lore_book(
    state: tauri::State<AppState>,
    world_id: String,
    title: String,
    summary: String,
) -> Result<LoreBook, String> {
    if title.trim().is_empty() {
        return Err("Lore book title cannot be empty".into());
    }

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO world_lore_books (id, world_id, title, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (&id, &world_id, &title, &summary, &created_at),
    )
    .map_err(|e| e.to_string())?;

    Ok(LoreBook {
        id,
        world_id,
        title,
        summary,
        created_at,
    })
}

#[tauri::command]
fn list_lore_entries(
    state: tauri::State<AppState>,
    book_id: String,
) -> Result<Vec<LoreEntry>, String> {
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, book_id, title, content, created_at
             FROM world_lore_entries
             WHERE book_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&book_id], |row| {
            Ok(LoreEntry {
                id: row.get(0)?,
                book_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
    }
    Ok(entries)
}

#[tauri::command]
fn create_lore_entry(
    state: tauri::State<AppState>,
    book_id: String,
    title: String,
    content: String,
) -> Result<LoreEntry, String> {
    if title.trim().is_empty() {
        return Err("Lore entry title cannot be empty".into());
    }
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let conn = state.conn.lock().map_err(|_| "DB mutex poisoned".to_string())?;
    conn.execute(
        "INSERT INTO world_lore_entries (id, book_id, title, content, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (&id, &book_id, &title, &content, &created_at),
    )
    .map_err(|e| e.to_string())?;

    Ok(LoreEntry {
        id,
        book_id,
        title,
        content,
        created_at,
    })
}

#[tauri::command]
fn get_world_map(
    state: tauri::State<AppState>,
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
fn save_world_map(
    state: tauri::State<AppState>,
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app.path().app_data_dir()
                .map_err(|_| "Failed to get app data dir".to_string())?;
            std::fs::create_dir_all(&app_dir)
                .map_err(|e| format!("Failed to create app data dir: {e}"))?;

            let db_path = app_dir.join("ttrpg-manager.db");

            let conn =
                Connection::open(db_path).map_err(|e| format!("Failed to open DB: {e}"))?;

            init_db(&conn).map_err(|e| format!("Failed to init DB: {e}"))?;

            app.manage(AppState {
                conn: Mutex::new(conn),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_worlds,
            create_world,
            get_world,
            update_world,
            list_characters,
            create_character,
            list_world_entries,
            create_world_entry,
            update_world_entry,
            delete_world_entry,
            list_world_templates,
            save_world_templates,
            list_lore_books,
            create_lore_book,
            list_lore_entries,
            create_lore_entry,
            get_world_map,
            save_world_map
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
