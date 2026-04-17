# Pipeline Run Monitoring Auto-Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement OpenSpec task `2.3` by automatically refreshing the selected active pipeline run and stopping refresh once it becomes terminal.

**Architecture:** Reuse the existing `refreshRuns(...)` entry point in `WorkflowRunsPagePipeline.tsx` so list and detail state continue to move together. Add a single interval-driven effect keyed by the selected run state, and preserve diagnostics state unless the selected run changes.

**Tech Stack:** React 18, TypeScript, Vitest, Tauri 2, Rust.

---

### Task 1: Add failing frontend coverage for active-run polling

**Files:**
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Add a failing test for active-run polling**

Add a focused test that:

- mounts the pipeline run monitor
- returns a selected run in `running` state
- advances fake timers
- asserts `list_pipeline_runs` is called again automatically

**Step 2: Add a failing test for terminal-run stop**

Add a focused test that:

- mounts the same page with a selected run already in `completed` or `partial_failed`
- advances fake timers
- asserts no automatic follow-up refresh occurs

**Step 3: Run the focused failing test**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx -t "pipeline run auto refresh"
```

Expected:
- FAIL because the page currently never starts polling

---

### Task 2: Implement polling in `WorkflowRunsPagePipeline.tsx`

**Files:**
- Modify: `src/pages/WorkflowRunsPagePipeline.tsx`

**Step 1: Add active-run status helper**

Add a small helper that returns `true` only for:

- `pending`
- `running`
- `waiting`
- `cancelling`

**Step 2: Add auto-refresh effect**

Add one `useEffect` that:

- starts a `10s` interval when the selected run is active
- calls `refreshRuns(selectedRunId, runPage.page, filters)`
- clears the interval on dependency change and unmount

**Step 3: Preserve diagnostics during polling**

Adjust the current reset logic so:

- diagnostics state is cleared when the selected run id changes
- diagnostics state is not cleared on ordinary detail reloads for the same run

**Step 4: Keep manual refresh behavior unchanged**

The refresh button should continue to work exactly as before.

**Step 5: Run the focused test and make it pass**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx -t "pipeline run auto refresh"
```

Expected:
- PASS

---

### Task 3: Run slice verification and record status

**Files:**
- Modify: `openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md`
- Modify: `docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md`

**Step 1: Run the verification set**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
openspec validate enhance-pipeline-runtime-and-monitoring --strict
```

Expected:
- PASS

**Step 2: Update tracking docs**

Mark complete:

- `2.3`

Leave later scheduler and visualization tasks unchecked.

**Step 3: Commit the slice**

Stage only the files that belong to `2.3`, then commit with a message shaped like:

```powershell
git commit -m "feat: auto refresh active pipeline runs"
```
