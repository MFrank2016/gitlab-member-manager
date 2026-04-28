use crate::{pipeline_runtime, workflow_runtime_legacy};
use anyhow::Result;
use crate::models::PipelineRunRetryRequest;
use serde_json::Value;
use sqlx::SqlitePool;

pub async fn reconcile_stale_workflow_runs(pool: &SqlitePool) -> Result<usize> {
    workflow_runtime_legacy::reconcile_stale_workflow_runs(pool).await
}

pub async fn execute_workflow_run(
    pool: &SqlitePool,
    workflow_definition_id: i64,
    project_group_id: i64,
    run_parameters: Value,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
    workflow_runtime_legacy::execute_workflow_run(
        pool,
        workflow_definition_id,
        project_group_id,
        run_parameters,
        max_concurrency_override,
    )
    .await
}

pub async fn cancel_workflow_run(pool: &SqlitePool, workflow_run_id: i64) -> Result<()> {
    workflow_runtime_legacy::cancel_workflow_run(pool, workflow_run_id).await
}

pub async fn retry_failed_workflow_run(
    pool: &SqlitePool,
    source_workflow_run_id: i64,
    selected_managed_project_ids: Option<Vec<i64>>,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
    workflow_runtime_legacy::retry_failed_workflow_run(
        pool,
        source_workflow_run_id,
        selected_managed_project_ids,
        max_concurrency_override,
    )
    .await
}

pub async fn execute_pipeline_run(
    pool: &SqlitePool,
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    run_parameters: Value,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
    pipeline_runtime::execute_pipeline_run(
        pool,
        pipeline_definition_id,
        project_group_id,
        run_parameters,
        max_concurrency_override,
    )
    .await
}

pub async fn execute_scheduled_pipeline_run(
    pool: &SqlitePool,
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    run_parameters: Value,
) -> Result<i64> {
    pipeline_runtime::execute_scheduled_pipeline_run(
        pool,
        pipeline_definition_id,
        project_group_id,
        run_parameters,
    )
    .await
}

pub async fn cancel_pipeline_run(pool: &SqlitePool, pipeline_run_id: i64) -> Result<()> {
    pipeline_runtime::cancel_pipeline_run(pool, pipeline_run_id).await
}

pub async fn retry_pipeline_run(
    pool: &SqlitePool,
    source_pipeline_run_id: i64,
    selected_managed_project_ids: Option<Vec<i64>>,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
    pipeline_runtime::retry_pipeline_run_legacy(
        pool,
        source_pipeline_run_id,
        selected_managed_project_ids,
        max_concurrency_override,
    )
    .await
}

pub async fn retry_pipeline_run_with_request(
    pool: &SqlitePool,
    request: PipelineRunRetryRequest,
) -> Result<i64> {
    pipeline_runtime::retry_pipeline_run(pool, request).await
}

#[cfg(test)]
mod tests {
    use super::{
        cancel_pipeline_run, cancel_workflow_run, execute_pipeline_run, execute_workflow_run,
        reconcile_stale_workflow_runs, retry_failed_workflow_run, retry_pipeline_run,
    };
    use crate::db::{self, WorkflowExecutionStepDef};
    use crate::git_executor::{
        build_execution_step_operation, run_execution_step_prechecks, run_repository_precheck,
        StepOperation,
    };
    use crate::models::{
        ManagedProject, PipelineEdgeInput, PipelineGraphNodeInput, PipelineNodeInput,
        PipelineRunRetryRequest, PipelineStageInput, WorkflowStepInput,
    };
    use crate::runtime_support::{
        derive_run_final_status, derive_run_final_status_from_project_counts, get_repo_lease,
        normalize_run_parameters, now_rfc3339, ProjectExecutionStep, ProjectOutcome,
    };
    use crate::workflow_runtime_legacy::{
        execute_project_plan, mark_project_internal_failure, render_execution_steps,
        ProjectExecutionPlan,
    };
    use serde_json::{Map, Value};
    use serial_test::serial;
    use sqlx::{migrate::Migrator, sqlite::SqlitePoolOptions, SqlitePool};
    use std::collections::VecDeque;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::str::FromStr;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::Mutex as TokioMutex;
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

    async fn wait_for_terminal_pipeline_run_status(
        pool: &SqlitePool,
        run_id: i64,
        timeout_ms: u64,
    ) -> crate::models::PipelineRunDetail {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        loop {
            let detail = db::get_pipeline_run_detail(pool, run_id)
                .await
                .expect("load pipeline run detail while waiting");
            if detail.status == "completed"
                || detail.status == "partial_failed"
                || detail.status == "cancelled"
            {
                return detail;
            }

            if std::time::Instant::now() >= deadline {
                panic!("pipeline run {run_id} did not reach terminal status in {timeout_ms}ms");
            }
            sleep(Duration::from_millis(100)).await;
        }
    }

    #[derive(Debug, Clone)]
    struct TestHttpResponse {
        status_line: &'static str,
        body: String,
        extra_headers: Vec<(&'static str, String)>,
        delay_ms: u64,
    }

