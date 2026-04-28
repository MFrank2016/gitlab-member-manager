use crate::db::{self, PipelineExecutionDefinition, PipelineExecutionNodeDef};
use crate::failure_envelope::{build_failure_envelope, FailureEnvelope};
use crate::git_executor::{
    self, build_execution_step_operation, execute_git_command, run_execution_step_prechecks,
    LocalExecutionContext, StepOperation,
};
use crate::gitlab::{self, GitLabConfig};
use crate::gitlab_executor::{self, WaitMetadata};
use crate::models::{ManagedProject, PipelineRunRetryRequest, PipelineVariable};
use crate::runtime_support::{
    derive_run_final_status, get_repo_lease, normalize_run_parameters, now_rfc3339,
    render_value, ProjectExecutionStep, ProjectOutcome,
};
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration as StdDuration, Instant};
use tokio::task::JoinSet;

const DEFAULT_PIPELINE_WAIT_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_PIPELINE_WAIT_POLL_INTERVAL_MS: u64 = 1_000;

#[derive(Debug, Clone)]
struct RenderedPipelineNodeDefinition {
    pipeline_node_id: i64,
    node_order: i64,
    node_type: String,
    rendered_parameters: Value,
}

#[derive(Debug, Clone)]
struct PipelineProjectExecutionNode {
    run_node_id: i64,
    node_type: String,
    rendered_parameters: Value,
}

#[derive(Debug, Clone)]
struct PipelineProjectExecutionPlan {
    run_project_id: i64,
    project: Option<ManagedProject>,
    nodes: Vec<PipelineProjectExecutionNode>,
}

#[derive(Debug, Clone)]
struct PipelineSegmentSeed {
    project: Option<ManagedProject>,
    nodes: Vec<RenderedPipelineNodeDefinition>,
}

#[derive(Debug)]
struct PipelineRetrySourceRun {
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    run_parameters: Value,
}

#[derive(Debug, Clone)]
struct PipelineExecutionContextState {
    managed_project_id: Option<i64>,
    project: Option<ManagedProject>,
    working_dir: Option<PathBuf>,
}

impl PipelineExecutionContextState {
    fn from_project(project: &ManagedProject) -> Self {
        Self {
            managed_project_id: Some(project.id),
            project: Some(project.clone()),
            working_dir: Some(PathBuf::from(&project.repo_path)),
        }
    }

    fn empty() -> Self {
        Self {
            managed_project_id: None,
            project: None,
            working_dir: None,
        }
    }

    fn project_ref(&self) -> Option<&ManagedProject> {
        self.project.as_ref()
    }

    fn working_dir(&self) -> Option<&Path> {
        self.working_dir.as_deref()
    }

    fn working_dir_display(&self) -> Option<String> {
        self.working_dir
            .as_ref()
            .map(|path| path.display().to_string())
    }
}

#[derive(Debug, Clone)]
struct RenderedPipelineStageDefinition {
    pipeline_stage_id: i64,
    stage_key: String,
    name: String,
    stage_order: i64,
}

#[derive(Debug, Clone)]
struct RenderedPipelineGraphNodeDefinition {
    pipeline_node_id: i64,
    node_order: i64,
    node_key: String,
    stage_key: String,
    stage_order: i64,
    stage_name: String,
    node_type: String,
    rendered_parameters: Value,
    enabled: bool,
    predecessors: Vec<String>,
    successors: Vec<String>,
}

#[derive(Debug, Clone)]
struct SeededPipelineRunStage {
    run_stage_id: i64,
    pipeline_stage_id: i64,
    stage_key: String,
    stage_name: String,
    stage_order: i64,
}

#[derive(Debug, Clone)]
struct PipelineGraphExecutionNode {
    run_node_id: i64,
    run_stage_id: i64,
    pipeline_node_id: i64,
    node_order: i64,
    node_key: String,
    stage_key: String,
    stage_order: i64,
    stage_name: String,
    node_type: String,
    rendered_parameters: Value,
    enabled: bool,
    predecessors: Vec<String>,
    successors: Vec<String>,
}

#[derive(Debug, Clone)]
struct PipelineGraphExecutionPlan {
    run_project_id: i64,
    project: Option<ManagedProject>,
    nodes_by_key: HashMap<String, PipelineGraphExecutionNode>,
    stage_node_keys: BTreeMap<i64, Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GraphNodeFailureKind {
    Failed,
    FailedPrecheck,
    Cancelled,
}

#[derive(Debug, Clone)]
enum GraphNodeExecutionOutcome {
    Success {
        context: PipelineExecutionContextState,
    },
    Failed {
        kind: GraphNodeFailureKind,
    },
}

fn read_optional_u64_param(parameters: &Value, key: &str) -> Result<Option<u64>> {
    let value = match parameters.get(key) {
        None | Some(Value::Null) => return Ok(None),
        Some(value) => value,
    };

    match value {
        Value::Number(number) => number
            .as_u64()
            .map(Some)
            .ok_or_else(|| anyhow!("step parameter '{key}' must be a positive integer")),
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            let parsed = trimmed
                .parse::<u64>()
                .map_err(|_| anyhow!("step parameter '{key}' must be a positive integer"))?;
            Ok(Some(parsed))
        }
        _ => Err(anyhow!("step parameter '{key}' must be a positive integer")),
    }
}

fn normalize_pipeline_run_parameters(
    variables: &[PipelineVariable],
    run_parameters: Value,
) -> Result<Value> {
    let mut normalized = normalize_run_parameters(run_parameters)?;
    let variable_map = normalized
        .as_object_mut()
        .ok_or_else(|| anyhow!("run_parameters must be a JSON object"))?;

    for variable in variables {
        let missing = match variable_map.get(&variable.key) {
            None => true,
            Some(Value::Null) => true,
            _ => false,
        };
        if !missing {
            continue;
        }

        if let Some(default_value) = &variable.default_value {
            variable_map.insert(variable.key.clone(), Value::String(default_value.clone()));
            continue;
        }

        if variable.required {
            return Err(anyhow!(
                "missing required pipeline variable: {}",
                variable.key
            ));
        }
    }

    Ok(normalized)
}

fn render_pipeline_nodes_for_run(
    node_defs: &[PipelineExecutionNodeDef],
    run_parameters: &Value,
) -> Result<Vec<RenderedPipelineNodeDefinition>> {
    let variable_map = run_parameters
        .as_object()
        .ok_or_else(|| anyhow!("run_parameters must be a JSON object"))?;
    let mut rendered_nodes = Vec::with_capacity(node_defs.len());
    for node in node_defs {
        rendered_nodes.push(RenderedPipelineNodeDefinition {
            pipeline_node_id: node.id,
            node_order: node.node_order,
            node_type: node.node_type.clone(),
            rendered_parameters: render_value(&node.parameters, variable_map)?,
        });
    }
    Ok(rendered_nodes)
}

fn render_pipeline_graph_for_run(
    pipeline: &PipelineExecutionDefinition,
    run_parameters: &Value,
) -> Result<(
    Vec<RenderedPipelineStageDefinition>,
    Vec<RenderedPipelineGraphNodeDefinition>,
)> {
    let variable_map = run_parameters
        .as_object()
        .ok_or_else(|| anyhow!("run_parameters must be a JSON object"))?;

    if pipeline.stages.is_empty() {
        return Err(anyhow!("stage-aware pipeline definition has no stages"));
    }

    let mut stages = Vec::new();
    let mut stage_order_by_key = HashMap::<String, i64>::new();
    let mut stage_name_by_key = HashMap::<String, String>::new();
    let mut enabled_stage_keys = HashSet::<String>::new();
    for stage in &pipeline.stages {
        if !stage.enabled {
            continue;
        }
        stage_order_by_key.insert(stage.stage_key.clone(), stage.stage_order);
        stage_name_by_key.insert(stage.stage_key.clone(), stage.name.clone());
        enabled_stage_keys.insert(stage.stage_key.clone());
        stages.push(RenderedPipelineStageDefinition {
            pipeline_stage_id: stage.id,
            stage_key: stage.stage_key.clone(),
            name: stage.name.clone(),
            stage_order: stage.stage_order,
        });
    }

    let mut predecessors_by_key = HashMap::<String, Vec<String>>::new();
    let mut successors_by_key = HashMap::<String, Vec<String>>::new();
    for edge in &pipeline.edges {
        predecessors_by_key
            .entry(edge.target_node_key.clone())
            .or_default()
            .push(edge.source_node_key.clone());
        successors_by_key
            .entry(edge.source_node_key.clone())
            .or_default()
            .push(edge.target_node_key.clone());
    }

    let mut rendered_nodes = Vec::new();
    for node in &pipeline.nodes {
        if !node.enabled {
            continue;
        }
        let Some(stage_key) = node.stage_key.clone() else {
            return Err(anyhow!(
                "stage-aware pipeline node missing stage_key for execution: {}",
                node.node_type
            ));
        };
        if !enabled_stage_keys.contains(&stage_key) {
            continue;
        }
        let Some(node_key) = node.node_key.clone() else {
            return Err(anyhow!(
                "stage-aware pipeline node missing node_key for execution: {}",
                node.node_type
            ));
        };
        let stage_order = *stage_order_by_key
            .get(&stage_key)
            .ok_or_else(|| anyhow!("pipeline node stage key not found during execution: {stage_key}"))?;
        let stage_name = stage_name_by_key
            .get(&stage_key)
            .cloned()
            .ok_or_else(|| anyhow!("pipeline node stage name not found during execution: {stage_key}"))?;
        rendered_nodes.push(RenderedPipelineGraphNodeDefinition {
            pipeline_node_id: node.id,
            node_order: node.node_order,
            node_key: node_key.clone(),
            stage_key: stage_key.clone(),
            stage_order,
            stage_name,
            node_type: node.node_type.clone(),
            rendered_parameters: render_value(&node.parameters, variable_map)?,
            enabled: true,
            predecessors: predecessors_by_key.remove(&node_key).unwrap_or_default(),
            successors: successors_by_key.remove(&node_key).unwrap_or_default(),
        });
    }

    rendered_nodes.sort_by_key(|node| (node.stage_order, node.node_order));
    stages.sort_by_key(|stage| stage.stage_order);

    Ok((stages, rendered_nodes))
}

fn node_requires_working_dir(node_type: &str) -> bool {
    matches!(
        node_type,
        "checkout_branch"
            | "git_pull"
            | "git_merge"
            | "git_push"
    )
}

fn read_switch_project_id(parameters: &Value) -> Result<i64> {
    match parameters.get("managedProjectId") {
        Some(Value::String(raw)) => raw
            .trim()
            .parse::<i64>()
            .map_err(|_| anyhow!("managedProjectId must be a positive integer")),
        Some(Value::Number(value)) => value
            .as_i64()
            .filter(|id| *id > 0)
            .ok_or_else(|| anyhow!("managedProjectId must be a positive integer")),
        _ => Err(anyhow!("managedProjectId is required")),
    }
}

async fn load_enabled_managed_project(pool: &SqlitePool, managed_project_id: i64) -> Result<ManagedProject> {
    let project = db::list_managed_projects(pool)
        .await?
        .into_iter()
        .find(|item| item.id == managed_project_id)
        .ok_or_else(|| anyhow!("managed project not found: {managed_project_id}"))?;

    if !project.enabled {
        return Err(anyhow!("managed project is disabled: {managed_project_id}"));
    }

    Ok(project)
}

async fn build_pipeline_segment_seeds(
    pool: &SqlitePool,
    rendered_nodes: &[RenderedPipelineNodeDefinition],
) -> Result<Vec<PipelineSegmentSeed>> {
    let mut segments = Vec::<PipelineSegmentSeed>::new();
    let mut current_project: Option<ManagedProject> = None;
    let mut current_nodes = Vec::<RenderedPipelineNodeDefinition>::new();

    for node in rendered_nodes {
        if node.node_type == "switch_project" {
            if !current_nodes.is_empty() {
                segments.push(PipelineSegmentSeed {
                    project: current_project.take(),
                    nodes: std::mem::take(&mut current_nodes),
                });
            }

            let managed_project_id = read_switch_project_id(&node.rendered_parameters)?;
            current_project = Some(load_enabled_managed_project(pool, managed_project_id).await?);
        }

        current_nodes.push(node.clone());
    }

    if !current_nodes.is_empty() {
        segments.push(PipelineSegmentSeed {
            project: current_project,
            nodes: current_nodes,
        });
    }

    Ok(segments)
}

fn classify_precheck_failure(error: &str) -> FailureEnvelope {
    if error.contains("working path does not exist")
        || error.contains("repository path does not exist")
    {
        return build_failure_envelope(
            "git.working_path_missing",
            "执行路径不存在",
            "设置的执行路径不存在，无法继续执行当前节点。".to_string(),
            "请检查路径变量和目录是否正确后重试。",
            error.to_string(),
        );
    }
    if error.contains("working path is not a directory")
        || error.contains("repository path is not a directory")
    {
        return build_failure_envelope(
            "git.working_path_not_directory",
            "执行路径不是目录",
            "设置的执行路径不是目录，无法继续执行当前节点。".to_string(),
            "请检查路径配置，确保它指向一个存在的目录后重试。",
            error.to_string(),
        );
    }
    if error.contains("current working path is not available for relative resolution") {
        return build_failure_envelope(
            "git.relative_working_path_resolution_failed",
            "无法解析相对路径",
            "当前执行路径不可用，无法基于上一个上下文解析相对路径。".to_string(),
            "请先切换到有效目录，或直接改用绝对路径后重试。",
            error.to_string(),
        );
    }
    if error.contains("working directory is required for this step")
        || error.contains("execution context is missing working directory")
    {
        return build_failure_envelope(
            "git.working_directory_missing",
            "未设置执行路径",
            "当前节点依赖本地执行路径，但运行上下文中还没有可用的执行目录。".to_string(),
            "请先添加“设置执行路径”节点，或先切换到带仓库路径的项目后再重试。",
            error.to_string(),
        );
    }
    if error.contains("repository worktree is not clean") {
        return build_failure_envelope(
            "git.worktree_dirty",
            "仓库工作区不干净",
            "仓库存在未提交变更，无法安全执行节点。".to_string(),
            "请先提交、暂存或清理工作区后重试。",
            error.to_string(),
        );
    }
    if error.contains("repository path does not exist") {
        return build_failure_envelope(
            "git.repo_path_missing",
            "仓库目录不存在",
            "仓库目录不存在，无法执行当前节点。".to_string(),
            "请检查项目仓库路径配置后重试。",
            error.to_string(),
        );
    }
    if error.contains("path is not a git worktree") {
        return build_failure_envelope(
            "git.not_worktree",
            "仓库目录不是 Git 工作区",
            "当前目录不是有效的 Git 工作区，无法执行当前节点。".to_string(),
            "请检查仓库路径并确认已正确初始化 Git 仓库后重试。",
            error.to_string(),
        );
    }
    if error.contains("branch '") && error.contains("not found") {
        return build_failure_envelope(
            "git.branch_missing",
            "目标分支不存在",
            "节点依赖的目标分支不存在，无法继续执行。".to_string(),
            "请确认分支名称和远端配置正确后重试。",
            error.to_string(),
        );
    }
    if error.contains("git remote '") {
        return build_failure_envelope(
            "git.remote_missing",
            "Git 远端不存在",
            "节点依赖的 Git 远端不存在，无法继续执行。".to_string(),
            "请检查项目默认远端配置后重试。",
            error.to_string(),
        );
    }

    build_failure_envelope(
        "pipeline.node_precheck_failed",
        "节点预检查失败",
        format!("节点执行前检查失败：{error}"),
        "请根据技术证据修复问题后重试。",
        error.to_string(),
    )
}

