# Pipeline Task 6 Runtime Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close Task 6 by wiring GitLab pipeline nodes into the pipeline runtime and persisting waiting-state metadata on `pipeline_run_nodes`.

**Architecture:** Keep the current grounded branch structure and only extend the existing pipeline runtime. Load the persisted `GitLabConfig` from the database at run start, branch execution by pipeline node type in `workflows.rs`, and persist waiting metadata through the already-prepared `0010_pipeline_wait_metadata.sql` migration plus the existing read models.

**Tech Stack:** Rust, sqlx, SQLite, Tauri 2, reqwest, tokio, Vitest.

---

### Task 1: Add failing runtime tests for GitLab pipeline nodes

**Files:**
- Modify: `src-tauri/src/workflows.rs`

**Step 1: Write failing tests**

Add focused Rust tests that:
- execute a pipeline containing `check_pipeline` and assert success uses GitLab status instead of `git`
- execute a pipeline containing `trigger_pipeline` and assert triggered pipeline evidence is stored
- execute a pipeline containing `wait_pipeline` and assert the final run detail contains:
  - `wait_target`
  - `last_remote_status`
  - `remote_pipeline_id`
  - `wait_context`

Reuse the lightweight local GitLab test server pattern already present in `src-tauri/src/gitlab.rs`.

**Step 2: Run tests to verify they fail**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_gitlab
```

Expected:
- FAIL because the runtime still treats every pipeline node as a local Git step and never writes wait metadata

---

### Task 2: Wire GitLab config and node execution into the pipeline runtime

**Files:**
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src/lib/types.ts`
- Create: `src-tauri/migrations/0010_pipeline_wait_metadata.sql`

**Step 1: Load GitLab config at runtime start and pass it into background execution**

Update:
- `start_pipeline_run_with_projects`
- `run_pipeline_in_background`
- `execute_pipeline_project_plan`

Load `Option<GitLabConfig>` from the persisted config table so GitLab nodes can fail cleanly when config is absent while Git-only pipelines continue to work.

**Step 2: Split node execution by node type**

In `workflows.rs`:
- keep the current Git path for `checkout_branch`, `git_pull`, `git_merge`, `git_push`
- add runtime branches for:
  - `check_pipeline`
  - `wait_pipeline`
  - `trigger_pipeline`

Parameter handling should stay strict and minimal:
- `project`: required
- `ref`: optional, default to managed project default branch
- `sha`: optional
- `timeout_ms`: optional for `wait_pipeline`
- `poll_interval_ms`: optional for `wait_pipeline`
- `variables`: optional object for `trigger_pipeline`

**Step 3: Persist wait metadata and Chinese failure envelopes**

Use the existing helper layer to:
- mark `wait_pipeline` nodes as `waiting` during polling
- persist `wait_target`, `last_remote_status`, `remote_pipeline_id`, and `wait_context_json`
- classify GitLab auth, not-found, timeout, and pipeline-failed states into structured Chinese envelopes

**Step 4: Re-run focused runtime tests**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_gitlab
```

Expected:
- PASS

---

### Task 3: Re-run regression coverage for Task 6 and verify no dead helper remains

**Files:**
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/gitlab.rs`

**Step 1: Run Task 6 regression set**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_gitlab
```

Expected:
- PASS

**Step 2: Check warning shape**

Run:

```powershell
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime_gitlab
```

Expected:
- the new wait/GitLab runtime helpers are used
- any remaining warnings are unrelated pre-existing warnings

**Step 3: Record current scope boundary**

Do not start:
- scheduler loop
- schedule CRUD commands
- UI migration from workflow copy to pipeline copy

Those remain in Tasks 7-10.
