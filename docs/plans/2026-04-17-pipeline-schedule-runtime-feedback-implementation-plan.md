# Pipeline Schedule Runtime Feedback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement OpenSpec task `3.2` by exposing queued, skipped, and next-trigger schedule runtime feedback through a shared backend model and a first UI entry in the pipeline definition editor.

**Architecture:** Extend the in-memory scheduler state with per-schedule feedback, then expose a read-only runtime snapshot command that merges scheduler memory with schedule definitions and calculated next-trigger timestamps. Reuse that command in the pipeline definition editor so each schedule row can show current runtime state without changing scheduler semantics or adding persistence tables.

**Tech Stack:** Rust, Tokio, sqlx, SQLite, Tauri 2, React 18, TypeScript, Vitest.

---

### Task 1: Add failing Rust coverage for schedule runtime snapshots

**Files:**
- Modify: `src-tauri/src/scheduler.rs`
- Modify: `src-tauri/src/models.rs`

**Step 1: Add a failing test for queued and skipped feedback**

Add focused scheduler tests that:

- run a `queue_after_running` schedule and assert the snapshot reports `queued = true`
- run a `skip_if_running` schedule and assert the snapshot reports `lastDecision = skipped`

**Step 2: Add a failing test for next-trigger calculation**

Add a focused test that:

- uses a known cron expression and timezone
- calls the next-trigger helper
- asserts the returned RFC3339 timestamp matches the expected next slot

**Step 3: Run the focused Rust test and verify it fails**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml schedule_runtime_feedback
```

Expected:
- FAIL because the snapshot model and helpers do not exist yet

---

### Task 2: Implement scheduler runtime feedback model and command surface

**Files:**
- Modify: `src-tauri/src/scheduler.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Add scheduler feedback state and snapshot model**

Implement:

- an in-memory feedback record keyed by `schedule_id`
- a public snapshot type for the command response
- a small decision enum/string set: `started | queued | skipped | idle`

**Step 2: Update scheduler branches to record feedback**

Record feedback in the same code paths that:

- start a schedule
- queue a schedule
- skip a schedule

**Step 3: Add next-trigger calculation helper**

Add a helper that calculates the next matching cron slot after `now` for a given schedule timezone and cron expression.

**Step 4: Expose a read-only command**

Add a command that:

- accepts a pipeline definition id
- loads schedules for that definition
- merges them with scheduler feedback
- returns ordered runtime snapshots

**Step 5: Run focused Rust verification**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml schedule_runtime_feedback
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule_runtime
```

Expected:
- PASS

---

### Task 3: Add failing frontend coverage for schedule feedback rendering

**Files:**
- Modify: `src/__tests__/smoke.test.tsx`
- Modify: `src/lib/invoke.ts`
- Modify: `src/lib/types.ts`

**Step 1: Add command wrapper and snapshot types**

Define the frontend contract for schedule runtime snapshots and a wrapper for the new Tauri command.

**Step 2: Add a failing definition-page test**

Add a smoke test that:

- loads a pipeline definition with schedules
- mocks runtime snapshots with `queued`, `skipped`, and `nextTriggerAt`
- asserts the schedule section renders the status text and next-trigger text

**Step 3: Run the focused frontend test and verify it fails**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx -t "schedule runtime feedback"
```

Expected:
- FAIL because the page does not render snapshot data yet

---

### Task 4: Implement the definition-page runtime feedback entry

**Files:**
- Modify: `src/pages/WorkflowsPagePipeline.tsx`

**Step 1: Load runtime snapshots for the edit drawer/page**

When a pipeline definition is opened for editing, fetch its runtime snapshots alongside the definition detail.

**Step 2: Add a manual refresh action**

Add a small refresh control for schedule runtime feedback only.

**Step 3: Render status information under each schedule row**

Show:

- next trigger
- current state label
- Chinese explanation text

Use conservative empty states when no feedback exists yet.

**Step 4: Run the focused frontend test and make it pass**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx -t "schedule runtime feedback"
```

Expected:
- PASS

---

### Task 5: Run slice verification, update tracking docs, and commit

**Files:**
- Modify: `openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md`
- Modify: `docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md`

**Step 1: Run the verification set**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule_runtime
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
openspec validate enhance-pipeline-runtime-and-monitoring --strict
```

Expected:
- PASS

**Step 2: Update tracking docs**

Mark complete:

- `3.2`

Leave `3.3` and later UX tasks unchanged.

**Step 3: Commit only the `3.2` slice**

Stage only the files that belong to this work, then commit with a message shaped like:

```powershell
git commit -m "feat: surface scheduler runtime feedback"
```
