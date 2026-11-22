use crate::ddragon::{boots_spell_haste, compute_effective_cd, DDragonStore};
use crate::models::{EnemyTimerRow, LiveMatchState, SpellInfo, UltInfo};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

fn normalize_champion_key(raw_champ_name: &str, display_name: &str) -> String {
    let stripped = raw_champ_name
        .trim()
        .strip_prefix("game_character_displayname_")
        .unwrap_or(raw_champ_name.trim());
    let lower = stripped.to_lowercase();
    if !lower.is_empty() {
        return lower;
    }
    display_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

fn normalize_spell_id(raw_display_name: &str, display_name: &str) -> String {
    let r = raw_display_name.to_lowercase();
    let d = display_name.to_lowercase();
    if r.contains("summonerflash") || d.contains("tốc biến") || d.contains("flash") {
        "SummonerFlash".to_string()
    } else if r.contains("teleport") || d.contains("dịch chuyển") {
        "SummonerTeleport".to_string()
    } else if r.contains("summonerdot") || d.contains("thiêu đốt") || d.contains("ignite") {
        "SummonerDot".to_string()
    } else if r.contains("summonerhaste") || d.contains("tăng tốc") || d.contains("ghost") {
        "SummonerHaste".to_string()
    } else if r.contains("summonerexhaust") || d.contains("kiệt sức") || d.contains("exhaust") {
        "SummonerExhaust".to_string()
    } else if r.contains("summonerbarrier") || d.contains("lá chắn") || d.contains("barrier") {
        "SummonerBarrier".to_string()
    } else if r.contains("summonerboost") || d.contains("thanh tẩy") || d.contains("cleanse") {
        "SummonerBoost".to_string()
    } else if r.contains("summonerheal") || d.contains("hồi máu") || d.contains("heal") {
        "SummonerHeal".to_string()
    } else if r.contains("summonersmite") || d.contains("trừng phạt") || d.contains("smite") {
        "SummonerSmite".to_string()
    } else if r.contains("snowball") || d.contains("đánh dấu") || d.contains("mark") {
        "SummonerSnowball".to_string()
    } else {
        "SummonerFlash".to_string()
    }
}

fn build_spell_info(
    raw_name: &str,
    display_name: &str,
    spell_haste: f64,
    store: &DDragonStore,
) -> SpellInfo {
    let id = normalize_spell_id(raw_name, display_name);
    let data = store.summoners.get(&id).cloned().unwrap_or_else(|| {
        store.summoners.get("SummonerFlash").cloned().unwrap()
    });
    let eff = compute_effective_cd(data.cooldown, spell_haste);
    SpellInfo {
        id: data.id.clone(),
        name_vi: data.name_vi,
        base_cd: data.cooldown,
        effective_cd: eff,
        icon_url: format!(
            "https://ddragon.leagueoflegends.com/cdn/{}/img/spell/{}",
            store.version, data.image_full
        ),
    }
}

fn position_order(pos: &str) -> (usize, &'static str) {
    match pos.to_uppercase().as_str() {
        "TOP" => (0, "TOP"),
        "JUNGLE" => (1, "JGL"),
        "MIDDLE" => (2, "MID"),
        "BOTTOM" => (3, "ADC"),
        "UTILITY" => (4, "SUP"),
        _ => (5, "LANE"),
    }
}

pub fn parse_allgamedata(json_str: &str, store: &DDragonStore) -> Result<LiveMatchState, String> {
    let root: Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;
    let game_time_secs = root
        .pointer("/gameData/gameTime")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let active_riot_id = root
        .pointer("/activePlayer/riotId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let active_sum_name = root
        .pointer("/activePlayer/summonerName")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let all_players = root
        .get("allPlayers")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing allPlayers".to_string())?;

    let mut my_team = String::new();
    for p in all_players {
        let p_riot = p.get("riotId").and_then(|v| v.as_str()).unwrap_or("");
        let p_name = p.get("summonerName").and_then(|v| v.as_str()).unwrap_or("");
        if (!active_riot_id.is_empty() && p_riot == active_riot_id)
            || (!active_sum_name.is_empty() && p_name == active_sum_name)
        {
            my_team = p.get("team").and_then(|v| v.as_str()).unwrap_or("").to_string();
            break;
        }
    }

    let mut raw_enemies: Vec<(usize, EnemyTimerRow)> = Vec::new();
    for p in all_players {
        let team = p.get("team").and_then(|v| v.as_str()).unwrap_or("");
        if !my_team.is_empty() && team == my_team {
            continue;
        }
        let pos_raw = p.get("position").and_then(|v| v.as_str()).unwrap_or("");
        let (pos_rank, pos_short) = position_order(pos_raw);

        let riot_id = p
            .get("riotId")
            .or_else(|| p.get("summonerName"))
            .and_then(|v| v.as_str())
            .unwrap_or("Địch")
            .to_string();
        let display_champ = p
            .get("championName")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown");
        let raw_champ = p
            .get("rawChampionName")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let level = p.get("level").and_then(|v| v.as_u64()).unwrap_or(1) as u32;

        let champ_key = normalize_champion_key(raw_champ, display_champ);
        let champ_data = store.champions.get(&champ_key).cloned().or_else(|| {
            let alt = display_champ
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect::<String>()
                .to_lowercase();
            store.champions.get(&alt).cloned()
        });

        let mut item_ah: f64 = 0.0;
        let mut boots_sh: f64 = 0.0;
        if let Some(items) = p.get("items").and_then(|v| v.as_array()) {
            for item in items {
                let item_id = item.get("itemID").and_then(|v| v.as_i64()).unwrap_or(0);
                if let Some(ah) = store.item_ability_haste.get(&item_id) {
                    item_ah += *ah;
                }
                boots_sh = boots_sh.max(boots_spell_haste(item_id));
            }
        }

        let sec_tree_id = p.pointer("/runes/secondaryRuneTree/id").and_then(|v| v.as_i64()).unwrap_or(0);
        let pri_tree_id = p.pointer("/runes/primaryRuneTree/id").and_then(|v| v.as_i64()).unwrap_or(0);
        let has_inspiration = sec_tree_id == 8300 || pri_tree_id == 8300;
        let total_spell_haste = boots_sh + if has_inspiration { 18.0 } else { 0.0 };

        let s1_raw = p
            .pointer("/summonerSpells/summonerSpellOne/rawDisplayName")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let s1_disp = p
            .pointer("/summonerSpells/summonerSpellOne/displayName")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let s2_raw = p
            .pointer("/summonerSpells/summonerSpellTwo/rawDisplayName")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let s2_disp = p
            .pointer("/summonerSpells/summonerSpellTwo/displayName")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let spell_d = build_spell_info(s1_raw, s1_disp, total_spell_haste, store);
        let spell_f = build_spell_info(s2_raw, s2_disp, total_spell_haste, store);

        let ult_rank = if level >= 16 {
            2
        } else if level >= 11 {
            1
        } else {
            0
        };

        let (champ_id, champ_icon_url, ult) = if let Some(cd) = champ_data {
            let base_cd = cd.ult_cooldowns[ult_rank];
            let eff_cd = compute_effective_cd(base_cd, item_ah);
            (
                cd.id.clone(),
                format!(
                    "https://ddragon.leagueoflegends.com/cdn/{}/img/champion/{}",
                    store.version, cd.image_full
                ),
                UltInfo {
                    name: cd.ult_name,
                    base_cds: cd.ult_cooldowns,
                    current_rank: ult_rank + 1,
                    base_cd,
                    effective_cd: eff_cd,
                    icon_url: format!(
                        "https://ddragon.leagueoflegends.com/cdn/{}/img/spell/{}",
                        store.version, cd.ult_image_full
                    ),
                },
            )
        } else {
            let fallback_cds = [120.0, 100.0, 80.0];
            let base_cd = fallback_cds[ult_rank];
            (
                champ_key.clone(),
                String::new(),
                UltInfo {
                    name: "Chiêu cuối (R)".to_string(),
                    base_cds: fallback_cds,
                    current_rank: ult_rank + 1,
                    base_cd,
                    effective_cd: compute_effective_cd(base_cd, item_ah),
                    icon_url: String::new(),
                },
            )
        };

        raw_enemies.push((
            pos_rank,
            EnemyTimerRow {
                slot_index: 0,
                position: pos_short.to_string(),
                riot_id,
                champion_id: champ_id,
                champion_name: display_champ.to_string(),
                champion_icon_url: champ_icon_url,
                level,
                spell_d,
                spell_f,
                ult,
                item_ability_haste: item_ah,
                boots_spell_haste: boots_sh,
                has_inspiration_rune: has_inspiration,
            },
        ));
    }

    raw_enemies.sort_by_key(|(rank, _)| *rank);
    let enemies = raw_enemies
        .into_iter()
        .take(5)
        .enumerate()
        .map(|(idx, (_, mut row))| {
            row.slot_index = idx;
            row
        })
        .collect();

    Ok(LiveMatchState {
        in_game: true,
        is_demo: false,
        game_time_secs,
        ddragon_version: store.version.clone(),
        enemies,
    })
}

pub fn build_demo_match_state(store: &DDragonStore) -> LiveMatchState {
    let demos = [
        ("TOP", "aatrox", 11, "SummonerTeleport", "SummonerFlash"),
        ("JGL", "leesin", 10, "SummonerSmite", "SummonerFlash"),
        ("MID", "ahri", 11, "SummonerDot", "SummonerFlash"),
        ("ADC", "kaisa", 10, "SummonerBarrier", "SummonerFlash"),
        ("SUP", "thresh", 9, "SummonerExhaust", "SummonerFlash"),
    ];

    let enemies = demos
        .iter()
        .enumerate()
        .map(|(idx, (pos, key, lvl, d_id, f_id))| {
            let cd = store.champions.get(*key).cloned().unwrap_or_else(|| {
                store.champions.values().next().cloned().unwrap()
            });
            let ult_rank = if *lvl >= 16 { 2 } else if *lvl >= 11 { 1 } else { 0 };
            let base_ult = cd.ult_cooldowns[ult_rank];
            EnemyTimerRow {
                slot_index: idx,
                position: (*pos).to_string(),
                riot_id: format!("Mẫu {}#VN2", pos),
                champion_id: cd.id.clone(),
                champion_name: cd.name.clone(),
                champion_icon_url: format!(
                    "https://ddragon.leagueoflegends.com/cdn/{}/img/champion/{}",
                    store.version, cd.image_full
                ),
                level: *lvl,
                spell_d: build_spell_info(d_id, d_id, 0.0, store),
                spell_f: build_spell_info(f_id, f_id, 0.0, store),
                ult: UltInfo {
                    name: cd.ult_name,
                    base_cds: cd.ult_cooldowns,
                    current_rank: ult_rank + 1,
                    base_cd: base_ult,
                    effective_cd: base_ult,
                    icon_url: format!(
                        "https://ddragon.leagueoflegends.com/cdn/{}/img/spell/{}",
                        store.version, cd.ult_image_full
                    ),
                },
                item_ability_haste: 0.0,
                boots_spell_haste: 0.0,
                has_inspiration_rune: false,
            }
        })
        .collect();

    LiveMatchState {
        in_game: false,
        is_demo: true,
        game_time_secs: 0.0,
        ddragon_version: store.version.clone(),
        enemies,
    }
}

pub async fn fetch_live_or_demo(store: &DDragonStore) -> LiveMatchState {
    let Ok(http) = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_millis(800))
        .build()
    else {
        return build_demo_match_state(store);
    };

    match http
        .get("https://127.0.0.1:2999/liveclientdata/allgamedata")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.text().await {
            Ok(txt) => parse_allgamedata(&txt, store).unwrap_or_else(|_| build_demo_match_state(store)),
            Err(_) => build_demo_match_state(store),
        },
        _ => build_demo_match_state(store),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_allgamedata_filters_enemies_and_sorts_positions() {
        let mut store = DDragonStore::default();
        store.item_ability_haste.insert(6676, 15.0);
        store.champions.insert(
            "monkeyking".to_string(),
            crate::ddragon::ChampionUltData {
                id: "MonkeyKing".to_string(),
                name: "Ngộ Không".to_string(),
                image_full: "MonkeyKing.png".to_string(),
                ult_name: "Lốc Xoáy".to_string(),
                ult_image_full: "MonkeyKingSpinToWin.png".to_string(),
                ult_cooldowns: [120.0, 105.0, 90.0],
            },
        );

        let sample = r#"{
            "activePlayer": { "riotId": "Me#VN2", "summonerName": "Me" },
            "gameData": { "gameTime": 845.5 },
            "allPlayers": [
                { "riotId": "Me#VN2", "team": "ORDER", "position": "MIDDLE", "championName": "Ahri", "rawChampionName": "game_character_displayname_Ahri", "level": 11, "items": [], "summonerSpells": {} },
                { "riotId": "EnemySup#VN2", "team": "CHAOS", "position": "UTILITY", "championName": "Thresh", "rawChampionName": "game_character_displayname_Thresh", "level": 9, "items": [{"itemID": 3158}], "runes": {"secondaryRuneTree": {"id": 8300}}, "summonerSpells": { "summonerSpellOne": {"rawDisplayName": "SummonerExhaust", "displayName": "Kiệt Sức"}, "summonerSpellTwo": {"rawDisplayName": "SummonerFlash", "displayName": "Tốc Biến"} } },
                { "riotId": "EnemyTop#VN2", "team": "CHAOS", "position": "TOP", "championName": "Ngộ Không", "rawChampionName": "game_character_displayname_MonkeyKing", "level": 11, "items": [{"itemID": 6676}], "summonerSpells": { "summonerSpellOne": {"rawDisplayName": "SummonerFlash", "displayName": "Tốc Biến"}, "summonerSpellTwo": {"rawDisplayName": "SummonerTeleport", "displayName": "Dịch Chuyển"} } }
            ]
        }"#;

        let parsed = parse_allgamedata(sample, &store).unwrap();
        assert!(parsed.in_game);
        assert_eq!(parsed.enemies.len(), 2);
        assert_eq!(parsed.enemies[0].position, "TOP");
        assert_eq!(parsed.enemies[0].champion_id, "MonkeyKing");
        assert_eq!(parsed.enemies[0].item_ability_haste, 15.0);
        // Level 11 MonkeyKing ult base 105s, 15 AH -> round(105 * 100 / 115) = 91s
        assert_eq!(parsed.enemies[0].ult.effective_cd, 91.0);

        assert_eq!(parsed.enemies[1].position, "SUP");
        assert!(parsed.enemies[1].has_inspiration_rune);
        // Sup has Ionian Boots (10) + Inspiration (18) = 28 -> Flash 234s
        assert_eq!(parsed.enemies[1].spell_f.effective_cd, 234.0);
    }
}