    async fn spawn_gitlab_test_server(responses: Vec<TestHttpResponse>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind gitlab test server");
        let addr = listener.local_addr().expect("read local addr");
        let response_queue = Arc::new(TokioMutex::new(VecDeque::from(responses)));
        let responses_for_task = Arc::clone(&response_queue);

        tokio::spawn(async move {
            loop {
                let (mut stream, _) = match listener.accept().await {
                    Ok(value) => value,
                    Err(_) => break,
                };
                let responses_for_connection = Arc::clone(&responses_for_task);
                tokio::spawn(async move {
                    let mut raw = Vec::new();
                    let mut header_end = None;
                    let mut content_length = 0usize;
                    loop {
                        let mut buffer = vec![0_u8; 2048];
                        let bytes_read = match stream.read(&mut buffer).await {
                            Ok(value) => value,
                            Err(_) => return,
                        };
                        if bytes_read == 0 {
                            break;
                        }
                        raw.extend_from_slice(&buffer[..bytes_read]);

                        if header_end.is_none() {
                            let header_probe = String::from_utf8_lossy(&raw).to_string();
                            if let Some(position) = header_probe.find("\r\n\r\n") {
                                header_end = Some(position);
                                let header_text = &header_probe[..position];
                                content_length = header_text
                                    .lines()
                                    .find_map(|line| {
                                        let lower = line.to_ascii_lowercase();
                                        lower
                                            .strip_prefix("content-length:")
                                            .and_then(|value| value.trim().parse::<usize>().ok())
                                    })
                                    .unwrap_or(0);
                            }
                        }

                        if let Some(position) = header_end {
                            let expected_len = position + 4 + content_length;
                            if raw.len() >= expected_len {
                                break;
                            }
                        }
                    }

                    let response = responses_for_connection
                        .lock()
                        .await
                        .pop_front()
                        .unwrap_or(TestHttpResponse {
                            status_line: "500 Internal Server Error",
                            body: "{}".to_string(),
                            extra_headers: vec![],
                            delay_ms: 0,
                        });

                    if response.delay_ms > 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(response.delay_ms))
                            .await;
                    }

                    let mut response_text = format!(
                        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
                        response.status_line,
                        response.body.len()
                    );
                    for (key, value) in response.extra_headers {
                        response_text.push_str(&format!("{key}: {value}\r\n"));
                    }
                    response_text.push_str("\r\n");
                    response_text.push_str(&response.body);
                    let _ = stream.write_all(response_text.as_bytes()).await;
                });
            }
        });

