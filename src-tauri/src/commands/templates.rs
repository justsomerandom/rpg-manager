use std::collections::HashSet;

use chrono::Utc;
use rusqlite::Connection;
use serde_json::Value;
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
    let mut client_keys = HashSet::new();
    let mut custom_entity_keys = HashSet::new();
    let mut custom_entity_references = Vec::new();
    for mut input in templates {
        let template_type = validate_template_type(input.template_type)?;
        let name = validate_name(input.name, "Template name")?;
        let Some(definition) = input.definition.as_object_mut() else {
            return Err(format!(
                "Definition for template '{name}' must be a JSON object"
            ));
        };

        let embedded_key = match definition.get("template_key") {
            Some(Value::String(key)) => Some(key.clone()),
            Some(_) => {
                return Err(format!("Template key inside '{name}' must be a string"));
            }
            None => None,
        };
        let client_key = match (input.client_key, embedded_key) {
            (Some(client_key), Some(embedded_key)) if client_key.trim() != embedded_key.trim() => {
                return Err(format!(
                    "Template key for '{name}' conflicts with its saved definition"
                ));
            }
            (Some(client_key), _) | (None, Some(client_key)) => {
                Some(validate_id(client_key, "Template key")?)
            }
            (None, None) => None,
        };

        if let Some(client_key) = &client_key {
            if !client_keys.insert(client_key.clone()) {
                return Err(format!("Duplicate template key: {client_key}"));
            }
            definition.insert("template_key".to_owned(), Value::String(client_key.clone()));
            if template_type == "custom_entity" {
                custom_entity_keys.insert(client_key.clone());
            }
        }

        if template_type == "character" {
            collect_custom_entity_references(definition, &name, &mut custom_entity_references)?;
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

    for (template_name, reference) in custom_entity_references {
        if !custom_entity_keys.contains(&reference) {
            return Err(format!(
                "Character template '{template_name}' references an unknown custom entity key: {reference}"
            ));
        }
    }

    Ok(prepared)
}

fn collect_custom_entity_references(
    definition: &serde_json::Map<String, Value>,
    template_name: &str,
    references: &mut Vec<(String, String)>,
) -> Result<(), String> {
    let Some(features) = definition.get("features") else {
        return Ok(());
    };
    let Some(features) = features.as_array() else {
        return Ok(());
    };

    for feature in features {
        let Some(feature) = feature.as_object() else {
            continue;
        };
        if feature.get("type").and_then(Value::as_str) != Some("custom_entity") {
            continue;
        }
        let reference = feature
            .get("entityId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                format!(
                    "Custom entity feature in character template '{template_name}' needs an entityId"
                )
            })?;
        references.push((
            template_name.to_owned(),
            validate_id(reference.to_owned(), "Custom entity reference")?,
        ));
    }
    Ok(())
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
            client_key: None,
            definition: serde_json::json!({}),
        };
        assert!(prepare_templates(vec![unknown]).is_err());

        let array = TemplateInput {
            template_type: "item".into(),
            name: "Item".into(),
            client_key: None,
            definition: serde_json::json!([]),
        };
        assert!(prepare_templates(vec![array]).is_err());
    }

    #[test]
    fn persists_stable_template_keys_and_validates_custom_entity_references() {
        let character = TemplateInput {
            template_type: "character".into(),
            name: "Character Sheet".into(),
            client_key: None,
            definition: serde_json::json!({
                "features": [{
                    "id": "feature-1",
                    "label": "Allegiance",
                    "type": "custom_entity",
                    "entityId": "faction-template"
                }]
            }),
        };
        let custom_entity = TemplateInput {
            template_type: "custom_entity".into(),
            name: "Faction".into(),
            client_key: Some("faction-template".into()),
            definition: serde_json::json!({"fields": []}),
        };

        let prepared = prepare_templates(vec![character, custom_entity]).unwrap();
        let custom_definition: Value = serde_json::from_str(&prepared[1].definition_json).unwrap();
        assert_eq!(
            custom_definition
                .get("template_key")
                .and_then(Value::as_str),
            Some("faction-template")
        );
    }

    #[test]
    fn rejects_unknown_and_duplicate_template_keys() {
        let character = TemplateInput {
            template_type: "character".into(),
            name: "Character Sheet".into(),
            client_key: Some("shared-key".into()),
            definition: serde_json::json!({
                "features": [{"type": "custom_entity", "entityId": "missing-key"}]
            }),
        };
        let custom_entity = TemplateInput {
            template_type: "custom_entity".into(),
            name: "Faction".into(),
            client_key: Some("shared-key".into()),
            definition: serde_json::json!({"fields": []}),
        };
        let error = prepare_templates(vec![character, custom_entity])
            .err()
            .expect("duplicate keys should be rejected");
        assert!(error.contains("Duplicate template key"));

        let unresolved_character = TemplateInput {
            template_type: "character".into(),
            name: "Character Sheet".into(),
            client_key: None,
            definition: serde_json::json!({
                "features": [{"type": "custom_entity", "entityId": "missing-key"}]
            }),
        };
        let error = prepare_templates(vec![unresolved_character])
            .err()
            .expect("unknown references should be rejected");
        assert!(error.contains("unknown custom entity key"));
    }
}
