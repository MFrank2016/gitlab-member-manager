# Pipeline Task 7 Scheduler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a desktop-bound pipeline scheduler that can launch scheduled runs against a specific project group and honor `skip_if_running`, `queue_after_running`, and `allow_parallel`.

**Architecture:** Extend the existing `pipeline_schedules` model with an explicit `project_group_id`, keep schedule editing attached to pipeline definition create/update for now, and add a new `scheduler.rs` module that evaluates enabled schedules on an interval. Because this is a desktop-only v1 scheduler, queue state can live in memory while the app is open, but actual scheduled runs must still be persisted as normal `pipeline_runs`.

**Tech Stack:** Rust, sqlx, SQLite, tokio, chrono, reqwest, Tauri 2.

---

### Task 1: Add schedule target group support in schema and models

**Files:**
- Create: `src-tauri/migrations/0011_pipeline_schedule_targets.sql`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src-tauri/src/db.rs`

**Step 1: Write failing tests**

Add DB tests that expect:
- schedule create/list/detail round-trip includes `project_group_id`
- schedule input rejects missing or invalid `project_group_id`

**Step 2: Run test to verify it fails**

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule_schema
```

Expected:
- FAIL because `pipeline_schedules` has no target group field yet

**Step 3: Implement schema and model changes**

Add `project_group_id` to `pipeline_schedules` and update Rust / TypeScript schedule types accordingly.

**Step 4: Re-run tests**

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule_schema
```

Expected:
- PASS

---

### Task 2: Implement scheduler core with in-memory queue state

**Files:**
- Create: `src-tauri/src/scheduler.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/workflows.rs`
- Test: `src-tauri/src/scheduler.rs`

**Step 1: Write failing scheduler tests**

Add tests for:
- due schedule starts a run when no active run exists
- `skip_if_running` skips when the same pipeline already has an active run
- `allow_parallel` starts another run immediately
- `queue_after_running` queues in memory and starts after active run completes

**Step 2: Run test to verify it fails**

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule_runtime
```

Expected:
- FAIL because there is no scheduler module yet

**Step 3: Implement scheduler core**

Create `scheduler.rs` with:
- schedule loading from DB
- cron/timezone due detection
- in-memory `last_fired_slot` tracking
- in-memory queued schedule requests
- runtime calls into existing `execute_pipeline_run`

**Step 4: Re-run tests**

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule_runtime
```

Expected:
- PASS

---

### Task 3: Wire scheduler startup and regression verification

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/scheduler.rs`

**Step 1: Add startup wiring**

Start the scheduler loop during app setup after database initialization.

**Step 2: Run focused verification**

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_schedule
```

Expected:
- PASS

**Step 3: Run broader regression set**

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_gitlab
```

Expected:
- PASS, unless blocked by the current Windows linker instability already observed in this environment
