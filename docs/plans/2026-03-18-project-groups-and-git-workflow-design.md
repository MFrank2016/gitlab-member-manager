# Project Groups and Configurable Git Workflow Design

Date: 2026-03-18
Status: Approved (brainstorming sign-off)

## Context
The current desktop tool focuses on GitLab project member management with local member groups, batch add/remove operations, and a Tauri + React + Rust + SQLite architecture. The next expansion should keep that foundation but add a higher-level operating model for project-centric batch work:

- local project groups
- batch member sync into project groups
- configurable multi-project git workflows

The user explicitly wants these workflows to be configurable rather than hardcoded, visible while running, interruptible, retryable, and isolated so one project failure does not block other projects.

## Goals
- Add local project grouping with CRUD and bulk project assignment.
- Support binding a GitLab project to a local repository path.
- Support batch member sync into all projects in a project group using existing local member groups as the first member source.
- Support configurable linear git workflows for multiple projects.
- Support a common merge pipeline such as `A -> pull -> merge into B -> push B -> merge into C -> push C`.
- Make workflow execution visual, interruptible, retryable, and history-backed.
- Keep the first version operationally safe and simpler than a full workflow engine.

## Non-goals
- No DAG editor, branching workflow graph, or arbitrary parallel node graph in v1.
- No automatic resume-from-crash execution in v1.
- No GitLab native group/member source in v1; reuse local member groups first.
- No full remote CI orchestration; workflows run against local repositories only.

## Product Direction
Use a linear workflow engine on top of the existing app rather than adding several fixed-purpose batch actions.

Why this direction:
- It matches the existing local-first Tauri architecture.
- It supports the requested merge pipeline without hardcoding a single business flow.
- It keeps the first version understandable: projects are grouped locally, workflows are ordered steps, and execution history is persisted.

## Core Domain Model

### Managed Project
A managed project is the bridge between GitLab operations and local git operations.

Required fields:
- `gitlab_project_id`
- `name`
- `path_with_namespace`
- `repo_path`
- `default_branch`
- `default_remote`
- `enabled`
- `created_at`
- `updated_at`

Behavior:
- GitLab member operations target the registered GitLab project.
- Git workflows run against `repo_path`.
- A project can exist without being in a project group.

### Project Group
A project group is a local collection of managed projects.

Behavior:
- support create, rename, delete
- support bulk add/remove projects
- support viewing all projects in the group
- support running member sync or git workflow against the whole group

### Member Source
The first version should reuse the existing local member group model.

Supported source modes:
- manually selected local members
- selected local member group

Target:
- all projects within one project group

This keeps personnel sourcing stable while allowing future extension to GitLab groups later.

### Workflow Definition
A workflow definition is a reusable ordered list of steps plus parameter metadata.

Required fields:
- `name`
- `description`
- `enabled`
- `variables_schema`
- `max_concurrency_default`
- `steps`

The key rule is that the workflow stores step templates, not hardcoded branch names. Concrete values are supplied at run time.

### Workflow Run
A workflow run represents one batch execution of one workflow against one project group.

Behavior:
- stores run parameters
- stores concurrency setting
- stores status summary
- stores per-project and per-step progress
- supports cancellation
- supports rerun of failed projects

## Workflow Model

### Supported Workflow Style
The first version supports linear ordered steps only.

Recommended built-in step types:
- `ensure_clean_worktree`
- `fetch_remote`
- `checkout_branch`
- `git_pull`
- `git_merge`
- `git_push`

Optional later step types:
- `create_branch`
- `reset_hard_to_remote`
- `run_shell_command` with explicit safety restrictions

### Variable Design
Workflow steps should be parameterized with placeholders such as:
- `${source_branch}`
- `${target_branch}`
- `${next_branch}`
- `${remote}`

This allows one workflow definition to be reused for different branch chains.

### Example Built-in Template
The app can ship with a starter template for the main scenario:

1. checkout `${source_branch}`
2. pull `${source_branch}`
3. checkout `${target_branch_1}`
4. pull `${target_branch_1}`
5. merge `${source_branch}` into current branch
6. push current branch
7. checkout `${target_branch_2}`
8. pull `${target_branch_2}`
9. merge `${target_branch_1}` into current branch
10. push current branch

This is still a normal workflow definition, not a special hardcoded path.

## Execution Architecture

### Backend Ownership
The workflow executor should live in Rust/Tauri, not in the React frontend.

Reasons:
- process management is safer on the backend
- filesystem and git command execution belong near the OS boundary
- cancellation and history persistence are easier to control centrally
- frontend can stay focused on state display and user interaction

### Concurrency Rules
- project-internal steps are strictly serial
- projects run with bounded concurrency
- default strategy is concurrent projects with configurable parallelism, recommended default `2`

This satisfies speed and isolation requirements without overwhelming disk or network resources.

### Run State Machine
Workflow run statuses:
- `pending`
- `running`
- `cancelling`
- `completed`
- `partial_failed`
- `cancelled`

Per-project statuses:
- `queued`
- `running`
- `success`
- `failed`
- `cancelled`
- `failed_precheck`

Per-step statuses:
- `pending`
- `running`
- `success`
- `failed`
- `skipped`

### Cancellation Semantics
Cancellation should be cooperative:
- stop scheduling new projects immediately
- allow the current git subprocess in a running project to reach a safe boundary
- mark remaining queued projects as cancelled
- mark running project state based on the point reached

