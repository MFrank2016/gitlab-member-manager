use crate::models::{ProjectMember, ProjectSummary};
use anyhow::{anyhow, Context, Result};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json;

#[derive(Debug, Clone)]
pub struct GitLabConfig {
  pub base_url: String,
  pub token: String,
}

fn normalize_base_url(base_url: &str) -> String {
  base_url.trim_end_matches('/').to_string()
}

fn api_url(base_url: &str, path: &str) -> String {
  format!("{}{}", normalize_base_url(base_url), path)
}

fn encode_project(project: &str) -> String {
  if project.chars().all(|c| c.is_ascii_digit()) {
    project.to_string()
  } else {
    urlencoding::encode(project).into_owned()
  }
}

fn client() -> reqwest::Client {
  reqwest::Client::builder()
    .user_agent("gitlab-member-manager/0.1")
    .build()
    .expect("reqwest client")
}

#[derive(Debug, Deserialize)]
struct ApiNamespace {
  full_path: Option<String>,
  name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiProject {
  id: u64,
  name: String,
  path_with_namespace: String,
  description: Option<String>,
  last_activity_at: String,
  namespace: Option<ApiNamespace>,
}

#[derive(Debug, Deserialize)]
struct ApiMember {
  id: u64,
  username: String,
  name: String,
  avatar_url: Option<String>,
  access_level: i64,
  created_at: Option<String>,
  expires_at: Option<String>,
}

pub async fn search_projects(cfg: &GitLabConfig, keyword: &str) -> Result<Vec<ProjectSummary>> {
  let keyword = keyword.trim();
  if keyword.is_empty() {
    tracing::debug!("[gitlab] search_projects: keyword is empty, returning empty list");
    return Ok(Vec::new());
  }

  let url = api_url(&cfg.base_url, "/api/v4/projects");
  let http = client();

  // 调试：打印 base_url 和 token（token 只显示前8位和长度）
  let token_preview = if cfg.token.len() > 8 {
    format!("{}...({} chars)", &cfg.token[..8], cfg.token.len())
  } else {
    format!("{}({} chars)", &cfg.token, cfg.token.len())
  };
  tracing::info!(
    base_url = %cfg.base_url,
    token = %token_preview,
    url = %url,
    keyword = %keyword,
    "[gitlab] GET /api/v4/projects"
  );

  // Keep it small; this is for typeahead/quick search.
  let resp = http
    .get(&url)
    .header("PRIVATE-TOKEN", &cfg.token)
    .query(&[
      ("search", keyword),
      ("simple", "true"),
      ("per_page", "50"),
      ("order_by", "last_activity_at"),
      ("sort", "desc"),
    ])
    .send()
    .await
    .context("GitLab request failed")?;

  let status = resp.status();
  tracing::info!(status = %status, "[gitlab] response received");

  // 先获取响应文本，打印完整报文用于调试
  let text = resp.text().await.unwrap_or_default();
  tracing::info!(body = %text, "[gitlab] response body");

  if !status.is_success() {
    tracing::error!(status = %status, body = %text, "[gitlab] API error");
    return Err(anyhow!("GitLab API error {status}: {text}"));
  }

  // 从文本解析 JSON
  let projects: Vec<ApiProject> = serde_json::from_str(&text).context("Parse JSON")?;
  tracing::debug!(count = projects.len(), "[gitlab] parsed projects");
  
  Ok(
    projects
      .into_iter()
      .map(|p| {
        let namespace = p
          .namespace
          .and_then(|n| n.full_path.or(n.name))
          .unwrap_or_else(|| {
            p.path_with_namespace
              .rsplit_once('/')
              .map(|x| x.0.to_string())
              .unwrap_or_else(|| p.path_with_namespace.clone())
          });

        ProjectSummary {
          id: p.id,
          name: p.name,
          namespace,
          path_with_namespace: p.path_with_namespace,
          description: p.description,
          last_activity_at: p.last_activity_at,
        }
      })
      .collect(),
  )
}

pub async fn list_project_members(cfg: &GitLabConfig, project: &str) -> Result<Vec<ProjectMember>> {
  let project = encode_project(project.trim());
  let http = client();

  let mut all: Vec<ProjectMember> = Vec::new();
  let mut page: i64 = 1;

  tracing::info!(project = %project, "[gitlab] listing project members");

  loop {
    let url = api_url(
      &cfg.base_url,
      &format!("/api/v4/projects/{}/members/all", project),
    );

    tracing::debug!(url = %url, page = page, "[gitlab] GET members page");

    let resp = http
      .get(&url)
      .header("PRIVATE-TOKEN", &cfg.token)
      .query(&[("per_page", "100"), ("page", &page.to_string())])
      .send()
      .await
      .context("GitLab request failed")?;

    let status = resp.status();
    tracing::debug!(status = %status, page = page, "[gitlab] response received");

    if !status.is_success() {
      let text = resp.text().await.unwrap_or_default();
      tracing::error!(status = %status, body = %text, "[gitlab] API error");
      return Err(anyhow!("GitLab API error {status}: {text}"));
    }

    let members: Vec<ApiMember> = resp.json().await.context("Parse JSON")?;

    let count = members.len();
    tracing::debug!(page = page, count = count, "[gitlab] parsed members");
    
    all.extend(members.into_iter().map(|m| ProjectMember {
      id: m.id,
      username: m.username,
      name: m.name,
      avatar_url: m.avatar_url,
      access_level: m.access_level,
      created_at: m.created_at,
      expires_at: m.expires_at,
    }));

    if count < 100 {
      break;
    }
    page += 1;
  }

  tracing::info!(total_count = all.len(), "[gitlab] list_project_members completed");
  Ok(all)
}

pub async fn add_member(
  cfg: &GitLabConfig,
  project: &str,
  user_id: u64,
  access_level: i64,
  expires_at: Option<String>,
) -> Result<()> {
  let project = encode_project(project.trim());
  let url = api_url(
    &cfg.base_url,
    &format!("/api/v4/projects/{}/members", project),
  );
  let http = client();

  tracing::info!(
    url = %url,
    user_id = user_id,
    access_level = access_level,
    expires_at = ?expires_at,
    "[gitlab] POST add member"
  );

  let mut params: Vec<(&str, String)> = vec![
    ("user_id", user_id.to_string()),
    ("access_level", access_level.to_string()),
  ];
  if let Some(expires_at) = expires_at {
    if !expires_at.trim().is_empty() {
      params.push(("expires_at", expires_at));
    }
  }

  let resp = http
    .post(&url)
    .header("PRIVATE-TOKEN", &cfg.token)
    .form(&params)
    .send()
    .await
    .context("GitLab request failed")?;

  let status = resp.status();
  tracing::info!(status = %status, "[gitlab] add_member response");

  if status.is_success() {
    tracing::info!(user_id = user_id, "[gitlab] add_member success");
    return Ok(());
  }

  let text = resp.text().await.unwrap_or_default();
  tracing::warn!(status = %status, body = %text, "[gitlab] add_member failed");

  match status {
    StatusCode::CONFLICT => Err(anyhow!("already a member")),
    _ => Err(anyhow!("GitLab API error {status}: {text}")),
  }
}

pub async fn remove_member(cfg: &GitLabConfig, project: &str, user_id: u64) -> Result<()> {
  let project = encode_project(project.trim());
  let url = api_url(
    &cfg.base_url,
    &format!("/api/v4/projects/{}/members/{}", project, user_id),
  );
  let http = client();

  tracing::info!(
    url = %url,
    user_id = user_id,
    "[gitlab] DELETE remove member"
  );

  let resp = http
    .delete(&url)
    .header("PRIVATE-TOKEN", &cfg.token)
    .send()
    .await
    .context("GitLab request failed")?;

  let status = resp.status();
  tracing::info!(status = %status, "[gitlab] remove_member response");

  if status.is_success() {
    tracing::info!(user_id = user_id, "[gitlab] remove_member success");
    return Ok(());
  }

  if status == StatusCode::NOT_FOUND {
    // Not a member -> treat as success.
    tracing::info!(user_id = user_id, "[gitlab] user not found, treating as success");
    return Ok(());
  }

  let text = resp.text().await.unwrap_or_default();
  tracing::warn!(status = %status, body = %text, "[gitlab] remove_member failed");
  Err(anyhow!("GitLab API error {status}: {text}"))
}
