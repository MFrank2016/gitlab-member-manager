# Pipeline Runtime Foundation Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land the first executable slice of the second-phase pipeline work by splitting the runtime foundation, introducing structured command errors, and preserving current pipeline behavior with focused regression coverage.

**Architecture:** Treat this as a behavior-preserving refactor pass. Extract failure handling, Git execution, GitLab execution, pipeline orchestration, and workflow-compatibility code out of `workflows.rs`, then thin the Tauri command layer in `main.rs` with a dedicated backend command-error type. Do not change scheduler semantics, run-history query shape, or monitoring UI loading behavior in this plan.

**Tech Stack:** Rust, Tauri 2, sqlx, SQLite, tokio, reqwest, React 18, TypeScript, Vitest.

---

## Execution Notes

- This plan assumes the baseline docs already exist:
  - `docs/plans/2026-04-16-pipeline-baseline-metrics.md`
  - `docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md`
- Keep `workflow_*` compatibility wrappers alive in this slice.
- Run Rust verification commands **sequentially** on Windows. Do not start multiple `cargo test` commands in parallel, or they may block on the package cache lock.
- Prefer focused tests before and after every extraction step.

### Task 1: Lock in the runtime baseline with focused tests

**Files:**
- Modify: `src-tauri/src/workflows.rs`
- Test: `src/__tests__/smoke.test.tsx`

**Step 1: Add or rename focused Rust tests for the behavior this refactor must not break**

Keep or rename tests so the following filters exist and are easy to re-run:

```rust
#[tokio::test]
async fn pipeline_runtime_foundation_persists_structured_failure_envelope_for_precheck() {}

#[tokio::test]
async fn pipeline_runtime_foundation_gitlab_nodes_persist_wait_metadata() {}

#[tokio::test]
async fn workflow_runtime_legacy_execute_workflow_run_still_works() {}
```

**Step 2: Run the focused Rust baseline**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_foundation
cargo test -j 1 --manifest-path src-tauri/Cargo.toml workflow_runtime_legacy
```

Expected:
- PASS
- No behavior changes yet

**Step 3: Re-run the frontend smoke coverage that exercises pipeline pages**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- PASS

**Step 4: Commit the baseline-only naming cleanup if the test surface changed**

```powershell
git add src-tauri/src/workflows.rs src/__tests__/smoke.test.tsx
git commit -m "test: pin pipeline runtime foundation baseline"
```

### Task 2: Extract failure envelope logic into its own module

**Files:**
- Create: `src-tauri/src/failure_envelope.rs`
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Move the failure-envelope types and builders into a dedicated module**

Create `src-tauri/src/failure_envelope.rs` with the extracted shape:

```rust
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FailureEnvelope {
    pub error_code: String,
    pub title_zh: String,
    pub detail_zh: String,
    pub suggestion_zh: String,
    pub evidence: String,
}

pub fn build_failure_envelope(
    error_code: &str,
    title_zh: &str,
    detail_zh: String,
    suggestion_zh: &str,
    evidence: String,
) -> FailureEnvelope {
    FailureEnvelope {
        error_code: error_code.to_string(),
        title_zh: title_zh.to_string(),
        detail_zh,
        suggestion_zh: suggestion_zh.to_string(),
        evidence,
    }
}
```

**Step 2: Replace in-file definitions in `workflows.rs` with imports**

Update `src-tauri/src/workflows.rs` to import:

```rust
use crate::failure_envelope::{build_failure_envelope, FailureEnvelope};
```

Remove the duplicated local struct and builder after the imports compile.

**Step 3: Wire the new module in `main.rs`**

Add:

```rust
mod failure_envelope;
```

near the other module declarations in `src-tauri/src/main.rs`.

**Step 4: Re-run the failure-focused Rust tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_foundation
```

Expected:
- PASS
- No change in persisted `error_code/title_zh/detail_zh/suggestion_zh/evidence`

**Step 5: Commit**

```powershell
git add src-tauri/src/failure_envelope.rs src-tauri/src/workflows.rs src-tauri/src/main.rs
git commit -m "refactor: extract pipeline failure envelope helpers"
```

### Task 3: Extract Git and GitLab execution helpers out of `workflows.rs`

