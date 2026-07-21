use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, ToSql};
use serde::de::DeserializeOwned;
use serde::Serialize;

/// Load a JSON blob from a table keyed by an ID column.
pub fn load_json_by_key<T: DeserializeOwned>(
    conn: &Connection,
    table: &str,
    key_column: &str,
    key: &str,
    json_column: &str,
) -> Result<Option<T>, String> {
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
    let encoded =
        serde_json::to_string(payload).map_err(|e| format!("Failed to encode JSON: {e}"))?;
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

    conn.execute(&query, (&key as &dyn ToSql, &encoded, &now))
        .map_err(|e| e.to_string())?;
    Ok(())
}
