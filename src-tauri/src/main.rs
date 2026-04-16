mod db;
mod failure_envelope;
mod git_executor;
mod gitlab;
mod gitlab_executor;
mod models;
mod pipeline_runtime;
mod runtime_support;
mod scheduler;
mod workflow_runtime_legacy;
mod workflows;

use tauri::Manager;

use crate::gitlab::GitLabConfig;
use crate::models::{
    AppSettings, BatchItemError, BatchResult, LocalGroup, LocalMember, LocalMemberUpsert,
    ManagedProject, PipelineDefinitionDetail, PipelineDefinitionListItem, PipelineNodeInput,
    PipelineRunDetail, PipelineRunExecuteRequest, PipelineRunExecuteResult, PipelineRunListItem,
    PipelineRunRetryRequest, PipelineScheduleInput, PipelineVariableInput, ProjectGroup,
    ProjectGroupMemberSyncRow, ProjectMember, ProjectSummary, WorkflowDefinitionDetail,
    WorkflowDefinitionListItem, WorkflowRunDetail, WorkflowRunExecuteRequest,
    WorkflowRunExecuteResult, WorkflowRunListItem, WorkflowRunRetryFailedRequest,
    WorkflowStepInput,
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

fn init_logging(
    app_handle: &tauri::AppHandle,
) -> anyhow::Result<tracing_appender::non_blocking::WorkerGuard> {
    let log_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("failed to get app_data_dir: {}", e))?
        .join("logs");

    std::fs::create_dir_all(&log_dir)?;

    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("app")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&log_dir)?;

    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // 璁剧疆鏃ュ織鏍煎紡鍜岃繃婊ゅ櫒
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,gitlab_member_manager=debug"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(
            fmt::layer()
                .with_target(true)
                .with_thread_ids(false)
                .with_file(false)
                .with_line_number(false),
        )
        .with(
            fmt::layer()
                .with_target(true)
                .with_ansi(false)
                .with_writer(non_blocking),
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
        .ok_or_else(|| {
            "GitLab config not set. Please configure Base URL and Token in Settings.".to_string()
        })
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[tauri::command]
async fn get_gitlab_config(state: State<'_, AppState>) -> Result<Option<AppSettings>, String> {
    let cfg = db::get_gitlab_config(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
async fn set_gitlab_config(
    state: State<'_, AppState>,
    base_url: String,
    token: String,
    local_repo_root: Option<String>,
    default_branch: Option<String>,
    default_remote: Option<String>,
) -> Result<(), String> {
    tracing::info!(
        base_url = %base_url,
        token_len = token.len(),
        local_repo_root = ?local_repo_root,
        default_branch = ?default_branch,
        default_remote = ?default_remote,
        "set_gitlab_config called"
    );

    if base_url.trim().is_empty() {
        tracing::warn!("set_gitlab_config failed: baseUrl is empty");
        return Err("baseUrl is empty".to_string());
    }
    if token.trim().is_empty() {
        tracing::warn!("set_gitlab_config failed: token is empty");
        return Err("token is empty".to_string());
    }

    let base = base_url.trim().to_string();
    let tok = token.trim().to_string();
    let local_repo_root = normalize_optional_text(local_repo_root);
    let default_branch = normalize_optional_text(default_branch);
    let default_remote = normalize_optional_text(default_remote);

    db::set_gitlab_config(
        &state.db,
        &base,
        &tok,
        local_repo_root.as_deref(),
        default_branch.as_deref(),
        default_remote.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut guard = state
        .gitlab
        .lock()
        .map_err(|_| "Mutex poisoned".to_string())?;
    *guard = Some(GitLabConfig {
        base_url: base,
        token: tok,
    });

    tracing::info!("set_gitlab_config success");
    Ok(())
}

#[tauri::command]
async fn search_projects(
    state: State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<(Vec<ProjectSummary>, u64), String> {
    let page = page.unwrap_or(1).max(1);
    let per_page = per_page.unwrap_or(20).clamp(1, 100);
    tracing::info!(keyword = %keyword, page = page, per_page = per_page, "search_projects called");

    let cfg = require_cfg(&state)?;
    let result = gitlab::search_projects(&cfg, keyword.trim(), page, per_page)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok((items, total)) => tracing::info!(
            count = items.len(),
            total = total,
            "search_projects success"
        ),
        Err(e) => tracing::error!(error = %e, "search_projects failed"),
    }
    result
}

#[tauri::command]
async fn list_project_members(
    state: State<'_, AppState>,
    project: String,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<(Vec<ProjectMember>, u64), String> {
    let page = page.unwrap_or(1).max(1);
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    tracing::info!(project = %project, page = page, per_page = per_page, "list_project_members called");

    let cfg = require_cfg(&state)?;
    let result = gitlab::list_project_members(&cfg, project.trim(), page, per_page)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok((members, total)) => tracing::info!(
            count = members.len(),
            total = total,
            "list_project_members success"
        ),
        Err(e) => tracing::error!(error = %e, "list_project_members failed"),
    }
    result
}

#[tauri::command]
async fn create_managed_project(
    state: State<'_, AppState>,
    gitlab_project_id: u64,
    name: String,
    path_with_namespace: String,
    repo_path: String,
    default_branch: Option<String>,
    default_remote: Option<String>,
    enabled: Option<bool>,
) -> Result<ManagedProject, String> {
    let normalized_default_branch = normalize_optional_text(default_branch);
    let normalized_default_remote = normalize_optional_text(default_remote);

    let result = db::create_managed_project(
        &state.db,
        gitlab_project_id,
        name.trim().to_string(),
        path_with_namespace.trim().to_string(),
        repo_path.trim().to_string(),
        normalized_default_branch,
        normalized_default_remote,
        enabled.unwrap_or(true),
    )
    .await
    .map_err(|e| e.to_string());

    match &result {
        Ok(project) => tracing::info!(
            id = project.id,
            gitlab_project_id = project.gitlab_project_id,
            "create_managed_project success"
        ),
        Err(e) => tracing::error!(error = %e, "create_managed_project failed"),
    }

    result
}

#[tauri::command]
async fn list_managed_projects(state: State<'_, AppState>) -> Result<Vec<ManagedProject>, String> {
    let result = db::list_managed_projects(&state.db)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(items) => tracing::info!(count = items.len(), "list_managed_projects success"),
        Err(e) => tracing::error!(error = %e, "list_managed_projects failed"),
    }

    result
}

#[tauri::command]
async fn update_managed_project(
    state: State<'_, AppState>,
    id: i64,
    gitlab_project_id: u64,
    name: String,
    path_with_namespace: String,
    repo_path: String,
    default_branch: String,
    default_remote: String,
    enabled: bool,
) -> Result<(), String> {
    let result = db::update_managed_project(
        &state.db,
        id,
        gitlab_project_id,
        name.trim().to_string(),
        path_with_namespace.trim().to_string(),
        repo_path.trim().to_string(),
        default_branch.trim().to_string(),
        default_remote.trim().to_string(),
        enabled,
    )
    .await
    .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "update_managed_project success"),
        Err(e) => tracing::error!(id = id, error = %e, "update_managed_project failed"),
    }

    result
}

#[tauri::command]
async fn delete_managed_project(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let result = db::delete_managed_project(&state.db, id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "delete_managed_project success"),
        Err(e) => tracing::error!(id = id, error = %e, "delete_managed_project failed"),
    }

    result
}

