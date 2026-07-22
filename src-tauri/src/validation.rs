use serde_json::Value;

pub const MAX_ID_BYTES: usize = 128;
pub const MAX_NAME_BYTES: usize = 200;
pub const MAX_SHORT_TEXT_BYTES: usize = 16 * 1024;
pub const MAX_LONG_TEXT_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_JSON_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

pub fn validate_id(value: String, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.len() > MAX_ID_BYTES {
        return Err(format!("{label} is too long"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} contains invalid control characters"));
    }
    Ok(value.to_owned())
}

pub fn validate_name(value: String, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    if value.len() > MAX_NAME_BYTES {
        return Err(format!(
            "{label} is too long (maximum {MAX_NAME_BYTES} bytes)"
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} contains invalid control characters"));
    }
    Ok(value.to_owned())
}

pub fn validate_optional_label(
    value: String,
    label: &str,
    max_bytes: usize,
) -> Result<String, String> {
    let value = value.trim();
    validate_text(value, label, max_bytes)?;
    if value.chars().any(char::is_control) {
        return Err(format!("{label} contains invalid control characters"));
    }
    Ok(value.to_owned())
}

pub fn validate_text(value: &str, label: &str, max_bytes: usize) -> Result<(), String> {
    if value.len() > max_bytes {
        return Err(format!("{label} is too long (maximum {max_bytes} bytes)"));
    }
    Ok(())
}

pub fn validate_json_object(
    value: Option<String>,
    label: &str,
    max_bytes: usize,
) -> Result<String, String> {
    let value = value.unwrap_or_else(|| "{}".to_owned());
    let value = value.trim();
    let value = if value.is_empty() { "{}" } else { value };
    validate_text(value, label, max_bytes)?;

    let parsed: Value =
        serde_json::from_str(value).map_err(|e| format!("{label} must be valid JSON: {e}"))?;
    if !parsed.is_object() {
        return Err(format!("{label} must be a JSON object"));
    }

    serde_json::to_string(&parsed).map_err(|e| format!("Failed to normalize {label}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_trimmed_and_control_characters_are_rejected() {
        assert_eq!(
            validate_name("  Ember Coast  ".into(), "Name").unwrap(),
            "Ember Coast"
        );
        assert!(validate_name("bad\nname".into(), "Name").is_err());
    }

    #[test]
    fn json_objects_are_normalized() {
        assert_eq!(
            validate_json_object(Some(" { \"tags\": [\"a\"] } ".into()), "Metadata", 100).unwrap(),
            r#"{"tags":["a"]}"#
        );
        assert!(validate_json_object(Some("[]".into()), "Metadata", 100).is_err());
        assert!(validate_json_object(Some("{".into()), "Metadata", 100).is_err());
    }
}
