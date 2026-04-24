use crate::failure_envelope::{build_failure_envelope, FailureEnvelope};
use crate::gitlab::GitLabPipeline;
use crate::models::ManagedProject;
use anyhow::{anyhow, Result};
use serde_json::{Map, Value};

#[derive(Debug, Clone)]
pub(crate) struct WaitMetadata {
    pub(crate) wait_target: String,
    pub(crate) last_remote_status: Option<String>,
    pub(crate) remote_pipeline_id: Option<i64>,
    pub(crate) wait_context: Value,
}

pub(crate) fn read_optional_string_param(parameters: &Value, key: &str) -> Option<String> {
    parameters
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn json_primitive_to_string(value: &Value, key: &str) -> Result<String> {
    match value {
        Value::String(s) => Ok(s.clone()),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(b.to_string()),
        _ => Err(anyhow!(
            "step parameter '{key}' must be string/number/bool for string templating"
        )),
    }
}

pub(crate) fn classify_missing_gitlab_config() -> FailureEnvelope {
    build_failure_envelope(
        "gitlab.config_missing",
        "GitLab 配置缺失",
        "当前流水线节点依赖 GitLab 配置，但系统中尚未保存可用的 GitLab 服务地址和访问令牌。"
            .to_string(),
        "请先在设置页完成 GitLab 配置后再重试。",
        "gitlab config missing".to_string(),
    )
}

pub(crate) fn classify_pipeline_not_found(
    project: &str,
    reference: &str,
    sha: Option<&str>,
) -> FailureEnvelope {
    build_failure_envelope(
        "gitlab.pipeline_not_found",
        "未找到匹配的 GitLab 流水线",
        format!(
            "没有找到 project={project}, ref={reference}, sha={:?} 对应的 GitLab 流水线。",
            sha
        ),
        "请检查项目路径、分支名或提交 SHA 后重试。",
        format!("project={project}; ref={reference}; sha={:?}", sha),
    )
}

pub(crate) fn classify_gitlab_pipeline_status_failure(
    pipeline: &GitLabPipeline,
    node_type: &str,
) -> FailureEnvelope {
    let (title_zh, detail_zh, suggestion_zh) = match node_type {
        "check_pipeline" => (
            "GitLab 流水线检查未通过",
            format!(
                "GitLab 流水线#{} 执行失败，当前状态为 {}，未达到可继续执行的成功状态。",
                pipeline.id, pipeline.status
            ),
            "请先检查该流水线失败原因并修复后再重试。",
        ),
        "wait_pipeline" => (
            "等待的 GitLab 流水线未成功",
            format!(
                "等待中的 GitLab 流水线#{} 最终执行失败，状态为 {}。",
                pipeline.id, pipeline.status
            ),
            "请检查该流水线日志并修复失败原因后再重试。",
        ),
        _ => (
            "GitLab 流水线状态异常",
            format!(
                "GitLab 流水线#{}, 当前状态为 {}，无法继续当前节点。",
                pipeline.id, pipeline.status
            ),
            "请检查流水线状态和配置后重试。",
        ),
    };
    classify_gitlab_pipeline_failure(
        title_zh,
        detail_zh,
        suggestion_zh,
        Some(pipeline),
        "gitlab.pipeline_failed",
    )
}

pub(crate) fn read_pipeline_project_param(
    parameters: &Value,
    project: Option<&ManagedProject>,
) -> Result<String> {
    if let Some(value) = read_optional_string_param(parameters, "project") {
        return Ok(value);
    }

    project
        .map(|value| value.path_with_namespace.clone())
        .ok_or_else(|| {
            anyhow!(
                "step parameter 'project' is required when no active managed project is selected"
            )
        })
}

pub(crate) fn read_pipeline_reference_param(
    parameters: &Value,
    project: Option<&ManagedProject>,
) -> Result<String> {
    if let Some(value) = read_optional_string_param(parameters, "ref") {
        return Ok(value);
    }

    project
        .map(|value| value.default_branch.clone())
        .ok_or_else(|| {
            anyhow!(
                "step parameter 'ref' is required when no active managed project is selected"
            )
        })
}

pub(crate) fn read_pipeline_variables_param(parameters: &Value) -> Result<Vec<(String, String)>> {
    let value = parameters
        .get("variables")
        .cloned()
        .unwrap_or(Value::Object(Map::new()));
    let variables = match value {
        Value::Object(map) => map,
        _ => return Err(anyhow!("step parameter 'variables' must be a JSON object")),
    };

    let mut rendered = Vec::with_capacity(variables.len());
    for (key, value) in variables {
        rendered.push((
            key.clone(),
            json_primitive_to_string(&value, &format!("variables.{key}"))?,
        ));
    }
    Ok(rendered)
}

pub(crate) fn pipeline_evidence_text(pipeline: &GitLabPipeline) -> String {
    format!(
        "pipeline_id={}; status={}; ref={}; sha={}; web_url={}",
        pipeline.id,
        pipeline.status,
        pipeline.ref_name,
        pipeline.sha.clone().unwrap_or_default(),
        pipeline.web_url.clone().unwrap_or_default()
    )
}

fn build_wait_target(project: &str, reference: &str, sha: Option<&str>) -> String {
    match sha {
        Some(sha) if !sha.trim().is_empty() => format!("{project}@{reference}#{sha}"),
        _ => format!("{project}@{reference}"),
    }
}

fn gitlab_pipeline_id_to_i64(pipeline_id: u64) -> Result<i64> {
    i64::try_from(pipeline_id)
        .map_err(|_| anyhow!("gitlab pipeline id out of range: {pipeline_id}"))
}

fn build_wait_metadata(
    project: &str,
    reference: &str,
    sha: Option<&str>,
    last_remote_status: Option<&str>,
    remote_pipeline_id: Option<i64>,
    elapsed_ms: u128,
    next_poll_in_ms: u64,
    timeout_ms: u128,
    web_url: Option<&str>,
) -> WaitMetadata {
    let mut wait_context = Map::new();
    wait_context.insert(
        "elapsedMs".to_string(),
        Value::String(elapsed_ms.to_string()),
    );
    wait_context.insert(
        "nextPollInMs".to_string(),
        Value::String(next_poll_in_ms.to_string()),
    );
    wait_context.insert(
        "timeoutMs".to_string(),
        Value::String(timeout_ms.to_string()),
    );
    if let Some(web_url) = web_url {
        wait_context.insert("webUrl".to_string(), Value::String(web_url.to_string()));
    }

    WaitMetadata {
        wait_target: build_wait_target(project, reference, sha),
        last_remote_status: last_remote_status.map(ToString::to_string),
        remote_pipeline_id,
        wait_context: Value::Object(wait_context),
    }
}

pub(crate) fn update_wait_metadata_with_pipeline(
    project: &str,
    reference: &str,
    sha: Option<&str>,
    pipeline: Option<&GitLabPipeline>,
    elapsed_ms: u128,
    next_poll_in_ms: u64,
    timeout_ms: u128,
) -> Result<WaitMetadata> {
    let remote_pipeline_id = pipeline
        .map(|value| gitlab_pipeline_id_to_i64(value.id))
        .transpose()?;
    Ok(build_wait_metadata(
        project,
        reference,
        sha,
        pipeline.map(|value| value.status.as_str()),
        remote_pipeline_id,
        elapsed_ms,
        next_poll_in_ms,
        timeout_ms,
        pipeline.and_then(|value| value.web_url.as_deref()),
    ))
}

pub(crate) fn classify_gitlab_error(error: &str) -> FailureEnvelope {
    if error.contains("401") || error.contains("403") {
        return build_failure_envelope(
            "gitlab.auth_failed",
            "GitLab 认证失败",
            "访问 GitLab 接口失败，凭证可能无效或已过期。".to_string(),
            "请检查 GitLab Token 和服务地址后重试。",
            error.to_string(),
        );
    }
    if error.contains("404") {
        return build_failure_envelope(
            "gitlab.project_not_found",
            "GitLab 项目不存在",
            "GitLab 项目不存在或当前凭证无权访问该项目。".to_string(),
            "请检查项目路径、项目 ID 或访问权限后重试。",
            error.to_string(),
        );
    }
    if error.contains("timed out") {
        return build_failure_envelope(
            "gitlab.pipeline_timeout",
            "等待远端流水线超时",
            "在限定时间内没有等到远端流水线进入终态。".to_string(),
            "请检查远端流水线状态，必要时延长超时时间后重试。",
            error.to_string(),
        );
    }

    build_failure_envelope(
        "gitlab.api_failed",
        "GitLab 接口调用失败",
        format!("调用 GitLab 接口失败：{error}"),
        "请检查网络、权限和参数配置后重试。",
        error.to_string(),
    )
}

fn classify_gitlab_pipeline_failure(
    title_zh: &str,
    detail_zh: String,
    suggestion_zh: &str,
    pipeline: Option<&GitLabPipeline>,
    error_code: &str,
) -> FailureEnvelope {
    let evidence = match pipeline {
        Some(pipeline) => format!(
            "pipeline_id={}; status={}; ref={}; sha={}; web_url={}",
            pipeline.id,
            pipeline.status,
            pipeline.ref_name,
            pipeline.sha.clone().unwrap_or_default(),
            pipeline.web_url.clone().unwrap_or_default()
        ),
        None => "pipeline not found".to_string(),
    };
    build_failure_envelope(error_code, title_zh, detail_zh, suggestion_zh, evidence)
}
