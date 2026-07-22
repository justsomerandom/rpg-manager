use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::Value;

const SCHEMA_VERSION: i64 = 3;
const MAX_SAVED_MAP_JSON_BYTES: usize = 64 * 1024 * 1024;
const MAX_SAVED_MAP_CITY_IDS: usize = 10_000;

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
            world_id TEXT NOT NULL,
            map_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS quarantined_city_maps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            city_id TEXT NOT NULL,
            world_id TEXT,
            map_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            reason TEXT NOT NULL,
            quarantined_at INTEGER NOT NULL
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
            ON world_lore_entries(book_id);
        CREATE INDEX IF NOT EXISTS idx_quarantined_city_maps_city
            ON quarantined_city_maps(city_id);",
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

    reconcile_legacy_city_map_ownership(&tx)?;
    if !city_maps_world_id_is_not_null(&tx)? {
        rebuild_city_maps_with_required_ownership(&tx)?;
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

fn city_maps_world_id_is_not_null(conn: &Connection) -> Result<bool, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(city_maps)")
        .map_err(|e| format!("Failed to inspect city map schema: {e}"))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("Failed to inspect city map schema: {e}"))?;
    while let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to inspect city map schema: {e}"))?
    {
        let name: String = row
            .get(1)
            .map_err(|e| format!("Failed to inspect city map schema: {e}"))?;
        if name == "world_id" {
            let not_null: i64 = row
                .get(3)
                .map_err(|e| format!("Failed to inspect city map schema: {e}"))?;
            return Ok(not_null == 1);
        }
    }
    Ok(false)
}

fn reconcile_legacy_city_map_ownership(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT world_id, map_json FROM world_maps")
        .map_err(|e| format!("Failed to inspect saved maps: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to inspect saved maps: {e}"))?;

    let mut ownership: HashMap<String, HashSet<String>> = HashMap::new();
    for row in rows {
        let (world_id, map_json) = row.map_err(|e| format!("Failed to inspect saved maps: {e}"))?;
        let city_ids = city_ids_from_map_json_checked(&map_json)
            .map_err(|e| format!("Cannot migrate city plans because world '{world_id}' has an invalid saved map: {e}"))?;
        for city_id in city_ids {
            ownership
                .entry(city_id)
                .or_default()
                .insert(world_id.clone());
        }
    }
    drop(stmt);

    let mut stmt = conn
        .prepare("SELECT city_id, world_id, map_json, updated_at FROM city_maps")
        .map_err(|e| format!("Failed to inspect saved city plans: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to inspect saved city plans: {e}"))?;
    let mut city_maps = Vec::new();
    for row in rows {
        city_maps.push(row.map_err(|e| format!("Failed to inspect saved city plans: {e}"))?);
    }
    drop(stmt);

    for (city_id, stored_owner, map_json, updated_at) in city_maps {
        let owners = ownership.get(&city_id);
        let unique_owner = owners.and_then(|owners| {
            if owners.len() == 1 {
                owners.iter().next()
            } else {
                None
            }
        });
        match unique_owner {
            Some(world_id)
                if stored_owner
                    .as_deref()
                    .is_none_or(|stored_owner| stored_owner == world_id) =>
            {
                conn.execute(
                    "UPDATE city_maps SET world_id = ?1 WHERE city_id = ?2",
                    (world_id, &city_id),
                )
                .map_err(|e| format!("Failed to restore city map ownership: {e}"))?;
            }
            _ => {
                // Invalid legacy plans leave the active table, but their exact
                // source data remains available for manual recovery.
                let reason = city_map_quarantine_reason(owners, stored_owner.as_deref());
                conn.execute(
                    "INSERT INTO quarantined_city_maps
                     (city_id, world_id, map_json, updated_at, reason, quarantined_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        &city_id,
                        stored_owner.as_deref(),
                        &map_json,
                        updated_at,
                        &reason,
                        Utc::now().timestamp()
                    ],
                )
                .map_err(|e| format!("Failed to preserve an invalid legacy city plan: {e}"))?;
                conn.execute("DELETE FROM city_maps WHERE city_id = ?1", [&city_id])
                    .map_err(|e| format!("Failed to quarantine an invalid city plan: {e}"))?;
            }
        }
    }
    Ok(())
}

