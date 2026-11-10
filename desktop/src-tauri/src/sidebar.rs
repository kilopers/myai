//! Пин sync-папки в боковую панель файлового менеджера ОС.
//!
//! Windows — свой корневой пункт навигационной панели Проводника
//! (как OneDrive/Dropbox): CLSID-запись в HKCU + делегат shell32
//! Instance\InitPropertyBag\TargetFolderPath → реальная папка.
//! COM-сервер и права администратора не нужны.
//! macOS — папка в секции «Избранное» Finder через системную
//! утилиту sfltool (список com.apple.LSSharedFileList.FavoriteItems).

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::sync;

/// Фиксированный CLSID пункта «Мой AI ассистент» (Windows).
#[cfg(target_os = "windows")]
pub const NAV_CLSID: &str = "{E5A1F4C2-3B7D-4A6E-9C8B-1F2D3E4A5B6C}";

/// Имя пункта в панели навигации Проводника.
#[cfg(target_os = "windows")]
const WIN_NAME: &str = "Мой AI ассистент";

/// Список «Избранного» боковой панели Finder.
#[cfg(target_os = "macos")]
const MAC_LIST: &str = "com.apple.LSSharedFileList.FavoriteItems";

/// Флаг «папка закреплена в панели» в settings.json.
const STORE_KEY: &str = "sidebar_pin";

/// Флаг из настроек.
pub fn pin_enabled(app: &AppHandle) -> bool {
    app.store("settings.json")
        .ok()
        .and_then(|s| s.get(STORE_KEY))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn set_flag(app: &AppHandle, on: bool) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set(STORE_KEY, serde_json::Value::Bool(on));
    store.save().map_err(|e| e.to_string())
}

/// Перепривязать пункт к новой папке при смене sync_root
/// (вызывается из sync::set_sync_folder и при старте — идемпотентно).
pub fn re_pin(app: &AppHandle, old: Option<&str>, new: &str) -> Result<(), String> {
    if !pin_enabled(app) {
        return Ok(());
    }
    if let Some(old) = old.filter(|o| !o.is_empty() && *o != new) {
        let _ = unpin_native(app, Some(old));
    }
    pin_native(app, new)
}

// ---------- платформенные операции ----------

#[cfg(target_os = "windows")]
mod win {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::WIN32_ERROR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegDeleteValueW, RegOpenKeyExW,
        RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, KEY_WRITE,
        REG_DWORD, REG_EXPAND_SZ, REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    use super::{NAV_CLSID, WIN_NAME};

    /// CLSID делегата «ярлык на папку» из shell32.
    const DELEGATE_CLSID: &str = "{0AFACED1-E828-11D1-9187-B532F1E9575D}";
    const HIDE_ICONS: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\NewStartPanel";

    fn clsid_path() -> String {
        format!(r"Software\Classes\CLSID\{NAV_CLSID}")
    }

    fn namespace_path() -> String {
        format!(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace\{NAV_CLSID}"
        )
    }

    fn check(what: &str, e: WIN32_ERROR) -> Result<(), String> {
        e.ok().map_err(|_| format!("{what}: код {}", e.0))
    }

    /// Создать (или открыть) подключ внутри HKCU, путь может быть
    /// многоуровневым.
    unsafe fn create_key(sub: &str) -> Result<HKEY, String> {
        let mut h = HKEY::default();
        check(
            "RegCreateKeyExW",
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(sub),
                None,
                &HSTRING::new(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut h,
                None,
            ),
        )?;
        Ok(h)
    }

    /// Строка REG_SZ/REG_EXPAND_SZ в UTF-16LE с завершающим NUL.
    fn utf16(s: &str) -> Vec<u8> {
        s.encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect()
    }

    unsafe fn set_str(h: HKEY, name: &str, val: &str, expand: bool) -> Result<(), String> {
        let data = utf16(val);
        check(
            "RegSetValueExW",
            RegSetValueExW(
                h,
                &HSTRING::from(name),
                None,
                if expand { REG_EXPAND_SZ } else { REG_SZ },
                Some(data.as_slice()),
            ),
        )
    }

