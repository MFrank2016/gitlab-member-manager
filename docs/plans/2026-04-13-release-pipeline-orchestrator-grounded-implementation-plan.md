# Release Pipeline Orchestrator Grounded Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the release pipeline orchestrator in an order that matches the current repository reality, reusing the existing workflow engine where it is already strong and delaying risky UI renames until the new pipeline runtime is stable.

**Architecture:** Keep the current Tauri + React + SQLite split and introduce `pipeline_*` alongside the existing `workflow_*` model for one transition release. Reuse the current Git-step executor, concurrency control, retry semantics, and page shells, but move persistence and command surfaces to `pipeline_*`. Treat the existing `2026-04-11` plan as target-state reference; use this grounded plan as the actual execution order.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Tauri 2, Rust, sqlx, SQLite, reqwest.

---

## Execution Notes

- Use `openspec/changes/refactor-release-pipeline-orchestrator/` as the authoritative product scope.
- Keep `src/pages/WorkflowsPage.tsx` and `src/pages/WorkflowRunsPage.tsx` file paths during the transition window; rename only after the pipeline UI is stable.
- Add `pipeline_run_projects` even though the earlier implementation plan did not list it explicitly. The current runtime, retry semantics, and run-monitor UI are already project-scoped, so collapsing directly to `pipeline_runs -> pipeline_run_nodes` would create avoidable churn.
- Keep workflow-named compatibility wrappers read-only during the transition window. All new writes must go through pipeline-named backend helpers and Tauri commands.
- Prefer `cargo test -j 1 --manifest-path src-tauri/Cargo.toml <filter>` on Windows for Rust verification in this repo.

## Milestone A: Data Model Readiness

### Task 1: Add the `pipeline_*` schema and minimal persistence without touching runtime behavior

**Files:**
- Create: `src-tauri/migrations/0007_pipeline_definitions.sql`
- Create: `src-tauri/migrations/0008_pipeline_runs.sql`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db.rs`
- Test: `src-tauri/src/db.rs`

**Step 1: Write the failing fresh-install tests**

Add Rust tests in `src-tauri/src/db.rs` that expect:
- `list_pipeline_definitions()` returns `[]` on a fresh database
- `list_pipeline_runs()` returns `[]` on a fresh database
- `create_pipeline_definition()` can persist:
  - definition metadata
  - pipeline variables
  - ordered pipeline nodes
  - one or more schedules

Name the new tests with the `pipeline_definition` prefix so they are easy to target.

**Step 2: Run the focused Rust tests and confirm they fail**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_definition
```

Expected:
- FAIL because the `pipeline_*` tables, models, and helper functions do not exist yet

**Step 3: Add the new tables using the current workflow schema as the template**

Create `0007_pipeline_definitions.sql` with:
- `pipeline_definitions`
- `pipeline_variables`
- `pipeline_nodes`
- `pipeline_schedules`

Create `0008_pipeline_runs.sql` with:
- `pipeline_runs`
- `pipeline_run_projects`
- `pipeline_run_nodes`

Mirror the existing `workflow_*` migration style for:
- `created_at` / `updated_at`
- JSON `CHECK` constraints
- `UNIQUE` constraints on order fields
- foreign-key delete behavior
- secondary indexes

Add nullable legacy back-reference columns for migration idempotency:
- `pipeline_definitions.legacy_workflow_definition_id`
- `pipeline_runs.legacy_workflow_run_id`

**Step 4: Add the minimum `Pipeline*` Rust types and DB helpers**

In `src-tauri/src/models.rs`, add:
- `PipelineVariableInput`
- `PipelineNodeInput`
- `PipelineScheduleInput`
- `PipelineDefinitionListItem`
- `PipelineDefinitionDetail`
- `PipelineRunListItem`
- `PipelineRunDetail`

In `src-tauri/src/db.rs`, add the minimum helpers required by the new tests:
- `create_pipeline_definition`
- `list_pipeline_definitions`
- `get_pipeline_definition_detail`
- `list_pipeline_runs`

Do not move execution logic yet. This task only establishes storage and read models.

**Step 5: Re-run the focused Rust tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_definition
```

Expected:
- PASS

**Step 6: Commit**

```powershell
git add src-tauri/migrations/0007_pipeline_definitions.sql src-tauri/migrations/0008_pipeline_runs.sql src-tauri/src/models.rs src-tauri/src/db.rs
git commit -m "feat: add pipeline orchestrator schema"
```

---

### Task 2: Add idempotent migration from `workflow_*` into `pipeline_*`

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/db.rs`

**Step 1: Write the failing upgrade tests**

