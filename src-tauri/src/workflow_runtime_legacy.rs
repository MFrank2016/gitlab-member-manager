use crate::db::{self, WorkflowExecutionStepDef};
use crate::git_executor::{
    build_execution_step_operation, execute_git_command, run_execution_step_prechecks,
    run_repository_precheck,
};
use crate::models::ManagedProject;
use crate::runtime_support::{
    derive_run_final_status, derive_run_final_status_from_project_counts, get_repo_lease,
    normalize_run_parameters, now_rfc3339, render_value, ProjectExecutionStep, ProjectOutcome,
};
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::{HashMap, HashSet};
use tokio::task::JoinSet;

#[derive(Debug, Clone)]
pub(crate) struct RenderedStepDefinition {
    pub(crate) workflow_step_id: i64,
    pub(crate) step_order: i64,
    pub(crate) step_type: String,
    pub(crate) rendered_parameters: Value,
}

#[derive(Debug, Clone)]
pub(crate) struct ProjectExecutionPlan {
    pub(crate) run_project_id: i64,
    pub(crate) project: ManagedProject,
    pub(crate) steps: Vec<ProjectExecutionStep>,
}

#[derive(Debug)]
struct RetrySourceRun {
    workflow_definition_id: i64,
    project_group_id: i64,
    run_parameters: Value,
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

pub(crate) async fn reconcile_stale_workflow_runs(pool: &SqlitePool) -> Result<usize> {
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

pub(crate) async fn mark_project_internal_failure(
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

pub(crate) async fn execute_project_plan(
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

    if let Err(error) = run_repository_precheck(&plan.project).await {
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

        let operation = match build_execution_step_operation(
            &step.step_type,
            &step.rendered_parameters,
            &plan.project,
        ) {
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

        if let Err(error) = run_execution_step_prechecks(&plan.project, &operation).await {
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

        let command_result =
            execute_git_command(plan.project.repo_path.clone(), operation.to_args()).await?;

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

pub(crate) fn render_execution_steps(
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
        mark_remaining_steps_cancelled(pool, &plan.steps, 0, "cancelled before project scheduling")
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
                    if stop_scheduling_and_cancel_unscheduled(&pool, &plans, &mut next_plan_index)
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
                    if stop_scheduling_and_cancel_unscheduled(&pool, &plans, &mut next_plan_index)
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

async fn load_retry_source_run(
    pool: &SqlitePool,
    source_workflow_run_id: i64,
) -> Result<RetrySourceRun> {
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

    let parsed_run_parameters = serde_json::from_str::<Value>(&run_parameters_json)
        .context("parse source run parameters")?;
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

    let rendered_steps = render_execution_steps(&workflow.steps, &run_parameters)?;
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

pub(crate) async fn execute_workflow_run(
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

pub(crate) async fn cancel_workflow_run(pool: &SqlitePool, workflow_run_id: i64) -> Result<()> {
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

    let status =
        sqlx::query_scalar::<_, String>(r#"SELECT status FROM workflow_runs WHERE id = ?1"#)
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

pub(crate) async fn retry_failed_workflow_run(
    pool: &SqlitePool,
    source_workflow_run_id: i64,
    selected_managed_project_ids: Option<Vec<i64>>,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
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
    use super::execute_workflow_run;
    use crate::db;
    use crate::git_executor::test_support::{make_temp_test_dir, setup_git_repo_with_branches};
    use crate::models::WorkflowStepInput;
    use serial_test::serial;
    use sqlx::{migrate::Migrator, sqlite::SqlitePoolOptions, SqlitePool};
    use std::path::PathBuf;
    use std::str::FromStr;
    use tokio::time::{sleep, Duration};

    static MIGRATOR: Migrator = sqlx::migrate!();

    async fn setup_test_pool() -> SqlitePool {
        let db_path = make_temp_test_dir("workflow_working_path_db").join("test.sqlite3");
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

    async fn wait_for_terminal_workflow_run_status(
        pool: &SqlitePool,
        run_id: i64,
        timeout_ms: u64,
    ) -> crate::models::WorkflowRunDetail {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        loop {
            let detail = db::get_workflow_run_detail(pool, run_id)
                .await
                .expect("load workflow run detail while waiting");
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

    fn create_repo_fixture(root: &PathBuf) -> (PathBuf, PathBuf) {
        let origin_repo = root.join("origin-repo");
        let first_target = root.join("target-a");
        let final_target = first_target.join("nested").join("target-b");
        setup_git_repo_with_branches(&origin_repo, &["release"]);
        std::fs::create_dir_all(first_target.join("nested")).expect("create target-a dir");
        setup_git_repo_with_branches(&final_target, &["target-only"]);
        (origin_repo, final_target)
    }

    #[tokio::test]
    #[serial]
    async fn working_path_relative_resolution_uses_latest_context_in_workflow_runtime() {
        let pool = setup_test_pool().await;
        let root = make_temp_test_dir("workflow_working_path_root");
        let (origin_repo, final_target) = create_repo_fixture(&root);
        let first_target = final_target
            .parent()
            .and_then(|path| path.parent())
            .expect("find target-a parent")
            .to_path_buf();

        let managed = db::create_managed_project(
            &pool,
            88101,
            "workflow-working-path-project".to_string(),
            "team/workflow-working-path-project".to_string(),
            origin_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "workflow-working-path-group".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let workflow = db::create_workflow_definition(
            &pool,
            "workflow-working-path".to_string(),
            "working path relative resolution red test".to_string(),
            true,
            serde_json::json!({}),
            1,
            vec![
                WorkflowStepInput {
                    step_type: "set_working_path".to_string(),
                    parameters: serde_json::json!({ "path": first_target.to_string_lossy() }),
                },
                WorkflowStepInput {
                    step_type: "set_working_path".to_string(),
                    parameters: serde_json::json!({ "path": "nested/target-b" }),
                },
                WorkflowStepInput {
                    step_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "target-only" }),
                },
            ],
        )
        .await
        .expect("create workflow definition");

        let run_id = execute_workflow_run(&pool, workflow.id, group.id, serde_json::json!({}), Some(1))
            .await
            .expect("execute workflow run");

        let detail = wait_for_terminal_workflow_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "completed");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "success");
        assert_eq!(detail.projects[0].steps.len(), 3);
        assert_eq!(detail.projects[0].steps[0].status, "success");
        assert_eq!(detail.projects[0].steps[1].status, "success");
        assert_eq!(detail.projects[0].steps[2].status, "success");
    }
}