**Files:**
- Create: `src-tauri/src/git_executor.rs`
- Create: `src-tauri/src/gitlab_executor.rs`
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/workflows.rs`
- Test: `src-tauri/src/gitlab.rs`

**Step 1: Move Git command execution and repository precheck helpers into `git_executor.rs`**

Start with helpers that do not require DB access:

```rust
pub(crate) async fn run_git_command(...) -> Result<GitCommandOutput> { ... }
pub(crate) async fn ensure_repository_preconditions(...) -> Result<()> { ... }
pub(crate) fn build_execution_step_operation(...) -> Result<ExecutionStepOperation> { ... }
```

**Step 2: Move GitLab node execution helpers into `gitlab_executor.rs`**

Extract helpers around:
- `check_pipeline`
- `wait_pipeline`
- `trigger_pipeline`
- polling and evidence construction

The target shape is:

```rust
pub(crate) async fn execute_check_pipeline(...) -> Result<GitLabNodeOutcome> { ... }
pub(crate) async fn execute_wait_pipeline(...) -> Result<GitLabNodeOutcome> { ... }
pub(crate) async fn execute_trigger_pipeline(...) -> Result<GitLabNodeOutcome> { ... }
```

**Step 3: Keep `workflows.rs` as the orchestration entrypoint only**

After extraction, `workflows.rs` should still expose public entrypoints such as:

```rust
pub async fn execute_pipeline_run(...) -> Result<i64> { ... }
pub async fn retry_pipeline_run(...) -> Result<i64> { ... }
pub async fn cancel_pipeline_run(...) -> Result<()> { ... }
```

But it should call into `git_executor` and `gitlab_executor` instead of owning the low-level helper bodies directly.

**Step 4: Wire the new modules in `main.rs`**

Add:

```rust
mod git_executor;
mod gitlab_executor;
```

**Step 5: Re-run focused runtime verification**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_refactor
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_gitlab
```

Expected:
- PASS
- GitLab wait metadata still persists
- Git node execution semantics stay unchanged

**Step 6: Commit**

```powershell
git add src-tauri/src/git_executor.rs src-tauri/src/gitlab_executor.rs src-tauri/src/workflows.rs src-tauri/src/main.rs
git commit -m "refactor: split git and gitlab pipeline executors"
```

### Task 4: Split orchestration from workflow compatibility code

**Files:**
- Create: `src-tauri/src/pipeline_runtime.rs`
- Create: `src-tauri/src/workflow_runtime_legacy.rs`
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Move pipeline-only orchestration into `pipeline_runtime.rs`**

Extract the pipeline path first:

```rust
pub(crate) async fn execute_pipeline_run(...) -> Result<i64> { ... }
pub(crate) async fn retry_pipeline_run(...) -> Result<i64> { ... }
pub(crate) async fn cancel_pipeline_run(...) -> Result<()> { ... }
pub(crate) async fn execute_scheduled_pipeline_run(...) -> Result<i64> { ... }
```

Keep the DB writes and state transitions exactly the same during this move.

**Step 2: Move workflow-compatibility entrypoints into `workflow_runtime_legacy.rs`**

Extract legacy-only wrappers:

```rust
pub(crate) async fn execute_workflow_run(...) -> Result<i64> { ... }
pub(crate) async fn cancel_workflow_run(...) -> Result<()> { ... }
pub(crate) async fn retry_failed_workflow_run(...) -> Result<i64> { ... }
```

**Step 3: Reduce `workflows.rs` to a compatibility facade**

After the move, keep `src-tauri/src/workflows.rs` as thin forwarding code:

```rust
pub async fn execute_pipeline_run(...) -> Result<i64> {
    pipeline_runtime::execute_pipeline_run(...).await
}
```

and

```rust
pub async fn execute_workflow_run(...) -> Result<i64> {
    workflow_runtime_legacy::execute_workflow_run(...).await
}
```

**Step 4: Register the new modules**

Add:

```rust
mod pipeline_runtime;
mod workflow_runtime_legacy;
```

to `src-tauri/src/main.rs`.

