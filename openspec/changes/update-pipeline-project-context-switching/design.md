## Context
The current pipeline runtime is built around project-group fan-out. A manual or scheduled run receives a `project_group_id`, resolves the group's enabled managed projects up front, seeds `pipeline_run_projects` and `pipeline_run_nodes` for every project, and then executes the same ordered node list inside each project context. That architecture matched the earlier cross-project orchestration goal, but it no longer matches the desired authoring model.

The new requirement is node-driven project context: the pipeline itself decides when to switch to a managed project, and it may switch multiple times in one run. That means project selection becomes part of the ordered node stream, not a run-level input.

## Goals / Non-Goals
- Goals:
  - Add a `switch_project` built-in node keyed by `managedProjectId`.
  - Show the selected managed project name in the editor while persisting only the stable ID.
  - Remove the requirement to pass `projectGroupId` when manually or automatically starting a pipeline run.
  - Let later local Git nodes use the active managed project's repo path and Git defaults.
  - Let later GitLab nodes default to the active managed project's `path_with_namespace` when their `project` field is blank.
  - Preserve old run and schedule rows that still reference project groups.
- Non-Goals:
  - Remove project groups from the product entirely.
  - Rewrite the legacy workflow runtime in the same change.
  - Introduce DAG execution or parallel node branches.

## Decisions
- Decision: represent the active execution target as a mutable "current managed project context" rather than a run-level project list.
  - Why: `switch_project` is ordered, repeatable, and should affect all later nodes until another `switch_project` appears.

- Decision: start manual and scheduled pipeline runs with no active managed project.
  - Why: pipeline definitions should no longer be forced to bind to a project group before execution starts.

- Decision: create pipeline run project rows lazily as project segments are encountered.
  - Why: the runtime can no longer pre-seed one row per project-group member. A run may visit zero, one, or multiple managed projects, and it may revisit the same managed project later.
  - Implementation direction: introduce an explicit segment order so the monitor can preserve `A -> B -> A` execution order even when the same managed project appears multiple times.

- Decision: keep `pipeline_runs.project_group_id` and `pipeline_schedules.project_group_id` as nullable compatibility fields instead of deleting them immediately.
  - Why: historical data, run filtering, and migration safety are easier if old rows remain readable while new rows simply write `NULL`.

- Decision: fail Git-oriented nodes with Chinese precheck messaging if no active managed project has been selected yet.
  - Why: implicit fallback would hide authoring mistakes. The pipeline should clearly tell the operator to add or move a `switch_project` node earlier in the sequence.

## Risks / Trade-offs
- Risk: existing monitoring UI is project-group oriented and may misread a repeated `A -> B -> A` sequence if project segments are flattened incorrectly.
  - Mitigation: persist project segments in encounter order and render them in that order, even when the same managed project appears multiple times.

- Risk: nullable `project_group_id` fields may temporarily increase branching in run list and schedule code.
  - Mitigation: keep all new reads tolerant of `NULL`, preserve old displays for historical rows, and introduce focused tests around mixed old/new data.

- Risk: schedule migration touches both DB validation and scheduler queue identity.
  - Mitigation: treat schedule identity as `(pipeline_definition_id, schedule_id, rendered parameters)` instead of `(pipeline_definition_id, project_group_id, ...)`.

## Migration Plan
1. Add schema migrations that relax pipeline schedule and pipeline run target columns and add any segment-order data needed for lazy project recording.
2. Add the `switch_project` node to editor models, payload validation, and runtime parsing without yet removing old project-group data.
3. Refactor runtime start paths so manual and scheduled runs seed zero project segments and create them only when `switch_project` executes.
4. Update run list/detail queries and UI to tolerate null project-group metadata and show encountered project segments instead.
5. Add the manual "run now" UI path after the backend request contract stops requiring `projectGroupId`.

## Open Questions
- Whether the monitor should rename "项目总数" to "项目段数" when a run revisits the same managed project multiple times, or keep the existing label for the first implementation.
