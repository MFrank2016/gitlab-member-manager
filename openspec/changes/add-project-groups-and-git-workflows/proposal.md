# Change: Add Project Groups and Configurable Git Workflows

## Why
The current application manages GitLab project members and local member groups, but it does not provide a project-centric batch operating model. Users need to organize GitLab projects into local groups, bind them to local repositories, batch-sync members into all projects in a group, and run configurable git workflows across many repositories with clear progress, retry, and failure isolation.

## What Changes
- Add managed project registration that binds a GitLab project to a local repository path.
- Add local project groups with CRUD and bulk project membership management.
- Add batch member sync from existing local member sources into all projects in a project group.
- Add reusable linear workflow definitions with parameterized git steps.
- Add persisted workflow run history with per-project and per-step visibility.
- Add cancel and retry semantics for workflow runs.

## Impact
- Affected specs:
  - `project-group-management`
  - `project-member-sync`
  - `git-workflow-execution`
- Affected code:
  - `src/App.tsx`
  - `src/lib/types.ts`
  - `src/lib/invoke.ts`
  - `src/pages/*`
  - `src-tauri/src/main.rs`
  - `src-tauri/src/db.rs`
  - `src-tauri/src/models.rs`
  - `src-tauri/src/gitlab.rs`
  - `src-tauri/migrations/*`

