use anyhow::Result;
use chrono::{DateTime, Timelike, Utc};
use chrono_tz::Tz;
use croner::parser::{CronParser, Seconds};
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{self, Duration, MissedTickBehavior};

use crate::{
    db,
    models::{PipelineSchedule, PipelineScheduleRuntimeSnapshot},
    workflows,
};

const SCHEDULER_TICK_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
struct QueuedScheduleRequest {
    schedule_id: i64,
    pipeline_definition_id: i64,
    run_parameters: Value,
}

#[derive(Debug, Default)]
struct SchedulerState {
    last_fired_slots: HashMap<i64, String>,
    queued_requests: VecDeque<QueuedScheduleRequest>,
    schedule_feedback: HashMap<i64, ScheduleFeedback>,
}

#[derive(Debug, Clone)]
struct LoadedPipelineSchedule {
    schedule_id: i64,
    pipeline_definition_id: i64,
    cron_expr: String,
    timezone: String,
    policy: String,
    run_parameters: Value,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct SchedulerTickSummary {
    pub started_runs: usize,
    pub queued_runs: usize,
    pub skipped_runs: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScheduleDecision {
    Started,
    Queued,
    Skipped,
}

impl ScheduleDecision {
    fn as_str(self) -> &'static str {
        match self {
            ScheduleDecision::Started => "started",
            ScheduleDecision::Queued => "queued",
            ScheduleDecision::Skipped => "skipped",
        }
    }
}

#[derive(Debug, Clone)]
struct ScheduleFeedback {
    last_decision: ScheduleDecision,
    last_decision_at: String,
    last_decision_message_zh: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PipelineSchedulerRuntime {
    state: Arc<Mutex<SchedulerState>>,
}

async fn load_enabled_pipeline_schedules(pool: &SqlitePool) -> Result<Vec<LoadedPipelineSchedule>> {
    let rows = sqlx::query_as::<_, (i64, i64, String, String, String, String)>(
        r#"SELECT
             s.id,
             s.pipeline_definition_id,
             s.cron_expr,
             s.timezone,
             s.policy,
             s.variables_json
           FROM pipeline_schedules s
           INNER JOIN pipeline_definitions d ON d.id = s.pipeline_definition_id
           WHERE d.enabled = 1
             AND s.enabled = 1
           ORDER BY s.id ASC"#,
    )
    .fetch_all(pool)
    .await?;

    let mut schedules = Vec::with_capacity(rows.len());
    for row in rows {
        let run_parameters: Value =
            serde_json::from_str(&row.5).map_err(|error| anyhow::anyhow!(error))?;
        let Value::Object(_) = run_parameters else {
            return Err(anyhow::anyhow!(
                "pipeline schedule variables must be a JSON object"
            ));
        };

        schedules.push(LoadedPipelineSchedule {
            schedule_id: row.0,
            pipeline_definition_id: row.1,
            cron_expr: row.2,
            timezone: row.3,
            policy: row.4,
            run_parameters,
        });
    }

    Ok(schedules)
}

fn active_run_count(active_run_counts: &HashMap<i64, i64>, pipeline_definition_id: i64) -> i64 {
    active_run_counts
        .get(&pipeline_definition_id)
        .copied()
        .unwrap_or(0)
}

fn increment_active_run_count(active_run_counts: &mut HashMap<i64, i64>, pipeline_definition_id: i64) {
    *active_run_counts.entry(pipeline_definition_id).or_insert(0) += 1;
}

fn collect_scheduler_pipeline_definition_ids(
    state: &SchedulerState,
    schedules: &[LoadedPipelineSchedule],
) -> Vec<i64> {
    let mut pipeline_definition_ids = BTreeSet::new();
    for queued in &state.queued_requests {
        pipeline_definition_ids.insert(queued.pipeline_definition_id);
    }
    for schedule in schedules {
        pipeline_definition_ids.insert(schedule.pipeline_definition_id);
    }

    pipeline_definition_ids.into_iter().collect()
}

fn schedule_slot_key(
    schedule: &LoadedPipelineSchedule,
    now: DateTime<Utc>,
) -> Result<Option<String>> {
    let timezone: Tz = schedule.timezone.parse()?;
    let local_now = now.with_timezone(&timezone);
    let slot = local_now
        .with_second(0)
        .and_then(|value| value.with_nanosecond(0))
        .ok_or_else(|| anyhow::anyhow!("failed to normalize scheduler tick time"))?;
    let parser = CronParser::builder().seconds(Seconds::Optional).build();
    let cron = parser.parse(&schedule.cron_expr)?;

    if cron.is_time_matching(&slot)? {
        return Ok(Some(slot.to_rfc3339()));
    }

    Ok(None)
}

fn calculate_next_trigger_at(schedule: &PipelineSchedule, now: DateTime<Utc>) -> Result<Option<String>> {
    if !schedule.enabled {
        return Ok(None);
    }

    let timezone: Tz = schedule.timezone.parse()?;
    let local_now = now.with_timezone(&timezone);
    let parser = CronParser::builder().seconds(Seconds::Optional).build();
    let cron = parser.parse(&schedule.cron_expr)?;
    let next = cron.find_next_occurrence(&local_now, false)?;

    Ok(Some(next.to_rfc3339()))
}

fn record_schedule_feedback(
    state: &mut SchedulerState,
    schedule_id: i64,
    decision: ScheduleDecision,
    decision_at: DateTime<Utc>,
    message_zh: impl Into<String>,
) {
    state.schedule_feedback.insert(
        schedule_id,
        ScheduleFeedback {
            last_decision: decision,
            last_decision_at: decision_at.to_rfc3339(),
            last_decision_message_zh: message_zh.into(),
        },
    );
}

fn build_pipeline_schedule_runtime_snapshots(
    state: &SchedulerState,
    schedules: &[PipelineSchedule],
    now: DateTime<Utc>,
) -> Result<Vec<PipelineScheduleRuntimeSnapshot>> {
    let mut snapshots = Vec::with_capacity(schedules.len());

    for schedule in schedules {
        let queued = state
            .queued_requests
            .iter()
            .any(|request| request.schedule_id == schedule.id);
        let feedback = state.schedule_feedback.get(&schedule.id);

        snapshots.push(PipelineScheduleRuntimeSnapshot {
            schedule_id: schedule.id,
            queued,
            last_decision: feedback
                .map(|entry| entry.last_decision.as_str().to_string())
                .unwrap_or_else(|| "idle".to_string()),
            last_decision_at: feedback.map(|entry| entry.last_decision_at.clone()),
            last_decision_message_zh: feedback.map(|entry| entry.last_decision_message_zh.clone()),
            next_trigger_at: calculate_next_trigger_at(schedule, now)?,
        });
    }

    Ok(snapshots)
}

async fn start_scheduled_run(request: &QueuedScheduleRequest, pool: &SqlitePool) -> Result<i64> {
    workflows::execute_scheduled_pipeline_run(
        pool,
        request.pipeline_definition_id,
        None,
        request.run_parameters.clone(),
    )
    .await
}

async fn drain_ready_queue(
    pool: &SqlitePool,
    state: &mut SchedulerState,
    summary: &mut SchedulerTickSummary,
    active_run_counts: &mut HashMap<i64, i64>,
    now: DateTime<Utc>,
) -> Result<()> {
    let queued_count = state.queued_requests.len();
    if queued_count == 0 {
        return Ok(());
    }

    for _ in 0..queued_count {
        let Some(request) = state.queued_requests.pop_front() else {
            break;
        };

        if active_run_count(active_run_counts, request.pipeline_definition_id) > 0 {
            state.queued_requests.push_back(request);
            continue;
        }

        if let Err(error) = start_scheduled_run(&request, pool).await {
            tracing::error!(
                schedule_id = request.schedule_id,
                pipeline_definition_id = request.pipeline_definition_id,
                error = %error,
                "[scheduler] failed to start queued schedule request"
            );
            continue;
        }

        summary.started_runs += 1;
        increment_active_run_count(active_run_counts, request.pipeline_definition_id);
        record_schedule_feedback(
            state,
            request.schedule_id,
            ScheduleDecision::Started,
            now,
            "排队中的调度已在活跃 run 结束后启动。",
        );
    }

    Ok(())
}

async fn run_scheduler_tick(
    pool: &SqlitePool,
    state: &mut SchedulerState,
    now: DateTime<Utc>,
) -> Result<SchedulerTickSummary> {
    let mut summary = SchedulerTickSummary::default();
    let schedules = load_enabled_pipeline_schedules(pool).await?;
    let scheduler_pipeline_definition_ids =
        collect_scheduler_pipeline_definition_ids(state, &schedules);
    let mut active_run_counts =
        db::load_active_pipeline_run_counts(pool, &scheduler_pipeline_definition_ids).await?;

    drain_ready_queue(pool, state, &mut summary, &mut active_run_counts, now).await?;

    for schedule in schedules {
        let Some(slot_key) = schedule_slot_key(&schedule, now)? else {
            continue;
        };

        if state.last_fired_slots.get(&schedule.schedule_id) == Some(&slot_key) {
            continue;
        }

        let active_runs = active_run_count(&active_run_counts, schedule.pipeline_definition_id);
        let request = QueuedScheduleRequest {
            schedule_id: schedule.schedule_id,
            pipeline_definition_id: schedule.pipeline_definition_id,
            run_parameters: schedule.run_parameters.clone(),
        };

        match schedule.policy.as_str() {
            "allow_parallel" => {
                start_scheduled_run(&request, pool).await?;
                summary.started_runs += 1;
                increment_active_run_count(&mut active_run_counts, request.pipeline_definition_id);
                record_schedule_feedback(
                    state,
                    request.schedule_id,
                    ScheduleDecision::Started,
                    now,
                    "调度已触发并启动新的 pipeline run。",
                );
            }
            "skip_if_running" => {
                if active_runs > 0 {
                    summary.skipped_runs += 1;
                    record_schedule_feedback(
                        state,
                        request.schedule_id,
                        ScheduleDecision::Skipped,
                        now,
                        "检测到同定义仍有活跃 run，已跳过本次触发。",
                    );
                } else {
                    start_scheduled_run(&request, pool).await?;
                    summary.started_runs += 1;
                    increment_active_run_count(&mut active_run_counts, request.pipeline_definition_id);
                    record_schedule_feedback(
                        state,
                        request.schedule_id,
                        ScheduleDecision::Started,
                        now,
                        "调度已触发并启动新的 pipeline run。",
                    );
                }
            }
            "queue_after_running" => {
                if active_runs > 0 {
                    let already_queued = state.queued_requests.iter().any(|queued| {
                        queued.schedule_id == request.schedule_id
                            && queued.pipeline_definition_id == request.pipeline_definition_id
                            && queued.run_parameters == request.run_parameters
                    });
                    if !already_queued {
                        state.queued_requests.push_back(request);
                        summary.queued_runs += 1;
                        record_schedule_feedback(
                            state,
                            schedule.schedule_id,
                            ScheduleDecision::Queued,
                            now,
                            "检测到同定义仍有活跃 run，本次触发已加入排队队列。",
                        );
                    }
                } else {
                    start_scheduled_run(&request, pool).await?;
                    summary.started_runs += 1;
                    increment_active_run_count(&mut active_run_counts, request.pipeline_definition_id);
                    record_schedule_feedback(
                        state,
                        request.schedule_id,
                        ScheduleDecision::Started,
                        now,
                        "调度已触发并启动新的 pipeline run。",
                    );
                }
            }
            policy => {
                tracing::warn!(
                    schedule_id = schedule.schedule_id,
                    policy = policy,
                    "[scheduler] unsupported schedule policy"
                );
            }
        }

        state
            .last_fired_slots
            .insert(schedule.schedule_id, slot_key);
    }

    Ok(summary)
}

impl PipelineSchedulerRuntime {
    pub(crate) async fn list_pipeline_schedule_runtime_snapshots(
        &self,
        pool: &SqlitePool,
        pipeline_definition_id: i64,
        now: DateTime<Utc>,
    ) -> Result<Vec<PipelineScheduleRuntimeSnapshot>> {
        let schedules = db::list_pipeline_schedules_for_definition(pool, pipeline_definition_id).await?;
        let state = self.state.lock().await;

        build_pipeline_schedule_runtime_snapshots(&state, &schedules, now)
    }
}

pub(crate) fn spawn_pipeline_scheduler(pool: SqlitePool, runtime: PipelineSchedulerRuntime) {
    tauri::async_runtime::spawn(async move {
        let mut interval = time::interval(SCHEDULER_TICK_INTERVAL);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            let now = Utc::now();
            let mut locked_state = runtime.state.lock().await;

            match run_scheduler_tick(&pool, &mut locked_state, now).await {
                Ok(summary)
                    if summary.started_runs > 0
                        || summary.queued_runs > 0
                        || summary.skipped_runs > 0 =>
                {
                    tracing::info!(
                        started_runs = summary.started_runs,
                        queued_runs = summary.queued_runs,
                        skipped_runs = summary.skipped_runs,
                        "[scheduler] processed due schedules"
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::error!(error = %error, "[scheduler] scheduler tick failed");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::git_executor::test_support::make_temp_test_dir;
    use crate::models::{PipelineNodeInput, PipelineScheduleInput};
    use chrono::TimeZone;

    async fn create_project_group_with_schedule(
        pool: &SqlitePool,
        schedule_policy: &str,
    ) -> (i64, i64) {
        let project_group =
            db::create_project_group(pool, format!("scheduler-group-{schedule_policy}"))
                .await
                .expect("create project group");
        let pipeline = db::create_pipeline_definition(
            pool,
            format!("scheduler-pipeline-{schedule_policy}"),
            "scheduler".to_string(),
            true,
            1,
            vec![],
            vec![PipelineNodeInput {
                node_type: "git_pull".to_string(),
                parameters: serde_json::json!({}),
            }],
            vec![PipelineScheduleInput {
                project_group_id: Some(project_group.id),
                cron_expr: "0 9 14 4 *".to_string(),
                timezone: "UTC".to_string(),
                branch: Some("main".to_string()),
                enabled: true,
                policy: schedule_policy.to_string(),
                variables: serde_json::json!({}),
            }],
        )
        .await
        .expect("create pipeline definition");

        (pipeline.id, project_group.id)
    }

    async fn count_schedule_runs(pool: &SqlitePool, pipeline_definition_id: i64) -> i64 {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*)
               FROM pipeline_runs
               WHERE pipeline_definition_id = ?1
                 AND trigger_kind = 'schedule'"#,
        )
        .bind(pipeline_definition_id)
        .fetch_one(pool)
        .await
        .expect("count scheduled pipeline runs")
    }

    async fn insert_schedule_row(
        pool: &SqlitePool,
        pipeline_definition_id: i64,
        schedule_order: i64,
        project_group_id: i64,
        policy: &str,
    ) {
        let now = "2026-04-14T08:59:00Z";
        sqlx::query(
            r#"INSERT INTO pipeline_schedules (
                 pipeline_definition_id, schedule_order, project_group_id, cron_expr, timezone, branch,
                 enabled, policy, variables_json, created_at, updated_at
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"#,
        )
        .bind(pipeline_definition_id)
        .bind(schedule_order)
        .bind(project_group_id)
        .bind("0 9 14 4 *")
        .bind("UTC")
        .bind(Some("main"))
        .bind(1_i64)
        .bind(policy)
        .bind("{}")
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .expect("insert pipeline schedule");
    }

    async fn seed_running_pipeline_run(
        pool: &SqlitePool,
        pipeline_definition_id: i64,
        project_group_id: i64,
    ) -> i64 {
        let now = "2026-04-14T09:00:00Z";
        sqlx::query(
            r#"INSERT INTO pipeline_runs (
                 pipeline_definition_id, project_group_id, legacy_workflow_run_id, source_pipeline_run_id,
                 trigger_kind, status, run_parameters_json, max_concurrency, started_at, finished_at, created_at, updated_at
               ) VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)"#,
        )
        .bind(pipeline_definition_id)
        .bind(project_group_id)
        .bind("schedule")
        .bind("running")
        .bind("{}")
        .bind(1_i64)
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .expect("seed running pipeline run")
        .last_insert_rowid()
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_due_schedule_starts_run_when_idle() {
        let pool = db::setup_test_pool().await;
        let (pipeline_definition_id, _project_group_id) =
            create_project_group_with_schedule(&pool, "skip_if_running").await;
        let mut state = SchedulerState::default();

        let summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                .single()
                .expect("construct scheduler tick time"),
        )
        .await
        .expect("run scheduler tick");

        assert_eq!(summary.started_runs, 1);
        assert_eq!(summary.queued_runs, 0);
        assert_eq!(summary.skipped_runs, 0);
        assert_eq!(count_schedule_runs(&pool, pipeline_definition_id).await, 1);
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_without_project_group_starts_switch_project_pipeline() {
        let pool = db::setup_test_pool().await;
        let repo_root = make_temp_test_dir("scheduler_switch_project_repo");
        std::fs::create_dir_all(&repo_root).expect("create repo root");

        let managed = db::create_managed_project(
            &pool,
            99001,
            "scheduler-switch-project".to_string(),
            "team/scheduler-switch-project".to_string(),
            repo_root.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "scheduler-switch-project-pipeline".to_string(),
            "scheduler switch project".to_string(),
            true,
            1,
            vec![],
            vec![PipelineNodeInput {
                node_type: "switch_project".to_string(),
                parameters: serde_json::json!({
                    "managedProjectId": managed.id.to_string()
                }),
            }],
            vec![PipelineScheduleInput {
                project_group_id: None,
                cron_expr: "0 9 14 4 *".to_string(),
                timezone: "UTC".to_string(),
                branch: None,
                enabled: true,
                policy: "skip_if_running".to_string(),
                variables: serde_json::json!({}),
            }],
        )
        .await
        .expect("create switch_project schedule pipeline");

        let mut state = SchedulerState::default();
        let summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                .single()
                .expect("construct scheduler tick time"),
        )
        .await
        .expect("run scheduler tick");

        assert_eq!(summary.started_runs, 1);
        assert_eq!(summary.queued_runs, 0);
        assert_eq!(summary.skipped_runs, 0);
        assert_eq!(count_schedule_runs(&pool, pipeline.id).await, 1);

        let run = db::list_pipeline_runs(&pool, crate::models::PipelineRunListQuery::default())
            .await
            .expect("list pipeline runs");
        let scheduled_run = run
            .items
            .into_iter()
            .find(|item| item.pipeline_definition_id == pipeline.id)
            .expect("find scheduled switch_project run");
        assert_eq!(scheduled_run.project_group_id, None);
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_ignores_legacy_project_group_metadata_when_starting_new_run() {
        let pool = db::setup_test_pool().await;
        let (pipeline_definition_id, _project_group_id) =
            create_project_group_with_schedule(&pool, "skip_if_running").await;
        let mut state = SchedulerState::default();

        let summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                .single()
                .expect("construct scheduler tick time"),
        )
        .await
        .expect("run scheduler tick");

        assert_eq!(summary.started_runs, 1);
        assert_eq!(summary.queued_runs, 0);
        assert_eq!(summary.skipped_runs, 0);

        let run = db::list_pipeline_runs(&pool, crate::models::PipelineRunListQuery::default())
            .await
            .expect("list pipeline runs");
        let scheduled_run = run
            .items
            .into_iter()
            .find(|item| item.pipeline_definition_id == pipeline_definition_id)
            .expect("find scheduled run");
        assert_eq!(scheduled_run.project_group_id, None);
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_skip_if_running_skips_active_pipeline() {
        let pool = db::setup_test_pool().await;
        let (pipeline_definition_id, project_group_id) =
            create_project_group_with_schedule(&pool, "skip_if_running").await;
        let mut state = SchedulerState::default();
        seed_running_pipeline_run(&pool, pipeline_definition_id, project_group_id).await;

        let summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                .single()
                .expect("construct scheduler tick time"),
        )
        .await
        .expect("run scheduler tick");

        assert_eq!(summary.started_runs, 0);
        assert_eq!(summary.queued_runs, 0);
        assert_eq!(summary.skipped_runs, 1);
        assert_eq!(count_schedule_runs(&pool, pipeline_definition_id).await, 1);
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_allow_parallel_starts_another_run_immediately() {
        let pool = db::setup_test_pool().await;
        let (pipeline_definition_id, project_group_id) =
            create_project_group_with_schedule(&pool, "allow_parallel").await;
        let mut state = SchedulerState::default();
        seed_running_pipeline_run(&pool, pipeline_definition_id, project_group_id).await;

        let summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                .single()
                .expect("construct scheduler tick time"),
        )
        .await
        .expect("run scheduler tick");

        assert_eq!(summary.started_runs, 1);
        assert_eq!(summary.queued_runs, 0);
        assert_eq!(summary.skipped_runs, 0);
        assert_eq!(count_schedule_runs(&pool, pipeline_definition_id).await, 2);
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_shared_definition_skip_if_running_starts_only_once() {
        let pool = db::setup_test_pool().await;
        let (pipeline_definition_id, project_group_id) =
            create_project_group_with_schedule(&pool, "skip_if_running").await;
        let mut state = SchedulerState::default();
        insert_schedule_row(
            &pool,
            pipeline_definition_id,
            1,
            project_group_id,
            "skip_if_running",
        )
        .await;

        let summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                .single()
                .expect("construct scheduler tick time"),
        )
        .await
        .expect("run scheduler tick");

        assert_eq!(summary.started_runs, 1);
        assert_eq!(summary.queued_runs, 0);
        assert_eq!(summary.skipped_runs, 1);
        assert_eq!(count_schedule_runs(&pool, pipeline_definition_id).await, 1);
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_does_not_refire_same_slot_twice() {
        let pool = db::setup_test_pool().await;
        let (pipeline_definition_id, _project_group_id) =
            create_project_group_with_schedule(&pool, "skip_if_running").await;
        let mut state = SchedulerState::default();

        let first_summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 5)
                .single()
                .expect("construct first scheduler tick time"),
        )
        .await
        .expect("run first scheduler tick");
        let second_summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 55)
                .single()
                .expect("construct second scheduler tick time"),
        )
        .await
        .expect("run second scheduler tick");

