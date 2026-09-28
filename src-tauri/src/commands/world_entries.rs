use std::collections::{HashMap, HashSet};

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Row};
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use crate::db::{ensure_world_exists, AppState};
use crate::models::{IndexSuggestion, WorldEntry, WorldIndexSnapshot};
use crate::validation::{
    validate_id, validate_json_object, validate_name, validate_text, MAX_JSON_DOCUMENT_BYTES,
    MAX_LONG_TEXT_BYTES, MAX_SHORT_TEXT_BYTES,
};

const MAX_INDEX_SUGGESTIONS: usize = 1_000;
const MAX_INLINE_LINKS_PER_FIELD: usize = 100;
const MAX_INDEX_SOURCE_ROWS: i64 = 2_000;

fn validate_entry_category(category: String) -> Result<String, String> {
    let category = category.trim().to_owned();
    match category.as_str() {
        "note" | "magic_system" | "item_type" | "ability" | "character" | "character_template"
        | "faction" | "landmark" | "region" => Ok(category),
        _ => Err("Unsupported world entry category".into()),
    }
}

fn load_world_entries(conn: &Connection, world_id: &str) -> Result<Vec<WorldEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
             FROM world_entries
             WHERE world_id = ?1
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| format!("Failed to load world entries: {e}"))?;
    let rows = stmt
        .query_map([world_id], map_world_entry)
        .map_err(|e| format!("Failed to load world entries: {e}"))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read a world entry: {e}"))
}

fn normalized_title(value: &str) -> String {
    value.trim().to_lowercase()
}

fn text_preview(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut preview: String = trimmed.chars().take(max_chars).collect();
    if trimmed.chars().count() > max_chars {
        preview.push('…');
    }
    preview
}

fn parse_index_links(value: &str) -> Vec<(String, Option<String>, Option<String>)> {
    let mut links = Vec::new();
    let mut remainder = value;
    while let Some(start) = remainder.find("[[") {
        remainder = &remainder[start + 2..];
        let Some(end) = remainder.find("]]") else {
            break;
        };
        let token = &remainder[..end];
        remainder = &remainder[end + 2..];
        let (label, target) = token
            .split_once('|')
            .map_or((token, None), |(label, target)| (label, Some(target)));
        let label = label.trim();
        if label.is_empty() || label.chars().count() > 180 {
            continue;
        }
        let entry_id = target
            .and_then(|target| target.strip_prefix("index:"))
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        let category = target
            .and_then(|target| target.strip_prefix("new:"))
            .and_then(|category| validate_entry_category(category.to_owned()).ok());
        links.push((label.to_owned(), entry_id, category));
        if links.len() >= MAX_INLINE_LINKS_PER_FIELD {
            break;
        }
    }
    links
}

struct SuggestionCoverage {
    entry_ids: HashSet<String>,
    titles: HashSet<String>,
    sources: HashSet<String>,
    suggestion_keys: HashSet<String>,
}

impl SuggestionCoverage {
    fn from_entries(entries: &[WorldEntry]) -> Self {
        let mut coverage = Self {
            entry_ids: HashSet::new(),
            titles: HashSet::new(),
            sources: HashSet::new(),
            suggestion_keys: HashSet::new(),
        };
        for entry in entries {
            coverage.entry_ids.insert(entry.id.clone());
            coverage.titles.insert(normalized_title(&entry.title));
            if let Ok(metadata) = serde_json::from_str::<Value>(&entry.metadata_json) {
                let source = metadata.get("indexSource");
                if let (Some(kind), Some(id)) = (
                    source
                        .and_then(|value| value.get("kind"))
                        .and_then(Value::as_str),
                    source
                        .and_then(|value| value.get("id"))
                        .and_then(Value::as_str),
                ) {
                    coverage.sources.insert(format!("{kind}:{id}"));
                }
            }
        }
        coverage
    }

    fn add(&mut self, suggestions: &mut Vec<IndexSuggestion>, suggestion: IndexSuggestion) {
        if suggestions.len() >= MAX_INDEX_SUGGESTIONS {
            return;
        }
        let source_key = format!("{}:{}", suggestion.source_kind, suggestion.source_id);
        if self.sources.contains(&source_key)
            || self.titles.contains(&normalized_title(&suggestion.title))
            || !self.suggestion_keys.insert(suggestion.key.clone())
        {
            return;
        }
        self.titles.insert(normalized_title(&suggestion.title));
        suggestions.push(suggestion);
    }

