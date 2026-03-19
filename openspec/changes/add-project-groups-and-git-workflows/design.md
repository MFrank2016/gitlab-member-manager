## Context
The application is a local-first Tauri desktop tool backed by SQLite. Existing functionality already manages GitLab members, local members, and local member groups. The new work should preserve that architecture while introducing project-centric operations and a configurable git workflow model.

## Goals / Non-Goals
- Goals:
  - represent GitLab projects together with local repository paths
  - group projects locally for batch operations
  - reuse existing local member groups as the first member source for project-group sync
  - support parameterized linear git workflows with visible run history
  - isolate failures per project and preserve retryability
- Non-Goals:
  - no DAG editor in v1
  - no automatic resume after app restart in v1
  - no GitLab native group-member source in v1

## Decisions
- Decision: introduce a `managed_projects` layer between GitLab project search and project-group workflows.
  - Why: member sync needs GitLab project IDs while git workflows need local repository paths; a single registry object cleanly joins both concerns.
- Decision: keep workflow definitions linear and ordered.
  - Why: the main requested merge path is sequential, and linear steps are substantially easier to validate, render, and retry than a graph workflow engine.
- Decision: execute workflows in Rust with persisted run state.
  - Why: subprocess control, filesystem access, cancellation boundaries, and durable logging belong in the backend, not React.
- Decision: run projects with bounded concurrency and serial project-internal execution.
  - Why: this satisfies throughput requirements while preventing one project failure from blocking others.

## Risks / Trade-offs
- Risk: workflow scope can grow into a general automation engine.
  - Mitigation: constrain v1 step types to a small built-in set focused on git checkout, pull, merge, and push.
- Risk: repository state can be unsafe to modify.
  - Mitigation: add explicit prechecks for repo existence, git status cleanliness, branch existence, and remote configuration.
- Risk: long-running runs can be hard to inspect.
  - Mitigation: persist run, project, and step history with stdout/stderr summaries and timestamps.

## Migration Plan
1. Add schema migrations for managed projects, project groups, workflow definitions, and workflow run history.
2. Introduce backend models and commands before adding UI pages.
3. Add workflow definition CRUD before the executor so the UI can be shaped against real data.
4. Add workflow execution and persistent monitoring last.

## Open Questions
- Whether later versions should support GitLab native groups as member sources.
- Whether later versions should allow custom shell commands.
- Whether later versions should support auto-resume after application restart.

