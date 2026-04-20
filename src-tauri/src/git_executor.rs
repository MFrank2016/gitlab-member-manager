use crate::failure_envelope::{build_failure_envelope, FailureEnvelope};
use crate::models::ManagedProject;
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::path::Path;
use std::time::{Duration as StdDuration, Instant};

const GIT_COMMAND_TIMEOUT_SECS: u64 = 120;

#[derive(Debug)]
pub(crate) struct CommandResult {
    pub(crate) success: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) exit_code: Option<i64>,
}

#[derive(Debug)]
pub(crate) enum StepOperation {
    CheckoutBranch {
        branch: String,
    },
    GitPull {
        remote: String,
        branch: String,
    },
    GitMerge {
        from: String,
    },
    GitPush {
        remote: String,
        branch: Option<String>,
    },
}

impl StepOperation {
    pub(crate) fn to_args(&self) -> Vec<String> {
        match self {
            Self::CheckoutBranch { branch } => vec!["checkout".to_string(), branch.clone()],
            Self::GitPull { remote, branch } => vec![
                "pull".to_string(),
                remote.clone(),
                branch.clone(),
                "--ff-only".to_string(),
            ],
            Self::GitMerge { from } => {
                vec!["merge".to_string(), "--no-edit".to_string(), from.clone()]
            }
            Self::GitPush { remote, branch } => {
                let mut args = vec!["push".to_string(), remote.clone()];
                if let Some(branch_name) = branch {
                    args.push(branch_name.clone());
                }
                args
            }
        }
    }
}

fn read_required_string_param(parameters: &Value, key: &str) -> Result<String> {
    parameters
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| anyhow!("step parameter '{key}' is required"))
}

