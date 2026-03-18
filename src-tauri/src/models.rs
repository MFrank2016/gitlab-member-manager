use serde::{Deserialize, Serialize};
use serde_json::Value;

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
