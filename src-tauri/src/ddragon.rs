use crate::models::TimerAppSettings;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChampionUltData {
    pub id: String,
    pub name: String,
    pub image_full: String,
    pub ult_name: String,
    pub ult_image_full: String,
    pub ult_cooldowns: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummonerSpellData {
    pub id: String,
    pub name_vi: String,
    pub cooldown: f64,
    pub image_full: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDragonStore {
    pub version: String,
    pub champions: HashMap<String, ChampionUltData>,
    pub summoners: HashMap<String, SummonerSpellData>,
    pub item_ability_haste: HashMap<i64, f64>,
}

impl Default for DDragonStore {
    fn default() -> Self {
        let mut summoners = HashMap::new();
        let defaults = [
            ("SummonerFlash", "Tốc Biến", 300.0, "SummonerFlash.png"),
            ("SummonerTeleport", "Dịch Chuyển", 360.0, "SummonerTeleport.png"),
            ("SummonerDot", "Thiêu Đốt", 180.0, "SummonerDot.png"),
            ("SummonerHaste", "Tăng Tốc", 240.0, "SummonerHaste.png"),
            ("SummonerExhaust", "Kiệt Sức", 240.0, "SummonerExhaust.png"),
            ("SummonerBarrier", "Lá Chắn", 180.0, "SummonerBarrier.png"),
            ("SummonerBoost", "Thanh Tẩy", 240.0, "SummonerBoost.png"),
            ("SummonerHeal", "Hồi Máu", 240.0, "SummonerHeal.png"),
            ("SummonerSmite", "Trừng Phạt", 90.0, "SummonerSmite.png"),
            ("SummonerSnowball", "Đánh Dấu", 80.0, "SummonerSnowball.png"),
        ];
        for (id, name_vi, cd, img) in defaults {
            summoners.insert(
                id.to_string(),
                SummonerSpellData {
                    id: id.to_string(),
                    name_vi: name_vi.to_string(),
                    cooldown: cd,
                    image_full: img.to_string(),
                },
            );
        }

        let mut champions = HashMap::new();
        let demo_champs = [
            ("aatrox", "Aatrox", "Aatrox.png", "Chiến Binh Tận Thế", "AatroxR.png", [120.0, 100.0, 80.0]),
            ("leesin", "Lee Sin", "LeeSin.png", "Nộ Long Cước", "BlindMonkRKick.png", [110.0, 85.0, 60.0]),
            ("ahri", "Ahri", "Ahri.png", "Phi Hồ", "AhriTumble.png", [130.0, 115.0, 100.0]),
            ("kaisa", "Kai'Sa", "Kaisa.png", "Bản Năng Sát Thủ", "KaisaR.png", [130.0, 100.0, 70.0]),
            ("thresh", "Thresh", "Thresh.png", "Đóng Hộp", "ThreshRPenta.png", [120.0, 100.0, 80.0]),
        ];
        for (key, name, img, ult_name, ult_img, cds) in demo_champs {
            champions.insert(
                key.to_string(),
                ChampionUltData {
                    id: img.trim_end_matches(".png").to_string(),
                    name: name.to_string(),
                    image_full: img.to_string(),
                    ult_name: ult_name.to_string(),
                    ult_image_full: ult_img.to_string(),
                    ult_cooldowns: cds,
                },
            );
        }

        Self {
            version: "14.23.1".to_string(),
            champions,
            summoners,
            item_ability_haste: HashMap::new(),
        }
    }
}

pub fn resolve_app_data_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let mut ancestor = exe_dir;
            for _ in 0..5 {
                if ancestor.join("package.json").exists() && ancestor.join("src-tauri").exists() {
                    let dev_data = ancestor.join("AppData");
                    if fs::create_dir_all(&dev_data).is_ok() {
                        return dev_data;
                    }
                }
                if let Some(p) = ancestor.parent() {
                    ancestor = p;
                } else {
                    break;
                }
            }
            let portable = exe_dir.join("data");
            if fs::create_dir_all(&portable).is_ok() {
                let probe = portable.join(".write_probe");
                if fs::write(&probe, b"ok").is_ok() {
                    let _ = fs::remove_file(&probe);
                    return portable;
                }
            }
        }
    }
    let d_dir = PathBuf::from(r"D:\LoLSpellTimer\AppData");
    if Path::new(r"D:\LoLSpellTimer").exists() && fs::create_dir_all(&d_dir).is_ok() {
        return d_dir;
    }
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| r"C:\Users\Public".to_string());
    let dir = PathBuf::from(local).join("LoLSpellTimer");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn load_settings() -> TimerAppSettings {
    let p = resolve_app_data_dir().join("timer_settings.json");
    fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(settings: &TimerAppSettings) {
    let p = resolve_app_data_dir().join("timer_settings.json");
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(p, json);
    }
}

pub fn load_cached_ddragon() -> DDragonStore {
    let p = resolve_app_data_dir().join("ddragon_cache.json");
    fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<DDragonStore>(&s).ok())
        .filter(|d| !d.champions.is_empty() && !d.summoners.is_empty())
        .unwrap_or_default()
}

pub fn save_cached_ddragon(store: &DDragonStore) {
    let p = resolve_app_data_dir().join("ddragon_cache.json");
    if let Ok(json) = serde_json::to_string(store) {
        let _ = fs::write(p, json);
    }
}

pub fn compute_effective_cd(base_cd: f64, haste: f64) -> f64 {
    if base_cd <= 0.0 {
        return 0.0;
    }
    (base_cd * 100.0 / (100.0 + haste.max(0.0))).round()
}