fn classify_invalid_execution_parameters(error: &str) -> FailureEnvelope {
    build_failure_envelope(
        "pipeline.invalid_node_parameters",
        "节点参数无效",
        format!("节点参数无效：{error}"),
        "请检查节点配置和变量模板后重试。",
        error.to_string(),
    )
}

async fn load_runtime_gitlab_config(pool: &SqlitePool) -> Result<Option<GitLabConfig>> {
    Ok(db::get_gitlab_config(pool).await?.map(|cfg| GitLabConfig {
        base_url: cfg.base_url,
        token: cfg.token,
    }))
}

async fn insert_pipeline_run_row(
    tx: &mut Transaction<'_, Sqlite>,
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    source_pipeline_run_id: Option<i64>,
    trigger_kind: &str,
    run_parameters: &Value,
    max_concurrency: i64,
) -> Result<i64> {
    let now = now_rfc3339();
    let run_parameters_json =
        serde_json::to_string(run_parameters).context("serialize pipeline run parameters")?;
    let result = sqlx::query(
        r#"INSERT INTO pipeline_runs (
         pipeline_definition_id, project_group_id, legacy_workflow_run_id, source_pipeline_run_id,
         trigger_kind, status, run_parameters_json, max_concurrency, started_at, finished_at, created_at, updated_at
       ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)"#,
    )
    .bind(pipeline_definition_id)
    .bind(project_group_id)
    .bind(source_pipeline_run_id)
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

async fn insert_pipeline_run_project_row(
    tx: &mut Transaction<'_, Sqlite>,
    pipeline_run_id: i64,
    project: Option<&ManagedProject>,
) -> Result<i64> {
    let now = now_rfc3339();
    let (managed_project_id, gitlab_project_id, project_name, project_path_with_namespace, repo_path) =
        match project {
            Some(project) => (
                Some(project.id),
                i64::try_from(project.gitlab_project_id).map_err(|_| {
                    anyhow!(
                        "gitlab_project_id out of range: {}",
                        project.gitlab_project_id
                    )
                })?,
                project.name.clone(),
                project.path_with_namespace.clone(),
                project.repo_path.clone(),
            ),
            None => (
                None,
                0,
                "未选择项目".to_string(),
                "__unselected_project__".to_string(),
                "__unselected_project__".to_string(),
            ),
        };
    let result = sqlx::query(
        r#"INSERT INTO pipeline_run_projects (
         pipeline_run_id, managed_project_id, gitlab_project_id, project_name, project_path_with_namespace, repo_path,
         status, summary_message, started_at, finished_at, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', NULL, NULL, ?8, ?9)"#,
    )
    .bind(pipeline_run_id)
    .bind(managed_project_id)
    .bind(gitlab_project_id)
    .bind(&project_name)
    .bind(&project_path_with_namespace)
    .bind(&repo_path)
    .bind("queued")
    .bind(&now)
    .bind(&now)
    .execute(&mut **tx)
    .await?;

    Ok(result.last_insert_rowid())
}

async fn insert_pipeline_run_stage_rows(
    tx: &mut Transaction<'_, Sqlite>,
    pipeline_run_id: i64,
    stages: &[RenderedPipelineStageDefinition],
) -> Result<HashMap<String, SeededPipelineRunStage>> {
    let now = now_rfc3339();
    let mut seeded = HashMap::with_capacity(stages.len());
    for stage in stages {
        let result = sqlx::query(
            r#"INSERT INTO pipeline_run_stages (
                 pipeline_run_id, pipeline_stage_id, stage_order, stage_key, stage_name_snapshot,
                 status, summary_message, started_at, finished_at, created_at, updated_at
               ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', '', NULL, NULL, ?6, ?7)"#,
        )
        .bind(pipeline_run_id)
        .bind(stage.pipeline_stage_id)
        .bind(stage.stage_order)
        .bind(&stage.stage_key)
        .bind(&stage.name)
        .bind(&now)
        .bind(&now)
        .execute(&mut **tx)
        .await?;

        seeded.insert(
            stage.stage_key.clone(),
            SeededPipelineRunStage {
                run_stage_id: result.last_insert_rowid(),
                pipeline_stage_id: stage.pipeline_stage_id,
                stage_key: stage.stage_key.clone(),
                stage_name: stage.name.clone(),
                stage_order: stage.stage_order,
            },
        );
    }
    Ok(seeded)
}

async fn insert_pipeline_run_node_row(
    tx: &mut Transaction<'_, Sqlite>,
    pipeline_run_project_id: i64,
    rendered_node: &RenderedPipelineNodeDefinition,
) -> Result<i64> {
    let now = now_rfc3339();
    let rendered_parameters_json = serde_json::to_string(&rendered_node.rendered_parameters)
        .context("serialize rendered node parameters")?;
    let result = sqlx::query(
        r#"INSERT INTO pipeline_run_nodes (
         pipeline_run_project_id, pipeline_node_id, node_order, node_type, rendered_parameters_json,
         status, started_at, finished_at, stdout, stderr, exit_code, summary_message,
         error_code, title_zh, detail_zh, suggestion_zh, evidence, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, '', '', NULL, '', NULL, NULL, NULL, NULL, NULL, ?7, ?8)"#,
    )
    .bind(pipeline_run_project_id)
    .bind(rendered_node.pipeline_node_id)
    .bind(rendered_node.node_order)
    .bind(&rendered_node.node_type)
    .bind(rendered_parameters_json)
    .bind("pending")
    .bind(&now)
    .bind(&now)
    .execute(&mut **tx)
    .await?;

    Ok(result.last_insert_rowid())
}

async fn insert_pipeline_graph_run_node_row(
    tx: &mut Transaction<'_, Sqlite>,
    pipeline_run_project_id: i64,
    rendered_node: &RenderedPipelineGraphNodeDefinition,
) -> Result<i64> {
    let now = now_rfc3339();
    let rendered_parameters_json = serde_json::to_string(&rendered_node.rendered_parameters)
        .context("serialize rendered graph node parameters")?;
    let result = sqlx::query(
        r#"INSERT INTO pipeline_run_nodes (
             pipeline_run_project_id, pipeline_node_id, node_order, node_type, rendered_parameters_json,
             status, started_at, finished_at, stdout, stderr, exit_code, summary_message,
             error_code, title_zh, detail_zh, suggestion_zh, evidence, created_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, '', '', NULL, '', NULL, NULL, NULL, NULL, NULL, ?7, ?8)"#,
    )
    .bind(pipeline_run_project_id)
    .bind(rendered_node.pipeline_node_id)
    .bind(rendered_node.node_order)
    .bind(&rendered_node.node_type)
    .bind(rendered_parameters_json)
    .bind("pending")
    .bind(&now)
    .bind(&now)
    .execute(&mut **tx)
    .await?;

    Ok(result.last_insert_rowid())
}

async fn seed_pipeline_run_and_children(
    pool: &SqlitePool,
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    source_pipeline_run_id: Option<i64>,
    trigger_kind: &str,
    run_parameters: &Value,
    max_concurrency: i64,
    projects: Vec<ManagedProject>,
    rendered_nodes: &[RenderedPipelineNodeDefinition],
) -> Result<(i64, Vec<PipelineProjectExecutionPlan>)> {
    let mut tx = pool.begin().await?;
    let pipeline_run_id = insert_pipeline_run_row(
        &mut tx,
        pipeline_definition_id,
        project_group_id,
        source_pipeline_run_id,
        trigger_kind,
        run_parameters,
        max_concurrency,
    )
    .await?;

    let mut plans = Vec::with_capacity(projects.len());
    for project in projects {
        let run_project_id =
            insert_pipeline_run_project_row(&mut tx, pipeline_run_id, Some(&project)).await?;
        let mut project_nodes = Vec::with_capacity(rendered_nodes.len());
        for rendered_node in rendered_nodes {
            let run_node_id =
                insert_pipeline_run_node_row(&mut tx, run_project_id, rendered_node).await?;
            project_nodes.push(PipelineProjectExecutionNode {
                run_node_id,
                node_type: rendered_node.node_type.clone(),
                rendered_parameters: rendered_node.rendered_parameters.clone(),
            });
        }
        plans.push(PipelineProjectExecutionPlan {
            run_project_id,
            project: Some(project),
            nodes: project_nodes,
        });
    }

    tx.commit().await?;
    Ok((pipeline_run_id, plans))
}

async fn seed_pipeline_run_for_segments(
    pool: &SqlitePool,
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    source_pipeline_run_id: Option<i64>,
    trigger_kind: &str,
    run_parameters: &Value,
    max_concurrency: i64,
    segments: Vec<PipelineSegmentSeed>,
) -> Result<(i64, Vec<PipelineProjectExecutionPlan>)> {
    let mut tx = pool.begin().await?;
    let pipeline_run_id = insert_pipeline_run_row(
        &mut tx,
        pipeline_definition_id,
        project_group_id,
        source_pipeline_run_id,
        trigger_kind,
        run_parameters,
        max_concurrency,
    )
    .await?;

    let mut plans = Vec::with_capacity(segments.len());
    for segment in segments {
        let run_project_id =
            insert_pipeline_run_project_row(&mut tx, pipeline_run_id, segment.project.as_ref())
                .await?;
        let mut project_nodes = Vec::with_capacity(segment.nodes.len());
        for rendered_node in &segment.nodes {
            let run_node_id =
                insert_pipeline_run_node_row(&mut tx, run_project_id, rendered_node).await?;
            project_nodes.push(PipelineProjectExecutionNode {
                run_node_id,
                node_type: rendered_node.node_type.clone(),
                rendered_parameters: rendered_node.rendered_parameters.clone(),
            });
        }
        plans.push(PipelineProjectExecutionPlan {
            run_project_id,
            project: segment.project,
            nodes: project_nodes,
        });
    }

    tx.commit().await?;
    Ok((pipeline_run_id, plans))
}

#[allow(clippy::too_many_arguments)]
async fn seed_pipeline_graph_run(
    pool: &SqlitePool,
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    source_pipeline_run_id: Option<i64>,
    trigger_kind: &str,
    run_parameters: &Value,
    max_concurrency: i64,
    stages: &[RenderedPipelineStageDefinition],
    rendered_nodes: &[RenderedPipelineGraphNodeDefinition],
    projects: Vec<Option<ManagedProject>>,
) -> Result<(
    i64,
    Vec<SeededPipelineRunStage>,
    Vec<PipelineGraphExecutionPlan>,
)> {
    let mut tx = pool.begin().await?;
    let pipeline_run_id = insert_pipeline_run_row(
        &mut tx,
        pipeline_definition_id,
        project_group_id,
        source_pipeline_run_id,
        trigger_kind,
        run_parameters,
        max_concurrency,
    )
    .await?;
    let seeded_stage_map = insert_pipeline_run_stage_rows(&mut tx, pipeline_run_id, stages).await?;

    let mut seeded_stages = seeded_stage_map.values().cloned().collect::<Vec<_>>();
    seeded_stages.sort_by_key(|stage| stage.stage_order);

    let mut plans = Vec::with_capacity(projects.len());
    for project in projects {
        let run_project_id =
            insert_pipeline_run_project_row(&mut tx, pipeline_run_id, project.as_ref()).await?;
        let mut nodes_by_key = HashMap::with_capacity(rendered_nodes.len());
        let mut stage_node_keys = BTreeMap::<i64, Vec<String>>::new();
        for rendered_node in rendered_nodes {
            let run_node_id =
                insert_pipeline_graph_run_node_row(&mut tx, run_project_id, rendered_node).await?;
            nodes_by_key.insert(
                rendered_node.node_key.clone(),
                PipelineGraphExecutionNode {
                    run_node_id,
                    run_stage_id: seeded_stage_map
                        .get(&rendered_node.stage_key)
                        .expect("seeded stage present for node")
                        .run_stage_id,
                    pipeline_node_id: rendered_node.pipeline_node_id,
                    node_order: rendered_node.node_order,
                    node_key: rendered_node.node_key.clone(),
                    stage_key: rendered_node.stage_key.clone(),
                    stage_order: rendered_node.stage_order,
                    stage_name: rendered_node.stage_name.clone(),
                    node_type: rendered_node.node_type.clone(),
                    rendered_parameters: rendered_node.rendered_parameters.clone(),
                    enabled: rendered_node.enabled,
                    predecessors: rendered_node.predecessors.clone(),
                    successors: rendered_node.successors.clone(),
                },
            );
            stage_node_keys
                .entry(rendered_node.stage_order)
                .or_default()
                .push(rendered_node.node_key.clone());
        }
        plans.push(PipelineGraphExecutionPlan {
            run_project_id,
            project,
            nodes_by_key,
            stage_node_keys,
        });
    }

    tx.commit().await?;
    Ok((pipeline_run_id, seeded_stages, plans))
}

