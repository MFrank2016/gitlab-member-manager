use serde::{Deserialize, Serialize};
use serde_json::Value;

fn bool_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(alias = "base_url")]
    pub base_url: String,
    pub token: String,
    #[serde(alias = "local_repo_root", default)]
    pub local_repo_root: Option<String>,
    #[serde(alias = "default_branch", default)]
    pub default_branch: Option<String>,
    #[serde(alias = "default_remote", default)]
    pub default_remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: u64,
    pub name: String,
    pub namespace: String,
    pub path_with_namespace: String,
    pub description: Option<String>,
    pub last_activity_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMember {
    pub id: u64,
    pub username: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub access_level: i64,
    pub created_at: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMemberUpsert {
    pub user_id: u64,
    pub username: String,
    pub name: String,
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub project_id: Option<u64>,
    #[serde(default)]
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMember {
    pub user_id: u64,
    pub username: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub project_id: Option<u64>,
    #[serde(default)]
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGroup {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub members_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemError {
    pub user_id: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub success_user_ids: Vec<u64>,
    pub failed: Vec<BatchItemError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProject {
    pub id: i64,
    pub gitlab_project_id: u64,
    pub name: String,
    pub path_with_namespace: String,
    pub repo_path: String,
    pub default_branch: String,
    pub default_remote: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGroup {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub projects_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepInput {
    #[serde(alias = "step_type")]
    pub step_type: String,
    #[serde(default)]
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineVariableInput {
    pub key: String,
    pub label: String,
    pub default_value: Option<String>,
    pub value_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineVariable {
    pub variable_order: i64,
    pub key: String,
    pub label: String,
    pub default_value: Option<String>,
    pub value_type: String,
    pub required: bool,
    pub options: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineNodeInput {
    #[serde(alias = "node_type")]
    pub node_type: String,
    #[serde(default)]
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineNode {
    pub node_order: i64,
    pub node_type: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineScheduleInput {
    #[serde(alias = "cron_expr")]
    pub cron_expr: String,
    pub timezone: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default = "bool_true")]
    pub enabled: bool,
    pub policy: String,
    #[serde(default)]
    pub variables: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineSchedule {
    pub schedule_order: i64,
    pub cron_expr: String,
    pub timezone: String,
    pub branch: Option<String>,
    pub enabled: bool,
    pub policy: String,
    pub variables: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineDefinitionListItem {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub max_concurrency_default: i64,
    pub legacy_workflow_definition_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub variables_count: i64,
    pub nodes_count: i64,
    pub schedules_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineDefinitionDetail {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub max_concurrency_default: i64,
    pub legacy_workflow_definition_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub variables: Vec<PipelineVariable>,
    pub nodes: Vec<PipelineNode>,
    pub schedules: Vec<PipelineSchedule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunListItem {
    pub id: i64,
    pub pipeline_definition_id: i64,
    pub pipeline_definition_name: String,
    pub project_group_id: i64,
    pub project_group_name: String,
    pub legacy_workflow_run_id: Option<i64>,
    pub source_pipeline_run_id: Option<i64>,
    pub trigger_kind: String,
    pub status: String,
    pub run_parameters: Value,
    pub max_concurrency: i64,
    pub projects_total: i64,
    pub projects_queued: i64,
    pub projects_running: i64,
    pub projects_success: i64,
    pub projects_failed: i64,
    pub projects_cancelled: i64,
    pub projects_failed_precheck: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunNode {
    pub id: i64,
    pub pipeline_node_id: Option<i64>,
    pub node_order: i64,
    pub node_type: String,
    pub rendered_parameters: Value,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i64>,
    pub summary_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunProject {
    pub id: i64,
    pub managed_project_id: Option<i64>,
    pub gitlab_project_id: u64,
    pub project_name: String,
    pub project_path_with_namespace: String,
    pub repo_path: String,
    pub status: String,
    pub summary_message: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub nodes: Vec<PipelineRunNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunDetail {
    pub id: i64,
    pub pipeline_definition_id: i64,
    pub pipeline_definition_name: String,
    pub project_group_id: i64,
    pub project_group_name: String,
    pub legacy_workflow_run_id: Option<i64>,
    pub source_pipeline_run_id: Option<i64>,
    pub trigger_kind: String,
    pub status: String,
    pub run_parameters: Value,
    pub max_concurrency: i64,
    pub projects_total: i64,
    pub projects_queued: i64,
    pub projects_running: i64,
    pub projects_success: i64,
    pub projects_failed: i64,
    pub projects_cancelled: i64,
    pub projects_failed_precheck: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub projects: Vec<PipelineRunProject>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineMigrationSummary {
    pub definitions_migrated: i64,
    pub variables_migrated: i64,
    pub nodes_migrated: i64,
    pub runs_migrated: i64,
    pub run_projects_migrated: i64,
    pub run_nodes_migrated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub step_order: i64,
    pub step_type: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinitionListItem {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub variables_schema: Value,
    pub max_concurrency_default: i64,
    pub created_at: String,
    pub updated_at: String,
    pub steps_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinitionDetail {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub variables_schema: Value,
    pub max_concurrency_default: i64,
    pub created_at: String,
    pub updated_at: String,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunStep {
    pub id: i64,
    pub workflow_step_id: Option<i64>,
    pub step_order: i64,
    pub step_type: String,
    pub rendered_parameters: Value,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i64>,
    pub summary_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunProject {
    pub id: i64,
    pub managed_project_id: Option<i64>,
    pub gitlab_project_id: u64,
    pub project_name: String,
    pub project_path_with_namespace: String,
    pub repo_path: String,
    pub status: String,
    pub summary_message: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub steps: Vec<WorkflowRunStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunListItem {
    pub id: i64,
    pub workflow_definition_id: i64,
    pub workflow_definition_name: String,
    pub project_group_id: i64,
    pub project_group_name: String,
    pub source_workflow_run_id: Option<i64>,
    pub trigger_kind: String,
    pub status: String,
    pub run_parameters: Value,
    pub max_concurrency: i64,
    pub projects_total: i64,
    pub projects_queued: i64,
    pub projects_running: i64,
    pub projects_success: i64,
    pub projects_failed: i64,
    pub projects_cancelled: i64,
    pub projects_failed_precheck: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunDetail {
    pub id: i64,
    pub workflow_definition_id: i64,
    pub workflow_definition_name: String,
    pub project_group_id: i64,
    pub project_group_name: String,
    pub source_workflow_run_id: Option<i64>,
    pub trigger_kind: String,
    pub status: String,
    pub run_parameters: Value,
    pub max_concurrency: i64,
    pub projects_total: i64,
    pub projects_queued: i64,
    pub projects_running: i64,
    pub projects_success: i64,
    pub projects_failed: i64,
    pub projects_cancelled: i64,
    pub projects_failed_precheck: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub projects: Vec<WorkflowRunProject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunExecuteRequest {
    pub workflow_definition_id: i64,
    pub project_group_id: i64,
    #[serde(default)]
    pub run_parameters: Value,
    #[serde(default)]
    pub max_concurrency_override: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunExecuteResult {
    pub workflow_run_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunRetryFailedRequest {
    pub source_workflow_run_id: i64,
    #[serde(default)]
    pub selected_managed_project_ids: Option<Vec<i64>>,
    #[serde(default)]
    pub max_concurrency_override: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGroupMemberSyncRow {
    pub managed_project_id: i64,
    pub gitlab_project_id: u64,
    pub project_name: String,
    pub project_path_with_namespace: String,
    pub attempted_user_ids: Vec<u64>,
    pub success_user_ids: Vec<u64>,
    pub failed: Vec<BatchItemError>,
    pub success: bool,
}
