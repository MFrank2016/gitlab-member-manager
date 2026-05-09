# Change: Refactor Pipeline Graph Into Connection-Driven Authoring

## Why
- The current `update-pipeline-graph-canvas-interactions` change improves selection, context menus, and stage-local layout, but it still assumes stage-first authoring.
- The approved redesign shifts the editor toward successor-first authoring, cross-stage drag reassignment, and dependency-driven stage ordering, which is larger than a v1 interaction patch.
- Continuing to stretch the current v1 change would mix two different interaction models and make both implementation and review harder.

## What Changes
- Replace stage-scoped add-node flows with output-anchor driven successor creation for both populated stages and empty stages.
- Replace stage-local grid-slot authoring semantics with connection-driven layered layout, parent-to-successor centering, and stage-internal dual-axis centering.
- Allow cross-stage node dragging with automatic stage reassignment, stable stage reorder from cross-stage dependencies, and rollback on illegal DAG results.
- Keep `PipelineDraft`, React Flow, and the stage-aware persistence model, but rebuild the editor interaction layer around structural intent instead of free coordinates.

## Impact
- Affected specs:
  - `release-pipeline-orchestration`
- Affected code:
  - `src/components/pipeline-graph/*`
  - `src/components/pipeline-editor/*`
  - `src/pages/WorkflowsPagePipeline.tsx`
  - `src/pages/WorkflowRunsPagePipeline.tsx`
  - `src/__tests__/smoke.test.tsx`
  - `src/components/pipeline-graph/__tests__/*`
  - `src/components/pipeline-editor/__tests__/*`

