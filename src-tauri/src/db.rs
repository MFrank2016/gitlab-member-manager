use crate::models::{
    LocalGroup, LocalMember, LocalMemberUpsert, ManagedProject, ProjectGroup,
    WorkflowDefinitionDetail, WorkflowDefinitionListItem, WorkflowRunDetail, WorkflowRunListItem,
    WorkflowRunProject, WorkflowRunStep, WorkflowStep, WorkflowStepInput,
};
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde_json::{Map, Value};
use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Sqlite, SqlitePool, Transaction,
};
use std::collections::{BTreeSet, HashMap};
use std::str::FromStr;
use tauri::Manager;

pub async fn init_db(app: &tauri::AppHandle) -> Result<SqlitePool> {
    let dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app_data_dir")?;
    std::fs::create_dir_all(&dir).context("failed to create app data dir")?;

    let db_path = dir.join("gitlab_member_manager.sqlite3");
    // sqlx sqlite URL 在 Windows 需要使用正斜杠，否则会因反斜杠被当成转义而连接失败
    let db_url = format!("sqlite://{}", db_path.to_string_lossy().replace('\\', "/"));

    tracing::info!(db_path = %db_path.display(), "[db] initializing database");

    let options = SqliteConnectOptions::from_str(&db_url)
        .context("invalid sqlite url")?
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .with_context(|| format!("failed to connect sqlite: {}", db_url))?;

    tracing::info!("[db] running migrations");
    static MIGRATOR: Migrator = sqlx::migrate!();
    MIGRATOR.run(&pool).await?;

    tracing::info!("[db] database initialized successfully");
    Ok(pool)
}

fn u64_to_i64_checked(value: u64, field_name: &str) -> Result<i64> {
    i64::try_from(value)
        .map_err(|_| anyhow!("{field_name} out of range for SQLite INTEGER: {value}"))
}

fn i64_to_u64_checked(value: i64, field_name: &str) -> Result<u64> {
    u64::try_from(value).map_err(|_| anyhow!("{field_name} out of range for u64: {value}"))
}

fn option_u64_to_i64_checked(value: Option<u64>, field_name: &str) -> Result<Option<i64>> {
    value
        .map(|raw| u64_to_i64_checked(raw, field_name))
        .transpose()
}

fn option_i64_to_u64_checked(value: Option<i64>, field_name: &str) -> Result<Option<u64>> {
    value
        .map(|raw| i64_to_u64_checked(raw, field_name))
        .transpose()
}

fn normalize_json_object(value: Value, field_name: &str) -> Result<Value> {
    match value {
        Value::Null => Ok(Value::Object(Map::new())),
        Value::Object(_) => Ok(value),
        _ => Err(anyhow!("{field_name} must be a JSON object")),
    }
}

fn normalize_workflow_step_inputs(steps: Vec<WorkflowStepInput>) -> Result<Vec<WorkflowStepInput>> {
    if steps.is_empty() {
        return Err(anyhow!("workflow definition must contain at least one step"));
    }

    let mut normalized = Vec::with_capacity(steps.len());
    for step in steps {
        let step_type = step.step_type.trim().to_string();
        if step_type.is_empty() {
            return Err(anyhow!("workflow step type is empty"));
        }
        let parameters = normalize_json_object(step.parameters, "workflow step parameters")?;
        normalized.push(WorkflowStepInput {
            step_type,
            parameters,
        });
    }

    Ok(normalized)
}

fn serialize_json(value: &Value, field_name: &str) -> Result<String> {
    serde_json::to_string(value).with_context(|| format!("serialize {field_name} json"))
}

fn deserialize_json(raw: &str, field_name: &str) -> Result<Value> {
    serde_json::from_str(raw).with_context(|| format!("parse {field_name} json"))
}

fn deserialize_json_object(raw: &str, field_name: &str) -> Result<Value> {
    let parsed = deserialize_json(raw, field_name)?;
    normalize_json_object(parsed, field_name)
}

#[derive(Debug, sqlx::FromRow)]
struct WorkflowRunSummaryRow {
    id: i64,
    workflow_definition_id: i64,
    workflow_definition_name: String,
    project_group_id: i64,
    project_group_name: String,
    source_workflow_run_id: Option<i64>,
    trigger_kind: String,
    status: String,
    run_parameters_json: String,
    max_concurrency: i64,
    projects_total: i64,
    projects_queued: i64,
    projects_running: i64,
    projects_success: i64,
    projects_failed: i64,
    projects_cancelled: i64,
    projects_failed_precheck: i64,
    started_at: Option<String>,
    finished_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, sqlx::FromRow)]
