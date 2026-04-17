# Pipeline Foundation Grounded Implementation Plan

**Goal:** Execute the first two weeks of the two-month evolution roadmap by stabilizing the implementation foundation before introducing broader monitoring and visualization changes.

**Architecture:** Treat this plan as a behavior-preserving foundation pass. Split the runtime into clearer internal modules, reduce `main.rs` to a thinner command surface, establish structured runtime errors, and collect baseline monitoring metrics without yet changing the scheduler into a service or rebuilding the visual monitoring surface.

**Tech Stack:** React 18, TypeScript, Vitest, Tauri 2, Rust, sqlx, SQLite, reqwest, tokio.

---

## Execution Notes

- Use `openspec/changes/enhance-pipeline-runtime-and-monitoring/` as the authoritative scope for this phase.
- Keep user-visible behavior stable unless the change explicitly improves operator guidance or instrumentation.
- Do not remove workflow compatibility wrappers in this plan.
- Prefer focused Rust verification on Windows with `cargo test -j 1 --manifest-path src-tauri/Cargo.toml <filter>`.
- Treat this plan as the implementation slice for roadmap week 1 and week 2 only.

## Phase A: Baseline And Scope Freeze

### Task 1: Record the current runtime and monitoring baseline

**Files:**
- Modify: `docs/plans/2026-04-16-two-month-evolution-roadmap.md`
- Create: `docs/plans/2026-04-16-pipeline-baseline-metrics.md`

**Step 1: Capture the baseline commands**

Record the current verification commands that define the pre-refactor baseline:
- `pnpm test`
- `pnpm build`
- `cargo test -j 1 --manifest-path src-tauri/Cargo.toml`
- `pnpm tauri bundle --bundles msi -v`

**Step 2: Capture the current monitoring/query hotspots**

Document the current hotspots to preserve as regression targets:
- `list_pipeline_runs()` is full-history and non-paginated
- `get_pipeline_run_detail()` loads heavy detail eagerly
- `scheduler.rs` evaluates schedules on a fixed 30-second tick and checks active runs per schedule
- `WorkflowRunsPagePipeline.tsx` relies mainly on explicit refreshes

**Step 3: Commit only if the baseline doc becomes the agreed execution record**

If committed separately, use:

```powershell
git add docs/plans/2026-04-16-pipeline-baseline-metrics.md docs/plans/2026-04-16-two-month-evolution-roadmap.md
git commit -m "docs: record pipeline runtime baseline"
```

---

## Phase B: Runtime Decomposition

### Task 2: Split runtime responsibilities out of `workflows.rs`

**Files:**
- Modify: `src-tauri/src/workflows.rs`
- Create: `src-tauri/src/pipeline_runtime.rs`
- Create: `src-tauri/src/workflow_runtime_legacy.rs`
- Create: `src-tauri/src/git_executor.rs`
- Create: `src-tauri/src/gitlab_executor.rs`
- Create: `src-tauri/src/failure_envelope.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Add failing or missing-coverage-focused tests before moving code**

Add or isolate tests that prove:
- pipeline Git nodes still execute and persist wait metadata
- pipeline failure envelopes still persist with Chinese-facing fields
- retry and cancellation behavior still match current semantics
- workflow legacy execution still works while compatibility remains enabled

Use focused names such as:
- `pipeline_runtime_foundation_*`
- `workflow_runtime_legacy_*`

**Step 2: Run the focused tests and confirm the baseline before refactor**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
cargo test -j 1 --manifest-path src-tauri/Cargo.toml retry_failed
cargo test -j 1 --manifest-path src-tauri/Cargo.toml cancel_pipeline_run
```

Expected:
- PASS on current behavior before decomposition begins

**Step 3: Move code by responsibility, not by random chunking**

Split along these boundaries:
- `git_executor.rs`: Git command execution, timeouts, worktree prechecks, remote and branch checks
- `gitlab_executor.rs`: GitLab node execution helpers and polling behavior
- `failure_envelope.rs`: stable failure envelope construction and classification helpers
- `pipeline_runtime.rs`: pipeline-only orchestration entry points and state transitions
- `workflow_runtime_legacy.rs`: workflow compatibility runtime entry points

