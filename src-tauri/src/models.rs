use serde::{Deserialize, Serialize};

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
