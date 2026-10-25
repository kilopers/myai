//! Двусторонняя синхронизация локальной папки с серверным хранилищем.
//!
//! Содержимое файлов нигде не читается и не хэшируется — сравнение
//! только по метаданным. Формулы хэшей обязаны побитово совпадать
//! с серверной реализацией (server/app/Support/SyncHash.php),
//! паритет проверяется общими тест-векторами (mod tests ниже и
//! server/tests/Unit/SyncHashTest.php):
//!
//!   файл:  entry_hash = sha256("{name}|{size}|{mtime_unix}")
//!   папка: entry_hash = sha256("{name}|0|{dir_hash}")
//!   dir_hash = sha256(concat(entry_hash детей)) — дети по name byte-order
//!
//! Изменение содержимого без смены имени/размера/mtime не обнаруживается;
//! переименование = удаление + создание. Конфликт решается по mtime —
//! побеждает более новая версия.

use rusqlite::{params, Connection};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

pub const SCREENSHOTS_DIR: &str = "Скриншоты";
const LOG_CAP: usize = 500;
/// Сервер принимает чанки до 16 МБ — режем с запасом.
const CHUNK_SIZE: usize = 8 * 1024 * 1024;
/// Файлы больше этого порога грузятся чанками.
const CHUNK_THRESHOLD: u64 = 4 * 1024 * 1024;

/// Кольцевой буфер журнала — только память (в БД/файл не пишем).
pub struct LogBuf(pub Mutex<VecDeque<String>>);

/// Флаг «синхронизация уже идёт».
pub struct SyncRunning(pub AtomicBool);

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn now_hhmmss() -> String {
    let t = now_secs() % 86400;
    format!("{:02}:{:02}:{:02}", t / 3600, (t % 3600) / 60, t % 60)
}

/// Строка в живой журнал настроек + событие во все окна.
pub fn log(app: &AppHandle, msg: impl AsRef<str>) {
    let line = format!("[{}] {}", now_hhmmss(), msg.as_ref());
    if let Some(buf) = app.try_state::<LogBuf>() {
        if let Ok(mut g) = buf.0.lock() {
            g.push_back(line.clone());
            while g.len() > LOG_CAP {
                g.pop_front();
            }
        }
    }
    let _ = app.emit("sync-log", line);
}

// ---------- хэши (parity с PHP SyncHash) ----------

fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn file_hash(name: &str, size: u64, mtime: u64) -> String {
    sha256_hex(format!("{name}|{size}|{mtime}").as_bytes())
}

fn folder_hash(name: &str, dir_hash: &str) -> String {
    sha256_hex(format!("{name}|0|{dir_hash}").as_bytes())
}

/// dir_hash: дети сортируются по имени в byte-order, конкатенация хэшей.
fn dir_hash(children: &[(String, String)]) -> String {
    let mut items = children.to_vec();
    items.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let concat: String = items.iter().map(|c| c.1.as_str()).collect();
    sha256_hex(concat.as_bytes())
}

// ---------- локальное сканирование (только метаданные) ----------

#[derive(Clone, Default)]
struct LocalNode {
    is_dir: bool,
    size: u64,
    mtime: u64,
    entry_hash: String,
    dir_hash: String,
}

/// Полный обход: только stat() на каждый элемент.
fn scan_local(root: &Path) -> Result<(BTreeMap<String, LocalNode>, String), String> {
    let mut out = BTreeMap::new();
    let root_hash = scan_dir(root, "", &mut out)?;
    Ok((out, root_hash))
}

/// Рекурсивно заполняет `out` детьми `dir` (rel — относительный путь
/// самого dir, '' для корня). Возвращает dir_hash этой папки.
fn scan_dir(dir: &Path, rel: &str, out: &mut BTreeMap<String, LocalNode>) -> Result<String, String> {
    let mut children: Vec<(String, String)> = Vec::new();
    let rd = std::fs::read_dir(dir).map_err(|e| format!("нет доступа к {}: {e}", dir.display()))?;

    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Скрытые/служебные файлы (.DS_Store, .Trashes) не синхронизируем.
        if name.starts_with('.') {
            continue;
        }
        let child_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            let dh = scan_dir(&entry.path(), &child_rel, out)?;
            let eh = folder_hash(&name, &dh);
            children.push((name, eh.clone()));
            out.insert(
                child_rel,
                LocalNode {
                    is_dir: true,
                    entry_hash: eh,
                    dir_hash: dh,
                    ..Default::default()
                },
            );
        } else if meta.is_file() {
            let size = meta.len();
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let eh = file_hash(&name, size, mtime);
            children.push((name, eh.clone()));
            out.insert(
                child_rel,
                LocalNode {
                    is_dir: false,
                    size,
                    mtime,
                    entry_hash: eh,
                    ..Default::default()
                },
            );
        }
    }

    Ok(dir_hash(&children))
}

