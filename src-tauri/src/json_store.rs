use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde::Serialize;

const MAX_STORED_JSON_BYTES: usize = 64 * 1024 * 1024;

fn validate_sql_identifier(identifier: &str) -> Result<(), String> {
    if identifier.is_empty()
        || !identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err("Invalid internal JSON store identifier".into());
    }
    Ok(())
}

/// Load a JSON blob from a table keyed by an ID column.
pub fn load_json_by_key<T: DeserializeOwned>(
    conn: &Connection,
    table: &str,
    key_column: &str,
    key: &str,
    json_column: &str,
) -> Result<Option<T>, String> {
    validate_sql_identifier(table)?;
    validate_sql_identifier(key_column)?;
    validate_sql_identifier(json_column)?;
    let query = format!(
        "SELECT {json_column} FROM {table} WHERE {key_column} = ?1",
        json_column = json_column,
        table = table,
        key_column = key_column
    );

    let map_json: Option<String> = conn
        .prepare(&query)
        .map_err(|e| e.to_string())?
        .query_row([key], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(json) = map_json {
        if json.len() > MAX_STORED_JSON_BYTES {
            return Err(format!(
                "Stored JSON in {table} exceeds the 64 MiB safety limit"
            ));
        }
        let parsed = serde_json::from_str::<T>(&json)
            .map_err(|e| format!("Invalid JSON stored in {table}: {e}"))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

/// Upsert a JSON blob into a table keyed by an ID column, setting an updated_at timestamp.
pub fn upsert_json_by_key<T: Serialize>(
    conn: &Connection,
    table: &str,
    key_column: &str,
    key: &str,
    json_column: &str,
    updated_at_column: &str,
    payload: &T,
) -> Result<(), String> {
    validate_sql_identifier(table)?;
    validate_sql_identifier(key_column)?;
    validate_sql_identifier(json_column)?;
    validate_sql_identifier(updated_at_column)?;
    let encoded =
        serde_json::to_string(payload).map_err(|e| format!("Failed to encode JSON: {e}"))?;
    if encoded.len() > MAX_STORED_JSON_BYTES {
        return Err("JSON payload exceeds the 64 MiB storage limit".into());
    }
    let now = Utc::now().timestamp();

    let query = format!(
        "INSERT INTO {table} ({key_column}, {json_column}, {updated_at_column})
         VALUES (?1, ?2, ?3)
         ON CONFLICT({key_column}) DO UPDATE SET
            {json_column} = excluded.{json_column},
            {updated_at_column} = excluded.{updated_at_column}",
        table = table,
        key_column = key_column,
        json_column = json_column,
        updated_at_column = updated_at_column
    );

    conn.execute(&query, params![key, encoded, now])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_cannot_inject_sql() {
        assert!(validate_sql_identifier("world_maps").is_ok());
        assert!(validate_sql_identifier("world_maps; DROP TABLE worlds").is_err());
    }

    #[test]
    fn json_round_trips_through_the_store() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE documents (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .unwrap();
        let value = serde_json::json!({"ok": true});
        upsert_json_by_key(
            &conn,
            "documents",
            "id",
            "one",
            "body",
            "updated_at",
            &value,
        )
        .unwrap();
        let loaded: Option<serde_json::Value> =
            load_json_by_key(&conn, "documents", "id", "one", "body").unwrap();
        assert_eq!(loaded, Some(value));
    }
}