#[tauri::command]
async fn create_project_group(
    state: State<'_, AppState>,
    name: String,
) -> Result<ProjectGroup, String> {
    let result = db::create_project_group(&state.db, name.trim().to_string())
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(group) => tracing::info!(id = group.id, "create_project_group success"),
        Err(e) => tracing::error!(error = %e, "create_project_group failed"),
    }

    result
}

#[tauri::command]
async fn list_project_groups(state: State<'_, AppState>) -> Result<Vec<ProjectGroup>, String> {
    let result = db::list_project_groups(&state.db)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(groups) => tracing::info!(count = groups.len(), "list_project_groups success"),
        Err(e) => tracing::error!(error = %e, "list_project_groups failed"),
    }

    result
}

#[tauri::command]
async fn update_project_group(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    let result = db::update_project_group(&state.db, id, name.trim().to_string())
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "update_project_group success"),
        Err(e) => tracing::error!(id = id, error = %e, "update_project_group failed"),
    }

    result
}

#[tauri::command]
async fn delete_project_group(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let result = db::delete_project_group(&state.db, id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "delete_project_group success"),
        Err(e) => tracing::error!(id = id, error = %e, "delete_project_group failed"),
    }

    result
}

#[tauri::command]
async fn add_projects_to_group(
    state: State<'_, AppState>,
    project_group_id: i64,
    managed_project_ids: Vec<i64>,
) -> Result<(), String> {
    let result = db::add_projects_to_group(&state.db, project_group_id, managed_project_ids)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(
            project_group_id = project_group_id,
            "add_projects_to_group success"
        ),
        Err(e) => {
            tracing::error!(project_group_id = project_group_id, error = %e, "add_projects_to_group failed")
        }
    }

    result
}