Keep `workflows.rs` temporarily as a compatibility facade if needed, but reduce it to wiring rather than owning the logic.

**Step 4: Re-run focused runtime verification**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_gitlab
cargo test -j 1 --manifest-path src-tauri/Cargo.toml workflow_executor
```

Expected:
- PASS with no behavior regressions

---

## Phase C: Thin Command Layer And Structured Errors

### Task 3: Introduce a structured runtime error model and thin `main.rs`

**Files:**
- Modify: `src-tauri/src/main.rs`
- Create: `src-tauri/src/errors.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src/lib/types.ts`

**Step 1: Add the backend error model**

Introduce a stable backend error shape that can represent categories such as:
- `config_missing`
- `validation_failed`
- `git_failed`
- `gitlab_failed`
- `not_found`
- `conflict`
- `internal`

Keep the Chinese-facing node failure envelope separate from the command error category model.

**Step 2: Convert selected high-value commands first**

Prioritize commands that drive the pipeline surfaces:
- `create_pipeline_definition`
- `update_pipeline_definition`
- `list_pipeline_runs`
- `get_pipeline_run_detail`
- `execute_pipeline_run`
- `cancel_pipeline_run`
- `retry_pipeline_run`

The first pass can standardize these commands before widening to the entire app.

**Step 3: Reduce duplicate command logging patterns**

Extract common logging and error-mapping helpers so `main.rs` stops repeating:
- DB call
- `map_err(|e| e.to_string())`
- success log
- error log

**Step 4: Add frontend type support for structured errors**

Add minimal frontend types that allow the UI to distinguish:
- operator-actionable errors
- missing configuration
- validation failures
- low-level runtime failures

Do not redesign all pages in this task; only establish the shape.

**Step 5: Re-run the selected command-surface verification**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
```

Expected:
- PASS

---

## Phase D: Exit Criteria For This Plan

This plan is complete when all of the following are true:

- baseline metrics and current hotspots are documented
- runtime responsibilities are no longer concentrated entirely in `workflows.rs`
- `main.rs` is visibly thinner for pipeline-facing commands
- a structured backend error model exists for pipeline-facing command paths
- focused Rust and frontend regression coverage still passes

This plan intentionally does **not** include:
- run-history pagination
- lazy node-log loading
- active-run auto-refresh
- scheduler query optimization
- DAG or timeline visualization

Those belong to the next grounded implementation slice.

## Status Note

The runtime-foundation slice is now landed in the isolated `pipeline-runtime-foundation` worktree and has completed:
- runtime decomposition across `pipeline_runtime.rs`, `workflow_runtime_legacy.rs`, `git_executor.rs`, `gitlab_executor.rs`, and `failure_envelope.rs`
- thinner pipeline-facing Tauri command handlers with structured command errors
- focused OpenSpec, frontend smoke, pipeline runtime, GitLab runtime, and scheduler regression verification

Still intentionally deferred after this slice:
- active-run auto-refresh is still pending
- scheduler query optimization is still pending
- richer pipeline visualizations are still pending

## Status Note: Monitoring Slices

The first two monitoring and data-loading slices are now landed in the isolated `pipeline-runtime-foundation` worktree and have completed:
- paginated and filterable pipeline run history queries with a `page/items/total/has_next_page` response shape
- summary-first pipeline run detail loading
- dedicated lazy node diagnostics loading for stdout, stderr, evidence, and wait context
- frontend monitor updates for pagination, lightweight filters, and on-demand diagnostics expansion
- active-run auto-refresh for the selected run with automatic stop once the run reaches a terminal state
- focused frontend coverage for both starting and stopping the monitor auto-refresh loop

Still intentionally deferred after these monitoring slices:
- scheduler query optimization is still pending
- richer pipeline visualizations are still pending
