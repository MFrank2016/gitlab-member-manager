# Change: Add Stage-Aware DAG Release Pipelines

## Why

The current `pipeline_*` runtime already covers linear Git and GitLab release steps, but it still treats a release flow as an ordered node list with optional cross-project concurrency. That is not enough for the next product requirement: operators need to model multi-project release chains as visually editable DAGs where stages run serially, nodes inside a stage may run in parallel, and failures block downstream stages while still letting already-started peer nodes finish.

Continuing to patch the linear runtime would create a brittle mismatch between the UI, the stored model, and the actual scheduling semantics. The product now needs first-class stages, dependency edges, stage-level visibility, and derived retries from the full run, a stage, or a node.

## What Changes

- Add first-class stage and edge definitions to the existing `pipeline_*` model.
- Add a stage-aware DAG runtime that executes stages serially and eligible nodes inside a stage in parallel.
- Add stage runtime records so the UI can explain where a release stopped and why downstream stages did not start.
- Add derived retries for the whole run, a failed stage, or a failed node, while preserving lineage through `source_pipeline_run_id`.
- Replace the current linear pipeline editor with a React Flow based DAG editor that keeps pipeline validation server-side and client-side consistent.
- Keep the existing Git executor, GitLab adapter, Chinese failure envelopes, and waiting-state evidence model as reusable foundations.

## Impact

- Affected specs:
  - `release-pipeline-orchestration`
- Affected code:
  - `src-tauri/migrations/*`
  - `src-tauri/src/models.rs`
  - `src-tauri/src/db.rs`
  - `src-tauri/src/pipeline_runtime.rs`
  - `src-tauri/src/workflows.rs`
  - `src-tauri/src/main.rs`
  - `src/lib/types.ts`
  - `src/lib/invoke.ts`
  - `src/components/pipeline-editor/*`
  - `src/components/pipeline-run-monitor/*`
  - `src/pages/WorkflowsPagePipeline.tsx`
  - `src/pages/WorkflowRunsPagePipeline.tsx`