async fn mark_pipeline_run_finished(
    pool: &SqlitePool,
    pipeline_run_id: i64,
    status: &str,
) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE pipeline_runs
       SET status = ?1,
           finished_at = ?2,
           updated_at = ?3
       WHERE id = ?4"#,
    )
    .bind(status)
    .bind(&now)
    .bind(&now)
    .bind(pipeline_run_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn load_pipeline_run_status(pool: &SqlitePool, pipeline_run_id: i64) -> Result<String> {
    sqlx::query_scalar::<_, String>(r#"SELECT status FROM pipeline_runs WHERE id = ?1"#)
        .bind(pipeline_run_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow!("pipeline run not found: {pipeline_run_id}"))
}

async fn is_pipeline_run_cancelling(pool: &SqlitePool, pipeline_run_id: i64) -> Result<bool> {
    Ok(load_pipeline_run_status(pool, pipeline_run_id).await? == "cancelling")
}

async fn mark_pipeline_project_running(pool: &SqlitePool, run_project_id: i64) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE pipeline_run_projects
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

async fn mark_pipeline_project_finished(
    pool: &SqlitePool,
    run_project_id: i64,
    status: &str,
    summary_message: &str,
) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE pipeline_run_projects
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

async fn mark_pipeline_stage_running(pool: &SqlitePool, run_stage_id: i64) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE pipeline_run_stages
           SET status = 'running',
               started_at = COALESCE(started_at, ?1),
               updated_at = ?2
         WHERE id = ?3"#,
    )
    .bind(&now)
    .bind(&now)
    .bind(run_stage_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_pipeline_stage_waiting(
    pool: &SqlitePool,
    run_stage_id: i64,
    summary_message: &str,
) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE pipeline_run_stages
           SET status = 'waiting',
               summary_message = ?1,
               started_at = COALESCE(started_at, ?2),
               updated_at = ?3
         WHERE id = ?4 AND status IN ('pending', 'running', 'waiting')"#,
    )
    .bind(summary_message)
    .bind(&now)
    .bind(&now)
    .bind(run_stage_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_pipeline_stage_finished(
    pool: &SqlitePool,
    run_stage_id: i64,
    status: &str,
    summary_message: &str,
) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE pipeline_run_stages
           SET status = ?1,
               summary_message = ?2,
               started_at = COALESCE(started_at, ?3),
               finished_at = ?4,
               updated_at = ?5
         WHERE id = ?6"#,
    )
    .bind(status)
    .bind(summary_message)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .bind(run_stage_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_pipeline_stage_blocked(
    pool: &SqlitePool,
    run_stage_id: i64,
    summary_message: &str,
) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE pipeline_run_stages
           SET summary_message = ?1,
               updated_at = ?2
         WHERE id = ?3 AND status = 'pending'"#,
    )
    .bind(summary_message)
    .bind(&now)
    .bind(run_stage_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_pipeline_node_running(pool: &SqlitePool, run_node_id: i64) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE pipeline_run_nodes
       SET status = 'running',
           started_at = ?1,
           updated_at = ?2
       WHERE id = ?3"#,
    )
    .bind(&now)
    .bind(&now)
    .bind(run_node_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_pipeline_node_finished(
    pool: &SqlitePool,
    run_node_id: i64,
    status: &str,
    stdout: &str,
    stderr: &str,
    exit_code: Option<i64>,
    summary_message: &str,
    envelope: Option<&FailureEnvelope>,
) -> Result<()> {
    let now = now_rfc3339();
    sqlx::query(
        r#"UPDATE pipeline_run_nodes
       SET status = ?1,
           stdout = ?2,
           stderr = ?3,
           exit_code = ?4,
           summary_message = ?5,
           error_code = ?6,
           title_zh = ?7,
           detail_zh = ?8,
           suggestion_zh = ?9,
           evidence = ?10,
           finished_at = ?11,
           updated_at = ?12
       WHERE id = ?13"#,
    )
    .bind(status)
    .bind(stdout)
    .bind(stderr)
    .bind(exit_code)
    .bind(summary_message)
    .bind(envelope.map(|value| value.error_code.as_str()))
    .bind(envelope.map(|value| value.title_zh.as_str()))
    .bind(envelope.map(|value| value.detail_zh.as_str()))
    .bind(envelope.map(|value| value.suggestion_zh.as_str()))
    .bind(envelope.map(|value| value.evidence.as_str()))
    .bind(&now)
    .bind(&now)
    .bind(run_node_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_pipeline_node_status(pool: &SqlitePool, run_node_id: i64) -> Result<String> {
    sqlx::query_scalar::<_, String>(r#"SELECT status FROM pipeline_run_nodes WHERE id = ?1"#)
        .bind(run_node_id)
        .fetch_one(pool)
        .await
        .context("load pipeline node status")
}

async fn update_pipeline_node_wait_state(
    pool: &SqlitePool,
    run_node_id: i64,
    summary_message: &str,
    wait_metadata: &WaitMetadata,
) -> Result<()> {
    let now = now_rfc3339();
    let wait_context_json =
        serde_json::to_string(&wait_metadata.wait_context).context("serialize wait context")?;
    sqlx::query(
        r#"UPDATE pipeline_run_nodes
       SET status = 'waiting',
           summary_message = ?1,
           wait_target = ?2,
           last_remote_status = ?3,
           remote_pipeline_id = ?4,
           wait_context_json = ?5,
           updated_at = ?6
       WHERE id = ?7"#,
    )
    .bind(summary_message)
    .bind(&wait_metadata.wait_target)
    .bind(wait_metadata.last_remote_status.as_deref())
    .bind(wait_metadata.remote_pipeline_id)
    .bind(wait_context_json)
    .bind(&now)
    .bind(run_node_id)
    .execute(pool)
    .await?;
    Ok(())
}

fn is_graph_dependency_satisfied(status: &str) -> bool {
    matches!(status, "success" | "reused")
}

fn merge_execution_contexts(
    contexts: &[PipelineExecutionContextState],
) -> Result<PipelineExecutionContextState> {
    let Some(first) = contexts.first() else {
        return Ok(PipelineExecutionContextState::empty());
    };
    for context in contexts.iter().skip(1) {
        let same_project = context.managed_project_id == first.managed_project_id;
        let same_working_dir = context
            .working_dir()
            .map(|path| path.to_path_buf())
            == first.working_dir().map(|path| path.to_path_buf());
        if !same_project || !same_working_dir {
            return Err(anyhow!(
                "multiple upstream execution contexts conflict for the same DAG node"
            ));
        }
    }
    Ok(first.clone())
}

fn resolve_graph_node_input_context(
    base_context: &PipelineExecutionContextState,
    node: &PipelineGraphExecutionNode,
    completed_contexts: &HashMap<(usize, String), PipelineExecutionContextState>,
    plan_index: usize,
) -> Result<PipelineExecutionContextState> {
    if node.predecessors.is_empty() {
        return Ok(base_context.clone());
    }

    let mut contexts = Vec::with_capacity(node.predecessors.len());
    for predecessor_key in &node.predecessors {
        let context = completed_contexts
            .get(&(plan_index, predecessor_key.clone()))
            .cloned()
            .ok_or_else(|| anyhow!("missing execution context for predecessor node: {predecessor_key}"))?;
        contexts.push(context);
    }
    merge_execution_contexts(&contexts)
}

async fn mark_graph_nodes_with_status(
    pool: &SqlitePool,
    plan: &PipelineGraphExecutionPlan,
    node_keys: &[String],
    status: &str,
    summary_message: &str,
) -> Result<()> {
    for node_key in node_keys {
        let Some(node) = plan.nodes_by_key.get(node_key) else {
            continue;
        };
        let current = load_pipeline_node_status(pool, node.run_node_id).await?;
        if current == "pending" || current == "running" || current == "waiting" {
            mark_pipeline_node_finished(
                pool,
                node.run_node_id,
                status,
                "",
                "",
                None,
                summary_message,
                None,
            )
            .await?;
        }
    }
    Ok(())
}

async fn execute_graph_node(
    pool: &SqlitePool,
    _plan: &PipelineGraphExecutionPlan,
    plan_index: usize,
    node: &PipelineGraphExecutionNode,
    gitlab_cfg: Option<&GitLabConfig>,
    base_context: &PipelineExecutionContextState,
    completed_contexts: &HashMap<(usize, String), PipelineExecutionContextState>,
) -> Result<GraphNodeExecutionOutcome> {
    let input_context =
        resolve_graph_node_input_context(base_context, node, completed_contexts, plan_index)?;

    if node.node_type == "switch_project" {
        let managed_project_id = read_switch_project_id(&node.rendered_parameters)?;
        let project = load_enabled_managed_project(pool, managed_project_id).await?;
        let next_context = PipelineExecutionContextState::from_project(&project);
        let summary = format!("已切换到项目 {}", project.name);
        mark_pipeline_node_finished(
            pool,
            node.run_node_id,
            "success",
            "",
            "",
            Some(0),
            &summary,
            None,
        )
        .await?;
        return Ok(GraphNodeExecutionOutcome::Success {
            context: next_context,
        });
    }

    if matches!(
        node.node_type.as_str(),
        "check_pipeline" | "wait_pipeline" | "trigger_pipeline"
    ) {
        let cfg = match gitlab_cfg {
            Some(cfg) => cfg,
            None => {
                let envelope = gitlab_executor::classify_missing_gitlab_config();
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "failed",
                    "",
                    "",
                    None,
                    &envelope.title_zh,
                    Some(&envelope),
                )
                .await?;
                return Ok(GraphNodeExecutionOutcome::Failed {
                    kind: GraphNodeFailureKind::FailedPrecheck,
                });
            }
        };

        let project_path = match gitlab_executor::read_pipeline_project_param(
            &node.rendered_parameters,
            input_context.project_ref(),
        ) {
            Ok(value) => value,
            Err(error) => {
                let envelope = classify_invalid_execution_parameters(&error.to_string());
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "failed",
                    "",
                    "",
                    None,
                    &envelope.title_zh,
                    Some(&envelope),
                )
                .await?;
                return Ok(GraphNodeExecutionOutcome::Failed {
                    kind: GraphNodeFailureKind::FailedPrecheck,
                });
            }
        };
        let reference = match gitlab_executor::read_pipeline_reference_param(
            &node.rendered_parameters,
            input_context.project_ref(),
        ) {
            Ok(value) => value,
            Err(error) => {
                let envelope = classify_invalid_execution_parameters(&error.to_string());
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "failed",
                    "",
                    "",
                    None,
                    &envelope.title_zh,
                    Some(&envelope),
                )
                .await?;
                return Ok(GraphNodeExecutionOutcome::Failed {
                    kind: GraphNodeFailureKind::FailedPrecheck,
                });
            }
        };
        let sha =
            match gitlab_executor::read_optional_string_param(&node.rendered_parameters, "sha") {
                Some(value) if !value.is_empty() => Some(value),
                _ => None,
            };

        let gitlab_result: std::result::Result<(String, String), FailureEnvelope> =
            match node.node_type.as_str() {
                "check_pipeline" => match gitlab::check_pipeline(
                    cfg,
                    &project_path,
                    &reference,
                    sha.as_deref(),
                )
                .await
                {
                    Ok(Some(pipeline)) if pipeline.status == "success" => Ok((
                        format!("GitLab 流水线检查通过：#{}", pipeline.id),
                        gitlab_executor::pipeline_evidence_text(&pipeline),
                    )),
                    Ok(Some(pipeline)) => Err(
                        gitlab_executor::classify_gitlab_pipeline_status_failure(
                            &pipeline,
                            "check_pipeline",
                        ),
                    ),
                    Ok(None) => Err(gitlab_executor::classify_pipeline_not_found(
                        &project_path,
                        &reference,
                        sha.as_deref(),
                    )),
                    Err(error) => Err(gitlab_executor::classify_gitlab_error(&error.to_string())),
                },
                "trigger_pipeline" => {
                    let variables =
                        match gitlab_executor::read_pipeline_variables_param(&node.rendered_parameters)
                        {
                            Ok(value) => value,
                            Err(error) => {
                                let envelope =
                                    classify_invalid_execution_parameters(&error.to_string());
                                mark_pipeline_node_finished(
                                    pool,
                                    node.run_node_id,
                                    "failed",
                                    "",
                                    "",
                                    None,
                                    &envelope.title_zh,
                                    Some(&envelope),
                                )
                                .await?;
                                return Ok(GraphNodeExecutionOutcome::Failed {
                                    kind: GraphNodeFailureKind::FailedPrecheck,
                                });
                            }
                        };
                    match gitlab::trigger_pipeline(cfg, &project_path, &reference, &variables).await {
                        Ok(pipeline) => Ok((
                            format!("已触发下游流水线 #{}", pipeline.id),
                            gitlab_executor::pipeline_evidence_text(&pipeline),
                        )),
                        Err(error) => Err(gitlab_executor::classify_gitlab_error(&error.to_string())),
                    }
                }
                "wait_pipeline" => {
                    let timeout_ms =
                        match read_optional_u64_param(&node.rendered_parameters, "timeout_ms") {
                            Ok(Some(value)) => value,
                            Ok(None) => DEFAULT_PIPELINE_WAIT_TIMEOUT_MS,
                            Err(error) => {
                                let envelope =
                                    classify_invalid_execution_parameters(&error.to_string());
                                mark_pipeline_node_finished(
                                    pool,
                                    node.run_node_id,
                                    "failed",
                                    "",
                                    "",
                                    None,
                                    &envelope.title_zh,
                                    Some(&envelope),
                                )
                                .await?;
                                return Ok(GraphNodeExecutionOutcome::Failed {
                                    kind: GraphNodeFailureKind::FailedPrecheck,
                                });
                            }
                        };
                    let poll_interval_ms = match read_optional_u64_param(
                        &node.rendered_parameters,
                        "poll_interval_ms",
                    ) {
                        Ok(Some(value)) if value > 0 => value,
                        Ok(Some(_)) => DEFAULT_PIPELINE_WAIT_POLL_INTERVAL_MS,
                        Ok(None) => DEFAULT_PIPELINE_WAIT_POLL_INTERVAL_MS,
                        Err(error) => {
                            let envelope =
                                classify_invalid_execution_parameters(&error.to_string());
                            mark_pipeline_node_finished(
                                pool,
                                node.run_node_id,
                                "failed",
                                "",
                                "",
                                None,
                                &envelope.title_zh,
                                Some(&envelope),
                            )
                            .await?;
                            return Ok(GraphNodeExecutionOutcome::Failed {
                                kind: GraphNodeFailureKind::FailedPrecheck,
                            });
                        }
                    };

                    let wait_deadline = Instant::now() + StdDuration::from_millis(timeout_ms);
                    loop {
                        match gitlab::check_pipeline(cfg, &project_path, &reference, sha.as_deref())
                            .await
                        {
                            Ok(Some(pipeline)) if pipeline.status == "success" => {
                                break Ok((
                                    format!("远端流水线已完成：#{}", pipeline.id),
                                    gitlab_executor::pipeline_evidence_text(&pipeline),
                                ));
                            }
                            Ok(Some(pipeline)) if pipeline.status == "running" || pipeline.status == "pending" => {
                                let elapsed_ms = timeout_ms.saturating_sub(
                                    wait_deadline
                                        .saturating_duration_since(Instant::now())
                                        .as_millis() as u64,
                                ) as u128;
                                let wait_metadata =
                                    gitlab_executor::update_wait_metadata_with_pipeline(
                                        &project_path,
                                        &reference,
                                        sha.as_deref(),
                                        Some(&pipeline),
                                        elapsed_ms,
                                        poll_interval_ms,
                                        timeout_ms as u128,
                                    )?;
                                let summary = format!(
                                    "等待远端流水线 #{}，当前状态：{}",
                                    pipeline.id, pipeline.status
                                );
                                update_pipeline_node_wait_state(
                                    pool,
                                    node.run_node_id,
                                    &summary,
                                    &wait_metadata,
                                )
                                .await?;
                                mark_pipeline_stage_waiting(pool, node.run_stage_id, &summary).await?;
                                if Instant::now() >= wait_deadline {
                                    break Err(gitlab_executor::classify_gitlab_error(
                                        &format!(
                                            "wait_pipeline timed out for project={project_path}, ref={reference}, pipeline_id={}",
                                            pipeline.id
                                        ),
                                    ));
                                }
                                tokio::time::sleep(StdDuration::from_millis(poll_interval_ms)).await;
                            }
                            Ok(Some(pipeline)) => {
                                break Err(gitlab_executor::classify_gitlab_pipeline_status_failure(
                                    &pipeline,
                                    "wait_pipeline",
                                ));
                            }
                            Ok(None) => {
                                break Err(gitlab_executor::classify_pipeline_not_found(
                                    &project_path,
                                    &reference,
                                    sha.as_deref(),
                                ));
                            }
                            Err(error) => {
                                break Err(gitlab_executor::classify_gitlab_error(&error.to_string()));
                            }
                        }
                    }
                }
                _ => unreachable!("checked gitlab node type"),
            };

        match gitlab_result {
            Ok((summary, evidence)) => {
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "success",
                    "",
                    "",
                    Some(0),
                    &summary,
                    None,
                )
                .await?;
                if !evidence.is_empty() {
                    sqlx::query(
                        r#"UPDATE pipeline_run_nodes
                           SET evidence = ?1, updated_at = ?2
                         WHERE id = ?3"#,
                    )
                    .bind(evidence)
                    .bind(now_rfc3339())
                    .bind(node.run_node_id)
                    .execute(pool)
                    .await?;
                }
                return Ok(GraphNodeExecutionOutcome::Success {
                    context: input_context,
                });
            }
            Err(envelope) => {
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "failed",
                    "",
                    "",
                    None,
                    &envelope.title_zh,
                    Some(&envelope),
                )
                .await?;
                return Ok(GraphNodeExecutionOutcome::Failed {
                    kind: GraphNodeFailureKind::Failed,
                });
            }
        }
    }

    let operation = match build_execution_step_operation(
        &node.node_type,
        &node.rendered_parameters,
        input_context.project_ref(),
        input_context.working_dir(),
    ) {
        Ok(value) => value,
        Err(error) => {
            let envelope = classify_invalid_execution_parameters(&error.to_string());
            mark_pipeline_node_finished(
                pool,
                node.run_node_id,
                "failed",
                "",
                "",
                None,
                &envelope.title_zh,
                Some(&envelope),
            )
            .await?;
            return Ok(GraphNodeExecutionOutcome::Failed {
                kind: GraphNodeFailureKind::FailedPrecheck,
            });
        }
    };

    match operation {
        StepOperation::SetWorkingPath { ref target_path } => {
            if let Err(error) = run_execution_step_prechecks(
                input_context.working_dir(),
                input_context.project_ref(),
                &operation,
            )
            .await
            {
                let envelope = classify_precheck_failure(&error.to_string());
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "failed",
                    "",
                    "",
                    None,
                    &envelope.title_zh,
                    Some(&envelope),
                )
                .await?;
                return Ok(GraphNodeExecutionOutcome::Failed {
                    kind: GraphNodeFailureKind::FailedPrecheck,
                });
            }

            let mut next_context = input_context.clone();
            next_context.working_dir = Some(target_path.clone());
            let summary = format!("执行路径已切换到 {}", target_path.display());
            mark_pipeline_node_finished(
                pool,
                node.run_node_id,
                "success",
                "",
                "",
                Some(0),
                &summary,
                None,
            )
            .await?;
            Ok(GraphNodeExecutionOutcome::Success {
                context: next_context,
            })
        }
        _ => {
            let Some(working_dir) = input_context.working_dir() else {
                let envelope =
                    classify_precheck_failure("working directory is required for this step");
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "failed",
                    "",
                    "",
                    None,
                    &envelope.title_zh,
                    Some(&envelope),
                )
                .await?;
                return Ok(GraphNodeExecutionOutcome::Failed {
                    kind: GraphNodeFailureKind::FailedPrecheck,
                });
            };

            if let Err(error) = run_execution_step_prechecks(
                Some(working_dir),
                input_context.project_ref(),
                &operation,
            )
            .await
            {
                let envelope = classify_precheck_failure(&error.to_string());
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "failed",
                    "",
                    "",
                    None,
                    &envelope.title_zh,
                    Some(&envelope),
                )
                .await?;
                return Ok(GraphNodeExecutionOutcome::Failed {
                    kind: GraphNodeFailureKind::FailedPrecheck,
                });
            }

            let working_dir_display = input_context
                .working_dir_display()
                .ok_or_else(|| anyhow!("working directory is required for this step"))?;
            let repo_lease = get_repo_lease(&working_dir_display).await;
            let _repo_guard = repo_lease.lock().await;
            let command_result =
                execute_git_command(working_dir_display, operation.to_args()).await?;

            if command_result.success {
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "success",
                    &command_result.stdout,
                    &command_result.stderr,
                    command_result.exit_code,
                    "node completed",
                    None,
                )
                .await?;
                Ok(GraphNodeExecutionOutcome::Success {
                    context: input_context,
                })
            } else {
                let envelope =
                    git_executor::classify_git_command_failure(&node.node_type, &command_result);
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "failed",
                    &command_result.stdout,
                    &command_result.stderr,
                    command_result.exit_code,
                    &envelope.title_zh,
                    Some(&envelope),
                )
                .await?;
                Ok(GraphNodeExecutionOutcome::Failed {
                    kind: GraphNodeFailureKind::Failed,
                })
            }
        }
    }
}

