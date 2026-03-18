use crate::db::{self, WorkflowExecutionStepDef};
use crate::models::ManagedProject;
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde_json::{Map, Value};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::{Duration as StdDuration, Instant};
use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinSet;

const GIT_COMMAND_TIMEOUT_SECS: u64 = 120;

static REPO_LEASE_REGISTRY: OnceLock<TokioMutex<HashMap<String, Arc<TokioMutex<()>>>>> =
    OnceLock::new();

#[derive(Debug, Clone)]
struct RenderedStepDefinition {
    workflow_step_id: i64,
    step_order: i64,
    step_type: String,
    rendered_parameters: Value,
}

#[derive(Debug, Clone)]
struct ProjectExecutionStep {
    run_step_id: i64,
    step_type: String,
    rendered_parameters: Value,
}

#[derive(Debug, Clone)]
struct ProjectExecutionPlan {
    run_project_id: i64,
    project: ManagedProject,
    steps: Vec<ProjectExecutionStep>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProjectOutcome {
    Success,
    Failed,
    FailedPrecheck,
    Cancelled,
}

#[derive(Debug)]
struct RetrySourceRun {
    workflow_definition_id: i64,
    project_group_id: i64,
    run_parameters: Value,
}

#[derive(Debug)]
struct CommandResult {
    success: bool,
    stdout: String,
    stderr: String,
    exit_code: Option<i64>,
}

#[derive(Debug)]
enum StepOperation {
    CheckoutBranch {
        branch: String,
    },
    GitPull {
        remote: String,
        branch: String,
    },
    GitMerge {
        from: String,
    },
    GitPush {
        remote: String,
        branch: Option<String>,
    },
}

impl StepOperation {
    fn to_args(&self) -> Vec<String> {
        match self {
            Self::CheckoutBranch { branch } => vec!["checkout".to_string(), branch.clone()],
            Self::GitPull { remote, branch } => vec![
                "pull".to_string(),
                remote.clone(),
                branch.clone(),
                "--ff-only".to_string(),
            ],
            Self::GitMerge { from } => {
                vec!["merge".to_string(), "--no-edit".to_string(), from.clone()]
            }
            Self::GitPush { remote, branch } => {
                let mut args = vec!["push".to_string(), remote.clone()];
                if let Some(branch_name) = branch {
                    args.push(branch_name.clone());
                }
                args
            }
        }
    }
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn normalize_repo_lease_key(repo_path: &str) -> String {
    let normalized = repo_path.replace('\\', "/");
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn repo_lease_registry() -> &'static TokioMutex<HashMap<String, Arc<TokioMutex<()>>>> {
    REPO_LEASE_REGISTRY.get_or_init(|| TokioMutex::new(HashMap::new()))
}

async fn get_repo_lease(repo_path: &str) -> Arc<TokioMutex<()>> {
    let key = normalize_repo_lease_key(repo_path);
    let mut registry = repo_lease_registry().lock().await;
    registry
        .entry(key)
        .or_insert_with(|| Arc::new(TokioMutex::new(())))
        .clone()
}

fn normalize_run_parameters(value: Value) -> Result<Value> {
    match value {
        Value::Null => Ok(Value::Object(Map::new())),
        Value::Object(_) => Ok(value),
        _ => Err(anyhow!("run_parameters must be a JSON object")),
    }
}

fn json_primitive_to_string(value: &Value, key: &str) -> Result<String> {
    match value {
        Value::String(s) => Ok(s.clone()),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(b.to_string()),
        _ => Err(anyhow!(
            "run parameter '{key}' must be string/number/bool for string templating"
        )),
    }
}

fn render_template_string(template: &str, variables: &Map<String, Value>) -> Result<String> {
    let mut rendered = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("${") {
        rendered.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after
            .find('}')
            .ok_or_else(|| anyhow!("invalid placeholder in template: {template}"))?;
        let key = after[..end].trim();
        if key.is_empty() {
            return Err(anyhow!("empty placeholder in template: {template}"));
        }
        let value = variables
            .get(key)
            .ok_or_else(|| anyhow!("missing run parameter for placeholder: {key}"))?;
        rendered.push_str(&json_primitive_to_string(value, key)?);
        rest = &after[end + 1..];
    }

    rendered.push_str(rest);
    Ok(rendered)
}

fn render_value(value: &Value, variables: &Map<String, Value>) -> Result<Value> {
    match value {
        Value::String(raw) => Ok(Value::String(render_template_string(raw, variables)?)),
        Value::Array(values) => {
            let mut rendered = Vec::with_capacity(values.len());
            for item in values {
                rendered.push(render_value(item, variables)?);
            }
            Ok(Value::Array(rendered))
        }
        Value::Object(entries) => {
            let mut rendered = Map::with_capacity(entries.len());
            for (key, item) in entries {
                rendered.insert(key.clone(), render_value(item, variables)?);
            }
            Ok(Value::Object(rendered))
        }
        _ => Ok(value.clone()),
    }
}

fn read_required_string_param(parameters: &Value, key: &str) -> Result<String> {
    parameters
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| anyhow!("step parameter '{key}' is required"))
}

fn read_optional_string_param(parameters: &Value, key: &str) -> Option<String> {
    parameters
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn build_step_operation(
    step: &ProjectExecutionStep,
    project: &ManagedProject,
) -> Result<StepOperation> {
    match step.step_type.as_str() {
        "checkout_branch" => Ok(StepOperation::CheckoutBranch {
            branch: read_required_string_param(&step.rendered_parameters, "branch")?,
        }),
        "git_pull" => Ok(StepOperation::GitPull {
            remote: read_optional_string_param(&step.rendered_parameters, "remote")
                .unwrap_or_else(|| project.default_remote.clone()),
            branch: read_optional_string_param(&step.rendered_parameters, "branch")
                .unwrap_or_else(|| project.default_branch.clone()),
        }),
        "git_merge" => Ok(StepOperation::GitMerge {
            from: read_required_string_param(&step.rendered_parameters, "from")?,
        }),
        "git_push" => Ok(StepOperation::GitPush {
            remote: read_optional_string_param(&step.rendered_parameters, "remote")
                .unwrap_or_else(|| project.default_remote.clone()),
            branch: read_optional_string_param(&step.rendered_parameters, "branch"),
        }),
        other => Err(anyhow!("unsupported step type: {other}")),
    }
}

async fn run_git(repo_path: String, args: Vec<String>) -> Result<CommandResult> {
    tokio::task::spawn_blocking(move || {
        let mut child = std::process::Command::new("git")
            .args(args)
            .current_dir(repo_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .context("spawn git command")?;

        let deadline = Instant::now() + StdDuration::from_secs(GIT_COMMAND_TIMEOUT_SECS);
        loop {
            if let Some(status) = child.try_wait().context("poll git command status")? {
                let output = child
                    .wait_with_output()
                    .context("collect git command output")?;
                return Ok(CommandResult {
                    success: status.success(),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    exit_code: status.code().map(i64::from),
                });
            }

            if Instant::now() >= deadline {
                if let Some(status) = child.try_wait().context("poll git command status at timeout boundary")? {
                    let output = child
                        .wait_with_output()
                        .context("collect git command output at timeout boundary")?;
                    return Ok(CommandResult {
                        success: status.success(),
                        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                        exit_code: status.code().map(i64::from),
                    });
                }

                let _ = child.kill();
                let output = child.wait_with_output().ok();
                let timed_out_note =
                    format!("git command timed out after {GIT_COMMAND_TIMEOUT_SECS}s");
                let stdout = output
                    .as_ref()
                    .map(|value| String::from_utf8_lossy(&value.stdout).to_string())
                    .unwrap_or_default();
                let stderr_tail = output
                    .as_ref()
                    .map(|value| String::from_utf8_lossy(&value.stderr).to_string())
                    .unwrap_or_default();
                let stderr = if stderr_tail.trim().is_empty() {
                    timed_out_note
                } else {
                    format!("{timed_out_note}; stderr={stderr_tail}")
                };
                return Ok(CommandResult {
                    success: false,
                    stdout,
                    stderr,
                    exit_code: None,
                });
            }

            std::thread::sleep(StdDuration::from_millis(100));
        }
    })
    .await
    .context("join git command task")?
}

async fn ensure_clean_worktree(repo_path: &str) -> Result<()> {
    let status_result = run_git(
        repo_path.to_string(),
        vec!["status".to_string(), "--porcelain".to_string()],
    )
    .await?;
    if !status_result.success {
        return Err(anyhow!(
            "git status failed: {}",
            status_result.stderr.trim()
        ));
    }
    if !status_result.stdout.trim().is_empty() {
        return Err(anyhow!("repository worktree is not clean"));
    }
    Ok(())
}

async fn ensure_remote_exists(repo_path: &str, remote: &str) -> Result<()> {
    let result = run_git(
        repo_path.to_string(),
        vec![
            "remote".to_string(),
            "get-url".to_string(),
            remote.to_string(),
        ],
    )
    .await?;
    if result.success {
        Ok(())
    } else {
        Err(anyhow!(
            "git remote '{}' not configured: {}",
            remote,
            result.stderr.trim()
        ))
    }
}

async fn ensure_branch_exists(repo_path: &str, branch: &str, remote: &str) -> Result<()> {
    let local = run_git(
        repo_path.to_string(),
        vec![
            "rev-parse".to_string(),
            "--verify".to_string(),
            branch.to_string(),
        ],
    )
    .await?;
    if local.success {
        return Ok(());
    }

    let remote_ref = format!("{remote}/{branch}");
    let remote_result = run_git(
        repo_path.to_string(),
        vec![
            "rev-parse".to_string(),
            "--verify".to_string(),
            remote_ref.clone(),
        ],
    )
    .await?;
    if remote_result.success {
        return Ok(());
    }

    Err(anyhow!(
        "branch '{}' not found locally or as '{}'",
        branch,
        remote_ref
    ))
}

async fn run_repo_precheck(project: &ManagedProject) -> Result<()> {
    let repo_path = Path::new(&project.repo_path);
    if !repo_path.exists() {
        return Err(anyhow!(
            "repository path does not exist: {}",
            project.repo_path
        ));
    }
    if !repo_path.is_dir() {
        return Err(anyhow!(
            "repository path is not a directory: {}",
            project.repo_path
        ));
    }

    let inside_repo = run_git(
        project.repo_path.clone(),
        vec!["rev-parse".to_string(), "--is-inside-work-tree".to_string()],
    )
    .await?;
    if !inside_repo.success || inside_repo.stdout.trim() != "true" {
        return Err(anyhow!("path is not a git worktree: {}", project.repo_path));
    }

    ensure_clean_worktree(&project.repo_path).await?;
    Ok(())
}

async fn run_step_prechecks(project: &ManagedProject, operation: &StepOperation) -> Result<()> {
    match operation {
        StepOperation::CheckoutBranch { branch } => {
            ensure_clean_worktree(&project.repo_path).await?;
            ensure_branch_exists(&project.repo_path, branch, &project.default_remote).await
        }
        StepOperation::GitPull { remote, branch } => {
            ensure_clean_worktree(&project.repo_path).await?;
            ensure_remote_exists(&project.repo_path, remote).await?;
            ensure_branch_exists(&project.repo_path, branch, remote).await
        }
        StepOperation::GitMerge { from } => {
            ensure_clean_worktree(&project.repo_path).await?;
            ensure_branch_exists(&project.repo_path, from, &project.default_remote).await
        }
        StepOperation::GitPush { remote, .. } => {
            ensure_remote_exists(&project.repo_path, remote).await
        }
    }
}

async fn insert_workflow_run_row(
    tx: &mut Transaction<'_, Sqlite>,
    workflow_definition_id: i64,
    project_group_id: i64,
    source_workflow_run_id: Option<i64>,
    trigger_kind: &str,
    run_parameters: &Value,
    max_concurrency: i64,
) -> Result<i64> {
    let now = now_rfc3339();
    let run_parameters_json =
        serde_json::to_string(run_parameters).context("serialize workflow run parameters")?;
    let result = sqlx::query(
        r#"INSERT INTO workflow_runs (
         workflow_definition_id, project_group_id, source_workflow_run_id, trigger_kind,
         status, run_parameters_json, max_concurrency, started_at, finished_at, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)"#,
    )
    .bind(workflow_definition_id)
    .bind(project_group_id)
    .bind(source_workflow_run_id)
    .bind(trigger_kind)
    .bind("running")
    .bind(run_parameters_json)
    .bind(max_concurrency)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&mut **tx)
    .await?;

    Ok(result.last_insert_rowid())
}

async fn insert_workflow_run_project_row(
    tx: &mut Transaction<'_, Sqlite>,
    workflow_run_id: i64,
    project: &ManagedProject,
) -> Result<i64> {
    let now = now_rfc3339();
    let gitlab_project_id = i64::try_from(project.gitlab_project_id).map_err(|_| {
        anyhow!(
            "gitlab_project_id out of range: {}",
            project.gitlab_project_id
        )
    })?;
    let result = sqlx::query(
        r#"INSERT INTO workflow_run_projects (
         workflow_run_id, managed_project_id, gitlab_project_id, project_name, project_path_with_namespace, repo_path,
         status, summary_message, started_at, finished_at, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', NULL, NULL, ?8, ?9)"#,
    )
    .bind(workflow_run_id)
    .bind(project.id)
    .bind(gitlab_project_id)
    .bind(&project.name)
    .bind(&project.path_with_namespace)
    .bind(&project.repo_path)
    .bind("queued")
    .bind(&now)
    .bind(&now)
    .execute(&mut **tx)
    .await?;

    Ok(result.last_insert_rowid())
}

async fn insert_workflow_run_step_row(
    tx: &mut Transaction<'_, Sqlite>,
    workflow_run_project_id: i64,
    rendered_step: &RenderedStepDefinition,
) -> Result<i64> {
    let now = now_rfc3339();
    let rendered_parameters_json = serde_json::to_string(&rendered_step.rendered_parameters)
        .context("serialize rendered step parameters")?;
    let result = sqlx::query(
        r#"INSERT INTO workflow_run_steps (
         workflow_run_project_id, workflow_step_id, step_order, step_type, rendered_parameters_json,
         status, started_at, finished_at, stdout, stderr, exit_code, summary_message, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, '', '', NULL, '', ?7, ?8)"#,
    )
    .bind(workflow_run_project_id)
    .bind(rendered_step.workflow_step_id)
    .bind(rendered_step.step_order)
    .bind(&rendered_step.step_type)
    .bind(rendered_parameters_json)
    .bind("pending")
    .bind(&now)
    .bind(&now)
    .execute(&mut **tx)
    .await?;

