//! «Не давать уснуть» — запрет гашения экрана и сна ОС на время или
//! бессрочно, пунктами подменю трея.
//! macOS — дочерний процесс системного `caffeinate -dis` (умирает вместе
//! с приложением), Windows — SetThreadExecutionState с флагами
//! ES_CONTINUOUS|ES_DISPLAY_REQUIRED|ES_SYSTEM_REQUIRED.

use std::sync::Mutex;
use std::time::Duration;
use tauri::{menu::CheckMenuItem, AppHandle, Manager, Wry};

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
    #[cfg(target_os = "macos")]
    child: Mutex<Option<std::process::Child>>,
}

impl Default for KeepAwake {
    fn default() -> Self {
        Self {
            mode: Mutex::new(Mode::Off),
            generation: Mutex::new(0),
            items: Mutex::new(Vec::new()),
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
    let active = id_for_mode(mode);
    if let Ok(items) = st.items.lock() {
        for item in items.iter() {
            let _ = item.set_checked(item.id().as_ref() == active);
        }
    }
    drop(st);

    if let Mode::Minutes(min) = mode {
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
