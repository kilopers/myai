mod sync;
mod update;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::io::Cursor;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_store::StoreExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

struct Capture {
    png: Vec<u8>,
    width: u32,
    height: u32,
    scale_factor: f64,
}

struct PendingCapture(Mutex<Vec<Option<Capture>>>);

// Кроп выделенной области — его забирает окно редактора.
struct PendingEdit(Mutex<Option<Capture>>);

#[derive(serde::Serialize)]
struct CapturePayload {
    png_base64: String,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[tauri::command]
fn take_capture(
    index: usize,
    state: tauri::State<'_, PendingCapture>,
) -> Option<CapturePayload> {
    state.0.lock().ok()?.get(index)?.as_ref().map(|c| CapturePayload {
        png_base64: B64.encode(&c.png),
        width: c.width,
        height: c.height,
        scale_factor: c.scale_factor,
    })
}

#[tauri::command]
fn take_edit(state: tauri::State<'_, PendingEdit>) -> Option<CapturePayload> {
    state.0.lock().ok()?.as_ref().map(|c| CapturePayload {
        png_base64: B64.encode(&c.png),
        width: c.width,
        height: c.height,
        scale_factor: c.scale_factor,
    })
}

/// Выделение завершено: сохраняем кроп и ОТЛОЖЕННО закрываем оверлеи +
/// открываем окно редактора. Выкладывать всё прямо внутри invoke нельзя:
/// вызвавшее оверлей-окно умрёт посреди команды и приложение зависнет.
#[tauri::command]
fn open_editor(
    app: AppHandle,
    png_base64: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let bytes = B64.decode(&png_base64).map_err(|e| e.to_string())?;
    if let Ok(mut guard) = app.state::<PendingEdit>().0.lock() {
        *guard = Some(Capture {
            png: bytes,
            width,
            height,
            scale_factor: 1.0,
        });
    }

    let app2 = app.clone();
    std::thread::spawn(move || {
        // Даём invoke завершиться и вебвью оверлея освободиться.
        std::thread::sleep(std::time::Duration::from_millis(120));
        let app3 = app2.clone();
        let _ = app2.run_on_main_thread(move || {
            for (label, win) in app3.webview_windows() {
                if label.starts_with("overlay") {
                    let _ = win.close();
                }
            }
            if let Ok(mut guard) = app3.state::<PendingCapture>().0.lock() {
                guard.clear();
            }
            if let Err(e) = show_editor(&app3, width, height) {
                eprintln!("editor window error: {e}");
            }
        });
    });

    Ok(())
}

/// Показать/создать окно редактора с кропом размером width×height (физпиксели).
fn show_editor(app: &AppHandle, width: u32, height: u32) -> Result<(), String> {
    // Окно подгоняется под картинку, но не больше ~80% экрана; +52px на тулбар.
    let mon = app.primary_monitor().ok().flatten();
    let scale = mon.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let logical_w = width as f64 / scale;
    let logical_h = height as f64 / scale;
    let (max_w, max_h) = mon
        .map(|m| {
            (
                m.size().width as f64 / scale * 0.8,
                m.size().height as f64 / scale * 0.8,
            )
        })
        .unwrap_or((1400.0, 800.0));
    // Минимум окна — чтобы гарантированно влезал вся панель
    // (инструменты + цвета + Отправить/Копировать + закрытие ≈ 700px).
    const MIN_W: f64 = 720.0;
    const MIN_H: f64 = 420.0;
    let ratio = (max_w / logical_w.max(1.0))
        .min(max_h / logical_h.max(1.0))
        .min(1.0);
    let win_w = (logical_w * ratio).clamp(MIN_W, max_w.max(MIN_W));
    let win_h = (logical_h * ratio + 68.0).clamp(MIN_H, max_h.max(MIN_H));

    if let Some(win) = app.get_webview_window("editor") {
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: win_w,
            height: win_h,
        }));
        let _ = win.eval("if (location.hash !== '#editor') location.hash = '#editor'; location.reload()");
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "editor", WebviewUrl::App("index.html#editor".into()))
        .title("Мой AI ассистент")
        .decorations(false)
        .inner_size(win_w, win_h)
        .min_inner_size(MIN_W, MIN_H)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Фронт дорендерил картинку — только теперь показываем окно (без белой вспышки).
