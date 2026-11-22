use crate::ddragon::{load_settings, save_settings};
use std::sync::{Arc, Mutex};
use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos,
    GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_NOACTIVATE,
    WS_EX_TOPMOST,
};

#[derive(Default)]
pub struct DragTracker {
    pub active: bool,
    pub start_cursor_x: i32,
    pub start_cursor_y: i32,
    pub start_win_x: i32,
    pub start_win_y: i32,
}

pub type SharedDrag = Arc<Mutex<DragTracker>>;

pub fn apply_noactivate_topmost(window: &WebviewWindow) {
    if let Ok(raw) = window.hwnd() {
        let hwnd = HWND(raw.0);
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let new_ex = ex | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOPMOST.0 as isize);
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex);
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

pub fn has_noactivate_flag(window: &WebviewWindow) -> bool {
    if let Ok(raw) = window.hwnd() {
        let hwnd = HWND(raw.0);
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            return (ex & (WS_EX_NOACTIVATE.0 as isize)) != 0;
        }
    }
    false
}

pub fn restore_saved_position(window: &WebviewWindow) {
    let settings = load_settings();
    if let Ok(raw) = window.hwnd() {
        let hwnd = HWND(raw.0);
        let x = settings.x.max(0);
        let y = settings.y.max(0);
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                x,
                y,
                0,
                0,
                SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

pub fn reset_to_default_position(window: &WebviewWindow) {
    let mut settings = load_settings();
    settings.x = 24;
    settings.y = 140;
    save_settings(&settings);
    if let Ok(raw) = window.hwnd() {
        let hwnd = HWND(raw.0);
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                24,
                140,
                0,
                0,
                SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

pub fn begin_window_drag(window: &WebviewWindow, drag: &SharedDrag) {
    let Ok(raw) = window.hwnd() else { return };
    let hwnd = HWND(raw.0);
    let mut pt = POINT::default();
    let mut rect = RECT::default();
    unsafe {
        if GetCursorPos(&mut pt).is_ok() && GetWindowRect(hwnd, &mut rect).is_ok() {
            if let Ok(mut d) = drag.lock() {
                d.active = true;
                d.start_cursor_x = pt.x;
                d.start_cursor_y = pt.y;
                d.start_win_x = rect.left;
                d.start_win_y = rect.top;
            }
        }
    }
}

pub fn update_window_drag(window: &WebviewWindow, drag: &SharedDrag) {
    let Ok(raw) = window.hwnd() else { return };
    let hwnd = HWND(raw.0);
    let mut pt = POINT::default();
    unsafe {
        if GetCursorPos(&mut pt).is_ok() {
            if let Ok(d) = drag.lock() {
                if !d.active {
                    return;
                }
                let nx = d.start_win_x + (pt.x - d.start_cursor_x);
                let ny = d.start_win_y + (pt.y - d.start_cursor_y);
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    nx,
                    ny,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
}

pub fn end_window_drag(window: &WebviewWindow, drag: &SharedDrag) {
    if let Ok(mut d) = drag.lock() {
        d.active = false;
    }
    let Ok(raw) = window.hwnd() else { return };
    let hwnd = HWND(raw.0);
    let mut rect = RECT::default();
    unsafe {
        if GetWindowRect(hwnd, &mut rect).is_ok() {
            let mut settings = load_settings();
            settings.x = rect.left;
            settings.y = rect.top;
            save_settings(&settings);
        }
    }
}

pub fn resize_for_layout(window: &WebviewWindow, layout: &str, collapsed: bool) {
    let (logical_w, logical_h) = if collapsed {
        (232.0_f64, 36.0_f64)
    } else if layout == "horizontal" {
        (710.0_f64, 102.0_f64)
    } else {
        (280.0_f64, 286.0_f64)
    };

    let scale = window.scale_factor().unwrap_or(1.0);
    let phys_w = (logical_w * scale).round() as i32;
    let phys_h = (logical_h * scale).round() as i32;

    if let Ok(raw) = window.hwnd() {
        let hwnd = HWND(raw.0);
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                phys_w,
                phys_h,
                SWP_NOMOVE | SWP_NOACTIVATE,
            );
        }
    }

    let mut settings = load_settings();
    settings.layout = layout.to_string();
    save_settings(&settings);
}
