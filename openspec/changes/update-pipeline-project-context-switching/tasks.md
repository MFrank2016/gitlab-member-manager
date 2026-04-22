## 1. Runtime And Persistence
- [ ] 1.1 Add schema changes so new pipeline schedules and pipeline runs do not require `project_group_id`, while historical rows remain readable.
- [ ] 1.2 Refactor pipeline runtime start paths to launch without pre-expanded project-group members and record project segments lazily as `switch_project` nodes execute.
- [ ] 1.3 Extend execution context to carry the active managed project plus working directory, and fail later Git or GitLab nodes with Chinese precheck guidance when no project has been selected yet.
- [ ] 1.4 Update scheduler queue identity and scheduled execution to rely on node-driven project context instead of schedule-level project-group targets.

## 2. Editor And UI
- [ ] 2.1 Add the built-in `switch_project` node to the pipeline editor, persist `managedProjectId`, and show the selected managed project name in forms and summaries.
- [ ] 2.2 Remove pipeline schedule editing requirements for project groups and keep schedule validation focused on time rules, variables, and policy.
- [ ] 2.3 Add a manual pipeline run entry point that starts a run without asking for a project group.
- [ ] 2.4 Update run monitoring views to handle null project-group metadata and display encountered project segments in execution order.

## 3. Validation
- [ ] 3.1 Add Rust regression coverage for `switch_project`, missing-project precheck failures, lazy project-segment recording, and schedule execution without `project_group_id`.
- [ ] 3.2 Add frontend tests for the `switch_project` editor, project-name display, manual run launcher, and run-monitor rendering with project-group-free runs.
- [ ] 3.3 Run `openspec validate update-pipeline-project-context-switching --strict`.