pub fn boots_spell_haste(item_id: i64) -> f64 {
    match item_id {
        3158 => 10.0, // Giày Khai Sáng Ionia
        3171 => 20.0, // Giày Khai Sáng nâng cấp (Crimson Lucidity)
        _ => 0.0,
    }
}

pub fn extract_ability_haste_from_desc(desc: &str) -> f64 {
    let mut search_from = 0usize;
    let open_tag = "<attention>";
    let close_tag = "</attention>";

    while let Some(rel_start) = desc[search_from..].find(open_tag) {
        let val_start = search_from + rel_start + open_tag.len();
        let Some(rel_end) = desc[val_start..].find(close_tag) else {
            break;
        };
        let val_str = desc[val_start..val_start + rel_end].trim();
        let after_idx = val_start + rel_end + close_tag.len();
        let snippet: String = desc[after_idx..].chars().take(40).collect();
        let snippet_lower = snippet.to_lowercase();
        if snippet_lower.contains("điểm hồi kỹ năng")
            || snippet_lower.contains("ability haste")
        {
            if let Ok(num) = val_str.replace('%', "").trim().parse::<f64>() {
                return num;
            }
        }
        search_from = after_idx;
    }
    0.0
}

pub async fn refresh_ddragon_from_web() -> Result<DDragonStore, String> {
    let http = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let versions: Vec<String> = http
        .get("https://ddragon.leagueoflegends.com/api/versions.json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let version = versions
        .into_iter()
        .next()
        .ok_or_else(|| "Empty DataDragon versions".to_string())?;

    let champ_url = format!(
        "https://ddragon.leagueoflegends.com/cdn/{}/data/vi_VN/championFull.json",
        version
    );
    let sum_url = format!(
        "https://ddragon.leagueoflegends.com/cdn/{}/data/vi_VN/summoner.json",
        version
    );
    let item_url = format!(
        "https://ddragon.leagueoflegends.com/cdn/{}/data/vi_VN/item.json",
        version
    );

    let (champ_res, sum_res, item_res) = tokio::join!(
        http.get(&champ_url).send(),
        http.get(&sum_url).send(),
        http.get(&item_url).send()
    );

    let champ_json: Value = champ_res.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let sum_json: Value = sum_res.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let item_json: Value = item_res.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;

    let mut store = DDragonStore {
        version,
        ..DDragonStore::default()
    };

    if let Some(data) = champ_json.get("data").and_then(|v| v.as_object()) {
        for (champ_key, obj) in data {
            let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or(champ_key).to_string();
            let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
            let image_full = obj
                .pointer("/image/full")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if let Some(r_spell) = obj.get("spells").and_then(|v| v.as_array()).and_then(|a| a.get(3)) {
                let ult_name = r_spell
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Chiêu cuối")
                    .to_string();
                let ult_image_full = r_spell
                    .pointer("/image/full")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let cds_arr = r_spell.get("cooldown").and_then(|v| v.as_array());
                let c0 = cds_arr.and_then(|a| a.first()).and_then(|v| v.as_f64()).unwrap_or(100.0);
                let c1 = cds_arr.and_then(|a| a.get(1)).and_then(|v| v.as_f64()).unwrap_or(c0);
                let c2 = cds_arr.and_then(|a| a.get(2)).and_then(|v| v.as_f64()).unwrap_or(c1);

                store.champions.insert(
                    id.to_lowercase(),
                    ChampionUltData {
                        id,
                        name,
                        image_full,
                        ult_name,
                        ult_image_full,
                        ult_cooldowns: [c0, c1, c2],
                    },
                );
            }
        }
    }

    if let Some(data) = sum_json.get("data").and_then(|v| v.as_object()) {
        for (sum_key, obj) in data {
            let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or(sum_key).to_string();
            let name_vi = obj.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
            let cd = obj
                .get("cooldown")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_f64())
                .unwrap_or(180.0);
            let image_full = obj
                .pointer("/image/full")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if cd > 0.0 && !image_full.is_empty() {
                store.summoners.insert(
                    id.clone(),
                    SummonerSpellData {
                        id,
                        name_vi,
                        cooldown: cd,
                        image_full,
                    },
                );
            }
        }
    }

    if let Some(data) = item_json.get("data").and_then(|v| v.as_object()) {
        for (id_str, obj) in data {
            if let Ok(item_id) = id_str.parse::<i64>() {
                let desc = obj.get("description").and_then(|v| v.as_str()).unwrap_or("");
                let ah = extract_ability_haste_from_desc(desc);
                if ah > 0.0 {
                    store.item_ability_haste.insert(item_id, ah);
                }
            }
        }
    }

    save_cached_ddragon(&store);
    Ok(store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cooldown_math_and_item_haste_parsing() {
        // Flash 300s with Ionian Boots (10) + Cosmic Insight (18) = 28 Haste => 234s
        assert_eq!(compute_effective_cd(300.0, 28.0), 234.0);
        // Ult 120s with 45 Ability Haste => round(120 * 100 / 145) = 83s
        assert_eq!(compute_effective_cd(120.0, 45.0), 83.0);

        let desc_vi = "<mainText><stats><attention>60</attention> Sức Mạnh Công Kích<br><attention>20</attention> Điểm Hồi Kỹ Năng</stats></mainText>";
        assert_eq!(extract_ability_haste_from_desc(desc_vi), 20.0);
        let desc_en = "<stats><attention>15</attention> Ability Haste</stats>";
        assert_eq!(extract_ability_haste_from_desc(desc_en), 15.0);
    }
}