#[tauri::command]
async fn remove_projects_from_group(
    state: State<'_, AppState>,
    project_group_id: i64,
    managed_project_ids: Vec<i64>,
) -> Result<(), String> {
    let result = db::remove_projects_from_group(&state.db, project_group_id, managed_project_ids)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(
            project_group_id = project_group_id,
            "remove_projects_from_group success"
        ),
        Err(e) => {
            tracing::error!(project_group_id = project_group_id, error = %e, "remove_projects_from_group failed")
        }
    }

    result
}

#[tauri::command]
async fn list_project_group_projects(
    state: State<'_, AppState>,
    project_group_id: i64,
) -> Result<Vec<ManagedProject>, String> {
    let result = db::list_project_group_projects(&state.db, project_group_id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(projects) => tracing::info!(
            project_group_id = project_group_id,
            count = projects.len(),
            "list_project_group_projects success"
        ),
        Err(e) => {
            tracing::error!(project_group_id = project_group_id, error = %e, "list_project_group_projects failed")
        }
    }

    result
}

#[tauri::command]
async fn create_workflow_definition(
    state: State<'_, AppState>,
    name: String,
    description: String,
    enabled: bool,
    variables_schema: serde_json::Value,
    max_concurrency_default: i64,
    steps: Vec<WorkflowStepInput>,
) -> Result<WorkflowDefinitionDetail, String> {
    let result = db::create_workflow_definition(
        &state.db,
        name.trim().to_string(),
        description.trim().to_string(),
        enabled,
        variables_schema,
        max_concurrency_default,
        steps,
    )
    .await
    .map_err(|e| e.to_string());

    match &result {
        Ok(workflow) => tracing::info!(id = workflow.id, "create_workflow_definition success"),
        Err(e) => tracing::error!(error = %e, "create_workflow_definition failed"),
    }

    result
}

#[tauri::command]
async fn create_pipeline_definition(
    state: State<'_, AppState>,
    name: String,
    description: String,
    enabled: bool,
    max_concurrency_default: i64,
    variables: Vec<PipelineVariableInput>,
    nodes: Vec<PipelineNodeInput>,
    schedules: Vec<PipelineScheduleInput>,
) -> Result<PipelineDefinitionDetail, String> {
    let result = db::create_pipeline_definition(
        &state.db,
        name.trim().to_string(),
        description.trim().to_string(),
        enabled,
        max_concurrency_default,
        variables,
        nodes,
        schedules,
    )
    .await
    .map_err(|e| e.to_string());

    match &result {
        Ok(pipeline) => tracing::info!(id = pipeline.id, "create_pipeline_definition success"),
        Err(e) => tracing::error!(error = %e, "create_pipeline_definition failed"),
    }

    result
}

#[tauri::command]
async fn list_workflow_definitions(
    state: State<'_, AppState>,
) -> Result<Vec<WorkflowDefinitionListItem>, String> {
    let result = db::list_workflow_definitions(&state.db)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(workflows) => {
            tracing::info!(count = workflows.len(), "list_workflow_definitions success")
        }
        Err(e) => tracing::error!(error = %e, "list_workflow_definitions failed"),
    }

    result
}