Add Rust tests in `src-tauri/src/db.rs` that:
- seed legacy `workflow_definitions`, `workflow_steps`, `workflow_runs`, `workflow_run_projects`, and `workflow_run_steps`
- execute the migration helper once and assert pipeline rows are created
- execute the migration helper a second time and assert row counts do not increase

Name the new tests with the `pipeline_migration` prefix.

**Step 2: Run the focused migration tests and confirm they fail**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_migration
```

Expected:
- FAIL because no migration helper or duplicate-prevention logic exists

**Step 3: Implement migration helpers in `db.rs`**

Add helpers that:
- copy workflow definitions into pipeline definitions
- copy workflow variables into pipeline variables
- map workflow steps into pipeline nodes
- map workflow runs into pipeline runs
- map workflow run projects into pipeline run projects
- map workflow run steps into pipeline run nodes

Use the legacy back-reference columns instead of a separate mapping table unless test evidence shows the uniqueness strategy is insufficient.

**Step 4: Wire migration into startup before new pipeline writes**

In `src-tauri/src/main.rs`, after `db::init_db(...)` and before command registration is exercised by the UI:
- run the pipeline migration helper
- log migrated counts
- keep startup resilient if there is nothing to migrate

Do not remove the existing stale workflow-run reconcile yet; keep it until the pipeline runtime replaces workflow execution.

**Step 5: Re-run the focused migration tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_migration
```

Expected:
- PASS

**Step 6: Commit**

```powershell
git add src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/main.rs
git commit -m "feat: migrate workflows into pipeline model"
```

---

### Task 3: Expose the new pipeline command surface while keeping workflow wrappers readable

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src/__tests__/smoke.test.tsx`

**Step 1: Extend the frontend smoke test to expect pipeline wrappers**

Update `src/__tests__/smoke.test.tsx` so it expects the new TypeScript API surface:
- `listPipelineDefinitions()`
- `createPipelineDefinition()`
- `listPipelineRuns()`
- `getPipelineRunDetail()`

Keep the existing workflow smoke assertions until the transition policy is explicitly removed.

**Step 2: Run the frontend smoke test and confirm it fails**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- FAIL because the pipeline wrappers and Tauri commands do not exist yet

**Step 3: Add the pipeline-named Tauri commands**

In `src-tauri/src/main.rs`, register:
- `create_pipeline_definition`
- `list_pipeline_definitions`
- `get_pipeline_definition_detail`
- `update_pipeline_definition`
- `delete_pipeline_definition`
- `list_pipeline_runs`
- `get_pipeline_run_detail`

Add execution command stubs only if they can already point at pipeline-backed helpers. Do not create fake no-op runtime commands.

**Step 4: Add pipeline types and wrappers**

In `src/lib/types.ts` and `src/lib/invoke.ts`:
- add `Pipeline*` types
- add pipeline-named wrappers
- keep workflow wrappers as compatibility paths, but stop expanding them

**Step 5: Re-run smoke coverage and build**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
pnpm build
```

Expected:
- PASS

**Step 6: Commit**

```powershell
git add src-tauri/src/main.rs src-tauri/src/models.rs src-tauri/src/db.rs src/lib/types.ts src/lib/invoke.ts src/__tests__/smoke.test.tsx
git commit -m "feat: expose pipeline command surface"
```

---

## Milestone B: Runtime Readiness

### Task 4: Extract pipeline-neutral executor helpers from the current workflow engine

**Files:**
- Modify: `src-tauri/src/workflows.rs`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Add targeted regression tests around the reusable executor pieces**

Add or expand tests in `src-tauri/src/workflows.rs` for:
- run-parameter normalization
- step rendering
- Git operation parsing
- step precheck behavior

Name these tests with the `pipeline_runtime_refactor` prefix.

**Step 2: Run the targeted tests and record the baseline**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_refactor
```

Expected:
- PASS or reveal gaps in current coverage that must be filled before refactor

**Step 3: Refactor the helper layer without changing behavior**

In `src-tauri/src/workflows.rs`, extract or rename internal helpers so they are no longer workflow-specific:
- step rendering helper
- step-operation builder
- Git precheck helper
- repo precheck helper
- command execution helper

Do not switch storage to `pipeline_*` in this task. The point is to reduce the size of the later runtime diff.

**Step 4: Re-run the targeted tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_refactor
```

Expected:
- PASS

**Step 5: Commit**

```powershell
git add src-tauri/src/workflows.rs
git commit -m "refactor: extract pipeline-neutral executor helpers"
```

---

### Task 5: Run pipeline definitions with the existing Git node behavior and structured failure envelopes

**Files:**
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Write the failing pipeline-runtime tests**

