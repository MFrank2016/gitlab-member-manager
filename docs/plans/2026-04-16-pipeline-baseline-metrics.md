# Pipeline Runtime Baseline Metrics

**Captured on:** 2026-04-16  
**Scope:** Pre-refactor baseline for the `enhance-pipeline-runtime-and-monitoring` change  
**Goal:** Record the verified command baseline and the current monitoring/query hotspots before runtime decomposition begins.

---

## Verified Command Baseline

### 1. Frontend Test Baseline

- Command: `pnpm test`
- Exit code: `0`
- Wall-clock duration: `133.53s`
- Reported test summary:
  - `Test Files  9 passed (9)`
  - `Tests  19 passed | 6 skipped (25)`
- Notable observation:
  - The Vitest-reported duration was `110.72s`, but the end-to-end shell command took longer (`133.53s`), so future comparisons should continue using shell-level elapsed time as the baseline.

### 2. Frontend Build Baseline

- Command: `pnpm build`
- Exit code: `0`
- Wall-clock duration: `63.26s`
- Reported build summary:
  - `1782 modules transformed`
  - `built in 50.48s`

### 3. Rust Test Baseline

- Command: `cargo test -j 1 --manifest-path src-tauri/Cargo.toml`
- Exit code: `0`
- Wall-clock duration: `378.95s`
- Reported test summary:
  - `78 passed; 0 failed`
  - Rust-reported test duration: `310.61s`
- Notable observation:
  - Multiple runtime-heavy tests emitted `has been running for over 60 seconds` before ultimately passing.
  - This is currently a baseline characteristic, not a failure, but it confirms that the runtime test loop is already slow enough to affect iteration speed.

### 4. MSI Packaging Baseline

- Command: `pnpm tauri bundle --bundles msi -v`
- Exit code: `0`
- Wall-clock duration: `218.26s`
- Output artifact:
  - `D:\software\rust\target\release\bundle\msi\Gitlab Helper_0.1.0_x64_zh-CN.msi`
- Notable observation:
  - The current custom WiX template path still produces a warning-free MSI bundle.
  - The PowerShell wrapper surfaces `pnpm.exe : ... RemoteException` noise because verbose Tauri output is emitted on stderr, but the command exits successfully and the bundle is produced. Treat this as shell-noise, not as a packaging failure.

---

## Monitoring And Query Hotspots

### 1. Full-History Pipeline Run Query

- Location: `src-tauri/src/db.rs:1982`
- Function: `list_pipeline_runs`
- Current behavior:
  - Loads the full pipeline run history.
  - Joins pipeline definitions, project groups, and aggregated run-project counts.
  - Orders all rows by `created_at DESC, id DESC`.
- Why it is a hotspot:
  - The query has no pagination or filter boundary.
  - The frontend monitor currently consumes this full list on refresh.

### 2. Eager Pipeline Run Detail Loading

- Location: `src-tauri/src/db.rs:2051`
- Function: `get_pipeline_run_detail`
- Current behavior:
  - Loads run summary.
  - Loads all projects for the run.
  - Loads all nodes for all projects, including rendered parameters, wait metadata, evidence, and log-related fields.
- Why it is a hotspot:
  - The initial detail load pays for the full node payload even when the operator has not expanded logs or evidence.
  - This will scale poorly as runs accumulate more projects and nodes.

### 3. Scheduler Tick Shape

- Locations:
  - `src-tauri/src/scheduler.rs:14`
  - `src-tauri/src/scheduler.rs:92`
  - `src-tauri/src/scheduler.rs:171`
  - `src-tauri/src/scheduler.rs:188`
- Current behavior:
  - Fixed `30s` scheduler tick interval.
  - Each enabled schedule is evaluated inside the tick loop.
  - Active runs are counted per pipeline definition during schedule evaluation.
- Why it is a hotspot:
  - The scheduler currently trends toward per-schedule active-run checks instead of reusing shared active-run state.
  - As enabled schedules grow, tick cost will grow with them.

### 4. Run Monitor Refresh Model

- Locations:
  - `src/pages/WorkflowRunsPagePipeline.tsx:198`
  - `src/pages/WorkflowRunsPagePipeline.tsx:247`
  - `src/pages/WorkflowRunsPagePipeline.tsx:264`
  - `src/pages/WorkflowRunsPagePipeline.tsx:343`
- Current behavior:
  - `refreshRuns()` reloads the run list on demand.
  - Initial data load happens on mount.
  - Detail is reloaded when the selected run changes.
  - Manual refresh is exposed as the primary operator action.
- Why it is a hotspot:
  - There is no active-run auto-refresh loop yet.
  - Waiting nodes and active progress remain dependent on repeated user refreshes.

---

## Baseline Interpretation

The current system is stable and fully usable, but the baseline already shows where the next refactor should focus:

- Runtime iteration speed is constrained by very slow end-to-end Rust testing.
- Monitoring is correct but not yet scalable.
- Scheduler behavior is functional but query-efficient only at small scale.
- The run monitor is informative but not yet operator-friendly for long-lived active runs.

These results confirm that the next grounded implementation slice should prioritize:

1. Runtime decomposition.
2. A thinner command layer with structured errors.
3. Later follow-up work for paginated history, lazy detail loading, and active-run auto-refresh.
