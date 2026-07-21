use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::db::AppState;
use crate::models::{TemplateInput, WorldTemplate};

#[tauri::command]
pub fn list_world_templates(
    state: State<AppState>,
    world_id: String,
    template_type: Option<String>,
) -> Result<Vec<WorldTemplate>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;

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
pub fn save_world_templates(
    state: State<AppState>,
    world_id: String,
    templates: Vec<TemplateInput>,
) -> Result<Vec<WorldTemplate>, String> {
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "DB mutex poisoned".to_string())?;
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