    fn add_links(
        &mut self,
        suggestions: &mut Vec<IndexSuggestion>,
        text: &str,
        context: &str,
        default_category: &str,
    ) {
        for (label, entry_id, category) in parse_index_links(text) {
            if entry_id
                .as_ref()
                .is_some_and(|entry_id| self.entry_ids.contains(entry_id))
                || self.titles.contains(&normalized_title(&label))
            {
                continue;
            }
            let normalized = normalized_title(&label);
            self.add(
                suggestions,
                IndexSuggestion {
                    key: format!("reference:{normalized}"),
                    source_kind: "reference".into(),
                    source_id: normalized,
                    title: label,
                    summary: format!("Referenced from {context}."),
                    body: String::new(),
                    category: category.unwrap_or_else(|| default_category.to_owned()),
                    context: context.to_owned(),
                },
            );
        }
    }
}

fn scan_json_strings(value: &Value, strings: &mut Vec<String>) {
    match value {
        Value::String(value) => strings.push(value.clone()),
        Value::Array(values) => {
            for value in values {
                scan_json_strings(value, strings);
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                scan_json_strings(value, strings);
            }
        }
        _ => {}
    }
}

fn load_index_suggestions(
    conn: &Connection,
    world_id: &str,
    entries: &[WorldEntry],
) -> Result<Vec<IndexSuggestion>, String> {
    let mut suggestions = Vec::new();
    let mut coverage = SuggestionCoverage::from_entries(entries);

    let mut character_stmt = conn
        .prepare(
            "SELECT id, name, notes, attributes_json FROM characters
             WHERE world_id = ?1 ORDER BY created_at ASC, id ASC LIMIT ?2",
        )
        .map_err(|e| format!("Failed to inspect characters for the index: {e}"))?;
    let characters = character_stmt
        .query_map((world_id, MAX_INDEX_SOURCE_ROWS), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to inspect characters for the index: {e}"))?;
    for character in characters {
        let (id, name, notes, attributes_json) =
            character.map_err(|e| format!("Failed to read a character for the index: {e}"))?;
        coverage.add(
            &mut suggestions,
            IndexSuggestion {
                key: format!("character:{id}"),
                source_kind: "character".into(),
                source_id: id,
                title: name.clone(),
                summary: text_preview(&notes, 240),
                body: notes.clone(),
                category: "character".into(),
                context: "Character roster".into(),
            },
        );
        coverage.add_links(&mut suggestions, &notes, &format!("{name}'s notes"), "note");
        if let Ok(attributes) = serde_json::from_str::<Value>(&attributes_json) {
            let mut strings = Vec::new();
            scan_json_strings(&attributes, &mut strings);
            for value in strings {
                coverage.add_links(
                    &mut suggestions,
                    &value,
                    &format!("{name}'s character sheet"),
                    "note",
                );
            }
        }
    }

    let mut lore_stmt = conn
        .prepare(
            "SELECT books.title, books.summary, entries.title, entries.content
             FROM world_lore_books AS books
             LEFT JOIN world_lore_entries AS entries ON entries.book_id = books.id
             WHERE books.world_id = ?1
             LIMIT ?2",
        )
        .map_err(|e| format!("Failed to inspect lore for the index: {e}"))?;
    let lore_rows = lore_stmt
        .query_map((world_id, MAX_INDEX_SOURCE_ROWS), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to inspect lore for the index: {e}"))?;
    for row in lore_rows {
        let (book_title, summary, entry_title, content) =
            row.map_err(|e| format!("Failed to read lore for the index: {e}"))?;
        coverage.add_links(
            &mut suggestions,
            &summary,
            &format!("the summary of “{book_title}”"),
            "note",
        );
        if let (Some(entry_title), Some(content)) = (entry_title, content) {
            coverage.add_links(
                &mut suggestions,
                &content,
                &format!("the lore entry “{entry_title}”"),
                "note",
            );
        }
    }

    let mut city_names = HashMap::new();
    let mut location_stmt = conn
        .prepare(
            "SELECT json_extract(city.value, '$.id'), json_extract(city.value, '$.name'),
                    COALESCE(json_extract(city.value, '$.kind'), 'settlement'),
                    COALESCE(json_extract(city.value, '$.population'), 0),
                    json_extract(city.value, '$.x'), json_extract(city.value, '$.y')
             FROM world_maps AS maps,
                  json_each(
                    CASE WHEN json_valid(maps.map_json) THEN maps.map_json ELSE '{\"cities\":[]}' END,
                    '$.cities'
                  ) AS city
             WHERE maps.world_id = ?1
             LIMIT ?2",
        )
        .map_err(|e| format!("Failed to inspect map locations for the index: {e}"))?;
    let locations = location_stmt
        .query_map((world_id, MAX_INDEX_SOURCE_ROWS), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
            ))
        })
        .map_err(|e| format!("Failed to inspect map locations for the index: {e}"))?;
    for location in locations {
        let (id, name, kind, population, x, y) =
            location.map_err(|e| format!("Failed to read a map location for the index: {e}"))?;
        city_names.insert(id.clone(), name.clone());
        coverage.add(
            &mut suggestions,
            IndexSuggestion {
                key: format!("map_location:{id}"),
                source_kind: "map_location".into(),
                source_id: id,
                title: name,
                summary: format!(
                    "{} on the world map{}.",
                    kind.replace('_', " "),
                    if population > 0 {
                        format!(" with a population of {population}")
                    } else {
                        String::new()
                    }
                ),
                body: format!("Map position: {x:.3}, {y:.3}."),
                category: if kind == "landmark" {
                    "landmark"
                } else {
                    "region"
                }
                .into(),
                context: "World map".into(),
            },
        );
    }

    let mut landmark_stmt = conn
        .prepare(
            "SELECT maps.city_id, json_extract(building.value, '$.id'),
                    json_extract(building.value, '$.name'),
                    json_extract(building.value, '$.role'),
                    json_extract(building.value, '$.district'),
                    json_extract(building.value, '$.x'), json_extract(building.value, '$.y')
             FROM city_maps AS maps,
                  json_each(
                    CASE WHEN json_valid(maps.map_json) THEN maps.map_json ELSE '{\"buildings\":[]}' END,
                    '$.buildings'
                  ) AS building
             WHERE maps.world_id = ?1 AND json_extract(building.value, '$.kind') = 'landmark'
             LIMIT ?2",
        )
        .map_err(|e| format!("Failed to inspect city landmarks for the index: {e}"))?;
    let landmarks = landmark_stmt
        .query_map((world_id, MAX_INDEX_SOURCE_ROWS), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, f64>(6)?,
            ))
        })
        .map_err(|e| format!("Failed to inspect city landmarks for the index: {e}"))?;
    for landmark in landmarks {
        let (city_id, id, name, role, district, x, y) =
            landmark.map_err(|e| format!("Failed to read a city landmark for the index: {e}"))?;
        let city_name = city_names
            .get(&city_id)
            .cloned()
            .unwrap_or_else(|| "Unknown city".into());
        let details = [role.as_deref(), district.as_deref()]
            .into_iter()
            .flatten()
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        coverage.add(
            &mut suggestions,
            IndexSuggestion {
                key: format!("city_landmark:{city_id}:{id}"),
                source_kind: "city_landmark".into(),
                source_id: format!("{city_id}:{id}"),
                title: name,
                summary: if details.is_empty() {
                    format!("Landmark in {city_name}.")
                } else {
                    format!("Landmark in {city_name}: {details}.")
                },
                body: format!("City-map position: {x:.3}, {y:.3}."),
                category: "landmark".into(),
                context: format!("City map · {city_name}"),
            },
        );
    }

    Ok(suggestions)
}

