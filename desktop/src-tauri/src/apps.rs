//! «Мои приложения» — пользовательские окна с вебвью по раскладке
//! (1 / 2 рядом / 2 сверху + 1 / сетка 2×2). Открытие/скрытие —
//! глобальный хоткей или пункт подменю трея; окно живёт вне
//! панели задач (skip_taskbar), размер/позиция сохраняются
//! в settings.json (ключ `apps`).

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
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
    /// Позиции разделителей в долях окна (0..1): [вертикальный,
    /// горизонтальный]. None — раскладка пополам.
    #[serde(default)]
    pub splits: Option<Vec<f64>>,
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

/// Толщина полосы-разделителя между панелями, логические px.
const DIV_PX: f64 = 6.0;

/// Клавиши «обновить страницу» внутри панели — как в браузере.
/// Инжектится в каждое дочернее вебвью (в т.ч. внешние сайты).
const RELOAD_SCRIPT: &str = "window.addEventListener('keydown',function(e){if(e.key==='F5'||((e.metaKey||e.ctrlKey)&&(e.key||'').toLowerCase()==='r')){e.preventDefault();location.reload();}});";

/// Живой терминал term:-панели: PTY-мастер + процесс + stdin.
pub struct TermProc {
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    /// true, когда в панели запущен явный `term:<cmd>` (а не шелл):
    /// только для таких пишем «процесс завершён».
    pub had_command: bool,
}

/// Живые процессы term:-панелей — label вебвью → PTY.
#[derive(Default)]
pub struct TermState {
    pub procs: Mutex<HashMap<String, TermProc>>,
}

/// Позиции разделителей приложения: [вертикальный, горизонтальный]
/// в долях окна; дефолт 0.5, зажаты в разумные пределы.
fn splits_of(def: &AppDef) -> Vec<f64> {
    let need = match def.layout.as_str() {
        "twoPlusOne" | "grid" => 2,
        "two" => 1,
        _ => 0,
    };
    (0..need)
        .map(|i| {
            def.splits
                .as_ref()
                .and_then(|s| s.get(i))
                .copied()
                .unwrap_or(0.5)
                .clamp(0.15, 0.85)
        })
        .collect()
}

/// Раскладки: доли окна (x, y, w, h) для каждого вебвью по порядку url'ов.
fn layout_rects(def: &AppDef) -> Vec<(f64, f64, f64, f64)> {
    let s = splits_of(def);
    match def.layout.as_str() {
        "two" => vec![(0.0, 0.0, s[0], 1.0), (s[0], 0.0, 1.0 - s[0], 1.0)],
        "twoPlusOne" => vec![
            (0.0, 0.0, s[0], s[1]),
            (s[0], 0.0, 1.0 - s[0], s[1]),
            (0.0, s[1], 1.0, 1.0 - s[1]),
        ],
        "grid" => vec![
            (0.0, 0.0, s[0], s[1]),
            (s[0], 0.0, 1.0 - s[0], s[1]),
            (0.0, s[1], s[0], 1.0 - s[1]),
            (s[0], s[1], 1.0 - s[0], 1.0 - s[1]),
        ],
        _ => vec![(0.0, 0.0, 1.0, 1.0)],
    }
}

/// Полосы-разделители: (индекс split, x, y, w, h) в долях окна.
/// w=0 — вертикальная полоса толщиной DIV_PX на x-фракции;
/// h=0 — горизонтальная на y-фракции.
fn divider_rects(def: &AppDef) -> Vec<(usize, f64, f64, f64, f64)> {
    let s = splits_of(def);
    match def.layout.as_str() {
        "two" => vec![(0, s[0], 0.0, 0.0, 1.0)],
        "twoPlusOne" => vec![(0, s[0], 0.0, 0.0, s[1]), (1, 0.0, s[1], 1.0, 0.0)],
        "grid" => vec![(0, s[0], 0.0, 0.0, 1.0), (1, 0.0, s[1], 1.0, 0.0)],
        _ => Vec::new(),
    }
}

/// Геометрия полосы-разделителя в логических пикселях.
fn divider_px(d: &(usize, f64, f64, f64, f64), lw: f64, lh: f64) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let (_, x, y, w, h) = *d;
    // Отступ от краёв окна по длинной оси — полоса живёт строго
    // внутри области панелей и не касается тайтлбара/рамок.
    const EDGE: f64 = 4.0;
    if w == 0.0 {
        (
            LogicalPosition::new(x * lw - DIV_PX / 2.0, y * lh + EDGE),
            LogicalSize::new(DIV_PX, (h * lh - 2.0 * EDGE).max(1.0)),
        )
    } else {
        (
            LogicalPosition::new(x * lw + EDGE, y * lh - DIV_PX / 2.0),
            LogicalSize::new((w * lw - 2.0 * EDGE).max(1.0), DIV_PX),
        )
    }
}

/// Количество панелей в раскладке — для валидации числа url'ов.
fn panel_count(layout: &str) -> usize {
    match layout {
        "two" => 2,
        "twoPlusOne" => 3,
        "grid" => 4,
        _ => 1,
    }
}