struct WorkflowRunProjectRow {
    id: i64,
    managed_project_id: Option<i64>,
    gitlab_project_id: i64,
    project_name: String,
    project_path_with_namespace: String,
    repo_path: String,
    status: String,
    summary_message: String,
    started_at: Option<String>,
    finished_at: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct WorkflowRunStepRow {
    id: i64,
    workflow_run_project_id: i64,
    workflow_step_id: Option<i64>,
    step_order: i64,
    step_type: String,
    rendered_parameters_json: String,
    status: String,
    started_at: Option<String>,
    finished_at: Option<String>,
    stdout: String,
    stderr: String,
    exit_code: Option<i64>,
    summary_message: String,
}

async fn insert_workflow_steps(
    tx: &mut Transaction<'_, Sqlite>,
    workflow_definition_id: i64,
    steps: &[WorkflowStepInput],
    now: &str,
) -> Result<()> {
    for (index, step) in steps.iter().enumerate() {
        let step_order = i64::try_from(index)
            .map_err(|_| anyhow!("workflow step index out of range: {index}"))?;
        let parameters_json =
            serialize_json(&step.parameters, "workflow_steps.parameters_json")?;

        sqlx::query(
            r#"INSERT INTO workflow_steps (
             workflow_definition_id, step_order, step_type, parameters_json, created_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
        )
        .bind(workflow_definition_id)
        .bind(step_order)
        .bind(&step.step_type)
        .bind(&parameters_json)
        .bind(now)
        .bind(now)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

async fn load_workflow_steps(
    pool: &SqlitePool,
    workflow_definition_id: i64,
) -> Result<Vec<WorkflowStep>> {
    let rows = sqlx::query_as::<_, (i64, String, String)>(
        r#"SELECT
         step_order, step_type, parameters_json
       FROM workflow_steps
       WHERE workflow_definition_id = ?1
       ORDER BY step_order ASC, id ASC"#,
    )
    .bind(workflow_definition_id)
    .fetch_all(pool)
    .await?;

    let mut steps = Vec::with_capacity(rows.len());
    for row in rows {
        steps.push(WorkflowStep {
            step_order: row.0,
            step_type: row.1,
            parameters: deserialize_json_object(&row.2, "workflow step parameters")?,
        });
    }

    Ok(steps)
}

pub async fn create_managed_project(
    pool: &SqlitePool,
    gitlab_project_id: u64,
    name: String,
    path_with_namespace: String,
    repo_path: String,
    default_branch: Option<String>,
    default_remote: Option<String>,
    enabled: bool,
) -> Result<ManagedProject> {
    let now = Utc::now().to_rfc3339();
    let default_branch = default_branch.unwrap_or_else(|| "main".to_string());
    let default_remote = default_remote.unwrap_or_else(|| "origin".to_string());
    let enabled_value = if enabled { 1_i64 } else { 0_i64 };
    let gitlab_project_id_i64 = u64_to_i64_checked(gitlab_project_id, "gitlab_project_id")?;

    let res = sqlx::query(
        r#"INSERT INTO managed_projects (
         gitlab_project_id, name, path_with_namespace, repo_path,
         default_branch, default_remote, enabled, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
    )
    .bind(gitlab_project_id_i64)
    .bind(&name)
    .bind(&path_with_namespace)
    .bind(&repo_path)
    .bind(&default_branch)
    .bind(&default_remote)
    .bind(enabled_value)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(ManagedProject {
        id: res.last_insert_rowid(),
        gitlab_project_id,
        name,
        path_with_namespace,
        repo_path,
        default_branch,
        default_remote,
        enabled,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub async fn list_managed_projects(pool: &SqlitePool) -> Result<Vec<ManagedProject>> {
    let rows = sqlx::query_as::<
        _,
        (
            i64,
            i64,
            String,
            String,
            String,
            String,
            String,
            i64,
            String,
            String,
        ),
    >(
        r#"SELECT
         id, gitlab_project_id, name, path_with_namespace, repo_path,
         default_branch, default_remote, enabled, created_at, updated_at
       FROM managed_projects
       ORDER BY id DESC"#,
    )
    .fetch_all(pool)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for r in rows {
        items.push(ManagedProject {
            id: r.0,
            gitlab_project_id: i64_to_u64_checked(r.1, "managed_projects.gitlab_project_id")?,
            name: r.2,
            path_with_namespace: r.3,
            repo_path: r.4,
            default_branch: r.5,
            default_remote: r.6,
            enabled: r.7 != 0,
            created_at: r.8,
            updated_at: r.9,
        });
    }

    Ok(items)
}

#[allow(clippy::too_many_arguments)]
pub async fn update_managed_project(
    pool: &SqlitePool,
    id: i64,
    gitlab_project_id: u64,
    name: String,
    path_with_namespace: String,
    repo_path: String,
    default_branch: String,
    default_remote: String,
    enabled: bool,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let enabled_value = if enabled { 1_i64 } else { 0_i64 };
    let gitlab_project_id_i64 = u64_to_i64_checked(gitlab_project_id, "gitlab_project_id")?;

    let res = sqlx::query(
        r#"UPDATE managed_projects
       SET gitlab_project_id = ?1,
           name = ?2,
           path_with_namespace = ?3,
           repo_path = ?4,
           default_branch = ?5,
           default_remote = ?6,
           enabled = ?7,
           updated_at = ?8
       WHERE id = ?9"#,
    )
    .bind(gitlab_project_id_i64)
    .bind(&name)
    .bind(&path_with_namespace)
    .bind(&repo_path)
    .bind(&default_branch)
    .bind(&default_remote)
    .bind(enabled_value)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(anyhow!("managed project not found: {id}"));
    }

    Ok(())
}

pub async fn delete_managed_project(pool: &SqlitePool, id: i64) -> Result<()> {
    let res = sqlx::query(r#"DELETE FROM managed_projects WHERE id = ?1"#)
        .bind(id)
        .execute(pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(anyhow!("managed project not found: {id}"));
    }

    Ok(())
}

pub async fn create_project_group(pool: &SqlitePool, name: String) -> Result<ProjectGroup> {
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        r#"INSERT INTO project_groups (name, created_at, updated_at)
       VALUES (?1, ?2, ?3)"#,
    )
    .bind(&name)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(ProjectGroup {
        id: res.last_insert_rowid(),
        name,
        created_at: now.clone(),
        updated_at: now,
        projects_count: 0,
    })
}

pub async fn list_project_groups(pool: &SqlitePool) -> Result<Vec<ProjectGroup>> {
    let rows = sqlx::query_as::<_, (i64, String, String, String, i64)>(
        r#"SELECT
         g.id, g.name, g.created_at, g.updated_at, COUNT(i.managed_project_id) as projects_count
       FROM project_groups g
       LEFT JOIN project_group_items i ON i.project_group_id = g.id
       GROUP BY g.id
       ORDER BY g.id DESC"#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| ProjectGroup {
            id: r.0,
            name: r.1,
            created_at: r.2,
            updated_at: r.3,
            projects_count: r.4,
        })
        .collect())
}

pub async fn update_project_group(pool: &SqlitePool, id: i64, name: String) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        r#"UPDATE project_groups
       SET name = ?1, updated_at = ?2
       WHERE id = ?3"#,
    )
    .bind(&name)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(anyhow!("project group not found: {id}"));
    }

    Ok(())
}

