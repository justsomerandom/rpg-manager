use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

mod commands;
mod db;
mod json_store;
mod models;
mod validation;

use commands::*;
use db::{init_db, AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to locate the app data directory: {e}"))?;
            std::fs::create_dir_all(&app_dir)
                .map_err(|e| format!("Failed to create the app data directory: {e}"))?;
            let db_path = app_dir.join("ttrpg-manager.db");
            let mut conn = Connection::open(&db_path)
                .map_err(|e| format!("Failed to open the local database: {e}"))?;
            init_db(&mut conn)?;
            app.manage(AppState {
                conn: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_worlds,
            create_world,
            create_world_with_templates,
            get_world,
            update_world,
            delete_world,
            list_characters,
            create_character,
            update_character,
            delete_character,
            list_world_entries,
            create_world_entry,
            update_world_entry,
            delete_world_entry,
            list_world_templates,
            save_world_templates,
            list_lore_books,
            create_lore_book,
            update_lore_book,
            delete_lore_book,
            list_lore_entries,
            create_lore_entry,
            update_lore_entry,
            delete_lore_entry,
            get_world_map,
            save_world_map,
            get_city_map,
            save_city_map,
            delete_city_map
        ])
        .run(tauri::generate_context!())
        .expect("RPG Manager could not start");
}
