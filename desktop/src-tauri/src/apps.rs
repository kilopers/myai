//! «Мои приложения» — пользовательские окна с вебвью по раскладке
//! (1 / 2 рядом / 2 сверху + 1 / сетка 2×2). Открытие/скрытие —
//! глобальный хоткей или пункт подменю трея; окно живёт вне
//! панели задач (skip_taskbar), размер/позиция сохраняются
//! в settings.json (ключ `apps`).

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_store::StoreExt;

/// Описание приложения-кубика из «Мои приложения».
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDef {
    pub id: String,
    pub name: String,
    /// one | two | twoPlusOne | grid
    pub layout: String,
    pub urls: Vec<String>,
    pub hotkey: String,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
}

#[derive(Default)]
pub struct AppsState {
    pub list: Mutex<Vec<AppDef>>,
    /// shortcut id (HotKey::id) → app id — диспатч глобальных хоткеев.
    pub hotkeys: Mutex<HashMap<u32, String>>,
}

/// Загрузить список из settings.json — вызывается в setup.
pub fn load(app: &AppHandle) -> Vec<AppDef> {
    app.store("settings.json")
        .ok()
        .and_then(|s| s.get("apps"))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn list(app: &AppHandle) -> Vec<AppDef> {
    app.state::<AppsState>()
        .list
        .lock()
        .map(|l| l.clone())
        .unwrap_or_default()
}

fn find(app: &AppHandle, id: &str) -> Option<AppDef> {
    app.state::<AppsState>()
        .list
        .lock()
        .ok()
        .and_then(|l| l.iter().find(|d| d.id == id).cloned())
}

fn persist(app: &AppHandle) {
    let st = app.state::<AppsState>();
    let Ok(list) = st.list.lock() else {
        return;
    };
    if let Ok(store) = app.store("settings.json") {
        store.set("apps", serde_json::to_value(list.clone()).unwrap_or_default());
        let _ = store.save();
    }
}

/// Раскладки: доли окна (x, y, w, h) для каждого вебвью по порядку url'ов.
fn layout_rects(layout: &str) -> &'static [(f64, f64, f64, f64)] {
    match layout {
        "two" => &[(0.0, 0.0, 0.5, 1.0), (0.5, 0.0, 0.5, 1.0)],
        "twoPlusOne" => &[
            (0.0, 0.0, 0.5, 0.5),
            (0.5, 0.0, 0.5, 0.5),
            (0.0, 0.5, 1.0, 0.5),
        ],
        "grid" => &[
            (0.0, 0.0, 0.5, 0.5),
            (0.5, 0.0, 0.5, 0.5),
            (0.0, 0.5, 0.5, 0.5),
            (0.5, 0.5, 0.5, 0.5),
        ],
        _ => &[(0.0, 0.0, 1.0, 1.0)],
    }
}

/// Количество панелей в раскладке — для валидации числа url'ов.
fn panel_count(layout: &str) -> usize {
    layout_rects(layout).len()
}

/// Расставить дочерние вебвью по текущему размеру окна.
fn layout_children(win: &tauri::Window, def: &AppDef) {
    let Ok(size) = win.inner_size() else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let lw = f64::from(size.width) / scale;
    let lh = f64::from(size.height) / scale;
    for (i, url) in def.urls.iter().enumerate() {
        let Some(r) = layout_rects(&def.layout).get(i) else {
            break;
        };
        let Ok(url) = tauri::Url::parse(url) else {
            continue;
        };
        let wv = tauri::webview::WebviewBuilder::new(
            format!("{}-{}", win.label(), i),
            WebviewUrl::External(url),
        );
        let pos = LogicalPosition::new(r.0 * lw, r.1 * lh);
        let sz = LogicalSize::new(r.2 * lw, r.3 * lh);
        let _ = win.add_child(wv, pos, sz);
    }
}

/// Перестроить дочерние вебвью при ресайзе окна приложения.
pub fn relayout(window: &tauri::Window) {
    let app = window.app_handle();
    let Some(id) = window.label().strip_prefix("app-") else {
        return;
    };
    let Some(def) = find(app, id) else {
        return;
    };
    let Some(win) = app.get_window(&format!("app-{id}")) else {
        return;
    };
    let Ok(size) = win.inner_size() else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let lw = f64::from(size.width) / scale;
    let lh = f64::from(size.height) / scale;
    for wv in win.webviews() {
        let Some(idx) = wv
            .label()
            .strip_prefix(&format!("app-{id}-"))
            .and_then(|s| s.parse::<usize>().ok())
        else {
            continue;
        };
        let Some(r) = layout_rects(&def.layout).get(idx) else {
            continue;
        };
        let _ = wv.set_position(LogicalPosition::new(r.0 * lw, r.1 * lh));
        let _ = wv.set_size(LogicalSize::new(r.2 * lw, r.3 * lh));
    }
}