    Ok(result.last_insert_rowid())
}

async fn seed_workflow_run_and_children(
    pool: &SqlitePool,
    workflow_definition_id: i64,
    project_group_id: i64,
    source_workflow_run_id: Option<i64>,
    trigger_kind: &str,
    run_parameters: &Value,
    max_concurrency: i64,
    projects: Vec<ManagedProject>,
    rendered_steps: &[RenderedStepDefinition],
) -> Result<(i64, Vec<ProjectExecutionPlan>)> {
    let mut tx = pool.begin().await?;
    let workflow_run_id = insert_workflow_run_row(
        &mut tx,
        workflow_definition_id,
        project_group_id,
        source_workflow_run_id,
        trigger_kind,
        run_parameters,
        max_concurrency,
    )
    .await?;

    let mut plans = Vec::with_capacity(projects.len());
    for project in projects {
        let run_project_id =
            insert_workflow_run_project_row(&mut tx, workflow_run_id, &project).await?;
        let mut project_steps = Vec::with_capacity(rendered_steps.len());
        for rendered_step in rendered_steps {
            let run_step_id =
                insert_workflow_run_step_row(&mut tx, run_project_id, rendered_step).await?;
            project_steps.push(ProjectExecutionStep {
                run_step_id,
                step_type: rendered_step.step_type.clone(),
                rendered_parameters: rendered_step.rendered_parameters.clone(),
            });
        }
        plans.push(ProjectExecutionPlan {
            run_project_id,
            project,
            steps: project_steps,
        });
    }

    tx.commit().await?;
    Ok((workflow_run_id, plans))
}

async fn mark_workflow_run_finished(
    pool: &SqlitePool,
    workflow_run_id: i64,
    status: &str,
) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE workflow_runs
       SET status = ?1,
           finished_at = ?2,
           updated_at = ?3
       WHERE id = ?4"#,
    )
    .bind(status)
    .bind(&now)
    .bind(&now)
    .bind(workflow_run_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn load_workflow_run_status(pool: &SqlitePool, workflow_run_id: i64) -> Result<String> {
    sqlx::query_scalar::<_, String>(r#"SELECT status FROM workflow_runs WHERE id = ?1"#)
        .bind(workflow_run_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow!("workflow run not found: {workflow_run_id}"))
}

async fn is_workflow_run_cancelling(pool: &SqlitePool, workflow_run_id: i64) -> Result<bool> {
    Ok(load_workflow_run_status(pool, workflow_run_id).await? == "cancelling")
}

fn derive_run_final_status(has_failures: bool, has_cancelled: bool) -> &'static str {
    if has_failures {
        "partial_failed"
    } else if has_cancelled {
        "cancelled"
    } else {
        "completed"
    }
}

fn derive_run_final_status_from_project_counts(
    project_total: i64,
    project_success: i64,
    project_failures: i64,
    project_cancelled: i64,
    project_non_terminal: i64,
) -> &'static str {
    let has_failures = project_failures > 0;
    let has_cancelled = project_total == 0
        || project_cancelled > 0
        || project_non_terminal > 0
        || project_success != project_total;
    derive_run_final_status(has_failures, has_cancelled)
}

