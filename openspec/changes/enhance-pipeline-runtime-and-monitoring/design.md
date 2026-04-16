## Context

The current pipeline orchestrator already supports definition CRUD, runtime execution, GitLab nodes, waiting-state persistence, scheduler-driven runs, and monitoring UI. The next risk is no longer feature absence; it is implementation concentration. `workflows.rs`, `db.rs`, `main.rs`, and the two pipeline pages now combine multiple responsibilities that will make every future change slower to reason about and harder to verify.

The product also needs better operator ergonomics. Runs will accumulate over time, active waits need fewer manual refreshes, and failures need clearer state distinctions than a string-only error path. This phase should strengthen the platform without changing the scheduler into a background service or expanding the supported node model.

## Goals / Non-Goals

- Goals:
  - Create clearer runtime and command boundaries.
  - Improve monitoring scalability and operator feedback.
  - Add richer run visualization without changing the release-pipeline product scope.
  - Keep scheduler semantics desktop-bound.
- Non-Goals:
  - Introduce arbitrary script nodes.
  - Turn the scheduler into a system service.
  - Replace SQLite or Tauri.
  - Remove legacy workflow compatibility in the same phase.

## Decisions

- Decision: Split the work into a roadmap-wide OpenSpec change plus smaller grounded implementation plans.
  - Rationale: The product direction spans multiple weeks, but execution should still proceed in small, low-risk slices.

- Decision: Keep the primary affected capabilities under `release-pipeline-orchestration` and `release-pipeline-scheduling`.
  - Rationale: The new work evolves existing behavior instead of introducing a completely separate capability namespace.

- Decision: Prefer summary-first loading and active-run refresh over globally live-updating all run history.
  - Rationale: This gives the largest operator benefit without paying unnecessary query and rendering cost for terminal history.

- Decision: Treat runtime refactoring as behavior-preserving until new monitoring surfaces land.
  - Rationale: The system is already usable; structural cleanup should not casually widen product scope.

## Risks / Trade-offs

- Risk: Runtime splitting introduces subtle execution regressions.
  - Mitigation: Preserve focused regression coverage around retry, cancellation, waiting nodes, and scheduler execution.

- Risk: Monitoring improvements spread across frontend, command surface, and DB queries at the same time.
  - Mitigation: Sequence the work so query-shape changes land before visualization changes.

- Risk: The project currently has no archived `openspec/specs/` baseline.
  - Mitigation: Keep this change narrowly aligned with the existing completed pipeline change and avoid renaming capabilities in the same phase.

## Migration Plan

1. Create this change to define the two-month evolution direction.
2. Create a grounded implementation plan for week 1-2 only.
3. Execute runtime foundation and command-layer cleanup first.
4. Add monitoring and scheduler query improvements next.
5. Land visualizations only after the data-loading model stabilizes.

## Open Questions

- Should active-run updates use Tauri events first or start with targeted polling?
- Should pipeline run logs remain in the main detail payload for a transition release or move directly to lazy loading?
- At what point should the workflow compatibility wrappers become read-only plus hidden rather than merely preserved?
