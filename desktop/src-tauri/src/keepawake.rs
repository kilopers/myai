//! «Не давать уснуть» — запрет гашения экрана и сна ОС на время или
//! бессрочно, пунктами подменю трея.
//! macOS — дочерний процесс системного `caffeinate -dis` (умирает вместе
//! с приложением), Windows — SetThreadExecutionState с флагами
//! ES_CONTINUOUS|ES_DISPLAY_REQUIRED|ES_SYSTEM_REQUIRED.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    menu::{CheckMenuItem, Submenu},
    AppHandle, Manager, Wry,
};

/// Режим запрета сна.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Off,
    Minutes(u64),
    Forever,
}

/// Пункты таймера подменю: (menu_id, заголовок, режим).
const TIMERS: &[(&str, &str, Mode)] = &[
    ("awake-15", "15 минут", Mode::Minutes(15)),
    ("awake-30", "30 минут", Mode::Minutes(30)),
    ("awake-60", "1 час", Mode::Minutes(60)),
    ("awake-120", "2 часа", Mode::Minutes(120)),
    ("awake-forever", "Бессрочно", Mode::Forever),
];
/// Пункт «Выключить» — последний в MENU.
pub const OFF_ID: &str = "awake-off";

/// Все пункты подменю: таймеры + «Выключить».
pub const MENU: &[(&str, &str)] = &[
    ("awake-15", "15 минут"),
    ("awake-30", "30 минут"),
    ("awake-60", "1 час"),
    ("awake-120", "2 часа"),
    ("awake-forever", "Бессрочно"),
    (OFF_ID, "Выключить"),
];

fn mode_for_id(id: &str) -> Option<Mode> {
    TIMERS.iter().find(|(i, _, _)| *i == id).map(|(_, _, m)| *m)
}

fn id_for_mode(mode: Mode) -> &'static str {
    TIMERS
        .iter()
        .find(|(_, _, m)| *m == mode)
        .map(|(i, _, _)| *i)
        .unwrap_or(OFF_ID)
}

/// Состояние: активный режим, поколение (инвалидирует отложенное
/// авто-выключение) и хэндлы галочек подменю.
pub struct KeepAwake {
    mode: Mutex<Mode>,
    generation: Mutex<u64>,
    items: Mutex<Vec<CheckMenuItem<Wry>>>,
    /// Подменю «Не давать уснуть» — в его заголовок пишем обратный отсчёт.
    menu: Mutex<Option<Submenu<Wry>>>,
    /// Момент авто-выключения для режима Minutes (монотонные часы).
    deadline: Mutex<Option<Instant>>,
    #[cfg(target_os = "macos")]
    child: Mutex<Option<std::process::Child>>,
}

impl Default for KeepAwake {
    fn default() -> Self {
        Self {
            mode: Mutex::new(Mode::Off),
            generation: Mutex::new(0),
            items: Mutex::new(Vec::new()),
            menu: Mutex::new(None),
            deadline: Mutex::new(None),
            #[cfg(target_os = "macos")]
            child: Mutex::new(None),
        }
    }
}

/// Сохранить хэндлы пунктов меню — созданы в setup до регистрации стейта.
pub fn register_items(app: &AppHandle, items: Vec<CheckMenuItem<Wry>>) {
    if let Ok(mut guard) = app.state::<KeepAwake>().items.lock() {
        *guard = items;
    }
}

/// Сохранить хэндл подменю — нужен для строки обратного отсчёта.
pub fn register_menu(app: &AppHandle, menu: Submenu<Wry>) {
    if let Ok(mut guard) = app.state::<KeepAwake>().menu.lock() {
        *guard = Some(menu);
    }
}

/// Активен ли запрет сна — для молнии-«бейджа» на иконке трея.
pub fn is_active(app: &AppHandle) -> bool {
    app.try_state::<KeepAwake>()
        .and_then(|st| st.mode.lock().ok().map(|m| *m != Mode::Off))
        .unwrap_or(false)
}

