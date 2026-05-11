use crate::models::{
    BatchItemError, ManagedProject, ProjectGroupMemberSyncRow, ProjectMember, ProjectSummary,
};
use anyhow::{anyhow, Context, Result};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json;
use std::fmt;
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

#[derive(Debug, Deserialize)]
struct ApiPipeline {
    id: u64,
    status: String,
    #[serde(rename = "ref")]
    ref_name: String,
    sha: Option<String>,
    web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GitLabPipeline {
    pub id: u64,
    pub status: String,
    pub ref_name: String,
    pub sha: Option<String>,
    pub web_url: Option<String>,
}

fn map_api_pipeline(pipeline: ApiPipeline) -> GitLabPipeline {
    GitLabPipeline {
        id: pipeline.id,
        status: pipeline.status,
        ref_name: pipeline.ref_name,
        sha: pipeline.sha,
        web_url: pipeline.web_url,
    }
}

pub async fn check_pipeline(
    cfg: &GitLabConfig,
    project: &str,
    reference: &str,
    sha: Option<&str>,
) -> Result<Option<GitLabPipeline>> {
    let project = encode_project(project.trim());
    let url = api_url(
        &cfg.base_url,
        &format!("/api/v4/projects/{}/pipelines", project),
    );
    let mut query = vec![
        ("ref".to_string(), reference.trim().to_string()),
        ("per_page".to_string(), "1".to_string()),
    ];
    if let Some(sha) = sha {
        query.push(("sha".to_string(), sha.trim().to_string()));
    }

    let resp = client()
        .get(&url)
        .header("PRIVATE-TOKEN", &cfg.token)
        .query(&query)
        .send()
        .await
        .context("GitLab request failed")?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("GitLab API error {status}: {text}"));
    }

    let pipelines: Vec<ApiPipeline> = serde_json::from_str(&text).context("Parse JSON")?;
    Ok(pipelines.into_iter().next().map(map_api_pipeline))
}

pub async fn wait_pipeline(
    cfg: &GitLabConfig,
    project: &str,
    reference: &str,
    sha: Option<&str>,
    timeout: std::time::Duration,
    poll_interval: std::time::Duration,
) -> Result<GitLabPipeline> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let pipeline = check_pipeline(cfg, project, reference, sha).await?;
        match pipeline {
            Some(pipeline)
                if matches!(
                    pipeline.status.as_str(),
                    "success" | "failed" | "canceled" | "cancelled" | "skipped"
                ) =>
            {
                return Ok(pipeline);
            }
            Some(_) | None => {
                if std::time::Instant::now() >= deadline {
                    return Err(anyhow!(
                        "GitLab pipeline wait timed out for project={}, ref={}, sha={:?}",
                        project,
                        reference,
                        sha
                    ));
                }
                tokio::time::sleep(poll_interval).await;
            }
        }
    }
}

pub async fn trigger_pipeline(
    cfg: &GitLabConfig,
    project: &str,
    reference: &str,
    variables: &[(String, String)],
) -> Result<GitLabPipeline> {
    let project = encode_project(project.trim());
    let url = api_url(
        &cfg.base_url,
        &format!("/api/v4/projects/{}/pipeline", project),
    );

    let mut params = vec![("ref".to_string(), reference.trim().to_string())];
    for (key, value) in variables {
        params.push((format!("variables[{key}]"), value.clone()));
    }

    let resp = client()
        .post(&url)
        .header("PRIVATE-TOKEN", &cfg.token)
        .form(&params)
        .send()
        .await
        .context("GitLab request failed")?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("GitLab API error {status}: {text}"));
    }

    let pipeline: ApiPipeline = serde_json::from_str(&text).context("Parse JSON")?;
    Ok(map_api_pipeline(pipeline))
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
    username: Option<&str>,
    access_level: i64,
    expires_at: Option<String>,
) -> Result<()> {
    let normalized_username = username.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    match add_member_once(
        cfg,
        project,
        "user_id",
        user_id.to_string(),
        access_level,
        expires_at.clone(),
    )
    .await
    {
        Ok(()) => Ok(()),
        Err(first_error) => {
            if should_retry_add_member_with_username(&first_error, normalized_username.as_deref()) {
                let retry_username = normalized_username.expect("validated username for retry");
                tracing::warn!(
                    user_id = user_id,
                    username = %retry_username,
                    status = %first_error.status,
                    body = %first_error.body,
                    "[gitlab] add_member retrying with username after user_id rejection"
                );

                return add_member_once(
                    cfg,
                    project,
                    "username",
                    retry_username,
                    access_level,
                    expires_at,
                )
                .await
                .map_err(|error| anyhow!(error.to_string()));
            }

            Err(anyhow!(first_error.to_string()))
        }
    }
}

#[derive(Debug)]
struct AddMemberApiError {
    status: StatusCode,
    body: String,
}

impl fmt::Display for AddMemberApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "GitLab API error {}: {}", self.status, self.body)
    }
}

