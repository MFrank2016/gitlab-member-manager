# Pipeline Operator Messaging Localization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement OpenSpec task `4.3` by eliminating the remaining English leak points in operator-facing validation, command errors, waiting states, and recovery-related run-monitor messaging.

**Architecture:** Keep the slice narrow and operator-focused. Localize frontend helper validation at the source, localize raw command guard strings that can surface through UI failures, and map directly rendered remote pipeline statuses to Chinese labels in the run monitor. Avoid schema changes and avoid rewriting stored historical free-text.

**Tech Stack:** React 18, TypeScript, Vitest, Tauri 2, Rust.

---

### Task 1: Add failing frontend coverage for Chinese-first operator text

**Files:**
- Modify: `src/__tests__/smoke.test.tsx`
- Modify: `src/lib/invoke.ts`

**Step 1: Add a failing helper-validation test**

Add a focused test that proves `createPipelineDefinition(...)` rejects invalid payload helpers with Chinese messages instead of English-only `must be ...` text.

**Step 2: Add a failing run-monitor text test**

Add a focused test that renders a pipeline node with an English remote status such as `running` and asserts the operator sees the Chinese label instead.

**Step 3: Run the focused failing tests**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx -t "operator messaging"
```

Expected:
- FAIL because helper and remote-status text are not fully localized yet

---

### Task 2: Localize helper validation and command guard strings

**Files:**
- Modify: `src/lib/invoke.ts`
- Modify: `src-tauri/src/main.rs`

**Step 1: Localize frontend helper validation**

Replace English helper errors such as:

- `must be an object`
- `must be an array`

with Chinese-first phrasing.

**Step 2: Localize raw GitLab config guard strings**

Update `require_cfg(...)` and any directly surfaced mutex/config guard strings so UI-exposed raw errors are Chinese-first.

**Step 3: Run the focused tests again**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx -t "operator messaging"
```

Expected:
- the helper-validation side passes
- the remote-status side may still fail until Task 3 is complete

---

### Task 3: Localize remote status rendering in the run monitor

**Files:**
- Modify: `src/pages/WorkflowRunsPagePipeline.tsx`

**Step 1: Add a small remote-status label helper**

Map known raw remote statuses to Chinese labels, including:

- `pending`
- `running`
- `success`
- `failed`
- `canceled` / `cancelled`
- `skipped`
- `manual`

Fallback to the raw value if it is unknown.

**Step 2: Use the helper in the node wait-status area**

Replace direct rendering of `node.lastRemoteStatus` with the localized label helper.

**Step 3: Run the focused frontend test and make it pass**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx -t "operator messaging"
```

Expected:
- PASS

---

### Task 4: Run slice verification, update tracking docs, and commit

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

- `4.3`

Leave `4.1`, `4.2`, and packaging verification unchanged.

**Step 3: Commit only the `4.3` slice**

Stage only the files that belong to this slice, then commit with a message shaped like:

```powershell
git commit -m "feat: localize pipeline operator messaging"
```
