# Stage-Aware DAG GitLab Release Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the current linear `pipeline_*` release flow into a stage-aware DAG orchestrator with React Flow editing, stage-serial and in-stage-parallel execution, Chinese failure reporting, and derived retries for the full run, a stage, or a node.

**Architecture:** Keep the existing Tauri + React + SQLite split and reuse the current Git executor, GitLab adapter, failure envelope, waiting metadata, and run-monitor foundation. Add first-class `stage` and `edge` persistence, replace the linear runtime scheduler in `pipeline_runtime.rs` with a stage-aware DAG scheduler, then swap the current form editor for a React Flow canvas that reads and writes the new model.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, React Flow (`@xyflow/react`), Tauri 2, Rust, sqlx, SQLite, reqwest.

---

## Execution Notes

- Create a fresh OpenSpec change instead of mutating the older `refactor-release-pipeline-orchestrator` change. The older change documents the already-landed linear pipeline runtime; this work is a new architectural delta.
- Reuse the existing failure envelope and GitLab wait metadata model unless a failing test proves they are insufficient.
- Keep workflow compatibility wrappers read-only. All new writes go through pipeline-named commands and helpers.
- Prefer `cargo test -j 1 --manifest-path src-tauri/Cargo.toml <filter>` on Windows in this repo.
- Run `@superpowers:verification-before-completion` before claiming the implementation is complete.

## Milestone A: Spec And Storage Foundation

### Task 1: Create the OpenSpec change for stage-aware DAG release pipelines

**Files:**
- Create: `openspec/changes/add-stage-aware-dag-release-pipelines/proposal.md`
- Create: `openspec/changes/add-stage-aware-dag-release-pipelines/design.md`
- Create: `openspec/changes/add-stage-aware-dag-release-pipelines/tasks.md`
- Create: `openspec/changes/add-stage-aware-dag-release-pipelines/specs/release-pipeline-orchestration/spec.md`

**Step 1: Draft the proposal with the repo reality called out**

Write the proposal around the current gap:

- the repo already has a linear `pipeline_*` runtime
- the new change adds first-class stages, edges, DAG scheduling, React Flow editing, and stage or node retries
- v1 still excludes arbitrary script execution and the final CICD release node

**Step 2: Draft the design delta**

Capture these design decisions explicitly:

- `pipeline_stages`, `pipeline_edges`, and `pipeline_run_stages`
- stage-serial, in-stage-parallel execution
- failure policy: stop scheduling new nodes in the active stage, let already-started nodes finish, block downstream stages
- derived retries for run, stage, and node
- React Flow as the graph editor base

**Step 3: Draft the spec delta**

Add requirements and scenarios for:

- creating a stage-aware DAG definition
- validating illegal edges and cycles
- executing stages serially with in-stage parallelism
- stage-level blocking on failure
- stage retry and node retry lineage

**Step 4: Validate the change**

Run:

```powershell
openspec validate add-stage-aware-dag-release-pipelines --strict
```

Expected:

- PASS

**Step 5: Commit**

```powershell
git add -- "openspec/changes/add-stage-aware-dag-release-pipelines"
git commit -m "docs: add stage-aware DAG release pipeline spec"
```

### Task 2: Add the schema for stages, edges, and run-stage records

**Files:**
- Create: `src-tauri/migrations/0013_pipeline_stage_dag.sql`
- Create: `src-tauri/migrations/0014_pipeline_stage_runs.sql`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db.rs`
- Test: `src-tauri/src/db.rs`

**Step 1: Write the failing Rust DB tests**

Add tests in `src-tauri/src/db.rs` with these prefixes:

- `pipeline_stage_definition_`
- `pipeline_stage_run_`

Cover:

- fresh-install schema includes `pipeline_stages`, `pipeline_edges`, and `pipeline_run_stages`
- a pipeline definition can persist ordered stages, positioned nodes, and edges
- invalid stage references or cross-pipeline edges are rejected

**Step 2: Run the focused DB tests and confirm failure**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_stage_definition_
```

Expected:

- FAIL because the new tables and model fields do not exist yet

**Step 3: Add the definition migration**

In `0013_pipeline_stage_dag.sql`, add:

- `pipeline_stages`
- `pipeline_edges`
- `stage_id`, `node_key`, `position_x`, `position_y`, `enabled` columns for `pipeline_nodes`

Mirror existing migration style:

- `created_at` and `updated_at`
- foreign keys
- `CHECK` constraints for JSON and positive ordering
- indexes on `pipeline_definition_id`, `stage_order`, `source_node_id`, `target_node_id`

**Step 4: Add the run-stage migration**

In `0014_pipeline_stage_runs.sql`, add `pipeline_run_stages` with:

- run linkage
- stage snapshot fields
- stage status
- summary message
- timestamps

**Step 5: Add the minimum Rust types**

