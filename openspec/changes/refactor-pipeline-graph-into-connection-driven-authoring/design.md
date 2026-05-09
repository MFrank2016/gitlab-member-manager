## Context
The current React Flow editor already renders stage groups, action nodes, and dependency edges, and the active v1 interaction change improves selection and stage-local layout. The approved redesign goes further: users want to create nodes only from output anchors, let the editor auto-place direct successors, drag nodes across stages, and rely on dependency-driven stage ordering instead of manually maintaining most structure.

That means the editor is no longer primarily a stage-first form with a visual canvas. It becomes a connection-driven authoring surface that interprets structural intent and then reconstructs a stable, legal stage-aware DAG.

## Goals / Non-Goals
- Goals:
  - Make node output anchors the primary authoring path for successor creation.
  - Allow empty stages to create the first node through a start anchor without reintroducing stage-scoped add-node flows.
  - Keep all canvas nodes at uniform size and move parameter-heavy detail into the inspector or lightweight creation UI.
  - Rebuild stage-local layout around layered successor groups instead of grid slots.
  - Allow cross-stage drag reassignment and stable stage reorder from cross-stage dependencies.
  - Roll back illegal graph results and present simplified-Chinese failure prompts.
- Non-Goals:
  - Replacing React Flow.
  - Removing stages from the persisted model.
  - Introducing fully freeform canvas placement.
  - Changing runtime orchestration semantics outside what is needed for authoring persistence and retry targeting.

## Decisions
- Decision: keep `PipelineDraft` as the single persisted source of truth, but move layout and drag-intent rules into pure helpers.
  - Why: layout, reflow, stage-order, and rollback rules are easier to reason about and test without UI state.

- Decision: create nodes only from output anchors, including a non-persisted empty-stage start anchor.
  - Why: the approved interaction model says users should build the graph by extending flow structure, not by choosing a stage first and inserting a placeholder node.

- Decision: replace stage-local grid semantics with connection-driven layered layout.
  - Why: direct successors need deterministic vertical stacking and parent centering, which grid slots do not express cleanly.

- Decision: allow cross-stage drag reassignment, but interpret drag as structural intent rather than free coordinates.
  - Why: the user wants to express “move this node into that structure” and let the editor rebuild a stable layout.

- Decision: recompute stage order from cross-stage dependencies with a stable topological sort.
  - Why: once nodes can move across stages, static stage order becomes fragile and should follow dependency direction first.

- Decision: rollback illegal results instead of leaving partially invalid graphs in the editor.
  - Why: the approved authoring model prefers aggressive automatic correction and explicit Chinese failure messaging over leaving the user to repair broken graphs manually.

## Risks / Trade-offs
- Risk: replacing the grid-slot authoring model can invalidate assumptions in existing tests and smoke flows.
  - Mitigation: move the core rules into pure helpers, then rebuild page-level tests around successor-first authoring instead of patching old expectations one by one.

- Risk: cross-stage drag plus automatic stage reorder can feel surprising if the editor moves too much unrelated content.
  - Mitigation: scope reflow to affected source and target stages first, then apply stable stage reorder that preserves existing order whenever dependencies allow it.

- Risk: DOM test infrastructure becomes a hidden blocker for editor work.
  - Mitigation: keep pure logic suites on the `node` environment, keep DOM suites on the supported `jsdom` environment, and validate the baseline before starting feature work.

## Migration Plan
1. Land this OpenSpec change as the approved scope for the connection-driven redesign.
2. Introduce pure layout helpers and environment-stable tests before changing the editor interaction model.
3. Replace creation entry points and stage-local drag semantics with the new successor-first flow.
4. Add cross-stage drag reassignment, stage reorder, rollback, and page-level smoke coverage.
5. Once the new change is implemented, archive or explicitly supersede the older v1 interaction change.

## Open Questions
- Whether the older `update-pipeline-graph-canvas-interactions` change should be archived as superseded immediately after this redesign lands, or kept only as historical design context.