#[tauri::command]
async fn list_pipeline_definitions(
    state: State<'_, AppState>,
) -> Result<Vec<PipelineDefinitionListItem>, String> {
    let result = db::list_pipeline_definitions(&state.db)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(pipelines) => {
            tracing::info!(count = pipelines.len(), "list_pipeline_definitions success")
        }
        Err(e) => tracing::error!(error = %e, "list_pipeline_definitions failed"),
    }

    result
}

#[tauri::command]
async fn get_workflow_definition_detail(
    state: State<'_, AppState>,
    id: i64,
) -> Result<WorkflowDefinitionDetail, String> {
    let result = db::get_workflow_definition_detail(&state.db, id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "get_workflow_definition_detail success"),
        Err(e) => tracing::error!(id = id, error = %e, "get_workflow_definition_detail failed"),
    }

    result
}

#[tauri::command]
async fn get_pipeline_definition_detail(
    state: State<'_, AppState>,
    id: i64,
) -> Result<PipelineDefinitionDetail, String> {
    let result = db::get_pipeline_definition_detail(&state.db, id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "get_pipeline_definition_detail success"),
        Err(e) => tracing::error!(id = id, error = %e, "get_pipeline_definition_detail failed"),
    }

    result
}

#[tauri::command]
async fn update_workflow_definition(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    description: String,
    enabled: bool,
    variables_schema: serde_json::Value,
    max_concurrency_default: i64,
    steps: Vec<WorkflowStepInput>,
) -> Result<(), String> {
    let result = db::update_workflow_definition(
        &state.db,
        id,
        name.trim().to_string(),
        description.trim().to_string(),
        enabled,
        variables_schema,
        max_concurrency_default,
        steps,
    )
    .await
    .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "update_workflow_definition success"),
        Err(e) => tracing::error!(id = id, error = %e, "update_workflow_definition failed"),
    }

    result
}

#[tauri::command]
async fn update_pipeline_definition(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    description: String,
    enabled: bool,
    max_concurrency_default: i64,
    variables: Vec<PipelineVariableInput>,
    nodes: Vec<PipelineNodeInput>,
    schedules: Vec<PipelineScheduleInput>,
) -> Result<(), String> {
    let result = db::update_pipeline_definition(
        &state.db,
        id,
        name.trim().to_string(),
        description.trim().to_string(),
        enabled,
        max_concurrency_default,
        variables,
        nodes,
        schedules,
    )
    .await
    .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "update_pipeline_definition success"),
        Err(e) => tracing::error!(id = id, error = %e, "update_pipeline_definition failed"),
    }

    result
}

#[tauri::command]
async fn delete_workflow_definition(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let result = db::delete_workflow_definition(&state.db, id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "delete_workflow_definition success"),
        Err(e) => tracing::error!(id = id, error = %e, "delete_workflow_definition failed"),
    }

    result
}

#[tauri::command]
async fn delete_pipeline_definition(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let result = db::delete_pipeline_definition(&state.db, id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "delete_pipeline_definition success"),
        Err(e) => tracing::error!(id = id, error = %e, "delete_pipeline_definition failed"),
    }

    result
}

#[tauri::command]
async fn list_workflow_runs(
    state: State<'_, AppState>,
) -> Result<Vec<WorkflowRunListItem>, String> {
    let result = db::list_workflow_runs(&state.db)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(runs) => tracing::info!(count = runs.len(), "list_workflow_runs success"),
        Err(e) => tracing::error!(error = %e, "list_workflow_runs failed"),
    }

    result
}

#[tauri::command]
async fn list_pipeline_runs(
    state: State<'_, AppState>,
) -> Result<Vec<PipelineRunListItem>, String> {
    let result = db::list_pipeline_runs(&state.db)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(runs) => tracing::info!(count = runs.len(), "list_pipeline_runs success"),
        Err(e) => tracing::error!(error = %e, "list_pipeline_runs failed"),
    }

    result
}

