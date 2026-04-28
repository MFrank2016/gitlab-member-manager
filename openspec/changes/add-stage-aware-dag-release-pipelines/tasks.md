## 1. Spec And Persistence
- [x] 1.1 Add OpenSpec deltas for stage-aware DAG definitions, stage-serial and in-stage-parallel runtime semantics, and stage or node derived retries.
- [x] 1.2 Add SQLite schema, Rust models, and DB helpers for `pipeline_stages`, `pipeline_edges`, and `pipeline_run_stages`.
- [x] 1.3 Add validation coverage for cycles, invalid stage references, and illegal cross-stage dependencies.

## 2. Runtime
- [x] 2.1 Replace the linear pipeline scheduler with a stage-aware DAG scheduler while reusing the current Git and GitLab node executors.
- [x] 2.2 Persist stage runtime state, waiting metadata, Chinese failure summaries, and reused-state markers.
- [x] 2.3 Add derived retry entry points for full-run, stage, and node retries.

## 3. UI
- [x] 3.1 Add a React Flow based pipeline editor with stage grouping, custom action nodes, and graph validation guardrails.
- [x] 3.2 Extend the run monitor to show stage summaries, downstream blocking reasons, and retry actions.
- [x] 3.3 Keep pipeline terminology and existing migration-window compatibility behavior intact during the rollout.

## 4. Verification
- [x] 4.1 Run focused Rust tests for schema, DAG validation, stage runtime scheduling, and retry lineage.
- [x] 4.2 Run focused frontend tests for graph translation, graph editing, and run-monitor retry UX.
- [x] 4.3 Validate the OpenSpec change with `openspec validate add-stage-aware-dag-release-pipelines --strict`.
