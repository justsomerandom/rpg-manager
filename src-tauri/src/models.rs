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