/// Запомнить размер и позицию окна в описании приложения.
fn save_geometry(win: &tauri::WebviewWindow, id: &str) {
    let app = win.app_handle();
    let (Ok(size), Ok(pos)) = (win.outer_size(), win.outer_position()) else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let Some(st) = app.try_state::<AppsState>() else {
        return;
    };
    if let Ok(mut list) = st.list.lock() {
        if let Some(d) = list.iter_mut().find(|d| d.id == id) {
            d.width = Some(f64::from(size.width) / scale);
            d.height = Some(f64::from(size.height) / scale);
            d.x = Some(f64::from(pos.x) / scale);
            d.y = Some(f64::from(pos.y) / scale);
        }
    }
    persist(app);
}

fn open_window(app: &AppHandle, def: &AppDef) {
    let label = format!("app-{}", def.id);
    let mut b = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html#blank".into()))
        .title(def.name.clone())
        .skip_taskbar(true);
    match (def.width, def.height) {
        (Some(w), Some(h)) => {
            b = b.inner_size(w, h);
        }
        _ => {
            b = b.maximized(true);
        }
    }
    if let (Some(x), Some(y)) = (def.x, def.y) {
        b = b.position(x, y);
    }
    if b.build().is_err() {
        return;
    }
    let Some(window) = app.get_window(&label) else {
        return;
    };
    layout_children(&window, def);
}

/// Открыть или скрыть окно приложения.
pub fn toggle(app: &AppHandle, id: &str) {
    let label = format!("app-{id}");
    if let Some(win) = app.get_webview_window(&label) {
        if win.is_visible().unwrap_or(false) {
            save_geometry(&win, id);
            let _ = win.hide();
        } else {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
        return;
    }
    let Some(def) = find(app, id) else {
        return;
    };
    open_window(app, &def);
}

/// Диспатч глобального хоткея: id шортката → app id → toggle.
pub fn hotkey_toggle(app: &AppHandle, shortcut_id: u32) {
    let app_id = app
        .try_state::<AppsState>()
        .and_then(|s| s.hotkeys.lock().ok().and_then(|m| m.get(&shortcut_id).cloned()));
    if let Some(app_id) = app_id {
        toggle(app, &app_id);
    }
}

/// Перерегистрация всех глобальных хоткеев: захват + приложения.
/// Вызывается при старте, смене хоткея захвата и сохранении приложений.
pub fn refresh_hotkeys(app: &AppHandle) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let cap = app
        .try_state::<crate::CurrentHotkey>()
        .and_then(|h| h.0.lock().ok().map(|s| s.clone()))
        .unwrap_or_else(|| crate::DEFAULT_HOTKEY.to_string());
    if gs.register(cap.as_str()).is_err() {
        let _ = gs.register(crate::DEFAULT_HOTKEY);
    }

    let Some(st) = app.try_state::<AppsState>() else {
        return;
    };
    let Ok(mut map) = st.hotkeys.lock() else {
        return;
    };
    map.clear();
    let Ok(list) = st.list.lock() else {
        return;
    };
    for d in list.iter() {
        if d.hotkey.trim().is_empty() {
            continue;
        }
        let Ok(sc) = d.hotkey.parse::<Shortcut>() else {
            continue;
        };
        if gs.register(d.hotkey.as_str()).is_ok() {
            map.insert(sc.id(), d.id.clone());
        }
    }
}

// ---------- команды для окна «Мои приложения» ----------

#[tauri::command]
pub fn apps_list(app: AppHandle) -> Vec<AppDef> {
    list(&app)
}

#[tauri::command]
pub fn apps_save(app: AppHandle, def: AppDef) -> Result<(), String> {
    if !def.hotkey.trim().is_empty()
        && def.hotkey.trim().parse::<Shortcut>().is_err()
    {
        return Err("некорректная комбинация клавиш".to_string());
    }
    if def.urls.len() != panel_count(&def.layout) {
        return Err("число ссылок не совпадает с раскладкой".to_string());
    }
    for u in &def.urls {
        if tauri::Url::parse(u).is_err() {
            return Err(format!("некорректная ссылка: {u}"));
        }
    }
    let st = app.state::<AppsState>();
    if let Ok(mut list) = st.list.lock() {
        if let Some(d) = list.iter_mut().find(|d| d.id == def.id) {
            *d = def;
        } else {
            list.push(def);
        }
    }
    drop(st);
    persist(&app);
    refresh_hotkeys(&app);
    crate::rebuild_tray(&app);
    Ok(())
}

#[tauri::command]
pub fn apps_delete(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&format!("app-{id}")) {
        let _ = win.destroy();
    }
    let st = app.state::<AppsState>();
    if let Ok(mut list) = st.list.lock() {
        list.retain(|d| d.id != id);
    }
    drop(st);
    persist(&app);
    refresh_hotkeys(&app);
    crate::rebuild_tray(&app);
    Ok(())
}

#[tauri::command]
pub fn app_toggle(app: AppHandle, id: String) {
    toggle(&app, &id);
}
