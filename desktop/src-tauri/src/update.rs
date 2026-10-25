//! Автообновление: сервер держит последний релиз десктопа
//! (`GET /api/desktop-version`, push `app.update-available` на канале
//! `app.updates`). Новая версия → уведомление + диалог подтверждения.
//! Windows: качаем инсталлятор с нашего сервера и запускаем, приложение
//! завершается. macOS: открываем страницу релиза/файл .dmg (сборка
//! неподписанная — настоящий tauri-updater невозможен без подписи).

use serde_json::Value;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_notification::NotificationExt;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use tauri_plugin_store::StoreExt;

/// Версии, для которых диалог уже показывали — не донимать повторно
/// за один запуск приложения.
#[derive(Default)]
pub struct PromptedVersions(pub Mutex<HashSet<String>>);

#[derive(Clone)]
pub struct UpdateInfo {
    pub version: String,
    #[cfg_attr(
        not(any(target_os = "windows", target_os = "macos")),
        allow(dead_code)
    )]
    pub downloads: Value,
    pub notes_url: Option<String>,
}

impl UpdateInfo {
    /// payload события app.update-available / ответа /api/desktop-version
    pub fn from_payload(v: &Value) -> Option<Self> {
        Some(Self {
            version: v["version"].as_str()?.to_string(),
            downloads: v["downloads"].clone(),
            notes_url: v["notes_url"].as_str().map(str::to_owned),
        })
    }
}

/// "1.2.3" / "v1.2.3" / "1.2" → (1, 2, 3); пре-релизный суффикс
/// и build-метаданные отбрасываются.
fn parse_semver(v: &str) -> Option<(u64, u64, u64)> {
    let v = v.trim().trim_start_matches(['v', 'V']);
    let v = v.split(['-', '+']).next()?;
    let mut parts = v.split('.');
    let mut nums = [0u64; 3];
    for slot in nums.iter_mut() {
        *slot = parts.next().unwrap_or("0").trim().parse().ok()?;
    }
    if parts.next().is_some() {
        return None;
    }
    Some(nums.into())
}

/// latest строго новее current (семверно).
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// Сервер из настроек приложения.
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn server_base(app: &AppHandle) -> Option<String> {
    app.store("settings.json")
        .ok()
        .and_then(|s| s.get("server_url"))
        .and_then(|v| v.as_str().map(str::to_owned))
        .filter(|u| !u.is_empty())
        .map(|u| u.trim_end_matches('/').to_string())
}

/// Ссылки из API относительные (/api/...) — достраиваем базой сервера.
#[cfg(any(target_os = "windows", target_os = "macos", test))]
fn abs_url(base: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        path.to_string()
    } else {
        format!("{base}{path}")
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Страховка на случай пропущенного push: при (ре)коннекте WS-монитора
/// сверяем версию сервера с текущей. Ошибки сети игнорируются — при
/// следующем реконнекте проверим снова.
pub async fn check_for_update(app: &AppHandle, base: &str) {
    let Ok(resp) = reqwest::Client::new()
        .get(format!("{base}/api/desktop-version"))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    else {
        return;
    };
    let Ok(json) = resp.json::<Value>().await else {
        return;
    };
    let Some(info) = UpdateInfo::from_payload(&json) else {
        return;
    };
    prompt_update(app, info);
}

/// Уведомление + диалог «обновить?»; общий вход и для push-события,
/// и для проверки при подключении.
pub fn prompt_update(app: &AppHandle, info: UpdateInfo) {
    if !is_newer(&info.version, env!("CARGO_PKG_VERSION")) {
        return;
    }
    if let Ok(mut set) = app.state::<PromptedVersions>().0.lock() {
        if !set.insert(info.version.clone()) {
            return; // по этой версии уже спрашивали
        }
    }

    notify(
        app,
        "Screenshoter",
        &format!("Доступна новая версия {} — сейчас установлена {}", info.version, env!("CARGO_PKG_VERSION")),
    );

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let yes = app2
            .dialog()
            .message(format!(
                "Доступна версия {}. Обновить сейчас?",
                info.version
            ))
            .title("Обновление Screenshoter")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Обновить".to_string(),
                "Позже".to_string(),
            ))
            .blocking_show();
        if yes {
            run_update(&app2, &info).await;
        }
    });
}