// ---------- удалённое дерево ----------

#[derive(Deserialize)]
struct RemoteTree {
    root_hash: String,
    #[serde(default)]
    folders: Vec<RemoteFolder>,
    #[serde(default)]
    entries: Vec<RemoteEntry>,
    #[serde(default)]
    deleted: Vec<RemoteDeleted>,
}

#[derive(Deserialize, Clone)]
struct RemoteFolder {
    id: i64,
    #[serde(default)]
    is_system: bool,
    path: String,
    #[serde(default)]
    entry_hash: String,
    #[serde(default)]
    dir_hash: String,
}

#[derive(Deserialize, Clone)]
struct RemoteEntry {
    /// Число для kind=file, uuid-строка для kind=screenshot.
    id: serde_json::Value,
    kind: String,
    #[serde(default)]
    folder_id: Option<i64>,
    name: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    mtime: u64,
    #[serde(default)]
    entry_hash: String,
    #[serde(default)]
    download: String,
}

impl RemoteEntry {
    fn id_string(&self) -> String {
        match &self.id {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            _ => String::new(),
        }
    }
}

#[derive(Deserialize)]
struct RemoteDeleted {
    #[serde(default)]
    entry_hash: String,
}

// ---------- sync.db (SQLite в app_data_dir) ----------

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join("sync.db")).map_err(|e| e.to_string())?;
    // schema_version=1; remote_id TEXT — у скриншотов это uuid,
    // у файлов/папок числовой id (SQLite — динамическая типизация).
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
         CREATE TABLE IF NOT EXISTS entries (
             id INTEGER PRIMARY KEY,
             parent_id INTEGER,
             rel_path TEXT UNIQUE,
             name TEXT,
             is_dir INTEGER,
             size INTEGER,
             mtime INTEGER,
             entry_hash TEXT,
             dir_hash TEXT,
             remote_id TEXT,
             remote_kind TEXT,
             status TEXT,
             last_synced_at INTEGER
         );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[derive(Clone)]
struct PrevEntry {
    is_dir: bool,
    remote_id: String,
    remote_kind: String,
}

fn load_prev(conn: &Connection) -> HashMap<String, PrevEntry> {
    let mut map = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT rel_path, is_dir, remote_id, remote_kind FROM entries")
    {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                PrevEntry {
                    is_dir: r.get::<_, i64>(1).unwrap_or(0) != 0,
                    remote_id: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    remote_kind: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                },
            ))
        }) {
            for row in rows.flatten() {
                map.insert(row.0, row.1);
            }
        }
    }
    map
}

fn meta_set(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    );
}

// ---------- настройки ----------

fn settings(app: &AppHandle) -> Option<(String, String, String)> {
    let store = app.store("settings.json").ok()?;
    let base = store.get("server_url")?.as_str()?.trim_end_matches('/').to_string();
    let token = store.get("api_token")?.as_str()?.to_string();
    let root = store.get("sync_root")?.as_str()?.to_string();
    if base.is_empty() || token.is_empty() || root.is_empty() {
        return None;
    }
    Some((base, token, root))
}

pub fn sync_root(app: &AppHandle) -> Option<String> {
    app.store("settings.json")
        .ok()?
        .get("sync_root")?
        .as_str()
        .map(str::to_owned)
}

// ---------- точки входа ----------

/// Запустить синхронизацию в фоне; false — если уже идёт.
/// folder_id — ветка по событию из веба, None — полный прогон.
pub fn spawn_sync(app: &AppHandle, folder_id: Option<i64>) -> bool {
    if app
        .state::<SyncRunning>()
        .0
        .swap(true, Ordering::SeqCst)
    {
        return false;
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        run_sync(&app2, folder_id).await;
        app2.state::<SyncRunning>().0.store(false, Ordering::SeqCst);
    });
    true
}

/// Скопировать PNG сделанного скриншота в {sync_root}/Скриншоты/{uuid}.{ext}
/// с mtime, присланным сервером — хэши копии и серверной записи совпадут.
pub fn save_screenshot_copy(app: &AppHandle, uuid: &str, png: &[u8], mtime: u64, ext: &str) {
    let Some(root) = sync_root(app) else { return };
    let dir = Path::new(&root).join(SCREENSHOTS_DIR);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log(app, format!("не могу создать папку скриншотов: {e}"));
        return;
    }
    let fname = format!("{uuid}.{ext}");
    match std::fs::write(dir.join(&fname), png) {
        Ok(()) => {
            let _ = filetime::set_file_mtime(
                dir.join(&fname),
                filetime::FileTime::from_unix_time(mtime as i64, 0),
            );
            log(app, format!("копия скриншота → {SCREENSHOTS_DIR}/{fname}"));
        }
        Err(e) => log(app, format!("не удалось сохранить копию скриншота: {e}")),
    }
}