fn map_world_entry(row: &Row<'_>) -> rusqlite::Result<WorldEntry> {
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

fn fetch_world_entry_by_id(conn: &Connection, entry_id: &str) -> Result<WorldEntry, String> {
    conn.query_row(
        "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
         FROM world_entries WHERE id = ?1",
        [entry_id],
        map_world_entry,
    )
    .optional()
    .map_err(|e| format!("Failed to load world entry: {e}"))?
    .ok_or_else(|| "World entry not found".into())
}

#[tauri::command]
pub fn list_world_entries(
    state: State<AppState>,
    world_id: String,
    category: Option<String>,
) -> Result<Vec<WorldEntry>, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let category = category.map(validate_entry_category).transpose()?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
    let mut entries = Vec::new();
    if let Some(category) = category {
        let mut stmt = conn
            .prepare(
                "SELECT id, world_id, category, title, summary, body, metadata_json, created_at
                 FROM world_entries
                 WHERE world_id = ?1 AND category = ?2
                 ORDER BY created_at DESC, id DESC",
            )
            .map_err(|e| format!("Failed to load world entries: {e}"))?;
        let rows = stmt
            .query_map((&world_id, &category), map_world_entry)
            .map_err(|e| format!("Failed to load world entries: {e}"))?;
        for row in rows {
            entries.push(row.map_err(|e| format!("Failed to read a world entry: {e}"))?);
        }
    } else {
        entries = load_world_entries(&conn, &world_id)?;
    }
    Ok(entries)
}

#[tauri::command]
pub fn get_world_index_snapshot(
    state: State<AppState>,
    world_id: String,
) -> Result<WorldIndexSnapshot, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
    let entries = load_world_entries(&conn, &world_id)?;
    let suggestions = load_index_suggestions(&conn, &world_id, &entries)?;
    Ok(WorldIndexSnapshot {
        entries,
        suggestions,
    })
}

