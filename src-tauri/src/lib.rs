pub mod ddragon;
pub mod live_game;
pub mod models;
pub mod win_overlay;

use ddragon::{load_cached_ddragon, load_settings, refresh_ddragon_from_web, save_settings, DDragonStore};
use live_game::{build_demo_match_state, fetch_live_or_demo};
use models::{InitialPayload, LiveMatchState};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use win_overlay::{
    apply_noactivate_topmost, begin_window_drag, end_window_drag, fit_window_logical_size,
    reset_to_default_position, resize_for_layout, restore_saved_position, update_window_drag,
    DragTracker, SharedDrag,
};

pub struct TimerSharedState {
    pub ddragon: Arc<RwLock<DDragonStore>>,
    pub live: Arc<RwLock<LiveMatchState>>,
    pub drag: SharedDrag,
}

#[tauri::command]
fn cmd_get_initial_state(state: State<'_, TimerSharedState>) -> InitialPayload {
    let match_state = state.live.read().map(|l| l.clone()).unwrap_or_else(|_| {
        let store = state.ddragon.read().map(|d| d.clone()).unwrap_or_default();
        build_demo_match_state(&store)
    });
    InitialPayload {
        match_state,
        settings: load_settings(),
    }
}

#[tauri::command]
fn cmd_set_layout_and_collapse(window: WebviewWindow, layout: String, collapsed: bool) {
    resize_for_layout(&window, &layout, collapsed);
    apply_noactivate_topmost(&window);
}

#[tauri::command]
fn cmd_save_opacity(opacity: f64) {
    let mut s = load_settings();
    s.opacity = opacity.clamp(0.4, 1.0);
    save_settings(&s);
}

#[tauri::command]
fn cmd_save_scale(scale: String) {
    let mut s = load_settings();
    s.scale = match scale.as_str() {
        "S" | "M" | "L" => scale,
        _ => "S".to_string(),
    };
    save_settings(&s);
}

#[tauri::command]
fn cmd_fit_window_size(window: WebviewWindow, width: f64, height: f64) {
    fit_window_logical_size(&window, width, height);
    apply_noactivate_topmost(&window);
}

#[tauri::command]
fn cmd_begin_drag(window: WebviewWindow, state: State<'_, TimerSharedState>) {
    begin_window_drag(&window, &state.drag);
}

#[tauri::command]
fn cmd_update_drag(window: WebviewWindow, state: State<'_, TimerSharedState>) {
    update_window_drag(&window, &state.drag);
}

#[tauri::command]
fn cmd_end_drag(window: WebviewWindow, state: State<'_, TimerSharedState>) {
    end_window_drag(&window, &state.drag);
}

#[tauri::command]
fn cmd_copy_text(text: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_quit_timer(app: AppHandle) {
    app.exit(0);
}

fn setup_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    let show_item = MenuItemBuilder::with_id("show_win", "Hiện bảng LoL Spell Timer").build(app)?;
    let reset_item =
        MenuItemBuilder::with_id("reset_pos", "Đưa về góc mặc định (24, 140)").build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItemBuilder::with_id("quit_app", "Thoát hẳn").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&reset_item)
        .item(&sep)
        .item(&quit_item)
        .build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or_else(|| tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap());

    TrayIconBuilder::with_id("timer-tray")
        .icon(icon)
        .menu(&menu)
        .tooltip("LoL Spell Timer — Đếm hồi chiêu thủ công")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let _ = win.show();
                    apply_noactivate_topmost(&win);
                }
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "show_win" {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    apply_noactivate_topmost(&win);
                }
            } else if id == "reset_pos" {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    reset_to_default_position(&win);
                    apply_noactivate_topmost(&win);
                }
            } else if id == "quit_app" {
                app.exit(0);
            }
        })
        .build(app)?;

    Ok(())
}

pub fn run() {
    let store = load_cached_ddragon();
    let initial_demo = build_demo_match_state(&store);

    let shared = TimerSharedState {
        ddragon: Arc::new(RwLock::new(store)),
        live: Arc::new(RwLock::new(initial_demo)),
        drag: Arc::new(Mutex::new(DragTracker::default())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                apply_noactivate_topmost(&win);
            }
        }))
        .manage(shared)
        .invoke_handler(tauri::generate_handler![
            cmd_get_initial_state,
            cmd_set_layout_and_collapse,
            cmd_save_opacity,
            cmd_save_scale,
            cmd_fit_window_size,
            cmd_begin_drag,
            cmd_update_drag,
            cmd_end_drag,
            cmd_copy_text,
            cmd_quit_timer,
        ])
        .setup(|app| {
            setup_tray(app.handle())?;

            if let Some(win) = app.get_webview_window("main") {
                let saved = load_settings();
                restore_saved_position(&win);
                resize_for_layout(&win, &saved.layout, false);
                apply_noactivate_topmost(&win);
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Background DataDragon refresh
                if let Ok(fresh) = refresh_ddragon_from_web().await {
                    let state = app_handle.state::<TimerSharedState>();
                    if let Ok(mut dd) = state.ddragon.write() {
                        *dd = fresh;
                    };
                }
            });

            let app_poll = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let state = app_poll.state::<TimerSharedState>();
                    let store_snap = state
                        .ddragon
                        .read()
                        .map(|d| d.clone())
                        .unwrap_or_default();
                    let next_live = fetch_live_or_demo(&store_snap).await;
                    if let Ok(mut l) = state.live.write() {
                        *l = next_live.clone();
                    }
                    let _ = app_poll.emit("match-state-updated", next_live);
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Failed to run LoL Spell Timer");
}
