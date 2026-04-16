# Change: Enhance Pipeline Runtime And Monitoring

## Why
The current release pipeline orchestrator is functionally complete enough to use, but the implementation has now reached a point where future iteration will become slower and riskier unless the runtime, monitoring surface, and scheduler behavior are strengthened. The current runtime and data-access hotspots are concentrated in a few oversized files, the run monitor still depends mainly on manual refresh, and the existing run history and detail loading strategy will degrade as more pipeline history accumulates.

This change establishes the next evolution phase for the desktop release pipeline experience. It covers runtime boundary cleanup, structured monitoring improvements, more scalable run-history loading, scheduler efficiency, and richer run visualization so the app can keep evolving without turning the current implementation into a dead-end.

## What Changes
- Refactor the pipeline runtime and command surface into clearer internal layers while preserving existing behavior.
- Add structured error categories and operator-facing runtime state so the frontend can render better recovery guidance.
- Add paginated and filterable pipeline run history plus summary-first detail loading.
- Add automatic monitoring refresh for active runs and richer waiting-state visibility.
- Add operator-focused visualization for pipeline execution, including graph and timeline style views.
- Improve scheduler efficiency and expose future schedule behavior more clearly in the UI.

## Impact
- Affected specs:
  - `release-pipeline-orchestration`
  - `release-pipeline-scheduling`
- Affected code:
  - `src/App.tsx`
  - `src/pages/WorkflowsPagePipeline.tsx`
  - `src/pages/WorkflowRunsPagePipeline.tsx`
  - `src/lib/invoke.ts`
  - `src/lib/types.ts`
  - `src-tauri/src/main.rs`
  - `src-tauri/src/db.rs`
  - `src-tauri/src/workflows.rs`
  - `src-tauri/src/scheduler.rs`
  - `src-tauri/src/models.rs`
  - `src-tauri/migrations/*`
  - `docs/plans/*`