pub async fn delete_project_group(pool: &SqlitePool, id: i64) -> Result<()> {
    let res = sqlx::query(r#"DELETE FROM project_groups WHERE id = ?1"#)
        .bind(id)
        .execute(pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(anyhow!("project group not found: {id}"));
    }

    Ok(())
}

pub async fn add_projects_to_group(
    pool: &SqlitePool,
    project_group_id: i64,
    managed_project_ids: Vec<i64>,
) -> Result<()> {
    let group_exists =
        sqlx::query_scalar::<_, i64>(r#"SELECT COUNT(*) FROM project_groups WHERE id = ?1"#)
            .bind(project_group_id)
            .fetch_one(pool)
            .await?;
    if group_exists == 0 {
        return Err(anyhow!("project group not found: {project_group_id}"));
    }

    if managed_project_ids.is_empty() {
        return Ok(());
    }

    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;

    for managed_project_id in managed_project_ids {
        sqlx::query(
      r#"INSERT OR IGNORE INTO project_group_items (project_group_id, managed_project_id, created_at)
         VALUES (?1, ?2, ?3)"#,
    )
    .bind(project_group_id)
    .bind(managed_project_id)
    .bind(&now)
    .execute(&mut *tx)
    .await?;
    }

    sqlx::query(r#"UPDATE project_groups SET updated_at = ?1 WHERE id = ?2"#)
        .bind(&now)
        .bind(project_group_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn remove_projects_from_group(
    pool: &SqlitePool,
    project_group_id: i64,
    managed_project_ids: Vec<i64>,
) -> Result<()> {
    let group_exists =
        sqlx::query_scalar::<_, i64>(r#"SELECT COUNT(*) FROM project_groups WHERE id = ?1"#)
            .bind(project_group_id)
            .fetch_one(pool)
            .await?;
    if group_exists == 0 {
        return Err(anyhow!("project group not found: {project_group_id}"));
    }

    if managed_project_ids.is_empty() {
        return Ok(());
    }

    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await?;

    for managed_project_id in managed_project_ids {
        sqlx::query(
            r#"DELETE FROM project_group_items
         WHERE project_group_id = ?1 AND managed_project_id = ?2"#,
        )
        .bind(project_group_id)
        .bind(managed_project_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(r#"UPDATE project_groups SET updated_at = ?1 WHERE id = ?2"#)
        .bind(&now)
        .bind(project_group_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn list_project_group_projects(
    pool: &SqlitePool,
    project_group_id: i64,
) -> Result<Vec<ManagedProject>> {
    let rows = sqlx::query_as::<
        _,
        (
            i64,
            i64,
            String,
            String,
            String,
            String,
            String,
            i64,
            String,
            String,
        ),
    >(
        r#"SELECT
         p.id, p.gitlab_project_id, p.name, p.path_with_namespace, p.repo_path,
         p.default_branch, p.default_remote, p.enabled, p.created_at, p.updated_at
       FROM managed_projects p
       INNER JOIN project_group_items i ON i.managed_project_id = p.id
       WHERE i.project_group_id = ?1
       ORDER BY p.id ASC"#,
    )
    .bind(project_group_id)
    .fetch_all(pool)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for r in rows {
        items.push(ManagedProject {
            id: r.0,
            gitlab_project_id: i64_to_u64_checked(r.1, "managed_projects.gitlab_project_id")?,
            name: r.2,
            path_with_namespace: r.3,
            repo_path: r.4,
            default_branch: r.5,
            default_remote: r.6,
            enabled: r.7 != 0,
            created_at: r.8,
            updated_at: r.9,
        });
    }

    Ok(items)
}

pub async fn project_group_exists(pool: &SqlitePool, project_group_id: i64) -> Result<bool> {
    let count =
        sqlx::query_scalar::<_, i64>(r#"SELECT COUNT(*) FROM project_groups WHERE id = ?1"#)
            .bind(project_group_id)
            .fetch_one(pool)
            .await?;

    Ok(count > 0)
}

#[allow(clippy::too_many_arguments)]
pub async fn create_workflow_definition(
    pool: &SqlitePool,
    name: String,
    description: String,
    enabled: bool,
    variables_schema: Value,
    max_concurrency_default: i64,
    steps: Vec<WorkflowStepInput>,
) -> Result<WorkflowDefinitionDetail> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(anyhow!("workflow definition name is empty"));
    }
    if max_concurrency_default < 1 {
        return Err(anyhow!("max_concurrency_default must be >= 1"));
    }

    let steps = normalize_workflow_step_inputs(steps)?;
    let variables_schema = normalize_json_object(variables_schema, "variables_schema")?;
    let variables_schema_json =
        serialize_json(&variables_schema, "workflow_definitions.variables_schema")?;
    let description = description.trim().to_string();
    let enabled_value = if enabled { 1_i64 } else { 0_i64 };
    let now = Utc::now().to_rfc3339();

    let mut tx = pool.begin().await?;
    let res = sqlx::query(
        r#"INSERT INTO workflow_definitions (
         name, description, enabled, variables_schema, max_concurrency_default, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
    )
    .bind(&name)
    .bind(&description)
    .bind(enabled_value)
    .bind(&variables_schema_json)
    .bind(max_concurrency_default)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;
    let workflow_definition_id = res.last_insert_rowid();

    insert_workflow_steps(&mut tx, workflow_definition_id, &steps, &now).await?;
    tx.commit().await?;

    get_workflow_definition_detail(pool, workflow_definition_id).await
}

pub async fn list_workflow_definitions(pool: &SqlitePool) -> Result<Vec<WorkflowDefinitionListItem>> {
    let rows = sqlx::query_as::<_, (i64, String, String, i64, String, i64, String, String, i64)>(
        r#"SELECT
         d.id, d.name, d.description, d.enabled, d.variables_schema, d.max_concurrency_default,
         d.created_at, d.updated_at, COUNT(s.id) as steps_count
       FROM workflow_definitions d
       LEFT JOIN workflow_steps s ON s.workflow_definition_id = d.id
       GROUP BY d.id
       ORDER BY d.id DESC"#,
    )
    .fetch_all(pool)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(WorkflowDefinitionListItem {
            id: row.0,
            name: row.1,
            description: row.2,
            enabled: row.3 != 0,
            variables_schema: deserialize_json_object(&row.4, "variables_schema")?,
            max_concurrency_default: row.5,
            created_at: row.6,
            updated_at: row.7,
            steps_count: row.8,
        });
    }

    Ok(items)
}

pub async fn get_workflow_definition_detail(
    pool: &SqlitePool,
    id: i64,
) -> Result<WorkflowDefinitionDetail> {
    let row = sqlx::query_as::<_, (i64, String, String, i64, String, i64, String, String)>(
        r#"SELECT
         id, name, description, enabled, variables_schema, max_concurrency_default, created_at, updated_at
       FROM workflow_definitions
       WHERE id = ?1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow!("workflow definition not found: {id}"))?;

    let steps = load_workflow_steps(pool, id).await?;
    Ok(WorkflowDefinitionDetail {
        id: row.0,
        name: row.1,
        description: row.2,
        enabled: row.3 != 0,
        variables_schema: deserialize_json_object(&row.4, "variables_schema")?,
        max_concurrency_default: row.5,
        created_at: row.6,
        updated_at: row.7,
        steps,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn update_workflow_definition(
    pool: &SqlitePool,
    id: i64,
    name: String,
    description: String,
    enabled: bool,
    variables_schema: Value,
    max_concurrency_default: i64,
    steps: Vec<WorkflowStepInput>,
) -> Result<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(anyhow!("workflow definition name is empty"));
    }
    if max_concurrency_default < 1 {
        return Err(anyhow!("max_concurrency_default must be >= 1"));
    }

    let steps = normalize_workflow_step_inputs(steps)?;
    let variables_schema = normalize_json_object(variables_schema, "variables_schema")?;
    let variables_schema_json =
        serialize_json(&variables_schema, "workflow_definitions.variables_schema")?;
    let description = description.trim().to_string();
    let enabled_value = if enabled { 1_i64 } else { 0_i64 };
    let now = Utc::now().to_rfc3339();

    let mut tx = pool.begin().await?;
    let res = sqlx::query(
        r#"UPDATE workflow_definitions
       SET name = ?1,
           description = ?2,
           enabled = ?3,
           variables_schema = ?4,
           max_concurrency_default = ?5,
           updated_at = ?6
       WHERE id = ?7"#,
    )
    .bind(&name)
    .bind(&description)
    .bind(enabled_value)
    .bind(&variables_schema_json)
    .bind(max_concurrency_default)
    .bind(&now)
    .bind(id)
    .execute(&mut *tx)
    .await?;

    if res.rows_affected() == 0 {
        return Err(anyhow!("workflow definition not found: {id}"));
    }

    sqlx::query(r#"DELETE FROM workflow_steps WHERE workflow_definition_id = ?1"#)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    insert_workflow_steps(&mut tx, id, &steps, &now).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn delete_workflow_definition(pool: &SqlitePool, id: i64) -> Result<()> {
    let res = sqlx::query(r#"DELETE FROM workflow_definitions WHERE id = ?1"#)
        .bind(id)
        .execute(pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(anyhow!("workflow definition not found: {id}"));
    }

    Ok(())
}

pub async fn list_workflow_runs(pool: &SqlitePool) -> Result<Vec<WorkflowRunListItem>> {
    let rows = sqlx::query_as::<_, WorkflowRunSummaryRow>(
        r#"SELECT
         r.id,
         r.workflow_definition_id,
         d.name as workflow_definition_name,
         r.project_group_id,
         g.name as project_group_name,
         r.source_workflow_run_id,
         r.trigger_kind,
         r.status,
         r.run_parameters_json,
         r.max_concurrency,
         COUNT(p.id) as projects_total,
         COALESCE(SUM(CASE WHEN p.status = 'queued' THEN 1 ELSE 0 END), 0) as projects_queued,
         COALESCE(SUM(CASE WHEN p.status = 'running' THEN 1 ELSE 0 END), 0) as projects_running,
         COALESCE(SUM(CASE WHEN p.status = 'success' THEN 1 ELSE 0 END), 0) as projects_success,
         COALESCE(SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END), 0) as projects_failed,
         COALESCE(SUM(CASE WHEN p.status = 'cancelled' THEN 1 ELSE 0 END), 0) as projects_cancelled,
         COALESCE(SUM(CASE WHEN p.status = 'failed_precheck' THEN 1 ELSE 0 END), 0) as projects_failed_precheck,
         r.started_at,
         r.finished_at,
         r.created_at,
         r.updated_at
       FROM workflow_runs r
       INNER JOIN workflow_definitions d ON d.id = r.workflow_definition_id
       INNER JOIN project_groups g ON g.id = r.project_group_id
       LEFT JOIN workflow_run_projects p ON p.workflow_run_id = r.id
       GROUP BY r.id
       ORDER BY r.id DESC"#,
    )
    .fetch_all(pool)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(WorkflowRunListItem {
            id: row.id,
            workflow_definition_id: row.workflow_definition_id,
            workflow_definition_name: row.workflow_definition_name,
            project_group_id: row.project_group_id,
            project_group_name: row.project_group_name,
            source_workflow_run_id: row.source_workflow_run_id,
            trigger_kind: row.trigger_kind,
            status: row.status,
            run_parameters: deserialize_json_object(
                &row.run_parameters_json,
                "workflow run parameters",
            )?,
            max_concurrency: row.max_concurrency,
            projects_total: row.projects_total,
            projects_queued: row.projects_queued,
            projects_running: row.projects_running,
            projects_success: row.projects_success,
            projects_failed: row.projects_failed,
            projects_cancelled: row.projects_cancelled,
            projects_failed_precheck: row.projects_failed_precheck,
            started_at: row.started_at,
            finished_at: row.finished_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        });
    }

    Ok(items)
}

pub async fn get_workflow_run_detail(pool: &SqlitePool, id: i64) -> Result<WorkflowRunDetail> {
    let mut tx = pool.begin().await?;

    let row = sqlx::query_as::<_, WorkflowRunSummaryRow>(
        r#"SELECT
         r.id,
         r.workflow_definition_id,
         d.name as workflow_definition_name,
         r.project_group_id,
         g.name as project_group_name,
         r.source_workflow_run_id,
         r.trigger_kind,
         r.status,
         r.run_parameters_json,
         r.max_concurrency,
         COUNT(p.id) as projects_total,
         COALESCE(SUM(CASE WHEN p.status = 'queued' THEN 1 ELSE 0 END), 0) as projects_queued,
         COALESCE(SUM(CASE WHEN p.status = 'running' THEN 1 ELSE 0 END), 0) as projects_running,
         COALESCE(SUM(CASE WHEN p.status = 'success' THEN 1 ELSE 0 END), 0) as projects_success,
         COALESCE(SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END), 0) as projects_failed,
         COALESCE(SUM(CASE WHEN p.status = 'cancelled' THEN 1 ELSE 0 END), 0) as projects_cancelled,
         COALESCE(SUM(CASE WHEN p.status = 'failed_precheck' THEN 1 ELSE 0 END), 0) as projects_failed_precheck,
         r.started_at,
         r.finished_at,
         r.created_at,
         r.updated_at
       FROM workflow_runs r
       INNER JOIN workflow_definitions d ON d.id = r.workflow_definition_id
       INNER JOIN project_groups g ON g.id = r.project_group_id
       LEFT JOIN workflow_run_projects p ON p.workflow_run_id = r.id
       WHERE r.id = ?1
       GROUP BY r.id"#,
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| anyhow!("workflow run not found: {id}"))?;

    let project_rows = sqlx::query_as::<_, WorkflowRunProjectRow>(
        r#"SELECT
         id, managed_project_id, gitlab_project_id, project_name, project_path_with_namespace, repo_path,
         status, summary_message, started_at, finished_at
       FROM workflow_run_projects
       WHERE workflow_run_id = ?1
       ORDER BY id ASC"#,
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;

    let step_rows = sqlx::query_as::<_, WorkflowRunStepRow>(
        r#"SELECT
         s.id,
         s.workflow_run_project_id,
         s.workflow_step_id,
         s.step_order,
         s.step_type,
         s.rendered_parameters_json,
         s.status,
         s.started_at,
         s.finished_at,
         s.stdout,
         s.stderr,
         s.exit_code,
         s.summary_message
       FROM workflow_run_steps s
       INNER JOIN workflow_run_projects p ON p.id = s.workflow_run_project_id
       WHERE p.workflow_run_id = ?1
       ORDER BY s.workflow_run_project_id ASC, s.step_order ASC, s.id ASC"#,
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;

    let mut steps_by_project_id = HashMap::<i64, Vec<WorkflowRunStep>>::new();
    for step_row in step_rows {
        let step = WorkflowRunStep {
            id: step_row.id,
            workflow_step_id: step_row.workflow_step_id,
            step_order: step_row.step_order,
            step_type: step_row.step_type,
            rendered_parameters: deserialize_json_object(
                &step_row.rendered_parameters_json,
                "workflow run step rendered parameters",
            )?,
            status: step_row.status,
            started_at: step_row.started_at,
            finished_at: step_row.finished_at,
            stdout: step_row.stdout,
            stderr: step_row.stderr,
            exit_code: step_row.exit_code,
            summary_message: step_row.summary_message,
        };
        steps_by_project_id
            .entry(step_row.workflow_run_project_id)
            .or_default()
            .push(step);
    }

    let mut projects = Vec::with_capacity(project_rows.len());
    for project_row in project_rows {
        let steps = steps_by_project_id.remove(&project_row.id).unwrap_or_default();
        projects.push(WorkflowRunProject {
            id: project_row.id,
            managed_project_id: project_row.managed_project_id,
            gitlab_project_id: i64_to_u64_checked(
                project_row.gitlab_project_id,
                "workflow_run_projects.gitlab_project_id",
            )?,
            project_name: project_row.project_name,
            project_path_with_namespace: project_row.project_path_with_namespace,
            repo_path: project_row.repo_path,
            status: project_row.status,
            summary_message: project_row.summary_message,
            started_at: project_row.started_at,
            finished_at: project_row.finished_at,
            steps,
        });
    }

    tx.commit().await?;

    Ok(WorkflowRunDetail {
        id: row.id,
        workflow_definition_id: row.workflow_definition_id,
        workflow_definition_name: row.workflow_definition_name,
        project_group_id: row.project_group_id,
        project_group_name: row.project_group_name,
        source_workflow_run_id: row.source_workflow_run_id,
        trigger_kind: row.trigger_kind,
        status: row.status,
        run_parameters: deserialize_json_object(&row.run_parameters_json, "workflow run parameters")?,
        max_concurrency: row.max_concurrency,
        projects_total: row.projects_total,
        projects_queued: row.projects_queued,
        projects_running: row.projects_running,
        projects_success: row.projects_success,
        projects_failed: row.projects_failed,
        projects_cancelled: row.projects_cancelled,
        projects_failed_precheck: row.projects_failed_precheck,
        started_at: row.started_at,
        finished_at: row.finished_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        projects,
    })
}

pub async fn resolve_member_sync_user_ids(
    pool: &SqlitePool,
    source_group_id: Option<i64>,
    selected_user_ids: Vec<u64>,
) -> Result<Vec<u64>> {
    let mut resolved_user_ids = BTreeSet::<u64>::new();

    if let Some(group_id) = source_group_id {
        let group_exists =
            sqlx::query_scalar::<_, i64>(r#"SELECT COUNT(*) FROM local_groups WHERE id = ?1"#)
                .bind(group_id)
                .fetch_one(pool)
                .await?;

        if group_exists == 0 {
            return Err(anyhow!("local group not found: {group_id}"));
        }

        let group_members = list_group_members(pool, group_id).await?;
        for member in group_members {
            resolved_user_ids.insert(member.user_id);
        }
    }

    let unique_selected_user_ids: BTreeSet<u64> = selected_user_ids.into_iter().collect();
    for selected_user_id in unique_selected_user_ids {
        let selected_user_id_i64 = u64_to_i64_checked(selected_user_id, "user_id")?;
        let member_exists = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM local_members WHERE user_id = ?1"#,
        )
        .bind(selected_user_id_i64)
        .fetch_one(pool)
        .await?;

        if member_exists > 0 {
            resolved_user_ids.insert(selected_user_id);
        }
    }

    Ok(resolved_user_ids.into_iter().collect())
}

pub async fn upsert_local_members(
    pool: &SqlitePool,
    members: Vec<LocalMemberUpsert>,
) -> Result<()> {
    let count = members.len();
    tracing::info!(count = count, "[db] upsert_local_members starting");

    let mut tx = pool.begin().await?;
    let now = Utc::now().to_rfc3339();

    for m in members {
        let user_id_i64 = u64_to_i64_checked(m.user_id, "local_members.user_id")?;
        let project_id_i64 = option_u64_to_i64_checked(m.project_id, "local_members.project_id")?;
        sqlx::query(
      r#"INSERT INTO local_members (user_id, username, name, avatar_url, updated_at, project_id, project_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id) DO UPDATE SET
           username=excluded.username,
           name=excluded.name,
           avatar_url=excluded.avatar_url,
           updated_at=excluded.updated_at,
           project_id=excluded.project_id,
           project_name=excluded.project_name
      "#,
    )
    .bind(user_id_i64)
    .bind(m.username)
    .bind(m.name)
    .bind(m.avatar_url)
    .bind(&now)
    .bind(project_id_i64)
    .bind(m.project_name.as_deref())
    .execute(&mut *tx)
    .await?;
    }

    tx.commit().await?;
    tracing::info!(count = count, "[db] upsert_local_members completed");
    Ok(())
}

/// 分页列出本地成员，返回 (列表, 总条数)
pub async fn list_local_members(
    pool: &SqlitePool,
    query: Option<String>,
    page: u32,
    per_page: u32,
) -> Result<(Vec<LocalMember>, u64)> {
    let per_page = per_page.clamp(1, 100);
    let offset = (page.saturating_sub(1)) * per_page;

    let (total, rows) = if let Some(q) = query {
        let like = format!("%{}%", q);
        let total: (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM local_members WHERE username LIKE ?1 OR name LIKE ?1"#,
        )
        .bind(&like)
        .fetch_one(pool)
        .await?;

        let rows = sqlx::query_as::<
            _,
            (
                i64,
                String,
                String,
                Option<String>,
                String,
                Option<i64>,
                Option<String>,
            ),
        >(
            r#"SELECT user_id, username, name, avatar_url, updated_at, project_id, project_name
         FROM local_members
         WHERE username LIKE ?1 OR name LIKE ?1
         ORDER BY updated_at DESC
         LIMIT ?2 OFFSET ?3
      "#,
        )
        .bind(&like)
        .bind(i64::from(per_page))
        .bind(i64::from(offset))
        .fetch_all(pool)
        .await?;

        (
            i64_to_u64_checked(total.0, "local_members.total_count")?,
            rows,
        )
    } else {
        let total: (i64,) = sqlx::query_as(r#"SELECT COUNT(*) FROM local_members"#)
            .fetch_one(pool)
            .await?;

        let rows = sqlx::query_as::<
            _,
            (
                i64,
                String,
                String,
                Option<String>,
                String,
                Option<i64>,
                Option<String>,
            ),
        >(
            r#"SELECT user_id, username, name, avatar_url, updated_at, project_id, project_name
         FROM local_members
         ORDER BY updated_at DESC
         LIMIT ?1 OFFSET ?2
      "#,
        )
        .bind(i64::from(per_page))
        .bind(i64::from(offset))
        .fetch_all(pool)
        .await?;

        (
            i64_to_u64_checked(total.0, "local_members.total_count")?,
            rows,
        )
    };

    tracing::debug!(
        count = rows.len(),
        total = total,
        "[db] list_local_members result"
    );

    let mut items = Vec::with_capacity(rows.len());
    for r in rows {
        items.push(LocalMember {
            user_id: i64_to_u64_checked(r.0, "local_members.user_id")?,
            username: r.1,
            name: r.2,
            avatar_url: r.3,
            updated_at: r.4,
            project_id: option_i64_to_u64_checked(r.5, "local_members.project_id")?,
            project_name: r.6,
        });
    }

    Ok((items, total))
}

pub async fn delete_local_members(pool: &SqlitePool, user_ids: Vec<u64>) -> Result<()> {
    if user_ids.is_empty() {
        return Ok(());
    }
    // local_group_members 的 user_id 有 ON DELETE CASCADE，删除 local_members 时会自动清理
    let mut tx = pool.begin().await?;
    for uid in &user_ids {
        let uid_i64 = u64_to_i64_checked(*uid, "local_members.user_id")?;
        sqlx::query(r#"DELETE FROM local_members WHERE user_id = ?1"#)
            .bind(uid_i64)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    tracing::info!(count = user_ids.len(), "[db] delete_local_members");
    Ok(())
}

pub async fn create_local_group(pool: &SqlitePool, name: String) -> Result<LocalGroup> {
    tracing::info!(name = %name, "[db] create_local_group");

    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(r#"INSERT INTO local_groups (name, created_at) VALUES (?1, ?2)"#)
        .bind(&name)
        .bind(&now)
        .execute(pool)
        .await?;

    let id = res.last_insert_rowid();
    tracing::info!(group_id = id, name = %name, "[db] create_local_group success");
    Ok(LocalGroup {
        id,
        name,
        created_at: now,
        members_count: 0,
    })
}

pub async fn update_local_group(pool: &SqlitePool, id: i64, name: String) -> Result<()> {
    let result = sqlx::query(r#"UPDATE local_groups SET name = ?1 WHERE id = ?2"#)
        .bind(&name)
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(anyhow!("local group not found: {id}"));
    }
    tracing::info!(group_id = id, name = %name, "[db] update_local_group");
    Ok(())
}

pub async fn delete_local_group(pool: &SqlitePool, id: i64) -> Result<()> {
    // local_group_members 有 ON DELETE CASCADE，会自动清理
    let result = sqlx::query(r#"DELETE FROM local_groups WHERE id = ?1"#)
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(anyhow!("local group not found: {id}"));
    }
    tracing::info!(group_id = id, "[db] delete_local_group");
    Ok(())
}

pub async fn list_local_groups(pool: &SqlitePool) -> Result<Vec<LocalGroup>> {
    tracing::debug!("[db] list_local_groups");

    let rows = sqlx::query_as::<_, (i64, String, String, i64)>(
        r#"
    SELECT g.id, g.name, g.created_at, COUNT(gm.user_id) as members_count
    FROM local_groups g
    LEFT JOIN local_group_members gm ON gm.group_id = g.id
    GROUP BY g.id
    ORDER BY g.id DESC
    "#,
    )
    .fetch_all(pool)
    .await?;

    tracing::debug!(count = rows.len(), "[db] list_local_groups result");

    Ok(rows
        .into_iter()
        .map(|r| LocalGroup {
            id: r.0,
            name: r.1,
            created_at: r.2,
            members_count: r.3,
        })
        .collect())
}

pub async fn add_members_to_group(
    pool: &SqlitePool,
    group_id: i64,
    user_ids: Vec<u64>,
) -> Result<()> {
    let count = user_ids.len();
    tracing::info!(
        group_id = group_id,
        count = count,
        "[db] add_members_to_group"
    );

    let mut tx = pool.begin().await?;
    let now = Utc::now().to_rfc3339();

    for uid in user_ids {
        let uid_i64 = u64_to_i64_checked(uid, "local_group_members.user_id")?;
        sqlx::query(
            r#"INSERT OR IGNORE INTO local_group_members (group_id, user_id, created_at)
         VALUES (?1, ?2, ?3)"#,
        )
        .bind(group_id)
        .bind(uid_i64)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    tracing::info!(
        group_id = group_id,
        count = count,
        "[db] add_members_to_group completed"
    );
    Ok(())
}

pub async fn remove_members_from_group(
    pool: &SqlitePool,
    group_id: i64,
    user_ids: Vec<u64>,
) -> Result<()> {
    let count = user_ids.len();
    tracing::info!(
        group_id = group_id,
        count = count,
        "[db] remove_members_from_group"
    );

    let mut tx = pool.begin().await?;

    for uid in user_ids {
        let uid_i64 = u64_to_i64_checked(uid, "local_group_members.user_id")?;
        sqlx::query(r#"DELETE FROM local_group_members WHERE group_id=?1 AND user_id=?2"#)
            .bind(group_id)
            .bind(uid_i64)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    tracing::info!(
        group_id = group_id,
        count = count,
        "[db] remove_members_from_group completed"
    );
    Ok(())
}

pub async fn list_group_members(pool: &SqlitePool, group_id: i64) -> Result<Vec<LocalMember>> {
    tracing::debug!(group_id = group_id, "[db] list_group_members");

    let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, String, Option<i64>, Option<String>)>(
    r#"SELECT m.user_id, m.username, m.name, m.avatar_url, m.updated_at, m.project_id, m.project_name
       FROM local_members m
       INNER JOIN local_group_members gm ON gm.user_id = m.user_id
       WHERE gm.group_id = ?1
       ORDER BY m.username ASC"#,
  )
  .bind(group_id)
  .fetch_all(pool)
  .await?;

    tracing::debug!(
        group_id = group_id,
        count = rows.len(),
        "[db] list_group_members result"
    );

    let mut members = Vec::with_capacity(rows.len());
    for r in rows {
        members.push(LocalMember {
            user_id: i64_to_u64_checked(r.0, "local_members.user_id")?,
            username: r.1,
            name: r.2,
            avatar_url: r.3,
            updated_at: r.4,
            project_id: option_i64_to_u64_checked(r.5, "local_members.project_id")?,
            project_name: r.6,
        });
    }

    Ok(members)
}

/// 从 config 表读取 GitLab 配置，key = "gitlab"，value 为 JSON：{ "baseUrl": "...", "token": "..." }
pub async fn get_gitlab_config(pool: &SqlitePool) -> Result<Option<(String, String)>> {
    let row = sqlx::query_as::<_, (String,)>(r#"SELECT value FROM config WHERE key = 'gitlab'"#)
        .fetch_optional(pool)
        .await?;

    let Some((json,)) = row else {
        return Ok(None);
    };

    #[derive(serde::Deserialize)]
    struct Cfg {
        base_url: String,
        token: String,
    }
    let cfg: Cfg = serde_json::from_str(&json).context("parse gitlab config json")?;
    Ok(Some((cfg.base_url, cfg.token)))
}

/// 保存 GitLab 配置到 config 表
pub async fn set_gitlab_config(pool: &SqlitePool, base_url: &str, token: &str) -> Result<()> {
    let json = serde_json::json!({ "base_url": base_url, "token": token }).to_string();
    sqlx::query(
        r#"INSERT INTO config (key, value) VALUES ('gitlab', ?1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value"#,
    )
    .bind(&json)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    static TEST_MIGRATOR: Migrator = sqlx::migrate!();

    async fn setup_test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect in-memory sqlite");
        TEST_MIGRATOR.run(&pool).await.expect("run migrations");
        pool
    }

    #[tokio::test]
    async fn managed_projects_create_and_list() {
        let pool = setup_test_pool().await;

        let empty_projects = list_managed_projects(&pool)
            .await
            .expect("list empty managed projects");
        assert!(empty_projects.is_empty());

        let empty_groups = list_project_groups(&pool)
            .await
            .expect("list empty project groups");
        assert!(empty_groups.is_empty());

        let created = create_managed_project(
            &pool,
            10001,
            "project-alpha".to_string(),
            "group/project-alpha".to_string(),
            "D:/repos/project-alpha".to_string(),
            None,
            None,
            true,
        )
        .await
        .expect("create managed project");

        assert_eq!(created.gitlab_project_id, 10001);
        assert_eq!(created.default_branch, "main");
        assert_eq!(created.default_remote, "origin");
        assert!(created.enabled);

        let items = list_managed_projects(&pool)
            .await
            .expect("list managed projects");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].gitlab_project_id, 10001);
        assert_eq!(items[0].path_with_namespace, "group/project-alpha");
    }

    #[tokio::test]
    async fn project_groups_create_and_list() {
        let pool = setup_test_pool().await;

        let empty_groups = list_project_groups(&pool)
            .await
            .expect("list empty project groups");
        assert!(empty_groups.is_empty());

        let group = create_project_group(&pool, "delivery-train".to_string())
            .await
            .expect("create project group");

        assert_eq!(group.name, "delivery-train");
        assert_eq!(group.projects_count, 0);

        let groups = list_project_groups(&pool)
            .await
            .expect("list project groups");
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "delivery-train");
        assert_eq!(groups[0].projects_count, 0);

        let empty_projects = list_managed_projects(&pool)
            .await
            .expect("list empty managed projects");
        assert!(empty_projects.is_empty());
    }

    #[tokio::test]
    async fn project_groups_and_managed_projects_are_independent_create_list_flows() {
        let pool = setup_test_pool().await;

        let _group = create_project_group(&pool, "ops".to_string())
            .await
            .expect("create project group");

        let _project = create_managed_project(
            &pool,
            30001,
            "project-three".to_string(),
            "team/project-three".to_string(),
            "D:/repos/project-three".to_string(),
            None,
            None,
            true,
        )
        .await
        .expect("create managed project");

        let groups = list_project_groups(&pool)
            .await
            .expect("list project groups");
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].projects_count, 0);

        let projects = list_managed_projects(&pool)
            .await
            .expect("list managed projects");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].gitlab_project_id, 30001);
    }

    #[tokio::test]
    async fn managed_project_rejects_blank_name_by_constraint() {
        let pool = setup_test_pool().await;

        let result = create_managed_project(
            &pool,
            40001,
            "   ".to_string(),
            "team/project-four".to_string(),
            "D:/repos/project-four".to_string(),
            None,
            None,
            true,
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn managed_project_rejects_duplicate_gitlab_project_id() {
        let pool = setup_test_pool().await;

        let first = create_managed_project(
            &pool,
            50001,
            "project-first".to_string(),
            "team/project-first".to_string(),
            "D:/repos/project-first".to_string(),
            None,
            None,
            true,
        )
        .await;
        assert!(first.is_ok());

        let second = create_managed_project(
            &pool,
            50001,
            "project-second".to_string(),
            "team/project-second".to_string(),
            "D:/repos/project-second".to_string(),
            None,
            None,
            true,
        )
        .await;

        assert!(second.is_err());
    }

    #[tokio::test]
    async fn managed_project_update_changes_fields() {
        let pool = setup_test_pool().await;

        let created = create_managed_project(
            &pool,
            60001,
            "project-update-before".to_string(),
            "team/project-update-before".to_string(),
            "D:/repos/project-update-before".to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");

        update_managed_project(
            &pool,
            created.id,
            60002,
            "project-update-after".to_string(),
            "team/project-update-after".to_string(),
            "D:/repos/project-update-after".to_string(),
            "release".to_string(),
            "upstream".to_string(),
            false,
        )
        .await
        .expect("update managed project");

        let items = list_managed_projects(&pool)
            .await
            .expect("list managed projects");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].gitlab_project_id, 60002);
        assert_eq!(items[0].name, "project-update-after");
        assert_eq!(items[0].path_with_namespace, "team/project-update-after");
        assert_eq!(items[0].repo_path, "D:/repos/project-update-after");
        assert_eq!(items[0].default_branch, "release");
        assert_eq!(items[0].default_remote, "upstream");
        assert!(!items[0].enabled);
    }

    #[tokio::test]
    async fn managed_project_delete_removes_record() {
        let pool = setup_test_pool().await;

        let created = create_managed_project(
            &pool,
            70001,
            "project-delete".to_string(),
            "team/project-delete".to_string(),
            "D:/repos/project-delete".to_string(),
            None,
            None,
            true,
        )
        .await
        .expect("create managed project");

        delete_managed_project(&pool, created.id)
            .await
            .expect("delete managed project");

        let items = list_managed_projects(&pool)
            .await
            .expect("list managed projects");
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn project_group_update_and_delete() {
        let pool = setup_test_pool().await;

        let group = create_project_group(&pool, "group-before".to_string())
            .await
            .expect("create project group");

        update_project_group(&pool, group.id, "group-after".to_string())
            .await
            .expect("update project group");

        let listed = list_project_groups(&pool)
            .await
            .expect("list project groups after update");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "group-after");

        delete_project_group(&pool, group.id)
            .await
            .expect("delete project group");

        let listed_after_delete = list_project_groups(&pool)
            .await
            .expect("list project groups after delete");
        assert!(listed_after_delete.is_empty());
    }

    #[tokio::test]
    async fn update_local_group_errors_when_not_found() {
        let pool = setup_test_pool().await;

        let result = update_local_group(&pool, 99999, "missing-group".to_string()).await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("local group not found"));
    }

    #[tokio::test]
    async fn delete_local_group_errors_when_not_found() {
        let pool = setup_test_pool().await;

        let result = delete_local_group(&pool, 99999).await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("local group not found"));
    }

    #[tokio::test]
    async fn project_group_membership_add_list_remove() {
        let pool = setup_test_pool().await;

        let p1 = create_managed_project(
            &pool,
            80001,
            "project-1".to_string(),
            "team/project-1".to_string(),
            "D:/repos/project-1".to_string(),
            None,
            None,
            true,
        )
        .await
        .expect("create managed project 1");

        let p2 = create_managed_project(
            &pool,
            80002,
            "project-2".to_string(),
            "team/project-2".to_string(),
            "D:/repos/project-2".to_string(),
            None,
            None,
            true,
        )
        .await
        .expect("create managed project 2");

        let group = create_project_group(&pool, "delivery".to_string())
            .await
            .expect("create project group");

        add_projects_to_group(&pool, group.id, vec![p1.id, p2.id])
            .await
            .expect("add projects to group");

        let grouped_projects = list_project_group_projects(&pool, group.id)
            .await
            .expect("list grouped projects");
        assert_eq!(grouped_projects.len(), 2);

        remove_projects_from_group(&pool, group.id, vec![p2.id])
            .await
            .expect("remove project from group");

        let grouped_projects_after_remove = list_project_group_projects(&pool, group.id)
            .await
            .expect("list grouped projects after remove");
        assert_eq!(grouped_projects_after_remove.len(), 1);
        assert_eq!(grouped_projects_after_remove[0].id, p1.id);
    }

    #[tokio::test]
    async fn add_projects_to_group_errors_when_group_not_found() {
        let pool = setup_test_pool().await;

        let empty_ids_result = add_projects_to_group(&pool, 99999, vec![]).await;
        assert!(empty_ids_result.is_err());
        assert!(empty_ids_result
            .unwrap_err()
            .to_string()
            .contains("project group not found"));

        let project = create_managed_project(
            &pool,
            81001,
            "project-missing-group-add".to_string(),
            "team/project-missing-group-add".to_string(),
            "D:/repos/project-missing-group-add".to_string(),
            None,
            None,
            true,
        )
        .await
        .expect("create managed project");

        let non_empty_ids_result = add_projects_to_group(&pool, 99999, vec![project.id]).await;
        assert!(non_empty_ids_result.is_err());
        assert!(non_empty_ids_result
            .unwrap_err()
            .to_string()
            .contains("project group not found"));
    }

    #[tokio::test]
    async fn remove_projects_from_group_errors_when_group_not_found() {
        let pool = setup_test_pool().await;

        let empty_ids_result = remove_projects_from_group(&pool, 99999, vec![]).await;
        assert!(empty_ids_result.is_err());
        assert!(empty_ids_result
            .unwrap_err()
            .to_string()
            .contains("project group not found"));

        let non_empty_ids_result = remove_projects_from_group(&pool, 99999, vec![12345]).await;
        assert!(non_empty_ids_result.is_err());
        assert!(non_empty_ids_result
            .unwrap_err()
            .to_string()
            .contains("project group not found"));
    }

    #[tokio::test]
    async fn member_sync_resolves_union_of_group_members_and_selected_user_ids() {
        let pool = setup_test_pool().await;

        upsert_local_members(
            &pool,
            vec![
                LocalMemberUpsert {
                    user_id: 1001,
                    username: "alice".to_string(),
                    name: "Alice".to_string(),
                    avatar_url: None,
                    project_id: None,
                    project_name: None,
                },
                LocalMemberUpsert {
                    user_id: 1002,
                    username: "bob".to_string(),
                    name: "Bob".to_string(),
                    avatar_url: None,
                    project_id: None,
                    project_name: None,
                },
                LocalMemberUpsert {
                    user_id: 1003,
                    username: "carol".to_string(),
                    name: "Carol".to_string(),
                    avatar_url: None,
                    project_id: None,
                    project_name: None,
                },
            ],
        )
        .await
        .expect("seed local members");

        let local_group = create_local_group(&pool, "release-team".to_string())
            .await
            .expect("create local group");

        add_members_to_group(&pool, local_group.id, vec![1001, 1002])
            .await
            .expect("add members to local group");

        let resolved_user_ids =
            resolve_member_sync_user_ids(&pool, Some(local_group.id), vec![1002, 1003])
                .await
                .expect("resolve member sync user ids");

        assert_eq!(resolved_user_ids, vec![1001, 1002, 1003]);
    }

    #[tokio::test]
    async fn member_sync_rejects_unknown_local_group_source() {
        let pool = setup_test_pool().await;

        let result = resolve_member_sync_user_ids(&pool, Some(99999), vec![]).await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("local group not found"));
    }

    #[tokio::test]
    async fn workflow_definition_create_list_detail_preserves_step_order() {
        let pool = setup_test_pool().await;

        let created = create_workflow_definition(
            &pool,
            "release-flow".to_string(),
            "release flow".to_string(),
            true,
            serde_json::json!({
                "source_branch": {"type": "string"},
                "target_branch": {"type": "string"}
            }),
            2,
            vec![
                WorkflowStepInput {
                    step_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "${source_branch}" }),
                },
                WorkflowStepInput {
                    step_type: "git_merge".to_string(),
                    parameters: serde_json::json!({ "from": "${source_branch}" }),
                },
                WorkflowStepInput {
                    step_type: "git_push".to_string(),
                    parameters: serde_json::json!({ "remote": "origin" }),
                },
            ],
        )
        .await
        .expect("create workflow definition");

        let listed = list_workflow_definitions(&pool)
            .await
            .expect("list workflow definitions");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].steps_count, 3);

        let detail = get_workflow_definition_detail(&pool, created.id)
            .await
            .expect("get workflow definition detail");
        assert_eq!(detail.id, created.id);
        assert_eq!(detail.steps.len(), 3);
        assert_eq!(detail.steps[0].step_type, "checkout_branch");
        assert_eq!(detail.steps[1].step_type, "git_merge");
        assert_eq!(detail.steps[2].step_type, "git_push");
        assert_eq!(
            detail.steps[0].parameters,
            serde_json::json!({ "branch": "${source_branch}" })
        );
        assert_eq!(
            detail.steps[1].parameters,
            serde_json::json!({ "from": "${source_branch}" })
        );
    }

    #[tokio::test]
    async fn workflow_definition_update_and_delete() {
        let pool = setup_test_pool().await;

        let created = create_workflow_definition(
            &pool,
            "flow-before".to_string(),
            "before".to_string(),
            true,
            serde_json::json!({"source_branch": {"type": "string"}}),
            2,
            vec![WorkflowStepInput {
                step_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "${source_branch}" }),
            }],
        )
        .await
        .expect("create workflow definition");

        update_workflow_definition(
            &pool,
            created.id,
            "flow-after".to_string(),
            "after".to_string(),
            false,
            serde_json::json!({"target_branch": {"type": "string"}}),
            3,
            vec![
                WorkflowStepInput {
                    step_type: "git_pull".to_string(),
                    parameters: serde_json::json!({ "branch": "${target_branch}" }),
                },
                WorkflowStepInput {
                    step_type: "git_push".to_string(),
                    parameters: serde_json::json!({ "remote": "origin" }),
                },
            ],
        )
        .await
        .expect("update workflow definition");

        let detail = get_workflow_definition_detail(&pool, created.id)
            .await
            .expect("get workflow definition detail after update");
        assert_eq!(detail.name, "flow-after");
        assert!(!detail.enabled);
        assert_eq!(detail.max_concurrency_default, 3);
        assert_eq!(detail.steps.len(), 2);
        assert_eq!(detail.steps[0].step_type, "git_pull");
        assert_eq!(detail.steps[1].step_type, "git_push");

        delete_workflow_definition(&pool, created.id)
            .await
            .expect("delete workflow definition");

        let list_after_delete = list_workflow_definitions(&pool)
            .await
            .expect("list workflow definitions after delete");
        assert!(list_after_delete.is_empty());
    }

    #[tokio::test]
    async fn workflow_definition_rejects_non_object_variables_schema() {
        let pool = setup_test_pool().await;

        let result = create_workflow_definition(
            &pool,
            "invalid-variables-schema".to_string(),
            "invalid".to_string(),
            true,
            serde_json::json!(123),
            2,
            vec![WorkflowStepInput {
                step_type: "git_pull".to_string(),
                parameters: serde_json::json!({ "branch": "main" }),
            }],
        )
        .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("variables_schema must be a JSON object"));
    }

    #[tokio::test]
    async fn workflow_definition_rejects_non_object_step_parameters() {
        let pool = setup_test_pool().await;

        let result = create_workflow_definition(
            &pool,
            "invalid-step-parameters".to_string(),
            "invalid".to_string(),
            true,
            serde_json::json!({ "source_branch": { "type": "string" } }),
            2,
            vec![WorkflowStepInput {
                step_type: "git_pull".to_string(),
                parameters: serde_json::json!(["not-object"]),
            }],
        )
        .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("workflow step parameters must be a JSON object"));
    }

    #[tokio::test]
    async fn workflow_run_history_queries_return_nested_project_and_step_state() {
        let pool = setup_test_pool().await;

        let workflow = create_workflow_definition(
            &pool,
            "release-with-history".to_string(),
            "workflow run history coverage".to_string(),
            true,
            serde_json::json!({
                "source_branch": { "type": "string" },
                "target_branch": { "type": "string" }
            }),
            2,
            vec![WorkflowStepInput {
                step_type: "git_merge".to_string(),
                parameters: serde_json::json!({
                    "from": "${source_branch}",
                    "to": "${target_branch}"
                }),
            }],
        )
        .await
        .expect("create workflow definition");

        let project_group = create_project_group(&pool, "delivery-group".to_string())
            .await
            .expect("create project group");

        let managed_project = create_managed_project(
            &pool,
            99001,
            "project-history".to_string(),
            "team/project-history".to_string(),
            "D:/repos/project-history".to_string(),
            None,
            None,
            true,
        )
        .await
        .expect("create managed project");

        let now = Utc::now().to_rfc3339();
        let run_id = sqlx::query(
            r#"INSERT INTO workflow_runs (
             workflow_definition_id, project_group_id, source_workflow_run_id, trigger_kind,
             status, run_parameters_json, max_concurrency, started_at, finished_at, created_at, updated_at
           ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
        )
        .bind(workflow.id)
        .bind(project_group.id)
        .bind("manual")
        .bind("partial_failed")
        .bind(r#"{"source_branch":"release","target_branch":"main"}"#)
        .bind(2_i64)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert workflow run")
        .last_insert_rowid();

        let run_project_id = sqlx::query(
            r#"INSERT INTO workflow_run_projects (
             workflow_run_id, managed_project_id, gitlab_project_id, project_name, project_path_with_namespace, repo_path,
             status, summary_message, started_at, finished_at, created_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"#,
        )
        .bind(run_id)
        .bind(managed_project.id)
        .bind(u64_to_i64_checked(managed_project.gitlab_project_id, "gitlab_project_id").expect("convert project id"))
        .bind(&managed_project.name)
        .bind(&managed_project.path_with_namespace)
        .bind(&managed_project.repo_path)
        .bind("failed")
        .bind("git merge conflict")
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert workflow run project")
        .last_insert_rowid();

        sqlx::query(
            r#"INSERT INTO workflow_run_steps (
             workflow_run_project_id, workflow_step_id, step_order, step_type, rendered_parameters_json,
             status, started_at, finished_at, stdout, stderr, exit_code, summary_message, created_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"#,
        )
        .bind(run_project_id)
        .bind(Option::<i64>::None)
        .bind(0_i64)
        .bind("git_merge")
        .bind(r#"{"from":"release","to":"main"}"#)
        .bind("failed")
        .bind(&now)
        .bind(&now)
        .bind("stdout text")
        .bind("stderr text")
        .bind(1_i64)
        .bind("merge conflict")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert workflow run step");

        sqlx::query(
            r#"INSERT INTO workflow_run_steps (
             workflow_run_project_id, workflow_step_id, step_order, step_type, rendered_parameters_json,
             status, started_at, finished_at, stdout, stderr, exit_code, summary_message, created_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, ?8, NULL, ?9, ?10, ?11)"#,
        )
        .bind(run_project_id)
        .bind(Option::<i64>::None)
        .bind(1_i64)
        .bind("git_push")
        .bind(r#"{"remote":"origin"}"#)
        .bind("cancelled")
        .bind("")
        .bind("")
        .bind("cancelled after previous step failure")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert cancelled workflow run step");

        let list = list_workflow_runs(&pool)
            .await
            .expect("list workflow runs");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, run_id);
        assert_eq!(list[0].status, "partial_failed");
        assert_eq!(list[0].projects_total, 1);
        assert_eq!(list[0].projects_failed, 1);

        let detail = get_workflow_run_detail(&pool, run_id)
            .await
            .expect("get workflow run detail");
        assert_eq!(detail.id, run_id);
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "failed");
        assert_eq!(detail.projects[0].steps.len(), 2);
        assert_eq!(detail.projects[0].steps[0].step_type, "git_merge");
        assert_eq!(
            detail.projects[0].steps[0].rendered_parameters,
            serde_json::json!({"from":"release","to":"main"})
        );
        assert_eq!(detail.projects[0].steps[0].status, "failed");
        assert_eq!(detail.projects[0].steps[1].step_type, "git_push");
        assert_eq!(detail.projects[0].steps[1].status, "cancelled");
    }

    #[test]
    fn workflow_definition_step_input_accepts_camel_and_snake_case_keys() {
        let camel_case: WorkflowStepInput = serde_json::from_value(serde_json::json!({
            "stepType": "git_pull",
            "parameters": {}
        }))
        .expect("deserialize camelCase step input");
        assert_eq!(camel_case.step_type, "git_pull");

        let snake_case: WorkflowStepInput = serde_json::from_value(serde_json::json!({
            "step_type": "git_push",
            "parameters": {}
        }))
        .expect("deserialize snake_case step input");
        assert_eq!(snake_case.step_type, "git_push");
    }
}