#[tauri::command]
pub fn create_world_entry(
    state: State<AppState>,
    world_id: String,
    category: String,
    title: String,
    summary: String,
    body: String,
    metadata_json: Option<String>,
) -> Result<WorldEntry, String> {
    let world_id = validate_id(world_id, "World ID")?;
    let category = validate_entry_category(category)?;
    let title = validate_name(title, "Entry title")?;
    validate_text(&summary, "Entry summary", MAX_SHORT_TEXT_BYTES)?;
    validate_text(&body, "Entry body", MAX_LONG_TEXT_BYTES)?;
    let metadata_json =
        validate_json_object(metadata_json, "Entry metadata", MAX_JSON_DOCUMENT_BYTES)?;
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().timestamp();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    ensure_world_exists(&conn, &world_id)?;
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
            &metadata_json,
            &created_at,
        ),
    )
    .map_err(|e| format!("Failed to create world entry: {e}"))?;
    Ok(WorldEntry {
        id,
        world_id,
        category,
        title,
        summary,
        body,
        metadata_json,
        created_at,
    })
}

#[tauri::command]
pub fn update_world_entry(
    state: State<AppState>,
    id: String,
    category: Option<String>,
    title: String,
    summary: String,
    body: String,
    metadata_json: Option<String>,
) -> Result<WorldEntry, String> {
    let id = validate_id(id, "World entry ID")?;
    let category = category.map(validate_entry_category).transpose()?;
    let title = validate_name(title, "Entry title")?;
    validate_text(&summary, "Entry summary", MAX_SHORT_TEXT_BYTES)?;
    validate_text(&body, "Entry body", MAX_LONG_TEXT_BYTES)?;
    let metadata_json =
        validate_json_object(metadata_json, "Entry metadata", MAX_JSON_DOCUMENT_BYTES)?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute(
            "UPDATE world_entries
             SET category = COALESCE(?1, category), title = ?2, summary = ?3, body = ?4, metadata_json = ?5
             WHERE id = ?6",
            (&category, &title, &summary, &body, &metadata_json, &id),
        )
        .map_err(|e| format!("Failed to update world entry: {e}"))?;
    if affected == 0 {
        return Err("World entry not found".into());
    }
    fetch_world_entry_by_id(&conn, &id)
}

#[tauri::command]
pub fn delete_world_entry(state: State<AppState>, id: String) -> Result<(), String> {
    let id = validate_id(id, "World entry ID")?;
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable".to_owned())?;
    let affected = conn
        .execute("DELETE FROM world_entries WHERE id = ?1", [&id])
        .map_err(|e| format!("Failed to delete world entry: {e}"))?;
    if affected == 0 {
        return Err("World entry not found".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;

    #[test]
    fn supports_general_notes_but_rejects_unknown_categories() {
        assert_eq!(validate_entry_category(" note ".into()).unwrap(), "note");
        assert_eq!(
            validate_entry_category("character".into()).unwrap(),
            "character"
        );
        assert!(validate_entry_category("unknown".into()).is_err());
    }

    #[test]
    fn parses_resolved_and_unresolved_inline_links() {
        assert_eq!(
            parse_index_links("See [[North Gate|index:entry-1]] and [[Sun blade|new:item_type]]."),
            vec![
                ("North Gate".into(), Some("entry-1".into()), None),
                ("Sun blade".into(), None, Some("item_type".into()))
            ]
        );
    }

    #[test]
    fn index_scan_batches_created_entities_and_missing_links() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_db(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO worlds (id, name, created_at) VALUES ('world-1', 'World', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO characters (id, world_id, name, notes, attributes_json, created_at)
             VALUES ('hero-1', 'world-1', 'Mara', 'Carries [[Sun blade|new:item_type]].', '{}', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO world_maps (world_id, map_json, updated_at)
             VALUES ('world-1', '{\"cities\":[{\"id\":\"city-1\",\"name\":\"Dawnfall\",\"kind\":\"settlement\",\"population\":1200,\"x\":0.2,\"y\":0.3}]}', 1)",
            [],
        )
        .unwrap();

        let suggestions = load_index_suggestions(&conn, "world-1", &[]).unwrap();
        assert!(suggestions
            .iter()
            .any(|item| item.key == "character:hero-1"));
        assert!(suggestions
            .iter()
            .any(|item| item.title == "Sun blade" && item.category == "item_type"));
        assert!(suggestions
            .iter()
            .any(|item| item.key == "map_location:city-1"));
    }
}