#[tauri::command]
fn editor_ready(app: AppHandle) {
    if let Some(win) = app.get_webview_window("editor") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn hide_editor(app: AppHandle) {
    if let Some(win) = app.get_webview_window("editor") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn close_overlays(app: AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with("overlay") {
            let _ = win.close();
        }
    }
    if let Ok(mut guard) = app.state::<PendingCapture>().0.lock() {
        guard.clear();
    }
}

#[tauri::command]
async fn upload_screenshot(
    app: AppHandle,
    server_url: String,
    token: String,
    png_base64: String,
) -> Result<String, String> {
    let bytes = B64.decode(&png_base64).map_err(|e| e.to_string())?;

    let part = reqwest::multipart::Part::bytes(bytes.clone())
        .file_name("screenshot.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("image", part);

    let url = format!("{}/api/screenshots", server_url.trim_end_matches('/'));
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // Копию в sync-папку не пишем: скриншоты живут только в вебе.
    json["data"]["url"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "Unexpected server response".to_string())
}

fn open_overlay_windows(app: &AppHandle) -> Result<(), String> {
    let mut monitors = app.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        monitors = app.primary_monitor().map_err(|e| e.to_string())?.into_iter().collect();
    }
    let xcap_monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;

    // Capture BEFORE the overlay windows cover the screens. Index in `captures`
    // matches the Tauri monitor index and the `overlay-{i}` window label.
    let mut captures: Vec<Option<Capture>> = Vec::with_capacity(monitors.len());
    for (mi, tmon) in monitors.iter().enumerate() {
        let pos = tmon.position();
        let size = tmon.size();
        // Строгий матч по позиции+размеру, на Retina размеры в pt/px
        // расходятся — фолбэки: только по позиции, затем по индексу.
        let xmon = xcap_monitors
            .iter()
            .find(|m| {
                (m.x().unwrap_or(i32::MIN) - pos.x).abs() <= 4
                    && (m.y().unwrap_or(i32::MIN) - pos.y).abs() <= 4
                    && m.width().unwrap_or(0) == size.width
                    && m.height().unwrap_or(0) == size.height
            })
            .or_else(|| {
                xcap_monitors.iter().find(|m| {
                    (m.x().unwrap_or(i32::MIN) - pos.x).abs() <= 8
                        && (m.y().unwrap_or(i32::MIN) - pos.y).abs() <= 8
                })
            })
            .or_else(|| xcap_monitors.get(mi));
        let capture = xmon
            .and_then(|m| m.capture_image().ok())
            .and_then(|img| {
                let mut png = Vec::new();
                img.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
                Some(Capture {
                    png,
                    width: img.width(),
                    height: img.height(),
                    scale_factor: tmon.scale_factor(),
                })
            });
        captures.push(capture);
    }

    // Если захват не удался ни на одном мониторе — на macOS это почти
    // всегда отсутствие права «Запись экрана»: предупреждаем пользователя.
    if captures.iter().all(|c| c.is_none()) {
        notify(app, "Мой AI ассистент", "Не удалось сделать снимок экрана. На macOS разрешите «Запись экрана»: Системные настройки → Конфиденциальность и безопасность → Запись экрана, затем перезапустите приложение.");
        #[cfg(target_os = "macos")]
        {
            // Открываем панель настроек прямо отсюда.
            let _ = std::process::Command::new("open")
                .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                .spawn();
        }
        return Err("screen capture failed (permission?)".into());
    }

    if let Ok(mut guard) = app.state::<PendingCapture>().0.lock() {
        *guard = captures;
    }

    for (i, tmon) in monitors.iter().enumerate() {
        let label = format!("overlay-{i}");
        let pos = *tmon.position();
        let size = *tmon.size();
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.set_position(tauri::Position::Physical(pos));
            let _ = win.set_size(tauri::Size::Physical(size));
            let _ = win.show();
            let _ = win.eval("location.reload()");
            continue;
        }
        let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("Мой AI ассистент")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible_on_all_workspaces(true)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
        // Physical coordinates — mixed-DPI / rotated monitor layouts are
        // only correct in physical space; logical positions misplace windows.
        let _ = win.set_position(tauri::Position::Physical(pos));
        let _ = win.set_size(tauri::Size::Physical(size));
        // На macOS нативный фулскрин уносит окно в отдельный Space и при
        // подходе курсора к верху показывает нативный тайтлбар с кнопками —
        // вместо него бордерлес-окно поверх всего экрана в текущем Space.
        #[cfg(not(target_os = "macos"))]
        let _ = win.set_fullscreen(true);
        let _ = win.show();
    }

    if let Some(win) = app.get_webview_window("overlay-0") {
        let _ = win.set_focus();
    }
    Ok(())
}

