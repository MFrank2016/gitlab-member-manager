# Change: Add Working Path Context Step

## Why
The current local workflow and pipeline execution model assumes that every Git-oriented built-in step runs under a fixed `ManagedProject.repoPath`. That is not enough for operator flows that need to switch into another directory first and then continue with later branch, pull, merge, or push steps from that updated location.

The requested behavior is sequential and context-sensitive: one step should update the working directory, and later local steps should inherit that updated context in order. Without an explicit runtime-context step, operators must either duplicate path logic across later steps or cannot express the flow at all.

## What Changes
- Add a new built-in local execution step/node `set_working_path` that updates the current working directory for later local steps.
- Support variable-rendered path input, absolute paths, and relative paths resolved from the latest execution context.
- Fail immediately with Chinese-first errors when the path is empty, missing, not a directory, or leaves later Git steps in a non-repository directory.
- Update local Git step prechecks and execution to consume one shared runtime working-directory context instead of reading directly from `ManagedProject.repoPath`.
- Surface the new step in the definition editor as a built-in option with a focused `path` field.

## Impact
- Affected specs:
  - `release-pipeline-orchestration`
  - `git-workflow-execution`
- Affected code:
  - `src-tauri/src/git_executor.rs`
  - `src-tauri/src/pipeline_runtime.rs`
  - `src-tauri/src/workflow_runtime_legacy.rs`
  - `src-tauri/src/workflows.rs`
  - `src-tauri/src/models.rs`
  - `src/lib/types.ts`
  - `src/components/pipeline-editor/draft-model.ts`
  - `src/pages/WorkflowRunsPagePipeline.tsx`
  - `docs/plans/2026-04-20-set-working-path-step-design.md`
