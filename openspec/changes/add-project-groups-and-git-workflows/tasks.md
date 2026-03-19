## 1. Data Model
- [x] 1.1 Add SQLite tables and Rust models for managed projects, project groups, workflow definitions, workflow runs, and workflow step history.
- [x] 1.2 Expose Tauri commands and frontend invoke wrappers for managed projects and project groups.

## 2. Project Group Operations
- [x] 2.1 Add UI pages and shared state for managed projects and project groups.
- [x] 2.2 Support bulk assigning managed projects into a selected project group.

## 3. Member Sync
- [x] 3.1 Add backend service methods to resolve members from existing local member groups and selected local members.
- [x] 3.2 Add project-group-scoped batch member sync UI and result reporting.

## 4. Workflow Definitions
- [x] 4.1 Add CRUD for linear workflow definitions and ordered workflow steps.
- [x] 4.2 Add a step-list visual editor with parameter forms, ordering controls, and built-in git step types.

## 5. Workflow Execution
- [x] 5.1 Add a workflow executor in Rust with bounded project concurrency and serial per-project execution.
- [x] 5.2 Persist run, project, and step status during execution.
- [x] 5.3 Add cancel and retry-failed-project flows.

## 6. Verification
- [x] 6.1 Add frontend and backend tests for the new data model, workflow state transitions, and failure isolation.
- [x] 6.2 Run full validation: `openspec validate add-project-groups-and-git-workflows --strict`, `pnpm test`, `pnpm build`, and relevant Rust tests.
