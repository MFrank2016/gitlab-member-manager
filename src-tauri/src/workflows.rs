use crate::db::{self, WorkflowExecutionStepDef};
use crate::models::ManagedProject;
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde_json::{Map, Value};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration as StdDuration, Instant};
use tokio::sync::Semaphore;

const GIT_COMMAND_TIMEOUT_SECS: u64 = 120;

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
       ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)"#,
    )
    .bind(workflow_definition_id)
    .bind(project_group_id)
    .bind("manual")
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
    plan: &ProjectExecutionPlan,
) -> Result<ProjectOutcome> {
    mark_project_running(pool, plan.run_project_id).await?;

    if let Err(error) = run_repo_precheck(&plan.project).await {
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

    for (step_index, step) in plan.steps.iter().enumerate() {
        mark_step_running(pool, step.run_step_id).await?;

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

    let semaphore = Arc::new(Semaphore::new(
        usize::try_from(max_concurrency)
            .map_err(|_| anyhow!("max_concurrency is out of range: {max_concurrency}"))?,
    ));
    let mut handles = Vec::with_capacity(plans.len());
    for plan in plans {
        let permit = semaphore.clone().acquire_owned().await?;
        let pool_cloned = pool.clone();
        handles.push(tokio::spawn(async move {
            let _permit = permit;
            match execute_project_plan(&pool_cloned, &plan).await {
                Ok(outcome) => outcome,
                Err(error) => {
                    let message = format!("executor internal error: {error}");
                    let _ = mark_project_internal_failure(&pool_cloned, &plan, &message).await;
                    ProjectOutcome::Failed
                }
            }
        }));
    }

    let mut has_failures = false;
    for handle in handles {
        match handle.await {
            Ok(ProjectOutcome::Success) => {}
            Ok(ProjectOutcome::Failed | ProjectOutcome::FailedPrecheck) => {
                has_failures = true;
            }
            Err(error) => {
                tracing::error!(error = %error, "workflow project task join failed");
                has_failures = true;
            }
        }
    }

    mark_workflow_run_finished(
        &pool,
        workflow_run_id,
        if has_failures {
            "partial_failed"
        } else {
            "completed"
        },
    )
    .await?;
    Ok(())
}

pub async fn execute_workflow_run(
    pool: &SqlitePool,
    workflow_definition_id: i64,
    project_group_id: i64,
    run_parameters: Value,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
    let run_parameters = normalize_run_parameters(run_parameters)?;
    let workflow = db::load_workflow_definition_for_execution(pool, workflow_definition_id).await?;
    let mut projects = db::list_project_group_projects(pool, project_group_id).await?;
    projects.retain(|project| project.enabled);

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

#[cfg(test)]
mod tests {
    use super::{
        execute_workflow_run, mark_project_internal_failure, ProjectExecutionPlan,
        ProjectExecutionStep,
    };
    use crate::db;
    use crate::models::WorkflowStepInput;
    use sqlx::{migrate::Migrator, sqlite::SqlitePoolOptions, SqlitePool};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::str::FromStr;
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
}