#[tauri::command]
async fn execute_pipeline_run(
    state: State<'_, AppState>,
    request: PipelineRunExecuteRequest,
) -> Result<PipelineRunExecuteResult, String> {
    let run_id = workflows::execute_pipeline_run(
        &state.db,
        request.pipeline_definition_id,
        request.project_group_id,
        request.run_parameters,
        request.max_concurrency_override,
    )
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!(pipeline_run_id = run_id, "execute_pipeline_run success");
    Ok(PipelineRunExecuteResult {
        pipeline_run_id: run_id,
    })
}

#[tauri::command]
async fn cancel_pipeline_run(
    state: State<'_, AppState>,
    pipeline_run_id: i64,
) -> Result<(), String> {
    let result = workflows::cancel_pipeline_run(&state.db, pipeline_run_id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(
            pipeline_run_id = pipeline_run_id,
            "cancel_pipeline_run success"
        ),
        Err(e) => tracing::error!(
            pipeline_run_id = pipeline_run_id,
            error = %e,
            "cancel_pipeline_run failed"
        ),
    }

    result
}

#[tauri::command]
async fn retry_pipeline_run(
    state: State<'_, AppState>,
    request: PipelineRunRetryRequest,
) -> Result<PipelineRunExecuteResult, String> {
    let run_id = workflows::retry_pipeline_run(
        &state.db,
        request.source_pipeline_run_id,
        request.selected_managed_project_ids,
        request.max_concurrency_override,
    )
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!(
        source_pipeline_run_id = request.source_pipeline_run_id,
        pipeline_run_id = run_id,
        "retry_pipeline_run success"
    );

    Ok(PipelineRunExecuteResult {
        pipeline_run_id: run_id,
    })
}

#[tauri::command]
async fn execute_workflow_run(
    state: State<'_, AppState>,
    request: WorkflowRunExecuteRequest,
) -> Result<WorkflowRunExecuteResult, String> {
    let run_id = workflows::execute_workflow_run(
        &state.db,
        request.workflow_definition_id,
        request.project_group_id,
        request.run_parameters,
        request.max_concurrency_override,
    )
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!(workflow_run_id = run_id, "execute_workflow_run success");
    Ok(WorkflowRunExecuteResult {
        workflow_run_id: run_id,
    })
}

#[tauri::command]
async fn cancel_workflow_run(
    state: State<'_, AppState>,
    workflow_run_id: i64,
) -> Result<(), String> {
    let result = workflows::cancel_workflow_run(&state.db, workflow_run_id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(
            workflow_run_id = workflow_run_id,
            "cancel_workflow_run success"
        ),
        Err(e) => tracing::error!(
            workflow_run_id = workflow_run_id,
            error = %e,
            "cancel_workflow_run failed"
        ),
    }

    result
}

#[tauri::command]
async fn retry_failed_workflow_run(
    state: State<'_, AppState>,
    request: WorkflowRunRetryFailedRequest,
) -> Result<WorkflowRunExecuteResult, String> {
    let run_id = workflows::retry_failed_workflow_run(
        &state.db,
        request.source_workflow_run_id,
        request.selected_managed_project_ids,
        request.max_concurrency_override,
    )
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!(
        source_workflow_run_id = request.source_workflow_run_id,
        workflow_run_id = run_id,
        "retry_failed_workflow_run success"
    );

    Ok(WorkflowRunExecuteResult {
        workflow_run_id: run_id,
    })
}

#[tauri::command]
async fn get_workflow_run_detail(
    state: State<'_, AppState>,
    id: i64,
) -> Result<WorkflowRunDetail, String> {
    let result = db::get_workflow_run_detail(&state.db, id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "get_workflow_run_detail success"),
        Err(e) => tracing::error!(id = id, error = %e, "get_workflow_run_detail failed"),
    }

    result
}

#[tauri::command]
async fn get_pipeline_run_detail(
    state: State<'_, AppState>,
    id: i64,
) -> Result<PipelineRunDetail, String> {
    let result = db::get_pipeline_run_detail(&state.db, id)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(_) => tracing::info!(id = id, "get_pipeline_run_detail success"),
        Err(e) => tracing::error!(id = id, error = %e, "get_pipeline_run_detail failed"),
    }

    result
}