In `src-tauri/src/models.rs`, add:

- `PipelineStageInput`
- `PipelineStage`
- `PipelineEdgeInput`
- `PipelineEdge`
- `PipelineRunStage`

Also extend:

- `PipelineDefinitionDetail`
- `PipelineRunDetail`

**Step 6: Add the minimum DB hydration**

In `src-tauri/src/db.rs`, add helpers to:

- persist stages and edges
- load stages and edges for a definition
- serialize and deserialize stage-aware definition detail

Do not implement runtime scheduling in this task.

**Step 7: Re-run the focused DB tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_stage_definition_
```

Expected:

- PASS

**Step 8: Commit**

```powershell
git add -- "src-tauri/migrations/0013_pipeline_stage_dag.sql" "src-tauri/migrations/0014_pipeline_stage_runs.sql" "src-tauri/src/models.rs" "src-tauri/src/db.rs"
git commit -m "feat: add stage-aware pipeline schema"
```

## Milestone B: Definition CRUD And Validation

### Task 3: Upgrade pipeline definition CRUD to read and write stages plus edges

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src/__tests__/smoke.test.tsx`
- Test: `src-tauri/src/db.rs`

**Step 1: Write the failing definition CRUD tests**

Add or extend tests to expect:

- `create_pipeline_definition` accepts `stages`, `nodes`, and `edges`
- `get_pipeline_definition_detail` returns `stages`, `nodes`, and `edges`
- invalid DAG definitions fail before persistence

Add matching smoke assertions in `src/__tests__/smoke.test.tsx` for the TypeScript surface.

**Step 2: Run the focused tests and confirm failure**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_stage_definition_crud_
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:

- Rust FAIL because CRUD helpers do not accept the new shape
- frontend smoke FAIL because types and wrappers are stale

**Step 3: Implement DAG validation in `db.rs`**

Add validation helpers that reject:

- empty stage lists
- nodes without a stage
- edges to missing nodes
- cross-pipeline edges
- cycles
- edges from a later stage to an earlier stage

Keep the validator deterministic so the frontend and backend can share the same rules later.

**Step 4: Extend the Tauri command payloads**

Update:

- `create_pipeline_definition`
- `update_pipeline_definition`
- `get_pipeline_definition_detail`

so the payload shape includes:

- `stages`
- `nodes`
- `edges`

**Step 5: Extend TypeScript types and wrappers**

Update `src/lib/types.ts` and `src/lib/invoke.ts` to match the new payloads and responses.

**Step 6: Re-run the focused tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_stage_definition_crud_
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:

- PASS

**Step 7: Commit**

```powershell
git add -- "src-tauri/src/models.rs" "src-tauri/src/db.rs" "src-tauri/src/main.rs" "src/lib/types.ts" "src/lib/invoke.ts" "src/__tests__/smoke.test.tsx"
git commit -m "feat: persist stage-aware pipeline definitions"
```

## Milestone C: Stage-Aware Runtime

### Task 4: Replace the linear runtime scheduler with a stage-aware DAG scheduler

**Files:**
- Modify: `src-tauri/src/pipeline_runtime.rs`
- Modify: `src-tauri/src/runtime_support.rs`
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/db.rs`
- Test: `src-tauri/src/pipeline_runtime.rs`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Write the failing runtime tests**

Add tests with these prefixes:

- `pipeline_stage_runtime_runs_stage_two_only_after_stage_one_`
- `pipeline_stage_runtime_runs_independent_nodes_in_parallel_`
- `pipeline_stage_runtime_blocks_downstream_stages_after_failure_`
- `pipeline_stage_runtime_wait_node_persists_stage_waiting_context_`

Use temp repos and mock GitLab responses the same way the current runtime tests do.

**Step 2: Run the focused runtime tests and confirm failure**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_stage_runtime_
```

Expected:

- FAIL because the runtime still assumes linear `node_order` scheduling

**Step 3: Introduce stage execution planning**

In `pipeline_runtime.rs`:

- load stage snapshots alongside nodes and edges
- build per-stage executable graphs
- compute ready nodes from dependency satisfaction instead of pure ordering

**Step 4: Implement failure gating**

When a node fails:

- mark the node failed
- stop scheduling not-yet-started nodes in the active stage
- let already-started nodes finish
- mark the stage `failed` or `partial_failed`
- do not enqueue downstream stages

**Step 5: Persist stage runtime state**

Seed and update `pipeline_run_stages` so the runtime can expose:

- stage status
- stage summary
- stage start/finish timestamps

**Step 6: Keep current Git and GitLab node behavior**

Reuse the existing node execution branches and waiting metadata persistence. The only scheduler change should be how nodes become runnable.

