# Release Pipeline Orchestrator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current workflow-centered execution model with a unified release pipeline orchestrator that supports migration, GitLab-aware nodes, scheduling, Chinese-facing failure reporting, and a transition window from legacy `workflow_*` data.

**Architecture:** Keep the current Tauri + React + SQLite split, but evolve the existing workflow implementation in place instead of introducing a parallel feature silo. Add the `pipeline_*` schema and migration path first, then expose new Tauri and frontend surfaces, then refactor the executor and GitLab integration, and finally upgrade the UI and rollout documentation while keeping legacy `workflow_*` data readable during the transition window.

**Tech Stack:** React 18, TypeScript, Vite, Tauri 2, Rust, sqlx, SQLite, Vitest.

---

## Prerequisites
- Use @superpowers:using-git-worktrees before implementation.
- Follow @superpowers:test-driven-development for each task.
- Use @superpowers:verification-before-completion before claiming the change is done.
- Read `openspec/changes/refactor-release-pipeline-orchestrator/proposal.md`.
- Read `openspec/changes/refactor-release-pipeline-orchestrator/design.md`.
- Validate the change before coding: `openspec validate refactor-release-pipeline-orchestrator --strict`.
- Review the current legacy implementation in `src-tauri/src/workflows.rs`, `src/pages/WorkflowsPage.tsx`, and `src/pages/WorkflowRunsPage.tsx`.

---

### Task 1: Add the `pipeline_*` schema and basic persistence helpers

**Files:**
- Create: `src-tauri/migrations/0007_pipeline_definitions.sql`
- Create: `src-tauri/migrations/0008_pipeline_runs.sql`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Test: `src-tauri/src/db.rs`

**Step 1: Write the failing migration-backed tests**

Add Rust tests that initialize a temp database and expect:
- empty `list_pipeline_definitions()` and `list_pipeline_runs()` results on a fresh database
- successful creation and readback of a pipeline definition with variables, nodes, and schedules

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 pipeline_definition`
Expected: FAIL because the `pipeline_*` tables, models, and query helpers do not exist.

**Step 3: Add the schema and model types**

Add tables for:
- `pipeline_definitions`
- `pipeline_variables`
- `pipeline_nodes`
- `pipeline_schedules`
- `pipeline_runs`
- `pipeline_run_nodes`

Add Rust structs for pipeline definitions, variables, nodes, schedules, runs, and run-node views.

**Step 4: Add minimal DB helpers**

Implement the minimal helpers needed by the failing tests, including:
- create pipeline definition
- list pipeline definitions
- get pipeline definition detail
- list pipeline runs

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 pipeline_definition`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/migrations/0007_pipeline_definitions.sql src-tauri/migrations/0008_pipeline_runs.sql src-tauri/src/db.rs src-tauri/src/models.rs
git commit -m "feat: add pipeline orchestrator schema"
```

---

### Task 2: Add idempotent migration from legacy `workflow_*` data

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/db.rs`

**Step 1: Write the failing upgrade test**

Add a Rust test that seeds legacy `workflow_definitions`, `workflow_steps`, `workflow_runs`, and related rows, then expects an upgrade path to produce equivalent `pipeline_*` records exactly once.

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 pipeline_migration`
Expected: FAIL because the migration pass and duplicate-prevention logic do not exist.

**Step 3: Implement the migration helpers**

Implement migration helpers that:
- map legacy workflow definitions to pipeline definitions
- map legacy variables to pipeline variables
- map legacy steps to pipeline nodes
- map legacy run history to pipeline runs and run nodes
- prevent duplicate migration on repeated startup

**Step 4: Wire the migration pass into startup**

Invoke the migration during app startup after database initialization and before the UI command surface starts using `pipeline_*` writes.

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 pipeline_migration`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/main.rs
git commit -m "feat: migrate legacy workflows into pipeline model"
```

---

### Task 3: Expose pipeline CRUD and run commands through Tauri and TypeScript

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src/__tests__/smoke.test.tsx`

**Step 1: Write the failing frontend surface test**

Add or update a frontend test that expects pipeline-named wrappers and command usage, for example:
- `listPipelineDefinitions()`
- `createPipelineDefinition()`
- `listPipelineRuns()`
- `getPipelineRunDetail()`