pub async fn reconcile_stale_workflow_runs(pool: &SqlitePool) -> Result<usize> {
    let stale_run_rows = sqlx::query_as::<_, (i64,)>(
        r#"SELECT id
       FROM workflow_runs
       WHERE status IN ('running', 'cancelling')
       ORDER BY id ASC"#,
    )
    .fetch_all(pool)
    .await?;
    if stale_run_rows.is_empty() {
        return Ok(0);
    }

    let stale_summary = "reconciled stale in-flight run after process restart";
    let now = now_rfc3339();
    for (run_id,) in &stale_run_rows {
        let mut tx = pool.begin().await?;

        sqlx::query(
            r#"UPDATE workflow_run_steps
           SET status = 'cancelled',
               summary_message = CASE
                   WHEN trim(summary_message) = '' THEN ?1
                   ELSE summary_message || '; ' || ?1
               END,
               finished_at = COALESCE(finished_at, ?2),
               updated_at = ?3
           WHERE status IN ('pending', 'running')
             AND workflow_run_project_id IN (
               SELECT id FROM workflow_run_projects WHERE workflow_run_id = ?4
             )"#,
        )
        .bind(stale_summary)
        .bind(&now)
        .bind(&now)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"UPDATE workflow_run_projects
           SET status = 'cancelled',
               summary_message = CASE
                   WHEN trim(summary_message) = '' THEN ?1
                   ELSE summary_message || '; ' || ?1
               END,
               finished_at = COALESCE(finished_at, ?2),
               updated_at = ?3
           WHERE workflow_run_id = ?4
             AND status IN ('queued', 'running')"#,
        )
        .bind(stale_summary)
        .bind(&now)
        .bind(&now)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

        let (project_total, project_success, project_failures, project_cancelled, project_non_terminal) =
            sqlx::query_as::<_, (i64, i64, i64, i64, i64)>(
                r#"SELECT
               COUNT(*) as project_total,
               COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) as project_success,
               COALESCE(SUM(CASE WHEN status IN ('failed', 'failed_precheck') THEN 1 ELSE 0 END), 0) as project_failures,
               COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as project_cancelled,
               COALESCE(SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END), 0) as project_non_terminal
             FROM workflow_run_projects
             WHERE workflow_run_id = ?1"#,
            )
            .bind(run_id)
            .fetch_one(&mut *tx)
            .await?;

        let final_status = derive_run_final_status_from_project_counts(
            project_total,
            project_success,
            project_failures,
            project_cancelled,
            project_non_terminal,
        );

        sqlx::query(
            r#"UPDATE workflow_runs
           SET status = ?1,
               finished_at = COALESCE(finished_at, ?2),
               updated_at = ?3
           WHERE id = ?4
             AND status IN ('running', 'cancelling')"#,
        )
        .bind(final_status)
        .bind(&now)
        .bind(&now)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        tracing::warn!(
            workflow_run_id = run_id,
            final_status = final_status,
            "reconciled stale in-flight workflow run"
        );
    }

    Ok(stale_run_rows.len())
}

