# Pipeline Run Matrix Visualization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement OpenSpec task `4.2` with a matrix-first run visualization that lets operators compare project-by-node status inside the existing pipeline run monitor.

**Architecture:** Keep `WorkflowRunsPagePipeline.tsx` as the run-monitor container, add a dedicated `pipeline-run-monitor` component for the matrix view, and project the existing `selectedRunDetail.projects[].nodes[]` payload into stable matrix columns and rows without changing backend contracts.

**Tech Stack:** React 18, TypeScript, Vitest, Tauri 2.

---

### Task 1: Add failing frontend coverage for matrix projection and view switching

**Files:**
- Modify: `src/__tests__/smoke.test.tsx`
- Read: `src/pages/WorkflowRunsPagePipeline.tsx`
- Read: `src/lib/types.ts`

**Step 1: Add a failing matrix visibility test**

Cover a selected pipeline run detail where the operator can switch from the existing project list to a new matrix view.

**Step 2: Add a failing selection-linkage test**

Cover clicking a matrix row or cell and assert that the selected project detail panel switches to that project.

**Step 3: Add a failing waiting/failure signal test**

Cover a matrix cell that should expose:

- failed node state
- waiting node state with remote status hint

**Step 4: Run the focused tests**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- FAIL on the new matrix expectations

**Step 5: Commit**

Do not commit yet. This task is the red phase for the following implementation tasks.

---

### Task 2: Add a small matrix projection helper

**Files:**
- Create: `src/components/pipeline-run-monitor/matrix-model.ts`
- Create: `src/components/pipeline-run-monitor/__tests__/matrix-model.test.ts`
- Modify: `src/lib/types.ts`

**Step 1: Define the projected matrix shape**

Create types and helpers for:

- matrix column metadata
- project rows
- cells keyed by stable node position

Keep the projection based on existing `PipelineRunDetail` and `PipelineRunProject` shapes.

**Step 2: Implement stable column generation**

Build columns from the union of project nodes using:

- `nodeOrder`
- `pipelineNodeId` when available
- fallback `nodeType`

The helper should tolerate missing nodes in some projects without crashing.

**Step 3: Write and run helper tests**

Run:

```powershell
pnpm test -- src/components/pipeline-run-monitor/__tests__/matrix-model.test.ts
```

Expected:
- PASS

**Step 4: Commit**

```powershell
git add src/components/pipeline-run-monitor/matrix-model.ts src/components/pipeline-run-monitor/__tests__/matrix-model.test.ts src/lib/types.ts
git commit -m "feat: add pipeline run matrix model"
```

---

### Task 3: Build the matrix component

**Files:**
- Create: `src/components/pipeline-run-monitor/PipelineRunProjectMatrix.tsx`
- Modify: `src/components/pipeline-run-monitor/matrix-model.ts`
- Modify: `src/components/pipeline-run-monitor/__tests__/matrix-model.test.ts`
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Render a horizontally scrollable matrix**

Create a component that renders:

- compact column headers for node order and node type
- one row per project
- one cell per projected matrix column

**Step 2: Keep cells status-first**

Each cell should render:

- status color
- short Chinese status text
- compact wait/failure hint when present

Avoid large multi-line content in the cell body.

**Step 3: Expose selection callbacks**

Support clicking:

- row header
- matrix cell

Both paths should select the matching project through a callback.

**Step 4: Run focused frontend coverage**

Run:

```powershell
pnpm test -- src/components/pipeline-run-monitor/__tests__/matrix-model.test.ts
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- component- and smoke-level matrix expectations pass, but page integration may still need finishing in the next task

**Step 5: Commit**

```powershell
git add src/components/pipeline-run-monitor/PipelineRunProjectMatrix.tsx src/components/pipeline-run-monitor/matrix-model.ts src/components/pipeline-run-monitor/__tests__/matrix-model.test.ts src/__tests__/smoke.test.tsx
git commit -m "feat: add pipeline run matrix view"
```

---

### Task 4: Integrate the matrix into the run monitor

**Files:**
- Modify: `src/pages/WorkflowRunsPagePipeline.tsx`
- Modify: `src/__tests__/smoke.test.tsx`
- Read: `src/components/pipeline-run-monitor/PipelineRunProjectMatrix.tsx`

**Step 1: Add a project-panel view mode**

Introduce a small local state for:

- `list`
- `matrix`

Default to `list` for a safe rollout.

**Step 2: Keep the current project table intact**

Retain the existing project table in `list` mode so operators do not lose the current fallback path.

**Step 3: Render the matrix in `matrix` mode**

Pass:

- `selectedRunDetail.projects`
- `selectedProjectId`
- selection callback

Reuse current loading and empty states rather than inventing a second status system.

**Step 4: Preserve the lower project-detail drill-down**

After selecting a project in matrix mode, the lower node detail panel should continue to show the same node cards and diagnostics behavior.

**Step 5: Run smoke coverage**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- PASS

**Step 6: Commit**

```powershell
git add src/pages/WorkflowRunsPagePipeline.tsx src/__tests__/smoke.test.tsx
git commit -m "feat: integrate pipeline run matrix monitor"
```

---

### Task 5: Verification and tracking updates

**Files:**
- Modify: `openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md`
- Modify: `docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md`

**Step 1: Run the verification set**

Run:

```powershell
pnpm test -- src/components/pipeline-run-monitor/__tests__/matrix-model.test.ts
pnpm test -- src/__tests__/smoke.test.tsx
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
openspec validate enhance-pipeline-runtime-and-monitoring --strict
```

Expected:
- PASS

**Step 2: Update tracking docs**

Mark complete:

- `4.2`

Leave `3.3` and packaging verification unchanged.

**Step 3: Commit**

```powershell
git add src/components/pipeline-run-monitor src/pages/WorkflowRunsPagePipeline.tsx src/__tests__/smoke.test.tsx openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md
git commit -m "feat: add pipeline run matrix visualization"
```
