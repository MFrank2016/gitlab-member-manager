# Pipeline Definition Editor Structured Form Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement OpenSpec task `4.1` by splitting the pipeline definition editor into smaller components and replacing JSON-first editing with structured JSON forms plus an advanced JSON fallback.

**Architecture:** Keep `WorkflowsPagePipeline.tsx` as the container for command calls and draft orchestration, move editing UI into pipeline-editor section components, and introduce one reusable recursive `StructuredJsonEditor` that becomes the default editor for custom node parameters and schedule variables while built-in nodes use a hybrid known-fields plus extra-parameters model.

**Tech Stack:** React 18, TypeScript, Vitest, Tauri 2.

---

### Task 1: Add failing frontend coverage for structured JSON editing and editor split guardrails

**Files:**
- Modify: `src/__tests__/smoke.test.tsx`
- Read: `src/pages/WorkflowsPagePipeline.tsx`

**Step 1: Add a failing custom-node structured editing test**

Cover a create or edit flow where a custom node parameter becomes a nested object or array through the new structured editor path.

**Step 2: Add a failing schedule-variable structured editing test**

Cover a schedule row where variables are edited without relying on the raw JSON textarea path.

**Step 3: Add a failing advanced-JSON fallback test**

Cover switching from structured mode to JSON mode and back, proving invalid JSON does not destroy the last valid structured value.

**Step 4: Run the focused failing tests**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- FAIL on the new structured-editor expectations

**Step 5: Commit**

Do not commit yet. This task is a red-phase prerequisite for the next implementation tasks.

---

### Task 2: Introduce a reusable `StructuredJsonEditor`

**Files:**
- Create: `src/components/pipeline-editor/StructuredJsonEditor.tsx`
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Build the minimal recursive editor API**

Implement a value editor that accepts:

- `value`
- `onChange`
- optional `mode`
- optional `onModeChange`
- optional labels for root add/remove actions

Support:

- object fields
- array items
- string, number, boolean, and null values
- nested recursion

**Step 2: Add advanced JSON fallback mode**

Inside the component, support:

- structured mode
- JSON mode
- JSON parse error text in Chinese
- last-valid-value preservation when JSON text is invalid

**Step 3: Run frontend tests**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- some tests still fail because the editor is not yet wired into the pipeline definition page
- editor-specific expectations can pass

**Step 4: Commit**

```powershell
git add src/components/pipeline-editor/StructuredJsonEditor.tsx src/__tests__/smoke.test.tsx
git commit -m "feat: add structured json editor"
```

---

### Task 3: Split the draft form into focused editor sections

**Files:**
- Create: `src/components/pipeline-editor/PipelineDraftForm.tsx`
- Create: `src/components/pipeline-editor/PipelineBasicsSection.tsx`
- Create: `src/components/pipeline-editor/PipelineVariablesSection.tsx`
- Create: `src/components/pipeline-editor/PipelineNodesSection.tsx`
- Create: `src/components/pipeline-editor/PipelineNodeCard.tsx`
- Create: `src/components/pipeline-editor/PipelineSchedulesSection.tsx`
- Modify: `src/pages/WorkflowsPagePipeline.tsx`

**Step 1: Extract basics and variables sections first**

Move the basics and variable editing UI out of `WorkflowsPagePipeline.tsx` while preserving the current draft behavior.

**Step 2: Extract node and schedule sections without changing editor semantics yet**

Move the existing node and schedule JSX into section components, still passing the current handlers and draft state through explicit props.

**Step 3: Replace the inline `PipelineDraftForm` with the extracted composed form**

Keep create and edit dialogs sharing the same draft-form entry point.

**Step 4: Run smoke coverage**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- the page still works, but structured-editing tests can still fail until the next tasks are wired

**Step 5: Commit**

```powershell
git add src/components/pipeline-editor src/pages/WorkflowsPagePipeline.tsx src/__tests__/smoke.test.tsx
git commit -m "refactor: split pipeline definition editor sections"
```

---

### Task 4: Wire built-in and custom node structured editing

**Files:**
- Modify: `src/components/pipeline-editor/PipelineNodesSection.tsx`
- Modify: `src/components/pipeline-editor/PipelineNodeCard.tsx`
- Modify: `src/components/pipeline-editor/StructuredJsonEditor.tsx`
- Modify: `src/pages/WorkflowsPagePipeline.tsx`
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Keep built-in node known fields as explicit inputs**

For built-in node types, continue rendering known fields like `branch`, `project`, `ref`, `sha`, and `remote`.

**Step 2: Add structured editing for built-in extra parameters**

Split the node parameter object into:

- known built-in keys
- extra keys edited by `StructuredJsonEditor`

Also expose advanced JSON mode for the full parameter object.

**Step 3: Make custom nodes default to structured editing**

Custom nodes should default to `StructuredJsonEditor` with advanced JSON mode available as a fallback.

**Step 4: Add support for creating a new custom node type**

Allow operators to create a new custom node and edit its `nodeType` plus structured parameters in the same flow.

**Step 5: Run smoke coverage**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
```

Expected:
- custom-node structured editing expectations pass
- existing editor smoke remains green

**Step 6: Commit**

```powershell
git add src/components/pipeline-editor src/pages/WorkflowsPagePipeline.tsx src/__tests__/smoke.test.tsx
git commit -m "feat: add structured pipeline node editing"
```

---

### Task 5: Wire schedule-variable structured editing and finish slice verification

**Files:**
- Modify: `src/components/pipeline-editor/PipelineSchedulesSection.tsx`
- Modify: `src/components/pipeline-editor/StructuredJsonEditor.tsx`
- Modify: `src/pages/WorkflowsPagePipeline.tsx`
- Modify: `src/__tests__/smoke.test.tsx`
- Modify: `openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md`
- Modify: `docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md`

**Step 1: Replace schedule-variable textarea-first editing**

Make schedule variables default to structured editing, with advanced JSON mode kept as a fallback.

**Step 2: Preserve scheduler runtime feedback in the extracted schedule section**

Keep the runtime snapshot block and manual refresh behavior working after the schedule-section split.

**Step 3: Run the verification set**

Run:

```powershell
pnpm test -- src/__tests__/smoke.test.tsx
cargo test -j 1 --manifest-path src-tauri/Cargo.toml pipeline_runtime
openspec validate enhance-pipeline-runtime-and-monitoring --strict
```

Expected:
- PASS

**Step 4: Update tracking docs**

Mark complete:

- `4.1`

Leave `4.2`, `3.3`, and packaging verification unchanged.

**Step 5: Commit**

```powershell
git add src/components/pipeline-editor src/pages/WorkflowsPagePipeline.tsx src/__tests__/smoke.test.tsx openspec/changes/enhance-pipeline-runtime-and-monitoring/tasks.md docs/plans/2026-04-16-pipeline-foundation-grounded-implementation-plan.md
git commit -m "feat: restructure pipeline definition editor"
```
