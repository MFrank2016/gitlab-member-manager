# Pipeline Graph Connection-Driven Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current stage-first pipeline graph authoring flow with a connection-driven editor that creates successors from output anchors, auto-layouts local subgraphs, supports cross-stage drag reassignment, and keeps the final graph as a legal DAG.

**Architecture:** Keep `PipelineDraft` as the single persisted source of truth, but split the new layout and drag-intent rules into pure helpers so they can be tested without the canvas. Rebuild `PipelineGraphEditor` around ephemeral connection-creation and drag-preview state, then derive rendered React Flow nodes, stage order, and final persisted positions from the pure layout engine instead of user-controlled free coordinates.

**Tech Stack:** React 18, TypeScript, `@xyflow/react`, Vitest, Testing Library, Vite, Tauri, OpenSpec

---

## Preconditions

- Execute this plan from a clean worktree branched off `main`.
- Do not start code tasks until the new OpenSpec change has been drafted and approved.
- Keep all user-facing failure prompts in simplified Chinese.

### Task 1: Reconcile OpenSpec Scope Before Code

**Files:**
- Create: `openspec/changes/refactor-pipeline-graph-into-connection-driven-authoring/proposal.md`
- Create: `openspec/changes/refactor-pipeline-graph-into-connection-driven-authoring/tasks.md`
- Create: `openspec/changes/refactor-pipeline-graph-into-connection-driven-authoring/design.md`
- Create: `openspec/changes/refactor-pipeline-graph-into-connection-driven-authoring/specs/release-pipeline-orchestration/spec.md`
- Reference: `docs/plans/2026-05-09-pipeline-graph-connection-driven-redesign-design.md`
- Reference only, do not mutate yet: `openspec/changes/update-pipeline-graph-canvas-interactions/*`

**Step 1: Draft the new OpenSpec change instead of stretching the current v1 change**

Create a new change id named `refactor-pipeline-graph-into-connection-driven-authoring`. The proposal should explicitly say the existing `update-pipeline-graph-canvas-interactions` change was scoped to stage-local grid behavior and is insufficient for the approved redesign.

Use this structure:

