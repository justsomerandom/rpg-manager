use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde_json::Value;

const SCHEMA_VERSION: i64 = 2;

pub struct AppState {
    pub conn: Mutex<Connection>,
}

pub fn init_db(conn: &mut Connection) -> Result<(), String> {
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("Failed to configure database timeout: {e}"))?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| format!("Failed to enable foreign keys: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to enable WAL journaling: {e}"))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("Failed to configure database synchronization: {e}"))?;

    let existing_version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| format!("Failed to read database schema version: {e}"))?;
    if existing_version > SCHEMA_VERSION {
        return Err(format!(
            "This database was created by a newer RPG Manager version (schema {existing_version}, supported {SCHEMA_VERSION})"
        ));
    }

    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to start database migration: {e}"))?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS worlds (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL CHECK(length(trim(name)) > 0),
            game_system TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            name TEXT NOT NULL CHECK(length(trim(name)) > 0),
            notes TEXT NOT NULL DEFAULT '',
            attributes_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS world_entries (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL CHECK(length(trim(title)) > 0),
            summary TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS world_maps (
            world_id TEXT PRIMARY KEY,
            map_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS world_templates (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            template_type TEXT NOT NULL,
            name TEXT NOT NULL CHECK(length(trim(name)) > 0),
            definition_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS world_lore_books (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            title TEXT NOT NULL CHECK(length(trim(title)) > 0),
            summary TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS world_lore_entries (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL CHECK(length(trim(title)) > 0),
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(book_id) REFERENCES world_lore_books(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS city_maps (
            city_id TEXT PRIMARY KEY,
            world_id TEXT,
            map_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_characters_world_created
            ON characters(world_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_world_entries_world_category
            ON world_entries(world_id, category);
        CREATE INDEX IF NOT EXISTS idx_world_templates_world_type
            ON world_templates(world_id, template_type);
        CREATE INDEX IF NOT EXISTS idx_world_lore_books_world
            ON world_lore_books(world_id);
        CREATE INDEX IF NOT EXISTS idx_world_lore_entries_book
            ON world_lore_entries(book_id);",
    )
    .map_err(|e| format!("Failed to create database schema: {e}"))?;

    if !city_maps_has_world_id(&tx)? {
        tx.execute(
            "ALTER TABLE city_maps
             ADD COLUMN world_id TEXT REFERENCES worlds(id) ON DELETE CASCADE",
            [],
        )
        .map_err(|e| format!("Failed to migrate city map ownership: {e}"))?;
    }
    tx.execute(
        "CREATE INDEX IF NOT EXISTS idx_city_maps_world ON city_maps(world_id)",
        [],
    )
    .map_err(|e| format!("Failed to index city map ownership: {e}"))?;

    tx.pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(|e| format!("Failed to record database schema version: {e}"))?;
    tx.commit()
        .map_err(|e| format!("Failed to commit database migration: {e}"))?;

    backfill_city_map_ownership(conn)?;
    Ok(())
}

fn city_maps_has_world_id(conn: &Connection) -> Result<bool, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(city_maps)")
        .map_err(|e| format!("Failed to inspect city map schema: {e}"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to inspect city map schema: {e}"))?;
    for column in columns {
        if column.map_err(|e| format!("Failed to inspect city map schema: {e}"))? == "world_id" {
            return Ok(true);
        }
    }
    Ok(false)
}

fn backfill_city_map_ownership(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT world_id, map_json FROM world_maps")
        .map_err(|e| format!("Failed to inspect saved maps: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to inspect saved maps: {e}"))?;

    let mut ownership = Vec::new();
    for row in rows {
        let (world_id, map_json) = row.map_err(|e| format!("Failed to inspect saved maps: {e}"))?;
        for city_id in city_ids_from_map_json(&map_json) {
            ownership.push((city_id, world_id.clone()));
        }
    }
    drop(stmt);

    for (city_id, world_id) in ownership {
        conn.execute(
            "UPDATE city_maps SET world_id = ?1
             WHERE city_id = ?2 AND (world_id IS NULL OR world_id = ?1)",
            (&world_id, &city_id),
        )
        .map_err(|e| format!("Failed to restore city map ownership: {e}"))?;
    }
    Ok(())
}

pub fn city_ids_from_map_json(map_json: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<Value>(map_json) else {
        return Vec::new();
    };
    value
        .get("cities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|city| city.get("id").and_then(Value::as_str))
        .map(str::to_owned)
        .collect()
}

pub fn ensure_world_exists(conn: &Connection, world_id: &str) -> Result<(), String> {
    let exists = conn
        .query_row("SELECT 1 FROM worlds WHERE id = ?1", [world_id], |_| Ok(()))
        .optional()
        .map_err(|e| format!("Failed to verify world: {e}"))?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err("World not found".into())
    }
}

pub fn ensure_lore_book_exists(conn: &Connection, book_id: &str) -> Result<(), String> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM world_lore_books WHERE id = ?1",
            [book_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|e| format!("Failed to verify lore book: {e}"))?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err("Lore book not found".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialization_is_repeatable_and_enables_foreign_keys() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_db(&mut conn).unwrap();
        init_db(&mut conn).unwrap();

        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        let foreign_keys: i64 = conn
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert_eq!(foreign_keys, 1);
        assert!(city_maps_has_world_id(&conn).unwrap());
    }

    #[test]
    fn migrates_and_backfills_legacy_city_maps_without_data_loss() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT NOT NULL, game_system TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
             CREATE TABLE world_maps (world_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE);
             CREATE TABLE city_maps (city_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
             INSERT INTO worlds VALUES ('world-1', 'World', '', '', 1);
             INSERT INTO world_maps VALUES ('world-1', '{\"cities\":[{\"id\":\"city-1\"}]}', 1);
             INSERT INTO city_maps VALUES ('city-1', '{\"city_id\":\"city-1\"}', 1);",
        )
        .unwrap();

        init_db(&mut conn).unwrap();
        let owner: Option<String> = conn
            .query_row(
                "SELECT world_id FROM city_maps WHERE city_id = 'city-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner.as_deref(), Some("world-1"));
        let json: String = conn
            .query_row(
                "SELECT map_json FROM city_maps WHERE city_id = 'city-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(json.contains("city-1"));
    }

    #[test]
    fn refuses_a_database_from_a_newer_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        assert!(init_db(&mut conn).unwrap_err().contains("newer"));
    }
}