    /// Пустое имя значения — «(по умолчанию)» ключа.
    unsafe fn set_default(h: HKEY, val: &str, expand: bool) -> Result<(), String> {
        let data = utf16(val);
        check(
            "RegSetValueExW",
            RegSetValueExW(
                h,
                &HSTRING::new(),
                None,
                if expand { REG_EXPAND_SZ } else { REG_SZ },
                Some(data.as_slice()),
            ),
        )
    }

    unsafe fn set_dword(h: HKEY, name: &str, val: u32) -> Result<(), String> {
        check(
            "RegSetValueExW",
            RegSetValueExW(
                h,
                &HSTRING::from(name),
                None,
                REG_DWORD,
                Some(&val.to_le_bytes()),
            ),
        )
    }

    /// Сообщить проводнику об изменении ассоциаций/пространства имён —
    /// пункт появится в новых окнах (открытые не трогаем).
    fn notify_shell() {
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
        }
    }

    pub fn pin(folder: &str) -> Result<(), String> {
        unsafe {
            // CLSID\{GUID}: имя пункта и положение в панели.
            let h = create_key(&clsid_path())?;
            set_default(h, WIN_NAME, false)?;
            set_dword(h, "System.IsPinnedToNameSpaceTree", 1)?;
            set_dword(h, "SortOrderIndex", 0x42)?;
            let _ = RegCloseKey(h);

            // Иконка — ресурс 0 нашего exe.
            let h = create_key(&format!(r"{}\DefaultIcon", clsid_path()))?;
            let icon = std::env::current_exe()
                .map(|p| format!("{},0", p.display()))
                .unwrap_or_else(|_| "explorer.exe,0".into());
            set_default(h, &icon, false)?;
            let _ = RegCloseKey(h);

            // InProcServer32 → делегат shell32 (COM-сервер не нужен).
            let h = create_key(&format!(r"{}\InProcServer32", clsid_path()))?;
            set_default(h, r"%SystemRoot%\system32\shell32.dll", true)?;
            set_str(h, "ThreadingModel", "Apartment", false)?;
            let _ = RegCloseKey(h);

            // Instance + InitPropertyBag\TargetFolderPath → папка.
            let h = create_key(&format!(r"{}\Instance", clsid_path()))?;
            set_str(h, "CLSID", DELEGATE_CLSID, false)?;
            let _ = RegCloseKey(h);
            let h = create_key(&format!(r"{}\Instance\InitPropertyBag", clsid_path()))?;
            set_dword(h, "Attributes", 0x11)?;
            set_str(h, "TargetFolderPath", folder, false)?;
            let _ = RegCloseKey(h);

            // ShellFolder — атрибуты папки оболочки.
            let h = create_key(&format!(r"{}\ShellFolder", clsid_path()))?;
            set_dword(h, "Attributes", 0xF080_004D)?;
            set_dword(h, "FolderValueFlags", 0)?;
            let _ = RegCloseKey(h);

            // Регистрация в навигационной панели рабочего стола.
            let h = create_key(&namespace_path())?;
            set_default(h, WIN_NAME, false)?;
            let _ = RegCloseKey(h);

            // Прячем дублирующий значок на рабочем столе.
            let h = create_key(HIDE_ICONS)?;
            set_dword(h, NAV_CLSID, 1)?;
            let _ = RegCloseKey(h);

            notify_shell();
            Ok(())
        }
    }

    pub fn unpin() -> Result<(), String> {
        unsafe {
            // Ошибки удаления игнорируем — ключа может не быть
            // (повторный unpin / пункта не было) — операция идемпотентна.
            let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(clsid_path()));
            let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(namespace_path()));
            let mut h = HKEY::default();
            if RegOpenKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(HIDE_ICONS),
                None,
                KEY_SET_VALUE,
                &mut h,
            )
            .is_ok()
            {
                let _ = RegDeleteValueW(h, &HSTRING::from(NAV_CLSID));
                let _ = RegCloseKey(h);
            }
            notify_shell();
            Ok(())
        }
    }

    /// Пункт живёт в Desktop\NameSpace — проверяем наличие ключа.
    pub fn is_pinned() -> bool {
        unsafe {
            let mut h = HKEY::default();
            if RegOpenKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(namespace_path()),
                None,
                KEY_QUERY_VALUE,
                &mut h,
            )
            .is_ok()
            {
                let _ = RegCloseKey(h);
                return true;
            }
            false
        }
    }
}

