# Project Groups and Git Workflows Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add managed projects, local project groups, project-group member sync, and configurable linear git workflow execution with persistent history.

**Architecture:** Keep the current Tauri + React + SQLite split. Add new SQLite tables and Rust/Tauri commands first, then layer React pages and invoke wrappers on top, and finally introduce a Rust workflow executor that persists run, project, and step state for monitoring, cancellation, and retry.

**Tech Stack:** React 18, TypeScript, Vite, Tauri 2, Rust, sqlx, SQLite, Vitest.

---

## Prerequisites
- Use @superpowers:using-git-worktrees before implementation.
- Read `openspec/changes/add-project-groups-and-git-workflows/proposal.md`.
- Read `openspec/changes/add-project-groups-and-git-workflows/design.md`.
- Validate the change before coding: `openspec validate add-project-groups-and-git-workflows --strict`.

---

### Task 1: Add migration coverage for managed projects and project groups

**Files:**
- Create: `src-tauri/migrations/0004_managed_projects.sql`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Test: `src-tauri/src/db.rs`

**Step 1: Write the failing migration-backed test**

Add a Rust test that initializes a temp database and expects empty reads for managed projects and project groups.

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 db::`
Expected: FAIL because the new tables and query helpers do not exist.

**Step 3: Write minimal migration and model types**

Add tables for:
- `managed_projects`
- `project_groups`
- `project_group_items`

Add Rust structs for managed project and project group views.

**Step 4: Add read helpers in `db.rs`**

Implement minimal list/create query helpers needed by the failing test.

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 db::`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/migrations/0004_managed_projects.sql src-tauri/src/db.rs src-tauri/src/models.rs
git commit -m "feat: add managed project and project group schema"
```

---

### Task 2: Add Tauri commands and frontend invoke wrappers for managed projects

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`

**Step 1: Write the failing frontend-level test or type usage**

Add a minimal TypeScript usage in a test or page stub that expects `listManagedProjects()` and `createManagedProject()`.

**Step 2: Run test or build to verify it fails**

Run: `pnpm build`
Expected: FAIL because the wrappers and types are missing.

**Step 3: Add backend commands**

Add commands for:
- `create_managed_project`
- `list_managed_projects`
- `update_managed_project`
- `delete_managed_project`

**Step 4: Add frontend wrappers and types**

Define `ManagedProject` in `src/lib/types.ts` and matching invoke wrappers in `src/lib/invoke.ts`.

**Step 5: Run verification**

Run: `pnpm build`
Expected: PASS for the new type surface.

**Step 6: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/src/db.rs src-tauri/src/models.rs src/lib/types.ts src/lib/invoke.ts
git commit -m "feat: expose managed project commands"
```

---

### Task 3: Add project group CRUD and membership commands

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`

**Step 1: Write the failing backend test**

Add a Rust test that creates a project group, attaches a managed project, and expects the membership listing to include it.

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 project_group`
Expected: FAIL because group membership helpers do not exist.

**Step 3: Add DB helpers and commands**

Implement:
- `create_project_group`
- `list_project_groups`
- `update_project_group`
- `delete_project_group`
- `add_projects_to_group`
- `remove_projects_from_group`
- `list_project_group_projects`

**Step 4: Add frontend wrappers and types**

Expose TypeScript types for project groups and grouped project rows.

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 project_group`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/src/db.rs src-tauri/src/models.rs src/lib/types.ts src/lib/invoke.ts
git commit -m "feat: add project group commands"
```

---

### Task 4: Add managed projects and project groups pages

**Files:**
- Modify: `src/App.tsx`
- Create: `src/pages/ManagedProjectsPage.tsx`
- Create: `src/pages/ProjectGroupsPage.tsx`
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/lib/invoke.ts`
- Modify: `src/lib/types.ts`

**Step 1: Write the failing UI smoke test**

Add a test that renders `App` and expects navigation entries for managed projects and project groups.

**Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL because the new pages and nav items do not exist.

**Step 3: Add minimal page shells**

Implement:
- managed projects list with create/edit dialog
- project groups list with active-group detail panel

Reuse existing `Panel`, `Table`, `Dialog`, and selection patterns.

**Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS for the updated navigation and page mounting.

**Step 5: Commit**

```bash
git add src/App.tsx src/pages/ManagedProjectsPage.tsx src/pages/ProjectGroupsPage.tsx src/components/ui/sidebar.tsx
git commit -m "feat: add managed projects and project groups pages"
```

---

### Task 5: Add project-group member sync backend support

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/gitlab.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`

**Step 1: Write the failing backend test**

Add a service-level test that resolves members from an existing local member group and expects project-level result aggregation.

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 member_sync`
Expected: FAIL because project-group member sync does not exist.

**Step 3: Implement source resolution and batch project iteration**

Add a backend command that:
- loads the target project group
- resolves members from a local member group or selected user IDs
- applies GitLab add-member operations per project
- returns per-project result rows

**Step 4: Add TypeScript wrappers**

Expose the request/response types and invoke wrapper.

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 member_sync`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/gitlab.rs src/lib/types.ts src/lib/invoke.ts
git commit -m "feat: add project group member sync"
```

---

### Task 6: Add workflow definition schema and CRUD

