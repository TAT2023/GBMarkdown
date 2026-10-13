#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::Engine as _;
use gbm_core::{DocumentInfo, Engine, RenderWindow, SearchMatch, SearchStatus};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};

struct AppState {
    engine: Arc<Engine>,
    settings: PathBuf,
    operations: Arc<Mutex<()>>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    recent: Vec<Recent>,
    theme: String,
    sidebar: bool,
    font_size: u32,
    width: f64,
    height: f64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Recent {
    path: String,
    name: String,
    size: u64,
    offset: u64,
    opened_at: u64,
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
async fn open_document(path: String, state: State<'_, AppState>) -> Result<DocumentInfo, String> {
    let engine = state.engine.clone();
    let op = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op.lock().unwrap();
        engine.open(&PathBuf::from(path)).map_err(error)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
async fn get_render_window(
    document_id: String,
    byte_offset: u64,
    max_bytes: usize,
    request_version: u64,
    state: State<'_, AppState>,
) -> Result<RenderWindow, String> {
    let doc = state.engine.get(&document_id).map_err(error)?;
    tauri::async_runtime::spawn_blocking(move || {
        doc.render_window(byte_offset, max_bytes, request_version)
            .map_err(error)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
async fn jump_to_offset(
    document_id: String,
    byte_offset: u64,
    request_version: u64,
    state: State<'_, AppState>,
) -> Result<RenderWindow, String> {
    get_render_window(document_id, byte_offset, 128 * 1024, request_version, state).await
}
#[tauri::command]
async fn get_outline(
    document_id: String,
    start: u64,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let doc = state.engine.get(&document_id).map_err(error)?;
    tauri::async_runtime::spawn_blocking(move || {
        serde_json::to_value(doc.outline(start, limit).map_err(error)?).map_err(error)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
fn get_index_status(
    document_id: String,
    byte_offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let doc = state.engine.get(&document_id).map_err(error)?;
    Ok(
        serde_json::json!({"index":doc.status(),"changed":doc.changed(),"outlinePosition":doc.index.heading_position(byte_offset.unwrap_or(0)).map_err(error)?}),
    )
}
#[tauri::command]
async fn start_search(
    document_id: String,
    query: String,
    case_sensitive: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let doc = state.engine.get(&document_id).map_err(error)?;
    tauri::async_runtime::spawn_blocking(move || {
        doc.start_search(query, case_sensitive).map_err(error)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
fn get_search_results(
    document_id: String,
    search_id: String,
    start: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<(SearchStatus, Vec<SearchMatch>), String> {
    state
        .engine
        .get(&document_id)
        .map_err(error)?
        .search_results(&search_id, start, limit)
        .map_err(error)
}
#[tauri::command]
fn cancel_search(
    document_id: String,
    search_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .engine
        .get(&document_id)
        .map_err(error)?
        .cancel_search(search_id.as_deref());
    Ok(())
}
#[tauri::command]
async fn close_document(document_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let engine = state.engine.clone();
    let op = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op.lock().unwrap();
        engine.close(&document_id);
    })
    .await
    .map_err(error)
}
#[tauri::command]
async fn get_local_image(
    document_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let doc = state.engine.get(&document_id).map_err(error)?;
    tauri::async_runtime::spawn_blocking(move||{
        let image=doc.image(&path).map_err(error)?;let ext=PathBuf::from(&path).extension().unwrap_or_default().to_string_lossy().to_ascii_lowercase();
        let mime=match ext.as_str(){"jpg"|"jpeg"=>"image/jpeg","webp"=>"image/webp","gif"=>"image/gif","bmp"=>"image/bmp","avif"=>"image/avif",_=>"image/png"};
        Ok(serde_json::json!({"url":format!("data:{};base64,{}",mime,base64::engine::general_purpose::STANDARD.encode(image.bytes)),"width":image.width,"height":image.height}))
    }).await.map_err(error)?
}
#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> serde_json::Value {
    std::fs::read(&state.settings).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_else(||serde_json::json!({"recent":[],"theme":"light","sidebar":true,"fontSize":16,"width":1280,"height":860}))
}
#[tauri::command]
fn save_settings(settings: Settings, state: State<'_, AppState>) -> Result<(), String> {
    if settings.recent.len() > 20 {
        return Err("Recent history limit exceeded".into());
    }
    let tmp = state.settings.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec(&settings).map_err(error)?).map_err(error)?;
    std::fs::rename(tmp, &state.settings).map_err(error)
}
#[tauri::command]
fn get_launch_path() -> Option<String> {
    std::env::args().skip(1).find(|s| !s.starts_with('-'))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&root)?;
            app.manage(AppState {
                engine: Arc::new(Engine::new(root.join("cache").join("index"))?),
                settings: root.join("settings.json"),
                operations: Arc::new(Mutex::new(())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            get_render_window,
            jump_to_offset,
            get_outline,
            get_index_status,
            start_search,
            get_search_results,
            cancel_search,
            close_document,
            get_local_image,
            get_settings,
            save_settings,
            get_launch_path
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start GBMarkdown");
}