fn read_optional_string_param(parameters: &Value, key: &str) -> Option<String> {
    parameters
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn build_execution_step_operation(
    step_type: &str,
    rendered_parameters: &Value,
    project: &ManagedProject,
) -> Result<StepOperation> {
    match step_type {
        "checkout_branch" => Ok(StepOperation::CheckoutBranch {
            branch: read_required_string_param(rendered_parameters, "branch")?,
        }),
        "git_pull" => Ok(StepOperation::GitPull {
            remote: read_optional_string_param(rendered_parameters, "remote")
                .unwrap_or_else(|| project.default_remote.clone()),
            branch: read_optional_string_param(rendered_parameters, "branch")
                .unwrap_or_else(|| project.default_branch.clone()),
        }),
        "git_merge" => Ok(StepOperation::GitMerge {
            from: read_required_string_param(rendered_parameters, "from")?,
        }),
        "git_push" => Ok(StepOperation::GitPush {
            remote: read_optional_string_param(rendered_parameters, "remote")
                .unwrap_or_else(|| project.default_remote.clone()),
            branch: read_optional_string_param(rendered_parameters, "branch"),
        }),
        other => Err(anyhow!("unsupported step type: {other}")),
    }
}

pub(crate) async fn execute_git_command(
    repo_path: String,
    args: Vec<String>,
) -> Result<CommandResult> {
    tokio::task::spawn_blocking(move || {
        let mut child = std::process::Command::new("git")
            .args(args)
            .current_dir(repo_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .context("spawn git command")?;

        let deadline = Instant::now() + StdDuration::from_secs(GIT_COMMAND_TIMEOUT_SECS);
        loop {
            if let Some(status) = child.try_wait().context("poll git command status")? {
                let output = child
                    .wait_with_output()
                    .context("collect git command output")?;
                return Ok(CommandResult {
                    success: status.success(),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    exit_code: status.code().map(i64::from),
                });
            }

            if Instant::now() >= deadline {
                if let Some(status) = child
                    .try_wait()
                    .context("poll git command status at timeout boundary")?
                {
                    let output = child
                        .wait_with_output()
                        .context("collect git command output at timeout boundary")?;
                    return Ok(CommandResult {
                        success: status.success(),
                        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                        exit_code: status.code().map(i64::from),
                    });
                }

                let _ = child.kill();
                let output = child.wait_with_output().ok();
                let timed_out_note =
                    format!("git command timed out after {GIT_COMMAND_TIMEOUT_SECS}s");
                let stdout = output
                    .as_ref()
                    .map(|value| String::from_utf8_lossy(&value.stdout).to_string())
                    .unwrap_or_default();
                let stderr_tail = output
                    .as_ref()
                    .map(|value| String::from_utf8_lossy(&value.stderr).to_string())
                    .unwrap_or_default();
                let stderr = if stderr_tail.trim().is_empty() {
                    timed_out_note
                } else {
                    format!("{timed_out_note}; stderr={stderr_tail}")
                };
                return Ok(CommandResult {
                    success: false,
                    stdout,
                    stderr,
                    exit_code: None,
                });
            }

            std::thread::sleep(StdDuration::from_millis(100));
        }
    })
    .await
    .context("join git command task")?
}

async fn ensure_clean_worktree(repo_path: &str) -> Result<()> {
    let status_result = execute_git_command(
        repo_path.to_string(),
        vec!["status".to_string(), "--porcelain".to_string()],
    )
    .await?;
    if !status_result.success {
        return Err(anyhow!(
            "git status failed: {}",
            status_result.stderr.trim()
        ));
    }
    if !status_result.stdout.trim().is_empty() {
        return Err(anyhow!("repository worktree is not clean"));
    }
    Ok(())
}

async fn ensure_remote_exists(repo_path: &str, remote: &str) -> Result<()> {
    let result = execute_git_command(
        repo_path.to_string(),
        vec![
            "remote".to_string(),
            "get-url".to_string(),
            remote.to_string(),
        ],
    )
    .await?;
    if result.success {
        Ok(())
    } else {
        Err(anyhow!(
            "git remote '{}' not configured: {}",
            remote,
            result.stderr.trim()
        ))
    }
}

async fn ensure_branch_exists(repo_path: &str, branch: &str, remote: &str) -> Result<()> {
    let local = execute_git_command(
        repo_path.to_string(),
        vec![
            "rev-parse".to_string(),
            "--verify".to_string(),
            branch.to_string(),
        ],
    )
    .await?;
    if local.success {
        return Ok(());
    }

    let remote_ref = format!("{remote}/{branch}");
    let remote_result = execute_git_command(
        repo_path.to_string(),
        vec![
            "rev-parse".to_string(),
            "--verify".to_string(),
            remote_ref.clone(),
        ],
    )
    .await?;
    if remote_result.success {
        return Ok(());
    }

    Err(anyhow!(
        "branch '{}' not found locally or as '{}'",
        branch,
        remote_ref
    ))
}

pub(crate) async fn run_repository_precheck(project: &ManagedProject) -> Result<()> {
    let repo_path = Path::new(&project.repo_path);
    if !repo_path.exists() {
        return Err(anyhow!(
            "repository path does not exist: {}",
            project.repo_path
        ));
    }
    if !repo_path.is_dir() {
        return Err(anyhow!(
            "repository path is not a directory: {}",
            project.repo_path
        ));
    }

    let inside_repo = execute_git_command(
        project.repo_path.clone(),
        vec!["rev-parse".to_string(), "--is-inside-work-tree".to_string()],
    )
    .await?;
    if !inside_repo.success || inside_repo.stdout.trim() != "true" {
        return Err(anyhow!("path is not a git worktree: {}", project.repo_path));
    }

    ensure_clean_worktree(&project.repo_path).await?;
    Ok(())
}

pub(crate) async fn run_execution_step_prechecks(
    project: &ManagedProject,
    operation: &StepOperation,
) -> Result<()> {
    match operation {
        StepOperation::CheckoutBranch { branch } => {
            ensure_clean_worktree(&project.repo_path).await?;
            ensure_branch_exists(&project.repo_path, branch, &project.default_remote).await
        }
        StepOperation::GitPull { remote, branch } => {
            ensure_clean_worktree(&project.repo_path).await?;
            ensure_remote_exists(&project.repo_path, remote).await?;
            ensure_branch_exists(&project.repo_path, branch, remote).await
        }
        StepOperation::GitMerge { from } => {
            ensure_clean_worktree(&project.repo_path).await?;
            ensure_branch_exists(&project.repo_path, from, &project.default_remote).await
        }
        StepOperation::GitPush { remote, .. } => {
            ensure_remote_exists(&project.repo_path, remote).await
        }
    }
}

pub(crate) fn classify_git_command_failure(
    node_type: &str,
    command_result: &CommandResult,
) -> FailureEnvelope {
    let stdout = command_result.stdout.trim();
    let stderr = command_result.stderr.trim();
    let evidence = format!(
        "node_type={node_type}; exit_code={:?}; stdout={}; stderr={}",
        command_result.exit_code, stdout, stderr
    );
    build_failure_envelope(
        "git.command_failed",
        "Git 命令执行失败",
        format!("节点 {node_type} 执行失败，请检查 Git 输出。"),
        "请根据错误输出修复仓库状态或远端问题后重试。",
        evidence,
    )
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    pub(crate) fn make_temp_test_dir(prefix: &str) -> PathBuf {
        let unique = format!(
            "{prefix}_{}_{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    pub(crate) fn run_git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("execute git");
        if !output.status.success() {
            panic!(
                "git {:?} failed: stdout={}, stderr={}",
                args,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    pub(crate) fn setup_git_repo_with_branches(repo: &Path, branches: &[&str]) {
        std::fs::create_dir_all(repo).expect("create repo dir");
        run_git(repo, &["init", "-b", "main"]);
        run_git(repo, &["config", "user.email", "ci@example.com"]);
        run_git(repo, &["config", "user.name", "CI"]);
        std::fs::write(repo.join("README.md"), "hello\n").expect("write readme");
        run_git(repo, &["add", "README.md"]);
        run_git(repo, &["commit", "-m", "init"]);
        for branch in branches {
            run_git(repo, &["branch", branch]);
        }
    }
}
