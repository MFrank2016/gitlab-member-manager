# Change: Refactor Workflow Execution into a Release Pipeline Orchestrator

## Why
The current `workflow_*` model covers ordered local Git steps, but it does not cover the broader release scenarios the product now needs: GitLab pipeline checks, commit-aware waits, downstream triggers, scheduled execution, and Chinese-facing failure guidance. Continuing to patch the existing workflow model would create overlapping runtime concepts and make the next round of expansion harder to maintain.

## What Changes
- Introduce a unified `pipeline_*` definition and runtime model for release orchestration.
- Add built-in pipeline nodes for Git operations, GitLab pipeline check/wait/trigger, and simple control flow.
- Add manual and scheduled pipeline runs with variable snapshots, waiting-state persistence, and derived rerun lineage.
- Add structured Chinese-facing failure payloads while preserving raw technical evidence for debugging.
- Migrate legacy `workflow_*` definitions and history into the new pipeline model and keep legacy data read-only during a transition window.
- **BREAKING** Move the primary UI and Tauri command surface from workflow terminology to pipeline terminology after the transition window.

## Impact
- Affected specs:
  - `release-pipeline-orchestration`
  - `release-pipeline-scheduling`
- Affected code:
  - `src/App.tsx`
  - `src/pages/WorkflowsPage.tsx`
  - `src/pages/WorkflowRunsPage.tsx`
  - `src/pages/ManagedProjectsPage.tsx`
  - `src/lib/types.ts`
  - `src/lib/invoke.ts`
  - `src-tauri/src/main.rs`
  - `src-tauri/src/db.rs`
  - `src-tauri/src/models.rs`
  - `src-tauri/src/workflows.rs`
  - `src-tauri/src/gitlab.rs`
  - `src-tauri/migrations/*`