        assert_eq!(first_summary.started_runs, 1);
        assert_eq!(second_summary.started_runs, 0);
        assert_eq!(count_schedule_runs(&pool, pipeline_definition_id).await, 1);
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_does_not_backfill_missed_due_slot() {
        let pool = db::setup_test_pool().await;
        let (pipeline_definition_id, _project_group_id) =
            create_project_group_with_schedule(&pool, "skip_if_running").await;
        let mut state = SchedulerState::default();

        let summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 5, 0)
                .single()
                .expect("construct delayed scheduler tick time"),
        )
        .await
        .expect("run delayed scheduler tick");

        assert_eq!(summary.started_runs, 0);
        assert_eq!(summary.queued_runs, 0);
        assert_eq!(summary.skipped_runs, 0);
        assert_eq!(count_schedule_runs(&pool, pipeline_definition_id).await, 0);
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_queue_after_running_starts_after_active_run_completes() {
        let pool = db::setup_test_pool().await;
        let (pipeline_definition_id, project_group_id) =
            create_project_group_with_schedule(&pool, "queue_after_running").await;
        let mut state = SchedulerState::default();
        let active_run_id =
            seed_running_pipeline_run(&pool, pipeline_definition_id, project_group_id).await;

        let first_summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                .single()
                .expect("construct first scheduler tick time"),
        )
        .await
        .expect("run first scheduler tick");

