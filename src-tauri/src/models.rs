use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellInfo {
    pub id: String,
    pub name_vi: String,
    pub base_cd: f64,
    pub effective_cd: f64,
    pub icon_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UltInfo {
    pub name: String,
    pub base_cds: [f64; 3],
    pub current_rank: usize,
    pub base_cd: f64,
    pub effective_cd: f64,
    pub icon_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemyTimerRow {
    pub slot_index: usize,
    pub position: String,
    pub riot_id: String,
    pub champion_id: String,
    pub champion_name: String,
    pub champion_icon_url: String,
    pub level: u32,
    pub spell_d: SpellInfo,
    pub spell_f: SpellInfo,
    pub ult: UltInfo,
    pub item_ability_haste: f64,
    pub boots_spell_haste: f64,
    pub has_inspiration_rune: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveMatchState {
    pub in_game: bool,
    pub is_demo: bool,
    pub game_time_secs: f64,
    pub ddragon_version: String,
    pub auto_sync_room: Option<String>,
    pub enemies: Vec<EnemyTimerRow>,
}

fn default_scale() -> String {
    "S".to_string()
}

fn default_sync_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerAppSettings {
    pub x: i32,
    pub y: i32,
    pub layout: String,
    pub opacity: f64,
    #[serde(default = "default_scale")]
    pub scale: String,
    #[serde(default = "default_sync_enabled")]
    pub sync_enabled: bool,
    #[serde(default)]
    pub squad_code: String,
}

impl Default for TimerAppSettings {
    fn default() -> Self {
        Self {
            x: 24,
            y: 140,
            layout: "vertical".to_string(),
            opacity: 0.85,
            scale: "S".to_string(),
            sync_enabled: true,
            squad_code: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialPayload {
    pub match_state: LiveMatchState,
    pub settings: TimerAppSettings,
}
