# Pipeline Scheduler Active-Run Query Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement OpenSpec task `3.1` by replacing per-schedule active-run lookups with a grouped scheduler tick query while preserving current scheduling semantics.

**Architecture:** Add one grouped database helper that returns active pipeline run counts keyed by `pipeline_definition_id`, then let `scheduler.rs` keep a mutable count map for the duration of the tick. Reuse that same map in queue draining and due-schedule evaluation so same-tick decisions stay behaviorally identical to the old repeated-query approach.

**Tech Stack:** Rust, Tokio, sqlx, SQLite, Tauri 2.

---

### Task 1: Add failing Rust coverage for grouped active-run counts

**Files:**
- Modify: `src-tauri/src/db.rs`

**Step 1: Add a focused test for grouped active-run counts**

Add a test that seeds:

- two active runs for one pipeline definition
- one active run for another pipeline definition
- one terminal run that must be ignored

Assert the new helper returns the grouped counts only for active statuses.

**Step 2: Run the focused test and verify it fails**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml active_pipeline_run_counts
```

Expected:
- FAIL because the grouped helper does not exist yet

---

### Task 2: Guard scheduler semantics for shared pipeline definitions

**Files:**
- Modify: `src-tauri/src/scheduler.rs`

**Step 1: Add a scheduler regression test for same-tick shared definitions**

Add a test that creates one pipeline definition with two due schedules using `skip_if_running`, both matching the same tick.

Assert:

- only one scheduled run starts
- the second schedule is counted as skipped

**Step 2: Run the focused scheduler test**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml shared_definition
```

Expected:
- PASS or FAIL depending on existing semantics, but the test becomes the guardrail for the optimization

---

### Task 3: Implement grouped active-run loading and tick-local counting

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/scheduler.rs`

**Step 1: Add the grouped DB helper**

Implement a helper that:

- accepts the scheduler-relevant pipeline definition ids
- returns a `HashMap<i64, i64>`
- counts only `pending`, `running`, and `cancelling`

**Step 2: Build the active-count map once per tick**

In `run_scheduler_tick(...)`:

- collect relevant pipeline definition ids from queued requests and enabled schedules
- load grouped active counts once
- pass the mutable map into queue draining and due-schedule evaluation

**Step 3: Increment counts after successful starts**

After every successful `start_scheduled_run(...)`, update the in-memory count for that pipeline definition so later decisions in the same tick stay correct.

**Step 4: Remove direct per-schedule count queries**

Delete the old repeated `count_active_pipeline_runs(...)` path once the grouped helper is wired in.

**Step 5: Run the focused Rust verification**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml active_pipeline_run_counts
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule_runtime
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
```

Expected:
- PASS

---

### Task 4: Update tracking docs and commit the slice

**Files:**
- Modify: `openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md`
- Modify: `docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md`

**Step 1: Update tracking docs**

Mark complete:

- `3.1`

Leave `3.2`, `3.3`, and later UX tasks unchanged.

**Step 2: Validate OpenSpec status**

Run:

```powershell
openspec validate enhance-pipeline-runtime-and-monitoring --strict
```

Expected:
- PASS

**Step 3: Commit only the `3.1` slice**

Stage only the files that belong to this optimization, then commit with a message shaped like:

```powershell
git commit -m "refactor: batch scheduler active run checks"
```