// ---------- основной цикл ----------

async fn run_sync(app: &AppHandle, only_folder_id: Option<i64>) {
    log(app, "── синхронизация: старт ──");

    let Some((base, token, root_str)) = settings(app) else {
        log(app, "синхронизация не настроена (сервер/токен/папка) — пропуск");
        return;
    };
    let root = PathBuf::from(&root_str);
    if let Err(e) = std::fs::create_dir_all(root.join(SCREENSHOTS_DIR)) {
        log(app, format!("нет доступа к папке синхронизации: {e}"));
        return;
    }
    let conn = match open_db(app) {
        Ok(c) => c,
        Err(e) => {
            log(app, format!("sync.db: {e}"));
            return;
        }
    };

    // Локальный обход — только метаданные
    log(app, "сканирую локальную папку…");
    let (local, local_root_hash) = match scan_local(&root) {
        Ok(v) => v,
        Err(e) => {
            log(app, format!("ошибка сканирования: {e}"));
            return;
        }
    };
    log(app, format!("локально: {} элементов, хэш корня {}", local.len(), &local_root_hash[..12]));

    let http = reqwest::Client::new();
    let tree: RemoteTree = match http
        .get(format!("{base}/api/sync/tree"))
        .bearer_auth(&token)
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(t) => t,
            Err(e) => {
                log(app, format!("sync/tree: плохой ответ: {e}"));
                return;
            }
        },
        Err(e) => {
            log(app, format!("sync/tree: {e}"));
            return;
        }
    };
    log(app, format!(
        "на сервере: {} папок, {} файлов, {} tombstones, хэш {}",
        tree.folders.len(),
        tree.entries.len(),
        tree.deleted.len(),
        &tree.root_hash[..12.min(tree.root_hash.len())],
    ));

    // Быстрый путь: корневые хэши равны — глубокий обход не нужен
    if only_folder_id.is_none() && tree.root_hash == local_root_hash {
        log(app, "хэши корня совпадают — деревья идентичны, делать нечего");
        finish(app, &conn, &local_root_hash, &tree.root_hash);
        return;
    }
    log(app, "хэши различаются — сравниваю по веткам…");

    // Удалённая карта: rel_path → узел
    let mut remote_dirs: BTreeMap<String, RemoteFolder> = BTreeMap::new();
    let mut remote_files: BTreeMap<String, RemoteEntry> = BTreeMap::new();
    let mut folder_id_of: HashMap<String, i64> = HashMap::new();
    for f in &tree.folders {
        remote_dirs.insert(f.path.clone(), f.clone());
        folder_id_of.insert(f.path.clone(), f.id);
    }
    for e in &tree.entries {
        let parent_path = e
            .folder_id
            .and_then(|id| tree.folders.iter().find(|f| f.id == id))
            .map(|f| f.path.clone());
        let rel = match &parent_path {
            Some(p) => format!("{p}/{}", e.name),
            None => e.name.clone(),
        };
        remote_files.insert(rel, e.clone());
    }

    let prev = load_prev(&conn);
    let tombstones: HashSet<String> = tree.deleted.iter().map(|d| d.entry_hash.clone()).collect();

    // Ветка для частичного синка (WS-событие «Синхронизировать эту ветку»)
    let prefix: Option<String> = only_folder_id.and_then(|fid| {
        prev.iter()
            .find(|(_, e)| e.is_dir && e.remote_id == fid.to_string())
            .map(|(p, _)| p.clone())
            .or_else(|| {
                tree.folders
                    .iter()
                    .find(|f| f.id == fid)
                    .map(|f| f.path.clone())
            })
    });
    if let Some(fid) = only_folder_id {
        match &prefix {
            Some(p) => log(app, format!("синхронизирую только ветку «{p}» (папка #{fid})")),
            None => log(app, "ветка не найдена ни в snapshot'е, ни на сервере — полный прогон"),
        }
    }
    let under = |rel: &str| -> bool {
        match &prefix {
            None => true,
            Some(p) => rel == p || rel.starts_with(&format!("{p}/")),
        }
    };

    // План действий
    enum Act {
        MkRemoteDir { rel: String, name: String },
        MkLocalDir { rel: String },
        DelRemote { rel: String, id: String, kind: String },
        DelLocal { rel: String, is_dir: bool },
        Download { rel: String, entry: RemoteEntry },
        Upload { rel: String, node: LocalNode },
    }
    let mut plan: Vec<Act> = Vec::new();
    let mut del_remote_dirs: HashSet<String> = HashSet::new(); // уже удаляемые удалённые папки
    let mut del_local_dirs: HashSet<String> = HashSet::new();
    let mut conflicts: HashSet<String> = HashSet::new();
    let mut kept_remote_dirs: HashSet<String> = HashSet::new();

    let has_ancestor = |set: &HashSet<String>, rel: &str| -> bool {
        rel.rmatch_indices('/').any(|(i, _)| set.contains(&rel[..i]))
    };

    // Специальный случай: локально удалённая системная «Скриншоты» —
    // на сервере её удалять нельзя: содержимое уходит в корзину,
    // папка остаётся, локально пересоздаётся пустой.
    if !local.contains_key(SCREENSHOTS_DIR) {
        if let Some(sys) = remote_dirs.get(SCREENSHOTS_DIR).cloned() {
            if sys.is_system && under(SCREENSHOTS_DIR) {
                log(app, "папка «Скриншоты» удалена локально — чищу её на сервере (в корзину)");
                for (rel, e) in &remote_files {
                    if rel.starts_with(&format!("{SCREENSHOTS_DIR}/")) && under(rel) {
                        del_remote_dirs.insert(rel.clone());
                        plan.push(Act::DelRemote {
                            rel: rel.clone(),
                            id: e.id_string(),
                            kind: e.kind.clone(),
                        });
                    }
                }
                // Подпапки внутри «Скриншоты» — обычные папки, удаляются
                for (rel, f) in &remote_dirs {
                    if rel != SCREENSHOTS_DIR
                        && rel.starts_with(&format!("{SCREENSHOTS_DIR}/"))
                        && under(rel)
                    {
                        del_remote_dirs.insert(rel.clone());
                        plan.push(Act::DelRemote {
                            rel: rel.clone(),
                            id: f.id.to_string(),
                            kind: "folder".into(),
                        });
                    }
                }
                plan.push(Act::MkLocalDir {
                    rel: SCREENSHOTS_DIR.to_string(),
                });
            }
        }
    }

    // Локальные узлы: чего нет на сервере
    for (rel, node) in &local {
        if !under(rel) || has_ancestor(&del_local_dirs, rel) {
            continue;
        }
        match remote_files.get(rel).map(|e| (e.entry_hash.clone(), e.clone())) {
            Some((rh, entry)) if rh == node.entry_hash && !node.is_dir => {
                // совпали — ничего
                let _ = entry;
            }
            Some((_, entry)) if !node.is_dir => {
                // оба файла, хэш разный → конфликт: побеждает новый mtime
                conflicts.insert(rel.clone());
                if node.mtime > entry.mtime {
                    log(app, format!("конфликт «{rel}»: локальная новее ({} > {}) — заменяю на сервере", node.mtime, entry.mtime));
                    plan.push(Act::DelRemote {
                        rel: rel.clone(),
                        id: entry.id_string(),
                        kind: entry.kind.clone(),
                    });
                    plan.push(Act::Upload {
                        rel: rel.clone(),
                        node: node.clone(),
                    });
                } else {
                    log(app, format!("конфликт «{rel}»: серверная новее — перезаписываю локальную"));
                    plan.push(Act::DelLocal {
                        rel: rel.clone(),
                        is_dir: false,
                    });
                    plan.push(Act::Download {
                        rel: rel.clone(),
                        entry,
                    });
                }
            }
            _ => {
                if node.is_dir {
                    if remote_dirs.contains_key(rel) {
                        kept_remote_dirs.insert(rel.clone());
                        continue; // папка есть с двух сторон
                    }
                    if remote_files.contains_key(rel) {
                        // тип не совпал: локально папка, на сервере файл — сервер выигрывает
                        conflicts.insert(rel.clone());
                        let e = remote_files.get(rel).unwrap().clone();
                        log(app, format!("конфликт «{rel}»: локально папка, на сервере файл — беру серверную версию"));
                        del_local_dirs.insert(rel.clone());
                        plan.push(Act::DelLocal {
                            rel: rel.clone(),
                            is_dir: true,
                        });
                        plan.push(Act::Download { rel: rel.clone(), entry: e });
                        continue;
                    }
                    // Только локально
                    if prev.contains_key(rel) {
                        del_local_dirs.insert(rel.clone());
                        plan.push(Act::DelLocal {
                            rel: rel.clone(),
                            is_dir: true,
                        });
                    } else if tombstones.contains(&node.entry_hash) {
                        del_local_dirs.insert(rel.clone());
                        log(app, format!("«{rel}» удалена на сервере (tombstone) — удаляю локально"));
                        plan.push(Act::DelLocal {
                            rel: rel.clone(),
                            is_dir: true,
                        });
                    } else {
                        plan.push(Act::MkRemoteDir {
                            rel: rel.clone(),
                            name: rel.rsplit('/').next().unwrap_or(rel).to_string(),
                        });
                    }
                } else if remote_dirs.contains_key(rel) {
                    // локально файл, на сервере папка — сервер выигрывает
                    conflicts.insert(rel.clone());
                    log(app, format!("конфликт «{rel}»: локально файл, на сервере папка — беру серверную версию"));
                    plan.push(Act::DelLocal {
                        rel: rel.clone(),
                        is_dir: false,
                    });
                    plan.push(Act::MkLocalDir { rel: rel.clone() });
                } else {
                    // Только локально
                    if prev.contains_key(rel) {
                        plan.push(Act::DelLocal {
                            rel: rel.clone(),
                            is_dir: false,
                        });
                    } else if tombstones.contains(&node.entry_hash) {
                        log(app, format!("«{rel}» удалён на сервере (tombstone) — удаляю локально"));
                        plan.push(Act::DelLocal {
                            rel: rel.clone(),
                            is_dir: false,
                        });
                    } else {
                        plan.push(Act::Upload {
                            rel: rel.clone(),
                            node: node.clone(),
                        });
                    }
                }
            }
        }
    }

    // Узлы только на сервере
    for (rel, entry) in &remote_files {
        if !under(rel)
            || local.contains_key(rel)
            || del_remote_dirs.contains(rel)
            || has_ancestor(&del_remote_dirs, rel)
        {
            continue;
        }
        if prev.contains_key(rel) {
            plan.push(Act::DelRemote {
                rel: rel.clone(),
                id: entry.id_string(),
                kind: entry.kind.clone(),
            });
        } else {
            plan.push(Act::Download {
                rel: rel.clone(),
                entry: entry.clone(),
            });
        }
    }
    for (rel, folder) in &remote_dirs {
        if !under(rel)
            || local.contains_key(rel)
            || kept_remote_dirs.contains(rel)
            || del_remote_dirs.contains(rel)
            || has_ancestor(&del_remote_dirs, rel)
        {
            continue;
        }
        if folder.is_system {
            continue; // системные папки не трогаем
        }
        if prev.contains_key(rel) {
            del_remote_dirs.insert(rel.clone());
            plan.push(Act::DelRemote {
                rel: rel.clone(),
                id: folder.id.to_string(),
                kind: "folder".into(),
            });
        } else {
            plan.push(Act::MkLocalDir { rel: rel.clone() });
        }
    }

    // Итоговое состояние для snapshot'а entries
    let mut final_state: BTreeMap<String, (bool, String, String, u64, u64, String, String)> = BTreeMap::new();
    for (rel, f) in &remote_dirs {
        if under(rel) && !has_ancestor(&del_remote_dirs, rel) && !del_remote_dirs.contains(rel) {
            final_state.insert(
                rel.clone(),
                (true, f.id.to_string(), "folder".into(), 0, 0, f.entry_hash.clone(), f.dir_hash.clone()),
            );
        }
    }
    for (rel, e) in &remote_files {
        if under(rel) && !has_ancestor(&del_remote_dirs, rel) {
            final_state.insert(
                rel.clone(),
                (false, e.id_string(), e.kind.clone(), e.size, e.mtime, e.entry_hash.clone(), String::new()),
            );
        }
    }
    // Узлы вне ветки частичного синка — сохраняем прежний snapshot
    if prefix.is_some() {
        for (rel, p) in &prev {
            if !under(rel) {
                final_state.insert(
                    rel.clone(),
                    (p.is_dir, p.remote_id.clone(), p.remote_kind.clone(), 0, 0, String::new(), String::new()),
                );
            }
        }
    }

    // ---- выполнение плана ----
    let mut stats = (0usize, 0usize, 0usize, 0usize); // up, down, del_l, del_r

    // 1. Удаления на сервере (в корзину + tombstone — делает сервер)
    for act in &plan {
        if let Act::DelRemote { rel, id, kind } = act {
            let url = match kind.as_str() {
                "screenshot" => format!("{base}/api/screenshots/{id}"),
                "folder" => format!("{base}/api/folders/{id}"),
                _ => format!("{base}/api/files/{id}"),
            };
            log(app, format!("удаляю на сервере: {rel}"));
            match http.delete(&url).bearer_auth(&token).send().await {
                Ok(r) if r.status().is_success() => {
                    stats.3 += 1;
                    final_state.remove(rel);
                }
                Ok(r) => log(app, format!("  удаление «{rel}»: HTTP {}", r.status())),
                Err(e) => log(app, format!("  удаление «{rel}»: {e}")),
            }
        }
    }

    // 2. Локальные удаления (файлы — потом папки глубже-первее)
    let mut local_dels: Vec<&Act> = plan
        .iter()
        .filter(|a| matches!(a, Act::DelLocal { .. }))
        .collect();
    local_dels.sort_by_key(|a| {
        let Act::DelLocal { rel, is_dir } = a else { unreachable!() };
        (*is_dir, std::cmp::Reverse(rel.matches('/').count()))
    });
    for act in local_dels {
        let Act::DelLocal { rel, is_dir } = act else { continue };
        let path = root.join(rel);
        log(app, format!("удаляю локально: {rel}"));
        let res = if *is_dir {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        match res {
            Ok(()) => stats.2 += 1,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log(app, format!("  не удалил «{rel}»: {e}")),
        }
    }

    // 3. Удалённые папки на сервере (создание по глубине — сначала верхние)
    let mut remote_dirs_plan: Vec<&Act> = plan
        .iter()
        .filter(|a| matches!(a, Act::MkRemoteDir { .. }))
        .collect();
    remote_dirs_plan.sort_by_key(|a| {
        let Act::MkRemoteDir { rel, .. } = a else { unreachable!() };
        rel.matches('/').count()
    });
    for act in remote_dirs_plan {
        let Act::MkRemoteDir { rel, name } = act else { continue };
        let parent_rel = rel.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default();
        let parent_id = folder_id_of.get(&parent_rel).copied();
        log(app, format!("создаю папку на сервере: {rel}"));
        match http
            .post(format!("{base}/api/folders"))
            .bearer_auth(&token)
            .json(&serde_json::json!({ "name": name, "parent_id": parent_id }))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {
                let j: serde_json::Value = r.json().await.unwrap_or_default();
                let id = j["data"]["id"].as_i64().or_else(|| j["id"].as_i64()).unwrap_or(0);
                folder_id_of.insert(rel.clone(), id);
                if let Some(ln) = local.get(rel) {
                    final_state.insert(
                        rel.clone(),
                        (true, id.to_string(), "folder".into(), 0, 0, ln.entry_hash.clone(), ln.dir_hash.clone()),
                    );
                }
                stats.0 += 1;
            }
            Ok(r) => log(app, format!("  папка «{rel}»: HTTP {}", r.status())),
            Err(e) => log(app, format!("  папка «{rel}»: {e}")),
        }
    }

    // 4. Локальные папки (серверные новинки)
    for act in &plan {
        if let Act::MkLocalDir { rel } = act {
            let path = root.join(rel);
            if !path.exists() {
                log(app, format!("создаю локальную папку: {rel}"));
                if let Err(e) = std::fs::create_dir_all(&path) {
                    log(app, format!("  не создал «{rel}»: {e}"));
                }
            }
        }
    }

    // 5. Скачивания
    for act in &plan {
        if let Act::Download { rel, entry } = act {
            log(app, format!("скачиваю: {rel} ({})", human_size(entry.size)));
            match download(&http, &base, &token, &root, rel, entry).await {
                Ok(()) => stats.1 += 1,
                Err(e) => {
                    log(app, format!("  скачивание «{rel}»: {e}"));
                    final_state.remove(rel);
                }
            }
        }
    }

    // 6. Загрузки
    for act in &plan {
        if let Act::Upload { rel, node } = act {
            log(app, format!("загружаю: {rel} ({})", human_size(node.size)));
            match upload(app, &http, &base, &token, &root, rel, node, &folder_id_of).await {
                Ok(remote_id) => {
                    stats.0 += 1;
                    let kind = if rel.rsplit_once('/').map(|(p, _)| p) == Some(SCREENSHOTS_DIR)
                        || rel == SCREENSHOTS_DIR
                    {
                        // верхний уровень «Скриншоты» — screenshot либо file
                        remote_kind_guess(&remote_id)
                    } else {
                        remote_kind_guess(&remote_id)
                    };
                    final_state.insert(
                        rel.clone(),
                        (false, remote_id.clone(), kind, node.size, node.mtime, node.entry_hash.clone(), String::new()),
                    );
                }
                Err(e) => log(app, format!("  загрузка «{rel}»: {e}")),
            }
        }
    }

    // Snapshot'ы в sync.db
    if let Err(e) = conn.execute("DELETE FROM entries", []) {
        log(app, format!("sync.db очистка: {e}"));
    }
    let now = now_secs();
    for (rel, (is_dir, remote_id, remote_kind, size, mtime, eh, dh)) in &final_state {
        let status = if conflicts.contains(rel) { "conflict" } else { "synced" };
        let name = rel.rsplit('/').next().unwrap_or(rel);
        let _ = conn.execute(
            "INSERT INTO entries (rel_path, name, is_dir, size, mtime, entry_hash, dir_hash, remote_id, remote_kind, status, last_synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                rel,
                name,
                *is_dir as i64,
                *size as i64,
                *mtime as i64,
                eh,
                dh,
                remote_id,
                remote_kind,
                status,
                now as i64
            ],
        );
    }

    // Финальный локальный хэш → новый remote_root_hash
    let new_root = scan_local(&root).map(|(_, h)| h).unwrap_or_default();
    finish(app, &conn, &new_root, &new_root);
    log(app, format!(
        "── синхронизация завершена: ↑{} ↓{} лок.удал.{} серв.удал.{}, конфликтов {} ──",
        stats.0, stats.1, stats.2, stats.3, conflicts.len()
    ));
}

