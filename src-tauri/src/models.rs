use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub roads: Vec<CityRoad>,
    pub buildings: Vec<CityBuilding>,
}

fn default_city_scale() -> f64 { 1.0 }
fn default_city_architecture() -> String { "ring".into() }
fn default_city_theme() -> String { "fantasy".into() }

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
