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

struct PendingCapture(Mutex<Vec<Capture>>);

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
    state.0.lock().ok()?.get(index).map(|c| CapturePayload {
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
            let _ = win.hide();
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

fn capture_all_screens() -> Result<Vec<Capture>, String> {
    let mut captures = Vec::new();
    for monitor in xcap::Monitor::all().map_err(|e| e.to_string())? {
        let img = monitor.capture_image().map_err(|e| e.to_string())?;
        let mut png = Vec::new();
        img.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        captures.push(Capture {
            png,
            width: img.width(),
            height: img.height(),
            scale_factor: monitor.scale_factor().unwrap_or(1.0) as f64,
        });
    }
    if captures.is_empty() {
        return Err("No displays found".to_string());
    }
    Ok(captures)
}

fn open_overlay_windows(app: &AppHandle) -> Result<(), String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    for (i, monitor) in monitors.iter().enumerate() {
        let label = format!("overlay-{i}");
        if let Some(win) = app.get_webview_window(&label) {
            win.show().map_err(|e| e.to_string())?;
            win.set_focus().map_err(|e| e.to_string())?;
            continue;
        }
        WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("Screenshoter")
            .position(monitor.x().unwrap_or(0) as f64, monitor.y().unwrap_or(0) as f64)
            .fullscreen(true)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(true)
            .build()
            .map_err(|e| e.to_string())?;
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
    // Capture BEFORE the overlay windows cover the screens.
    match capture_all_screens() {
        Ok(captures) => {
            if let Ok(mut guard) = app.state::<PendingCapture>().0.lock() {
                *guard = captures;
            }
            if let Err(e) = open_overlay_windows(app) {
                eprintln!("overlay window error: {e}");
            }
        }
        Err(e) => eprintln!("capture error: {e}"),
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
                api.prevent_close();
                let _ = window.hide();
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