fn remote_kind_guess(remote_id: &str) -> String {
    // uuid для скриншотов, число — для файлов/папок
    if remote_id.chars().all(|c| c.is_ascii_digit()) {
        "file".into()
    } else {
        "screenshot".into()
    }
}

fn finish(app: &AppHandle, conn: &Connection, local_root: &str, remote_root: &str) {
    meta_set(conn, "remote_root_hash", remote_root);
    meta_set(conn, "local_root_hash", local_root);
    meta_set(conn, "last_sync_at", &now_secs().to_string());
    meta_set(conn, "schema_version", "1");
    if let Some(root) = sync_root(app) {
        meta_set(conn, "sync_root_path", &root);
    }
}

fn human_size(n: u64) -> String {
    if n > 1048576 {
        format!("{:.1} МБ", n as f64 / 1048576.0)
    } else {
        format!("{:.1} КБ", n as f64 / 1024.0)
    }
}

// ---------- скачивание ----------

async fn download(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    root: &Path,
    rel: &str,
    entry: &RemoteEntry,
) -> Result<(), String> {
    let started = Instant::now();
    let url = format!("{base}/{}", entry.download.trim_start_matches('/'));
    let resp = http
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    // mtime — серверный, чтобы локальный и серверный хэши совпали
    let _ = filetime::set_file_mtime(
        &path,
        filetime::FileTime::from_unix_time(entry.mtime as i64, 0),
    );
    let _ = started;
    Ok(())
}