/// Расставить дочерние вебвью по текущему размеру окна.
fn layout_children(win: &tauri::Window, def: &AppDef) {
    let Ok(size) = win.inner_size() else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let lw = f64::from(size.width) / scale;
    let lh = f64::from(size.height) / scale;
    let rects = layout_rects(def);
    for (i, url) in def.urls.iter().enumerate() {
        let Some(r) = rects.get(i) else {
            break;
        };
        let label = format!("{}-{}", win.label(), i);
        // `term:<команда>` — панель-терминал (наш index.html#term),
        // остальное — внешняя ссылка.
        let wv = if url.starts_with("term:") {
            tauri::webview::WebviewBuilder::new(
                label,
                WebviewUrl::App("index.html#term".into()),
            )
        } else {
            let Ok(u) = tauri::Url::parse(url) else {
                continue;
            };
            tauri::webview::WebviewBuilder::new(label, WebviewUrl::External(u))
        };
        // Микрофон/камера для встроенных приложений (звонки и т.п.).
        let wv = wv
            .on_permission_request(|_, kind| match kind {
                tauri::webview::PermissionKind::Camera
                | tauri::webview::PermissionKind::Microphone => {
                    tauri::webview::PermissionResponse::Allow
                }
                _ => tauri::webview::PermissionResponse::Default,
            })
            .initialization_script(RELOAD_SCRIPT);
        let pos = LogicalPosition::new(r.0 * lw, r.1 * lh);
        let sz = LogicalSize::new(r.2 * lw, r.3 * lh);
        let _ = win.add_child(wv, pos, sz);
    }
    // Разделители — последними, чтобы быть поверх панелей и ловить drag.
    for d in divider_rects(def) {
        let wv = tauri::webview::WebviewBuilder::new(
            format!("{}-div-{}", win.label(), d.0),
            WebviewUrl::App("index.html#divider".into()),
        );
        let (pos, sz) = divider_px(&d, lw, lh);
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
    let rects = layout_rects(&def);
    let divs = divider_rects(&def);
    for wv in win.webviews() {
        let Some(suffix) = wv.label().strip_prefix(&format!("app-{id}-")) else {
            continue;
        };
        if let Some(d) = suffix
            .strip_prefix("div-")
            .and_then(|s| s.parse::<usize>().ok())
            .and_then(|i| divs.get(i))
        {
            let (pos, sz) = divider_px(d, lw, lh);
            let _ = wv.set_position(pos);
            let _ = wv.set_size(sz);
        } else if let Some(r) = suffix
            .parse::<usize>()
            .ok()
            .and_then(|i| rects.get(i))
        {
            let _ = wv.set_position(LogicalPosition::new(r.0 * lw, r.1 * lh));
            let _ = wv.set_size(LogicalSize::new(r.2 * lw, r.3 * lh));
        }
    }
}

/// Запомнить размер и позицию окна в описании приложения.
pub(crate) fn save_geometry(win: &tauri::Window, id: &str) {
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
    // get_window, а не get_webview_window: с дочерними вебвью окно
    // перестаёт считаться WebviewWindow и «теряется» навсегда.
    if let Some(win) = app.get_window(&label) {
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
        // `term:` без команды — интерактивный шелл по умолчанию (v1.5.1+).
        if u.strip_prefix("term:").is_some() {
            continue;
        }
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
    if let Some(win) = app.get_window(&format!("app-{id}")) {
        let _ = win.destroy();
    }
    kill_terms(&app, &id);
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

/// Перетаскивание полосы-разделителя: `client` — смещение курсора
/// внутри полосы (px) по оси движения. Полоса всегда следует за
/// курсором, поэтому достаточно её позиции + смещения внутри неё.
#[tauri::command]
pub fn app_divider_move(app: AppHandle, id: String, index: usize, client: f64) {
    let Some(win) = app.get_window(&format!("app-{id}")) else {
        return;
    };
    let Some(def) = find(&app, &id) else {
        return;
    };
    let Ok(size) = win.inner_size() else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let len = if index == 0 {
        f64::from(size.width) / scale
    } else {
        f64::from(size.height) / scale
    };
    let Some(cur) = splits_of(&def).get(index).copied() else {
        return;
    };
    let frac = ((cur * len - DIV_PX / 2.0 + client) / len).clamp(0.15, 0.85);
    let st = app.state::<AppsState>();
    if let Ok(mut list) = st.list.lock() {
        if let Some(d) = list.iter_mut().find(|d| d.id == id) {
            let splits = d.splits.get_or_insert_with(Vec::new);
            if splits.len() <= index {
                splits.resize(index + 1, 0.5);
            }
            splits[index] = frac;
        }
    }
    drop(st);
    relayout(&win);
}

/// Конец перетаскивания разделителя — сохранить splits в settings.json.
#[tauri::command]
pub fn app_divider_done(app: AppHandle, id: String) {
    if find(&app, &id).is_some() {
        persist(&app);
    }
}

/// Запуск/перезапуск term:-панели. Настоящий PTY (portable-pty):
/// пустая команда — интерактивный шелл по умолчанию, `term:<cmd>` —
/// команда через sh -c / cmd /C. Сырой вывод (ANSI) стримится событием
/// `term-out-{label}` в xterm.js; ввод — app_term_write.
#[tauri::command]
pub fn app_term_run(app: AppHandle, id: String, index: usize) -> Result<(), String> {
    let def = find(&app, &id).ok_or_else(|| "приложение не найдено".to_string())?;
    let url = def.urls.get(index).cloned().unwrap_or_default();
    let Some(cmdline) = url.strip_prefix("term:").map(str::trim) else {
        return Err("панель не является терминалом".to_string());
    };
    let had_command = !cmdline.is_empty();
    let label = format!("app-{id}-{index}");

    {
        let st = app.state::<TermState>();
        if let Ok(mut m) = st.procs.lock() {
            if let Some(mut p) = m.remove(&label) {
                let _ = p.child.kill();
                let _ = p.child.wait();
            }
        };
    }

    let cmd = if had_command {
        #[cfg(target_os = "windows")]
        let c = {
            let mut c = portable_pty::CommandBuilder::new("cmd");
            c.arg("/C");
            c.arg(cmdline);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let c = {
            let mut c = portable_pty::CommandBuilder::new("sh");
            c.arg("-c");
            c.arg(cmdline);
            c
        };
        c
    } else {
        // Пустой term: — интерактивный шелл по умолчанию ($SHELL / cmd.exe).
        portable_pty::CommandBuilder::new_default_prog()
    };

    let pair = portable_pty::native_pty_system()
        .openpty(portable_pty::PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let st = app.state::<TermState>();
        if let Ok(mut m) = st.procs.lock() {
            m.insert(
                label.clone(),
                TermProc {
                    child,
                    master: pair.master,
                    writer,
                    had_command,
                },
            );
        };
    }

    let app2 = app.clone();
    let label2 = label.clone();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut pending: Vec<u8> = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    // Отдаём только полные UTF-8-последовательности —
                    // хвост неполного символа ждёт следующий кусок.
                    let upto = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) => e.valid_up_to(),
                    };
                    if upto > 0 {
                        let text = String::from_utf8_lossy(&pending[..upto]).into_owned();
                        let _ = app2.emit(&format!("term-out-{label2}"), text);
                        pending.drain(..upto);
                    }
                    // Невалидный поток не копим бесконечно.
                    if pending.len() > 4096 {
                        pending.clear();
                    }
                }
            }
        }
    });

    let app3 = app.clone();
    let label3 = label.clone();
    std::thread::spawn(move || {
        // Ждём завершения процесса через try_wait по живому Child
        // в мапе; пропал из мапы — убит перезапуском/удалением.
        let st = app3.state::<TermState>();
        loop {
            let done = {
                let Ok(mut m) = st.procs.lock() else { return };
                match m.get_mut(&label3) {
                    Some(p) => !matches!(p.child.try_wait(), Ok(None)),
                    None => return,
                }
            };
            if done {
                let had = match st.procs.lock() {
                    Ok(mut m) => m.remove(&label3).map(|p| p.had_command).unwrap_or(false),
                    Err(_) => false,
                };
                if had {
                    let _ = app3.emit(
                        &format!("term-out-{label3}"),
                        "\r\n\u{2014} процесс завершён \u{2014}\r\n",
                    );
                }
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
    Ok(())
}

/// Ввод в term:-панель — байты в stdin PTY.
#[tauri::command]
pub fn app_term_write(app: AppHandle, id: String, index: usize, data: String) -> Result<(), String> {
    use std::io::Write;
    let label = format!("app-{id}-{index}");
    let st = app.state::<TermState>();
    let mut m = st.procs.lock().map_err(|_| "нет терминала".to_string())?;
    let Some(p) = m.get_mut(&label) else {
        return Err("терминал не запущен".to_string());
    };
    p.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

/// Размер PTY следит за панелью (cols×rows от xterm.js fit-аддона).
#[tauri::command]
pub fn app_term_resize(
    app: AppHandle,
    id: String,
    index: usize,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let label = format!("app-{id}-{index}");
    let st = app.state::<TermState>();
    let m = st.procs.lock().map_err(|_| "нет терминала".to_string())?;
    let Some(p) = m.get(&label) else {
        return Err("терминал не запущен".to_string());
    };
    p.master
        .resize(portable_pty::PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Убить все term-процессы приложения (при удалении приложения).
fn kill_terms(app: &AppHandle, app_id: &str) {
    let Some(st) = app.try_state::<TermState>() else {
        return;
    };
    if let Ok(mut m) = st.procs.lock() {
        let prefix = format!("app-{app_id}-");
        let keys: Vec<String> = m.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
        for k in keys {
            if let Some(mut p) = m.remove(&k) {
                let _ = p.child.kill();
                let _ = p.child.wait();
            }
        }
    };
}