async fn mark_remaining_pipeline_nodes_skipped(
    pool: &SqlitePool,
    nodes: &[PipelineProjectExecutionNode],
    from_index: usize,
    summary_message: &str,
) -> Result<()> {
    for node in nodes.iter().skip(from_index) {
        let status = load_pipeline_node_status(pool, node.run_node_id).await?;
        if status == "pending" {
            mark_pipeline_node_finished(
                pool,
                node.run_node_id,
                "skipped",
                "",
                "",
                None,
                summary_message,
                None,
            )
            .await?;
        }
    }
    Ok(())
}

async fn mark_remaining_pipeline_nodes_cancelled(
    pool: &SqlitePool,
    nodes: &[PipelineProjectExecutionNode],
    from_index: usize,
    summary_message: &str,
) -> Result<()> {
    for node in nodes.iter().skip(from_index) {
        let status = load_pipeline_node_status(pool, node.run_node_id).await?;
        if status == "pending" || status == "running" {
            mark_pipeline_node_finished(
                pool,
                node.run_node_id,
                "cancelled",
                "",
                "",
                None,
                summary_message,
                None,
            )
            .await?;
        }
    }
    Ok(())
}

async fn maybe_cancel_pipeline_project(
    pool: &SqlitePool,
    pipeline_run_id: i64,
    plan: &PipelineProjectExecutionPlan,
    from_node_index: usize,
    summary_message: &str,
) -> Result<bool> {
    if !is_pipeline_run_cancelling(pool, pipeline_run_id).await? {
        return Ok(false);
    }

    mark_remaining_pipeline_nodes_cancelled(pool, &plan.nodes, from_node_index, summary_message)
        .await?;
    mark_pipeline_project_finished(pool, plan.run_project_id, "cancelled", summary_message).await?;
    Ok(true)
}

async fn mark_pipeline_project_internal_failure(
    pool: &SqlitePool,
    plan: &PipelineProjectExecutionPlan,
    message: &str,
) -> Result<()> {
    let envelope = build_failure_envelope(
        "pipeline.executor_internal_error",
        "执行器内部错误",
        format!("Pipeline 执行器内部错误：{message}"),
        "请查看技术证据并修复后重试。",
        message.to_string(),
    );
    let mut consumed_first_unfinished = false;
    for node in &plan.nodes {
        let status = load_pipeline_node_status(pool, node.run_node_id).await?;
        if status == "success" || status == "failed" || status == "skipped" || status == "cancelled"
        {
            continue;
        }

        if !consumed_first_unfinished {
            mark_pipeline_node_finished(
                pool,
                node.run_node_id,
                "failed",
                "",
                "",
                None,
                &envelope.title_zh,
                Some(&envelope),
            )
            .await?;
            consumed_first_unfinished = true;
        } else if status == "pending" {
            mark_pipeline_node_finished(
                pool,
                node.run_node_id,
                "skipped",
                "",
                "",
                None,
                "skipped after executor internal error",
                None,
            )
            .await?;
        }
    }
    mark_pipeline_project_finished(pool, plan.run_project_id, "failed", &envelope.title_zh).await
}