/// Фоновый WS-монитор: держит подключение к Reverb и красит точку
/// на иконке трея — жёлтая = идёт синхронизация, зелёная = online
/// (ws + валидный токен), красная = offline.
fn ws_icon(base: &tauri::image::Image<'_>, color: image::Rgba<u8>) -> tauri::image::Image<'static> {
    let rgba = base.rgba().to_vec();
    let (w, h) = (base.width(), base.height());
    let mut img = image::RgbaImage::from_raw(w, h, rgba).unwrap_or_default();
    let d = (w / 3).max(8);
    let (cx, cy) = (w.saturating_sub(d / 2), h.saturating_sub(d / 2));
    for y in cy.saturating_sub(d / 2)..cy + d / 2 {
        for x in cx.saturating_sub(d / 2)..cx + d / 2 {
            if x < w && y < h {
                let dx = x as i32 - cx as i32;
                let dy = y as i32 - cy as i32;
                if dx * dx + dy * dy <= (d as i32 / 2) * (d as i32 / 2) {
                    img.put_pixel(x, y, color);
                }
            }
        }
    }
    tauri::image::Image::new_owned(img.into_raw(), w, h)
}

/// Перерисовать точку трея по текущим флагам: приоритет у жёлтой
/// (идёт синхронизация), затем зелёная (online), иначе красная.
pub fn refresh_tray_icon(app: &AppHandle) {
    let syncing = app
        .try_state::<sync::SyncRunning>()
        .map(|s| s.0.load(Ordering::SeqCst))
        .unwrap_or(false);
    let online = app
        .try_state::<Arc<AtomicBool>>()
        .map(|s| s.load(Ordering::SeqCst))
        .unwrap_or(false);
    let color = if syncing {
        image::Rgba([234, 179, 8, 255])
    } else if online {
        image::Rgba([34, 197, 94, 255])
    } else {
        image::Rgba([239, 68, 68, 255])
    };
    if let (Some(tray), Some(base)) = (
        app.tray_by_id("main-tray"),
        app.default_window_icon().cloned(),
    ) {
        tray.set_icon(Some(ws_icon(&base, color))).ok();
    }
}

fn set_ws_status(app: &AppHandle, online: Arc<AtomicBool>, val: bool) {
    online.store(val, Ordering::SeqCst);
    refresh_tray_icon(app);
}

async fn ws_connect_once(app: &AppHandle, online: Arc<AtomicBool>) {
    let base = match app.store("settings.json")
        .ok()
        .and_then(|s| s.get("server_url"))
        .and_then(|v| v.as_str().map(str::to_owned))
    {
        Some(u) if !u.is_empty() => u.trim_end_matches('/').to_string(),
        _ => return,
    };
    // Берём Reverb key из публичного конфига API (fallback — дефолтный).
    let key = match reqwest::get(format!("{base}/api/ws-config")).await {
        Ok(r) => r.json::<serde_json::Value>().await.ok()
            .and_then(|j| j.get("key").and_then(|v| v.as_str()).map(str::to_owned))
            .unwrap_or_else(|| "myai".to_string()),
        Err(_) => "myai".to_string(),
    };
    // ws(s)://host/app/<key>?protocol=7 — Pusher-handshake Reverb.
    let ws_base = base
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
    let ws_url = format!("{ws_base}/app/{key}?protocol=7&client=desktop&version=1.0");
    match connect_async(&ws_url).await {
        Ok((mut stream, _)) => {
            // «Онлайн» = ws подключён И токен принят сервером
            // (/api/auth/me вернул id). Битый токен → красная точка.
            let uid = fetch_user_id(app, &base).await;
            set_ws_status(app, online.clone(), uid.is_some());

            // Страховка на случай пропущенного push: сверка версии
            // по HTTP при каждом (ре)коннекте.
            {
                let app3 = app.clone();
                let base3 = base.clone();
                tauri::async_runtime::spawn(async move {
                    update::check_for_update(&app3, &base3).await;
                });
            }

            // Подписка на канал «Синхронизировать эту ветку» из веба.
            if let Some(uid) = uid {
                let sub = serde_json::json!({
                    "event": "pusher:subscribe",
                    "data": { "channel": format!("sync.user.{uid}") },
                });
                let _ = stream.send(Message::Text(sub.to_string().into())).await;
            }
            // Публичный канал push-уведомлений о новой версии десктопа.
            let sub = serde_json::json!({
                "event": "pusher:subscribe",
                "data": { "channel": "app.updates" },
            });
            let _ = stream.send(Message::Text(sub.to_string().into())).await;

            while let Some(msg) = stream.next().await {
                let Ok(Message::Text(text)) = msg else { continue };
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                match v["event"].as_str() {
                    Some("pusher:ping") => {
                        let pong = serde_json::json!({"event": "pusher:pong", "data": {}});
                        let _ = stream.send(Message::Text(pong.to_string().into())).await;
                    }
                    Some("sync.requested") => {
                        // data — JSON-строка в протоколе Pusher
                        let data = v["data"]
                            .as_str()
                            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                            .unwrap_or_else(|| v["data"].clone());
                        let folder_id = data["folder_id"].as_i64();
                        sync::log(app, "событие из веба: синхронизировать ветку".to_string());
                        sync::spawn_sync(app, folder_id);
                    }
                    Some("app.update-available") => {
                        let data = v["data"]
                            .as_str()
                            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                            .unwrap_or_else(|| v["data"].clone());
                        if let Some(info) = update::UpdateInfo::from_payload(&data) {
                            update::prompt_update(app, info);
                        }
                    }
                    _ => {}
                }
            }
        }
        Err(_) => {}
    }
    set_ws_status(app, online.clone(), false);
}

/// id текущего пользователя по API-токену — для канала sync.user.{id}.
async fn fetch_user_id(app: &AppHandle, base: &str) -> Option<i64> {
    let token = app
        .store("settings.json")
        .ok()
        .and_then(|s| s.get("api_token"))
        .and_then(|v| v.as_str().map(str::to_owned))?;
    let resp = reqwest::Client::new()
        .get(format!("{base}/api/auth/me"))
        .bearer_auth(token)
        .send()
        .await
        .ok()?;
    let j: serde_json::Value = resp.json().await.ok()?;
    j["id"].as_i64()
}

fn spawn_ws_monitor(app: &AppHandle) {
    let app2 = app.clone();
    let online = app2.state::<Arc<AtomicBool>>().inner().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            ws_connect_once(&app2, online.clone()).await;
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
}

/// Проверка новой версии раз в 6 часов — подхватывает релизы, чей
/// push пролетел мимо (спящий/офлайн клиент при стабильном ws).
fn spawn_update_poller(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
            update::check_saved(&app).await;
        }
    });
}