fn city_map_quarantine_reason(
    owners: Option<&HashSet<String>>,
    stored_owner: Option<&str>,
) -> String {
    match owners {
        None => "orphaned: city ID is not present in any saved world map".into(),
        Some(owners) if owners.is_empty() => {
            "orphaned: city ID is not present in any saved world map".into()
        }
        Some(owners) if owners.len() > 1 => {
            "ambiguous: city ID appears in multiple saved world maps".into()
        }
        Some(owners) => {
            let map_owner = owners
                .iter()
                .next()
                .map(String::as_str)
                .unwrap_or("unknown");
            match stored_owner {
                Some(stored_owner) => format!(
                    "conflicting: stored owner '{stored_owner}' does not match saved-map owner '{map_owner}'"
                ),
                None => "orphaned: city plan has no recoverable owner".into(),
            }
        }
    }
}

fn rebuild_city_maps_with_required_ownership(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE city_maps_owned_v3 (
            city_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            map_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
        );
        INSERT INTO city_maps_owned_v3 (city_id, world_id, map_json, updated_at)
            SELECT city_id, world_id, map_json, updated_at FROM city_maps;
        DROP TABLE city_maps;
        ALTER TABLE city_maps_owned_v3 RENAME TO city_maps;",
    )
    .map_err(|e| format!("Failed to require city map ownership: {e}"))
}

pub fn city_ids_from_map_json(map_json: &str) -> Vec<String> {
    city_ids_from_map_json_checked(map_json).unwrap_or_default()
}