fn should_retry_add_member_with_username(
    error: &AddMemberApiError,
    username: Option<&str>,
) -> bool {
    username.is_some()
        && matches!(
            error.status,
            StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND | StatusCode::UNPROCESSABLE_ENTITY
        )
        && error.body.to_ascii_lowercase().contains("does not exist")
}

async fn add_member_once(
    cfg: &GitLabConfig,
    project: &str,
    identity_key: &str,
    identity_value: String,
    access_level: i64,
    expires_at: Option<String>,
) -> std::result::Result<(), AddMemberApiError> {
    let project = encode_project(project.trim());
    let url = api_url(
        &cfg.base_url,
        &format!("/api/v4/projects/{}/members", project),
    );
    let http = client();

    tracing::info!(
      url = %url,
      identity_key = identity_key,
      identity_value = %identity_value,
      access_level = access_level,
      expires_at = ?expires_at,
      "[gitlab] POST add member"
    );

    let mut params: Vec<(&str, String)> = vec![
        (identity_key, identity_value.clone()),
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
        .map_err(|error| AddMemberApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            body: format!("GitLab request failed: {error}"),
        })?;

    let status = resp.status();
    tracing::info!(status = %status, "[gitlab] add_member response");

    if status.is_success() {
        tracing::info!(
            identity_key = identity_key,
            identity_value = %identity_value,
            "[gitlab] add_member success"
        );
        return Ok(());
    }

    // GitLab 在成员已存在时返回 409，需视作成功
    if status == StatusCode::CONFLICT {
        tracing::info!(
            identity_key = identity_key,
            identity_value = %identity_value,
            "[gitlab] member already exists, treating as success"
        );
        return Ok(());
    }

    let text = resp.text().await.unwrap_or_default();
    tracing::warn!(status = %status, body = %text, "[gitlab] add_member failed");

    Err(AddMemberApiError { status, body: text })
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
                None,
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
    use std::collections::VecDeque;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::Mutex as TokioMutex;

    #[derive(Debug, Clone)]
    struct TestHttpResponse {
        status_line: &'static str,
        body: String,
        extra_headers: Vec<(&'static str, String)>,
        delay_ms: u64,
    }

    #[derive(Debug, Clone)]
    struct CapturedRequest {
        method: String,
        path: String,
        body: String,
    }

    async fn spawn_gitlab_test_server(
        responses: Vec<TestHttpResponse>,
    ) -> (GitLabConfig, Arc<TokioMutex<Vec<CapturedRequest>>>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind gitlab test server");
        let addr = listener.local_addr().expect("read local addr");
        let requests = Arc::new(TokioMutex::new(Vec::<CapturedRequest>::new()));
        let response_queue = Arc::new(TokioMutex::new(VecDeque::from(responses)));
        let requests_for_task = Arc::clone(&requests);
        let responses_for_task = Arc::clone(&response_queue);

        tokio::spawn(async move {
            loop {
                let (mut stream, _) = match listener.accept().await {
                    Ok(value) => value,
                    Err(_) => break,
                };

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

                let request_text = String::from_utf8_lossy(&raw).to_string();
                let header_end = request_text.find("\r\n\r\n").unwrap_or(request_text.len());
                let header_text = &request_text[..header_end];
                let body = if header_end + 4 <= request_text.len() {
                    request_text[header_end + 4..].to_string()
                } else {
                    String::new()
                };
                let request_line = header_text.lines().next().unwrap_or_default();
                let mut request_parts = request_line.split_whitespace();
                let method = request_parts.next().unwrap_or_default().to_string();
                let path = request_parts.next().unwrap_or_default().to_string();
                requests_for_task
                    .lock()
                    .await
                    .push(CapturedRequest { method, path, body });

                let response =
                    responses_for_task
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
                    tokio::time::sleep(std::time::Duration::from_millis(response.delay_ms)).await;
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

                if stream.write_all(response_text.as_bytes()).await.is_err() {
                    break;
                }
            }
        });

        (
            GitLabConfig {
                base_url: format!("http://{}", addr),
                token: "test-token".to_string(),
            },
            requests,
        )
    }

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

    #[tokio::test]
    async fn add_member_retries_with_username_when_user_id_is_rejected() {
        let (cfg, requests) = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "400 Bad Request",
                body: r#"{"message":"User 20065= does not exist!"}"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "201 Created",
                body: "{}".to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
        ])
        .await;

        add_member(&cfg, "3456", 20065, Some("alice"), 30, None)
            .await
            .expect("retry add member with username");

        let captured = requests.lock().await;
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].method, "POST");
        assert!(captured[0].path.contains("/api/v4/projects/3456/members"));
        assert!(captured[0].body.contains("user_id=20065"));
        assert!(captured[1].body.contains("username=alice"));
        assert!(!captured[1].body.contains("user_id="));
    }

    #[tokio::test]
    async fn pipeline_gitlab_check_pipeline_uses_commit_specific_lookup_when_sha_present() {
        let (cfg, requests) = spawn_gitlab_test_server(vec![TestHttpResponse {
            status_line: "200 OK",
            body: r#"[{"id":91,"status":"running","ref":"main","sha":"abc123","web_url":"https://gitlab.example/p/91"}]"#.to_string(),
            extra_headers: vec![],
            delay_ms: 0,
        }])
        .await;

        let pipeline = check_pipeline(&cfg, "group/project", "main", Some("abc123"))
            .await
            .expect("check pipeline")
            .expect("pipeline exists");

        assert_eq!(pipeline.id, 91);
        assert_eq!(pipeline.status, "running");
        assert_eq!(pipeline.sha.as_deref(), Some("abc123"));

        let captured = requests.lock().await;
        assert_eq!(captured.len(), 1);
        assert!(captured[0].path.contains("ref=main"));
        assert!(captured[0].path.contains("sha=abc123"));
    }

    #[tokio::test]
    async fn pipeline_gitlab_wait_pipeline_falls_back_to_ref_head_without_sha() {
        let (cfg, requests) = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":92,"status":"running","ref":"release","sha":"def456","web_url":"https://gitlab.example/p/92"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":92,"status":"success","ref":"release","sha":"def456","web_url":"https://gitlab.example/p/92"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
        ])
        .await;

        let pipeline = wait_pipeline(
            &cfg,
            "group/project",
            "release",
            None,
            std::time::Duration::from_millis(250),
            std::time::Duration::from_millis(10),
        )
        .await
        .expect("wait pipeline");

        assert_eq!(pipeline.id, 92);
        assert_eq!(pipeline.status, "success");

        let captured = requests.lock().await;
        assert!(captured
            .iter()
            .all(|request| !request.path.contains("sha=")));
    }

    #[tokio::test]
    async fn pipeline_gitlab_trigger_pipeline_returns_downstream_identifier() {
        let (cfg, requests) = spawn_gitlab_test_server(vec![TestHttpResponse {
            status_line: "201 Created",
            body: r#"{"id":93,"status":"pending","ref":"main","sha":"fedcba","web_url":"https://gitlab.example/p/93"}"#.to_string(),
            extra_headers: vec![],
            delay_ms: 0,
        }])
        .await;

        let pipeline = trigger_pipeline(
            &cfg,
            "group/project",
            "main",
            &[("DEPLOY_ENV".to_string(), "prod".to_string())],
        )
        .await
        .expect("trigger pipeline");

        assert_eq!(pipeline.id, 93);
        assert_eq!(pipeline.status, "pending");

        let captured = requests.lock().await;
        assert_eq!(captured[0].method, "POST");
        assert!(captured[0]
            .path
            .contains("/api/v4/projects/group%2Fproject/pipeline"));
        assert!(captured[0].body.contains("ref=main"));
        assert!(captured[0].body.contains("variables%5BDEPLOY_ENV%5D=prod"));
    }

    #[tokio::test]
    async fn pipeline_gitlab_check_pipeline_surfaces_auth_and_not_found_errors() {
        let (auth_cfg, _) = spawn_gitlab_test_server(vec![TestHttpResponse {
            status_line: "401 Unauthorized",
            body: r#"{"message":"401 Unauthorized"}"#.to_string(),
            extra_headers: vec![],
            delay_ms: 0,
        }])
        .await;

        let auth_error = check_pipeline(&auth_cfg, "group/project", "main", None)
            .await
            .expect_err("auth error should surface");
        assert!(auth_error.to_string().contains("401"));

        let (not_found_cfg, _) = spawn_gitlab_test_server(vec![TestHttpResponse {
            status_line: "404 Not Found",
            body: r#"{"message":"404 Project Not Found"}"#.to_string(),
            extra_headers: vec![],
            delay_ms: 0,
        }])
        .await;

        let not_found_error = trigger_pipeline(&not_found_cfg, "missing/project", "main", &[])
            .await
            .expect_err("not found should surface");
        assert!(not_found_error.to_string().contains("404"));
    }

    #[tokio::test]
    async fn pipeline_gitlab_wait_pipeline_times_out_when_remote_never_finishes() {
        let (cfg, _) = spawn_gitlab_test_server(vec![
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":94,"status":"running","ref":"main","sha":"wait1","web_url":"https://gitlab.example/p/94"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":94,"status":"running","ref":"main","sha":"wait1","web_url":"https://gitlab.example/p/94"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
            TestHttpResponse {
                status_line: "200 OK",
                body: r#"[{"id":94,"status":"running","ref":"main","sha":"wait1","web_url":"https://gitlab.example/p/94"}]"#.to_string(),
                extra_headers: vec![],
                delay_ms: 0,
            },
        ])
        .await;

        let error = wait_pipeline(
            &cfg,
            "group/project",
            "main",
            Some("wait1"),
            std::time::Duration::from_millis(30),
            std::time::Duration::from_millis(10),
        )
        .await
        .expect_err("wait pipeline should time out");

        assert!(error.to_string().contains("timed out"));
    }
}