async fn run_update(app: &AppHandle, info: &UpdateInfo) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let base = server_base(app);
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let target = |platform: &str| {
        info.downloads[platform]
            .as_str()
            .and_then(|p| base.as_ref().map(|b| abs_url(b, p)))
    };

    #[cfg(target_os = "windows")]
    {
        // Инсталлятор — с нашего сервера; нет ссылки — страница релиза.
        match target("windows") {
            Some(url) => match download_installer(&url).await {
                Ok(path) => {
                    if let Err(e) = launch_installer(&path) {
                        notify(app, "Screenshoter", &format!("Не удалось запустить инсталлятор: {e}"));
                        return;
                    }
                    app.exit(0);
                }
                Err(e) => {
                    notify(app, "Screenshoter", &format!("Не удалось скачать обновление: {e}"));
                    if let Some(u) = info.notes_url.as_deref() {
                        open_url(u);
                    }
                }
            },
            None => {
                if let Some(u) = info.notes_url.as_deref() {
                    open_url(u);
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // dmg — открываем файл/страницу в браузере; подсказка про карантин
        // Gatekeeper (сборка неподписанная).
        let url = target("macos").or_else(|| info.notes_url.clone());
        if let Some(u) = url {
            open_url(&u);
        }
        notify(
            app,
            "Screenshoter",
            "После установки новой версии выполните в Терминале: xattr -cr /Applications/Screenshoter.app",
        );
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        if let Some(u) = info.notes_url.as_deref() {
            open_url(u);
        }
    }
}

/// Скачать инсталлятор во временную папку.
#[cfg(target_os = "windows")]
async fn download_installer(url: &str) -> Result<std::path::PathBuf, String> {
    let name = url
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .unwrap_or("screenshoter-setup.msi")
        .to_string();
    let bytes = reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let dir = std::env::temp_dir().join("screenshoter-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Запуск инсталлятора (Windows): .msi — через msiexec, .exe — напрямую.
#[cfg(target_os = "windows")]
fn launch_installer(path: &std::path::Path) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let is_msi = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("msi"))
        .unwrap_or(false);
    if is_msi {
        std::process::Command::new("msiexec")
            .arg("/i")
            .arg(path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
    } else {
        std::process::Command::new(path).spawn()?;
    }
    Ok(())
}

/// Открыть URL в браузере системной командой (opener-плагина нет).
fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_semver() {
        assert_eq!(parse_semver("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_semver("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_semver("1.2"), Some((1, 2, 0)));
        assert_eq!(parse_semver("1.2.3-beta.1"), Some((1, 2, 3)));
        assert_eq!(parse_semver("1.2.3+build"), Some((1, 2, 3)));
        assert_eq!(parse_semver("1.2.3.4"), None);
        assert_eq!(parse_semver("abc"), None);
        assert_eq!(parse_semver(""), None);
        assert_eq!(parse_semver("1.x.3"), None);
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("1.0.1", "1.0.0"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(is_newer("2.0.0", "1.9.9"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("0.9.9", "1.0.0"));
        assert!(!is_newer("garbage", "1.0.0"));
        assert!(!is_newer("1.0.0", "garbage"));
    }

    #[test]
    fn parses_update_payload() {
        let info = UpdateInfo::from_payload(&serde_json::json!({
            "version": "1.0.0",
            "downloads": {"windows": "/api/desktop-download/windows"},
            "notes_url": "https://example.com/notes",
        }))
        .unwrap();
        assert_eq!(info.version, "1.0.0");
        assert_eq!(
            info.downloads["windows"].as_str().unwrap(),
            "/api/desktop-download/windows"
        );
        assert_eq!(info.notes_url.as_deref(), Some("https://example.com/notes"));

        // без downloads / без version
        let info = UpdateInfo::from_payload(&serde_json::json!({
            "version": "1.0.0",
            "downloads": null,
        }))
        .unwrap();
        assert!(info.downloads["windows"].is_null());
        assert!(UpdateInfo::from_payload(&serde_json::json!({"downloads": {}})).is_none());
    }

    #[test]
    fn builds_absolute_urls() {
        assert_eq!(
            abs_url("https://s.example.com", "/api/desktop-download/windows"),
            "https://s.example.com/api/desktop-download/windows"
        );
        assert_eq!(
            abs_url("https://s.example.com", "https://cdn.example.com/f.dmg"),
            "https://cdn.example.com/f.dmg"
        );
    }
}