async fn execute_pipeline_project_plan(
    pool: &SqlitePool,
    pipeline_run_id: i64,
    plan: &PipelineProjectExecutionPlan,
    gitlab_cfg: Option<&GitLabConfig>,
) -> Result<ProjectOutcome> {
    if maybe_cancel_pipeline_project(
        pool,
        pipeline_run_id,
        plan,
        0,
        "cancelled before project execution",
    )
    .await?
    {
        return Ok(ProjectOutcome::Cancelled);
    }

    mark_pipeline_project_running(pool, plan.run_project_id).await?;
    let mut execution_context = plan.project.as_ref().map(LocalExecutionContext::new);

    if maybe_cancel_pipeline_project(
        pool,
        pipeline_run_id,
        plan,
        0,
        "cancelled before node execution",
    )
    .await?
    {
        return Ok(ProjectOutcome::Cancelled);
    }

    for (node_index, node) in plan.nodes.iter().enumerate() {
        if maybe_cancel_pipeline_project(
            pool,
            pipeline_run_id,
            plan,
            node_index,
            "cancelled before node execution",
        )
        .await?
        {
            return Ok(ProjectOutcome::Cancelled);
        }

        mark_pipeline_node_running(pool, node.run_node_id).await?;

        if maybe_cancel_pipeline_project(
            pool,
            pipeline_run_id,
            plan,
            node_index,
            "cancelled before node execution",
        )
        .await?
        {
            return Ok(ProjectOutcome::Cancelled);
        }

        let execution_step = ProjectExecutionStep {
            run_step_id: node.run_node_id,
            step_type: node.node_type.clone(),
            rendered_parameters: node.rendered_parameters.clone(),
        };

        if node.node_type == "switch_project" {
            let summary = match plan.project.as_ref() {
                Some(project) => format!("已切换到项目 {}", project.name),
                None => "当前节点未配置目标项目".to_string(),
            };
            mark_pipeline_node_finished(
                pool,
                node.run_node_id,
                "success",
                "",
                "",
                Some(0),
                &summary,
                None,
            )
            .await?;
            continue;
        }

        if matches!(
            node.node_type.as_str(),
            "check_pipeline" | "wait_pipeline" | "trigger_pipeline"
        ) {
            let cfg = match gitlab_cfg {
                Some(cfg) => cfg,
                None => {
                    let envelope = gitlab_executor::classify_missing_gitlab_config();
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "failed",
                        "",
                        "",
                        None,
                        &envelope.title_zh,
                        Some(&envelope),
                    )
                    .await?;
                    mark_remaining_pipeline_nodes_skipped(
                        pool,
                        &plan.nodes,
                        node_index + 1,
                        "skipped after previous node failure",
                    )
                    .await?;
                    mark_pipeline_project_finished(
                        pool,
                        plan.run_project_id,
                        "failed_precheck",
                        &envelope.title_zh,
                    )
                    .await?;
                    return Ok(ProjectOutcome::FailedPrecheck);
                }
            };

            let project_path = match gitlab_executor::read_pipeline_project_param(
                &node.rendered_parameters,
                plan.project.as_ref(),
            ) {
                Ok(value) => value,
                Err(error) => {
                    let envelope = classify_invalid_execution_parameters(&error.to_string());
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "failed",
                        "",
                        "",
                        None,
                        &envelope.title_zh,
                        Some(&envelope),
                    )
                    .await?;
                    mark_remaining_pipeline_nodes_skipped(
                        pool,
                        &plan.nodes,
                        node_index + 1,
                        "skipped after previous node failure",
                    )
                    .await?;
                    mark_pipeline_project_finished(
                        pool,
                        plan.run_project_id,
                        "failed_precheck",
                        &envelope.title_zh,
                    )
                    .await?;
                    return Ok(ProjectOutcome::FailedPrecheck);
                }
            };
            let reference = match gitlab_executor::read_pipeline_reference_param(
                &node.rendered_parameters,
                plan.project.as_ref(),
            ) {
                Ok(value) => value,
                Err(error) => {
                    let envelope = classify_invalid_execution_parameters(&error.to_string());
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "failed",
                        "",
                        "",
                        None,
                        &envelope.title_zh,
                        Some(&envelope),
                    )
                    .await?;
                    mark_remaining_pipeline_nodes_skipped(
                        pool,
                        &plan.nodes,
                        node_index + 1,
                        "skipped after previous node failure",
                    )
                    .await?;
                    mark_pipeline_project_finished(
                        pool,
                        plan.run_project_id,
                        "failed_precheck",
                        &envelope.title_zh,
                    )
                    .await?;
                    return Ok(ProjectOutcome::FailedPrecheck);
                }
            };
            let sha =
                match gitlab_executor::read_optional_string_param(&node.rendered_parameters, "sha")
                {
                    Some(value) if !value.is_empty() => Some(value),
                    _ => None,
                };

            let gitlab_result: std::result::Result<(String, String), FailureEnvelope> = match node
                .node_type
                .as_str()
            {
                "check_pipeline" => {
                    match gitlab::check_pipeline(cfg, &project_path, &reference, sha.as_deref())
                        .await
                    {
                        Ok(Some(pipeline)) if pipeline.status == "success" => Ok((
                            format!("GitLab 流水线检查通过：#{}", pipeline.id),
                            gitlab_executor::pipeline_evidence_text(&pipeline),
                        )),
                        Ok(Some(pipeline)) => {
                            Err(gitlab_executor::classify_gitlab_pipeline_status_failure(
                                &pipeline,
                                "check_pipeline",
                            ))
                        }
                        Ok(None) => Err(gitlab_executor::classify_pipeline_not_found(
                            &project_path,
                            &reference,
                            sha.as_deref(),
                        )),
                        Err(error) => {
                            Err(gitlab_executor::classify_gitlab_error(&error.to_string()))
                        }
                    }
                }
                "trigger_pipeline" => {
                    let variables = match gitlab_executor::read_pipeline_variables_param(
                        &node.rendered_parameters,
                    ) {
                        Ok(value) => value,
                        Err(error) => {
                            let envelope =
                                classify_invalid_execution_parameters(&error.to_string());
                            mark_pipeline_node_finished(
                                pool,
                                node.run_node_id,
                                "failed",
                                "",
                                "",
                                None,
                                &envelope.title_zh,
                                Some(&envelope),
                            )
                            .await?;
                            mark_remaining_pipeline_nodes_skipped(
                                pool,
                                &plan.nodes,
                                node_index + 1,
                                "skipped after previous node failure",
                            )
                            .await?;
                            mark_pipeline_project_finished(
                                pool,
                                plan.run_project_id,
                                "failed_precheck",
                                &envelope.title_zh,
                            )
                            .await?;
                            return Ok(ProjectOutcome::FailedPrecheck);
                        }
                    };

                    match gitlab::trigger_pipeline(cfg, &project_path, &reference, &variables).await
                    {
                        Ok(pipeline) => Ok((
                            format!("已触发下游流水线 #{}", pipeline.id),
                            gitlab_executor::pipeline_evidence_text(&pipeline),
                        )),
                        Err(error) => {
                            Err(gitlab_executor::classify_gitlab_error(&error.to_string()))
                        }
                    }
                }
                "wait_pipeline" => {
                    let timeout_ms =
                        match read_optional_u64_param(&node.rendered_parameters, "timeout_ms") {
                            Ok(Some(value)) => value,
                            Ok(None) => DEFAULT_PIPELINE_WAIT_TIMEOUT_MS,
                            Err(error) => {
                                let envelope =
                                    classify_invalid_execution_parameters(&error.to_string());
                                mark_pipeline_node_finished(
                                    pool,
                                    node.run_node_id,
                                    "failed",
                                    "",
                                    "",
                                    None,
                                    &envelope.title_zh,
                                    Some(&envelope),
                                )
                                .await?;
                                mark_remaining_pipeline_nodes_skipped(
                                    pool,
                                    &plan.nodes,
                                    node_index + 1,
                                    "skipped after previous node failure",
                                )
                                .await?;
                                mark_pipeline_project_finished(
                                    pool,
                                    plan.run_project_id,
                                    "failed_precheck",
                                    &envelope.title_zh,
                                )
                                .await?;
                                return Ok(ProjectOutcome::FailedPrecheck);
                            }
                        };
                    let poll_interval_ms = match read_optional_u64_param(
                        &node.rendered_parameters,
                        "poll_interval_ms",
                    ) {
                        Ok(Some(value)) if value > 0 => value,
                        Ok(Some(_)) => DEFAULT_PIPELINE_WAIT_POLL_INTERVAL_MS,
                        Ok(None) => DEFAULT_PIPELINE_WAIT_POLL_INTERVAL_MS,
                        Err(error) => {
                            let envelope =
                                classify_invalid_execution_parameters(&error.to_string());
                            mark_pipeline_node_finished(
                                pool,
                                node.run_node_id,
                                "failed",
                                "",
                                "",
                                None,
                                &envelope.title_zh,
                                Some(&envelope),
                            )
                            .await?;
                            mark_remaining_pipeline_nodes_skipped(
                                pool,
                                &plan.nodes,
                                node_index + 1,
                                "skipped after previous node failure",
                            )
                            .await?;
                            mark_pipeline_project_finished(
                                pool,
                                plan.run_project_id,
                                "failed_precheck",
                                &envelope.title_zh,
                            )
                            .await?;
                            return Ok(ProjectOutcome::FailedPrecheck);
                        }
                    };

                    let wait_started_at = Instant::now();
                    loop {
                        let pipeline = match gitlab::check_pipeline(
                            cfg,
                            &project_path,
                            &reference,
                            sha.as_deref(),
                        )
                        .await
                        {
                            Ok(value) => value,
                            Err(error) => {
                                break Err(gitlab_executor::classify_gitlab_error(
                                    &error.to_string(),
                                ));
                            }
                        };

                        let elapsed_ms = wait_started_at.elapsed().as_millis();
                        let wait_metadata =
                            match gitlab_executor::update_wait_metadata_with_pipeline(
                                &project_path,
                                &reference,
                                sha.as_deref(),
                                pipeline.as_ref(),
                                elapsed_ms,
                                poll_interval_ms,
                                u128::from(timeout_ms),
                            ) {
                                Ok(value) => value,
                                Err(error) => {
                                    let envelope =
                                        classify_invalid_execution_parameters(&error.to_string());
                                    break Err(envelope);
                                }
                            };

                        match pipeline {
                            Some(pipeline) if pipeline.status == "success" => {
                                if let Err(error) = update_pipeline_node_wait_state(
                                    pool,
                                    node.run_node_id,
                                    &format!("已等待到 GitLab 流水线 #{} 成功", pipeline.id),
                                    &wait_metadata,
                                )
                                .await
                                {
                                    return Err(error);
                                }
                                break Ok((
                                    format!("等待 GitLab 流水线完成：#{}", pipeline.id),
                                    gitlab_executor::pipeline_evidence_text(&pipeline),
                                ));
                            }
                            Some(pipeline)
                                if matches!(
                                    pipeline.status.as_str(),
                                    "failed" | "canceled" | "cancelled" | "skipped"
                                ) =>
                            {
                                if let Err(error) = update_pipeline_node_wait_state(
                                    pool,
                                    node.run_node_id,
                                    &format!(
                                        "等待中的 GitLab 流水线 #{} 已结束，状态为 {}",
                                        pipeline.id, pipeline.status
                                    ),
                                    &wait_metadata,
                                )
                                .await
                                {
                                    return Err(error);
                                }
                                break Err(
                                    gitlab_executor::classify_gitlab_pipeline_status_failure(
                                        &pipeline,
                                        "wait_pipeline",
                                    ),
                                );
                            }
                            Some(pipeline) => {
                                let summary_message = match pipeline {
                                    current => format!(
                                        "等待 GitLab 流水线 #{}，当前状态为 {}",
                                        current.id, current.status
                                    ),
                                };
                                if let Err(error) = update_pipeline_node_wait_state(
                                    pool,
                                    node.run_node_id,
                                    &summary_message,
                                    &wait_metadata,
                                )
                                .await
                                {
                                    return Err(error);
                                }
                            }
                            None => {
                                let summary_message = "等待匹配的 GitLab 流水线出现".to_string();
                                if let Err(error) = update_pipeline_node_wait_state(
                                    pool,
                                    node.run_node_id,
                                    &summary_message,
                                    &wait_metadata,
                                )
                                .await
                                {
                                    return Err(error);
                                }
                            }
                        }

                        if elapsed_ms >= u128::from(timeout_ms) {
                            break Err(gitlab_executor::classify_gitlab_error(&format!(
                                "GitLab pipeline wait timed out for project={}, ref={}, sha={:?}",
                                &project_path,
                                &reference,
                                sha.as_deref()
                            )));
                        }

                        tokio::time::sleep(StdDuration::from_millis(poll_interval_ms)).await;
                    }
                }
                _ => unreachable!(),
            };

            match gitlab_result {
                Ok((summary_message, stdout)) => {
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "success",
                        &stdout,
                        "",
                        Some(0),
                        &summary_message,
                        None,
                    )
                    .await?;
                    continue;
                }
                Err(envelope) => {
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "failed",
                        "",
                        "",
                        None,
                        &envelope.title_zh,
                        Some(&envelope),
                    )
                    .await?;
                    mark_remaining_pipeline_nodes_skipped(
                        pool,
                        &plan.nodes,
                        node_index + 1,
                        "skipped after previous node failure",
                    )
                    .await?;
                    mark_pipeline_project_finished(
                        pool,
                        plan.run_project_id,
                        "failed",
                        &envelope.title_zh,
                    )
                    .await?;
                    return Ok(ProjectOutcome::Failed);
                }
            }
        }

        let operation = match build_execution_step_operation(
            &execution_step.step_type,
            &execution_step.rendered_parameters,
            plan.project.as_ref(),
            execution_context.as_ref().map(|context| context.working_dir()),
        ) {
            Ok(operation) => operation,
            Err(error) => {
                let envelope = classify_invalid_execution_parameters(&error.to_string());
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "failed",
                    "",
                    "",
                    None,
                    &envelope.title_zh,
                    Some(&envelope),
                )
                .await?;
                mark_remaining_pipeline_nodes_skipped(
                    pool,
                    &plan.nodes,
                    node_index + 1,
                    "skipped after previous node failure",
                )
                .await?;
                mark_pipeline_project_finished(
                    pool,
                    plan.run_project_id,
                    "failed_precheck",
                    &envelope.title_zh,
                )
                .await?;
                return Ok(ProjectOutcome::FailedPrecheck);
            }
        };

        match &operation {
            StepOperation::SetWorkingPath { target_path } => {
                if let Err(error) = run_execution_step_prechecks(
                    execution_context.as_ref().map(|context| context.working_dir()),
                    plan.project.as_ref(),
                    &operation,
                )
                .await
                {
                    if maybe_cancel_pipeline_project(
                        pool,
                        pipeline_run_id,
                        plan,
                        node_index,
                        "cancelled during node precheck",
                    )
                    .await?
                    {
                        return Ok(ProjectOutcome::Cancelled);
                    }

                    let envelope = classify_precheck_failure(&error.to_string());
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "failed",
                        "",
                        "",
                        None,
                        &envelope.title_zh,
                        Some(&envelope),
                    )
                    .await?;
                    mark_remaining_pipeline_nodes_skipped(
                        pool,
                        &plan.nodes,
                        node_index + 1,
                        "skipped after previous node failure",
                    )
                    .await?;
                    mark_pipeline_project_finished(
                        pool,
                        plan.run_project_id,
                        "failed_precheck",
                        &envelope.title_zh,
                    )
                    .await?;
                    return Ok(ProjectOutcome::FailedPrecheck);
                }

                if maybe_cancel_pipeline_project(
                    pool,
                    pipeline_run_id,
                    plan,
                    node_index,
                    "cancelled before node execution",
                )
                .await?
                {
                    return Ok(ProjectOutcome::Cancelled);
                }

                if let Some(context) = execution_context.as_mut() {
                    context.update_working_dir(target_path.clone());
                } else {
                    execution_context =
                        Some(LocalExecutionContext::from_working_dir(target_path.clone()));
                }
                let summary = format!("执行路径已切换到 {}", target_path.display());
                mark_pipeline_node_finished(
                    pool,
                    node.run_node_id,
                    "success",
                    "",
                    "",
                    Some(0),
                    &summary,
                    None,
                )
                .await?;

                if node_index + 1 < plan.nodes.len() {
                    if maybe_cancel_pipeline_project(
                        pool,
                        pipeline_run_id,
                        plan,
                        node_index + 1,
                        "cancelled after safe execution boundary",
                    )
                    .await?
                    {
                        return Ok(ProjectOutcome::Cancelled);
                    }
                }
            }
            _ => {
                debug_assert!(node_requires_working_dir(node.node_type.as_str()));
                let Some(context) = execution_context.as_ref() else {
                    let envelope =
                        classify_precheck_failure("working directory is required for this step");
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "failed",
                        "",
                        "",
                        None,
                        &envelope.title_zh,
                        Some(&envelope),
                    )
                    .await?;
                    mark_remaining_pipeline_nodes_skipped(
                        pool,
                        &plan.nodes,
                        node_index + 1,
                        "skipped after previous node failure",
                    )
                    .await?;
                    mark_pipeline_project_finished(
                        pool,
                        plan.run_project_id,
                        "failed_precheck",
                        &envelope.title_zh,
                    )
                    .await?;
                    return Ok(ProjectOutcome::FailedPrecheck);
                };
                let working_dir_display = context.working_dir_display();
                let working_dir = context.working_dir();
                let repo_lease = get_repo_lease(&working_dir_display).await;
                let _repo_guard = repo_lease.lock().await;

                if let Err(error) = run_execution_step_prechecks(
                    Some(working_dir),
                    plan.project.as_ref(),
                    &operation,
                )
                .await
                {
                    if maybe_cancel_pipeline_project(
                        pool,
                        pipeline_run_id,
                        plan,
                        node_index,
                        "cancelled during node precheck",
                    )
                    .await?
                    {
                        return Ok(ProjectOutcome::Cancelled);
                    }

                    let envelope = classify_precheck_failure(&error.to_string());
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "failed",
                        "",
                        "",
                        None,
                        &envelope.title_zh,
                        Some(&envelope),
                    )
                    .await?;
                    mark_remaining_pipeline_nodes_skipped(
                        pool,
                        &plan.nodes,
                        node_index + 1,
                        "skipped after previous node failure",
                    )
                    .await?;
                    mark_pipeline_project_finished(
                        pool,
                        plan.run_project_id,
                        "failed_precheck",
                        &envelope.title_zh,
                    )
                    .await?;
                    return Ok(ProjectOutcome::FailedPrecheck);
                }

                if maybe_cancel_pipeline_project(
                    pool,
                    pipeline_run_id,
                    plan,
                    node_index,
                    "cancelled before node execution",
                )
                .await?
                {
                    return Ok(ProjectOutcome::Cancelled);
                }

                let command_result = execute_git_command(
                    working_dir_display,
                    operation.to_args(),
                )
                .await?;

                if command_result.success {
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "success",
                        &command_result.stdout,
                        &command_result.stderr,
                        command_result.exit_code,
                        "node completed",
                        None,
                    )
                    .await?;

                    if node_index + 1 < plan.nodes.len() {
                        if maybe_cancel_pipeline_project(
                            pool,
                            pipeline_run_id,
                            plan,
                            node_index + 1,
                            "cancelled after safe execution boundary",
                        )
                        .await?
                        {
                            return Ok(ProjectOutcome::Cancelled);
                        }
                    }
                } else {
                    let envelope =
                        git_executor::classify_git_command_failure(&node.node_type, &command_result);
                    mark_pipeline_node_finished(
                        pool,
                        node.run_node_id,
                        "failed",
                        &command_result.stdout,
                        &command_result.stderr,
                        command_result.exit_code,
                        &envelope.title_zh,
                        Some(&envelope),
                    )
                    .await?;
                    mark_remaining_pipeline_nodes_skipped(
                        pool,
                        &plan.nodes,
                        node_index + 1,
                        "skipped after previous node failure",
                    )
                    .await?;
                    mark_pipeline_project_finished(
                        pool,
                        plan.run_project_id,
                        "failed",
                        &envelope.title_zh,
                    )
                    .await?;
                    return Ok(ProjectOutcome::Failed);
                }
            }
        }
    }

    mark_pipeline_project_finished(pool, plan.run_project_id, "success", "all nodes completed")
        .await?;
    Ok(ProjectOutcome::Success)
}

fn collect_graph_stage_ready_nodes(
    plans: &[PipelineGraphExecutionPlan],
    stage_order: i64,
    node_statuses: &HashMap<(usize, String), String>,
) -> Vec<(usize, String)> {
    let mut ready = Vec::<(usize, i64, String)>::new();
    for (plan_index, plan) in plans.iter().enumerate() {
        let Some(node_keys) = plan.stage_node_keys.get(&stage_order) else {
            continue;
        };
        for node_key in node_keys {
            let Some(node) = plan.nodes_by_key.get(node_key) else {
                continue;
            };
            let status = node_statuses
                .get(&(plan_index, node_key.clone()))
                .map(String::as_str)
                .unwrap_or("pending");
            if status != "pending" {
                continue;
            }
            let dependencies_ready = node.predecessors.iter().all(|predecessor_key| {
                node_statuses
                    .get(&(plan_index, predecessor_key.clone()))
                    .map(|value| is_graph_dependency_satisfied(value))
                    .unwrap_or(false)
            });
            if dependencies_ready {
                ready.push((plan_index, node.node_order, node_key.clone()));
            }
        }
    }
    ready.sort_by_key(|(plan_index, node_order, _)| (*node_order, *plan_index));
    ready.into_iter().map(|(plan_index, _, node_key)| (plan_index, node_key)).collect()
}