        format!("http://{}", addr)
    }

    #[tokio::test]
    #[serial]
    async fn workflow_runtime_legacy_execute_workflow_run_still_works() {
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
    #[serial]
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
            .contains("步骤预检查失败"));
    }

    #[tokio::test]
    #[serial]
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
        cancellation_updater
            .await
            .expect("wait cancellation updater");
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
    #[serial]
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
    #[serial]
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

        let run_id =
            execute_workflow_run(&pool, workflow.id, group.id, serde_json::json!({}), Some(1))
                .await
                .expect("execute workflow run");

        cancel_workflow_run(&pool, run_id)
            .await
            .expect("request cancellation");

        let detail = wait_for_terminal_run_status(&pool, run_id, 30_000).await;
        assert_eq!(detail.status, "cancelled");
        assert!(detail
            .projects
            .iter()
            .any(|project| project.status == "cancelled"));
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
        assert!(detail
            .projects
            .iter()
            .all(|project| project.steps.iter().all(|step| {
                !step
                    .summary_message
                    .contains("step cancelled while command was running")
            })));
    }

    #[tokio::test]
    #[serial]
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
    #[serial]
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
    #[serial]
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

        let retry_result =
            retry_failed_workflow_run(&pool, source_run_id, Some(vec![clean_project.id]), Some(1))
                .await;
        assert!(retry_result.is_err());
        assert!(retry_result
            .expect_err("retry should fail when no selected IDs are eligible")
            .to_string()
            .contains("none of selected managed project IDs are eligible failed projects"));
    }

    #[tokio::test]
    #[serial]
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

        let retry_result =
            retry_failed_workflow_run(&pool, source_run_id, Some(vec![dirty_project.id]), Some(1))
                .await;

        assert!(retry_result.is_err());
        assert!(retry_result
            .expect_err("retry should fail when failed project is disabled")
            .to_string()
            .contains("failed managed projects are currently disabled and cannot be retried"));
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_persists_run_project_and_node_state() {
        let pool = setup_test_pool().await;
        let repo = setup_git_repo();

        let managed = db::create_managed_project(
            &pool,
            76001,
            "pipeline-project-a".to_string(),
            "team/pipeline-project-a".to_string(),
            repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "pipeline-group-a".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "release-pipeline".to_string(),
            "test pipeline runtime".to_string(),
            true,
            2,
            vec![],
            vec![
                PipelineNodeInput {
                    node_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "${target_branch}" }),
                },
                PipelineNodeInput {
                    node_type: "git_merge".to_string(),
                    parameters: serde_json::json!({ "from": "${source_branch}" }),
                },
            ],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id = execute_pipeline_run(
            &pool,
            pipeline.id,
            Some(group.id),
            serde_json::json!({
                "source_branch": "release",
                "target_branch": "main"
            }),
            Some(1),
        )
        .await
        .expect("execute pipeline run");

        let seeded = db::get_pipeline_run_detail(&pool, run_id)
            .await
            .expect("load seeded pipeline run detail");
        assert_eq!(seeded.projects.len(), 1);
        assert_eq!(seeded.projects[0].nodes.len(), 2);

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "completed");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "success");
        assert_eq!(detail.projects[0].nodes.len(), 2);
        assert_eq!(detail.projects[0].nodes[0].status, "success");
        assert_eq!(detail.projects[0].nodes[1].status, "success");
        assert_eq!(
            detail.projects[0].nodes[0].rendered_parameters,
            serde_json::json!({ "branch": "main" })
        );
        assert_eq!(
            detail.projects[0].nodes[1].rendered_parameters,
            serde_json::json!({ "from": "release" })
        );
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_foundation_persists_structured_failure_envelope_for_precheck() {
        let pool = setup_test_pool().await;
        let repo = setup_git_repo();
        std::fs::write(repo.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let managed = db::create_managed_project(
            &pool,
            76002,
            "pipeline-project-b".to_string(),
            "team/pipeline-project-b".to_string(),
            repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "pipeline-group-b".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "precheck-pipeline".to_string(),
            "test precheck failure envelope".to_string(),
            true,
            1,
            vec![],
            vec![PipelineNodeInput {
                node_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "main" }),
            }],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id =
            execute_pipeline_run(&pool, pipeline.id, Some(group.id), serde_json::json!({}), Some(1))
                .await
                .expect("execute pipeline run");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "partial_failed");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "failed_precheck");
        assert_eq!(detail.projects[0].nodes.len(), 1);
        assert_eq!(detail.projects[0].nodes[0].status, "failed");
        assert_eq!(
            detail.projects[0].nodes[0].error_code.as_deref(),
            Some("git.worktree_dirty")
        );
        assert_eq!(
            detail.projects[0].nodes[0].title_zh.as_deref(),
            Some("仓库工作区不干净")
        );
        assert!(detail.projects[0].nodes[0]
            .detail_zh
            .as_deref()
            .unwrap_or_default()
            .contains("未提交"));
        assert!(detail.projects[0].nodes[0]
            .suggestion_zh
            .as_deref()
            .unwrap_or_default()
            .contains("重试"));
        let diagnostics =
            db::get_pipeline_run_node_diagnostics(&pool, detail.projects[0].nodes[0].id)
                .await
                .expect("get pipeline run node diagnostics");
        assert!(diagnostics
            .evidence
            .as_deref()
            .unwrap_or_default()
            .contains("repository worktree is not clean"));
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_retry_failed_run_creates_new_run_with_failed_projects_only() {
        let pool = setup_test_pool().await;
        let clean_repo = setup_git_repo();
        let dirty_repo = setup_git_repo();
        std::fs::write(dirty_repo.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let clean_project = db::create_managed_project(
            &pool,
            76003,
            "pipeline-project-clean".to_string(),
            "team/pipeline-project-clean".to_string(),
            clean_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create clean project");
        let dirty_project = db::create_managed_project(
            &pool,
            76004,
            "pipeline-project-dirty".to_string(),
            "team/pipeline-project-dirty".to_string(),
            dirty_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create dirty project");

        let group = db::create_project_group(&pool, "pipeline-group-retry".to_string())
            .await
            .expect("create retry project group");
        db::add_projects_to_group(&pool, group.id, vec![clean_project.id, dirty_project.id])
            .await
            .expect("add projects to retry group");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "retry-pipeline".to_string(),
            "test retry failed pipeline projects".to_string(),
            true,
            1,
            vec![],
            vec![PipelineNodeInput {
                node_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "main" }),
            }],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let source_run_id =
            execute_pipeline_run(&pool, pipeline.id, Some(group.id), serde_json::json!({}), Some(1))
                .await
                .expect("execute source pipeline run");

        let source_detail =
            wait_for_terminal_pipeline_run_status(&pool, source_run_id, 15_000).await;
        assert_eq!(source_detail.status, "partial_failed");

        let retry_run_id =
            retry_pipeline_run(&pool, source_run_id, Some(vec![dirty_project.id]), Some(1))
                .await
                .expect("retry failed pipeline run");

        let retry_seeded = db::get_pipeline_run_detail(&pool, retry_run_id)
            .await
            .expect("load retry seeded pipeline run");
        assert_eq!(retry_seeded.source_pipeline_run_id, Some(source_run_id));
        assert_eq!(retry_seeded.projects.len(), 1);
        assert_eq!(
            retry_seeded.projects[0].managed_project_id,
            Some(dirty_project.id)
        );
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_retry_failed_run_supports_project_switching_runs() {
        let pool = setup_test_pool().await;
        let clean_repo = setup_git_repo();
        let dirty_repo = setup_git_repo();
        std::fs::write(dirty_repo.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let clean_project = db::create_managed_project(
            &pool,
            76005,
            "pipeline-switch-clean".to_string(),
            "team/pipeline-switch-clean".to_string(),
            clean_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create clean switch project");
        let dirty_project = db::create_managed_project(
            &pool,
            76006,
            "pipeline-switch-dirty".to_string(),
            "team/pipeline-switch-dirty".to_string(),
            dirty_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create dirty switch project");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "switch-project-retry-pipeline".to_string(),
            "test retry for switch_project pipeline runs".to_string(),
            true,
            2,
            vec![],
            vec![
                PipelineNodeInput {
                    node_type: "switch_project".to_string(),
                    parameters: serde_json::json!({
                        "managedProjectId": clean_project.id.to_string()
                    }),
                },
                PipelineNodeInput {
                    node_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "main" }),
                },
                PipelineNodeInput {
                    node_type: "switch_project".to_string(),
                    parameters: serde_json::json!({
                        "managedProjectId": dirty_project.id.to_string()
                    }),
                },
                PipelineNodeInput {
                    node_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "main" }),
                },
            ],
            vec![],
        )
        .await
        .expect("create switch project retry pipeline");

        let source_run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(2))
            .await
            .expect("execute switch project source run");

        let source_detail = wait_for_terminal_pipeline_run_status(&pool, source_run_id, 15_000).await;
        assert_eq!(source_detail.status, "partial_failed");
        assert_eq!(source_detail.project_group_id, None);
        assert_eq!(source_detail.projects.len(), 2);

        let retry_run_id =
            retry_pipeline_run(&pool, source_run_id, Some(vec![dirty_project.id]), Some(2))
                .await
                .expect("retry switch project pipeline run");

        let retry_seeded = db::get_pipeline_run_detail(&pool, retry_run_id)
            .await
            .expect("load switch project retry seeded pipeline run");
        assert_eq!(retry_seeded.source_pipeline_run_id, Some(source_run_id));
        assert_eq!(retry_seeded.project_group_id, None);
        assert_eq!(retry_seeded.projects.len(), 1);
        assert_eq!(
            retry_seeded.projects[0].managed_project_id,
            Some(dirty_project.id)
        );
        assert_eq!(retry_seeded.projects[0].nodes.len(), 2);
        assert_eq!(retry_seeded.projects[0].nodes[0].node_type, "switch_project");
        assert_eq!(retry_seeded.projects[0].nodes[1].node_type, "checkout_branch");
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_cancel_marks_running_run_as_cancelling() {
        let pool = setup_test_pool().await;

        let pipeline = db::create_pipeline_definition(
            &pool,
            "cancel-pipeline".to_string(),
            "test cancel pipeline run".to_string(),
            true,
            1,
            vec![],
            vec![PipelineNodeInput {
                node_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "main" }),
            }],
            vec![],
        )
        .await
        .expect("create pipeline definition");
        let group = db::create_project_group(&pool, "pipeline-group-cancel".to_string())
            .await
            .expect("create project group");

        let now = chrono::Utc::now().to_rfc3339();
        let run_id = sqlx::query(
            r#"INSERT INTO pipeline_runs (
             pipeline_definition_id, project_group_id, legacy_workflow_run_id, source_pipeline_run_id,
             trigger_kind, status, run_parameters_json, max_concurrency, started_at, finished_at, created_at, updated_at
           ) VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)"#,
        )
        .bind(pipeline.id)
        .bind(group.id)
        .bind("manual")
        .bind("running")
        .bind(r#"{}"#)
        .bind(1_i64)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .expect("insert running pipeline run")
        .last_insert_rowid();

        cancel_pipeline_run(&pool, run_id)
            .await
            .expect("cancel pipeline run");

        let status =
            sqlx::query_scalar::<_, String>(r#"SELECT status FROM pipeline_runs WHERE id = ?1"#)
                .bind(run_id)
                .fetch_one(&pool)
                .await
                .expect("reload pipeline run status");
        assert_eq!(status, "cancelling");
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_foundation_gitlab_nodes_persist_wait_metadata() {
        let pool = setup_test_pool().await;
        let repo = setup_git_repo();
        let base_url = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":501,"status":"success","ref":"main","sha":"sha-check","web_url":"https://gitlab.example/p/501"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "201 Created",
                body: r#"{"id":777,"status":"pending","ref":"main","sha":"sha-trigger","web_url":"https://gitlab.example/p/777"}"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":777,"status":"running","ref":"main","sha":"sha-trigger","web_url":"https://gitlab.example/p/777"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":777,"status":"success","ref":"main","sha":"sha-trigger","web_url":"https://gitlab.example/p/777"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
        ])
        .await;

        db::set_gitlab_config(&pool, &base_url, "test-token", None, None, None)
            .await
            .expect("save gitlab config");

        let managed = db::create_managed_project(
            &pool,
            76005,
            "pipeline-project-gitlab".to_string(),
            "team/pipeline-project-gitlab".to_string(),
            repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "pipeline-group-gitlab".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "gitlab-runtime-pipeline".to_string(),
            "test gitlab runtime nodes".to_string(),
            true,
            1,
            vec![],
            vec![
                PipelineNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/pipeline-project-gitlab",
                        "ref": "main"
                    }),
                },
                PipelineNodeInput {
                    node_type: "trigger_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/pipeline-project-gitlab",
                        "ref": "main",
                        "variables": {
                            "DEPLOY_ENV": "prod"
                        }
                    }),
                },
                PipelineNodeInput {
                    node_type: "wait_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/pipeline-project-gitlab",
                        "ref": "main",
                        "poll_interval_ms": 10,
                        "timeout_ms": 500
                    }),
                },
            ],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id =
            execute_pipeline_run(&pool, pipeline.id, Some(group.id), serde_json::json!({}), Some(1))
                .await
                .expect("execute pipeline run");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "completed");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "success");
        assert_eq!(detail.projects[0].nodes.len(), 3);
        assert_eq!(detail.projects[0].nodes[0].node_type, "check_pipeline");
        assert_eq!(detail.projects[0].nodes[0].status, "success");
        assert_eq!(detail.projects[0].nodes[1].node_type, "trigger_pipeline");
        assert_eq!(detail.projects[0].nodes[1].status, "success");
        assert_eq!(detail.projects[0].nodes[2].node_type, "wait_pipeline");
        assert_eq!(detail.projects[0].nodes[2].status, "success");
        assert_eq!(
            detail.projects[0].nodes[2].wait_target.as_deref(),
            Some("team/pipeline-project-gitlab@main")
        );
        assert_eq!(
            detail.projects[0].nodes[2].last_remote_status.as_deref(),
            Some("success")
        );
        assert_eq!(detail.projects[0].nodes[2].remote_pipeline_id, Some(777));
        let wait_diagnostics =
            db::get_pipeline_run_node_diagnostics(&pool, detail.projects[0].nodes[2].id)
                .await
                .expect("get pipeline run node diagnostics");
        assert_eq!(
            wait_diagnostics
                .wait_context
                .as_ref()
                .and_then(|value| value.get("webUrl"))
                .and_then(Value::as_str),
            Some("https://gitlab.example/p/777")
        );
        assert!(detail.projects[0].nodes[1].summary_message.contains("#777"));
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_gitlab_failed_check_pipeline_persists_failure_envelope() {
        let pool = setup_test_pool().await;
        let repo = setup_git_repo();
        let base_url = spawn_gitlab_test_server(vec![TestHttpResponse {
            status_line: "200 OK",
            body: r#"[{"id":601,"status":"failed","ref":"main","sha":"sha-failed","web_url":"https://gitlab.example/p/601"}]"#.to_string(),
            extra_headers: vec![],
            delay_ms: 0,
        }])
        .await;

        db::set_gitlab_config(&pool, &base_url, "test-token", None, None, None)
            .await
            .expect("save gitlab config");

        let managed = db::create_managed_project(
            &pool,
            76006,
            "pipeline-project-gitlab-failed".to_string(),
            "team/pipeline-project-gitlab-failed".to_string(),
            repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "pipeline-group-gitlab-failed".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "gitlab-failed-check-pipeline".to_string(),
            "test failed check pipeline envelope".to_string(),
            true,
            1,
            vec![],
            vec![PipelineNodeInput {
                node_type: "check_pipeline".to_string(),
                parameters: serde_json::json!({
                    "project": "team/pipeline-project-gitlab-failed",
                    "ref": "main"
                }),
            }],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id =
            execute_pipeline_run(&pool, pipeline.id, Some(group.id), serde_json::json!({}), Some(1))
                .await
                .expect("execute pipeline run");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "partial_failed");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "failed");
        assert_eq!(detail.projects[0].nodes.len(), 1);
        assert_eq!(detail.projects[0].nodes[0].node_type, "check_pipeline");
        assert_eq!(detail.projects[0].nodes[0].status, "failed");
        assert_eq!(
            detail.projects[0].nodes[0].error_code.as_deref(),
            Some("gitlab.pipeline_failed")
        );
        assert!(detail.projects[0].nodes[0]
            .title_zh
            .as_deref()
            .unwrap_or_default()
            .contains("流水线"));
        assert!(detail.projects[0].nodes[0]
            .detail_zh
            .as_deref()
            .unwrap_or_default()
            .contains("失败"));
        let diagnostics =
            db::get_pipeline_run_node_diagnostics(&pool, detail.projects[0].nodes[0].id)
                .await
                .expect("get pipeline run node diagnostics");
        assert!(diagnostics
            .evidence
            .as_deref()
            .unwrap_or_default()
            .contains("pipeline_id=601"));
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_stage_runtime_runs_stage_two_only_after_stage_one_success() {
        let pool = setup_test_pool().await;
        let base_url = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":801,"status":"success","ref":"main","sha":"sha-stage-one","web_url":"https://gitlab.example/p/801"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 200,
            },
            TestHttpResponse {
                status_line: "201 Created",
                body: r#"{"id":802,"status":"pending","ref":"main","sha":"sha-stage-two","web_url":"https://gitlab.example/p/802"}"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
        ])
        .await;
        db::set_gitlab_config(&pool, &base_url, "test-token", None, None, None)
            .await
            .expect("save gitlab config");

        let pipeline = db::create_pipeline_definition_graph(
            &pool,
            "stage-serial-runtime".to_string(),
            "stage serial runtime".to_string(),
            true,
            2,
            vec![],
            vec![
                PipelineStageInput {
                    stage_key: "gate".to_string(),
                    name: "门禁".to_string(),
                    enabled: true,
                },
                PipelineStageInput {
                    stage_key: "release".to_string(),
                    name: "发布".to_string(),
                    enabled: true,
                },
            ],
            vec![
                PipelineGraphNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-a",
                        "ref": "main"
                    }),
                    stage_key: Some("gate".to_string()),
                    node_key: Some("gate_check".to_string()),
                    position_x: Some(120.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
                PipelineGraphNodeInput {
                    node_type: "trigger_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-a",
                        "ref": "main"
                    }),
                    stage_key: Some("release".to_string()),
                    node_key: Some("release_trigger".to_string()),
                    position_x: Some(420.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
            ],
            vec![PipelineEdgeInput {
                source_node_key: "gate_check".to_string(),
                target_node_key: "release_trigger".to_string(),
            }],
            vec![],
        )
        .await
        .expect("create stage-aware pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(2))
            .await
            .expect("execute stage-aware pipeline run");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        let stages = db::load_pipeline_run_stages(&pool, run_id)
            .await
            .expect("load pipeline run stages");

        assert_eq!(detail.status, "completed");
        assert_eq!(stages.len(), 2);
        assert_eq!(stages[0].stage_key, "gate");
        assert_eq!(stages[0].status, "success");
        assert_eq!(stages[1].stage_key, "release");
        assert_eq!(stages[1].status, "success");
        assert!(stages[0].finished_at.is_some());
        assert!(stages[1].started_at.is_some());
        assert!(
            stages[0].finished_at.as_deref() <= stages[1].started_at.as_deref(),
            "expected second stage to start only after first stage finished: {:?}",
            stages
        );
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_stage_runtime_runs_independent_nodes_in_parallel() {
        let pool = setup_test_pool().await;
        let base_url = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":811,"status":"success","ref":"main","sha":"sha-a","web_url":"https://gitlab.example/p/811"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 250,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":812,"status":"success","ref":"main","sha":"sha-b","web_url":"https://gitlab.example/p/812"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 250,
            },
        ])
        .await;
        db::set_gitlab_config(&pool, &base_url, "test-token", None, None, None)
            .await
            .expect("save gitlab config");

        let pipeline = db::create_pipeline_definition_graph(
            &pool,
            "stage-parallel-runtime".to_string(),
            "stage parallel runtime".to_string(),
            true,
            4,
            vec![],
            vec![PipelineStageInput {
                stage_key: "gate".to_string(),
                name: "并行门禁".to_string(),
                enabled: true,
            }],
            vec![
                PipelineGraphNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-a",
                        "ref": "main"
                    }),
                    stage_key: Some("gate".to_string()),
                    node_key: Some("gate_check_a".to_string()),
                    position_x: Some(120.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
                PipelineGraphNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-b",
                        "ref": "main"
                    }),
                    stage_key: Some("gate".to_string()),
                    node_key: Some("gate_check_b".to_string()),
                    position_x: Some(320.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
            ],
            vec![],
            vec![],
        )
        .await
        .expect("create stage-aware pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(4))
            .await
            .expect("execute parallel stage-aware pipeline run");
        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        let node_a_started_at = chrono::DateTime::parse_from_rfc3339(
            detail.projects[0].nodes[0].started_at.as_deref().expect("node a started_at"),
        )
        .expect("parse node a started_at");
        let node_b_started_at = chrono::DateTime::parse_from_rfc3339(
            detail.projects[0].nodes[1].started_at.as_deref().expect("node b started_at"),
        )
        .expect("parse node b started_at");
        let started_gap_ms = (node_a_started_at - node_b_started_at)
            .num_milliseconds()
            .unsigned_abs();

        assert_eq!(detail.status, "completed");
        assert!(
            started_gap_ms < 200,
            "expected independent nodes to start nearly together, gap_ms={started_gap_ms}"
        );
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_stage_runtime_blocks_downstream_stages_after_failure() {
        let pool = setup_test_pool().await;
        let base_url = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":821,"status":"failed","ref":"main","sha":"sha-fail","web_url":"https://gitlab.example/p/821"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":822,"status":"success","ref":"main","sha":"sha-success","web_url":"https://gitlab.example/p/822"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 250,
            },
        ])
        .await;
        db::set_gitlab_config(&pool, &base_url, "test-token", None, None, None)
            .await
            .expect("save gitlab config");

        let pipeline = db::create_pipeline_definition_graph(
            &pool,
            "stage-failure-blocking-runtime".to_string(),
            "stage failure blocking runtime".to_string(),
            true,
            4,
            vec![],
            vec![
                PipelineStageInput {
                    stage_key: "gate".to_string(),
                    name: "门禁".to_string(),
                    enabled: true,
                },
                PipelineStageInput {
                    stage_key: "deploy".to_string(),
                    name: "部署".to_string(),
                    enabled: true,
                },
            ],
            vec![
                PipelineGraphNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-a",
                        "ref": "main"
                    }),
                    stage_key: Some("gate".to_string()),
                    node_key: Some("gate_fail".to_string()),
                    position_x: Some(120.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
                PipelineGraphNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-b",
                        "ref": "main"
                    }),
                    stage_key: Some("gate".to_string()),
                    node_key: Some("gate_success".to_string()),
                    position_x: Some(320.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
                PipelineGraphNodeInput {
                    node_type: "trigger_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/downstream",
                        "ref": "main"
                    }),
                    stage_key: Some("deploy".to_string()),
                    node_key: Some("deploy_trigger".to_string()),
                    position_x: Some(520.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
            ],
            vec![],
            vec![],
        )
        .await
        .expect("create stage-aware pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(4))
            .await
            .expect("execute stage-aware pipeline run");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        let stages = db::load_pipeline_run_stages(&pool, run_id)
            .await
            .expect("load stage runtime rows");

        assert_eq!(detail.status, "partial_failed");
        assert_eq!(detail.projects.len(), 1);
        let node_statuses = detail.projects[0]
            .nodes
            .iter()
            .map(|node| node.status.as_str())
            .collect::<Vec<_>>();
        assert!(
            node_statuses.contains(&"failed"),
            "expected one gate node to fail, got {:?}",
            node_statuses
        );
        assert!(
            node_statuses.contains(&"success"),
            "expected already-started peer node to finish, got {:?}",
            node_statuses
        );
        assert!(
            !node_statuses.contains(&"success") || node_statuses.len() == 3,
            "expected downstream node to remain blocked, got {:?}",
            node_statuses
        );
        assert_eq!(stages.len(), 2);
        assert!(
            stages[0].status == "failed" || stages[0].status == "partial_failed",
            "expected first stage to fail, got {:?}",
            stages
        );
        assert_eq!(stages[1].status, "pending");
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_stage_runtime_wait_node_persists_stage_waiting_context() {
        let pool = setup_test_pool().await;
        let base_url = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "201 Created",
                body: r#"{"id":831,"status":"pending","ref":"main","sha":"sha-trigger","web_url":"https://gitlab.example/p/831"}"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":831,"status":"running","ref":"main","sha":"sha-trigger","web_url":"https://gitlab.example/p/831"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":831,"status":"success","ref":"main","sha":"sha-trigger","web_url":"https://gitlab.example/p/831"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
        ])
        .await;
        db::set_gitlab_config(&pool, &base_url, "test-token", None, None, None)
            .await
            .expect("save gitlab config");

        let pipeline = db::create_pipeline_definition_graph(
            &pool,
            "stage-wait-runtime".to_string(),
            "stage wait runtime".to_string(),
            true,
            2,
            vec![],
            vec![PipelineStageInput {
                stage_key: "deploy".to_string(),
                name: "部署".to_string(),
                enabled: true,
            }],
            vec![
                PipelineGraphNodeInput {
                    node_type: "trigger_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-a",
                        "ref": "main"
                    }),
                    stage_key: Some("deploy".to_string()),
                    node_key: Some("deploy_trigger".to_string()),
                    position_x: Some(120.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
                PipelineGraphNodeInput {
                    node_type: "wait_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-a",
                        "ref": "main",
                        "poll_interval_ms": 10,
                        "timeout_ms": 500
                    }),
                    stage_key: Some("deploy".to_string()),
                    node_key: Some("deploy_wait".to_string()),
                    position_x: Some(320.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
            ],
            vec![PipelineEdgeInput {
                source_node_key: "deploy_trigger".to_string(),
                target_node_key: "deploy_wait".to_string(),
            }],
            vec![],
        )
        .await
        .expect("create stage-aware pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(2))
            .await
            .expect("execute stage-aware pipeline run");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        let stages = db::load_pipeline_run_stages(&pool, run_id)
            .await
            .expect("load stage runtime rows");
        let wait_node = detail.projects[0]
            .nodes
            .iter()
            .find(|node| node.node_type == "wait_pipeline")
            .expect("find wait node");
        let diagnostics = db::get_pipeline_run_node_diagnostics(&pool, wait_node.id)
            .await
            .expect("load wait diagnostics");

        assert_eq!(detail.status, "completed");
        assert_eq!(stages.len(), 1);
        assert_eq!(stages[0].status, "success");
        assert!(stages[0].started_at.is_some());
        assert!(stages[0].finished_at.is_some());
        assert_eq!(
            diagnostics
                .wait_context
                .as_ref()
                .and_then(|value| value.get("webUrl"))
                .and_then(Value::as_str),
            Some("https://gitlab.example/p/831")
        );
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_stage_retry_marks_earlier_successful_stages_as_reused() {
        let pool = setup_test_pool().await;
        let base_url = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":841,"status":"success","ref":"main","sha":"sha-gate","web_url":"https://gitlab.example/p/841"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":842,"status":"failed","ref":"main","sha":"sha-release-failed","web_url":"https://gitlab.example/p/842"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":843,"status":"success","ref":"main","sha":"sha-release-success","web_url":"https://gitlab.example/p/843"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
        ])
        .await;
        db::set_gitlab_config(&pool, &base_url, "test-token", None, None, None)
            .await
            .expect("save gitlab config");

        let pipeline = db::create_pipeline_definition_graph(
            &pool,
            "stage-retry-runtime".to_string(),
            "stage retry runtime".to_string(),
            true,
            2,
            vec![],
            vec![
                PipelineStageInput {
                    stage_key: "gate".to_string(),
                    name: "门禁".to_string(),
                    enabled: true,
                },
                PipelineStageInput {
                    stage_key: "release".to_string(),
                    name: "发布".to_string(),
                    enabled: true,
                },
            ],
            vec![
                PipelineGraphNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-a",
                        "ref": "main"
                    }),
                    stage_key: Some("gate".to_string()),
                    node_key: Some("gate_check".to_string()),
                    position_x: Some(120.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
                PipelineGraphNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-b",
                        "ref": "main"
                    }),
                    stage_key: Some("release".to_string()),
                    node_key: Some("release_check".to_string()),
                    position_x: Some(320.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
            ],
            vec![PipelineEdgeInput {
                source_node_key: "gate_check".to_string(),
                target_node_key: "release_check".to_string(),
            }],
            vec![],
        )
        .await
        .expect("create stage-aware pipeline definition");

        let source_run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(2))
            .await
            .expect("execute source stage-aware pipeline run");
        let source_detail = wait_for_terminal_pipeline_run_status(&pool, source_run_id, 15_000).await;
        assert_eq!(source_detail.status, "partial_failed");
        assert_eq!(source_detail.stages.len(), 2);

        let retry_run_id = super::retry_pipeline_run_with_request(
            &pool,
            PipelineRunRetryRequest {
                source_pipeline_run_id: source_run_id,
                retry_mode: Some("stage".to_string()),
                target_stage_id: source_detail
                    .stages
                    .get(1)
                    .and_then(|stage| stage.pipeline_stage_id),
                target_run_node_id: None,
                selected_managed_project_ids: None,
                max_concurrency_override: Some(2),
                run_parameters_override: None,
            },
        )
        .await
        .expect("retry from failed stage");

        let retry_detail = wait_for_terminal_pipeline_run_status(&pool, retry_run_id, 15_000).await;
        let retry_stages = &retry_detail.stages;
        assert_eq!(retry_detail.status, "completed");
        assert_eq!(retry_detail.source_pipeline_run_id, Some(source_run_id));
        assert_eq!(retry_stages[0].status, "reused");
        assert_eq!(retry_stages[1].status, "success");
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_stage_retry_reruns_selected_node_and_downstream_dependency_chain_only() {
        let pool = setup_test_pool().await;
        let base_url = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":851,"status":"success","ref":"main","sha":"sha-gate","web_url":"https://gitlab.example/p/851"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":852,"status":"failed","ref":"main","sha":"sha-build-failed","web_url":"https://gitlab.example/p/852"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":853,"status":"success","ref":"main","sha":"sha-build-success","web_url":"https://gitlab.example/p/853"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "201 Created",
                body: r#"{"id":854,"status":"pending","ref":"main","sha":"sha-deploy","web_url":"https://gitlab.example/p/854"}"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
        ])
        .await;
        db::set_gitlab_config(&pool, &base_url, "test-token", None, None, None)
            .await
            .expect("save gitlab config");

        let pipeline = db::create_pipeline_definition_graph(
            &pool,
            "node-retry-runtime".to_string(),
            "node retry runtime".to_string(),
            true,
            2,
            vec![],
            vec![
                PipelineStageInput {
                    stage_key: "gate".to_string(),
                    name: "门禁".to_string(),
                    enabled: true,
                },
                PipelineStageInput {
                    stage_key: "build".to_string(),
                    name: "构建".to_string(),
                    enabled: true,
                },
                PipelineStageInput {
                    stage_key: "deploy".to_string(),
                    name: "部署".to_string(),
                    enabled: true,
                },
            ],
            vec![
                PipelineGraphNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-a",
                        "ref": "main"
                    }),
                    stage_key: Some("gate".to_string()),
                    node_key: Some("gate_check".to_string()),
                    position_x: Some(120.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
                PipelineGraphNodeInput {
                    node_type: "check_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-b",
                        "ref": "main"
                    }),
                    stage_key: Some("build".to_string()),
                    node_key: Some("build_check".to_string()),
                    position_x: Some(320.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
                PipelineGraphNodeInput {
                    node_type: "trigger_pipeline".to_string(),
                    parameters: serde_json::json!({
                        "project": "team/service-c",
                        "ref": "main"
                    }),
                    stage_key: Some("deploy".to_string()),
                    node_key: Some("deploy_trigger".to_string()),
                    position_x: Some(520.0),
                    position_y: Some(80.0),
                    enabled: Some(true),
                },
            ],
            vec![
                PipelineEdgeInput {
                    source_node_key: "gate_check".to_string(),
                    target_node_key: "build_check".to_string(),
                },
                PipelineEdgeInput {
                    source_node_key: "build_check".to_string(),
                    target_node_key: "deploy_trigger".to_string(),
                },
            ],
            vec![],
        )
        .await
        .expect("create node-retry stage-aware pipeline definition");

        let source_run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(2))
            .await
            .expect("execute source node-retry pipeline run");
        let source_detail = wait_for_terminal_pipeline_run_status(&pool, source_run_id, 15_000).await;
        assert_eq!(source_detail.status, "partial_failed");

        let failed_run_node_id = source_detail.projects[0]
            .nodes
            .iter()
            .find(|node| node.status == "failed")
            .map(|node| node.id)
            .expect("find failed run node");

        let retry_run_id = super::retry_pipeline_run_with_request(
            &pool,
            PipelineRunRetryRequest {
                source_pipeline_run_id: source_run_id,
                retry_mode: Some("node".to_string()),
                target_stage_id: None,
                target_run_node_id: Some(failed_run_node_id),
                selected_managed_project_ids: None,
                max_concurrency_override: Some(2),
                run_parameters_override: None,
            },
        )
        .await
        .expect("retry from failed node");

        let retry_detail = wait_for_terminal_pipeline_run_status(&pool, retry_run_id, 15_000).await;
        let retry_stages = &retry_detail.stages;
        assert_eq!(retry_detail.status, "completed");
        assert_eq!(retry_detail.source_pipeline_run_id, Some(source_run_id));
        assert_eq!(retry_stages[0].status, "reused");
        assert_eq!(retry_stages[1].status, "success");
        assert_eq!(retry_stages[2].status, "success");
    }

    #[test]
    fn pipeline_runtime_refactor_normalize_run_parameters_accepts_null_and_object() {
        let normalized_null =
            normalize_run_parameters(Value::Null).expect("normalize null run parameters");
        assert_eq!(normalized_null, Value::Object(Map::new()));

        let original = serde_json::json!({
            "branch": "release",
            "count": 2,
            "dryRun": true
        });
        let normalized_object =
            normalize_run_parameters(original.clone()).expect("normalize object run parameters");
        assert_eq!(normalized_object, original);

        assert!(normalize_run_parameters(Value::Array(vec![])).is_err());
    }

    #[test]
    fn pipeline_runtime_refactor_render_execution_steps_renders_nested_templates() {
        let step_defs = vec![WorkflowExecutionStepDef {
            id: 41,
            step_order: 0,
            step_type: "git_pull".to_string(),
            parameters: serde_json::json!({
                "remote": "${remote}",
                "branch": "${branch}",
                "labels": ["${branch}", "${count}", "${dryRun}"],
                "nested": {
                    "target": "${remote}/${branch}"
                }
            }),
        }];

        let rendered = render_execution_steps(
            &step_defs,
            &serde_json::json!({
                "remote": "upstream",
                "branch": "release",
                "count": 3,
                "dryRun": false
            }),
        )
        .expect("render execution steps");

        assert_eq!(rendered.len(), 1);
        assert_eq!(
            rendered[0].rendered_parameters,
            serde_json::json!({
                "remote": "upstream",
                "branch": "release",
                "labels": ["release", "3", "false"],
                "nested": {
                    "target": "upstream/release"
                }
            })
        );
    }

    #[test]
    fn pipeline_runtime_refactor_build_execution_step_operation_uses_project_defaults() {
        let project = ManagedProject {
            id: 1,
            gitlab_project_id: 88,
            name: "project-a".to_string(),
            path_with_namespace: "team/project-a".to_string(),
            repo_path: "D:/repos/project-a".to_string(),
            default_branch: "main".to_string(),
            default_remote: "origin".to_string(),
            enabled: true,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        };
        let step = ProjectExecutionStep {
            run_step_id: 9,
            step_type: "git_pull".to_string(),
            rendered_parameters: serde_json::json!({}),
        };

        let operation = build_execution_step_operation(
            &step.step_type,
            &step.rendered_parameters,
            Some(&project),
            Some(std::path::Path::new(&project.repo_path)),
        )
        .expect("build execution step operation");

        assert_eq!(
            operation.to_args(),
            vec![
                "pull".to_string(),
                "origin".to_string(),
                "main".to_string(),
                "--ff-only".to_string()
            ]
        );
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_refactor_run_repository_precheck_rejects_dirty_worktree() {
        let repo = setup_git_repo();
        std::fs::write(repo.join("README.md"), "dirty\n").expect("mutate tracked file");
        let project = ManagedProject {
            id: 1,
            gitlab_project_id: 99,
            name: "project-a".to_string(),
            path_with_namespace: "team/project-a".to_string(),
            repo_path: repo.to_string_lossy().to_string(),
            default_branch: "main".to_string(),
            default_remote: "origin".to_string(),
            enabled: true,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        };

        let error = run_repository_precheck(std::path::Path::new(&project.repo_path))
            .await
            .expect_err("dirty worktree should fail repo precheck");

        assert!(error.to_string().contains("not clean"));
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_refactor_run_execution_step_prechecks_rejects_missing_checkout_branch(
    ) {
        let repo = setup_git_repo();
        let project = ManagedProject {
            id: 1,
            gitlab_project_id: 99,
            name: "project-a".to_string(),
            path_with_namespace: "team/project-a".to_string(),
            repo_path: repo.to_string_lossy().to_string(),
            default_branch: "main".to_string(),
            default_remote: "origin".to_string(),
            enabled: true,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        };
        let operation = StepOperation::CheckoutBranch {
            branch: "missing-branch".to_string(),
        };

        let error = run_execution_step_prechecks(
            Some(std::path::Path::new(&project.repo_path)),
            Some(&project),
            &operation,
        )
            .await
            .expect_err("missing branch should fail step prechecks");

        assert!(error.to_string().contains("missing-branch"));
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

    #[test]
    fn pipeline_runtime_task4_entrypoints_are_available() {
        let _ = crate::pipeline_runtime::execute_pipeline_run;
        let _ = crate::pipeline_runtime::execute_scheduled_pipeline_run;
        let _ = crate::pipeline_runtime::cancel_pipeline_run;
        let _ = crate::pipeline_runtime::retry_pipeline_run;
    }

    #[test]
    fn workflow_runtime_legacy_task4_entrypoints_are_available() {
        let _ = crate::workflow_runtime_legacy::reconcile_stale_workflow_runs;
        let _ = crate::workflow_runtime_legacy::execute_workflow_run;
        let _ = crate::workflow_runtime_legacy::cancel_workflow_run;
        let _ = crate::workflow_runtime_legacy::retry_failed_workflow_run;
    }

    #[tokio::test]
    #[serial]
    async fn repo_lease_blocks_concurrent_execution_for_same_repo_path() {
        let lease_a = get_repo_lease(r"D:\Repos\Shared").await;
        let lease_b = get_repo_lease("d:/repos/shared").await;
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
    #[serial]
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