**Files:**
- Create: `src-tauri/migrations/0005_workflow_definitions.sql`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`

**Step 1: Write the failing backend test**

Add a test that creates a workflow definition with ordered steps and expects the step order to be preserved on read.

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 workflow_definition`
Expected: FAIL because workflow tables and CRUD are missing.

**Step 3: Add schema and model types**

Add:
- `workflow_definitions`
- `workflow_steps`

Persist ordered steps and parameter JSON.

**Step 4: Add commands and frontend wrappers**

Implement workflow definition CRUD and list/detail calls.

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 workflow_definition`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/migrations/0005_workflow_definitions.sql src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/main.rs src/lib/types.ts src/lib/invoke.ts
git commit -m "feat: add workflow definition schema"
```

---

### Task 7: Add workflow editor UI

**Files:**
- Create: `src/pages/WorkflowsPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`
- Test: `src/__tests__/smoke.test.tsx`

**Step 1: Write the failing UI test**

Add a test that expects a workflow page to render a step list and allow reordering controls.

**Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL because the workflow page does not exist.

**Step 3: Build the minimal editor**

Add:
- workflow list
- create/edit dialog
- ordered step cards
- add/remove/up/down actions
- per-step parameter form for built-in step types

**Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/WorkflowsPage.tsx src/App.tsx src/components/ui/sidebar.tsx src/__tests__/smoke.test.tsx
git commit -m "feat: add workflow editor page"
```

---

### Task 8: Add workflow run persistence and status models

**Files:**
- Create: `src-tauri/migrations/0006_workflow_runs.sql`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`

**Step 1: Write the failing backend test**

Add a test that creates a workflow run with one project and one step row and expects the history query to return the nested state.

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 workflow_run`
Expected: FAIL because workflow run persistence is missing.

**Step 3: Add schema and queries**

Add:
- `workflow_runs`
- `workflow_run_projects`
- `workflow_run_steps`

Implement list/detail persistence helpers.

**Step 4: Add command surface and TS types**

Expose history queries through Tauri and `src/lib/invoke.ts`.

**Step 5: Run test to verify it passes**

Run: `cargo test -j 1 workflow_run`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/migrations/0006_workflow_runs.sql src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/main.rs src/lib/types.ts src/lib/invoke.ts
git commit -m "feat: add workflow run persistence"
```

---

### Task 9: Add Rust workflow executor for linear git steps

**Files:**
- Create: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Test: `src-tauri/src/workflows.rs`

**Step 1: Write the failing executor integration test**

Create a temp-repo integration test that:
- initializes a sample git repository
- runs a trivial workflow such as checkout + status-safe precheck
- expects step and project status updates to be persisted

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 workflows::`
Expected: FAIL because no executor exists.

**Step 3: Implement the executor**

Implement:
- linear step rendering with run-time variables
- prechecks for repo existence and clean worktree where required
- serial per-project execution
- bounded project concurrency
- per-step stdout/stderr capture

**Step 4: Run test to verify it passes**

Run: `cargo test -j 1 workflows::`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/workflows.rs src-tauri/src/main.rs src-tauri/src/db.rs src-tauri/src/models.rs
git commit -m "feat: add linear workflow executor"
```

---

### Task 10: Add cancellation and retry flows

**Files:**
- Modify: `src-tauri/src/workflows.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`

**Step 1: Write the failing executor test**

Add tests that:
- cancel an active run and expect queued projects not to start
- retry failed projects and expect a new run record referencing the old run

**Step 2: Run test to verify it fails**

Run: `cargo test -j 1 workflows::`
Expected: FAIL because cancellation and retry are missing.

**Step 3: Implement minimal behavior**

Add:
- cooperative cancellation state
- retry-failed-project command
- source-run linkage on retry

**Step 4: Run test to verify it passes**

Run: `cargo test -j 1 workflows::`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/workflows.rs src-tauri/src/main.rs src-tauri/src/db.rs src-tauri/src/models.rs src/lib/types.ts src/lib/invoke.ts
git commit -m "feat: add workflow cancellation and retry"
```

---

### Task 11: Add workflow run monitoring UI

**Files:**
- Create: `src/pages/WorkflowRunsPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/invoke.ts`

**Step 1: Write the failing UI test**

Add a UI test that expects workflow runs to render a project list and step details for the selected project.

**Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL because the workflow run page does not exist.

**Step 3: Implement the page**

Add:
- workflow run list
- selected run summary
- per-project status list
- step timeline with stdout/stderr detail
- cancel and retry-failed buttons

**Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/WorkflowRunsPage.tsx src/App.tsx src/components/ui/sidebar.tsx
git commit -m "feat: add workflow run monitor"
```

---

### Task 12: Final integration verification

**Files:**
- None (verification only)

**Step 1: Validate OpenSpec**

Run: `openspec validate add-project-groups-and-git-workflows --strict`
Expected: PASS

**Step 2: Run frontend verification**

Run: `pnpm test`
Expected: PASS

Run: `pnpm build`
Expected: PASS

**Step 3: Run Rust verification**

Run: `cargo test -j 1`
Expected: PASS

**Step 4: Manual desktop verification**

Run: `pnpm tauri dev`
Expected:
- managed projects page can create/edit bindings
- project groups page can bulk assign projects
- member sync shows per-project result rows
- workflows page can edit linear steps
- workflow runs page shows status, logs, cancel, and retry

**Step 5: Commit**

```bash
git status --short
git add .
git commit -m "feat: add project groups and workflow execution"
```