#[cfg(target_os = "windows")]
fn pin_native(_app: &AppHandle, folder: &str) -> Result<(), String> {
    win::pin(folder)
}

#[cfg(target_os = "windows")]
fn unpin_native(_app: &AppHandle, _folder: Option<&str>) -> Result<(), String> {
    win::unpin()
}

#[cfg(target_os = "windows")]
fn is_pinned_native() -> bool {
    win::is_pinned()
}

#[cfg(target_os = "macos")]
fn sfl(args: &[&str]) -> Result<(), String> {
    let out = std::process::Command::new("/usr/bin/sfltool")
        .args(args)
        .output()
        .map_err(|e| format!("sfltool: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "sfltool {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

#[cfg(target_os = "macos")]
fn pin_native(_app: &AppHandle, folder: &str) -> Result<(), String> {
    // Анти-дубль: remove-item игнорируем, add-item — строго.
    let _ = sfl(&["remove-item", MAC_LIST, folder]);
    sfl(&["add-item", MAC_LIST, folder])
}

#[cfg(target_os = "macos")]
fn unpin_native(_app: &AppHandle, folder: Option<&str>) -> Result<(), String> {
    match folder {
        Some(f) => sfl(&["remove-item", MAC_LIST, f]),
        // Пути не знаем — снимать нечего (флаг сбросит вызывающий).
        None => Ok(()),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn pin_native(_app: &AppHandle, _folder: &str) -> Result<(), String> {
    Err("Закрепление в панели поддерживается только в Windows и macOS".into())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn unpin_native(_app: &AppHandle, _folder: Option<&str>) -> Result<(), String> {
    Ok(())
}

// ---------- Tauri-команды ----------

/// Текущее состояние пина. На Windows дополнительно сверяемся с
/// реестром: если пункт удалили руками — поправляем флаг.
#[tauri::command]
pub fn sidebar_pin_state(app: AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        let flag = pin_enabled(&app);
        let real = is_pinned_native();
        if flag != real {
            let _ = set_flag(&app, real);
            return real;
        }
    }
    pin_enabled(&app)
}

/// Включить/выключить пункт sync-папки в панели Проводника/Finder.
#[tauri::command]
pub fn sidebar_set_pinned(app: AppHandle, pin: bool) -> Result<(), String> {
    if pin {
        let root = sync::sync_root(&app)
            .ok_or_else(|| "Сначала выберите папку синхронизации".to_string())?;
        pin_native(&app, &root)?;
        set_flag(&app, true)?;
        sync::log(&app, format!("папка закреплена в панели: {root}"));
    } else {
        unpin_native(&app, sync::sync_root(&app).as_deref())?;
        set_flag(&app, false)?;
        sync::log(&app, "папка откреплена от панели");
    }
    Ok(())
}

/// Открыть sync-папку в файловом менеджере ОС.
#[tauri::command]
pub fn sidebar_open_folder(app: AppHandle) -> Result<(), String> {
    let root =
        sync::sync_root(&app).ok_or_else(|| "Папка синхронизации не выбрана".to_string())?;
    open_folder(&root);
    Ok(())
}

/// Открыть папку системной командой (трей + команда).
pub fn open_folder(path: &str) {
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer.exe").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(path).spawn();
}