async fn run_pipeline_graph_in_background(
    pool: SqlitePool,
    pipeline_run_id: i64,
    stages: Vec<SeededPipelineRunStage>,
    plans: Vec<PipelineGraphExecutionPlan>,
    max_concurrency: i64,
    gitlab_cfg: Option<GitLabConfig>,
    reused_stage_orders: HashSet<i64>,
    initial_node_statuses: HashMap<(usize, String), String>,
    initial_completed_contexts: HashMap<(usize, String), PipelineExecutionContextState>,
) -> Result<()> {
    if plans.is_empty() {
        mark_pipeline_run_finished(&pool, pipeline_run_id, "completed").await?;
        return Ok(());
    }

    let max_concurrency = usize::try_from(max_concurrency.max(1))
        .map_err(|_| anyhow!("max_concurrency is out of range"))?;

    for plan in &plans {
        mark_pipeline_project_running(&pool, plan.run_project_id).await?;
    }

    let mut node_statuses = initial_node_statuses;
    let mut completed_contexts = initial_completed_contexts;
    let base_contexts = plans
        .iter()
        .map(|plan| {
            plan.project
                .as_ref()
                .map(PipelineExecutionContextState::from_project)
                .unwrap_or_else(PipelineExecutionContextState::empty)
        })
        .collect::<Vec<_>>();
    let mut plan_failed = vec![false; plans.len()];
    let mut plan_failed_precheck = vec![false; plans.len()];
    let mut plan_cancelled = vec![false; plans.len()];
    let mut run_cancelled = false;
    let mut run_failed = false;
    let mut blocked_stage_message: Option<String> = None;

    for stage in &stages {
        if reused_stage_orders.contains(&stage.stage_order) {
            continue;
        }
        if is_pipeline_run_cancelling(&pool, pipeline_run_id).await? {
            run_cancelled = true;
            mark_pipeline_stage_finished(&pool, stage.run_stage_id, "cancelled", "运行已取消").await?;
            continue;
        }
        if let Some(message) = &blocked_stage_message {
            mark_pipeline_stage_blocked(&pool, stage.run_stage_id, message).await?;
            continue;
        }

        mark_pipeline_stage_running(&pool, stage.run_stage_id).await?;
        let mut stage_failed_kind: Option<GraphNodeFailureKind> = None;
        let mut join_set = JoinSet::new();

        loop {
            let ready_nodes = if stage_failed_kind.is_none() {
                collect_graph_stage_ready_nodes(&plans, stage.stage_order, &node_statuses)
            } else {
                Vec::new()
            };

            for (plan_index, node_key) in ready_nodes {
                if join_set.len() >= max_concurrency {
                    break;
                }
                let status_key = (plan_index, node_key.clone());
                if node_statuses
                    .get(&status_key)
                    .map(String::as_str)
                    .unwrap_or("pending")
                    != "pending"
                {
                    continue;
                }
                let plan = plans[plan_index].clone();
                let node = plan
                    .nodes_by_key
                    .get(&node_key)
                    .cloned()
                    .ok_or_else(|| anyhow!("graph node missing from plan: {node_key}"))?;
                let contexts_snapshot = completed_contexts.clone();
                let gitlab_cfg = gitlab_cfg.clone();
                let base_context = base_contexts[plan_index].clone();
                mark_pipeline_node_running(&pool, node.run_node_id).await?;
                node_statuses.insert(status_key, "running".to_string());
                let pool_cloned = pool.clone();
                join_set.spawn(async move {
                    let result = execute_graph_node(
                        &pool_cloned,
                        &plan,
                        plan_index,
                        &node,
                        gitlab_cfg.as_ref(),
                        &base_context,
                        &contexts_snapshot,
                    )
                    .await;
                    (plan_index, node, result)
                });
            }

            if join_set.is_empty() {
                break;
            }

            let (plan_index, node, outcome) = match join_set.join_next().await {
                Some(Ok(value)) => value,
                Some(Err(error)) => {
                    return Err(anyhow!("stage runtime task join failed: {error}"));
                }
                None => break,
            };

            match outcome? {
                GraphNodeExecutionOutcome::Success { context } => {
                    node_statuses.insert((plan_index, node.node_key.clone()), "success".to_string());
                    completed_contexts.insert((plan_index, node.node_key.clone()), context);
                }
                GraphNodeExecutionOutcome::Failed { kind } => {
                    node_statuses.insert((plan_index, node.node_key.clone()), "failed".to_string());
                    match kind {
                        GraphNodeFailureKind::Failed => {
                            plan_failed[plan_index] = true;
                            run_failed = true;
                        }
                        GraphNodeFailureKind::FailedPrecheck => {
                            plan_failed_precheck[plan_index] = true;
                            run_failed = true;
                        }
                        GraphNodeFailureKind::Cancelled => {
                            plan_cancelled[plan_index] = true;
                            run_cancelled = true;
                        }
                    }
                    stage_failed_kind.get_or_insert(kind);
                }
            }
        }

        let mut stage_has_success = false;
        let mut stage_has_failure = false;
        for (plan_index, plan) in plans.iter().enumerate() {
            for node_key in plan
                .stage_node_keys
                .get(&stage.stage_order)
                .cloned()
                .unwrap_or_default()
            {
                match node_statuses
                    .get(&(plan_index, node_key))
                    .map(String::as_str)
                    .unwrap_or("pending")
                {
                    "success" => stage_has_success = true,
                    "failed" => stage_has_failure = true,
                    _ => {}
                }
            }
        }

        if let Some(kind) = stage_failed_kind {
            for (plan_index, plan) in plans.iter().enumerate() {
                let pending_current_stage = plan
                    .stage_node_keys
                    .get(&stage.stage_order)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|node_key| {
                        node_statuses
                            .get(&(plan_index, node_key.clone()))
                            .map(String::as_str)
                            .unwrap_or("pending")
                            == "pending"
                    })
                    .collect::<Vec<_>>();
                if !pending_current_stage.is_empty() {
                    mark_graph_nodes_with_status(
                        &pool,
                        plan,
                        &pending_current_stage,
                        "skipped",
                        "同阶段已有节点失败，未再调度当前节点",
                    )
                    .await?;
                    for node_key in pending_current_stage {
                        node_statuses.insert((plan_index, node_key), "skipped".to_string());
                    }
                }

                let downstream_node_keys = plan
                    .stage_node_keys
                    .iter()
                    .filter(|(order, _)| **order > stage.stage_order)
                    .flat_map(|(_, node_keys)| node_keys.clone())
                    .filter(|node_key| {
                        node_statuses
                            .get(&(plan_index, node_key.clone()))
                            .map(String::as_str)
                            .unwrap_or("pending")
                            == "pending"
                    })
                    .collect::<Vec<_>>();
                if !downstream_node_keys.is_empty() {
                    mark_graph_nodes_with_status(
                        &pool,
                        plan,
                        &downstream_node_keys,
                        "skipped",
                        &format!("阶段 {} 失败，后续阶段未启动", stage.stage_name),
                    )
                    .await?;
                    for node_key in downstream_node_keys {
                        node_statuses.insert((plan_index, node_key), "skipped".to_string());
                    }
                }
            }

            let summary = format!("阶段 {} 失败，已阻断后续阶段", stage.stage_name);
            let stage_status = match kind {
                GraphNodeFailureKind::FailedPrecheck | GraphNodeFailureKind::Failed => {
                    if stage_has_success && stage_has_failure {
                        "partial_failed"
                    } else {
                        "failed"
                    }
                }
                GraphNodeFailureKind::Cancelled => "cancelled",
            };
            mark_pipeline_stage_finished(&pool, stage.run_stage_id, stage_status, &summary).await?;
            blocked_stage_message = Some(summary);
            continue;
        }

        mark_pipeline_stage_finished(&pool, stage.run_stage_id, "success", "阶段执行完成").await?;
    }

    for (plan_index, plan) in plans.iter().enumerate() {
        let status = if plan_failed[plan_index] {
            "failed"
        } else if plan_failed_precheck[plan_index] {
            "failed_precheck"
        } else if plan_cancelled[plan_index] || blocked_stage_message.is_some() {
            "cancelled"
        } else {
            "success"
        };
        let summary = match status {
            "failed" => "图执行失败",
            "failed_precheck" => "图执行预检查失败",
            "cancelled" => "图执行已停止",
            _ => "图执行完成",
        };
        mark_pipeline_project_finished(&pool, plan.run_project_id, status, summary).await?;
    }

    let final_status = derive_run_final_status(run_failed, run_cancelled);
    mark_pipeline_run_finished(&pool, pipeline_run_id, final_status).await?;
    Ok(())
}

fn collect_graph_descendants(
    rendered_nodes: &[RenderedPipelineGraphNodeDefinition],
    root_node_key: &str,
) -> HashSet<String> {
    let mut successors_by_key = HashMap::<String, Vec<String>>::new();
    for node in rendered_nodes {
        successors_by_key.insert(node.node_key.clone(), node.successors.clone());
    }

    let mut descendants = HashSet::new();
    let mut stack = vec![root_node_key.to_string()];
    while let Some(node_key) = stack.pop() {
        if !descendants.insert(node_key.clone()) {
            continue;
        }
        if let Some(successors) = successors_by_key.get(&node_key) {
            for successor in successors {
                stack.push(successor.clone());
            }
        }
    }
    descendants
}

async fn derive_reused_graph_contexts(
    pool: &SqlitePool,
    plan_index: usize,
    plan: &PipelineGraphExecutionPlan,
    reused_node_keys: &HashSet<String>,
    base_context: &PipelineExecutionContextState,
) -> Result<HashMap<(usize, String), PipelineExecutionContextState>> {
    let mut contexts = HashMap::<(usize, String), PipelineExecutionContextState>::new();
    let mut nodes = plan.nodes_by_key.values().cloned().collect::<Vec<_>>();
    nodes.sort_by_key(|node| (node.stage_order, node.node_order));

    for node in nodes {
        if !reused_node_keys.contains(&node.node_key) {
            continue;
        }
        let input_context =
            resolve_graph_node_input_context(base_context, &node, &contexts, plan_index)?;
        let output_context = match node.node_type.as_str() {
            "switch_project" => {
                let managed_project_id = read_switch_project_id(&node.rendered_parameters)?;
                let project = load_enabled_managed_project(pool, managed_project_id).await?;
                PipelineExecutionContextState::from_project(&project)
            }
            "set_working_path" => {
                let operation = build_execution_step_operation(
                    &node.node_type,
                    &node.rendered_parameters,
                    input_context.project_ref(),
                    input_context.working_dir(),
                )?;
                match operation {
                    StepOperation::SetWorkingPath { target_path } => {
                        let mut next_context = input_context.clone();
                        next_context.working_dir = Some(target_path);
                        next_context
                    }
                    _ => input_context.clone(),
                }
            }
            _ => input_context.clone(),
        };
        contexts.insert((plan_index, node.node_key.clone()), output_context);
    }

    Ok(contexts)
}