/// Оставшееся время в «M:SS» / «H:MM:SS», бессрочный режим — «∞».
fn fmt_remaining(mode: Mode, deadline: Option<Instant>) -> Option<String> {
    match mode {
        Mode::Off => None,
        Mode::Forever => Some("∞".to_string()),
        Mode::Minutes(_) => {
            let s = deadline?
                .saturating_duration_since(Instant::now())
                .as_secs();
            Some(if s >= 3600 {
                format!("{}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
            } else {
                format!("{}:{:02}", s / 60, s % 60)
            })
        }
    }
}

/// Обновить текстовые индикаторы режима: заголовок подменю, title
/// иконки (macOS показывает текст рядом с иконкой) и тултип трея.
fn update_tray_text(app: &AppHandle) {
    let st = app.state::<KeepAwake>();
    let mode = *st.mode.lock().unwrap();
    let remaining = fmt_remaining(mode, *st.deadline.lock().unwrap());
    let menu = st.menu.lock().unwrap().clone();
    drop(st);

    if let Some(m) = menu {
        let text = match &remaining {
            Some(t) => format!("Не давать уснуть · {t}"),
            None => "Не давать уснуть".to_string(),
        };
        m.set_text(text);
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        let hotkey = app
            .try_state::<crate::CurrentHotkey>()
            .and_then(|h| h.0.lock().ok().map(|s| s.clone()))
            .unwrap_or_default();
        let tip = match &remaining {
            Some(t) => format!("Мой AI ассистент — {hotkey} · без сна {t}"),
            None => format!("Мой AI ассистент — {hotkey}"),
        };
        tray.set_tooltip(Some(tip)).ok();
        // Текст рядом с иконкой — виден на macOS; на Windows/Linux no-op.
        tray.set_title(remaining.map(|t| format!("⚡{t}"))).ok();
    }
}

/// Установить режим запрета сна.
pub fn activate(app: &AppHandle, mode: Mode) {
    let st = app.state::<KeepAwake>();
    apply_native(&st, mode);
    let gen = {
        let mut g = st.generation.lock().unwrap();
        *g += 1;
        *g
    };
    *st.mode.lock().unwrap() = mode;
    *st.deadline.lock().unwrap() = match mode {
        Mode::Minutes(min) => Some(Instant::now() + Duration::from_secs(min * 60)),
        _ => None,
    };
    let active = id_for_mode(mode);
    if let Ok(items) = st.items.lock() {
        for item in items.iter() {
            let _ = item.set_checked(item.id().as_ref() == active);
        }
    }
    drop(st);

    // Индикаторы: молния на иконке + строка остатка времени.
    crate::refresh_tray_icon(app);
    update_tray_text(app);

    if let Mode::Minutes(min) = mode {
        // Тикер обратного отсчёта: раз в 5 с обновляет тексты, пока
        // поколение режима то же (смена режима завершает тикер).
        let app_t = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                let st = app_t.state::<KeepAwake>();
                let fresh = st.generation.lock().map(|g| *g == gen).unwrap_or(false);
                drop(st);
                if !fresh {
                    break;
                }
                let app3 = app_t.clone();
                let _ = app_t.run_on_main_thread(move || {
                    update_tray_text(&app3);
                });
            }
        });

        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(min * 60)).await;
            let app3 = app2.clone();
            let _ = app2.run_on_main_thread(move || {
                let st = app3.state::<KeepAwake>();
                let fresh = st.generation.lock().map(|g| *g == gen).unwrap_or(false);
                drop(st);
                if fresh {
                    activate(&app3, Mode::Off);
                }
            });
        });
    }
}

/// Клик по пункту подменю трея: выбрать режим; повторный клик по
/// активному пункту или «Выключить» — снять запрет.
pub fn menu_event(app: &AppHandle, id: &str) {
    let st = app.state::<KeepAwake>();
    let cur = *st.mode.lock().unwrap();
    let mode = if id == OFF_ID {
        Mode::Off
    } else {
        match mode_for_id(id) {
            Some(m) if m != cur => m,
            Some(_) => Mode::Off,
            None => return,
        }
    };
    drop(st);
    activate(app, mode);
}

#[cfg(target_os = "macos")]
fn apply_native(st: &KeepAwake, mode: Mode) {
    let Ok(mut child) = st.child.lock() else { return };
    if let Some(mut c) = child.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
    if mode == Mode::Off {
        return;
    }
    let mut cmd = std::process::Command::new("caffeinate");
    // -d дисплей, -i простаивающая система, -s система на питании.
    cmd.arg("-dis");
    if let Mode::Minutes(m) = mode {
        // -t — страховка на случай потери таймера: процесс завершится сам.
        cmd.arg("-t").arg((m * 60).to_string());
    }
    *child = cmd.spawn().ok();
}

#[cfg(target_os = "windows")]
fn apply_native(_st: &KeepAwake, mode: Mode) {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    unsafe {
        let flags = if mode == Mode::Off {
            ES_CONTINUOUS
        } else {
            ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
        };
        SetThreadExecutionState(flags);
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_native(_st: &KeepAwake, _mode: Mode) {}
