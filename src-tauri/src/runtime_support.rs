use anyhow::{anyhow, Result};
use chrono::Utc;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex as TokioMutex;

static REPO_LEASE_REGISTRY: OnceLock<TokioMutex<HashMap<String, Arc<TokioMutex<()>>>>> =
    OnceLock::new();

#[derive(Debug, Clone)]
pub(crate) struct ProjectExecutionStep {
    pub(crate) run_step_id: i64,
    pub(crate) step_type: String,
    pub(crate) rendered_parameters: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectOutcome {
    Success,
    Failed,
    FailedPrecheck,
    Cancelled,
}

pub(crate) fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn normalize_repo_lease_key(repo_path: &str) -> String {
    let normalized = repo_path.replace('\\', "/");
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn repo_lease_registry() -> &'static TokioMutex<HashMap<String, Arc<TokioMutex<()>>>> {
    REPO_LEASE_REGISTRY.get_or_init(|| TokioMutex::new(HashMap::new()))
}

pub(crate) async fn get_repo_lease(repo_path: &str) -> Arc<TokioMutex<()>> {
    let key = normalize_repo_lease_key(repo_path);
    let mut registry = repo_lease_registry().lock().await;
    registry
        .entry(key)
        .or_insert_with(|| Arc::new(TokioMutex::new(())))
        .clone()
}

pub(crate) fn normalize_run_parameters(value: Value) -> Result<Value> {
    match value {
        Value::Null => Ok(Value::Object(Map::new())),
        Value::Object(_) => Ok(value),
        _ => Err(anyhow!("run_parameters must be a JSON object")),
    }
}

pub(crate) fn json_primitive_to_string(value: &Value, key: &str) -> Result<String> {
    match value {
        Value::String(s) => Ok(s.clone()),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(b.to_string()),
        _ => Err(anyhow!(
            "run parameter '{key}' must be string/number/bool for string templating"
        )),
    }
}

fn render_template_string(template: &str, variables: &Map<String, Value>) -> Result<String> {
    let mut rendered = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("${") {
        rendered.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after
            .find('}')
            .ok_or_else(|| anyhow!("invalid placeholder in template: {template}"))?;
        let key = after[..end].trim();
        if key.is_empty() {
            return Err(anyhow!("empty placeholder in template: {template}"));
        }
        let value = variables
            .get(key)
            .ok_or_else(|| anyhow!("missing run parameter for placeholder: {key}"))?;
        rendered.push_str(&json_primitive_to_string(value, key)?);
        rest = &after[end + 1..];
    }

    rendered.push_str(rest);
    Ok(rendered)
}

pub(crate) fn render_value(value: &Value, variables: &Map<String, Value>) -> Result<Value> {
    match value {
        Value::String(raw) => Ok(Value::String(render_template_string(raw, variables)?)),
        Value::Array(values) => {
            let mut rendered = Vec::with_capacity(values.len());
            for item in values {
                rendered.push(render_value(item, variables)?);
            }
            Ok(Value::Array(rendered))
        }
        Value::Object(entries) => {
            let mut rendered = Map::with_capacity(entries.len());
            for (key, item) in entries {
                rendered.insert(key.clone(), render_value(item, variables)?);
            }
            Ok(Value::Object(rendered))
        }
        _ => Ok(value.clone()),
    }
}

pub(crate) fn derive_run_final_status(has_failures: bool, has_cancelled: bool) -> &'static str {
    if has_failures {
        "partial_failed"
    } else if has_cancelled {
        "cancelled"
    } else {
        "completed"
    }
}

pub(crate) fn derive_run_final_status_from_project_counts(
    project_total: i64,
    project_success: i64,
    project_failures: i64,
    project_cancelled: i64,
    project_non_terminal: i64,
) -> &'static str {
    let has_failures = project_failures > 0;
    let has_cancelled = project_total == 0
        || project_cancelled > 0
        || project_non_terminal > 0
        || project_success != project_total;
    derive_run_final_status(has_failures, has_cancelled)
}
