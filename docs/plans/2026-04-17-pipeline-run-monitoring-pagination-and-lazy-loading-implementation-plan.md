# Pipeline Run Monitoring Pagination And Lazy Loading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement OpenSpec tasks `2.1` and `2.2` by adding paginated pipeline run history, summary-first run detail loading, and lazy node diagnostics in the existing pipeline monitor.

**Architecture:** Keep the current desktop monitoring page and command names where practical, but split backend models into paginated list, summary detail, and node diagnostics. Add one new diagnostics command instead of continuing to ship all heavy node payloads in the main detail response.

**Tech Stack:** Rust, sqlx, SQLite, Tauri 2, React 18, TypeScript, Vitest.

---

### Task 1: Add failing backend tests for pagination and lazy diagnostics

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Write failing Rust tests for paginated run history**

Add tests that seed multiple pipeline runs and assert:

- page size defaults to `20`
- newest runs are returned first
- `status`, `pipeline_definition_id`, and `project_group_id` filters narrow the result set
- the response includes `total` and `has_next_page`

**Step 2: Write failing Rust tests for summary-first detail**

Add tests that assert:

- `get_pipeline_run_detail` returns project and node summary data
- `stdout`, `stderr`, `evidence`, and `wait_context` are not included in the summary response
- `get_pipeline_run_node_diagnostics` returns the heavy payload for a selected node

**Step 3: Run the focused failing tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_run_monitoring
```

Expected:
- FAIL because the backend still returns a full array and eager detail payloads

---

### Task 2: Implement backend pagination, summary detail, and diagnostics queries

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Add Rust model types**

Add:

- run list filter input
- paginated run list response
- run detail summary types
- node diagnostics type

Keep camelCase serialization aligned with the existing Tauri surface.

**Step 2: Refactor list query**

Update `list_pipeline_runs` to accept filter input and page arguments, and return:

- `items`
- `page`
- `page_size`
- `total`
- `has_next_page`

**Step 3: Refactor detail query**

Update `get_pipeline_run_detail` so it returns summary-only projects and nodes.

Add `get_pipeline_run_node_diagnostics` to return:

- `stdout`
- `stderr`
- `evidence`
- `wait_context`

**Step 4: Keep error handling structured**

Route the new command and updated queries through the existing `CommandError` helpers in `main.rs`.

**Step 5: Run focused Rust verification**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_run_monitoring
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
```

Expected:
- PASS

---

### Task 3: Add failing frontend tests and update invoke/types

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Add failing frontend assertions**

Add tests that assert:

- `listPipelineRuns` accepts page and filter input
- the returned shape is paginated instead of a bare array
- node diagnostics are loaded through a dedicated invoke wrapper

**Step 2: Update TypeScript types**

Add matching frontend types for:

- paginated run history
- run list filters
- run detail summary
- node diagnostics

**Step 3: Update invoke wrappers**

Add:

- `listPipelineRuns(params)`
- `getPipelineRunNodeDiagnostics(runNodeId)`

Keep `getPipelineRunDetail(id)` as the summary endpoint.

**Step 4: Run the focused frontend failing test, then green it**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx -t "pipeline run monitor"
```

Expected before implementation:
- FAIL

Expected after implementation:
- PASS

---

### Task 4: Update `WorkflowRunsPagePipeline.tsx` for paginated history and lazy node expansion

**Files:**
- Modify: `src/pages/WorkflowRunsPagePipeline.tsx`

**Step 1: Replace array-only run state**

Track:

- paginated response
- current page
- current filters

**Step 2: Add minimal filter and pagination controls**

Implement:

- status filter
- pipeline filter
- project group filter
- previous/next page buttons

Keep the page layout stable.

**Step 3: Add lazy diagnostics expansion**

When a node card expands:

- fetch diagnostics once for that node
- show loading state while fetching
- render heavy diagnostics only after the fetch succeeds

**Step 4: Keep Chinese-first error handling**

Continue using `readCommandErrorMessage` for all new failures.

**Step 5: Run focused UI verification**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- PASS

---

### Task 5: Close the slice and record status

**Files:**
- Modify: `openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md`
- Modify: `docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md`

**Step 1: Re-run the slice verification set**

Run:

```powershell
openspec validate enhance-pipeline-runtime-and-monitoring --strict
pnpm test -- src/__tests__/smoke.test.tsx
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_run_monitoring
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
```

Expected:
- PASS

**Step 2: Update status tracking**

Mark complete:

- `2.1`
- `2.2`

Leave `2.3` and later tasks unchecked.

**Step 3: Commit the slice**

Stage only the code, tests, and docs that belong to `2.1` and `2.2`, then commit with a message shaped like:

```powershell
git commit -m "feat: paginate pipeline run monitor data"
```
