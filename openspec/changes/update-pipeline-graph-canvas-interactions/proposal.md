# Change: Update Pipeline Graph Canvas Interactions

## Why
The current pipeline graph canvas already supports stage-grouped DAG authoring, but its editing interactions are still unreliable. Users cannot consistently select the intended stage or node, contextual actions are missing, node creation is too loose, and stage-internal placement becomes crowded as definitions grow.

That combination blocks day-to-day authoring. The editor needs a predictable interaction model before larger pipeline definitions can be created and maintained safely.

## What Changes
- Add stable left-click selection for stages and nodes so the inspector always opens the matching editing state.
- Add scoped right-click menus for stages and nodes, limited to the approved stage and node actions.
- Replace ad hoc node creation with a stage-scoped create-node dialog that enforces required-field validation before mutating the draft.
- Replace stage-internal free placement with a structured grid layout that keeps connection whitespace, auto-sizes stage containers, and reflows nodes after stage-local drag operations.
- Restrict stage dragging to horizontal sorting only and keep node dragging stage-local in v1.

## Impact
- Affected specs:
  - `release-pipeline-orchestration`
- Affected code:
  - `src/components/pipeline-graph/PipelineGraphEditor.tsx`
  - `src/components/pipeline-graph/StageGroupNode.tsx`
  - `src/components/pipeline-graph/PipelineActionNode.tsx`
  - `src/components/pipeline-graph/PipelineGraphSelectionPanel.tsx`
  - `src/components/pipeline-graph/graph-model.ts`
  - `src/pages/WorkflowsPagePipeline.tsx`
  - `src/components/pipeline-graph/__tests__/*`
  - `src/components/pipeline-editor/__tests__/*`
  - `src/__tests__/smoke.test.tsx`
