use std::sync::Mutex;

use rusqlite::Connection;

pub struct AppState {
    pub conn: Mutex<Connection>,
}

pub fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute("PRAGMA foreign_keys = ON;", [])?;

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

    conn.execute(
        "CREATE TABLE IF NOT EXISTS city_maps (
            city_id TEXT PRIMARY KEY,
            map_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    Ok(())
}