#[tauri::command]
async fn sync_project_group_members(
    state: State<'_, AppState>,
    project_group_id: i64,
    source_local_group_id: Option<i64>,
    selected_user_ids: Vec<u64>,
    access_level: i64,
    expires_at: Option<String>,
) -> Result<Vec<ProjectGroupMemberSyncRow>, String> {
    tracing::info!(
      project_group_id = project_group_id,
      source_local_group_id = ?source_local_group_id,
      selected_user_ids_count = selected_user_ids.len(),
      access_level = access_level,
      expires_at = ?expires_at,
      "sync_project_group_members called"
    );

    if source_local_group_id.is_none() && selected_user_ids.is_empty() {
        return Err("at least one member source is required".to_string());
    }

    let group_exists = db::project_group_exists(&state.db, project_group_id)
        .await
        .map_err(|e| e.to_string())?;
    if !group_exists {
        return Err(format!("project group not found: {project_group_id}"));
    }

    let resolved_user_ids =
        db::resolve_member_sync_user_ids(&state.db, source_local_group_id, selected_user_ids)
            .await
            .map_err(|e| e.to_string())?;
    if resolved_user_ids.is_empty() {
        return Err("no local members resolved from selected sources".to_string());
    }

    let projects = db::list_project_group_projects(&state.db, project_group_id)
        .await
        .map_err(|e| e.to_string())?;

    let cfg = require_cfg(&state)?;
    let normalized_expires_at = normalize_optional_text(expires_at);
    let mut rows = Vec::with_capacity(projects.len());
    for project in &projects {
        let row = gitlab::sync_members_for_managed_project(
            &cfg,
            project,
            &resolved_user_ids,
            access_level,
            normalized_expires_at.clone(),
        )
        .await;
        rows.push(row);
    }

    let succeeded_projects = rows.iter().filter(|row| row.success).count();
    tracing::info!(
        project_group_id = project_group_id,
        project_count = rows.len(),
        resolved_user_count = resolved_user_ids.len(),
        succeeded_projects = succeeded_projects,
        failed_projects = rows.len().saturating_sub(succeeded_projects),
        "sync_project_group_members completed"
    );

    Ok(rows)
}