**Step 7: Re-run the focused runtime tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_stage_runtime_
```

Expected:

- PASS

**Step 8: Commit**

```powershell
git add -- "src-tauri/src/pipeline_runtime.rs" "src-tauri/src/runtime_support.rs" "src-tauri/src/workflows.rs" "src-tauri/src/db.rs"
git commit -m "feat: add stage-aware DAG pipeline runtime"
```

### Task 5: Add derived retries for full run, stage, and node targets

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/pipeline_runtime.rs`
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src-tauri/src/workflows.rs`
- Test: `src/__tests__/smoke.test.tsx`

**Step 1: Write the failing retry tests**

Add tests for:

- full rerun creates a new `pipeline_run` with `source_pipeline_run_id`
- stage retry marks earlier successful stages as `reused`
- node retry reruns the selected node and its downstream dependency chain only

Also extend smoke coverage for the new retry request shape.

**Step 2: Run the focused retry tests and confirm failure**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_stage_retry_
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:

- FAIL because the runtime only supports full-run retry semantics today

**Step 3: Add an explicit retry target model**

In Rust and TypeScript, add a retry request that carries:

- `retryMode`: `full_run` | `stage` | `node`
- `targetStageId` or `targetRunNodeId` when needed
- optional variable overrides

Prefer extending `retry_pipeline_run` over creating multiple commands.

**Step 4: Seed reused stages and nodes**

When retrying from a stage or node:

- clone the run header
- seed `pipeline_run_stages` and `pipeline_run_nodes`
- mark prior successful work as `reused`
- only schedule the selected restart slice

**Step 5: Re-run the focused retry tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_stage_retry_
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:

- PASS

**Step 6: Commit**

```powershell
git add -- "src-tauri/src/models.rs" "src-tauri/src/db.rs" "src-tauri/src/pipeline_runtime.rs" "src-tauri/src/workflows.rs" "src-tauri/src/main.rs" "src/lib/types.ts" "src/lib/invoke.ts" "src/__tests__/smoke.test.tsx"
git commit -m "feat: add stage and node pipeline retries"
```

## Milestone D: React Flow Definition Editor

### Task 6: Add React Flow and build the graph model translation layer

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/components/pipeline-graph/graph-model.ts`
- Create: `src/components/pipeline-graph/__tests__/graph-model.test.ts`
- Modify: `src/components/pipeline-editor/draft-model.ts`
- Test: `src/components/pipeline-editor/__tests__/draft-model.test.ts`

**Step 1: Add the dependency**

Run:

```powershell
pnpm add @xyflow/react
```

Expected:

- dependency added to `package.json` and lockfile updated

**Step 2: Write the failing graph-model tests**

Add tests that verify:

- pipeline detail converts to React Flow nodes and edges
- stage rows become group nodes
- regular pipeline nodes keep stage ownership and positions
- graph edits serialize back to the persisted stage-aware definition shape

**Step 3: Run the focused frontend tests and confirm failure**

Run:

```powershell
pnpm test -- src/components/pipeline-graph/__tests__/graph-model.test.ts src/components/pipeline-editor/__tests__/draft-model.test.ts
```

Expected:

- FAIL because the translation layer and stage-aware draft model do not exist yet

**Step 4: Implement `graph-model.ts`**

Add pure functions to translate:

- DB detail -> draft graph
- draft graph -> create/update payload

Keep layout math and DAG validation out of React components.

**Step 5: Extend the draft model**

Update `draft-model.ts` to support:

- stage rows
- node ownership by stage
- edges
- position fields
- retry-compatible built-in node metadata

**Step 6: Re-run the focused frontend tests**

Run:

```powershell
pnpm test -- src/components/pipeline-graph/__tests__/graph-model.test.ts src/components/pipeline-editor/__tests__/draft-model.test.ts
```

Expected:

- PASS

**Step 7: Commit**

```powershell
git add -- "package.json" "pnpm-lock.yaml" "src/components/pipeline-graph/graph-model.ts" "src/components/pipeline-graph/__tests__/graph-model.test.ts" "src/components/pipeline-editor/draft-model.ts" "src/components/pipeline-editor/__tests__/draft-model.test.ts"
git commit -m "feat: add stage-aware pipeline graph model"
```

### Task 7: Replace the current linear editor UI with a React Flow canvas

