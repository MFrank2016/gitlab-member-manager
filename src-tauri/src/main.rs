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
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

struct AppState {
  db: SqlitePool,
  gitlab: Mutex<Option<GitLabConfig>>,
}

/// 初始化日志系统
/// - 滚动日志：按天滚动，保留 7 天
/// - 文件大小：最大 20MB（通过按天滚动间接控制）
/// - 同时输出到控制台和文件
fn init_logging(app_handle: &tauri::AppHandle) -> anyhow::Result<tracing_appender::non_blocking::WorkerGuard> {
  let log_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| anyhow::anyhow!("failed to get app_data_dir: {}", e))?
    .join("logs");

  std::fs::create_dir_all(&log_dir)?;

  // 按天滚动，文件名前缀为 "app"，生成如 app.2026-01-19.log
  let file_appender = RollingFileAppender::builder()
    .rotation(Rotation::DAILY)
    .filename_prefix("app")
    .filename_suffix("log")
    .max_log_files(7) // 保留 7 天
    .build(&log_dir)?;

  let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

  // 设置日志格式和过滤器
  let env_filter = EnvFilter::try_from_default_env()
    .unwrap_or_else(|_| EnvFilter::new("info,gitlab_member_manager=debug"));

  tracing_subscriber::registry()
    .with(env_filter)
    .with(
      fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
    )
    .with(
      fmt::layer()
        .with_target(true)
        .with_ansi(false)
        .with_writer(non_blocking)
    )
    .init();

  tracing::info!(log_dir = %log_dir.display(), "Logging initialized");
  Ok(guard)
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
  tracing::info!(base_url = %base_url, token_len = token.len(), "set_gitlab_config called");
  
  let mut guard = state
    .gitlab
    .lock()
    .map_err(|_| "Mutex poisoned".to_string())?;

  if base_url.trim().is_empty() {
    tracing::warn!("set_gitlab_config failed: baseUrl is empty");
    return Err("baseUrl is empty".to_string());
  }
  if token.trim().is_empty() {
    tracing::warn!("set_gitlab_config failed: token is empty");
    return Err("token is empty".to_string());
  }

  *guard = Some(GitLabConfig {
    base_url: base_url.trim().to_string(),
    token: token.trim().to_string(),
  });
  
  tracing::info!("set_gitlab_config success");
  Ok(())
}

#[tauri::command]
async fn search_projects(state: State<'_, AppState>, keyword: String) -> Result<Vec<ProjectSummary>, String> {
  tracing::info!(keyword = %keyword, "search_projects called");
  
  let cfg = require_cfg(&state)?;
  let result = gitlab::search_projects(&cfg, keyword.trim())
    .await
    .map_err(|e| e.to_string());
  
  match &result {
    Ok(projects) => tracing::info!(count = projects.len(), "search_projects success"),
    Err(e) => tracing::error!(error = %e, "search_projects failed"),
  }
  result
}

#[tauri::command]
async fn list_project_members(state: State<'_, AppState>, project: String) -> Result<Vec<ProjectMember>, String> {
  tracing::info!(project = %project, "list_project_members called");
  
  let cfg = require_cfg(&state)?;
  let result = gitlab::list_project_members(&cfg, project.trim())
    .await
    .map_err(|e| e.to_string());
  
  match &result {
    Ok(members) => tracing::info!(count = members.len(), "list_project_members success"),
    Err(e) => tracing::error!(error = %e, "list_project_members failed"),
  }
  result
}

#[tauri::command]
async fn upsert_local_members(state: State<'_, AppState>, members: Vec<LocalMemberUpsert>) -> Result<(), String> {
  tracing::info!(count = members.len(), "upsert_local_members called");
  
  let result = db::upsert_local_members(&state.db, members)
    .await
    .map_err(|e| e.to_string());
  
  match &result {
    Ok(_) => tracing::info!("upsert_local_members success"),
    Err(e) => tracing::error!(error = %e, "upsert_local_members failed"),
  }
  result
}

#[tauri::command]
async fn list_local_members(state: State<'_, AppState>, query: Option<String>) -> Result<Vec<LocalMember>, String> {
  tracing::info!(query = ?query, "list_local_members called");
  
  let result = db::list_local_members(&state.db, query)
    .await
    .map_err(|e| e.to_string());
  
  match &result {
    Ok(members) => tracing::info!(count = members.len(), "list_local_members success"),
    Err(e) => tracing::error!(error = %e, "list_local_members failed"),
  }
  result
}

#[tauri::command]
async fn create_local_group(state: State<'_, AppState>, name: String) -> Result<LocalGroup, String> {
  tracing::info!(name = %name, "create_local_group called");
  
  let result = db::create_local_group(&state.db, name)
    .await
    .map_err(|e| e.to_string());
  
  match &result {
    Ok(group) => tracing::info!(group_id = group.id, "create_local_group success"),
    Err(e) => tracing::error!(error = %e, "create_local_group failed"),
  }
  result
}