// ---------- загрузка ----------

async fn upload(
    app: &AppHandle,
    http: &reqwest::Client,
    base: &str,
    token: &str,
    root: &Path,
    rel: &str,
    node: &LocalNode,
    folder_id_of: &HashMap<String, i64>,
) -> Result<String, String> {
    let path = root.join(rel);
    let name = rel.rsplit('/').next().unwrap_or(rel).to_string();
    let parent_rel = rel.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default();
    let mime = mime_guess::from_path(&name)
        .first_or_octet_stream()
        .to_string();

    // Файлы верхнего уровня «Скриншоты» мапятся на таблицу screenshots —
    // но только если это картинки (сервер валидирует image/*).
    if parent_rel == SCREENSHOTS_DIR && mime.starts_with("image/") {
        return upload_screenshot(app, http, base, token, &path, &name, node, &mime).await;
    }

    let folder_id = folder_id_of.get(&parent_rel).copied();

    if node.size > CHUNK_THRESHOLD {
        upload_chunked(app, http, base, token, &path, rel, &name, node, folder_id).await
    } else {
        upload_simple(http, base, token, &path, &name, node, folder_id, &mime).await
    }
}

async fn upload_simple(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    path: &Path,
    name: &str,
    node: &LocalNode,
    folder_id: Option<i64>,
    mime: &str,
) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(name.to_string())
        .mime_str(mime)
        .map_err(|e| e.to_string())?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("mtime", node.mtime.to_string());
    if let Some(fid) = folder_id {
        form = form.text("folder_id", fid.to_string());
    }
    let resp = http
        .post(format!("{base}/api/files"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let j: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(j["data"]["id"]
        .as_i64()
        .map(|v| v.to_string())
        .or_else(|| j["id"].as_i64().map(|v| v.to_string()))
        .unwrap_or_default())
}

async fn upload_screenshot(
    app: &AppHandle,
    http: &reqwest::Client,
    base: &str,
    token: &str,
    path: &Path,
    name: &str,
    node: &LocalNode,
    mime: &str,
) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(name.to_string())
        .mime_str(mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("image", part)
        .text("mtime", node.mtime.to_string());
    let resp = http
        .post(format!("{base}/api/screenshots"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let j: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let id = j["data"]["id"].as_str().unwrap_or_default().to_string();
    if id.is_empty() {
        log(app, "сервер не вернул id скриншота".to_string());
    }
    Ok(id)
}

/// Большие файлы — чанками через экшен files.uploadChunk
/// (тот же путь, что и веб: /api/action с multipart-формой).
async fn upload_chunked(
    app: &AppHandle,
    http: &reqwest::Client,
    base: &str,
    token: &str,
    path: &Path,
    rel: &str,
    name: &str,
    node: &LocalNode,
    folder_id: Option<i64>,
) -> Result<String, String> {
    let upload_id = format!("{:016x}", now_secs() ^ (node.size << 7) ^ rand_u64());
    let total = node.size.div_ceil(CHUNK_SIZE as u64) as usize;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let started = Instant::now();

    let mut last: serde_json::Value = serde_json::Value::Null;
    for i in 0..total {
        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut filled = 0usize;
        while filled < buf.len() {
            use std::io::Read;
            match file.read(&mut buf[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) => return Err(e.to_string()),
            }
        }
        buf.truncate(filled);

        let part = reqwest::multipart::Part::bytes(buf)
            .file_name(name.to_string());
        let mut form = reqwest::multipart::Form::new()
            .text("action", "files.uploadChunk")
            .text("upload_id", upload_id.clone())
            .text("index", i.to_string())
            .text("total", total.to_string())
            .text("name", name.to_string())
            .text("mtime", node.mtime.to_string())
            .part("file", part);
        if let Some(fid) = folder_id {
            form = form.text("folder_id", fid.to_string());
        }

        let resp = http
            .post(format!("{base}/api/action"))
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("чанк {i}: HTTP {}", resp.status()));
        }
        last = resp.json().await.map_err(|e| e.to_string())?;

        let done = ((i + 1) * CHUNK_SIZE).min(node.size as usize) as u64;
        let pct = if node.size > 0 { done * 100 / node.size } else { 100 };
        let secs = started.elapsed().as_secs_f64().max(0.01);
        let speed = done as f64 / secs;
        log(
            app,
            format!("  {rel}: {pct}% · {}", human_size(speed as u64) + "/с"),
        );
    }

    // id финальной записи из ответа последнего чанка
    for ptr in ["/result/data/id", "/result/original/data/id", "/data/id"] {
        if let Some(v) = last.pointer(ptr) {
            if let Some(id) = v.as_i64() {
                return Ok(id.to_string());
            }
        }
    }
    Ok(String::new())
}

fn rand_u64() -> u64 {
    use std::time::SystemTime;
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    t ^ (std::process::id() as u64).wrapping_mul(0x9E3779B97F4A7C15)
}

// ---------- Tauri-команды ----------

#[tauri::command]
pub async fn sync_now(app: AppHandle) -> Result<bool, String> {
    Ok(spawn_sync(&app, None))
}

#[tauri::command]
pub fn sync_log_tail(state: tauri::State<'_, LogBuf>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|g| g.iter().cloned().collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_sync_folder(app: AppHandle) -> Option<String> {
    sync_root(&app)
}

#[tauri::command]
pub fn set_sync_folder(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("Нужен абсолютный путь к папке".into());
    }
    std::fs::create_dir_all(&p).map_err(|e| format!("Не могу создать папку: {e}"))?;
    // Проверка права записи (важно для macOS-доступа к выбранной папке)
    let probe = p.join(".screenshoter-probe");
    std::fs::write(&probe, b"")
        .map_err(|e| format!("Нет права записи в папку (проверьте доступ на macOS): {e}"))?;
    let _ = std::fs::remove_file(&probe);
    std::fs::create_dir_all(p.join(SCREENSHOTS_DIR))
        .map_err(|e| format!("Не могу создать «{SCREENSHOTS_DIR}»: {e}"))?;

    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("sync_root", serde_json::Value::String(path.clone()));
    store.save().map_err(|e| e.to_string())?;
    log(&app, format!("папка синхронизации: {path}"));
    Ok(())
}