**Step 5: Re-run the runtime regression suite**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
cargo test -j 1 --manifest-path src-tauri/Cargo.toml workflow_runtime_legacy
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule_runtime
```

Expected:
- PASS
- Scheduler still starts scheduled runs through the pipeline path
- Legacy workflow commands still work

**Step 6: Commit**

```powershell
git add src-tauri/src/pipeline_runtime.rs src-tauri/src/workflow_runtime_legacy.rs src-tauri/src/workflows.rs src-tauri/src/main.rs
git commit -m "refactor: separate pipeline and legacy workflow runtimes"
```

### Task 5: Introduce a structured backend command error model for pipeline-facing commands

**Files:**
- Create: `src-tauri/src/errors.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src/__tests__/smoke.test.tsx`

**Step 1: Create the backend command error type**

Add `src-tauri/src/errors.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandErrorCategory {
    ConfigMissing,
    ValidationFailed,
    GitFailed,
    GitlabFailed,
    NotFound,
    Conflict,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandError {
    pub category: CommandErrorCategory,
    pub message_zh: String,
    pub detail: Option<String>,
}
```

**Step 2: Add conversion helpers in `main.rs`**

Create narrow helpers for pipeline-facing commands first:

```rust
fn pipeline_command_error(error: anyhow::Error) -> CommandError { ... }
fn validation_error(message_zh: impl Into<String>) -> CommandError { ... }
```

**Step 3: Convert the high-value pipeline commands away from `String` errors**

Update these Tauri commands first:
- `create_pipeline_definition`
- `update_pipeline_definition`
- `list_pipeline_runs`
- `get_pipeline_run_detail`
- `execute_pipeline_run`
- `cancel_pipeline_run`
- `retry_pipeline_run`

Target shape:

```rust
#[tauri::command]
async fn list_pipeline_runs(
    state: State<'_, AppState>,
) -> Result<Vec<PipelineRunListItem>, CommandError> {
    db::list_pipeline_runs(&state.db)
        .await
        .map_err(pipeline_command_error)
}
```

**Step 4: Add frontend types for structured command errors**

In `src/lib/types.ts`, add:

```ts
export type CommandErrorCategory =
  | "config_missing"
  | "validation_failed"
  | "git_failed"
  | "gitlab_failed"
  | "not_found"
  | "conflict"
  | "internal";

export type CommandError = {
  category: CommandErrorCategory;
  messageZh: string;
  detail?: string | null;
};
```

Update `src/lib/invoke.ts` so the pipeline-facing wrappers can surface that shape without rewriting the whole app yet.

**Step 5: Update pipeline page toasts to use Chinese-first command errors**

Change pipeline-page handling from raw English strings like:

```ts
toast.error(`Load pipeline runs failed: ${String(error)}`);
```

to something category-aware and Chinese-first:

```ts
toast.error(readCommandErrorMessage(error, "加载流水线运行记录失败。"));
```

Only update:
- `src/pages/WorkflowRunsPagePipeline.tsx`
- `src/pages/WorkflowsPagePipeline.tsx`

if needed during this step.

**Step 6: Re-run frontend and command-surface verification**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
```

Expected:
- PASS
- Pipeline page failures use Chinese-first operator copy

**Step 7: Commit**

```powershell
git add src-tauri/src/errors.rs src-tauri/src/main.rs src-tauri/src/models.rs src/lib/types.ts src/lib/invoke.ts src/pages/WorkflowRunsPagePipeline.tsx src/pages/WorkflowsPagePipeline.tsx src/__tests__/smoke.test.tsx
git commit -m "refactor: add structured pipeline command errors"
```

### Task 6: Final verification and exit check

**Files:**
- Modify: `openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md`
- Modify: `docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md`

**Step 1: Run the final focused verification set**

Run:

```powershell
openspec validate enhance-pipeline-runtime-and-monitoring --strict
pnpm test -- src/__tests__/smoke.test.tsx
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_gitlab
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule_runtime
```

Expected:
- `openspec validate ... --strict` reports the change is valid
- All focused tests PASS

**Step 2: Mark only the completed second-phase items**

Update `openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md` to mark completed items:
- `1.1`
- `1.2`
- `1.3`
- `5.1`
- `5.2`

Do **not** mark monitoring, scheduler-optimization, or visualization tasks complete in this plan.

**Step 3: Record what is still intentionally deferred**

Append a short status note to `docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md` covering:
- run-history pagination still pending
- run-detail lazy loading still pending
- active-run auto-refresh still pending
- scheduler query optimization still pending
- visualizations still pending

**Step 4: Commit**

```powershell
git add openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md
git commit -m "docs: close pipeline runtime foundation slice"
```

## Exit Criteria

- `workflows.rs` no longer owns failure helpers, Git helpers, GitLab node helpers, and both runtime families at once.
- `main.rs` stops returning raw `String` errors for the main pipeline commands.
- Pipeline page operator feedback is Chinese-first.
- Focused Rust and frontend regression tests pass sequentially on Windows.
- The OpenSpec change remains valid after the runtime-foundation slice lands.
