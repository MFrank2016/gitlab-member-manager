use crate::models::{
    BatchItemError, ManagedProject, ProjectGroupMemberSyncRow, ProjectMember, ProjectSummary,
};
use anyhow::{anyhow, Context, Result};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json;
use std::future::Future;

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

/// 分页搜索项目。返回 (项目列表, 总条数)。总条数来自响应头 X-Total，若缺失则用本页数量估算。
pub async fn search_projects(
    cfg: &GitLabConfig,
    keyword: &str,
    page: u32,
    per_page: u32,
) -> Result<(Vec<ProjectSummary>, u64)> {
    let page = page.max(1);
    let per_page = per_page.clamp(1, 100);
    let keyword = keyword.trim();
    let url = api_url(&cfg.base_url, "/api/v4/projects");
    let http = client();

    tracing::info!(
        base_url = %cfg.base_url,
        url = %url,
        keyword = %keyword,
        page = page,
        per_page = per_page,
        "[gitlab] GET /api/v4/projects"
    );

    let resp = http
        .get(&url)
        .header("PRIVATE-TOKEN", &cfg.token)
        .query(&[
            ("search", keyword),
            ("simple", "true"),
            ("per_page", per_page.to_string().as_str()),
            ("page", page.to_string().as_str()),
            ("order_by", "last_activity_at"),
            ("sort", "desc"),
        ])
        .send()
        .await
        .context("GitLab request failed")?;

    let status = resp.status();
    let total: u64 = resp
        .headers()
        .get("x-total")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let text = resp.text().await.unwrap_or_default();
    tracing::debug!(status = %status, total = total, "[gitlab] response received");

    if !status.is_success() {
        tracing::error!(status = %status, body = %text, "[gitlab] API error");
        return Err(anyhow!("GitLab API error {status}: {text}"));
    }

    let projects: Vec<ApiProject> = serde_json::from_str(&text).context("Parse JSON")?;
    tracing::debug!(count = projects.len(), "[gitlab] parsed projects");

    let items: Vec<ProjectSummary> = projects
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
        .collect();

    // 若接口未返回 X-Total，用「本页满页则可能还有下一页」的启发式
    let page_u64 = u64::from(page);
    let per_page_u64 = u64::from(per_page);
    let items_len_u64 = items.len() as u64;
    let offset_u64 = page_u64.saturating_sub(1).saturating_mul(per_page_u64);
    let total_resolved = if total > 0 {
        total
    } else if items.len() as u32 >= per_page {
        offset_u64.saturating_add(items_len_u64).saturating_add(1)
    } else {
        offset_u64.saturating_add(items_len_u64)
    };

    Ok((items, total_resolved))
}

/// 分页获取项目成员。返回 (成员列表, 总条数)。总条数来自响应头 X-Total。
pub async fn list_project_members(
    cfg: &GitLabConfig,
    project: &str,
    page: u32,
    per_page: u32,
) -> Result<(Vec<ProjectMember>, u64)> {
    let page = page.max(1);
    let per_page = per_page.clamp(1, 100);
    let project = encode_project(project.trim());
    let http = client();
    let url = api_url(
        &cfg.base_url,
        &format!("/api/v4/projects/{}/members/all", project),
    );

    tracing::info!(project = %project, page = page, per_page = per_page, "[gitlab] GET project members");

    let resp = http
        .get(&url)
        .header("PRIVATE-TOKEN", &cfg.token)
        .query(&[
            ("per_page", per_page.to_string().as_str()),
            ("page", page.to_string().as_str()),
        ])
        .send()
        .await
        .context("GitLab request failed")?;

    let status = resp.status();
    let total: u64 = resp
        .headers()
        .get("x-total")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!(status = %status, body = %text, "[gitlab] API error");
        return Err(anyhow!("GitLab API error {status}: {text}"));
    }

    let members: Vec<ApiMember> = resp.json().await.context("Parse JSON")?;
    tracing::debug!(
        page = page,
        count = members.len(),
        total = total,
        "[gitlab] parsed members"
    );

    let items: Vec<ProjectMember> = members
        .into_iter()
        .map(|m| ProjectMember {
            id: m.id,
            username: m.username,
            name: m.name,
            avatar_url: m.avatar_url,
            access_level: m.access_level,
            created_at: m.created_at,
            expires_at: m.expires_at,
        })
        .collect();

    let page_u64 = u64::from(page);
    let per_page_u64 = u64::from(per_page);
    let items_len_u64 = items.len() as u64;
    let offset_u64 = page_u64.saturating_sub(1).saturating_mul(per_page_u64);
    let total_resolved = if total > 0 {
        total
    } else if items.len() as u32 >= per_page {
        offset_u64.saturating_add(items_len_u64).saturating_add(1)
    } else {
        offset_u64.saturating_add(items_len_u64)
    };

    Ok((items, total_resolved))
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

    // GitLab 在成员已存在时返回 409，需视作成功
    if status == StatusCode::CONFLICT {
        tracing::info!(
            user_id = user_id,
            "[gitlab] member already exists, treating as success"
        );
        return Ok(());
    }

    let text = resp.text().await.unwrap_or_default();
    tracing::warn!(status = %status, body = %text, "[gitlab] add_member failed");

    Err(anyhow!("GitLab API error {status}: {text}"))
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
        tracing::info!(
            user_id = user_id,
            "[gitlab] user not found, treating as success"
        );
        return Ok(());
    }

    let text = resp.text().await.unwrap_or_default();
    tracing::warn!(status = %status, body = %text, "[gitlab] remove_member failed");
    Err(anyhow!("GitLab API error {status}: {text}"))
}

