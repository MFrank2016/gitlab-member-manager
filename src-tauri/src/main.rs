mod db;
mod gitlab;
mod models;

use tauri::Manager;

use crate::gitlab::GitLabConfig;
use crate::models::{
  BatchItemError, BatchResult, LocalGroup, LocalMember, LocalMemberUpsert, ProjectMember,
  ProjectSummary,
};
use sqlx::SqlitePool;
use std::sync::Mutex;
use tauri::State;

struct AppState {
  db: SqlitePool,
  gitlab: Mutex<Option<GitLabConfig>>,
}

fn require_cfg(state: &AppState) -> Result<GitLabConfig, String> {
  state
    .gitlab
    .lock()
    .map_err(|_| "Mutex poisoned".to_string())?
    .clone()
    .ok_or_else(|| "GitLab config not set. Please go to 设置页保存 Base URL 和 Token".to_string())
}

#[tauri::command]
async fn set_gitlab_config(state: State<'_, AppState>, base_url: String, token: String) -> Result<(), String> {
  let mut guard = state
    .gitlab
    .lock()
    .map_err(|_| "Mutex poisoned".to_string())?;

  if base_url.trim().is_empty() {
    return Err("baseUrl is empty".to_string());
  }
  if token.trim().is_empty() {
    return Err("token is empty".to_string());
  }

  *guard = Some(GitLabConfig {
    base_url: base_url.trim().to_string(),
    token: token.trim().to_string(),
  });
  Ok(())
}

#[tauri::command]
async fn search_projects(state: State<'_, AppState>, keyword: String) -> Result<Vec<ProjectSummary>, String> {
  let cfg = require_cfg(&state)?;
  gitlab::search_projects(&cfg, keyword.trim())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_project_members(state: State<'_, AppState>, project: String) -> Result<Vec<ProjectMember>, String> {
  let cfg = require_cfg(&state)?;
  gitlab::list_project_members(&cfg, project.trim())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn upsert_local_members(state: State<'_, AppState>, members: Vec<LocalMemberUpsert>) -> Result<(), String> {
  db::upsert_local_members(&state.db, members)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_local_members(state: State<'_, AppState>, query: Option<String>) -> Result<Vec<LocalMember>, String> {
  db::list_local_members(&state.db, query)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_local_group(state: State<'_, AppState>, name: String) -> Result<LocalGroup, String> {
  db::create_local_group(&state.db, name)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_local_groups(state: State<'_, AppState>) -> Result<Vec<LocalGroup>, String> {
  db::list_local_groups(&state.db)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_members_to_group(state: State<'_, AppState>, group_id: i64, user_ids: Vec<u64>) -> Result<(), String> {
  db::add_members_to_group(&state.db, group_id, user_ids)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_members_from_group(state: State<'_, AppState>, group_id: i64, user_ids: Vec<u64>) -> Result<(), String> {
  db::remove_members_from_group(&state.db, group_id, user_ids)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_group_members(state: State<'_, AppState>, group_id: i64) -> Result<Vec<LocalMember>, String> {
  db::list_group_members(&state.db, group_id)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn batch_add_members_to_project(
  state: State<'_, AppState>,
  project: String,
  user_ids: Vec<u64>,
  access_level: i64,
  expires_at: Option<String>,
) -> Result<BatchResult, String> {
  let cfg = require_cfg(&state)?;

  let mut ok = Vec::new();
  let mut failed = Vec::new();

  for uid in user_ids {
    match gitlab::add_member(&cfg, &project, uid, access_level, expires_at.clone()).await {
      Ok(_) => ok.push(uid),
      Err(e) => failed.push(BatchItemError {
        user_id: uid,
        message: e.to_string(),
      }),
    }
  }

  Ok(BatchResult {
    success_user_ids: ok,
    failed,
  })
}

#[tauri::command]
async fn batch_remove_members_from_project(
  state: State<'_, AppState>,
  project: String,
  user_ids: Vec<u64>,
) -> Result<BatchResult, String> {
  let cfg = require_cfg(&state)?;

  let mut ok = Vec::new();
  let mut failed = Vec::new();

  for uid in user_ids {
    match gitlab::remove_member(&cfg, &project, uid).await {
      Ok(_) => ok.push(uid),
      Err(e) => failed.push(BatchItemError {
        user_id: uid,
        message: e.to_string(),
      }),
    }
  }

  Ok(BatchResult {
    success_user_ids: ok,
    failed,
  })
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let db = tauri::async_runtime::block_on(db::init_db(&app.handle()))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;

      app.manage(AppState {
        db,
        gitlab: Mutex::new(None),
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      set_gitlab_config,
      search_projects,
      list_project_members,
      upsert_local_members,
      list_local_members,
      create_local_group,
      list_local_groups,
      add_members_to_group,
      remove_members_from_group,
      list_group_members,
      batch_add_members_to_project,
      batch_remove_members_from_project,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
