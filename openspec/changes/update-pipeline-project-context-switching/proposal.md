# Change: Update Pipeline Project Context Switching

## Why
The current pipeline runtime still assumes that every manual run and schedule starts from a selected project group. That makes the execution scope external to the pipeline definition, prevents a simple "run this pipeline now" flow, and clashes with the new requirement that operators should switch among existing managed projects from inside the pipeline itself.

The product direction is now different: pipeline definitions should stay project-group agnostic, and project context should be selected by ordered built-in nodes. That requires coordinated changes across definition editing, runtime execution, scheduling, persistence, and monitoring.

## What Changes
- Add a built-in `switch_project` pipeline node that stores `managedProjectId`, shows the managed project name in the editor, and updates the active project context during execution.
- Change pipeline execution so manual runs and schedules no longer require a `projectGroupId`; project context starts empty and is resolved by `switch_project` nodes as the pipeline executes.
- Make local Git steps and GitLab-aware steps consume the active managed project context, including working directory and default GitLab project path, and fail with Chinese precheck guidance if no project has been selected yet.
- Update pipeline run persistence and monitoring to record project segments lazily as `switch_project` nodes are visited instead of pre-expanding all projects from a project group.
- Relax pipeline schedule and pipeline run storage so historical rows can keep existing `project_group_id` values, while new rows may omit them.
- Add a manual pipeline run entry point in the UI that launches a run without asking for a project group.

## Impact
- Affected specs:
  - `release-pipeline-orchestration`
  - `release-pipeline-scheduling`
- Affected code:
  - `src/components/pipeline-editor/*`
  - `src/pages/WorkflowsPagePipeline.tsx`
  - `src/pages/WorkflowRunsPagePipeline.tsx`
  - `src/lib/types.ts`
  - `src/lib/invoke.ts`
  - `src-tauri/src/models.rs`
  - `src-tauri/src/db.rs`
  - `src-tauri/src/main.rs`
  - `src-tauri/src/git_executor.rs`
  - `src-tauri/src/gitlab_executor.rs`
  - `src-tauri/src/pipeline_runtime.rs`
  - `src-tauri/src/scheduler.rs`