async fn sync_members_for_managed_project_with<F, Fut>(
    project: &ManagedProject,
    user_ids: &[u64],
    access_level: i64,
    expires_at: Option<String>,
    mut add_member_fn: F,
) -> ProjectGroupMemberSyncRow
where
    F: FnMut(u64, i64, Option<String>) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    let mut success_user_ids = Vec::new();
    let mut failed = Vec::new();

    for user_id in user_ids {
        match add_member_fn(*user_id, access_level, expires_at.clone()).await {
            Ok(_) => success_user_ids.push(*user_id),
            Err(error) => {
                failed.push(BatchItemError {
                    user_id: *user_id,
                    message: error.to_string(),
                });
            }
        }
    }

    ProjectGroupMemberSyncRow {
        managed_project_id: project.id,
        gitlab_project_id: project.gitlab_project_id,
        project_name: project.name.clone(),
        project_path_with_namespace: project.path_with_namespace.clone(),
        attempted_user_ids: user_ids.to_vec(),
        success_user_ids,
        success: failed.is_empty(),
        failed,
    }
}

pub async fn sync_members_for_managed_project(
    cfg: &GitLabConfig,
    project: &ManagedProject,
    user_ids: &[u64],
    access_level: i64,
    expires_at: Option<String>,
) -> ProjectGroupMemberSyncRow {
    sync_members_for_managed_project_with(
        project,
        user_ids,
        access_level,
        expires_at,
        |user_id, access_level, expires_at| async move {
            add_member(
                cfg,
                &project.gitlab_project_id.to_string(),
                user_id,
                access_level,
                expires_at,
            )
            .await
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ManagedProject;
    use anyhow::anyhow;

    fn sample_project() -> ManagedProject {
        ManagedProject {
            id: 12,
            gitlab_project_id: 3456,
            name: "sample-project".to_string(),
            path_with_namespace: "org/sample-project".to_string(),
            repo_path: "D:/repos/sample-project".to_string(),
            default_branch: "main".to_string(),
            default_remote: "origin".to_string(),
            enabled: true,
            created_at: "2026-03-18T00:00:00Z".to_string(),
            updated_at: "2026-03-18T00:00:00Z".to_string(),
        }
    }

    #[tokio::test]
    async fn member_sync_project_row_collects_per_user_failures() {
        let project = sample_project();

        let row = sync_members_for_managed_project_with(
            &project,
            &[1001, 1002, 1003],
            30,
            Some("2026-12-31".to_string()),
            |user_id, _access_level, _expires_at| async move {
                if user_id == 1002 {
                    Err(anyhow!("simulated gitlab failure"))
                } else {
                    Ok(())
                }
            },
        )
        .await;

        assert_eq!(row.managed_project_id, 12);
        assert_eq!(row.gitlab_project_id, 3456);
        assert_eq!(row.attempted_user_ids, vec![1001, 1002, 1003]);
        assert_eq!(row.success_user_ids, vec![1001, 1003]);
        assert_eq!(row.failed.len(), 1);
        assert_eq!(row.failed[0].user_id, 1002);
        assert!(row.failed[0].message.contains("simulated gitlab failure"));
        assert!(!row.success);
    }
}
