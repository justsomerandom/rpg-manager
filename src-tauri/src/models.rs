use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validation::{
    validate_id, validate_name, validate_optional_label, validate_text, MAX_ID_BYTES,
    MAX_LONG_TEXT_BYTES,
};

const MIN_MAP_AXIS: u32 = 8;
const MAX_MAP_AXIS: u32 = 256;
const MAX_MAP_CITIES: usize = 10_000;
const MAX_MAP_ROADS: usize = 25_000;
const MAX_MAP_ROAD_POINTS: usize = 500_000;
const MAX_COMPILED_IMAGE_BYTES: usize = 24 * 1024 * 1024;
const MAX_CITY_ROADS: usize = 10_000;
const MAX_CITY_BUILDINGS: usize = 100_000;
const MAX_CITY_ROAD_POINTS: usize = 200_000;

#[derive(Serialize)]
pub struct World {
    pub id: String,
    pub name: String,
    pub game_system: String,
    pub description: String,
    pub created_at: i64,
}

#[derive(Serialize)]
pub struct Character {
    pub id: String,
    pub world_id: String,
    pub name: String,
    pub notes: String,
    pub attributes_json: String,
    pub created_at: i64,
}

#[derive(Serialize)]
pub struct WorldEntry {
    pub id: String,
    pub world_id: String,
    pub category: String,
    pub title: String,
    pub summary: String,
    pub body: String,
    pub metadata_json: String,
    pub created_at: i64,
}

#[derive(Serialize)]
pub struct WorldTemplate {
    pub id: String,
    pub world_id: String,
    pub template_type: String,
    pub name: String,
    pub definition_json: String,
    pub created_at: i64,
}