Add integration tests in `src-tauri/src/workflows.rs` that:
- execute a pipeline definition containing the current Git node types
- persist `pipeline_runs`, `pipeline_run_projects`, and `pipeline_run_nodes`
- store rendered variable snapshots
- store a structured failure envelope with:
  - `error_code`
  - `title_zh`
  - `detail_zh`
  - `suggestion_zh`
  - raw technical evidence

Name these tests with the `pipeline_runtime` prefix.

**Step 2: Run the focused runtime tests and confirm they fail**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
```

Expected:
- FAIL because the runtime still seeds and executes `workflow_*` rows

**Step 3: Switch seeding and execution to `pipeline_*`**

Reuse the extracted helpers from Task 4, but change the runtime to:
- load pipeline definitions and ordered pipeline nodes
- render pipeline variables before node execution
- seed `pipeline_runs`, `pipeline_run_projects`, and `pipeline_run_nodes`
- persist status transitions and rendered config in the pipeline tables

**Step 4: Add the new execution commands**

In backend and TypeScript wrapper layers, add:
- `execute_pipeline_run`
- `cancel_pipeline_run`
- `retry_pipeline_run`

Keep workflow execution commands readable only if the transition window still needs them.

**Step 5: Re-run the focused runtime tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
```

Expected:
- PASS

**Step 6: Commit**

```powershell
git add src-tauri/src/workflows.rs src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/main.rs src/lib/types.ts src/lib/invoke.ts
git commit -m "feat: run pipelines with structured failures"
```

---

### Task 6: Add GitLab pipeline nodes and persisted waiting-state behavior

**Files:**
- Modify: `src-tauri/src/gitlab.rs`
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/gitlab.rs`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Write the failing GitLab-node tests**

Add tests that cover:
- `check_pipeline` success and failure
- `wait_pipeline` with commit-specific matching
- branch-head fallback when commit context is absent
- `trigger_pipeline` storing downstream pipeline identifiers
- auth, timeout, and project-not-found paths

Name them with the `pipeline_gitlab` prefix.

**Step 2: Run the focused GitLab-node tests and confirm they fail**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_gitlab
```

Expected:
- FAIL because the GitLab pipeline node types and wait semantics do not exist

**Step 3: Implement the GitLab adapter methods**

In `src-tauri/src/gitlab.rs`, add pipeline-specific helpers for:
- latest-pipeline checks
- commit-specific pipeline lookup
- status polling with timeout handling
- downstream trigger requests

**Step 4: Persist waiting-state metadata in the runtime**

In runtime and storage layers, add enough pipeline-run metadata to show:
- current wait target
- last observed remote status
- next poll or elapsed wait context

Do not add resume-from-middle semantics in this task.

**Step 5: Re-run the focused GitLab-node tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_gitlab
```

Expected:
- PASS

**Step 6: Commit**

```powershell
git add src-tauri/src/gitlab.rs src-tauri/src/workflows.rs src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/main.rs
git commit -m "feat: add GitLab pipeline orchestration nodes"
```

---

### Task 7: Add schedule CRUD and a desktop-bound scheduler loop

**Files:**
- Create: `src-tauri/src/scheduler.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src-tauri/src/db.rs`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Write the failing schedule tests**

Add tests for:
- schedule CRUD with daily and weekly rules
- timezone persistence
- variable override snapshots
- concurrency policies:
  - `skip_if_running`
  - `queue_after_running`
  - `allow_parallel`

Name the tests with the `pipeline_schedule` prefix.

**Step 2: Run the focused schedule tests and confirm they fail**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule
```

Expected:
- FAIL because schedule persistence and the scheduler loop do not exist

**Step 3: Implement schedule storage and scheduler runtime**

Add:
- schedule CRUD in `db.rs`
- schedule DTOs in `models.rs`
- a polling loop in `scheduler.rs`
- startup wiring in `main.rs`

Keep the current limitation explicit:
- schedules only fire while the desktop app is open

**Step 4: Expose schedule commands and wrappers**

Add Tauri commands and TypeScript wrappers for:
- listing schedules
- creating schedules
- updating schedules
- deleting schedules