/// Копирует PNG (base64) в буфер обмена как картинку.
#[tauri::command]
fn copy_screenshot(app: AppHandle, png_base64: String) -> Result<(), String> {
    let png = B64.decode(png_base64).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&png)
        .map_err(|e| e.to_string())?
        .to_rgba8();
    let (w, h) = img.dimensions();
    app.clipboard()
        .write_image(&tauri::image::Image::new_owned(img.into_raw(), w, h))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn ws_status(state: tauri::State<'_, Arc<AtomicBool>>) -> bool {
    state.load(Ordering::SeqCst)
}

/// Окно «О программе» — версия приложения.
fn open_about_window(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("about") {
        let _ = win.unminimize();
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "about", WebviewUrl::App("index.html#about".into()))
        .title("О программе")
        .inner_size(340.0, 220.0)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html#settings".into()),
    )
    .title("Мой AI ассистент — настройки")
    .inner_size(520.0, 840.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

fn trigger_capture(app: &AppHandle) {
    if let Err(e) = open_overlay_windows(app) {
        eprintln!("overlay window error: {e}");
        if !e.contains("screen capture failed") {
            notify(app, "Мой AI ассистент", &format!("Ошибка захвата экрана: {e}"));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("ctrl+shift+x")
                .expect("invalid shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        trigger_capture(app);
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !window.label().starts_with("overlay") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(PendingCapture(Mutex::new(Vec::new())))
        .manage(PendingEdit(Mutex::new(None)))
        .manage(Arc::new(AtomicBool::new(false)))
        .manage(sync::LogBuf(Mutex::new(std::collections::VecDeque::new())))
        .manage(sync::SyncRunning(AtomicBool::new(false)))
        .manage(sync::SyncWatch::default())
        .manage(update::PromptedVersions::default())
        .invoke_handler(tauri::generate_handler![
            take_capture,
            take_edit,
            open_editor,
            editor_ready,
            hide_editor,
            close_overlays,
            upload_screenshot,
            copy_screenshot,
            ws_status,
            sync::sync_now,
            sync::sync_log_tail,
            sync::sync_root_hash,
            sync::get_sync_folder,
            sync::set_sync_folder,
            sync::os_name,
            sync::open_privacy_settings
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let capture_item = MenuItem::with_id(app, "capture", "Сделать скриншот", true, None::<&str>)?;
            let sync_item = MenuItem::with_id(app, "sync", "Синхронизировать", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Настройки", true, None::<&str>)?;
            let about_item = MenuItem::with_id(app, "about", "О программе", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&capture_item, &sync_item, &settings_item, &about_item, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Мой AI ассистент — Ctrl+Shift+X")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "capture" => trigger_capture(app),
                    "sync" => {
                        sync::spawn_sync(app, None);
                    }
                    "settings" => {
                        if let Err(e) = open_settings_window(app) {
                            eprintln!("settings window error: {e}");
                        }
                    }
                    "about" => {
                        if let Err(e) = open_about_window(app) {
                            eprintln!("about window error: {e}");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Show settings on first launch so the user can configure server + token.
            open_settings_window(app.handle()).ok();
            spawn_ws_monitor(app.handle());
            spawn_update_poller(app.handle());
            // FS-монитор sync-папки + heartbeat корневого хэша
            sync::spawn_watch(app.handle());
            // Синхронизация при запуске (если настроена папка)
            sync::spawn_sync(app.handle(), None);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
