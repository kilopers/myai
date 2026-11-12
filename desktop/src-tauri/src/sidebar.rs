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

    /// CLSID делегата «ярлык на папку» из shell32 (официальный рецепт
    /// Microsoft dn889934 — как у OneDrive/Nextcloud; читает
    /// InitPropertyBag\TargetFolderPath). Старый делегат
    /// {0AFACED1-E828-11D1-9187-B532F1E9575D} читает «Target» и с
    /// TargetFolderPath давал пункт, который не открывается по клику.
    const DELEGATE_CLSID: &str = "{0E5AAE11-A475-4c5b-AB00-C66DE400274E}";
    const HIDE_ICONS: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\NewStartPanel";

    fn clsid_path() -> String {
        format!(r"Software\Classes\CLSID\{NAV_CLSID}")
    }

    /// 32-битный вид того же CLSID — чтобы пункт работал и в диалогах
    /// «Открыть/Сохранить» 32-битных приложений (рецепт Nextcloud).
    fn clsid_path_wow64() -> String {
        format!(r"Software\Classes\Wow6432Node\CLSID\{NAV_CLSID}")
    }

    fn namespace_path() -> String {
        format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace\{NAV_CLSID}")
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

    /// Полный набор значений CLSID-пункта: имя, положение в панели,
    /// иконка, делегат shell32 и целевая папка. Пишется в оба вида
    /// реестра (64- и 32-битный).
    unsafe fn write_clsid(root: &str, folder: &str, icon: &str) -> Result<(), String> {
        // CLSID\{GUID}: имя пункта и положение в панели.
        let h = create_key(root)?;
        set_default(h, WIN_NAME, false)?;
        set_dword(h, "System.IsPinnedToNameSpaceTree", 1)?;
        set_dword(h, "SortOrderIndex", 0x42)?;
        let _ = RegCloseKey(h);

        // Иконка — ресурс 0 нашего exe.
        let h = create_key(&format!(r"{root}\DefaultIcon"))?;
        set_default(h, icon, false)?;
        let _ = RegCloseKey(h);

        // InProcServer32 → делегат shell32 (COM-сервер не нужен).
        let h = create_key(&format!(r"{root}\InProcServer32"))?;
        set_default(h, r"%SystemRoot%\system32\shell32.dll", true)?;
        set_str(h, "ThreadingModel", "Apartment", false)?;
        let _ = RegCloseKey(h);

        // Instance → делегат + InitPropertyBag с целевой папкой.
        let h = create_key(&format!(r"{root}\Instance"))?;
        set_str(h, "CLSID", DELEGATE_CLSID, false)?;
        let _ = RegCloseKey(h);
        let h = create_key(&format!(r"{root}\Instance\InitPropertyBag"))?;
        set_dword(h, "Attributes", 0x11)?;
        set_str(h, "TargetFolderPath", folder, false)?;
        // «Target» — имя свойства у старых folder-shortcut объектов;
        // пишем тоже, чтобы пункт открывался на любых ревизиях shell.
        set_str(h, "Target", folder, false)?;
        let _ = RegCloseKey(h);

        // ShellFolder — атрибуты папки оболочки.
        let h = create_key(&format!(r"{root}\ShellFolder"))?;
        set_dword(h, "Attributes", 0xF080_004D)?;
        set_dword(h, "FolderValueFlags", 0x28)?;
        let _ = RegCloseKey(h);
        Ok(())
    }

    pub fn pin(folder: &str) -> Result<(), String> {
        unsafe {
            let icon = std::env::current_exe()
                .map(|p| format!("{},0", p.display()))
                .unwrap_or_else(|_| "explorer.exe,0".into());
            write_clsid(&clsid_path(), folder, &icon)?;
            write_clsid(&clsid_path_wow64(), folder, &icon)?;

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
            let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(clsid_path_wow64()));
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

/// macOS: «Избранное» Finder живёт в sharedfilelist. `sfltool
/// add-item` Apple убрала ещё в macOS 10.13 (команда молча ничего не
/// делает), поэтому работаем через LSSharedFileList API — оно помечено
/// deprecated, но функционирует и это единственный системный способ.
#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CStr, CString};

    use super::MAC_LIST;

    type CFRef = *const c_void;

    const ENCODING_UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8
    const POSIX_STYLE: isize = 0; // kCFURLPOSIXPathStyle

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(alloc: CFRef, s: *const c_char, enc: u32) -> CFRef;
        fn CFStringGetCString(s: CFRef, buf: *mut c_char, size: isize, enc: u32) -> bool;
        fn CFURLCreateWithFileSystemPath(
            alloc: CFRef,
            path: CFRef,
            style: isize,
            dir: bool,
        ) -> CFRef;
        fn CFURLCopyFileSystemPath(url: CFRef, style: isize) -> CFRef;
        fn CFArrayGetCount(arr: CFRef) -> isize;
        fn CFArrayGetValueAtIndex(arr: CFRef, idx: isize) -> CFRef;
        fn CFRelease(obj: CFRef);
    }

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        static kLSSharedFileListFavoriteItems: CFRef;
        static kLSSharedFileListItemLast: CFRef;
        fn LSSharedFileListCreate(alloc: CFRef, list_type: CFRef, options: CFRef) -> CFRef;
        fn LSSharedFileListCopySnapshot(list: CFRef, seed: *mut u32) -> CFRef;
        #[allow(clippy::too_many_arguments)]
        fn LSSharedFileListInsertItemURL(
            list: CFRef,
            before: CFRef,
            name: CFRef,
            icon: CFRef,
            url: CFRef,
            set: CFRef,
            clear: CFRef,
        ) -> CFRef;
        fn LSSharedFileListItemRemove(list: CFRef, item: CFRef) -> i32;
        fn LSSharedFileListItemResolve(
            item: CFRef,
            flags: u32,
            url: *mut CFRef,
            fsref: *mut c_void,
        ) -> i32;
    }

    unsafe fn cf_str(s: &str) -> CFRef {
        let c = CString::new(s).unwrap_or_default();
        CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), ENCODING_UTF8)
    }

    unsafe fn cf_to_string(s: CFRef) -> Option<String> {
        if s.is_null() {
            return None;
        }
        let mut buf = [0 as c_char; 8192];
        CFStringGetCString(s, buf.as_mut_ptr(), buf.len() as isize, ENCODING_UTF8)
            .then(|| CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned())
    }

    unsafe fn favorites() -> CFRef {
        LSSharedFileListCreate(
            std::ptr::null(),
            kLSSharedFileListFavoriteItems,
            std::ptr::null(),
        )
    }

    /// Путь, на который указывает элемент списка (без завершающего /).
    unsafe fn item_target(item: CFRef) -> Option<String> {
        let mut url: CFRef = std::ptr::null();
        if LSSharedFileListItemResolve(item, 0, &mut url, std::ptr::null_mut()) != 0
            || url.is_null()
        {
            return None;
        }
        let cf_path = CFURLCopyFileSystemPath(url, POSIX_STYLE);
        CFRelease(url);
        let path = cf_to_string(cf_path);
        if !cf_path.is_null() {
            CFRelease(cf_path);
        }
        path.map(|p| p.trim_end_matches('/').to_string())
    }

    /// Элементы «Избранного», ссылающиеся на folder (анти-дубли/снятие).
    unsafe fn matching_items(list: CFRef, folder: &str) -> Vec<CFRef> {
        let mut out = Vec::new();
        let want = folder.trim_end_matches('/');
        let mut seed = 0u32;
        let snap = LSSharedFileListCopySnapshot(list, &mut seed);
        if !snap.is_null() {
            for i in 0..CFArrayGetCount(snap) {
                let item = CFArrayGetValueAtIndex(snap, i);
                if item_target(item).as_deref() == Some(want) {
                    out.push(item);
                }
            }
            CFRelease(snap);
        }
        out
    }

    /// Фолбэк на древние macOS (<10.13), где sfltool ещё умел add-item.
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

    pub fn pin(folder: &str) -> Result<(), String> {
        unsafe {
            let list = favorites();
            if list.is_null() {
                // API недоступно — пробуем sfltool (file:// URL, не путь).
                return sfl(&["add-item", MAC_LIST, &format!("file://{folder}")]);
            }
            for item in matching_items(list, folder) {
                let _ = LSSharedFileListItemRemove(list, item);
            }
            let cf_path = cf_str(folder);
            let url = CFURLCreateWithFileSystemPath(std::ptr::null(), cf_path, POSIX_STYLE, true);
            let item = LSSharedFileListInsertItemURL(
                list,
                kLSSharedFileListItemLast,
                std::ptr::null(),
                std::ptr::null(),
                url,
                std::ptr::null(),
                std::ptr::null(),
            );
            for obj in [item, url, cf_path, list] {
                if !obj.is_null() {
                    CFRelease(obj);
                }
            }
            if item.is_null() {
                return Err("LSSharedFileListInsertItemURL вернул NULL".into());
            }
        }
        Ok(())
    }

    pub fn unpin(folder: &str) -> Result<(), String> {
        unsafe {
            let list = favorites();
            if list.is_null() {
                return sfl(&["remove-item", MAC_LIST, &format!("file://{folder}")]);
            }
            for item in matching_items(list, folder) {
                let _ = LSSharedFileListItemRemove(list, item);
            }
            CFRelease(list);
        }
        Ok(())
    }

    pub fn is_pinned(folder: &str) -> bool {
        unsafe {
            let list = favorites();
            if list.is_null() {
                return false;
            }
            let found = !matching_items(list, folder).is_empty();
            CFRelease(list);
            found
        }
    }
}

#[cfg(target_os = "macos")]
fn pin_native(_app: &AppHandle, folder: &str) -> Result<(), String> {
    mac::pin(folder)
}

#[cfg(target_os = "macos")]
fn unpin_native(_app: &AppHandle, folder: Option<&str>) -> Result<(), String> {
    match folder {
        Some(f) => mac::unpin(f),
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
    #[cfg(target_os = "macos")]
    {
        let flag = pin_enabled(&app);
        let real = sync::sync_root(&app)
            .map(|p| mac::is_pinned(&p))
            .unwrap_or(false);
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
    let root = sync::sync_root(&app).ok_or_else(|| "Папка синхронизации не выбрана".to_string())?;
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