```md
# Change: Refactor Pipeline Graph Into Connection-Driven Authoring

## Why
- The current v1 canvas still assumes stage-first authoring.
- Users need successor-first graph building, cross-stage drag reassignment, and dependency-driven stage reordering.

## What Changes
- Replace stage-scoped node creation with output-anchor driven creation.
- Replace stage-local grid layout with connection-driven layered layout.
- Allow cross-stage drag reassignment with automatic stage reorder and rollback on illegal DAG results.

## Impact
- Affected specs: `release-pipeline-orchestration`
- Affected code: `src/components/pipeline-graph/*`, `src/pages/WorkflowsPagePipeline.tsx`, graph tests, smoke tests
```

**Step 2: Author the OpenSpec delta for the approved interaction model**

The delta must supersede the current v1 assumptions. Include requirements and scenarios for:

- creating a first node from an empty stage start anchor
- creating successors from a node output anchor
- vertically stacking multiple direct successors
- centering a parent against its successor group
- cross-stage drag reassignment
- stable stage reorder from cross-stage dependencies
- rollback with Chinese error messages when the move would create an illegal graph

Skeleton:

```md
## MODIFIED Requirements
### Requirement: Predictable Pipeline Graph Canvas Interactions
...

#### Scenario: Create the first node from an empty stage
- **WHEN** the user clicks the empty-stage start anchor output point
- **THEN** the editor opens successor creation for that stage without mutating the draft yet

#### Scenario: Create a second direct successor
- **WHEN** node A already has direct successor B and the user creates direct successor C from A
- **THEN** B and C are vertically stacked to the right of A and A is centered against the group
```

**Step 3: Validate the new change in isolation**

Run:

```powershell
openspec validate refactor-pipeline-graph-into-connection-driven-authoring --strict
```

Expected: PASS with no format or scenario errors.

**Step 4: Commit the OpenSpec change only**

```powershell
git add -- "openspec/changes/refactor-pipeline-graph-into-connection-driven-authoring"
git commit -m "docs: propose connection-driven pipeline graph authoring"
```

### Task 2: Introduce A Pure Connection-Driven Layout Engine

**Files:**
- Create: `src/components/pipeline-graph/connection-layout.ts`
- Create: `src/components/pipeline-graph/__tests__/connection-layout.test.ts`
- Modify: `src/components/pipeline-graph/graph-model.ts`

**Step 1: Write the failing pure-layout tests first**

Cover these cases in `connection-layout.test.ts`:

- `layoutSuccessorGroup` places a first successor directly to the right of the parent
- adding a second direct successor stacks it below the first successor
- the parent y-center aligns with the combined successor group center
- `centerStageContent` returns offsets that center the content box inside the stage frame
- `orderStagesByDependencies` produces a stable topological order
- `resolveDropIntent` maps raw coordinates to the nearest legal stage and insertion slot

Example test skeleton:

```ts
it("stacks multiple direct successors vertically and centers the parent", () => {
  const layout = buildConnectionDrivenStageLayout(sampleStageGraph({
    parent: "node-a",
    successors: ["node-b", "node-c"],
  }));

  expect(layout.nodes["node-b"].x).toBe(layout.nodes["node-c"].x);
  expect(layout.nodes["node-b"].y).toBeLessThan(layout.nodes["node-c"].y);
  expect(layout.nodes["node-a"].centerY).toBe(
    (layout.nodes["node-b"].centerY + layout.nodes["node-c"].centerY) / 2
  );
});
```

**Step 2: Run the focused pure-layout suite and verify failure**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/connection-layout.test.ts --reporter=verbose
```

Expected: FAIL because `connection-layout.ts` and its exports do not exist yet.

**Step 3: Implement the minimal pure helpers**

Add helpers like:

```ts
export type LayoutNodeBox = { x: number; y: number; width: number; height: number };

export function buildConnectionDrivenStageLayout(...) { ... }
export function centerStageContent(...) { ... }
export function orderStagesByDependencies(...) { ... }
export function resolveDropIntent(...) { ... }
```

Keep these helpers pure. Do not import React or editor state into this file.

**Step 4: Wire `graph-model.ts` to the new layout engine**

Replace direct dependence on stage-local grid math with calls into `connection-layout.ts` for:

- stage content sizing
- node display positions
- stage-order reconstruction
- drop-intent resolution inputs

Do not change editor UI yet.

**Step 5: Re-run the focused suite**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/connection-layout.test.ts src/components/pipeline-graph/__tests__/graph-model.test.ts --reporter=verbose
```

Expected: PASS for the new pure-layout cases, with any remaining editor failures deferred to later tasks.

**Step 6: Commit**

```powershell
git add -- "src/components/pipeline-graph/connection-layout.ts" "src/components/pipeline-graph/__tests__/connection-layout.test.ts" "src/components/pipeline-graph/graph-model.ts"
git commit -m "feat: add connection-driven graph layout engine"
```

### Task 3: Simplify Node And Stage Rendering For The New Model

**Files:**
- Modify: `src/components/pipeline-graph/PipelineActionNode.tsx`
- Modify: `src/components/pipeline-graph/StageGroupNode.tsx`
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`

**Step 1: Add failing editor tests for the new visual contract**

Cover:

- action nodes render fixed-size cards
- action nodes show only type and name on the canvas
- parameter summary text is removed from the card
- empty stages render a visible start anchor
- old "在所选阶段添加节点" toolbar action is absent or disabled behind the new flow

Example:

```ts
it("renders a start anchor for an empty stage and removes summary-heavy node text", async () => {
  render(<EditorHarness />);

  expect(screen.getByTestId("pipeline-stage-start-anchor-stage-1")).toBeInTheDocument();
  expect(screen.queryByText(/已配置 .* 个参数/)).not.toBeInTheDocument();
});
```

**Step 2: Run the focused editor cases and verify failure**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx --reporter=verbose -t "start anchor|fixed-size|summary-heavy"
```

Expected: FAIL because the start anchor and simplified node card do not exist yet.

**Step 3: Implement the fixed-size visual shell**

- Make `PipelineActionNode.tsx` use a shared width and height constant.
- Render only the node type label and editable node name.
- Remove inline parameter summary copy from the card body.
- Add a visible output-anchor hit target with a stable test id.
- Add an empty-stage start anchor in `StageGroupNode.tsx` with a stable test id.

Use explicit test ids such as:

```tsx
data-testid={`pipeline-node-output-anchor-${data.nodeKey}`}
data-testid={`pipeline-stage-start-anchor-${data.stageKey}`}
```

**Step 4: Re-run the focused editor cases**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx --reporter=verbose -t "start anchor|fixed-size|summary-heavy"
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add -- "src/components/pipeline-graph/PipelineActionNode.tsx" "src/components/pipeline-graph/StageGroupNode.tsx" "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx"
git commit -m "feat: simplify pipeline graph cards and add start anchors"
```

### Task 4: Replace Stage-Scoped Add-Node Flow With Connection-Driven Successor Creation

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/PipelineGraphSelectionPanel.tsx`
- Modify: `src/components/pipeline-graph/graph-model.ts`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`

**Step 1: Write failing tests for the successor-creation flow**

Cover:

- clicking a node output anchor opens a lightweight successor-creation panel
- clicking an empty-stage start anchor opens first-node creation without mutating the draft
- confirming creates both the node and the edge
- cancelling removes the preview edge and keeps the draft unchanged
- creating node C from node A when A already points to B makes B/C become direct successors of A instead of chaining `A -> B -> C`

Example:

```ts
it("creates a second direct successor and keeps the parent node as the shared source", async () => {
  render(<EditorHarness />);
  const nodeA = await createFirstNodeFromStartAnchor("stage-1");
  const nodeB = await createSuccessorFromNode(nodeA.nodeKey, "checkout_branch");
  const nodeC = await createSuccessorFromNode(nodeA.nodeKey, "switch_project");

  const draft = parseDraft();
  expect(draft.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceNodeKey: nodeA.nodeKey, targetNodeKey: nodeB.nodeKey }),
      expect.objectContaining({ sourceNodeKey: nodeA.nodeKey, targetNodeKey: nodeC.nodeKey }),
    ])
  );
});
```

**Step 2: Run the focused creation-flow tests and verify failure**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx --reporter=verbose -t "successor|start anchor|preview edge"
```

Expected: FAIL because the editor still depends on the old toolbar or stage-context creation flow.

**Step 3: Add ephemeral creation state in the editor**

Introduce editor-local state shaped roughly like:

```ts
type PendingSuccessorCreateState =
  | { kind: "stage-start"; stageKey: string }
  | { kind: "node-successor"; sourceNodeKey: string; stageKey: string }
  | null;
```

Use this state to drive:

- preview edge rendering
- lightweight create panel visibility
- final node creation target

Do not write into `PipelineDraft` until validation succeeds.

**Step 4: Rebuild `submitCreateNodeDialog` around successor intent**

On confirm:

- create the node in the source stage by default
- create the edge from the source anchor when the source is a node
- rebuild the stage layout through the pure layout engine
- switch the inspector to the created node

On cancel:

- clear pending successor state
- remove preview edge
- leave the draft unchanged

**Step 5: Re-run the focused creation-flow tests**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx --reporter=verbose -t "successor|start anchor|preview edge"
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/PipelineGraphSelectionPanel.tsx" "src/components/pipeline-graph/graph-model.ts" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx"
git commit -m "feat: add connection-driven pipeline node creation"
```

### Task 5: Implement Local Successor Reflow And Stage Content Centering

**Files:**
- Modify: `src/components/pipeline-graph/connection-layout.ts`
- Modify: `src/components/pipeline-graph/graph-model.ts`
- Modify: `src/components/pipeline-graph/__tests__/connection-layout.test.ts`
- Modify: `src/components/pipeline-graph/__tests__/graph-model.test.ts`

**Step 1: Add failing layout tests for local successor reflow**

Cover:

- a parent with one successor remains horizontally aligned
- adding a second direct successor vertically stacks the group
- parent center realigns after insertion
- stage content box remains centered after reflow
- deleting one successor compacts the group without drifting off center

**Step 2: Run the focused layout suites and verify failure**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/connection-layout.test.ts src/components/pipeline-graph/__tests__/graph-model.test.ts --reporter=verbose -t "successor|center|reflow"
```

Expected: FAIL on the new vertical branching and recentering assertions.

**Step 3: Implement minimal reflow support**

Extend the pure layout engine so that:

- direct successors share a right-hand column
- new successors are appended below existing direct successors
- parent center is derived from the successor group box
- stage content offsets are recalculated after every local mutation

Keep the layout deterministic: same `PipelineDraft` must always reconstruct the same display positions.

**Step 4: Re-run the focused layout suites**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/connection-layout.test.ts src/components/pipeline-graph/__tests__/graph-model.test.ts --reporter=verbose -t "successor|center|reflow"
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add -- "src/components/pipeline-graph/connection-layout.ts" "src/components/pipeline-graph/graph-model.ts" "src/components/pipeline-graph/__tests__/connection-layout.test.ts" "src/components/pipeline-graph/__tests__/graph-model.test.ts"
git commit -m "feat: reflow successor groups in the pipeline graph"
```

### Task 6: Support Cross-Stage Drag Reassignment With Stable Stage Reorder

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/connection-layout.ts`
- Modify: `src/components/pipeline-graph/graph-model.ts`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`
- Modify: `src/components/pipeline-graph/__tests__/connection-layout.test.ts`
- Modify: `src/components/pipeline-graph/__tests__/graph-model.test.ts`

**Step 1: Add failing tests for cross-stage drag**

Cover:

- dragging a node into another stage updates `stageKey`
- the source and target stages both reflow
- cross-stage dependencies reorder stages through stable topological sort
- empty stages remain after their last node moves away

Example:

```ts
it("moves a node across stages and reorders stages from cross-stage dependencies", async () => {
  render(<EditorHarness initialDraft={draftWithTwoStagesAndEdges()} />);
  dragGraphNode("node-b", { x: 900, y: 220 }, { parentId: "stage-2", data: { stageKey: "stage-2" } });

  const draft = parseDraft();
  expect(draft.nodes.find((node) => node.nodeKey === "node-b")?.stageKey).toBe("stage-2");
  expect(draft.stages.map((stage) => stage.stageKey)).toEqual(["stage-1", "stage-2"]);
});
```

**Step 2: Run the focused drag tests and verify failure**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-graph/__tests__/graph-model.test.ts --reporter=verbose -t "cross-stage|reorder stages|empty stages"
```

Expected: FAIL because the current editor rejects cross-stage drops.

**Step 3: Implement minimal cross-stage intent resolution**

When drag stops:

1. resolve the nearest legal target stage
2. resolve the nearest insertion intent within that stage
3. update the node `stageKey`
4. reflow the source stage
5. reflow the target stage
6. recompute stage order from cross-stage dependencies

Do not attempt ghost visuals yet; only make the structural result correct.

**Step 4: Re-run the focused drag tests**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-graph/__tests__/graph-model.test.ts --reporter=verbose -t "cross-stage|reorder stages|empty stages"
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/connection-layout.ts" "src/components/pipeline-graph/graph-model.ts" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx" "src/components/pipeline-graph/__tests__/connection-layout.test.ts" "src/components/pipeline-graph/__tests__/graph-model.test.ts"
git commit -m "feat: support cross-stage pipeline graph reordering"
```

### Task 7: Add Drag Preview Feedback And Illegal-Move Rollback

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/StageGroupNode.tsx`
- Modify: `src/components/pipeline-graph/PipelineActionNode.tsx`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`

**Step 1: Add failing tests for user-visible drag feedback**

Cover:

- active target stage gets a highlight while dragging
- editor shows a ghost insertion marker or placeholder target position
- illegal moves roll back and show a Chinese error
- the draft remains unchanged after rollback

**Step 2: Run the focused feedback cases and verify failure**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx --reporter=verbose -t "highlight|ghost|回退|循环依赖"
```

Expected: FAIL because the editor currently applies drag results without preview semantics and does not expose the new rollback states.

**Step 3: Implement minimal preview state**

Add editor-local state like:

```ts
type PendingDropPreview =
  | { stageKey: string; parentNodeKey: string | null; insertionIndex: number }
  | null;
```

Use it to:

- highlight the current target stage
- render a ghost placeholder in the predicted successor group
- clear itself on drag end or cancellation

**Step 4: Add rollback handling**

If applying the move would create an illegal graph after:

- node reassignment
- stage reorder
- cycle validation

then:

- discard the draft mutation
- restore the previous rendered layout
- surface a Chinese message through the existing graph message channel

**Step 5: Re-run the focused feedback cases**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx --reporter=verbose -t "highlight|ghost|回退|循环依赖"
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/StageGroupNode.tsx" "src/components/pipeline-graph/PipelineActionNode.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx"
git commit -m "feat: preview and rollback pipeline graph drag intents"
```

### Task 8: Align The Page-Level Authoring Flow And Final Verification

**Files:**
- Modify: `src/pages/WorkflowsPagePipeline.tsx`
- Modify: `src/__tests__/smoke.test.tsx`
- Optional doc touch if user-visible flow text changed: `README.md`

**Step 1: Add failing page-level smoke coverage**

Cover the full happy path:

- create a stage
- create the first node from the empty-stage start anchor
- create two direct successors from the same parent
- drag one node into another stage
- save and reload the draft without losing structure

Example outline:

```ts
it("authors a pipeline through connection-driven graph interactions", async () => {
  render(<WorkflowsPagePipeline />);
  // create empty stage
  // create first node from start anchor
  // create B and C from A
  // drag C into stage 2
  // save and reload
});
```

**Step 2: Run the smoke case and verify failure**

Run:

```powershell
pnpm vitest run src/__tests__/smoke.test.tsx --reporter=verbose -t "connection-driven graph interactions"
```

Expected: FAIL because the page still reflects the old stage-first flow.

**Step 3: Implement the page-level wiring**

- remove or hide obsolete add-node affordances that contradict the new flow
- ensure the page keeps the editor mounted with the new empty-stage start state
- keep save / reload working through the same `PipelineDraft` shape

Do not add new page-level business logic unless the tests prove it is needed.

**Step 4: Run the full targeted verification set**

Run:

```powershell
pnpm vitest run src/components/pipeline-graph/__tests__/connection-layout.test.ts src/components/pipeline-graph/__tests__/graph-model.test.ts src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/__tests__/smoke.test.tsx --reporter=verbose
openspec validate refactor-pipeline-graph-into-connection-driven-authoring --strict
pnpm build
```

Expected:

- all targeted Vitest suites PASS
- OpenSpec validation PASS
- `pnpm build` PASS

**Step 5: Commit**

```powershell
git add -- "src/pages/WorkflowsPagePipeline.tsx" "src/__tests__/smoke.test.tsx" "README.md"
git commit -m "test: cover connection-driven pipeline graph authoring"
```

## Notes For Execution

- Keep old grid-layout helpers only as long as needed to bridge the refactor. Delete dead helpers once the connection-driven flow is stable; do not keep a permanent dual-layout code path.
- Prefer pure function growth in `connection-layout.ts` over packing more mutable logic into `PipelineGraphEditor.tsx`.
- If the existing active OpenSpec change becomes fully superseded, archive or explicitly close it in a follow-up docs-only commit after the new change lands.
- If any targeted test hangs, rerun the exact file with `--reporter=verbose` and narrow by `-t` before touching production code.