**Step 2: Run test or build to verify it fails**

Run: `pnpm build`
Expected: FAIL because the pipeline command names, TypeScript types, and wrappers do not exist yet.

**Step 3: Add Tauri commands**

Expose pipeline-named commands for:
- `create_pipeline_definition`
- `list_pipeline_definitions`
- `get_pipeline_definition_detail`
- `update_pipeline_definition`
- `delete_pipeline_definition`
- `list_pipeline_runs`
- `get_pipeline_run_detail`
- `execute_pipeline_run`
- `cancel_pipeline_run`
- `retry_pipeline_run`

Keep any temporary workflow-named compatibility wrappers read-only if they are still needed during the transition window.

**Step 4: Add TypeScript types and invoke wrappers**

Define pipeline-specific TypeScript types and wrappers in:
- `src/lib/types.ts`
- `src/lib/invoke.ts`

Prefer pipeline terminology in all new exported API names.

**Step 5: Run verification**

Run: `pnpm build`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/src/db.rs src-tauri/src/models.rs src/lib/types.ts src/lib/invoke.ts src/__tests__/smoke.test.tsx
git commit -m "feat: expose pipeline command surface"
```

---

### Task 4: Refactor the executor to run pipeline nodes and persist structured failures

**Files:**
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/lib/types.ts`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Write the failing executor tests**

Add temp-repo integration tests that:
- execute a pipeline definition using the existing Git node behavior
- persist node status transitions and rendered variables
- store structured Chinese failure payloads when a node fails

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 pipeline_runtime`
Expected: FAIL because the executor still loads legacy workflow records and does not emit structured pipeline failure envelopes.

**Step 3: Refactor the runtime**

Update the executor to:
- load `pipeline_*` definitions and nodes
- render pipeline-level variables before each node executes
- preserve the current checkout, pull, merge, and push behavior
- persist run-node state transitions, output context, and rendered config

**Step 4: Add structured failure persistence**

Persist a node-level error object that contains:
- stable `error_code`
- `title_zh`
- `detail_zh`
- `suggestion_zh`
- raw technical evidence

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 pipeline_runtime`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/workflows.rs src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/main.rs src/lib/types.ts
git commit -m "feat: run pipelines with structured failures"
```

---

### Task 5: Add GitLab release nodes and commit-aware waiting

**Files:**
- Modify: `src-tauri/src/gitlab.rs`
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/gitlab.rs`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Write the failing GitLab node tests**

Add tests that cover:
- `check_pipeline` success and failure
- `wait_pipeline` waiting on a commit-specific pipeline
- branch-head fallback for health-check scenarios
- `trigger_pipeline` recording the downstream pipeline identifier

Use mock HTTP responses for auth errors, project-not-found responses, and timeout paths.

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 pipeline_gitlab`
Expected: FAIL because the GitLab node types and wait semantics do not exist.

**Step 3: Implement the adapter methods**

Add GitLab adapter support for:
- checking the latest or commit-specific pipeline
- polling pipeline status with timeout handling
- triggering a downstream pipeline with captured evidence

**Step 4: Integrate the nodes into execution**

Teach the executor to:
- enter a persisted waiting state for `wait_pipeline`
- store the current wait target and latest observed status
- continue or fail the run based on the GitLab result

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 pipeline_gitlab`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/gitlab.rs src-tauri/src/workflows.rs src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/main.rs
git commit -m "feat: add GitLab pipeline orchestration nodes"
```

---

### Task 6: Add schedule CRUD and the desktop-bound scheduler loop

**Files:**
- Create: `src-tauri/src/scheduler.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src-tauri/src/db.rs`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Write the failing schedule tests**

Add backend tests that expect:
- schedule CRUD for daily and weekly rules
- variable overrides and timezone storage
- concurrency-policy handling for `skip_if_running`, `queue_after_running`, and `allow_parallel`

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 pipeline_schedule`
Expected: FAIL because schedule persistence and scheduler runtime behavior do not exist.

**Step 3: Implement schedule persistence and scheduler tick handling**

Add:
- schedule CRUD helpers in `db.rs`
- typed schedule models in `models.rs`
- a scheduler loop in `scheduler.rs`
- startup wiring in `main.rs`