**Step 5: Re-run the focused schedule tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule
```

Expected:
- PASS

**Step 6: Commit**

```powershell
git add src-tauri/src/scheduler.rs src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/workflows.rs src-tauri/src/main.rs src/lib/types.ts src/lib/invoke.ts
git commit -m "feat: add pipeline scheduling support"
```

---

## Milestone C: UI And Rollout

### Task 8: Upgrade the definition editor in place instead of renaming files early

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/pages/WorkflowsPage.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Modify: `src/__tests__/smoke.test.tsx`
- Modify: `src/pages/__tests__/workflow-definition-variables.test.tsx`

**Step 1: Extend the existing page tests for pipeline terminology and schedules**

Update the existing tests so they expect:
- pipeline terminology in visible copy
- tabs or clearly separated sections for:
  - basics
  - variables
  - nodes
  - schedules
- migrated legacy definitions to remain visible during the transition window

**Step 2: Run the targeted frontend tests and confirm they fail**

Run:

```powershell
pnpm test -- src/pages/__tests__/workflow-definition-variables.test.tsx src/__tests__/smoke.test.tsx
```

Expected:
- FAIL because the page still behaves as a workflow-only editor

**Step 3: Upgrade `WorkflowsPage.tsx` in place**

Do not rename the file yet. Change the page to:
- call pipeline-named wrappers
- use pipeline terminology in headings and button copy
- expose schedule editing in the same screen
- keep enough compatibility to display migrated legacy records

**Step 4: Re-run the targeted frontend tests**

Run:

```powershell
pnpm test -- src/pages/__tests__/workflow-definition-variables.test.tsx src/__tests__/smoke.test.tsx
```

Expected:
- PASS

**Step 5: Commit**

```powershell
git add src/App.tsx src/components/ui/sidebar.tsx src/pages/WorkflowsPage.tsx src/lib/types.ts src/lib/invoke.ts src/__tests__/smoke.test.tsx src/pages/__tests__/workflow-definition-variables.test.tsx
git commit -m "feat: upgrade workflow editor into pipeline editor"
```

---

### Task 9: Upgrade the run monitor to show waiting details and structured failures

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/pages/WorkflowRunsPage.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Add or expand run-monitor coverage**

Extend `src/__tests__/smoke.test.tsx` so it expects:
- waiting target information
- latest observed wait status
- Chinese failure title / detail / suggestion
- technical evidence area
- rerun actions based on the new pipeline run shape

**Step 2: Run the targeted frontend test and confirm it fails**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- FAIL because the current monitor only renders the workflow-era shape

**Step 3: Upgrade `WorkflowRunsPage.tsx` in place**

Do not rename the file yet. Change the page to:
- call pipeline-named wrappers
- show wait metadata
- show structured Chinese failure info
- preserve cancel and retry behavior on the new run model

**Step 4: Re-run the targeted frontend test**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- PASS

**Step 5: Commit**

```powershell
git add src/App.tsx src/components/ui/sidebar.tsx src/pages/WorkflowRunsPage.tsx src/lib/types.ts src/lib/invoke.ts src/__tests__/smoke.test.tsx
git commit -m "feat: upgrade pipeline run monitoring"
```

---

### Task 10: Finish rollout docs and full verification

**Files:**
- Modify: `README.md`
- Modify: `openspec/changes/refactor-release-pipeline-orchestrator/tasks.md`
- Optionally Modify: `openspec/changes/refactor-release-pipeline-orchestrator/design.md`

**Step 1: Reconcile the docs with the actual implementation**

If implementation introduced grounded-plan adjustments such as:
- `pipeline_run_projects`
- compatibility wrapper policy
- delayed file rename strategy

then update the OpenSpec change docs before final verification so the written plan matches the shipped architecture.

**Step 2: Document the transition window in `README.md`**

Add:
- `workflow_* -> pipeline_*` migration behavior
- what remains readable but not writable during the compatibility window
- when workflow-named commands, routes, and tables can be removed
- the scheduler limitation that the app must remain open

**Step 3: Re-validate the OpenSpec change**

Run:

```powershell
openspec validate refactor-release-pipeline-orchestrator --strict
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

**Step 5: Run Rust verification**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml
```

Expected:
- PASS

**Step 6: Run manual desktop verification**

Run:

```powershell
pnpm tauri dev
```

Verify manually:
- pipeline definition editing
- schedule editing
- manual run execution
- wait-state display
- structured Chinese failure display
- migrated legacy records visible through the transition UI

**Step 7: Mark the OpenSpec checklist complete**

Only after the verification above passes, change every remaining item in `openspec/changes/refactor-release-pipeline-orchestrator/tasks.md` from `- [ ]` to `- [x]`.

**Step 8: Commit**

```powershell
git add README.md openspec/changes/refactor-release-pipeline-orchestrator/tasks.md openspec/changes/refactor-release-pipeline-orchestrator/design.md
git commit -m "docs: finalize pipeline orchestrator rollout"
```

## Checkpoints

- After Task 2: stop and review the schema plus migration shape before any command-surface changes
- After Task 5: stop and review the pipeline runtime before adding GitLab nodes or schedules
- After Task 7: stop and review runtime data shape before upgrading UI copy and layout

## Non-Goals For This Execution Pass

- No arbitrary shell or PowerShell execution nodes
- No DAG editor
- No missed-run backfill while the app is closed
- No in-place resume from the middle of a failed run
- No file renames for `WorkflowsPage.tsx` or `WorkflowRunsPage.tsx` during the transition pass
