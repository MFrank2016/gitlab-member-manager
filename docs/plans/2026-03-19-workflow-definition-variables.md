# Workflow Definition Variables Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the workflow variables JSON editor with a variable/default-value form, auto-add missing variables from `${...}` placeholders, and validate referenced variables before save.

**Architecture:** Extract placeholder and variable-sync logic into a small frontend helper module so the editor state and validation stay testable outside the React component. Update `WorkflowsPage` to render variable rows instead of raw JSON text, and keep the persisted `variables_schema` payload as a flat object of `name -> defaultValue`.

**Tech Stack:** React 18, TypeScript, Vitest, existing Tauri invoke layer

---

### Task 1: Add variable helper tests

**Files:**
- Create: `src/lib/__tests__/workflow-definition-variables.test.ts`
- Create: `src/lib/workflow-definition-variables.ts`

**Step 1: Write the failing tests**

- Cover extracting `${...}` placeholders from nested step parameters.
- Cover auto-adding missing variables with empty-string defaults.
- Cover rejecting saves when referenced variables are undeclared.

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/__tests__/workflow-definition-variables.test.ts`

**Step 3: Write minimal implementation**

- Add utilities for placeholder extraction, variable syncing, and declaration validation.

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/__tests__/workflow-definition-variables.test.ts`

### Task 2: Update workflow editor UI

**Files:**
- Modify: `src/pages/WorkflowsPage.tsx`
- Modify: `src/lib/types.ts` if draft typing needs stronger variable row types

**Step 1: Write/adjust failing UI coverage**

- Extend `src/__tests__/smoke.test.tsx` or add a focused page test so workflow creation expects:
  - merge-step copy updated
  - auto-inserted variables in `variables_schema`
  - save blocked when a referenced variable is deleted

**Step 2: Run targeted test to verify it fails**

Run: `pnpm exec vitest run src/__tests__/smoke.test.tsx`

**Step 3: Implement minimal UI changes**

- Replace the JSON text area with variable rows.
- Add add/remove/edit controls for variable rows.
- Auto-sync variables whenever step parameters change.
- Validate before create/update and surface missing variable names.

**Step 4: Run targeted test to verify it passes**

Run: `pnpm exec vitest run src/__tests__/smoke.test.tsx`

### Task 3: Full verification

**Files:**
- Modify: `openspec/changes/update-workflow-definition-variables/tasks.md`

**Step 1: Run full verification**

Run:
- `openspec validate update-workflow-definition-variables --strict`
- `pnpm test`
- `pnpm build`

**Step 2: Mark tasks complete**

- Update the OpenSpec tasks checklist after verification is green.