Keep the v1 limitation explicit: schedules only fire while the desktop app is open.

**Step 4: Expose commands and frontend wrappers**

Add Tauri commands and TypeScript wrappers for listing, creating, updating, and deleting pipeline schedules.

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 pipeline_schedule`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/scheduler.rs src-tauri/src/main.rs src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/workflows.rs src/lib/types.ts src/lib/invoke.ts
git commit -m "feat: add pipeline scheduling support"
```

---

### Task 7: Upgrade the definition editor to pipeline terminology and schedule editing

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/pages/WorkflowsPage.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Modify: `src/__tests__/smoke.test.tsx`
- Modify: `src/pages/__tests__/workflow-definition-variables.test.tsx`

**Step 1: Write the failing UI test**

Add or update tests that expect the definition page to:
- use pipeline terminology in visible copy
- show tabs for basics, variables, nodes, and schedules
- create and edit structured schedules
- keep migrated legacy definitions visible through the new pipeline UI

**Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL because the current page still behaves like a workflow-only editor and has no schedule editing.

**Step 3: Implement the UI changes**

Upgrade `src/pages/WorkflowsPage.tsx` so it becomes the transition-period pipeline editor:
- keep the file path for incremental delivery
- switch labels, headings, buttons, and state names to pipeline terminology
- add schedule editing alongside basics, variables, and nodes

**Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/App.tsx src/components/ui/sidebar.tsx src/pages/WorkflowsPage.tsx src/lib/types.ts src/lib/invoke.ts src/__tests__/smoke.test.tsx src/pages/__tests__/workflow-definition-variables.test.tsx
git commit -m "feat: upgrade workflow editor into pipeline editor"
```

---

### Task 8: Upgrade run monitoring, waiting details, and rerun flows

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/pages/WorkflowRunsPage.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Write the failing run-monitor test**

Add or update tests that expect the run monitor to show:
- current waiting target and latest observed status
- Chinese failure title, detail, and suggestion
- technical evidence in a collapsible area
- rerun actions for failed or selected restart points

**Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL because the current monitor only exposes legacy workflow details and does not show the new pipeline wait/error model.

**Step 3: Implement the monitor changes**

Upgrade `src/pages/WorkflowRunsPage.tsx` to:
- prefer pipeline terminology in headings and actions
- render waiting metadata and rerun lineage
- support restart actions based on the new pipeline run shape

**Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/App.tsx src/components/ui/sidebar.tsx src/pages/WorkflowRunsPage.tsx src/lib/types.ts src/lib/invoke.ts src/__tests__/smoke.test.tsx
git commit -m "feat: upgrade pipeline run monitoring"
```

---

### Task 9: Finish rollout documentation and run full verification

**Files:**
- Modify: `README.md`
- Modify: `openspec/changes/refactor-release-pipeline-orchestrator/tasks.md`

**Step 1: Document the transition window**

Update `README.md` with:
- the `workflow_*` to `pipeline_*` transition behavior
- the temporary compatibility window
- the criteria for hiding or removing legacy workflow routes, commands, and tables

**Step 2: Validate OpenSpec**

Run: `openspec validate refactor-release-pipeline-orchestrator --strict`
Expected: PASS

**Step 3: Run frontend verification**

Run: `pnpm test`
Expected: PASS

Run: `pnpm build`
Expected: PASS

**Step 4: Run Rust verification**

Run: `cargo test -j 1`
Expected: PASS

**Step 5: Run manual desktop verification**

Run: `pnpm tauri dev`
Expected:
- the pipeline definition page can edit variables, nodes, and schedules
- the pipeline runs page shows waiting targets, Chinese failure summaries, and rerun actions
- migrated legacy workflow records are visible through the new pipeline UI

**Step 6: Mark the OpenSpec checklist complete**

Set every item in `openspec/changes/refactor-release-pipeline-orchestrator/tasks.md` to `- [x]` only after all verification steps above are passing.

**Step 7: Commit**

```bash
git add README.md openspec/changes/refactor-release-pipeline-orchestrator/tasks.md
git commit -m "docs: finalize pipeline orchestrator rollout"
```