pub fn city_ids_from_map_json_checked(map_json: &str) -> Result<Vec<String>, String> {
    if map_json.len() > MAX_SAVED_MAP_JSON_BYTES {
        return Err("Map data exceeds the 64 MiB safety limit".into());
    }
    let value = serde_json::from_str::<Value>(map_json)
        .map_err(|e| format!("Map data is not valid JSON: {e}"))?;
    let cities = value
        .get("cities")
        .and_then(Value::as_array)
        .ok_or_else(|| "Map data does not contain a city collection".to_owned())?;
    if cities.len() > MAX_SAVED_MAP_CITY_IDS {
        return Err(format!(
            "Map data contains more than {MAX_SAVED_MAP_CITY_IDS} cities"
        ));
    }
    let mut city_ids = Vec::with_capacity(cities.len());
    for city in cities {
        let city_id = city
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|city_id| !city_id.is_empty())
            .ok_or_else(|| "Map data contains a city without a valid ID".to_owned())?;
        city_ids.push(city_id.to_owned());
    }
    Ok(city_ids)
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
        assert!(city_maps_world_id_is_not_null(&conn).unwrap());
        let quarantine_table_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'quarantined_city_maps'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(quarantine_table_count, 1);
    }

    #[test]
    fn migrates_backfills_and_quarantines_legacy_city_maps() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT NOT NULL, game_system TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
             CREATE TABLE world_maps (world_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE);
             CREATE TABLE city_maps (city_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
             INSERT INTO worlds VALUES ('world-1', 'World', '', '', 1);
             INSERT INTO world_maps VALUES ('world-1', '{\"cities\":[{\"id\":\"city-1\"}]}', 1);
             INSERT INTO city_maps VALUES ('city-1', '{\"city_id\":\"city-1\"}', 1);
             INSERT INTO city_maps VALUES ('orphan-city', '{\"city_id\":\"orphan-city\"}', 1);",
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
        let orphan_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM city_maps WHERE city_id = 'orphan-city'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(orphan_count, 0);
        let recovered: (String, Option<String>, String, i64, String, i64) = conn
            .query_row(
                "SELECT city_id, world_id, map_json, updated_at, reason, quarantined_at
                 FROM quarantined_city_maps WHERE city_id = 'orphan-city'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(recovered.0, "orphan-city");
        assert_eq!(recovered.1, None);
        assert!(recovered.2.contains("orphan-city"));
        assert_eq!(recovered.3, 1);
        assert!(recovered.4.starts_with("orphaned:"));
        assert!(recovered.5 > 0);
        assert!(city_maps_world_id_is_not_null(&conn).unwrap());

        init_db(&mut conn).unwrap();
        let quarantine_count: i64 = conn
            .query_row("SELECT count(*) FROM quarantined_city_maps", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(quarantine_count, 1);

        let missing_owner_insert = conn.execute(
            "INSERT INTO city_maps (city_id, map_json, updated_at) VALUES ('bad', '{}', 1)",
            [],
        );
        assert!(missing_owner_insert.is_err());
    }

    #[test]
    fn quarantines_ambiguous_legacy_city_maps_instead_of_guessing_an_owner() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT NOT NULL, game_system TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
             CREATE TABLE world_maps (world_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE);
             CREATE TABLE city_maps (city_id TEXT PRIMARY KEY, world_id TEXT, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE);
             INSERT INTO worlds VALUES ('world-1', 'One', '', '', 1);
             INSERT INTO worlds VALUES ('world-2', 'Two', '', '', 2);
             INSERT INTO world_maps VALUES ('world-1', '{\"cities\":[{\"id\":\"shared-city\"}]}', 1);
             INSERT INTO world_maps VALUES ('world-2', '{\"cities\":[{\"id\":\"shared-city\"}]}', 1);
             INSERT INTO city_maps VALUES ('shared-city', NULL, '{\"city_id\":\"shared-city\"}', 1);",
        )
        .unwrap();

        init_db(&mut conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM city_maps WHERE city_id = 'shared-city'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        let recovered: (Option<String>, String, String) = conn
            .query_row(
                "SELECT world_id, map_json, reason FROM quarantined_city_maps
                 WHERE city_id = 'shared-city'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(recovered.0, None);
        assert!(recovered.1.contains("shared-city"));
        assert!(recovered.2.starts_with("ambiguous:"));
    }

    #[test]
    fn quarantines_conflicting_legacy_ownership_with_original_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT NOT NULL, game_system TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
             CREATE TABLE world_maps (world_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE);
             CREATE TABLE city_maps (city_id TEXT PRIMARY KEY, world_id TEXT, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE);
             INSERT INTO worlds VALUES ('world-1', 'One', '', '', 1);
             INSERT INTO worlds VALUES ('world-2', 'Two', '', '', 2);
             INSERT INTO world_maps VALUES ('world-1', '{\"cities\":[{\"id\":\"city-1\"}]}', 1);
             INSERT INTO city_maps VALUES ('city-1', 'world-2', '{\"city_id\":\"city-1\",\"roads\":[]}', 77);",
        )
        .unwrap();

        init_db(&mut conn).unwrap();
        let active_count: i64 = conn
            .query_row("SELECT count(*) FROM city_maps", [], |row| row.get(0))
            .unwrap();
        assert_eq!(active_count, 0);
        let recovered: (String, String, i64, String) = conn
            .query_row(
                "SELECT world_id, map_json, updated_at, reason
                 FROM quarantined_city_maps WHERE city_id = 'city-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(recovered.0, "world-2");
        assert!(recovered.1.contains("\"roads\":[]"));
        assert_eq!(recovered.2, 77);
        assert!(recovered.3.contains("stored owner 'world-2'"));
        assert!(recovered.3.contains("saved-map owner 'world-1'"));
    }

    #[test]
    fn malformed_parent_map_rolls_back_without_deleting_legacy_city_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT NOT NULL, game_system TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
             CREATE TABLE world_maps (world_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE);
             CREATE TABLE city_maps (city_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
             INSERT INTO worlds VALUES ('world-1', 'World', '', '', 1);
             INSERT INTO world_maps VALUES ('world-1', '{', 1);
             INSERT INTO city_maps VALUES ('city-1', '{\"city_id\":\"city-1\"}', 1);",
        )
        .unwrap();

        let error = init_db(&mut conn).unwrap_err();
        assert!(error.contains("invalid saved map"));
        let count: i64 = conn
            .query_row("SELECT count(*) FROM city_maps", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert!(!city_maps_has_world_id(&conn).unwrap());
        let quarantine_table_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'quarantined_city_maps'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(quarantine_table_count, 0);
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 0);
    }

    #[test]
    fn quarantine_delete_failure_rolls_back_the_recovery_copy_and_active_row() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT NOT NULL, game_system TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
             CREATE TABLE world_maps (world_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE);
             CREATE TABLE city_maps (city_id TEXT PRIMARY KEY, map_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
             INSERT INTO city_maps VALUES ('orphan-city', '{\"city_id\":\"orphan-city\"}', 9);
             CREATE TRIGGER reject_city_map_delete
             BEFORE DELETE ON city_maps
             BEGIN
                SELECT RAISE(ABORT, 'injected delete failure');
             END;",
        )
        .unwrap();

        let error = init_db(&mut conn).unwrap_err();
        assert!(error.contains("Failed to quarantine"));
        let active_count: i64 = conn
            .query_row("SELECT count(*) FROM city_maps", [], |row| row.get(0))
            .unwrap();
        assert_eq!(active_count, 1);
        assert!(!city_maps_has_world_id(&conn).unwrap());
        let quarantine_table_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'quarantined_city_maps'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(quarantine_table_count, 0);
    }

    #[test]
    fn refuses_a_database_from_a_newer_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        assert!(init_db(&mut conn).unwrap_err().contains("newer"));
    }
}
