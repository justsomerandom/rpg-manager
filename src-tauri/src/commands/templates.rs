use chrono::Utc;
use rusqlite::Connection;
use tauri::State;
use uuid::Uuid;

use crate::db::{ensure_world_exists, AppState};
use crate::models::{TemplateInput, WorldTemplate};
use crate::validation::{validate_id, validate_name, validate_text, MAX_JSON_DOCUMENT_BYTES};

const MAX_TEMPLATES_PER_WORLD: usize = 500;
const MAX_TOTAL_TEMPLATE_BYTES: usize = 8 * 1024 * 1024;

pub(crate) struct PreparedTemplate {
    template_type: String,
    name: String,
    definition_json: String,
}

fn validate_template_type(template_type: String) -> Result<String, String> {
    let template_type = template_type.trim().to_owned();
    if matches!(
        template_type.as_str(),
        "character" | "npc" | "item" | "ability" | "custom_entity"
    ) {
        Ok(template_type)
    } else {
        Err("Unsupported template type".into())
    }
}

pub(crate) fn prepare_templates(
    templates: Vec<TemplateInput>,
) -> Result<Vec<PreparedTemplate>, String> {
    if templates.len() > MAX_TEMPLATES_PER_WORLD {
        return Err(format!(
            "A world can contain at most {MAX_TEMPLATES_PER_WORLD} templates"
        ));
    }

    let mut prepared = Vec::with_capacity(templates.len());
    let mut total_bytes = 0usize;
    for input in templates {
        let template_type = validate_template_type(input.template_type)?;
        let name = validate_name(input.name, "Template name")?;
        if !input.definition.is_object() {
            return Err(format!(
                "Definition for template '{name}' must be a JSON object"
            ));
        }
        let definition_json = serde_json::to_string(&input.definition)
            .map_err(|e| format!("Invalid definition for template '{name}': {e}"))?;
        validate_text(
            &definition_json,
            "Template definition",
            MAX_JSON_DOCUMENT_BYTES,
        )?;
        total_bytes = total_bytes
            .checked_add(definition_json.len())
            .ok_or_else(|| "Template definitions are too large".to_owned())?;
        if total_bytes > MAX_TOTAL_TEMPLATE_BYTES {
            return Err("Template definitions exceed the 8 MiB per-world limit".into());
        }
        prepared.push(PreparedTemplate {
            template_type,
            name,
            definition_json,
        });
    }
    Ok(prepared)
}

pub(crate) fn insert_prepared_templates(
    conn: &Connection,
    world_id: &str,
    templates: Vec<PreparedTemplate>,
) -> Result<Vec<WorldTemplate>, String> {
    let created_at = Utc::now().timestamp();
    let mut inserted = Vec::with_capacity(templates.len());
    for input in templates {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO world_templates
             (id, world_id, template_type, name, definition_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (
                &id,
                world_id,
                &input.template_type,
                &input.name,
                &input.definition_json,
                &created_at,
            ),
        )
        .map_err(|e| format!("Failed to save template '{}': {e}", input.name))?;

        inserted.push(WorldTemplate {
            id,
            world_id: world_id.to_owned(),
            template_type: input.template_type,
            name: input.name,
            definition_json: input.definition_json,
            created_at,
        });
    }
    Ok(inserted)
}

#[tauri::command]
pub fn list_world_templates(
    state: State<AppState>,
    world_id: String,
    template_type: Option<String>,
) -> Result<Vec<WorldTemplate>, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let template_type = template_type.map(validate_template_type).transpose()?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;

    let mut templates = Vec::new();
    if let Some(template_type) = template_type {
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, template_type, name, definition_json, created_at
                 FROM world_templates
                 WHERE world_id = ?1 AND template_type = ?2
                 ORDER BY created_at DESC, id DESC",
            )
            .map_err(|e| format!("Failed to load templates: {e}"))?;
        let rows = stmt
            .query_map((&world_id, &template_type), map_world_template)
            .map_err(|e| format!("Failed to load templates: {e}"))?;
        for row in rows {
            templates.push(row.map_err(|e| format!("Failed to read a template: {e}"))?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, template_type, name, definition_json, created_at
                 FROM world_templates
                 WHERE world_id = ?1
                 ORDER BY created_at DESC, id DESC",
            )
            .map_err(|e| format!("Failed to load templates: {e}"))?;
        let rows = stmt
            .query_map([&world_id], map_world_template)
            .map_err(|e| format!("Failed to load templates: {e}"))?;
        for row in rows {
            templates.push(row.map_err(|e| format!("Failed to read a template: {e}"))?);
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
    let world_id = validate_id(world_id, "World ID")?;
    let prepared = prepare_templates(templates)?;
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start template save: {e}"))?;
    tx.execute(
        "DELETE FROM world_templates WHERE world_id = ?1",
        [&world_id],
    )
    .map_err(|e| format!("Failed to replace templates: {e}"))?;
    let inserted = insert_prepared_templates(&tx, &world_id, prepared)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit templates: {e}"))?;
    Ok(inserted)
}

fn map_world_template(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorldTemplate> {
    Ok(WorldTemplate {
        id: row.get(0)?,
        world_id: row.get(1)?,
        template_type: row.get(2)?,
        name: row.get(3)?,
        definition_json: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_types_and_non_object_definitions() {
        let unknown = TemplateInput {
            template_type: "spell".into(),
            name: "Spell".into(),
            definition: serde_json::json!({}),
        };
        assert!(prepare_templates(vec![unknown]).is_err());

        let array = TemplateInput {
            template_type: "item".into(),
            name: "Item".into(),
            definition: serde_json::json!([]),
        };
        assert!(prepare_templates(vec![array]).is_err());
    }
}