async fn mark_unscheduled_pipeline_plans_cancelled(
    pool: &SqlitePool,
    plans: &[PipelineProjectExecutionPlan],
    from_index: usize,
) -> Result<usize> {
    let mut marked = 0usize;
    for plan in plans.iter().skip(from_index) {
        mark_remaining_pipeline_nodes_cancelled(
            pool,
            &plan.nodes,
            0,
            "cancelled before project scheduling",
        )
        .await?;
        mark_pipeline_project_finished(
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

async fn stop_pipeline_scheduling_and_cancel_unscheduled(
    pool: &SqlitePool,
    plans: &[PipelineProjectExecutionPlan],
    next_plan_index: &mut usize,
) -> Result<bool> {
    if *next_plan_index >= plans.len() {
        return Ok(false);
    }

    let cancelled_count =
        mark_unscheduled_pipeline_plans_cancelled(pool, plans, *next_plan_index).await?;
    *next_plan_index = plans.len();
    Ok(cancelled_count > 0)
}

async fn run_pipeline_in_background(
    pool: SqlitePool,
    pipeline_run_id: i64,
    plans: Vec<PipelineProjectExecutionPlan>,
    max_concurrency: i64,
    gitlab_cfg: Option<GitLabConfig>,
) -> Result<()> {
    if plans.is_empty() {
        mark_pipeline_run_finished(&pool, pipeline_run_id, "completed").await?;
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
            match is_pipeline_run_cancelling(&pool, pipeline_run_id).await {
                Ok(true) => {
                    cancellation_observed = true;
                    if stop_pipeline_scheduling_and_cancel_unscheduled(
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
                        pipeline_run_id = pipeline_run_id,
                        error = %error,
                        "failed to read pipeline run cancellation status; stopping scheduler to avoid queuing additional projects"
                    );
                    cancellation_observed = true;
                    has_failures = true;
                    if stop_pipeline_scheduling_and_cancel_unscheduled(
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
            let gitlab_cfg_cloned = gitlab_cfg.clone();
            join_set.spawn(async move {
                match execute_pipeline_project_plan(
                    &pool_cloned,
                    pipeline_run_id,
                    &plan,
                    gitlab_cfg_cloned.as_ref(),
                )
                .await
                {
                    Ok(outcome) => outcome,
                    Err(error) => {
                        let message = format!("executor internal error: {error}");
                        let _ =
                            mark_pipeline_project_internal_failure(&pool_cloned, &plan, &message)
                                .await;
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
                    tracing::error!(error = %error, "pipeline project task join failed");
                    has_failures = true;
                }
            }
        }
    }

    let final_status = derive_run_final_status(has_failures, has_cancelled);
    mark_pipeline_run_finished(&pool, pipeline_run_id, final_status).await?;
    Ok(())
}

async fn load_pipeline_retry_source_run(
    pool: &SqlitePool,
    source_pipeline_run_id: i64,
) -> Result<PipelineRetrySourceRun> {
    let (pipeline_definition_id, project_group_id, status, run_parameters_json) =
        sqlx::query_as::<_, (i64, Option<i64>, String, String)>(
            r#"SELECT pipeline_definition_id, project_group_id, status, run_parameters_json
           FROM pipeline_runs
           WHERE id = ?1"#,
        )
        .bind(source_pipeline_run_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow!("pipeline run not found: {source_pipeline_run_id}"))?;

    if status == "pending" || status == "running" || status == "cancelling" {
        return Err(anyhow!(
            "pipeline run is not in terminal status for retry: {source_pipeline_run_id}, status={status}"
        ));
    }

    let parsed_run_parameters = serde_json::from_str::<Value>(&run_parameters_json)
        .context("parse source pipeline run parameters")?;
    let run_parameters = normalize_run_parameters(parsed_run_parameters)?;

    Ok(PipelineRetrySourceRun {
        pipeline_definition_id,
        project_group_id,
        run_parameters,
    })
}

async fn load_failed_pipeline_project_ids_for_retry(
    pool: &SqlitePool,
    source_pipeline_run_id: i64,
) -> Result<Vec<i64>> {
    let rows = sqlx::query_as::<_, (Option<i64>,)>(
        r#"SELECT managed_project_id
       FROM pipeline_run_projects
       WHERE pipeline_run_id = ?1
         AND status IN ('failed', 'failed_precheck')
       ORDER BY id ASC"#,
    )
    .bind(source_pipeline_run_id)
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
async fn start_pipeline_run_with_projects(
    pool: &SqlitePool,
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    run_parameters: Value,
    max_concurrency_override: Option<i64>,
    source_pipeline_run_id: Option<i64>,
    trigger_kind: &str,
    projects: Vec<ManagedProject>,
) -> Result<i64> {
    let pipeline = db::load_pipeline_definition_for_execution(pool, pipeline_definition_id).await?;
    let gitlab_cfg = load_runtime_gitlab_config(pool).await?;
    let run_parameters = normalize_pipeline_run_parameters(&pipeline.variables, run_parameters)?;

    let max_concurrency = match max_concurrency_override {
        Some(value) if value >= 1 => value,
        Some(value) => {
            return Err(anyhow!(
                "max_concurrency_override must be >= 1, got {value}"
            ))
        }
        None => pipeline.max_concurrency_default,
    };
    if max_concurrency < 1 {
        return Err(anyhow!("pipeline max concurrency must be >= 1"));
    }

    if !pipeline.stages.is_empty() {
        let (stages, rendered_nodes) = render_pipeline_graph_for_run(&pipeline, &run_parameters)?;
        let graph_projects = projects.into_iter().map(Some).collect::<Vec<_>>();
        let (pipeline_run_id, seeded_stages, plans) = seed_pipeline_graph_run(
            pool,
            pipeline.id,
            project_group_id,
            source_pipeline_run_id,
            trigger_kind,
            &run_parameters,
            max_concurrency,
            &stages,
            &rendered_nodes,
            graph_projects,
        )
        .await?;
        let pool_for_task = pool.clone();
        tokio::spawn(async move {
            if let Err(error) = run_pipeline_graph_in_background(
                pool_for_task.clone(),
                pipeline_run_id,
                seeded_stages,
                plans,
                max_concurrency,
                gitlab_cfg,
                HashSet::new(),
                HashMap::new(),
                HashMap::new(),
            )
            .await
            {
                tracing::error!(pipeline_run_id = pipeline_run_id, error = %error, "stage-aware pipeline background execution failed");
                let _ =
                    mark_pipeline_run_finished(&pool_for_task, pipeline_run_id, "partial_failed").await;
            }
        });
        return Ok(pipeline_run_id);
    }

    let rendered_nodes = render_pipeline_nodes_for_run(&pipeline.nodes, &run_parameters)?;
    let (pipeline_run_id, plans) = seed_pipeline_run_and_children(
        pool,
        pipeline.id,
        project_group_id,
        source_pipeline_run_id,
        trigger_kind,
        &run_parameters,
        max_concurrency,
        projects,
        &rendered_nodes,
    )
    .await?;

    if plans.is_empty() {
        mark_pipeline_run_finished(pool, pipeline_run_id, "completed").await?;
        return Ok(pipeline_run_id);
    }

    let pool_for_task = pool.clone();
    tokio::spawn(async move {
        if let Err(error) = run_pipeline_in_background(
            pool_for_task.clone(),
            pipeline_run_id,
            plans,
            max_concurrency,
            gitlab_cfg,
        )
        .await
        {
            tracing::error!(pipeline_run_id = pipeline_run_id, error = %error, "pipeline background execution failed");
            let _ =
                mark_pipeline_run_finished(&pool_for_task, pipeline_run_id, "partial_failed").await;
        }
    });

    Ok(pipeline_run_id)
}

#[allow(clippy::too_many_arguments)]
async fn start_pipeline_run_with_segments(
    pool: &SqlitePool,
    pipeline_definition_id: i64,
    max_concurrency_override: Option<i64>,
    source_pipeline_run_id: Option<i64>,
    trigger_kind: &str,
    run_parameters: Value,
    selected_managed_project_ids: Option<&HashSet<i64>>,
) -> Result<i64> {
    let pipeline = db::load_pipeline_definition_for_execution(pool, pipeline_definition_id).await?;
    let gitlab_cfg = load_runtime_gitlab_config(pool).await?;
    let run_parameters = normalize_pipeline_run_parameters(&pipeline.variables, run_parameters)?;
    let max_concurrency = match max_concurrency_override {
        Some(value) if value >= 1 => value,
        Some(value) => {
            return Err(anyhow!(
                "max_concurrency_override must be >= 1, got {value}"
            ))
        }
        None => pipeline.max_concurrency_default,
    };
    if max_concurrency < 1 {
        return Err(anyhow!("pipeline max concurrency must be >= 1"));
    }

    if !pipeline.stages.is_empty() {
        if selected_managed_project_ids.is_some() {
            return Err(anyhow!(
                "stage-aware graph retry with managed project filtering is not supported yet"
            ));
        }
        let (stages, rendered_nodes) = render_pipeline_graph_for_run(&pipeline, &run_parameters)?;
        let (pipeline_run_id, seeded_stages, plans) = seed_pipeline_graph_run(
            pool,
            pipeline.id,
            None,
            source_pipeline_run_id,
            trigger_kind,
            &run_parameters,
            max_concurrency,
            &stages,
            &rendered_nodes,
            vec![None],
        )
        .await?;
        let pool_for_task = pool.clone();
        tokio::spawn(async move {
            if let Err(error) = run_pipeline_graph_in_background(
                pool_for_task.clone(),
                pipeline_run_id,
                seeded_stages,
                plans,
                max_concurrency,
                gitlab_cfg,
                HashSet::new(),
                HashMap::new(),
                HashMap::new(),
            )
            .await
            {
                tracing::error!(
                    pipeline_run_id = pipeline_run_id,
                    error = %error,
                    "stage-aware pipeline background execution failed"
                );
                let _ = mark_pipeline_run_finished(&pool_for_task, pipeline_run_id, "partial_failed")
                    .await;
            }
        });
        return Ok(pipeline_run_id);
    }

    let rendered_nodes = render_pipeline_nodes_for_run(&pipeline.nodes, &run_parameters)?;
    let mut segments = build_pipeline_segment_seeds(pool, &rendered_nodes).await?;
    if let Some(selected_project_ids) = selected_managed_project_ids {
        segments.retain(|segment| {
            segment
                .project
                .as_ref()
                .map(|project| selected_project_ids.contains(&project.id))
                .unwrap_or(false)
        });
        if segments.is_empty() {
            return Err(anyhow!(
                "pipeline retry resolved to zero project segments after filtering"
            ));
        }
    }

    let (pipeline_run_id, plans) = seed_pipeline_run_for_segments(
        pool,
        pipeline.id,
        None,
        source_pipeline_run_id,
        trigger_kind,
        &run_parameters,
        max_concurrency,
        segments,
    )
    .await?;

    if plans.is_empty() {
        mark_pipeline_run_finished(pool, pipeline_run_id, "completed").await?;
        return Ok(pipeline_run_id);
    }

    let pool_for_task = pool.clone();
    tokio::spawn(async move {
        if let Err(error) = run_pipeline_in_background(
            pool_for_task.clone(),
            pipeline_run_id,
            plans,
            max_concurrency,
            gitlab_cfg,
        )
        .await
        {
            tracing::error!(
                pipeline_run_id = pipeline_run_id,
                error = %error,
                "pipeline background execution failed"
            );
            let _ = mark_pipeline_run_finished(&pool_for_task, pipeline_run_id, "partial_failed")
                .await;
        }
    });

    Ok(pipeline_run_id)
}

pub(crate) async fn execute_pipeline_run(
    pool: &SqlitePool,
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    run_parameters: Value,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
    match project_group_id {
        Some(project_group_id) => {
            let mut projects = db::list_project_group_projects(pool, project_group_id).await?;
            projects.retain(|project| project.enabled);

            start_pipeline_run_with_projects(
                pool,
                pipeline_definition_id,
                Some(project_group_id),
                run_parameters,
                max_concurrency_override,
                None,
                "manual",
                projects,
            )
            .await
        }
        None => start_pipeline_run_with_segments(
            pool,
            pipeline_definition_id,
            max_concurrency_override,
            None,
            "manual",
            run_parameters,
            None,
        )
        .await,
    }
}

pub(crate) async fn execute_scheduled_pipeline_run(
    pool: &SqlitePool,
    pipeline_definition_id: i64,
    project_group_id: Option<i64>,
    run_parameters: Value,
) -> Result<i64> {
    match project_group_id {
        Some(project_group_id) => {
            let mut projects = db::list_project_group_projects(pool, project_group_id).await?;
            projects.retain(|project| project.enabled);

            start_pipeline_run_with_projects(
                pool,
                pipeline_definition_id,
                Some(project_group_id),
                run_parameters,
                None,
                None,
                "schedule",
                projects,
            )
            .await
        }
        None => start_pipeline_run_with_segments(
            pool,
            pipeline_definition_id,
            None,
            None,
            "schedule",
            run_parameters,
            None,
        )
        .await,
    }
}

pub(crate) async fn cancel_pipeline_run(pool: &SqlitePool, pipeline_run_id: i64) -> Result<()> {
    let now = now_rfc3339();
    let res = sqlx::query(
        r#"UPDATE pipeline_runs
       SET status = 'cancelling',
           updated_at = ?1
       WHERE id = ?2 AND status IN ('running', 'pending')"#,
    )
    .bind(&now)
    .bind(pipeline_run_id)
    .execute(pool)
    .await?;

    if res.rows_affected() > 0 {
        return Ok(());
    }

    let status =
        sqlx::query_scalar::<_, String>(r#"SELECT status FROM pipeline_runs WHERE id = ?1"#)
            .bind(pipeline_run_id)
            .fetch_optional(pool)
            .await?;

    match status.as_deref() {
        Some("cancelling") | Some("cancelled") => Ok(()),
        Some("completed") | Some("partial_failed") => {
            Err(anyhow!("pipeline run already finished: {pipeline_run_id}"))
        }
        Some(current) => Err(anyhow!(
            "pipeline run is not cancellable: {pipeline_run_id}, status={current}"
        )),
        None => Err(anyhow!("pipeline run not found: {pipeline_run_id}")),
    }
}

pub(crate) async fn retry_pipeline_run_legacy(
    pool: &SqlitePool,
    source_pipeline_run_id: i64,
    selected_managed_project_ids: Option<Vec<i64>>,
    max_concurrency_override: Option<i64>,
) -> Result<i64> {
    tracing::info!(
        source_pipeline_run_id = source_pipeline_run_id,
        selected_managed_project_ids = ?selected_managed_project_ids,
        "retry_pipeline_run uses current pipeline/project state with source run parameters"
    );

    let source_run = load_pipeline_retry_source_run(pool, source_pipeline_run_id).await?;
    let failed_project_ids =
        load_failed_pipeline_project_ids_for_retry(pool, source_pipeline_run_id).await?;
    if failed_project_ids.is_empty() {
        return Err(anyhow!(
            "pipeline run has no failed projects to retry: {source_pipeline_run_id}"
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

    let retry_project_id_set = retry_project_ids.iter().copied().collect::<HashSet<_>>();
    if source_run.project_group_id.is_none() {
        return start_pipeline_run_with_segments(
            pool,
            source_run.pipeline_definition_id,
            max_concurrency_override,
            Some(source_pipeline_run_id),
            "retry_failed",
            source_run.run_parameters,
            Some(&retry_project_id_set),
        )
        .await;
    }

    let source_project_group_id = source_run
        .project_group_id
        .expect("checked source project group above");
    let mut projects = db::list_project_group_projects(pool, source_project_group_id).await?;
    projects.retain(|project| project.enabled);

    let enabled_project_ids = projects
        .iter()
        .map(|project| project.id)
        .collect::<HashSet<_>>();
    let disabled_failed_ids = retry_project_ids
        .iter()
        .copied()
        .filter(|project_id| !enabled_project_ids.contains(project_id))
        .collect::<Vec<_>>();
    if !disabled_failed_ids.is_empty() {
        return Err(anyhow!(
            "failed managed projects are currently disabled and cannot be retried: {:?}",
            disabled_failed_ids
        ));
    }

    projects.retain(|project| retry_project_id_set.contains(&project.id));
    if projects.is_empty() {
        return Err(anyhow!(
            "pipeline retry resolved to zero enabled projects after filtering"
        ));
    }

    start_pipeline_run_with_projects(
        pool,
        source_run.pipeline_definition_id,
        Some(source_project_group_id),
        source_run.run_parameters,
        max_concurrency_override,
        Some(source_pipeline_run_id),
        "retry_failed",
        projects,
    )
    .await
}

pub(crate) async fn retry_pipeline_run(
    pool: &SqlitePool,
    request: PipelineRunRetryRequest,
) -> Result<i64> {
    let retry_mode = request.retry_mode.as_deref().unwrap_or("");
    if retry_mode.is_empty() && request.selected_managed_project_ids.is_some() {
        return retry_pipeline_run_legacy(
            pool,
            request.source_pipeline_run_id,
            request.selected_managed_project_ids,
            request.max_concurrency_override,
        )
        .await;
    }

    let source_run = load_pipeline_retry_source_run(pool, request.source_pipeline_run_id).await?;
    let merged_run_parameters = match request.run_parameters_override {
        Some(override_value) => {
            let mut merged = source_run.run_parameters.clone();
            let target = merged
                .as_object_mut()
                .ok_or_else(|| anyhow!("source pipeline run parameters must be a JSON object"))?;
            let override_map = normalize_run_parameters(override_value)?
                .as_object()
                .cloned()
                .ok_or_else(|| anyhow!("run_parameters_override must be a JSON object"))?;
            for (key, value) in override_map {
                target.insert(key, value);
            }
            merged
        }
        None => source_run.run_parameters,
    };

    let execution_definition =
        db::load_pipeline_definition_for_execution(pool, source_run.pipeline_definition_id).await?;
    let graph_mode = !execution_definition.stages.is_empty();

    if matches!(retry_mode, "stage" | "node") {
        if !graph_mode {
            return Err(anyhow!("linear pipeline definitions do not support stage/node derived retries"));
        }
        if source_run.project_group_id.is_some() {
            return Err(anyhow!(
                "stage/node derived retries are currently only supported for no-group stage-aware pipeline runs"
            ));
        }

        let source_detail = db::get_pipeline_run_detail(pool, request.source_pipeline_run_id).await?;
        if source_detail.projects.len() != 1 {
            return Err(anyhow!(
                "stage/node derived retries currently require exactly one runtime project lane"
            ));
        }

        let (rendered_stages, rendered_nodes) =
            render_pipeline_graph_for_run(&execution_definition, &merged_run_parameters)?;
        let node_key_by_pipeline_node_id = rendered_nodes
            .iter()
            .map(|node| (node.pipeline_node_id, node.node_key.clone()))
            .collect::<HashMap<_, _>>();
        let source_node_status_by_key = source_detail.projects[0]
            .nodes
            .iter()
            .filter_map(|node| {
                node.pipeline_node_id.and_then(|pipeline_node_id| {
                    node_key_by_pipeline_node_id
                        .get(&pipeline_node_id)
                        .cloned()
                        .map(|node_key| (node_key, node.status.clone()))
                })
            })
            .collect::<HashMap<_, _>>();

        let rerun_node_keys = if retry_mode == "stage" {
            let target_stage_id = request
                .target_stage_id
                .ok_or_else(|| anyhow!("target_stage_id is required for stage retry"))?;
            let target_stage_order = rendered_stages
                .iter()
                .find(|stage| stage.pipeline_stage_id == target_stage_id)
                .map(|stage| stage.stage_order)
                .ok_or_else(|| anyhow!("target stage not found in current pipeline definition"))?;
            rendered_nodes
                .iter()
                .filter(|node| node.stage_order >= target_stage_order)
                .map(|node| node.node_key.clone())
                .collect::<HashSet<_>>()
        } else {
            let target_run_node_id = request
                .target_run_node_id
                .ok_or_else(|| anyhow!("target_run_node_id is required for node retry"))?;
            let target_node_key = source_detail.projects[0]
                .nodes
                .iter()
                .find(|node| node.id == target_run_node_id)
                .and_then(|node| node.pipeline_node_id)
                .and_then(|pipeline_node_id| node_key_by_pipeline_node_id.get(&pipeline_node_id).cloned())
                .ok_or_else(|| anyhow!("target run node not found in current pipeline definition"))?;
            collect_graph_descendants(&rendered_nodes, &target_node_key)
        };

        let reused_node_keys = rendered_nodes
            .iter()
            .filter(|node| !rerun_node_keys.contains(&node.node_key))
            .filter_map(|node| {
                let status = source_node_status_by_key.get(&node.node_key)?;
                (status == "success").then_some(node.node_key.clone())
            })
            .collect::<HashSet<_>>();
        let reused_stage_orders = rendered_stages
            .iter()
            .filter_map(|stage| {
                let stage_node_keys = rendered_nodes
                    .iter()
                    .filter(|node| node.stage_order == stage.stage_order)
                    .map(|node| node.node_key.clone())
                    .collect::<Vec<_>>();
                (!stage_node_keys.is_empty()
                    && stage_node_keys
                        .iter()
                        .all(|node_key| reused_node_keys.contains(node_key)))
                .then_some(stage.stage_order)
            })
            .collect::<HashSet<_>>();

        let gitlab_cfg = load_runtime_gitlab_config(pool).await?;
        let max_concurrency = request
            .max_concurrency_override
            .unwrap_or(execution_definition.max_concurrency_default);
        let (pipeline_run_id, seeded_stages, plans) = seed_pipeline_graph_run(
            pool,
            execution_definition.id,
            None,
            Some(request.source_pipeline_run_id),
            if retry_mode == "stage" {
                "retry_stage"
            } else {
                "retry_node"
            },
            &merged_run_parameters,
            max_concurrency,
            &rendered_stages,
            &rendered_nodes,
            vec![None],
        )
        .await?;

        let plan = plans
            .first()
            .cloned()
            .ok_or_else(|| anyhow!("seeded retry graph plan is missing"))?;
        for stage in &seeded_stages {
            if reused_stage_orders.contains(&stage.stage_order) {
                mark_pipeline_stage_finished(
                    pool,
                    stage.run_stage_id,
                    "reused",
                    "复用上次成功阶段结果",
                )
                .await?;
            }
        }

        let mut initial_node_statuses = HashMap::<(usize, String), String>::new();
        for node_key in &reused_node_keys {
            let node = plan
                .nodes_by_key
                .get(node_key)
                .ok_or_else(|| anyhow!("reused node missing from retry plan: {node_key}"))?;
            mark_pipeline_node_finished(
                pool,
                node.run_node_id,
                "skipped",
                "",
                "",
                None,
                "复用上次成功结果",
                None,
            )
            .await?;
            initial_node_statuses.insert((0, node_key.clone()), "reused".to_string());
        }
        let initial_completed_contexts = derive_reused_graph_contexts(
            pool,
            0,
            &plan,
            &reused_node_keys,
            &PipelineExecutionContextState::empty(),
        )
        .await?;

        let pool_for_task = pool.clone();
        tokio::spawn(async move {
            if let Err(error) = run_pipeline_graph_in_background(
                pool_for_task.clone(),
                pipeline_run_id,
                seeded_stages,
                plans,
                max_concurrency,
                gitlab_cfg,
                reused_stage_orders,
                initial_node_statuses,
                initial_completed_contexts,
            )
            .await
            {
                tracing::error!(
                    pipeline_run_id = pipeline_run_id,
                    error = %error,
                    "stage/node retry background execution failed"
                );
                let _ = mark_pipeline_run_finished(&pool_for_task, pipeline_run_id, "partial_failed")
                    .await;
            }
        });
        return Ok(pipeline_run_id);
    }

    match source_run.project_group_id {
        Some(project_group_id) => {
            let mut projects = db::list_project_group_projects(pool, project_group_id).await?;
            projects.retain(|project| project.enabled);
            start_pipeline_run_with_projects(
                pool,
                source_run.pipeline_definition_id,
                Some(project_group_id),
                merged_run_parameters,
                request.max_concurrency_override,
                Some(request.source_pipeline_run_id),
                "retry_full_run",
                projects,
            )
            .await
        }
        None => start_pipeline_run_with_segments(
            pool,
            source_run.pipeline_definition_id,
            request.max_concurrency_override,
            Some(request.source_pipeline_run_id),
            "retry_full_run",
            merged_run_parameters,
            None,
        )
        .await,
    }
}

#[cfg(test)]
mod tests {
    use super::execute_pipeline_run;
    use crate::db;
    use crate::git_executor::test_support::{make_temp_test_dir, setup_git_repo_with_branches};
    use crate::models::PipelineNodeInput;
    use serial_test::serial;
    use sqlx::{migrate::Migrator, sqlite::SqlitePoolOptions, SqlitePool};
    use std::path::PathBuf;
    use std::str::FromStr;
    use tokio::time::{sleep, Duration};

    static MIGRATOR: Migrator = sqlx::migrate!();

    async fn setup_test_pool() -> SqlitePool {
        let db_path = make_temp_test_dir("pipeline_working_path_db").join("test.sqlite3");
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

    fn create_repo_fixture(root: &PathBuf) -> (PathBuf, PathBuf) {
        let origin_repo = root.join("origin-repo");
        let target_repo = root.join("target-repo");
        setup_git_repo_with_branches(&origin_repo, &["release"]);
        setup_git_repo_with_branches(&target_repo, &["target-only"]);
        (origin_repo, target_repo)
    }

    #[tokio::test]
    #[serial]
    async fn switch_project_pipeline_runtime_runs_without_project_group() {
        let pool = setup_test_pool().await;
        let root = make_temp_test_dir("pipeline_switch_project_root");
        let (origin_repo, _) = create_repo_fixture(&root);

        let managed = db::create_managed_project(
            &pool,
            88010,
            "pipeline-switch-project".to_string(),
            "team/pipeline-switch-project".to_string(),
            origin_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "pipeline-switch-project".to_string(),
            "switch project pipeline runtime red test".to_string(),
            true,
            1,
            vec![],
            vec![
                PipelineNodeInput {
                    node_type: "switch_project".to_string(),
                    parameters: serde_json::json!({ "managedProjectId": managed.id.to_string() }),
                },
                PipelineNodeInput {
                    node_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "release" }),
                },
            ],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(1))
            .await
            .expect("execute pipeline run without project group");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "completed");
        assert_eq!(detail.project_group_id, None);
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].managed_project_id, Some(managed.id));
        assert_eq!(detail.projects[0].status, "success");
        assert_eq!(detail.projects[0].nodes.len(), 2);
        assert_eq!(detail.projects[0].nodes[0].node_type, "switch_project");
        assert_eq!(detail.projects[0].nodes[0].status, "success");
        assert_eq!(detail.projects[0].nodes[1].node_type, "checkout_branch");
        assert_eq!(detail.projects[0].nodes[1].status, "success");
    }

    #[tokio::test]
    #[serial]
    async fn pipeline_runtime_reports_missing_switch_project_in_chinese() {
        let pool = setup_test_pool().await;

        let pipeline = db::create_pipeline_definition(
            &pool,
            "pipeline-missing-switch-project".to_string(),
            "missing switch project runtime red test".to_string(),
            true,
            1,
            vec![],
            vec![PipelineNodeInput {
                node_type: "checkout_branch".to_string(),
                parameters: serde_json::json!({ "branch": "release" }),
            }],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(1))
            .await
            .expect("execute pipeline run without switch_project");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "partial_failed");
        assert_eq!(detail.project_group_id, None);
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].project_name, "未选择项目");
        assert_eq!(detail.projects[0].status, "failed_precheck");
        assert_eq!(detail.projects[0].nodes.len(), 1);
        assert_eq!(detail.projects[0].nodes[0].status, "failed");
        assert_eq!(detail.projects[0].nodes[0].summary_message, "未设置执行路径");
        assert!(
            detail.projects[0].nodes[0]
                .detail_zh
                .as_deref()
                .unwrap_or_default()
                .contains("执行路径")
        );
    }

    #[tokio::test]
    #[serial]
    async fn set_working_path_pipeline_runtime_runs_without_active_project_when_path_is_absolute() {
        let pool = setup_test_pool().await;
        let root = make_temp_test_dir("pipeline_set_working_path_no_project_root");
        let (_, target_repo) = create_repo_fixture(&root);

        let pipeline = db::create_pipeline_definition(
            &pool,
            "pipeline-set-working-path-no-project".to_string(),
            "set working path without active project".to_string(),
            true,
            1,
            vec![],
            vec![PipelineNodeInput {
                node_type: "set_working_path".to_string(),
                parameters: serde_json::json!({ "path": target_repo.to_string_lossy() }),
            }],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(1))
            .await
            .expect("execute pipeline run without active project");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "completed");
        assert_eq!(detail.project_group_id, None);
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].managed_project_id, None);
        assert_eq!(detail.projects[0].project_name, "未选择项目");
        assert_eq!(detail.projects[0].status, "success");
        assert_eq!(detail.projects[0].nodes.len(), 1);
        assert_eq!(detail.projects[0].nodes[0].node_type, "set_working_path");
        assert_eq!(detail.projects[0].nodes[0].status, "success");
    }

    #[tokio::test]
    #[serial]
    async fn working_path_pipeline_runtime_allows_checkout_without_active_project_after_setting_path() {
        let pool = setup_test_pool().await;
        let root = make_temp_test_dir("pipeline_working_path_checkout_without_project_root");
        let (_, target_repo) = create_repo_fixture(&root);

        let pipeline = db::create_pipeline_definition(
            &pool,
            "pipeline-working-path-checkout-no-project".to_string(),
            "working path checkout without active project".to_string(),
            true,
            1,
            vec![],
            vec![
                PipelineNodeInput {
                    node_type: "set_working_path".to_string(),
                    parameters: serde_json::json!({ "path": target_repo.to_string_lossy() }),
                },
                PipelineNodeInput {
                    node_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "target-only" }),
                },
            ],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, None, serde_json::json!({}), Some(1))
            .await
            .expect("execute pipeline run without active project");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "completed");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "success");
        assert_eq!(detail.projects[0].nodes.len(), 2);
        assert_eq!(detail.projects[0].nodes[0].node_type, "set_working_path");
        assert_eq!(detail.projects[0].nodes[0].status, "success");
        assert_eq!(detail.projects[0].nodes[1].node_type, "checkout_branch");
        assert_eq!(detail.projects[0].nodes[1].status, "success");
    }

    #[tokio::test]
    #[serial]
    async fn working_path_pipeline_runtime_switches_following_git_nodes_to_latest_context() {
        let pool = setup_test_pool().await;
        let root = make_temp_test_dir("pipeline_working_path_root");
        let (origin_repo, target_repo) = create_repo_fixture(&root);

        let managed = db::create_managed_project(
            &pool,
            88001,
            "pipeline-working-path-project".to_string(),
            "team/pipeline-working-path-project".to_string(),
            origin_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(&pool, "pipeline-working-path-group".to_string())
            .await
            .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "pipeline-working-path".to_string(),
            "working path pipeline runtime red test".to_string(),
            true,
            1,
            vec![],
            vec![
                PipelineNodeInput {
                    node_type: "set_working_path".to_string(),
                    parameters: serde_json::json!({ "path": target_repo.to_string_lossy() }),
                },
                PipelineNodeInput {
                    node_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "target-only" }),
                },
            ],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, Some(group.id), serde_json::json!({}), Some(1))
            .await
            .expect("execute pipeline run");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.status, "completed");
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "success");
        assert_eq!(detail.projects[0].nodes.len(), 2);
        assert_eq!(detail.projects[0].nodes[0].status, "success");
        assert_eq!(detail.projects[0].nodes[1].status, "success");
    }

    #[tokio::test]
    #[serial]
    async fn working_path_pipeline_runtime_reports_missing_target_path_in_chinese() {
        let pool = setup_test_pool().await;
        let root = make_temp_test_dir("pipeline_working_path_missing_root");
        let (origin_repo, _) = create_repo_fixture(&root);
        let missing_target = root.join("missing-target");

        let managed = db::create_managed_project(
            &pool,
            88002,
            "pipeline-working-path-missing-project".to_string(),
            "team/pipeline-working-path-missing-project".to_string(),
            origin_repo.to_string_lossy().to_string(),
            Some("main".to_string()),
            Some("origin".to_string()),
            true,
        )
        .await
        .expect("create managed project");
        let group = db::create_project_group(
            &pool,
            "pipeline-working-path-missing-group".to_string(),
        )
        .await
        .expect("create project group");
        db::add_projects_to_group(&pool, group.id, vec![managed.id])
            .await
            .expect("add project to group");

        let pipeline = db::create_pipeline_definition(
            &pool,
            "pipeline-working-path-missing".to_string(),
            "working path pipeline invalid path test".to_string(),
            true,
            1,
            vec![],
            vec![
                PipelineNodeInput {
                    node_type: "set_working_path".to_string(),
                    parameters: serde_json::json!({ "path": missing_target.to_string_lossy() }),
                },
                PipelineNodeInput {
                    node_type: "checkout_branch".to_string(),
                    parameters: serde_json::json!({ "branch": "main" }),
                },
            ],
            vec![],
        )
        .await
        .expect("create pipeline definition");

        let run_id = execute_pipeline_run(&pool, pipeline.id, Some(group.id), serde_json::json!({}), Some(1))
            .await
            .expect("execute pipeline run");

        let detail = wait_for_terminal_pipeline_run_status(&pool, run_id, 15_000).await;
        assert_eq!(detail.projects.len(), 1);
        assert_eq!(detail.projects[0].status, "failed_precheck");
        assert_eq!(detail.projects[0].nodes.len(), 2);
        assert_eq!(detail.projects[0].nodes[0].status, "failed");
        assert_eq!(detail.projects[0].nodes[1].status, "skipped");
        assert!(
            detail.projects[0].nodes[0]
                .summary_message
                .contains("路径")
        );
        assert!(
            detail.projects[0].nodes[0]
                .title_zh
                .as_deref()
                .unwrap_or("")
                .contains("路径")
        );
    }
}