        assert_eq!(first_summary.started_runs, 0);
        assert_eq!(first_summary.queued_runs, 1);
        assert_eq!(first_summary.skipped_runs, 0);
        assert_eq!(state.queued_requests.len(), 1);
        assert_eq!(count_schedule_runs(&pool, pipeline_definition_id).await, 1);

        sqlx::query(
            r#"UPDATE pipeline_runs
               SET status = 'completed',
                   finished_at = ?1,
                   updated_at = ?1
               WHERE id = ?2"#,
        )
        .bind("2026-04-14T09:01:00Z")
        .bind(active_run_id)
        .execute(&pool)
        .await
        .expect("complete seeded run");

        let second_summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 1, 0)
                .single()
                .expect("construct second scheduler tick time"),
        )
        .await
        .expect("run second scheduler tick");

        assert_eq!(second_summary.started_runs, 1);
        assert_eq!(second_summary.queued_runs, 0);
        assert_eq!(second_summary.skipped_runs, 0);
        assert!(state.queued_requests.is_empty());
        assert_eq!(count_schedule_runs(&pool, pipeline_definition_id).await, 2);
    }

    #[tokio::test]
    async fn pipeline_schedule_runtime_queue_identity_ignores_legacy_project_group_metadata() {
        let pool = db::setup_test_pool().await;
        let (pipeline_definition_id, project_group_id) =
            create_project_group_with_schedule(&pool, "queue_after_running").await;
        let mut state = SchedulerState::default();
        seed_running_pipeline_run(&pool, pipeline_definition_id, project_group_id).await;

        sqlx::query(
            r#"UPDATE pipeline_schedules
               SET cron_expr = ?1
               WHERE pipeline_definition_id = ?2"#,
        )
        .bind("* * * * *")
        .bind(pipeline_definition_id)
        .execute(&pool)
        .await
        .expect("make queue_after_running schedule fire every minute");

        let first_summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                .single()
                .expect("construct first scheduler tick time"),
        )
        .await
        .expect("run first scheduler tick");

        assert_eq!(first_summary.started_runs, 0);
        assert_eq!(first_summary.queued_runs, 1);
        assert_eq!(state.queued_requests.len(), 1);

        sqlx::query(
            r#"UPDATE pipeline_schedules
               SET project_group_id = NULL
               WHERE pipeline_definition_id = ?1"#,
        )
        .bind(pipeline_definition_id)
        .execute(&pool)
        .await
        .expect("drop legacy project_group_id metadata");

        let second_summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 1, 30)
                .single()
                .expect("construct second scheduler tick time"),
        )
        .await
        .expect("run second scheduler tick");

        assert_eq!(second_summary.started_runs, 0);
        assert_eq!(second_summary.queued_runs, 0);
        assert_eq!(second_summary.skipped_runs, 0);
        assert_eq!(state.queued_requests.len(), 1);
    }

    #[tokio::test]
    async fn schedule_runtime_feedback_reports_next_trigger_before_due_time() {
        let pool = db::setup_test_pool().await;
        let runtime = PipelineSchedulerRuntime::default();
        let (pipeline_definition_id, _project_group_id) =
            create_project_group_with_schedule(&pool, "skip_if_running").await;

        let snapshots = runtime
            .list_pipeline_schedule_runtime_snapshots(
                &pool,
                pipeline_definition_id,
                Utc.with_ymd_and_hms(2026, 4, 14, 8, 30, 0)
                    .single()
                    .expect("construct snapshot time"),
            )
            .await
            .expect("list schedule runtime snapshots");

        assert_eq!(snapshots.len(), 1);
        assert!(!snapshots[0].queued);
        assert_eq!(snapshots[0].last_decision, "idle");
        assert_eq!(
            snapshots[0].next_trigger_at.as_deref(),
            Some("2026-04-14T09:00:00+00:00")
        );
    }

    #[tokio::test]
    async fn schedule_runtime_feedback_reports_queued_decision() {
        let pool = db::setup_test_pool().await;
        let runtime = PipelineSchedulerRuntime::default();
        let (pipeline_definition_id, project_group_id) =
            create_project_group_with_schedule(&pool, "queue_after_running").await;
        let active_run_id =
            seed_running_pipeline_run(&pool, pipeline_definition_id, project_group_id).await;

        {
            let mut state = runtime.state.lock().await;
            let summary = run_scheduler_tick(
                &pool,
                &mut state,
                Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                    .single()
                    .expect("construct scheduler tick time"),
            )
            .await
            .expect("run scheduler tick");
            assert_eq!(summary.queued_runs, 1);
        }

        let snapshots = runtime
            .list_pipeline_schedule_runtime_snapshots(
                &pool,
                pipeline_definition_id,
                Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                    .single()
                    .expect("construct snapshot time"),
            )
            .await
            .expect("list schedule runtime snapshots");

        assert_eq!(snapshots.len(), 1);
        assert!(snapshots[0].queued);
        assert_eq!(snapshots[0].last_decision, "queued");
        assert!(
            snapshots[0]
                .last_decision_message_zh
                .as_deref()
                .unwrap_or_default()
                .contains("排队")
        );

        sqlx::query(
            r#"UPDATE pipeline_runs
               SET status = 'completed',
                   finished_at = ?1,
                   updated_at = ?1
               WHERE id = ?2"#,
        )
        .bind("2026-04-14T09:01:00Z")
        .bind(active_run_id)
        .execute(&pool)
        .await
        .expect("complete seeded run");
    }

    #[tokio::test]
    async fn schedule_runtime_feedback_reports_skipped_decision() {
        let pool = db::setup_test_pool().await;
        let runtime = PipelineSchedulerRuntime::default();
        let (pipeline_definition_id, project_group_id) =
            create_project_group_with_schedule(&pool, "skip_if_running").await;
        let mut state = runtime.state.lock().await;
        seed_running_pipeline_run(&pool, pipeline_definition_id, project_group_id).await;

        let summary = run_scheduler_tick(
            &pool,
            &mut state,
            Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                .single()
                .expect("construct scheduler tick time"),
        )
        .await
        .expect("run scheduler tick");
        assert_eq!(summary.skipped_runs, 1);
        drop(state);

        let snapshots = runtime
            .list_pipeline_schedule_runtime_snapshots(
                &pool,
                pipeline_definition_id,
                Utc.with_ymd_and_hms(2026, 4, 14, 9, 0, 30)
                    .single()
                    .expect("construct snapshot time"),
            )
            .await
            .expect("list schedule runtime snapshots");

        assert_eq!(snapshots.len(), 1);
        assert!(!snapshots[0].queued);
        assert_eq!(snapshots[0].last_decision, "skipped");
        assert!(
            snapshots[0]
                .last_decision_message_zh
                .as_deref()
                .unwrap_or_default()
                .contains("跳过")
        );
    }
}