#[tauri::command]
pub fn os_name() -> &'static str {
    std::env::consts::OS
}

/// Открыть нужную панель Системных настроек (macOS) — для выдачи
/// разрешений «Запись экрана» / доступ к файлам.
#[tauri::command]
pub fn open_privacy_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn();
    }
}

// ---------- тест-векторы (паритет с PHP SyncHash) ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_hash_vectors() {
        assert_eq!(
            file_hash("report.pdf", 1024, 1700000000),
            "d5970fd615ddfbfc37772b2936665c3a63be9fb9bcb6688c3ab32d966faf788b"
        );
        assert_eq!(
            file_hash("a.txt", 3, 100),
            "7245b614dc489c4c0375a9fe387e16547b112aa396af2446d7eed6542759eb4a"
        );
    }

    #[test]
    fn dir_hash_vectors() {
        let children = vec![
            ("a.txt".to_string(), file_hash("a.txt", 3, 100)),
            ("b.txt".to_string(), file_hash("b.txt", 5, 200)),
        ];
        assert_eq!(
            dir_hash(&children),
            "00e05b725df4692b3b3a05295705b75f0be733c1e0be4cb6f8effd873c57c27a"
        );
        assert_eq!(
            folder_hash(
                "docs",
                "00e05b725df4692b3b3a05295705b75f0be733c1e0be4cb6f8effd873c57c27a"
            ),
            "1eddd49fd5a400bc30ebbb39c501bebdca9692b9114b5cc18e7ac9343f0bbcad"
        );
        assert_eq!(
            dir_hash(&[]),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}