**Files:**
- Create: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Create: `src/components/pipeline-graph/StageGroupNode.tsx`
- Create: `src/components/pipeline-graph/PipelineActionNode.tsx`
- Create: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`
- Modify: `src/components/pipeline-editor/PipelineDraftForm.tsx`
- Modify: `src/pages/WorkflowsPagePipeline.tsx`
- Test: `src/pages/__tests__/workflow-definition-variables.test.tsx`

**Step 1: Write the failing editor interaction tests**

Cover:

- adding a stage
- adding a node into a stage
- connecting nodes
- blocking invalid connections
- saving and reloading graph state

**Step 2: Run the focused editor tests and confirm failure**

Run:

```powershell
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/pages/__tests__/workflow-definition-variables.test.tsx
```

Expected:

- FAIL because the editor still renders the old linear form only

**Step 3: Implement the graph editor**

Build:

- a stage group node component
- a pipeline action node component
- connection validation hooks
- a property side panel driven by the selected graph node

Reuse the current built-in node parameter forms instead of rewriting them from scratch.

**Step 4: Integrate the editor into the pipeline page**

Update `PipelineDraftForm.tsx` and `WorkflowsPagePipeline.tsx` so create and edit dialogs use the React Flow editor while keeping the rest of the page shell intact.

**Step 5: Re-run the focused editor tests**

Run:

```powershell
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/pages/__tests__/workflow-definition-variables.test.tsx
```

Expected:

- PASS

**Step 6: Commit**

```powershell
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/StageGroupNode.tsx" "src/components/pipeline-graph/PipelineActionNode.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx" "src/components/pipeline-editor/PipelineDraftForm.tsx" "src/pages/WorkflowsPagePipeline.tsx" "src/pages/__tests__/workflow-definition-variables.test.tsx"
git commit -m "feat: add React Flow pipeline editor"
```

## Milestone E: Run Monitor And Retry UX

### Task 8: Add stage summaries and retry controls to the run monitor

**Files:**
- Create: `src/components/pipeline-run-monitor/PipelineRunStageSummary.tsx`
- Create: `src/components/pipeline-run-monitor/__tests__/PipelineRunStageSummary.test.tsx`
- Modify: `src/pages/WorkflowRunsPagePipeline.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src/__tests__/smoke.test.tsx`

**Step 1: Write the failing run-monitor tests**

Cover:

- displaying stage-level status pills and summaries
- showing the downstream block reason after stage failure
- rendering retry actions for full run, stage, and node
- hiding retry actions for non-terminal runs

**Step 2: Run the focused tests and confirm failure**

Run:

```powershell
pnpm test -- src/components/pipeline-run-monitor/__tests__/PipelineRunStageSummary.test.tsx src/__tests__/smoke.test.tsx
```

Expected:

- FAIL because the run detail shape and UI do not expose stage records or retry targets

**Step 3: Implement the stage summary component**

Render:

- stage name
- stage status
- stage summary message
- timestamps
- retry button when eligible

**Step 4: Wire the retry controls**

Update `WorkflowRunsPagePipeline.tsx` to:

- call the extended `retry_pipeline_run` request
- support retry mode selection
- show reused stage or node semantics clearly

**Step 5: Re-run the focused tests**

Run:

```powershell
pnpm test -- src/components/pipeline-run-monitor/__tests__/PipelineRunStageSummary.test.tsx src/__tests__/smoke.test.tsx
```

Expected:

- PASS

**Step 6: Commit**

```powershell
git add -- "src/components/pipeline-run-monitor/PipelineRunStageSummary.tsx" "src/components/pipeline-run-monitor/__tests__/PipelineRunStageSummary.test.tsx" "src/pages/WorkflowRunsPagePipeline.tsx" "src/lib/types.ts" "src/lib/invoke.ts" "src/__tests__/smoke.test.tsx"
git commit -m "feat: add stage-aware pipeline monitoring"
```

## Milestone F: Final Verification And Documentation

### Task 9: Validate the full change, update docs, and capture rollout guidance

**Files:**
- Modify: `README.md`
- Modify: `UPDATE.md`
- Modify: `openspec/changes/add-stage-aware-dag-release-pipelines/tasks.md`
- Test: `src-tauri/src/db.rs`
- Test: `src-tauri/src/pipeline_runtime.rs`
- Test: `src-tauri/src/workflows.rs`
- Test: `src/__tests__/smoke.test.tsx`

**Step 1: Update user-facing docs**

Document:

- stage-aware DAG terminology
- React Flow-based editor behavior
- retry semantics
- current v1 limits

**Step 2: Mark the OpenSpec tasks complete**

Set every implemented task in `openspec/changes/add-stage-aware-dag-release-pipelines/tasks.md` to `- [x]`.

**Step 3: Run backend verification**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_stage_
cargo test -j 1 --manifest-path src-tauri/Cargo.toml workflows::tests::pipeline
```

Expected:

- PASS

**Step 4: Run frontend verification**

Run:

```powershell
pnpm test
pnpm build
```

Expected:

- PASS

**Step 5: Validate OpenSpec**

Run:

```powershell
openspec validate add-stage-aware-dag-release-pipelines --strict
```

Expected:

- PASS

**Step 6: Commit**

```powershell
git add -- "README.md" "UPDATE.md" "openspec/changes/add-stage-aware-dag-release-pipelines/tasks.md"
git commit -m "docs: finalize stage-aware DAG release automation"
```
