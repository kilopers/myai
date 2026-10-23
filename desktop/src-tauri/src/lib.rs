use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::io::Cursor;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::ShortcutState;

struct Capture {
    png: Vec<u8>,
    width: u32,
    height: u32,
    scale_factor: f64,
}

struct PendingCapture(Mutex<Vec<Option<Capture>>>);

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
    server_url: String,
    token: String,
    png_base64: String,
) -> Result<String, String> {
    let bytes = B64.decode(&png_base64).map_err(|e| e.to_string())?;

    let part = reqwest::multipart::Part::bytes(bytes)
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
    for tmon in &monitors {
        let pos = tmon.position();
        let size = tmon.size();
        let capture = xcap_monitors
            .iter()
            .find(|m| {
                (m.x().unwrap_or(i32::MIN) - pos.x).abs() <= 4
                    && (m.y().unwrap_or(i32::MIN) - pos.y).abs() <= 4
                    && m.width().unwrap_or(0) == size.width
                    && m.height().unwrap_or(0) == size.height
            })
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
            .title("Screenshoter")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
        // Physical coordinates — mixed-DPI / rotated monitor layouts are
        // only correct in physical space; logical positions misplace windows.
        let _ = win.set_position(tauri::Position::Physical(pos));
        let _ = win.set_size(tauri::Size::Physical(size));
        let _ = win.set_fullscreen(true);
        let _ = win.show();
    }

    if let Some(win) = app.get_webview_window("overlay-0") {
        let _ = win.set_focus();
    }
    Ok(())
}

fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html#settings".into()),
    )
    .title("Screenshoter — настройки")
    .inner_size(440.0, 380.0)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn trigger_capture(app: &AppHandle) {
    if let Err(e) = open_overlay_windows(app) {
        eprintln!("overlay window error: {e}");
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
        .invoke_handler(tauri::generate_handler![take_capture, close_overlays, upload_screenshot])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let capture_item = MenuItem::with_id(app, "capture", "Сделать скриншот", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Настройки", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&capture_item, &settings_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Screenshoter — Ctrl+Shift+X")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "capture" => trigger_capture(app),
                    "settings" => {
                        if let Err(e) = open_settings_window(app) {
                            eprintln!("settings window error: {e}");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Show settings on first launch so the user can configure server + token.
            open_settings_window(app.handle()).ok();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
