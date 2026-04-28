## Context

The repository already contains a production-oriented linear `pipeline_*` runtime with Git and GitLab nodes, schedule CRUD, waiting-state persistence, and Chinese failure envelopes. The newly approved design in `docs/plans/2026-04-28-stage-aware-dag-gitlab-release-automation-design.md` upgrades that runtime into a stage-aware DAG release orchestrator without discarding the proven parts of the current system.

The key product constraint is not “support arbitrary workflows”. It is narrower and more operationally focused:

- stages run one after another
- nodes inside a stage may run in parallel
- downstream stages never start after an upstream stage fails
- already-running peer nodes are allowed to finish
- users need stage-level and node-level retry options
- users need a visual DAG editor based on an open-source component rather than a custom canvas

## Goals / Non-Goals

- Goals:
  - introduce first-class `pipeline_stages`, `pipeline_edges`, and `pipeline_run_stages`
  - replace linear node scheduling with stage-aware DAG scheduling
  - preserve the existing GitLab wait metadata and Chinese failure envelope model
  - expose stage-level and node-level derived retries with clear lineage
  - move the pipeline definition UI to a React Flow based editor
- Non-Goals:
  - no arbitrary script execution in v1
  - no fully general DAG language with unconstrained control flow
  - no final CICD release-platform node in this change
  - no in-place resume semantics; retries always create a new run

## Decisions

- Decision: model stages as first-class persisted entities rather than canvas-only metadata.
  - Why: stages are execution boundaries, retry boundaries, and monitoring boundaries, not just visual grouping.

- Decision: constrain the DAG model instead of allowing arbitrary graph semantics.
  - Why: every node must belong to one stage, cycles are forbidden, and edges may not point from a later stage to an earlier stage. This keeps validation comprehensible and prevents the product from turning into a general-purpose automation engine.

- Decision: keep the current built-in Git and GitLab node types.
  - Why: the required capability shift is in scheduling and authoring, not in replacing the proven node behaviors.

- Decision: preserve the current failure policy for already-running work, but move it to the stage boundary.
  - Why: once a node in the active stage fails, the scheduler must stop launching new peer nodes, allow already-running peers to finish, mark the stage failed or partially failed, and block all downstream stages.

- Decision: represent retries as derived runs with explicit retry targets.
  - Why: full-run, stage, and node retries need auditability. A new run linked by `source_pipeline_run_id` is clearer than mutating the original run in place.

- Decision: use React Flow as the DAG editor substrate.
  - Why: the project already uses React, and React Flow provides nodes, edges, grouping, and custom rendering without forcing the team to maintain a bespoke drag-and-drop graph editor.

## Risks / Trade-offs

- Risk: adding stages and edges touches persistence, runtime scheduling, and UI at the same time.
  - Mitigation: land the work in layers: schema first, CRUD plus validation second, runtime third, editor fourth.

- Risk: retry semantics can become confusing if reused work is not visible.
  - Mitigation: add explicit `reused` semantics to stage and node runtime records and surface them in the run monitor.

- Risk: client and server DAG validation may drift apart.
  - Mitigation: keep the authoritative validation in Rust and keep the TypeScript validation layer intentionally thin and shape-compatible.

- Risk: the first Rust build in a fresh worktree is slow.
  - Mitigation: keep focused tests small during implementation and reserve full verification for the final milestone.

## Migration Plan

1. Add stage, edge, and run-stage schema without removing existing linear pipeline data.
2. Upgrade definition CRUD to read and write the richer model while validating illegal graphs.
3. Replace the linear scheduler with a stage-aware DAG scheduler that still reuses the current node executors.
4. Add retry targeting and reused-state persistence.
5. Replace the current linear editor UI with a React Flow editor and extend the run monitor with stage summaries and retry entry points.

## Open Questions

- Whether stage group layout should be fully manual in v1 or include a lightweight auto-layout helper button.
- Whether stage retry should allow overriding a narrow set of variables immediately in the retry modal or only inherit the original snapshot in the first implementation pass.