async fn mark_project_running(pool: &SqlitePool, run_project_id: i64) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE workflow_run_projects
       SET status = 'running',
           started_at = ?1,
           updated_at = ?2
       WHERE id = ?3"#,
    )
    .bind(&now)
    .bind(&now)
    .bind(run_project_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_project_finished(
    pool: &SqlitePool,
    run_project_id: i64,
    status: &str,
    summary_message: &str,
) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE workflow_run_projects
       SET status = ?1,
           summary_message = ?2,
           finished_at = ?3,
           updated_at = ?4
       WHERE id = ?5"#,
    )
    .bind(status)
    .bind(summary_message)
    .bind(&now)
    .bind(&now)
    .bind(run_project_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_step_running(pool: &SqlitePool, run_step_id: i64) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE workflow_run_steps
       SET status = 'running',
           started_at = ?1,
           updated_at = ?2
       WHERE id = ?3"#,
    )
    .bind(&now)
    .bind(&now)
    .bind(run_step_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_step_finished(
    pool: &SqlitePool,
    run_step_id: i64,
    status: &str,
    stdout: &str,
    stderr: &str,
    exit_code: Option<i64>,
    summary_message: &str,
) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE workflow_run_steps
       SET status = ?1,
           stdout = ?2,
           stderr = ?3,
           exit_code = ?4,
           summary_message = ?5,
           finished_at = ?6,
           updated_at = ?7
       WHERE id = ?8"#,
    )
    .bind(status)
    .bind(stdout)
    .bind(stderr)
    .bind(exit_code)
    .bind(summary_message)
    .bind(&now)
    .bind(&now)
    .bind(run_step_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_step_status(pool: &SqlitePool, run_step_id: i64) -> Result<String> {
    sqlx::query_scalar::<_, String>(r#"SELECT status FROM workflow_run_steps WHERE id = ?1"#)
        .bind(run_step_id)
        .fetch_one(pool)
        .await
        .context("load workflow step status")
}

async fn mark_remaining_steps_skipped(
    pool: &SqlitePool,
    steps: &[ProjectExecutionStep],
    from_index: usize,
    summary_message: &str,
) -> Result<()> {
    for step in steps.iter().skip(from_index) {
        let status = load_step_status(pool, step.run_step_id).await?;
        if status == "pending" {
            mark_step_finished(
                pool,
                step.run_step_id,
                "skipped",
                "",
                "",
                None,
                summary_message,
            )
            .await?;
        }
    }
    Ok(())
}

async fn mark_remaining_steps_cancelled(
    pool: &SqlitePool,
    steps: &[ProjectExecutionStep],
    from_index: usize,
    summary_message: &str,
) -> Result<()> {
    for step in steps.iter().skip(from_index) {
        let status = load_step_status(pool, step.run_step_id).await?;
        if status == "pending" || status == "running" {
            mark_step_finished(
                pool,
                step.run_step_id,
                "cancelled",
                "",
                "",
                None,
                summary_message,
            )
            .await?;
        }
    }
    Ok(())
}

async fn maybe_cancel_project(
    pool: &SqlitePool,
    workflow_run_id: i64,
    plan: &ProjectExecutionPlan,
    from_step_index: usize,
    summary_message: &str,
) -> Result<bool> {
    if !is_workflow_run_cancelling(pool, workflow_run_id).await? {
        return Ok(false);
    }

    mark_remaining_steps_cancelled(pool, &plan.steps, from_step_index, summary_message).await?;
    mark_project_finished(pool, plan.run_project_id, "cancelled", summary_message).await?;
    Ok(true)
}

async fn mark_project_internal_failure(
    pool: &SqlitePool,
    plan: &ProjectExecutionPlan,
    message: &str,
) -> Result<()> {
    let mut consumed_first_unfinished = false;
    for step in &plan.steps {
        let status = load_step_status(pool, step.run_step_id).await?;
        if status == "success" || status == "failed" || status == "skipped" || status == "cancelled"
        {
            continue;
        }

        if !consumed_first_unfinished {
            mark_step_finished(pool, step.run_step_id, "failed", "", "", None, message).await?;
            consumed_first_unfinished = true;
        } else if status == "pending" {
            mark_step_finished(
                pool,
                step.run_step_id,
                "skipped",
                "",
                "",
                None,
                "skipped after executor internal error",
            )
            .await?;
        }
    }
    mark_project_finished(pool, plan.run_project_id, "failed", message).await
}

async fn execute_project_plan(
    pool: &SqlitePool,
    workflow_run_id: i64,
    plan: &ProjectExecutionPlan,
) -> Result<ProjectOutcome> {
    let repo_lease = get_repo_lease(&plan.project.repo_path).await;
    let _repo_guard = repo_lease.lock().await;

    if maybe_cancel_project(
        pool,
        workflow_run_id,
        plan,
        0,
        "cancelled before project execution",
    )
    .await?
    {
        return Ok(ProjectOutcome::Cancelled);
    }

    mark_project_running(pool, plan.run_project_id).await?;

    if let Err(error) = run_repo_precheck(&plan.project).await {
        if maybe_cancel_project(
            pool,
            workflow_run_id,
            plan,
            0,
            "cancelled during repository precheck",
        )
        .await?
        {
            return Ok(ProjectOutcome::Cancelled);
        }

        let summary = format!("repo precheck failed: {error}");
        if let Some(first_step) = plan.steps.first() {
            mark_step_running(pool, first_step.run_step_id).await?;
            mark_step_finished(
                pool,
                first_step.run_step_id,
                "failed",
                "",
                "",
                None,
                &summary,
            )
            .await?;
            mark_remaining_steps_skipped(pool, &plan.steps, 1, "skipped after precheck failure")
                .await?;
        }
        mark_project_finished(pool, plan.run_project_id, "failed_precheck", &summary).await?;
        return Ok(ProjectOutcome::FailedPrecheck);
    }

    if maybe_cancel_project(
        pool,
        workflow_run_id,
        plan,
        0,
        "cancelled before step execution",
    )
    .await?
    {
        return Ok(ProjectOutcome::Cancelled);
    }

    for (step_index, step) in plan.steps.iter().enumerate() {
        if maybe_cancel_project(
            pool,
            workflow_run_id,
            plan,
            step_index,
            "cancelled before step execution",
        )
        .await?
        {
            return Ok(ProjectOutcome::Cancelled);
        }

        mark_step_running(pool, step.run_step_id).await?;

        if maybe_cancel_project(
            pool,
            workflow_run_id,
            plan,
            step_index,
            "cancelled before step execution",
        )
        .await?
        {
            return Ok(ProjectOutcome::Cancelled);
        }

        let operation = match build_step_operation(step, &plan.project) {
            Ok(operation) => operation,
            Err(error) => {
                let summary = format!("invalid step parameters: {error}");
                mark_step_finished(pool, step.run_step_id, "failed", "", "", None, &summary)
                    .await?;
                mark_remaining_steps_skipped(
                    pool,
                    &plan.steps,
                    step_index + 1,
                    "skipped after previous step failure",
                )
                .await?;
                mark_project_finished(pool, plan.run_project_id, "failed_precheck", &summary)
                    .await?;
                return Ok(ProjectOutcome::FailedPrecheck);
            }
        };

        if let Err(error) = run_step_prechecks(&plan.project, &operation).await {
            if maybe_cancel_project(
                pool,
                workflow_run_id,
                plan,
                step_index,
                "cancelled during step precheck",
            )
            .await?
            {
                return Ok(ProjectOutcome::Cancelled);
            }

            let summary = format!("step precheck failed: {error}");
            mark_step_finished(pool, step.run_step_id, "failed", "", "", None, &summary).await?;
            mark_remaining_steps_skipped(
                pool,
                &plan.steps,
                step_index + 1,
                "skipped after previous step failure",
            )
            .await?;
            mark_project_finished(pool, plan.run_project_id, "failed_precheck", &summary).await?;
            return Ok(ProjectOutcome::FailedPrecheck);
        }

        if maybe_cancel_project(
            pool,
            workflow_run_id,
            plan,
            step_index,
            "cancelled before step execution",
        )
        .await?
        {
            return Ok(ProjectOutcome::Cancelled);
        }

        let command_result = run_git(plan.project.repo_path.clone(), operation.to_args()).await?;

        if command_result.success {
            mark_step_finished(
                pool,
                step.run_step_id,
                "success",
                &command_result.stdout,
                &command_result.stderr,
                command_result.exit_code,
                "step completed",
            )
            .await?;

            if step_index + 1 < plan.steps.len() {
                if maybe_cancel_project(
                    pool,
                    workflow_run_id,
                    plan,
                    step_index + 1,
                    "cancelled after safe execution boundary",
                )
                .await?
                {
                    return Ok(ProjectOutcome::Cancelled);
                }
            }
        } else {
            let summary = format!("git command failed at step {}", step.step_type);
            mark_step_finished(
                pool,
                step.run_step_id,
                "failed",
                &command_result.stdout,
                &command_result.stderr,
                command_result.exit_code,
                &summary,
            )
            .await?;
            mark_remaining_steps_skipped(
                pool,
                &plan.steps,
                step_index + 1,
                "skipped after previous step failure",
            )
            .await?;
            mark_project_finished(pool, plan.run_project_id, "failed", &summary).await?;
            return Ok(ProjectOutcome::Failed);
        }
    }

    mark_project_finished(pool, plan.run_project_id, "success", "all steps completed").await?;
    Ok(ProjectOutcome::Success)
}

fn render_steps_for_run(
    step_defs: &[WorkflowExecutionStepDef],
    run_parameters: &Value,
) -> Result<Vec<RenderedStepDefinition>> {
    let variable_map = run_parameters
        .as_object()
        .ok_or_else(|| anyhow!("run_parameters must be a JSON object"))?;
    let mut rendered_steps = Vec::with_capacity(step_defs.len());
    for step in step_defs {
        rendered_steps.push(RenderedStepDefinition {
            workflow_step_id: step.id,
            step_order: step.step_order,
            step_type: step.step_type.clone(),
            rendered_parameters: render_value(&step.parameters, variable_map)?,
        });
    }
    Ok(rendered_steps)
}

async fn mark_unscheduled_plans_cancelled(
    pool: &SqlitePool,
    plans: &[ProjectExecutionPlan],
    from_index: usize,
) -> Result<usize> {
    let mut marked = 0usize;
    for plan in plans.iter().skip(from_index) {
        mark_remaining_steps_cancelled(
            pool,
            &plan.steps,
            0,
            "cancelled before project scheduling",
        )
        .await?;
        mark_project_finished(
            pool,
            plan.run_project_id,
            "cancelled",
            "cancelled before project scheduling",
        )
        .await?;
        marked += 1;
    }
    Ok(marked)
}

async fn stop_scheduling_and_cancel_unscheduled(
    pool: &SqlitePool,
    plans: &[ProjectExecutionPlan],
    next_plan_index: &mut usize,
) -> Result<bool> {
    if *next_plan_index >= plans.len() {
        return Ok(false);
    }

    let cancelled_count = mark_unscheduled_plans_cancelled(pool, plans, *next_plan_index).await?;
    *next_plan_index = plans.len();
    Ok(cancelled_count > 0)
}

async fn run_workflow_in_background(
    pool: SqlitePool,
    workflow_run_id: i64,
    plans: Vec<ProjectExecutionPlan>,
    max_concurrency: i64,
) -> Result<()> {
    if plans.is_empty() {
        mark_workflow_run_finished(&pool, workflow_run_id, "completed").await?;
        return Ok(());
    }

    let max_concurrency_usize = usize::try_from(max_concurrency)
        .map_err(|_| anyhow!("max_concurrency is out of range: {max_concurrency}"))?;
    let mut join_set = JoinSet::new();
    let mut next_plan_index = 0usize;
    let mut cancellation_observed = false;

    let mut has_failures = false;
    let mut has_cancelled = false;

    loop {
        if !cancellation_observed {
            match is_workflow_run_cancelling(&pool, workflow_run_id).await {
                Ok(true) => {
                    cancellation_observed = true;
                    if stop_scheduling_and_cancel_unscheduled(
                        &pool,
                        &plans,
                        &mut next_plan_index,
                    )
                    .await?
                    {
                        has_cancelled = true;
                    }
                }
                Ok(false) => {}
                Err(error) => {
                    tracing::error!(
                        workflow_run_id = workflow_run_id,
                        error = %error,
                        "failed to read workflow run cancellation status; stopping scheduler to avoid queuing additional projects"
                    );
                    cancellation_observed = true;
                    has_failures = true;
                    if stop_scheduling_and_cancel_unscheduled(
                        &pool,
                        &plans,
                        &mut next_plan_index,
                    )
                    .await?
                    {
                        has_cancelled = true;
                    }
                }
            }
        }

        while !cancellation_observed
            && join_set.len() < max_concurrency_usize
            && next_plan_index < plans.len()
        {
            let plan = plans[next_plan_index].clone();
            next_plan_index += 1;

            let pool_cloned = pool.clone();
            join_set.spawn(async move {
                match execute_project_plan(&pool_cloned, workflow_run_id, &plan).await {
                    Ok(outcome) => outcome,
                    Err(error) => {
                        let message = format!("executor internal error: {error}");
                        let _ = mark_project_internal_failure(&pool_cloned, &plan, &message).await;
                        ProjectOutcome::Failed
                    }
                }
            });
        }

        if join_set.is_empty() && (next_plan_index >= plans.len() || cancellation_observed) {
            break;
        }

        if let Some(join_result) = join_set.join_next().await {
            match join_result {
                Ok(ProjectOutcome::Success) => {}
                Ok(ProjectOutcome::Failed | ProjectOutcome::FailedPrecheck) => {
                    has_failures = true;
                }
                Ok(ProjectOutcome::Cancelled) => {
                    has_cancelled = true;
                }
                Err(error) => {
                    tracing::error!(error = %error, "workflow project task join failed");
                    has_failures = true;
                }
            }
        }
    }

    let final_status = derive_run_final_status(has_failures, has_cancelled);

    mark_workflow_run_finished(&pool, workflow_run_id, final_status).await?;
    Ok(())
}

async fn load_retry_source_run(pool: &SqlitePool, source_workflow_run_id: i64) -> Result<RetrySourceRun> {
    let (workflow_definition_id, project_group_id, status, run_parameters_json) =
        sqlx::query_as::<_, (i64, i64, String, String)>(
            r#"SELECT workflow_definition_id, project_group_id, status, run_parameters_json
           FROM workflow_runs
           WHERE id = ?1"#,
        )
        .bind(source_workflow_run_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow!("workflow run not found: {source_workflow_run_id}"))?;

    if status == "pending" || status == "running" || status == "cancelling" {
        return Err(anyhow!(
            "workflow run is not in terminal status for retry: {source_workflow_run_id}, status={status}"
        ));
    }

    let parsed_run_parameters =
        serde_json::from_str::<Value>(&run_parameters_json).context("parse source run parameters")?;
    let run_parameters = normalize_run_parameters(parsed_run_parameters)?;

    Ok(RetrySourceRun {
        workflow_definition_id,
        project_group_id,
        run_parameters,
    })
}

async fn load_failed_project_ids_for_retry(
    pool: &SqlitePool,
    source_workflow_run_id: i64,
) -> Result<Vec<i64>> {
    let rows = sqlx::query_as::<_, (Option<i64>,)>(
        r#"SELECT managed_project_id
       FROM workflow_run_projects
       WHERE workflow_run_id = ?1
         AND status IN ('failed', 'failed_precheck')
       ORDER BY id ASC"#,
    )
    .bind(source_workflow_run_id)
    .fetch_all(pool)
    .await?;

    let mut seen = HashSet::<i64>::new();
    let mut failed_project_ids = Vec::new();
    for row in rows {
        if let Some(managed_project_id) = row.0 {
            if seen.insert(managed_project_id) {
                failed_project_ids.push(managed_project_id);
            }
        }
    }

    Ok(failed_project_ids)
}

#[allow(clippy::too_many_arguments)]
async fn start_workflow_run_with_projects(
    pool: &SqlitePool,
    workflow_definition_id: i64,
    project_group_id: i64,
    run_parameters: Value,
    max_concurrency_override: Option<i64>,
    source_workflow_run_id: Option<i64>,
    trigger_kind: &str,
    projects: Vec<ManagedProject>,
) -> Result<i64> {
    let run_parameters = normalize_run_parameters(run_parameters)?;
    let workflow = db::load_workflow_definition_for_execution(pool, workflow_definition_id).await?;

    let max_concurrency = match max_concurrency_override {
        Some(value) if value >= 1 => value,
        Some(value) => {
            return Err(anyhow!(
                "max_concurrency_override must be >= 1, got {value}"
            ))
        }
        None => workflow.max_concurrency_default,
    };
    if max_concurrency < 1 {
        return Err(anyhow!("workflow max concurrency must be >= 1"));
    }

    let rendered_steps = render_steps_for_run(&workflow.steps, &run_parameters)?;
    let (workflow_run_id, plans) = seed_workflow_run_and_children(
        pool,
        workflow.id,
        project_group_id,
        source_workflow_run_id,
        trigger_kind,
        &run_parameters,
        max_concurrency,
        projects,
        &rendered_steps,
    )
    .await?;

    if plans.is_empty() {
        mark_workflow_run_finished(pool, workflow_run_id, "completed").await?;
        return Ok(workflow_run_id);
    }

    let pool_for_task = pool.clone();
    tokio::spawn(async move {
        if let Err(error) = run_workflow_in_background(
            pool_for_task.clone(),
            workflow_run_id,
            plans,
            max_concurrency,
        )
        .await
        {
            tracing::error!(workflow_run_id = workflow_run_id, error = %error, "workflow background execution failed");
            let _ =
                mark_workflow_run_finished(&pool_for_task, workflow_run_id, "partial_failed").await;
        }
    });

    Ok(workflow_run_id)
}

pub async fn execute_workflow_run(
    pool: &SqlitePool,
    workflow_definition_id: i64,
    project_group_id: i64,
    run_parameters: Value,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
    let mut projects = db::list_project_group_projects(pool, project_group_id).await?;
    projects.retain(|project| project.enabled);

    start_workflow_run_with_projects(
        pool,
        workflow_definition_id,
        project_group_id,
        run_parameters,
        max_concurrency_override,
        None,
        "manual",
        projects,
    )
    .await
}

pub async fn cancel_workflow_run(pool: &SqlitePool, workflow_run_id: i64) -> Result<()> {
    let now = now_rfc3339();
    let res = sqlx::query(
        r#"UPDATE workflow_runs
       SET status = 'cancelling',
           updated_at = ?1
       WHERE id = ?2 AND status IN ('running', 'pending')"#,
    )
    .bind(&now)
    .bind(workflow_run_id)
    .execute(pool)
    .await?;

    if res.rows_affected() > 0 {
        return Ok(());
    }

    let status = sqlx::query_scalar::<_, String>(r#"SELECT status FROM workflow_runs WHERE id = ?1"#)
        .bind(workflow_run_id)
        .fetch_optional(pool)
        .await?;

    match status.as_deref() {
        Some("cancelling") | Some("cancelled") => Ok(()),
        Some("completed") | Some("partial_failed") => {
            Err(anyhow!("workflow run already finished: {workflow_run_id}"))
        }
        Some(current) => Err(anyhow!(
            "workflow run is not cancellable: {workflow_run_id}, status={current}"
        )),
        None => Err(anyhow!("workflow run not found: {workflow_run_id}")),
    }
}

pub async fn retry_failed_workflow_run(
    pool: &SqlitePool,
    source_workflow_run_id: i64,
    selected_managed_project_ids: Option<Vec<i64>>,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
    // Intentional v1 semantics: retry uses the source run's parameters, but resolves
    // workflow definition and managed project records from current database state.
    tracing::info!(
        source_workflow_run_id = source_workflow_run_id,
        selected_managed_project_ids = ?selected_managed_project_ids,
        "retry_failed_workflow_run uses current workflow/project state with source run parameters"
    );

    let source_run = load_retry_source_run(pool, source_workflow_run_id).await?;
    let failed_project_ids =
        load_failed_project_ids_for_retry(pool, source_workflow_run_id).await?;
    if failed_project_ids.is_empty() {
        return Err(anyhow!(
            "workflow run has no failed projects to retry: {source_workflow_run_id}"
        ));
    }

    let retry_project_ids = match selected_managed_project_ids {
        Some(selected_ids) if !selected_ids.is_empty() => {
            let eligible_failed = failed_project_ids.iter().copied().collect::<HashSet<_>>();
            let mut seen = HashSet::new();
            let mut selected_failed = Vec::new();
            for selected_id in selected_ids {
                if eligible_failed.contains(&selected_id) && seen.insert(selected_id) {
                    selected_failed.push(selected_id);
                }
            }

            if selected_failed.is_empty() {
                return Err(anyhow!(
                    "none of selected managed project IDs are eligible failed projects"
                ));
            }
            selected_failed
        }
        _ => failed_project_ids,
    };

    let mut managed_projects_by_id = db::list_managed_projects(pool)
        .await?
        .into_iter()
        .map(|project| (project.id, project))
        .collect::<HashMap<_, _>>();

    let mut missing_project_ids = Vec::new();
    let mut disabled_project_ids = Vec::new();
    let mut retry_projects = Vec::with_capacity(retry_project_ids.len());
    for retry_project_id in retry_project_ids {
        if let Some(project) = managed_projects_by_id.remove(&retry_project_id) {
            if project.enabled {
                retry_projects.push(project);
            } else {
                disabled_project_ids.push(retry_project_id);
            }
        } else {
            missing_project_ids.push(retry_project_id);
        }
    }

    if !missing_project_ids.is_empty() {
        let missing = missing_project_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(anyhow!(
            "failed managed projects no longer exist for retry: {missing}"
        ));
    }

    if !disabled_project_ids.is_empty() {
        let disabled = disabled_project_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(anyhow!(
            "failed managed projects are currently disabled and cannot be retried: {disabled}"
        ));
    }

    start_workflow_run_with_projects(
        pool,
        source_run.workflow_definition_id,
        source_run.project_group_id,
        source_run.run_parameters,
        max_concurrency_override,
        Some(source_workflow_run_id),
        "retry_failed",
        retry_projects,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        cancel_workflow_run, derive_run_final_status, derive_run_final_status_from_project_counts,
        execute_workflow_run, execute_project_plan, mark_project_internal_failure,
        reconcile_stale_workflow_runs, retry_failed_workflow_run, ProjectExecutionPlan,
        ProjectExecutionStep, ProjectOutcome,
    };
    use crate::db;
    use crate::models::WorkflowStepInput;
    use sqlx::{migrate::Migrator, sqlite::SqlitePoolOptions, SqlitePool};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::str::FromStr;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tokio::time::{sleep, Duration};

    static MIGRATOR: Migrator = sqlx::migrate!();

    async fn setup_test_pool() -> SqlitePool {
        let unique = format!(
            "workflow_executor_test_{}_{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let db_path = std::env::temp_dir().join(format!("{unique}.sqlite3"));
        let db_url = format!("sqlite://{}", db_path.to_string_lossy().replace('\\', "/"));
        let options = sqlx::sqlite::SqliteConnectOptions::from_str(&db_url)
            .expect("parse sqlite url")
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("connect sqlite");
        MIGRATOR.run(&pool).await.expect("run migrations");
        pool
    }

    fn make_temp_repo_dir() -> PathBuf {
        let unique = format!(
            "workflow_repo_test_{}_{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).expect("create temp repo dir");
        dir
    }

    fn run_git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("execute git");
        if !output.status.success() {
            panic!(
                "git {:?} failed: stdout={}, stderr={}",
                args,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    fn setup_git_repo() -> PathBuf {
        let repo = make_temp_repo_dir();
        run_git(&repo, &["init", "-b", "main"]);
        run_git(&repo, &["config", "user.email", "ci@example.com"]);
        run_git(&repo, &["config", "user.name", "CI"]);
        std::fs::write(repo.join("README.md"), "hello\n").expect("write readme");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "init"]);
        run_git(&repo, &["branch", "release"]);
        repo
    }

    async fn wait_for_terminal_run_status(
        pool: &SqlitePool,
        run_id: i64,
        timeout_ms: u64,
    ) -> crate::models::WorkflowRunDetail {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        loop {
            let detail = db::get_workflow_run_detail(pool, run_id)
                .await
                .expect("load run detail while waiting");
            if detail.status == "completed"
                || detail.status == "partial_failed"
                || detail.status == "cancelled"
            {
                return detail;
            }

            if std::time::Instant::now() >= deadline {
                panic!("workflow run {run_id} did not reach terminal status in {timeout_ms}ms");
            }
            sleep(Duration::from_millis(100)).await;
        }
    }

    #[tokio::test]
    async fn workflow_executor_persists_run_project_and_step_state() {
        let pool = setup_test_pool().await;
        let repo = setup_git_repo();

        let managed = db::create_managed_project(
            &pool,
            70001,
            "project-a".to_string(),
            "team/project-a".to_string(),
            repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "group-a".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let workflow = db::create_workflow_definition(
            &pool,
            "release-flow".to_string(),
            "test".to_string(),
            true,
            serde_json::json!({
                "source_branch": {"type":"string"},
                "target_branch": {"type":"string"}
            }),
            2,
            vec![
                WorkflowStepInput {
                    step_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "${target_branch}" }),
                },
                WorkflowStepInput {
                    step_type: "git_merge".to_string(),
                    parameters: serde_json::json!({ "from": "${source_branch}" }),
                },
            ],
        )
        .await
        .expect("create workflow definition");

        let run_id = execute_workflow_run(
            &pool,
            workflow.id,
            group.id,
            serde_json::json!({
                "source_branch": "release",
                "target_branch": "main"
            }),
            Some(1),
        )
        .await
        .expect("execute workflow run");

        let seeded = db::get_workflow_run_detail(&pool, run_id)
            .await
            .expect("load seeded run detail");
        assert_eq!(seeded.projects.len(), 1);
        assert_eq!(seeded.projects[0].steps.len(), 2);

        let detail = wait_for_terminal_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "completed");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "success");
        assert_eq!(detail.projects[0].steps.len(), 2);
        assert_eq!(detail.projects[0].steps[0].status, "success");
        assert_eq!(detail.projects[0].steps[1].status, "success");
        assert_eq!(
            detail.projects[0].steps[0].rendered_parameters,
            serde_json::json!({ "branch": "main" })
        );
        assert_eq!(
            detail.projects[0].steps[1].rendered_parameters,
            serde_json::json!({ "from": "release" })
        );
        assert!(
            detail.projects[0]
                .steps
                .iter()
                .any(|step| !step.stdout.is_empty() || !step.stderr.is_empty()),
            "expected captured stdout/stderr for at least one step"
        );
    }

    #[tokio::test]
    async fn workflow_executor_marks_project_failed_precheck_for_dirty_repo() {
        let pool = setup_test_pool().await;
        let repo = setup_git_repo();
        std::fs::write(repo.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let managed = db::create_managed_project(
            &pool,
            70002,
            "project-b".to_string(),
            "team/project-b".to_string(),
            repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "group-b".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let workflow = db::create_workflow_definition(
            &pool,
            "precheck-flow".to_string(),
            "test".to_string(),
            true,
            serde_json::json!({
                "target_branch": {"type":"string"}
            }),
            1,
            vec![WorkflowStepInput {
                step_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "${target_branch}" }),
            }],
        )
        .await
        .expect("create workflow definition");

        let run_id = execute_workflow_run(
            &pool,
            workflow.id,
            group.id,
            serde_json::json!({ "target_branch": "main" }),
            Some(1),
        )
        .await
        .expect("execute workflow run");

        let detail = wait_for_terminal_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "partial_failed");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "failed_precheck");
        assert_eq!(detail.projects[0].steps.len(), 1);
        assert_eq!(detail.projects[0].steps[0].status, "failed");
        assert!(detail.projects[0].steps[0]
            .summary_message
            .contains("precheck failed"));
    }

    #[tokio::test]
    async fn workflow_executor_treats_precheck_error_as_cancelled_when_run_is_cancelling() {
        let pool = setup_test_pool().await;
        let repo = setup_git_repo();
        std::fs::write(repo.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let managed = db::create_managed_project(
            &pool,
            70004,
            "project-dirty-cancelling".to_string(),
            "team/project-dirty-cancelling".to_string(),
            repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "group-dirty-cancelling".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let workflow = db::create_workflow_definition(
            &pool,
            "precheck-cancel-flow".to_string(),
            "test".to_string(),
            true,
            serde_json::json!({}),
            1,
            vec![WorkflowStepInput {
                step_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "main" }),
            }],
        )
        .await
        .expect("create workflow definition");

        let now = chrono::Utc::now().to_rfc3339();
        let run_id = sqlx::query(
            r#"INSERT INTO workflow_runs (
             workflow_definition_id, project_group_id, source_workflow_run_id, trigger_kind,
             status, run_parameters_json, max_concurrency, started_at, finished_at, created_at, updated_at
           ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)"#,
        )
        .bind(workflow.id)
        .bind(group.id)
        .bind("manual")
        .bind("running")
        .bind("{}")
        .bind(1_i64)
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
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', NULL, NULL, ?8, ?9)"#,
        )
        .bind(run_id)
        .bind(managed.id)
        .bind(i64::try_from(managed.gitlab_project_id).expect("convert project id"))
        .bind(&managed.name)
        .bind(&managed.path_with_namespace)
        .bind(&managed.repo_path)
        .bind("queued")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert workflow run project")
        .last_insert_rowid();

        let run_step_id = sqlx::query(
            r#"INSERT INTO workflow_run_steps (
             workflow_run_project_id, workflow_step_id, step_order, step_type, rendered_parameters_json,
             status, started_at, finished_at, stdout, stderr, exit_code, summary_message, created_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, '', '', NULL, '', ?7, ?8)"#,
        )
        .bind(run_project_id)
        .bind(Option::<i64>::None)
        .bind(0_i64)
        .bind("checkout_branch")
        .bind(r#"{"branch":"main"}"#)
        .bind("pending")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert workflow run step")
        .last_insert_rowid();

        let cancel_pool = pool.clone();
        let cancellation_updater = tokio::spawn(async move {
            for _ in 0..40_u32 {
                let _ = sqlx::query(
                    r#"UPDATE workflow_runs SET status = 'cancelling', updated_at = ?1 WHERE id = ?2"#,
                )
                .bind(chrono::Utc::now().to_rfc3339())
                .bind(run_id)
                .execute(&cancel_pool)
                .await;
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        });

        let plan = ProjectExecutionPlan {
            run_project_id,
            project: managed.clone(),
            steps: vec![ProjectExecutionStep {
                run_step_id,
                step_type: "checkout_branch".to_string(),
                rendered_parameters: serde_json::json!({ "branch": "main" }),
            }],
        };

        let outcome = execute_project_plan(&pool, run_id, &plan)
            .await
            .expect("execute project plan");
        cancellation_updater.await.expect("wait cancellation updater");
        assert_eq!(outcome, ProjectOutcome::Cancelled);

        let detail = db::get_workflow_run_detail(&pool, run_id)
            .await
            .expect("load run detail");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "cancelled");
        assert_eq!(detail.projects[0].steps.len(), 1);
        assert_eq!(detail.projects[0].steps[0].status, "cancelled");
    }

    #[tokio::test]
    async fn internal_failure_fallback_preserves_finished_steps() {
        let pool = setup_test_pool().await;
        let repo = setup_git_repo();

        let managed = db::create_managed_project(
            &pool,
            70003,
            "project-c".to_string(),
            "team/project-c".to_string(),
            repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "group-c".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let workflow = db::create_workflow_definition(
            &pool,
            "internal-fallback-flow".to_string(),
            "test".to_string(),
            true,
            serde_json::json!({}),
            1,
            vec![
                WorkflowStepInput {
                    step_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "main" }),
                },
                WorkflowStepInput {
                    step_type: "git_pull".to_string(),
                    parameters: serde_json::json!({ "branch": "main" }),
                },
                WorkflowStepInput {
                    step_type: "git_push".to_string(),
                    parameters: serde_json::json!({ "remote": "origin" }),
                },
            ],
        )
        .await
        .expect("create workflow definition");

        let now = chrono::Utc::now().to_rfc3339();
        let run_id = sqlx::query(
            r#"INSERT INTO workflow_runs (
             workflow_definition_id, project_group_id, source_workflow_run_id, trigger_kind,
             status, run_parameters_json, max_concurrency, started_at, finished_at, created_at, updated_at
           ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)"#,
        )
        .bind(workflow.id)
        .bind(group.id)
        .bind("manual")
        .bind("running")
        .bind("{}")
        .bind(1_i64)
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
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', ?8, NULL, ?9, ?10)"#,
        )
        .bind(run_id)
        .bind(managed.id)
        .bind(i64::try_from(managed.gitlab_project_id).expect("convert project id"))
        .bind(&managed.name)
        .bind(&managed.path_with_namespace)
        .bind(&managed.repo_path)
        .bind("running")
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert workflow run project")
        .last_insert_rowid();

        let step1_id = sqlx::query(
            r#"INSERT INTO workflow_run_steps (
             workflow_run_project_id, workflow_step_id, step_order, step_type, rendered_parameters_json,
             status, started_at, finished_at, stdout, stderr, exit_code, summary_message, created_at, updated_at
           ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, '', '', 0, ?8, ?9, ?10)"#,
        )
        .bind(run_project_id)
        .bind(0_i64)
        .bind("checkout_branch")
        .bind(r#"{"branch":"main"}"#)
        .bind("success")
        .bind(&now)
        .bind(&now)
        .bind("already done")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert run step 1")
        .last_insert_rowid();

        let step2_id = sqlx::query(
            r#"INSERT INTO workflow_run_steps (
             workflow_run_project_id, workflow_step_id, step_order, step_type, rendered_parameters_json,
             status, started_at, finished_at, stdout, stderr, exit_code, summary_message, created_at, updated_at
           ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, NULL, NULL, '', '', NULL, '', ?6, ?7)"#,
        )
        .bind(run_project_id)
        .bind(1_i64)
        .bind("git_pull")
        .bind(r#"{"branch":"main"}"#)
        .bind("pending")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert run step 2")
        .last_insert_rowid();

        let step3_id = sqlx::query(
            r#"INSERT INTO workflow_run_steps (
             workflow_run_project_id, workflow_step_id, step_order, step_type, rendered_parameters_json,
             status, started_at, finished_at, stdout, stderr, exit_code, summary_message, created_at, updated_at
           ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, NULL, NULL, '', '', NULL, '', ?6, ?7)"#,
        )
        .bind(run_project_id)
        .bind(2_i64)
        .bind("git_push")
        .bind(r#"{"remote":"origin"}"#)
        .bind("pending")
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert run step 3")
        .last_insert_rowid();

        let plan = ProjectExecutionPlan {
            run_project_id,
            project: managed.clone(),
            steps: vec![
                ProjectExecutionStep {
                    run_step_id: step1_id,
                    step_type: "checkout_branch".to_string(),
                    rendered_parameters: serde_json::json!({ "branch": "main" }),
                },
                ProjectExecutionStep {
                    run_step_id: step2_id,
                    step_type: "git_pull".to_string(),
                    rendered_parameters: serde_json::json!({ "branch": "main" }),
                },
                ProjectExecutionStep {
                    run_step_id: step3_id,
                    step_type: "git_push".to_string(),
                    rendered_parameters: serde_json::json!({ "remote": "origin" }),
                },
            ],
        };

        mark_project_internal_failure(&pool, &plan, "executor internal error: synthetic failure")
            .await
            .expect("mark internal failure");

        let detail = db::get_workflow_run_detail(&pool, run_id)
            .await
            .expect("load run detail");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "failed");
        assert_eq!(detail.projects[0].steps[0].status, "success");
        assert_eq!(detail.projects[0].steps[0].summary_message, "already done");
        assert_eq!(detail.projects[0].steps[1].status, "failed");
        assert!(detail.projects[0].steps[1]
            .summary_message
            .contains("synthetic failure"));
        assert_eq!(detail.projects[0].steps[2].status, "skipped");
    }

    #[tokio::test]
    async fn workflow_executor_supports_cooperative_cancellation() {
        let pool = setup_test_pool().await;
        let repo = setup_git_repo();

        let group = db::create_project_group(&pool, "group-cancel".to_string())
            .await
            .expect("create project group");

        let mut managed_project_ids = Vec::new();
        for idx in 0_u64..24_u64 {
            let project = db::create_managed_project(
                &pool,
                72000 + idx,
                format!("project-cancel-{idx}"),
                format!("team/project-cancel-{idx}"),
                repo.to_string_lossy().to_string(),
                Some("main".to_string()),
                Some("origin".to_string()),
                true,
            )
            .await
            .expect("create managed project for cancellation");
            managed_project_ids.push(project.id);
        }

        db::add_projects_to_group(&pool, group.id, managed_project_ids)
            .await
            .expect("add projects to group");

        let steps = (0..8)
            .map(|_| WorkflowStepInput {
                step_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "main" }),
            })
            .collect::<Vec<_>>();

        let workflow = db::create_workflow_definition(
            &pool,
            "cancel-flow".to_string(),
            "test cancellation".to_string(),
            true,
            serde_json::json!({}),
            1,
            steps,
        )
        .await
        .expect("create workflow definition");

        let run_id = execute_workflow_run(&pool, workflow.id, group.id, serde_json::json!({}), Some(1))
            .await
            .expect("execute workflow run");

        cancel_workflow_run(&pool, run_id)
            .await
            .expect("request cancellation");

        let detail = wait_for_terminal_run_status(&pool, run_id, 30_000).await;
        assert_eq!(detail.status, "cancelled");
        assert!(detail.projects.iter().any(|project| project.status == "cancelled"));
        assert!(detail
            .projects
            .iter()
            .all(|project| project.status != "queued" && project.status != "running"));

        let unscheduled_cancelled = detail
            .projects
            .iter()
            .filter(|project| project.status == "cancelled" && project.started_at.is_none())
            .collect::<Vec<_>>();
        assert!(
            !unscheduled_cancelled.is_empty(),
            "expected at least one unscheduled project to be cancelled after cancellation"
        );
        assert!(unscheduled_cancelled
            .iter()
            .all(|project| project.steps.iter().all(|step| step.status == "cancelled")));
        assert!(detail.projects.iter().all(|project| project.steps.iter().all(|step| {
            !step
                .summary_message
                .contains("step cancelled while command was running")
        })));
    }

    #[tokio::test]
    async fn retry_failed_workflow_run_creates_new_run_with_failed_projects_only() {
        let pool = setup_test_pool().await;
        let clean_repo = setup_git_repo();
        let dirty_repo = setup_git_repo();
        std::fs::write(dirty_repo.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let clean_project = db::create_managed_project(
            &pool,
            73001,
            "project-clean".to_string(),
            "team/project-clean".to_string(),
            clean_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create clean project");
        let dirty_project = db::create_managed_project(
            &pool,
            73002,
            "project-dirty".to_string(),
            "team/project-dirty".to_string(),
            dirty_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create dirty project");

        let group = db::create_project_group(&pool, "group-retry".to_string())
            .await
            .expect("create retry project group");
        db::add_projects_to_group(&pool, group.id, vec![clean_project.id, dirty_project.id])
            .await
            .expect("add projects to retry group");

        let workflow = db::create_workflow_definition(
            &pool,
            "retry-flow".to_string(),
            "test retry failed projects".to_string(),
            true,
            serde_json::json!({
                "target_branch": {"type": "string"}
            }),
            1,
            vec![WorkflowStepInput {
                step_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "${target_branch}" }),
            }],
        )
        .await
        .expect("create workflow definition");

        let source_run_id = execute_workflow_run(
            &pool,
            workflow.id,
            group.id,
            serde_json::json!({
                "target_branch": "main"
            }),
            Some(1),
        )
        .await
        .expect("execute source workflow run");

        let source_detail = wait_for_terminal_run_status(&pool, source_run_id, 15_000).await;
        assert_eq!(source_detail.status, "partial_failed");
        let failed_project_ids = source_detail
            .projects
            .iter()
            .filter(|project| project.status == "failed" || project.status == "failed_precheck")
            .map(|project| project.managed_project_id.expect("failed project id"))
            .collect::<Vec<_>>();
        assert_eq!(failed_project_ids, vec![dirty_project.id]);

        let retry_run_id = retry_failed_workflow_run(
            &pool,
            source_run_id,
            Some(vec![dirty_project.id, clean_project.id]),
            Some(1),
        )
            .await
            .expect("retry failed workflow run");

        let retry_seeded = db::get_workflow_run_detail(&pool, retry_run_id)
            .await
            .expect("load retry seeded detail");
        assert_eq!(retry_seeded.source_workflow_run_id, Some(source_run_id));
        assert_eq!(retry_seeded.trigger_kind, "retry_failed");
        assert_eq!(retry_seeded.projects_total, 1);
        assert_eq!(retry_seeded.projects.len(), 1);
        assert_eq!(
            retry_seeded.projects[0].managed_project_id,
            Some(dirty_project.id)
        );
    }

    #[tokio::test]
    async fn retry_failed_workflow_run_retries_all_failed_when_selection_empty() {
        let pool = setup_test_pool().await;
        let clean_repo = setup_git_repo();
        let dirty_repo_a = setup_git_repo();
        std::fs::write(dirty_repo_a.join("dirty-a.txt"), "dirty\n").expect("write dirty file a");
        let dirty_repo_b = setup_git_repo();
        std::fs::write(dirty_repo_b.join("dirty-b.txt"), "dirty\n").expect("write dirty file b");

        let clean_project = db::create_managed_project(
            &pool,
            73101,
            "project-clean-all".to_string(),
            "team/project-clean-all".to_string(),
            clean_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create clean project");
        let dirty_project_a = db::create_managed_project(
            &pool,
            73102,
            "project-dirty-a".to_string(),
            "team/project-dirty-a".to_string(),
            dirty_repo_a.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create dirty project a");
        let dirty_project_b = db::create_managed_project(
            &pool,
            73103,
            "project-dirty-b".to_string(),
            "team/project-dirty-b".to_string(),
            dirty_repo_b.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create dirty project b");

        let group = db::create_project_group(&pool, "group-retry-all-failed".to_string())
            .await
            .expect("create retry-all project group");
        db::add_projects_to_group(
            &pool,
            group.id,
            vec![clean_project.id, dirty_project_a.id, dirty_project_b.id],
        )
        .await
        .expect("add projects to retry-all group");

        let workflow = db::create_workflow_definition(
            &pool,
            "retry-flow-all-failed".to_string(),
            "test retry all failed projects".to_string(),
            true,
            serde_json::json!({
                "target_branch": {"type": "string"}
            }),
            1,
            vec![WorkflowStepInput {
                step_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "${target_branch}" }),
            }],
        )
        .await
        .expect("create workflow definition");

        let source_run_id = execute_workflow_run(
            &pool,
            workflow.id,
            group.id,
            serde_json::json!({
                "target_branch": "main"
            }),
            Some(1),
        )
        .await
        .expect("execute source workflow run");

        let source_detail = wait_for_terminal_run_status(&pool, source_run_id, 15_000).await;
        assert_eq!(source_detail.status, "partial_failed");

        let retry_run_id = retry_failed_workflow_run(&pool, source_run_id, Some(vec![]), Some(1))
            .await
            .expect("retry all failed workflow run");

        let retry_seeded = db::get_workflow_run_detail(&pool, retry_run_id)
            .await
            .expect("load retry-all seeded detail");
        assert_eq!(retry_seeded.projects_total, 2);
        let retried_ids = retry_seeded
            .projects
            .iter()
            .map(|project| project.managed_project_id.expect("retry project id"))
            .collect::<Vec<_>>();
        assert_eq!(retried_ids, vec![dirty_project_a.id, dirty_project_b.id]);
    }

    #[tokio::test]
    async fn retry_failed_workflow_run_errors_when_selected_projects_not_failed() {
        let pool = setup_test_pool().await;
        let clean_repo = setup_git_repo();
        let dirty_repo = setup_git_repo();
        std::fs::write(dirty_repo.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let clean_project = db::create_managed_project(
            &pool,
            73201,
            "project-clean-not-failed".to_string(),
            "team/project-clean-not-failed".to_string(),
            clean_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create clean project");
        let dirty_project = db::create_managed_project(
            &pool,
            73202,
            "project-dirty-failed".to_string(),
            "team/project-dirty-failed".to_string(),
            dirty_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create dirty project");

        let group = db::create_project_group(&pool, "group-retry-selected-error".to_string())
            .await
            .expect("create retry selected-error project group");
        db::add_projects_to_group(&pool, group.id, vec![clean_project.id, dirty_project.id])
            .await
            .expect("add projects to retry selected-error group");

        let workflow = db::create_workflow_definition(
            &pool,
            "retry-flow-selected-error".to_string(),
            "test retry selected failed projects".to_string(),
            true,
            serde_json::json!({
                "target_branch": {"type": "string"}
            }),
            1,
            vec![WorkflowStepInput {
                step_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "${target_branch}" }),
            }],
        )
        .await
        .expect("create workflow definition");

        let source_run_id = execute_workflow_run(
            &pool,
            workflow.id,
            group.id,
            serde_json::json!({
                "target_branch": "main"
            }),
            Some(1),
        )
        .await
        .expect("execute source workflow run");

        let source_detail = wait_for_terminal_run_status(&pool, source_run_id, 15_000).await;
        assert_eq!(source_detail.status, "partial_failed");

        let retry_result = retry_failed_workflow_run(
            &pool,
            source_run_id,
            Some(vec![clean_project.id]),
            Some(1),
        )
        .await;
        assert!(retry_result.is_err());
        assert!(retry_result
            .expect_err("retry should fail when no selected IDs are eligible")
            .to_string()
            .contains("none of selected managed project IDs are eligible failed projects"));
    }

    #[tokio::test]
    async fn retry_failed_workflow_run_errors_when_failed_project_is_now_disabled() {
        let pool = setup_test_pool().await;
        let dirty_repo = setup_git_repo();
        std::fs::write(dirty_repo.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let dirty_project = db::create_managed_project(
            &pool,
            73251,
            "project-dirty-disabled".to_string(),
            "team/project-dirty-disabled".to_string(),
            dirty_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create dirty project");

        let group = db::create_project_group(&pool, "group-retry-disabled".to_string())
            .await
            .expect("create group");
        db::add_projects_to_group(&pool, group.id, vec![dirty_project.id])
            .await
            .expect("add project to group");

        let workflow = db::create_workflow_definition(
            &pool,
            "retry-flow-disabled".to_string(),
            "test retry disabled failed project".to_string(),
            true,
            serde_json::json!({
                "target_branch": {"type": "string"}
            }),
            1,
            vec![WorkflowStepInput {
                step_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "${target_branch}" }),
            }],
        )
        .await
        .expect("create workflow definition");

        let source_run_id = execute_workflow_run(
            &pool,
            workflow.id,
            group.id,
            serde_json::json!({
                "target_branch": "main"
            }),
            Some(1),
        )
        .await
        .expect("execute source run");

        let source_detail = wait_for_terminal_run_status(&pool, source_run_id, 15_000).await;
        assert_eq!(source_detail.status, "partial_failed");

        db::update_managed_project(
            &pool,
            dirty_project.id,
            dirty_project.gitlab_project_id,
            dirty_project.name.clone(),
            dirty_project.path_with_namespace.clone(),
            dirty_project.repo_path.clone(),
            dirty_project.default_branch.clone(),
            dirty_project.default_remote.clone(),
            false,
        )
        .await
        .expect("disable dirty project");

        let retry_result = retry_failed_workflow_run(
            &pool,
            source_run_id,
            Some(vec![dirty_project.id]),
            Some(1),
        )
        .await;

        assert!(retry_result.is_err());
        assert!(retry_result
            .expect_err("retry should fail when failed project is disabled")
            .to_string()
            .contains("failed managed projects are currently disabled and cannot be retried"));
    }

    #[test]
    fn derive_run_final_status_uses_failure_precedence_over_cancellation() {
        assert_eq!(derive_run_final_status(false, false), "completed");
        assert_eq!(derive_run_final_status(true, false), "partial_failed");
        assert_eq!(derive_run_final_status(false, true), "cancelled");
        assert_eq!(derive_run_final_status(true, true), "partial_failed");
    }

    #[test]
    fn derive_run_final_status_from_project_counts_matches_live_logic() {
        assert_eq!(
            derive_run_final_status_from_project_counts(0, 0, 0, 0, 0),
            "cancelled"
        );
        assert_eq!(
            derive_run_final_status_from_project_counts(2, 2, 0, 0, 0),
            "completed"
        );
        assert_eq!(
            derive_run_final_status_from_project_counts(3, 1, 1, 1, 0),
            "partial_failed"
        );
        assert_eq!(
            derive_run_final_status_from_project_counts(3, 2, 0, 1, 0),
            "cancelled"
        );
    }

    #[tokio::test]
    async fn repo_lease_blocks_concurrent_execution_for_same_repo_path() {
        let lease_a = super::get_repo_lease(r"D:\Repos\Shared").await;
        let lease_b = super::get_repo_lease("d:/repos/shared").await;
        assert!(Arc::ptr_eq(&lease_a, &lease_b));

        let guard = lease_a.lock().await;
        let second_acquired = Arc::new(AtomicBool::new(false));
        let second_acquired_task = Arc::clone(&second_acquired);
        let lease_for_task = Arc::clone(&lease_b);
        let join = tokio::spawn(async move {
            let _guard = lease_for_task.lock().await;
            second_acquired_task.store(true, Ordering::Relaxed);
        });

        sleep(Duration::from_millis(100)).await;
        assert!(
            !second_acquired.load(Ordering::Relaxed),
            "second lock should block while first guard is held"
        );

        drop(guard);
        join.await.expect("wait for second lease task");
        assert!(second_acquired.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn reconcile_stale_running_workflow_marks_terminal_cancelled_rows() {
        let pool = setup_test_pool().await;
        let workflow = db::create_workflow_definition(
            &pool,
            "stale-reconcile-flow".to_string(),
            "test stale run reconciliation".to_string(),
            true,
            serde_json::json!({}),
            1,
            vec![WorkflowStepInput {
                step_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "main" }),
            }],
        )
        .await
        .expect("create workflow definition");
        let group = db::create_project_group(&pool, "stale-reconcile-group".to_string())
            .await
            .expect("create project group");
        let managed = db::create_managed_project(
            &pool,
            73301,
            "stale-project".to_string(),
            "team/stale-project".to_string(),
            "D:/repos/stale-project".to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");

        let now = chrono::Utc::now().to_rfc3339();
        let run_id = sqlx::query(
            r#"INSERT INTO workflow_runs (
             workflow_definition_id, project_group_id, source_workflow_run_id, trigger_kind,
             status, run_parameters_json, max_concurrency, started_at, finished_at, created_at, updated_at
           ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)"#,
        )
        .bind(workflow.id)
        .bind(group.id)
        .bind("manual")
        .bind("running")
        .bind("{}")
        .bind(1_i64)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert stale run")
        .last_insert_rowid();

        let run_project_id = sqlx::query(
            r#"INSERT INTO workflow_run_projects (
             workflow_run_id, managed_project_id, gitlab_project_id, project_name, project_path_with_namespace, repo_path,
             status, summary_message, started_at, finished_at, created_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', ?8, NULL, ?9, ?10)"#,
        )
        .bind(run_id)
        .bind(managed.id)
        .bind(i64::try_from(managed.gitlab_project_id).expect("convert project id"))
        .bind(&managed.name)
        .bind(&managed.path_with_namespace)
        .bind(&managed.repo_path)
        .bind("running")
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert stale run project")
        .last_insert_rowid();

        sqlx::query(
            r#"INSERT INTO workflow_run_steps (
             workflow_run_project_id, workflow_step_id, step_order, step_type, rendered_parameters_json,
             status, started_at, finished_at, stdout, stderr, exit_code, summary_message, created_at, updated_at
           ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, NULL, '', '', NULL, '', ?7, ?8)"#,
        )
        .bind(run_project_id)
        .bind(0_i64)
        .bind("checkout_branch")
        .bind(r#"{"branch":"main"}"#)
        .bind("running")
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert stale run step");

        let reconciled_count = reconcile_stale_workflow_runs(&pool)
            .await
            .expect("reconcile stale runs");
        assert_eq!(reconciled_count, 1);

        let detail = db::get_workflow_run_detail(&pool, run_id)
            .await
            .expect("load reconciled run detail");
        assert_eq!(detail.status, "cancelled");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "cancelled");
        assert!(detail.projects[0]
            .summary_message
            .contains("reconciled stale in-flight run after process restart"));
        assert_eq!(detail.projects[0].steps.len(), 1);
        assert_eq!(detail.projects[0].steps[0].status, "cancelled");
        assert!(detail.projects[0].steps[0]
            .summary_message
            .contains("reconciled stale in-flight run after process restart"));
    }

}
