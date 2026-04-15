## 1. Data Model And Migration
- [ ] 1.1 Add `pipeline_*` schema, Rust models, and persistence helpers for definitions, variables, nodes, schedules, runs, and run nodes.
- [ ] 1.2 Implement idempotent migration from existing `workflow_*` definitions, variables, steps, and run history into the new pipeline model.
- [ ] 1.3 Add migration coverage for both fresh installs and upgrades from populated legacy data.

## 2. Runtime And Adapters
- [ ] 2.1 Refactor the Rust executor to operate on typed pipeline nodes while preserving the current Git node behavior.
- [ ] 2.2 Persist runtime state for waiting nodes, rendered variables, output context, and derived rerun lineage.
- [ ] 2.3 Emit structured Chinese-facing error envelopes plus raw technical evidence for every failed node.

## 3. GitLab Release Nodes
- [ ] 3.1 Add `check_pipeline`, `wait_pipeline`, and `trigger_pipeline` nodes in the GitLab adapter and Tauri command surface.
- [ ] 3.2 Implement commit-aware wait semantics, with an explicit branch-head fallback for health-check style scenarios.
- [ ] 3.3 Add mock-based tests for success, failure, timeout, auth, and project-not-found paths.

## 4. Pipeline Definition And Monitoring UI
- [ ] 4.1 Upgrade the current workflow definition UI into a pipeline definition editor with tabs for basics, variables, nodes, and schedules.
- [ ] 4.2 Upgrade the run monitor UI to show waiting targets, Chinese failure summaries, suggestions, and technical evidence.
- [ ] 4.3 Transition navigation and copy from workflow terminology to pipeline terminology while preserving access to migrated records during the rollout window.

## 5. Scheduling And Retry
- [ ] 5.1 Add structured schedule CRUD with timezone, daily or weekly time rules, variable overrides, and concurrency policy.
- [ ] 5.2 Execute schedules only while the desktop app is running and honor `skip_if_running`, `queue_after_running`, and `allow_parallel`.
- [ ] 5.3 Support derived reruns from failed or user-selected restart points using `source_run_id`.

## 6. Verification And Rollout
- [ ] 6.1 Validate the proposal with `openspec validate refactor-release-pipeline-orchestrator --strict`.
- [ ] 6.2 Run frontend, Rust, GitLab adapter, and migration tests for definitions, execution, scheduling, and upgrade paths.
- [ ] 6.3 Document the transition-window behavior and the criteria for hiding or removing legacy `workflow_*` routes, commands, and tables.