Avoid force-killing repositories mid-step in v1 unless a later safety review justifies it.

### Retry Semantics
Supported retry actions:
- retry one failed project
- retry all failed projects

Retry behavior:
- create a new workflow run record
- reference the previous run ID
- reuse the same workflow definition and run parameters
- only include selected failed projects in the new run

This keeps history auditable and avoids mutating previous run records.

## UI Design

### New Primary Views
- `Managed Projects`
- `Project Groups`
- `Workflows`
- `Workflow Runs`

These should follow the existing app pattern: panel layout, toolbar, tables, dialogs, and detail views.

### Managed Projects Page
Purpose:
- register GitLab project + local repo path binding
- edit repo path and defaults
- validate whether the path is a git repository

Recommended actions:
- import selected project from current project search flow
- manually edit local path
- enable/disable project
- quick open containing folder later if desired

### Project Groups Page
Purpose:
- CRUD local project groups
- bulk add managed projects into a group
- view projects inside a selected group
- launch member sync or workflow execution for the selected group

This page is the project analogue of the current local member groups page.

### Workflows Page
The first version should use a step-list editor rather than a node graph editor.

Recommended editing affordances:
- create workflow
- rename, duplicate, delete
- add step from type menu
- reorder steps with up/down actions
- enable/disable step
- edit params in a side panel or inline form
- configure per-step timeout and retry policy

This is still visual editing, but it avoids the cost of a full drag-and-drop graph engine.

### Workflow Run Page
This should be a persistent monitoring page rather than a temporary dialog.

Layout recommendation:
- left: project run list with status colors and counts
- right top: workflow summary, parameters, global controls
- right bottom: selected project timeline with step list, logs, stdout/stderr, exit code, timestamps

Controls:
- cancel run
- retry failed projects
- filter by status
- inspect only current failures

### Batch Member Sync UX
From a project group, the user chooses:
- member source type: selected members or local member group
- access level
- optional expiry

The system then applies the same member set to all projects in the project group, producing per-project results similar to workflow execution results.

## Persistence Model

### New Tables
Suggested SQLite tables:
- `managed_projects`
- `project_groups`
- `project_group_items`
- `workflow_definitions`
- `workflow_steps`
- `workflow_runs`
- `workflow_run_projects`
- `workflow_run_steps`

Suggested relationships:
- one managed project can belong to many project groups
- one workflow definition has many ordered steps
- one workflow run targets one project group
- one workflow run has many project run records
- one project run has many step run records

### Stored Execution Data
Each step run should persist:
- step type
- rendered parameters
- started_at
- finished_at
- status
- stdout
- stderr
- exit_code
- summary_message

This enables history view, failure inspection, and rerun selection.

## Error Handling Strategy

### Precheck Failures
Detect before starting project execution:
- repository path missing
- path is not a git repository
- worktree dirty when the workflow requires a clean tree
- required branch missing
- missing remote configuration

Projects that fail precheck should be marked `failed_precheck` and excluded from further step execution.

### Step Failures
Examples:
- `git pull` rejected
- merge conflict
- `git push` rejected
- branch checkout failure

Rules:
- fail only the current project
- continue other projects
- preserve command output for diagnosis
- support rerun from a fresh retry run

### System Failures
Examples:
- database write error
- executor process spawn failure
- application-level panic

These may affect the entire workflow run and should surface a stronger top-level error state.

## Safety Constraints
- Prefer safe defaults over speed.
- Do not write a destructive workflow primitive into v1 by default.
- Keep force operations explicit and opt-in.
- Show clear warnings before any step that can overwrite local state.
- Store enough context to let users understand exactly what happened per project.

## Testing Strategy

### Frontend
- workflow editor component tests
- project group page interaction tests
- workflow run monitor rendering and filtering tests

### Backend Data Layer
- migration tests for all new tables
- CRUD tests for managed projects, project groups, and workflows
- run history write/read tests

### Executor Integration
Use temporary local git repositories to validate:
- successful multi-project run
- one-project failure does not stop others
- merge conflict path
- cancellation behavior
- retry of failed projects
- correct persistence of run and step logs

## Incremental Delivery Plan

### Phase 1
- managed projects registry
- project groups CRUD
- bulk add projects into groups

### Phase 2
- batch member sync into project groups using existing local member groups

### Phase 3
- workflow definition CRUD
- linear step editor
- built-in merge template

### Phase 4
- workflow executor
- persistent run history
- cancel and retry failed projects

### Phase 5
- UX polish for monitoring, filtering, and log inspection

## Recommended OpenSpec Shape
If implementation moves forward, create a change proposal instead of coding directly.

Suggested change ID:
- `add-project-groups-and-git-workflows`

Likely affected capabilities:
- project-group-management
- project-member-sync
- git-workflow-execution

Expected proposal artifacts:
- `proposal.md`
- `tasks.md`
- `design.md`
- delta specs for each capability above

## Open Questions Deferred
- Whether future versions should support GitLab native groups as member sources.
- Whether future versions should support per-step conditional branching.
- Whether future versions should support auto-resume after application restart.
- Whether future versions should expose limited custom shell steps.

## Summary
The recommended first version is a local-first, persisted, linear workflow system built around managed projects and project groups. It reuses existing member-group capabilities, keeps git execution in Rust, runs projects with bounded concurrency, isolates project failures, and exposes a practical visual editor based on ordered step cards rather than a full graph editor.
