#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

mod commands;
mod db;
mod json_store;
mod models;

use commands::*;
use db::{init_db, AppState};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|_| "Failed to get app data dir".to_string())?;
            std::fs::create_dir_all(&app_dir)
                .map_err(|e| format!("Failed to create app data dir: {e}"))?;

            let db_path = app_dir.join("ttrpg-manager.db");

            let conn = Connection::open(db_path).map_err(|e| format!("Failed to open DB: {e}"))?;

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
            save_world_map,
            get_city_map,
            save_city_map
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