#[tauri::command]
async fn upsert_local_members(
    state: State<'_, AppState>,
    members: Vec<LocalMemberUpsert>,
) -> Result<(), String> {
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
async fn list_local_members(
    state: State<'_, AppState>,
    query: Option<String>,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<(Vec<LocalMember>, u64), String> {
    let page = page.unwrap_or(1).max(1);
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    tracing::info!(query = ?query, page = page, per_page = per_page, "list_local_members called");

    let result = db::list_local_members(&state.db, query, page, per_page)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok((members, total)) => tracing::info!(
            count = members.len(),
            total = total,
            "list_local_members success"
        ),
        Err(e) => tracing::error!(error = %e, "list_local_members failed"),
    }
    result
}

#[tauri::command]
async fn delete_local_members(
    state: State<'_, AppState>,
    user_ids: Vec<u64>,
) -> Result<(), String> {
    tracing::info!(count = user_ids.len(), "delete_local_members called");
    let result = db::delete_local_members(&state.db, user_ids)
        .await
        .map_err(|e| e.to_string());
    match &result {
        Ok(_) => tracing::info!("delete_local_members success"),
        Err(e) => tracing::error!(error = %e, "delete_local_members failed"),
    }
    result
}

#[tauri::command]
async fn create_local_group(
    state: State<'_, AppState>,
    name: String,
) -> Result<LocalGroup, String> {
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
async fn update_local_group(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    db::update_local_group(&state.db, id, name.trim().to_string())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_local_group(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    db::delete_local_group(&state.db, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_members_to_group(
    state: State<'_, AppState>,
    group_id: i64,
    user_ids: Vec<u64>,
) -> Result<(), String> {
    tracing::info!(
        group_id = group_id,
        user_count = user_ids.len(),
        "add_members_to_group called"
    );

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
async fn remove_members_from_group(
    state: State<'_, AppState>,
    group_id: i64,
    user_ids: Vec<u64>,
) -> Result<(), String> {
    tracing::info!(
        group_id = group_id,
        user_count = user_ids.len(),
        "remove_members_from_group called"
    );

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
async fn list_group_members(
    state: State<'_, AppState>,
    group_id: i64,
) -> Result<Vec<LocalMember>, String> {
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
async fn add_member_to_project(
    state: State<'_, AppState>,
    project: String,
    user_id: u64,
    access_level: i64,
    expires_at: Option<String>,
) -> Result<(), String> {
    tracing::info!(
      project = %project,
      user_id = user_id,
      access_level = access_level,
      expires_at = ?expires_at,
      "add_member_to_project called"
    );

    let cfg = require_cfg(&state)?;
    gitlab::add_member(&cfg, &project, user_id, access_level, expires_at)
        .await
        .map_err(|e| e.to_string())?;

    tracing::info!(user_id = user_id, "add_member_to_project success");
    Ok(())
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let _guard = init_logging(&app.handle())
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;

            Box::leak(Box::new(_guard));

            tracing::info!("Application starting...");

            let db = tauri::async_runtime::block_on(db::init_db(&app.handle()))
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;

      match tauri::async_runtime::block_on(workflows::reconcile_stale_workflow_runs(&db)) {
        Ok(0) => {}
        Ok(reconciled_count) => tracing::warn!(
          reconciled_count = reconciled_count,
          "[setup] reconciled stale in-flight workflow runs on startup"
        ),
        Err(e) => tracing::error!(
          error = %e,
          "[setup] failed to reconcile stale in-flight workflow runs"
        ),
      }

      let migration_summary = tauri::async_runtime::block_on(db::migrate_workflows_to_pipelines(&db))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
      tracing::info!(
        definitions_migrated = migration_summary.definitions_migrated,
        variables_migrated = migration_summary.variables_migrated,
        nodes_migrated = migration_summary.nodes_migrated,
        runs_migrated = migration_summary.runs_migrated,
        run_projects_migrated = migration_summary.run_projects_migrated,
        run_nodes_migrated = migration_summary.run_nodes_migrated,
        "[setup] migrated legacy workflow data into pipeline tables"
      );

      let gitlab = match tauri::async_runtime::block_on(db::get_gitlab_config(&db)) {
        Ok(Some(cfg)) => {
          tracing::info!("[setup] loaded GitLab config from database");
          Some(GitLabConfig {
            base_url: cfg.base_url,
            token: cfg.token,
          })
        }
        Ok(None) => None,
        Err(e) => {
          tracing::warn!(error = %e, "[setup] failed to load GitLab config from database");
          None
        }
      };

      scheduler::spawn_pipeline_scheduler(db.clone());
      tracing::info!("[setup] started pipeline scheduler loop");

      app.manage(AppState {
        db,
        gitlab: Mutex::new(gitlab),
      });

      tracing::info!("Application initialized successfully");
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_gitlab_config,
      set_gitlab_config,
      search_projects,
      list_project_members,
      create_managed_project,
      list_managed_projects,
      update_managed_project,
      delete_managed_project,
      create_project_group,
      list_project_groups,
      update_project_group,
      delete_project_group,
      add_projects_to_group,
      remove_projects_from_group,
      list_project_group_projects,
	      create_workflow_definition,
	      create_pipeline_definition,
	      list_workflow_definitions,
	      list_pipeline_definitions,
	      get_workflow_definition_detail,
	      get_pipeline_definition_detail,
	      update_workflow_definition,
	      update_pipeline_definition,
	      delete_workflow_definition,
	      delete_pipeline_definition,
	      execute_pipeline_run,
	      cancel_pipeline_run,
	      retry_pipeline_run,
	      execute_workflow_run,
	      cancel_workflow_run,
	      retry_failed_workflow_run,
	      list_workflow_runs,
	      list_pipeline_runs,
	      get_workflow_run_detail,
	      get_pipeline_run_detail,
      sync_project_group_members,
      upsert_local_members,
      list_local_members,
      delete_local_members,
      create_local_group,
      list_local_groups,
      update_local_group,
      delete_local_group,
      add_members_to_group,
      remove_members_from_group,
      list_group_members,
      batch_add_members_to_project,
      batch_remove_members_from_project,
      add_member_to_project,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