#[tauri::command]
async fn list_local_groups(state: State<'_, AppState>) -> Result<Vec<LocalGroup>, String> {
  tracing::info!("list_local_groups called");
  
  let result = db::list_local_groups(&state.db)
    .await
    .map_err(|e| e.to_string());
  
  match &result {
    Ok(groups) => tracing::info!(count = groups.len(), "list_local_groups success"),
    Err(e) => tracing::error!(error = %e, "list_local_groups failed"),
  }
  result
}

#[tauri::command]
async fn add_members_to_group(state: State<'_, AppState>, group_id: i64, user_ids: Vec<u64>) -> Result<(), String> {
  tracing::info!(group_id = group_id, user_count = user_ids.len(), "add_members_to_group called");
  
  let result = db::add_members_to_group(&state.db, group_id, user_ids)
    .await
    .map_err(|e| e.to_string());
  
  match &result {
    Ok(_) => tracing::info!(group_id = group_id, "add_members_to_group success"),
    Err(e) => tracing::error!(error = %e, "add_members_to_group failed"),
  }
  result
}

#[tauri::command]
async fn remove_members_from_group(state: State<'_, AppState>, group_id: i64, user_ids: Vec<u64>) -> Result<(), String> {
  tracing::info!(group_id = group_id, user_count = user_ids.len(), "remove_members_from_group called");
  
  let result = db::remove_members_from_group(&state.db, group_id, user_ids)
    .await
    .map_err(|e| e.to_string());
  
  match &result {
    Ok(_) => tracing::info!(group_id = group_id, "remove_members_from_group success"),
    Err(e) => tracing::error!(error = %e, "remove_members_from_group failed"),
  }
  result
}

#[tauri::command]
async fn list_group_members(state: State<'_, AppState>, group_id: i64) -> Result<Vec<LocalMember>, String> {
  tracing::info!(group_id = group_id, "list_group_members called");
  
  let result = db::list_group_members(&state.db, group_id)
    .await
    .map_err(|e| e.to_string());
  
  match &result {
    Ok(members) => tracing::info!(count = members.len(), "list_group_members success"),
    Err(e) => tracing::error!(error = %e, "list_group_members failed"),
  }
  result
}

#[tauri::command]
async fn batch_add_members_to_project(
  state: State<'_, AppState>,
  project: String,
  user_ids: Vec<u64>,
  access_level: i64,
  expires_at: Option<String>,
) -> Result<BatchResult, String> {
  tracing::info!(
    project = %project,
    user_count = user_ids.len(),
    access_level = access_level,
    expires_at = ?expires_at,
    "batch_add_members_to_project called"
  );
  
  let cfg = require_cfg(&state)?;

  let mut ok = Vec::new();
  let mut failed = Vec::new();

  for uid in &user_ids {
    match gitlab::add_member(&cfg, &project, *uid, access_level, expires_at.clone()).await {
      Ok(_) => {
        tracing::debug!(user_id = uid, "add member success");
        ok.push(*uid);
      }
      Err(e) => {
        tracing::warn!(user_id = uid, error = %e, "add member failed");
        failed.push(BatchItemError {
          user_id: *uid,
          message: e.to_string(),
        });
      }
    }
  }

  tracing::info!(
    success_count = ok.len(),
    failed_count = failed.len(),
    "batch_add_members_to_project completed"
  );
  
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
  tracing::info!(
    project = %project,
    user_count = user_ids.len(),
    "batch_remove_members_from_project called"
  );
  
  let cfg = require_cfg(&state)?;

  let mut ok = Vec::new();
  let mut failed = Vec::new();

  for uid in &user_ids {
    match gitlab::remove_member(&cfg, &project, *uid).await {
      Ok(_) => {
        tracing::debug!(user_id = uid, "remove member success");
        ok.push(*uid);
      }
      Err(e) => {
        tracing::warn!(user_id = uid, error = %e, "remove member failed");
        failed.push(BatchItemError {
          user_id: *uid,
          message: e.to_string(),
        });
      }
    }
  }

  tracing::info!(
    success_count = ok.len(),
    failed_count = failed.len(),
    "batch_remove_members_from_project completed"
  );
  
  Ok(BatchResult {
    success_user_ids: ok,
    failed,
  })
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      // 初始化日志系统
      let _guard = init_logging(&app.handle())
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
      
      // 保持 guard 存活，确保日志能正确刷新
      // 将其存储在 app state 中或泄漏它（在应用生命周期内可接受）
      Box::leak(Box::new(_guard));
      
      tracing::info!("Application starting...");
      
      let db = tauri::async_runtime::block_on(db::init_db(&app.handle()))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;

      app.manage(AppState {
        db,
        gitlab: Mutex::new(None),
      });

      tracing::info!("Application initialized successfully");
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