#[derive(Deserialize)]
pub struct TemplateInput {
    pub template_type: String,
    pub name: String,
    #[serde(default)]
    pub client_key: Option<String>,
    pub definition: Value,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MapCity {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub elevation: f64,
    pub population: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RoadPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MapRoad {
    pub id: String,
    pub from_city_id: String,
    pub to_city_id: String,
    pub points: Vec<RoadPoint>,
}

#[derive(Serialize, Deserialize)]
pub struct MapState {
    pub width: u32,
    pub height: u32,
    pub relief: Vec<f32>,
    pub moisture: Vec<f32>,
    pub water_level: f32,
    pub seed: u64,
    pub cities: Vec<MapCity>,
    pub roads: Vec<MapRoad>,
    #[serde(default)]
    pub temperature: Vec<f32>,
    #[serde(default)]
    pub vegetation: Vec<f32>,
    #[serde(default)]
    pub compiled_grid: Option<String>,
    #[serde(default)]
    pub compiled_iso: Option<String>,
    #[serde(default)]
    pub compiled_updated_at: Option<i64>,
}

impl MapState {
    pub fn normalize_and_validate(&mut self) -> Result<(), String> {
        let cell_count = (self.width as usize)
            .checked_mul(self.height as usize)
            .ok_or_else(|| "Map dimensions are too large".to_owned())?;
        if !(MIN_MAP_AXIS..=MAX_MAP_AXIS).contains(&self.width)
            || !(MIN_MAP_AXIS..=MAX_MAP_AXIS).contains(&self.height)
        {
            return Err(format!(
                "Map width and height must each be between {MIN_MAP_AXIS} and {MAX_MAP_AXIS}"
            ));
        }

        validate_layer("Relief", &self.relief, cell_count, false)?;
        validate_layer("Moisture", &self.moisture, cell_count, false)?;
        validate_layer("Temperature", &self.temperature, cell_count, true)?;
        validate_layer("Vegetation", &self.vegetation, cell_count, true)?;
        validate_unit_value(self.water_level as f64, "Water level")?;

        if self.cities.len() > MAX_MAP_CITIES {
            return Err(format!("A map can contain at most {MAX_MAP_CITIES} cities"));
        }
        if self.roads.len() > MAX_MAP_ROADS {
            return Err(format!("A map can contain at most {MAX_MAP_ROADS} roads"));
        }

        let mut city_ids = HashSet::with_capacity(self.cities.len());
        for city in &mut self.cities {
            city.id = validate_id(std::mem::take(&mut city.id), "City ID")?;
            city.name = validate_name(std::mem::take(&mut city.name), "City name")?;
            if !city_ids.insert(city.id.clone()) {
                return Err(format!("Duplicate city ID: {}", city.id));
            }
            validate_unit_value(city.x, "City x coordinate")?;
            validate_unit_value(city.y, "City y coordinate")?;
            validate_unit_value(city.elevation, "City elevation")?;
            if city.population < 0 {
                return Err(format!("Population for '{}' cannot be negative", city.name));
            }
        }

        let mut road_ids = HashSet::with_capacity(self.roads.len());
        let mut total_points = 0usize;
        for road in &mut self.roads {
            road.id = validate_id(std::mem::take(&mut road.id), "Road ID")?;
            road.from_city_id = validate_optional_label(
                std::mem::take(&mut road.from_city_id),
                "Road start ID",
                MAX_ID_BYTES,
            )?;
            road.to_city_id = validate_optional_label(
                std::mem::take(&mut road.to_city_id),
                "Road end ID",
                MAX_ID_BYTES,
            )?;
            if !road_ids.insert(road.id.clone()) {
                return Err(format!("Duplicate road ID: {}", road.id));
            }
            if road.points.len() < 2 {
                return Err(format!(
                    "Road '{}' must contain at least two points",
                    road.id
                ));
            }
            total_points = total_points
                .checked_add(road.points.len())
                .ok_or_else(|| "Map contains too many road points".to_owned())?;
            if total_points > MAX_MAP_ROAD_POINTS {
                return Err(format!(
                    "A map can contain at most {MAX_MAP_ROAD_POINTS} road points"
                ));
            }
            for point in &road.points {
                validate_unit_value(point.x, "Road point x coordinate")?;
                validate_unit_value(point.y, "Road point y coordinate")?;
            }
        }

        validate_compiled_image(self.compiled_grid.as_deref(), "Compiled grid")?;
        validate_compiled_image(self.compiled_iso.as_deref(), "Compiled isometric map")?;
        if self.compiled_updated_at.is_some_and(|value| value < 0) {
            return Err("Compiled map timestamp cannot be negative".into());
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CityRoadPoint {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CityRoad {
    pub id: String,
    pub name: String,
    pub importance: String,
    pub points: Vec<CityRoadPoint>,
    #[serde(default)]
    pub tier: Option<u8>,
    #[serde(default)]
    pub external_connection_index: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CityBuilding {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub footprint: f64,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub district: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub rotation: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CityDistrict {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub color: String,
}

#[derive(Serialize, Deserialize)]
pub struct CityMap {
    pub city_id: String,
    pub size_label: String,
    pub width: u32,
    pub height: u32,
    pub seed: u64,
    #[serde(default = "default_city_scale")]
    pub scale: f64,
    #[serde(default = "default_city_architecture")]
    pub road_architecture: String,
    #[serde(default = "default_city_theme")]
    pub road_theme: String,
    #[serde(default)]
    pub external_connections: Vec<f64>,
    #[serde(default)]
    pub districts: Vec<CityDistrict>,
    pub roads: Vec<CityRoad>,
    pub buildings: Vec<CityBuilding>,
}

impl CityMap {
    pub fn normalize_and_validate(&mut self) -> Result<(), String> {
        self.city_id = validate_id(std::mem::take(&mut self.city_id), "City ID")?;
        if !matches!(
            self.size_label.as_str(),
            "village" | "town" | "city" | "megapolis"
        ) {
            return Err("Unsupported settlement size".into());
        }
        if self.width != 1 || self.height != 1 {
            return Err("City map width and height must use normalized 1x1 coordinates".into());
        }
        if !self.scale.is_finite() || !(0.5..=2.5).contains(&self.scale) {
            return Err("City map scale must be between 0.5 and 2.5".into());
        }
        if self.road_theme == "fantasy" {
            self.road_theme = "elvish".into();
        }
        if !matches!(
            self.road_architecture.as_str(),
            "ring" | "grid" | "star" | "organic"
        ) {
            return Err("Unsupported road architecture".into());
        }
        if !matches!(
            self.road_theme.as_str(),
            "western"
                | "mediterranean"
                | "nordic"
                | "elvish"
                | "dwarven"
                | "imperial"
                | "scifi"
                | "cyberpunk"
        ) {
            return Err("Unsupported road theme".into());
        }
        if self.external_connections.len() > 1_000 {
            return Err("A city map can contain at most 1000 external connections".into());
        }
        for angle in &self.external_connections {
            if !angle.is_finite() || angle.abs() > std::f64::consts::TAU {
                return Err("External connection angles must be finite radians".into());
            }
        }
        if self.districts.len() > 100 {
            return Err("A city map can contain at most 100 districts".into());
        }
        let mut district_ids = HashSet::with_capacity(self.districts.len());
        for district in &mut self.districts {
            district.id = validate_id(std::mem::take(&mut district.id), "District ID")?;
            district.name = validate_name(std::mem::take(&mut district.name), "District name")?;
            if !district_ids.insert(district.id.clone()) {
                return Err(format!("Duplicate district ID: {}", district.id));
            }
            if !matches!(
                district.kind.as_str(),
                "centre" | "market" | "downtown" | "ward" | "edge" | "outskirts"
            ) {
                return Err(format!("Unsupported district kind for '{}'", district.name));
            }
            validate_unit_value(district.x, "District x coordinate")?;
            validate_unit_value(district.y, "District y coordinate")?;
            validate_positive_unit(district.radius, "District radius")?;
            if district.color.len() != 7
                || !district.color.starts_with('#')
                || !district.color[1..]
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(format!(
                    "District color for '{}' must be a six-digit hex color",
                    district.name
                ));
            }
        }
        validate_text(
            &serde_json::to_string(&self.districts)
                .map_err(|e| format!("Invalid city districts: {e}"))?,
            "City districts",
            MAX_LONG_TEXT_BYTES,
        )?;

        if self.roads.len() > MAX_CITY_ROADS {
            return Err(format!(
                "A city map can contain at most {MAX_CITY_ROADS} roads"
            ));
        }
        let mut road_ids = HashSet::with_capacity(self.roads.len());
        let mut total_points = 0usize;
        for road in &mut self.roads {
            road.id = validate_id(std::mem::take(&mut road.id), "City road ID")?;
            road.name = validate_name(std::mem::take(&mut road.name), "City road name")?;
            if !road_ids.insert(road.id.clone()) {
                return Err(format!("Duplicate city road ID: {}", road.id));
            }
            if !matches!(road.importance.as_str(), "main" | "secondary" | "alley") {
                return Err(format!("Unsupported importance for road '{}'", road.name));
            }
            if road.tier.is_some_and(|tier| !(1..=5).contains(&tier)) {
                return Err(format!(
                    "Road tier for '{}' must be between 1 and 5",
                    road.name
                ));
            }
            if road.external_connection_index.is_some_and(|index| {
                usize::try_from(index)
                    .map_or(true, |index| index >= self.external_connections.len())
            }) {
                return Err(format!(
                    "External connection marker for '{}' is out of range",
                    road.name
                ));
            }
            if road.points.len() < 2 {
                return Err(format!(
                    "Road '{}' must contain at least two points",
                    road.name
                ));
            }
            total_points = total_points
                .checked_add(road.points.len())
                .ok_or_else(|| "City map contains too many road points".to_owned())?;
            if total_points > MAX_CITY_ROAD_POINTS {
                return Err(format!(
                    "A city map can contain at most {MAX_CITY_ROAD_POINTS} road points"
                ));
            }
            let mut point_ids = HashSet::with_capacity(road.points.len());
            for point in &mut road.points {
                point.id = validate_id(std::mem::take(&mut point.id), "City road point ID")?;
                if !point_ids.insert(point.id.clone()) {
                    return Err(format!("Road '{}' contains duplicate point IDs", road.name));
                }
                validate_unit_value(point.x, "City road point x coordinate")?;
                validate_unit_value(point.y, "City road point y coordinate")?;
            }
        }

        if self.buildings.len() > MAX_CITY_BUILDINGS {
            return Err(format!(
                "A city map can contain at most {MAX_CITY_BUILDINGS} buildings"
            ));
        }
        let mut building_ids = HashSet::with_capacity(self.buildings.len());
        for building in &mut self.buildings {
            building.id = validate_id(std::mem::take(&mut building.id), "Building ID")?;
            building.name = validate_name(std::mem::take(&mut building.name), "Building name")?;
            if !building_ids.insert(building.id.clone()) {
                return Err(format!("Duplicate building ID: {}", building.id));
            }
            if !matches!(
                building.kind.as_str(),
                "private" | "public" | "market" | "utility"
            ) {
                return Err(format!("Unsupported building kind for '{}'", building.name));
            }
            validate_unit_value(building.x, "Building x coordinate")?;
            validate_unit_value(building.y, "Building y coordinate")?;
            validate_positive_unit(building.footprint, "Building footprint")?;
            if let Some(width) = building.width {
                validate_positive_unit(width, "Building width")?;
            }
            if let Some(height) = building.height {
                validate_positive_unit(height, "Building height")?;
            }
            if building.rotation.is_some_and(|value| !value.is_finite()) {
                return Err("Building rotation must be finite".into());
            }
            if let Some(role) = &building.role {
                validate_text(role, "Building role", 4_096)?;
            }
            if building.district.as_deref().is_some_and(|district| {
                !matches!(district, "centre" | "midtown" | "edge" | "outskirts")
            }) {
                return Err("Unsupported building district".into());
            }
        }
        Ok(())
    }
}

fn default_city_scale() -> f64 {
    1.0
}
fn default_city_architecture() -> String {
    "ring".into()
}
fn default_city_theme() -> String {
    "elvish".into()
}

fn validate_layer(
    label: &str,
    values: &[f32],
    expected_len: usize,
    allow_legacy_empty: bool,
) -> Result<(), String> {
    if allow_legacy_empty && values.is_empty() {
        return Ok(());
    }
    if values.len() != expected_len {
        return Err(format!(
            "{label} layer has {} values; expected {expected_len}",
            values.len()
        ));
    }
    for value in values {
        validate_unit_value(*value as f64, label)?;
    }
    Ok(())
}

fn validate_unit_value(value: f64, label: &str) -> Result<(), String> {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err(format!("{label} values must be finite and between 0 and 1"));
    }
    Ok(())
}

fn validate_positive_unit(value: f64, label: &str) -> Result<(), String> {
    if !value.is_finite() || value <= 0.0 || value > 1.0 {
        return Err(format!(
            "{label} must be finite, greater than 0, and at most 1"
        ));
    }
    Ok(())
}

fn validate_compiled_image(value: Option<&str>, label: &str) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.is_empty() {
        return Ok(());
    }
    if value.len() > MAX_COMPILED_IMAGE_BYTES {
        return Err(format!("{label} exceeds the 24 MiB storage limit"));
    }
    const PREFIX: &str = "data:image/png;base64,";
    if !value.starts_with(PREFIX) {
        return Err(format!("{label} must be a PNG data URL"));
    }
    let encoded = &value[PREFIX.len()..];
    if encoded.is_empty() || encoded.len() % 4 != 0 {
        return Err(format!("{label} contains invalid base64 data"));
    }
    let padding_start = encoded.find('=').unwrap_or(encoded.len());
    if encoded.len() - padding_start > 2
        || !encoded[..padding_start]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
        || !encoded[padding_start..].bytes().all(|byte| byte == b'=')
    {
        return Err(format!("{label} contains invalid base64 data"));
    }
    Ok(())
}

#[derive(Serialize)]
pub struct LoreBook {
    pub id: String,
    pub world_id: String,
    pub title: String,
    pub summary: String,
    pub created_at: i64,
}

#[derive(Serialize)]
pub struct LoreEntry {
    pub id: String,
    pub book_id: String,
    pub title: String,
    pub content: String,
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_map() -> MapState {
        MapState {
            width: 8,
            height: 8,
            relief: vec![0.1; 64],
            moisture: vec![0.5; 64],
            water_level: 0.4,
            seed: 1,
            cities: vec![],
            roads: vec![],
            temperature: vec![0.5; 64],
            vegetation: vec![0.5; 64],
            compiled_grid: None,
            compiled_iso: None,
            compiled_updated_at: None,
        }
    }

    #[test]
    fn map_rejects_mismatched_layers() {
        let mut map = valid_map();
        map.relief.pop();
        assert!(map.normalize_and_validate().is_err());
    }

    #[test]
    fn map_rejects_duplicate_city_ids() {
        let city = MapCity {
            id: "same".into(),
            name: "A".into(),
            x: 0.5,
            y: 0.5,
            elevation: 0.5,
            population: 10,
        };
        let mut map = valid_map();
        map.cities = vec![
            city.clone(),
            MapCity {
                name: "B".into(),
                ..city
            },
        ];
        assert!(map.normalize_and_validate().is_err());
    }

    #[test]
    fn map_rejects_non_png_compiled_content() {
        let mut map = valid_map();
        map.compiled_grid = Some("https://example.invalid/map.png".into());
        assert!(map.normalize_and_validate().is_err());
    }

    #[test]
    fn city_map_normalizes_the_legacy_theme_and_checks_connection_markers() {
        let mut map = CityMap {
            city_id: "city-1".into(),
            size_label: "town".into(),
            width: 1,
            height: 1,
            seed: 1,
            scale: 1.0,
            road_architecture: "ring".into(),
            road_theme: "fantasy".into(),
            external_connections: vec![0.0],
            districts: vec![],
            roads: vec![CityRoad {
                id: "road-1".into(),
                name: "Main Road".into(),
                importance: "main".into(),
                points: vec![
                    CityRoadPoint {
                        id: "point-1".into(),
                        x: 0.0,
                        y: 0.0,
                    },
                    CityRoadPoint {
                        id: "point-2".into(),
                        x: 1.0,
                        y: 1.0,
                    },
                ],
                tier: Some(1),
                external_connection_index: Some(0),
            }],
            buildings: vec![],
        };
        map.normalize_and_validate().unwrap();
        assert_eq!(map.road_theme, "elvish");

        map.roads[0].external_connection_index = Some(1);
        assert!(map.normalize_and_validate().is_err());
    }
}
