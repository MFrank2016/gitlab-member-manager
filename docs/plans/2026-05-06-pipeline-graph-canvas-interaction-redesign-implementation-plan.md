# Pipeline Graph Canvas Interaction Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the pipeline definition canvas selectable, context-menu driven, grid-based, and reorderable so stages and action nodes can be created, edited, dragged, and deleted predictably.

**Architecture:** Keep `PipelineDraft` as the single source of truth and continue using the current React Flow parent-child stage/node model. Add editor-local UI state for context menus and the create-node dialog, move layout logic into `graph-model.ts`, and drive all drag/reorder results back into `PipelineDraft` so the whole canvas remains reconstructable from draft data.

**Tech Stack:** React 18, TypeScript, `@xyflow/react`, Vitest, Testing Library, Vite, Tauri

---

### Task 0: Scaffold OpenSpec Change For The Interaction Redesign

**Files:**
- Create: `openspec/changes/update-pipeline-graph-canvas-interactions/proposal.md`
- Create: `openspec/changes/update-pipeline-graph-canvas-interactions/tasks.md`
- Create: `openspec/changes/update-pipeline-graph-canvas-interactions/design.md`
- Create: `openspec/changes/update-pipeline-graph-canvas-interactions/specs/<capability>/spec.md` as needed after capability review

**Step 1: Inspect current OpenSpec context**

Run:

```powershell
openspec list
openspec list --specs
```

Expected: current active changes and specs are listed so the new change id does not conflict.

**Step 2: Write proposal, tasks, and design deltas**

Create an OpenSpec change with:

- Why: current canvas interactions are unreliable and block authoring
- What changes:
  - stage and node left-click selection
  - stage/node right-click menus
  - create-node dialog with strict validation
  - stage-internal grid layout and reflow
  - stage drag-sort only

**Step 3: Validate the OpenSpec change**

Run:

```powershell
openspec validate update-pipeline-graph-canvas-interactions --strict
```

Expected: PASS

**Step 4: Commit the OpenSpec proposal**

```powershell
git add -- "openspec/changes/update-pipeline-graph-canvas-interactions"
git commit -m "docs: propose pipeline graph canvas interaction redesign"
```

### Task 1: Lock Down Grid Layout And Stage Sizing In The Graph Model

**Files:**
- Modify: `src/components/pipeline-graph/graph-model.ts`
- Modify: `src/components/pipeline-graph/__tests__/graph-model.test.ts`

**Step 1: Write the failing layout tests**

Add tests for:

- stage container width/height expanding with more node slots
- node positions filling a 2D grid instead of only a vertical stack
- reflow returning non-overlapping coordinates with fixed gaps
- stage order changes recalculating stage positions

Example test skeleton:

```ts
it("lays out nodes in a two-dimensional grid with connection gaps", () => {
  const positions = layoutStageNodes([
    createNodeDraft({ stageKey: "stage-1", position: { x: 0, y: 0 } }),
    createNodeDraft({ stageKey: "stage-1", position: { x: 0, y: 0 } }),
    createNodeDraft({ stageKey: "stage-1", position: { x: 0, y: 0 } }),
  ]);

  expect(new Set(positions.map((item) => `${item.x}:${item.y}`)).size).toBe(3);
  expect(positions[1]?.x).toBeGreaterThan(positions[0]?.x ?? 0);
});
```

**Step 2: Run the focused graph-model tests and verify they fail**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/graph-model.test.ts
```

Expected: FAIL on missing 2D layout/reflow helpers.

**Step 3: Implement minimal graph-model helpers**

Add focused helpers such as:

```ts
type StageGridLayout = {
  nodePositions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
};

function buildStageGridLayout(nodes: NodeDraft[]): StageGridLayout {
  // compute columns, rows, slot positions, and container size
}

function reorderStageNodesForDrop(
  nodes: NodeDraft[],
  draggedNodeKey: string,
  targetSlot: { col: number; row: number }
): NodeDraft[] {
  // return stage-local reflow result without overlap
}
```

Also update `buildStageNode`, `buildActionNode`, and `syncDraftFromGraphState` to use the new stage sizing and slot-based positions.

**Step 4: Re-run the graph-model tests**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/graph-model.test.ts
```

Expected: PASS

**Step 5: Commit**

```powershell
git add -- "src/components/pipeline-graph/graph-model.ts" "src/components/pipeline-graph/__tests__/graph-model.test.ts"
git commit -m "feat: add stage grid layout model for pipeline canvas"
```

### Task 2: Add Stage And Node Context Menus Plus Stable Selection State

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/StageGroupNode.tsx`
- Modify: `src/components/pipeline-graph/PipelineActionNode.tsx`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`

**Step 1: Write failing interaction tests**

Cover:

- left-click stage selects stage and opens stage editing state
- left-click node selects node and opens node editing state
- right-click stage opens menu with add/delete actions
- right-click node opens menu with delete action

Example:

```tsx
it("opens the stage context menu on right click", async () => {
  render(<EditorHarness />);

  fireEvent.contextMenu(screen.getByTestId("graph-node-stage-1"));

  expect(await screen.findByRole("menuitem", { name: "添加节点" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "删除阶段" })).toBeInTheDocument();
});
```

**Step 2: Run the focused editor tests and verify failure**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx
```

Expected: FAIL on missing context menu state and menu rendering.

**Step 3: Implement minimal context-menu state**

In `PipelineGraphEditor.tsx`, add local state shaped like:

```ts
type ContextMenuState =
  | { kind: "stage"; stageKey: string; x: number; y: number }
  | { kind: "node"; nodeKey: string; x: number; y: number }
  | null;
```

Wire `onContextMenu` from `StageGroupNode` and `PipelineActionNode` back to the editor.  
Keep left-click selection independent from right-click menu opening.

**Step 4: Re-run the focused editor tests**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx
```

Expected: PASS for the new selection/menu cases.

**Step 5: Commit**

```powershell
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/StageGroupNode.tsx" "src/components/pipeline-graph/PipelineActionNode.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx"
git commit -m "feat: add stage and node context menus to pipeline canvas"
```

### Task 3: Add The Create-Node Dialog With Strict Validation

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/PipelineGraphSelectionPanel.tsx` if field reuse is needed
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`
- Test: `src/components/pipeline-editor/__tests__/editor-validation.test.ts`

**Step 1: Write failing dialog tests**

Cover:

- right-click stage -> add node opens dialog
- dialog requires type selection and required fields
- invalid form cannot create node
- valid form creates node, selects node, and opens node property panel

Example:

```tsx
it("requires required node fields before creation", async () => {
  render(<EditorHarness />);

  fireEvent.contextMenu(screen.getByTestId("graph-node-stage-1"));
  fireEvent.click(await screen.findByRole("menuitem", { name: "添加节点" }));
  fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

  expect(screen.getByText(/必填/)).toBeInTheDocument();
  expect(parseDraft().nodes).toHaveLength(0);
});
```

**Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-editor/__tests__/editor-validation.test.ts
```

Expected: FAIL due to missing dialog workflow and strict create-time validation.

**Step 3: Implement the minimal dialog**

Add dialog-local draft state like:

```ts
type CreateNodeDialogState = {
  stageKey: string;
  nodeType: string;
  parameters: Record<string, unknown>;
  errors: string[];
} | null;
```

Use built-in node metadata to render type-specific required fields.  
Only create the `NodeDraft` after validation passes.

**Step 4: Re-run focused tests**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-editor/__tests__/editor-validation.test.ts
```

Expected: PASS

**Step 5: Commit**

```powershell
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/PipelineGraphSelectionPanel.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx" "src/components/pipeline-editor/__tests__/editor-validation.test.ts"
git commit -m "feat: add strict create-node dialog for pipeline canvas"
```

### Task 4: Support Stage Drag-Sort And Intra-Stage Node Reflow

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/graph-model.ts`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`
- Modify: `src/components/pipeline-graph/__tests__/graph-model.test.ts`

**Step 1: Write failing drag/reflow tests**

Cover:

- dragging a stage changes stage order but keeps stages aligned
- dragging a node inside the stage triggers stage-local reflow
- dropping on an occupied slot results in non-overlapping positions

**Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-graph/__tests__/graph-model.test.ts
```

Expected: FAIL on missing drag-sort and reflow behavior.

**Step 3: Implement the minimal drag strategy**

- Make stage nodes draggable for sort only
- Normalize dropped stage positions back into ordered horizontal lanes
- For action nodes, map drop positions to stage-local slots and call the stage reflow helper
- Do not allow cross-stage moves in v1

**Step 4: Re-run the focused drag tests**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-graph/__tests__/graph-model.test.ts
```

Expected: PASS

**Step 5: Commit**

```powershell
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/graph-model.ts" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx" "src/components/pipeline-graph/__tests__/graph-model.test.ts"
git commit -m "feat: support pipeline stage sorting and node reflow"
```

### Task 5: Align Selection Panel And Canvas Summary States

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphSelectionPanel.tsx`
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`

**Step 1: Write failing tests for selection transitions**

Cover:

- left-click stage -> stage panel
- left-click node -> node panel
- delete selected stage/node -> fallback selection is stable
- blank-canvas click -> panel resets to empty state

**Step 2: Run the focused editor tests and verify failure**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx
```

Expected: FAIL on missing fallback/empty-state behavior.

**Step 3: Implement minimal selection-state cleanup**

- Normalize `selectedObject`
- Keep `activeStageKey` even when explicit selection clears
- Ensure the selection panel only consumes stage or node data from `PipelineDraft`

**Step 4: Re-run focused tests**

Run:

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx
```

Expected: PASS

**Step 5: Commit**

```powershell
git add -- "src/components/pipeline-graph/PipelineGraphSelectionPanel.tsx" "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx"
git commit -m "fix: stabilize pipeline canvas selection and inspector sync"
```

### Task 6: Cover The End-To-End Authoring Flow At The Page Level

**Files:**
- Modify: `src/pages/WorkflowsPagePipeline.tsx`
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Write failing smoke coverage**

Add a page-level flow that:

- opens create mode
- right-clicks a stage
- creates a node through the dialog
- edits stage/node properties
- saves successfully

**Step 2: Run the smoke suite for the affected flow and verify failure**

Run:

```powershell
pnpm test -- --reporter=basic src/__tests__/smoke.test.tsx
```

Expected: FAIL because the new canvas workflow is not yet represented.

**Step 3: Implement minimal page integration fixes**

- Pass any required managed-project and dialog props through the page/editor boundary
- Ensure save/readiness behavior still blocks incomplete definitions
- Preserve existing run-launch flows

**Step 4: Re-run the smoke suite**

Run:

```powershell
pnpm test -- --reporter=basic src/__tests__/smoke.test.tsx
```

Expected: PASS

**Step 5: Commit**

```powershell
git add -- "src/pages/WorkflowsPagePipeline.tsx" "src/__tests__/smoke.test.tsx"
git commit -m "test: cover pipeline canvas authoring workflow"
```

### Task 7: Final Verification

**Files:**
- Verify only

**Step 1: Run the focused frontend suites**

```powershell
pnpm test -- --reporter=basic src/components/pipeline-graph/__tests__/graph-model.test.ts src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-editor/__tests__/editor-validation.test.ts src/__tests__/smoke.test.tsx
```

Expected: PASS

**Step 2: Run the full frontend suite**

```powershell
pnpm test
```

Expected: PASS

**Step 3: Run Rust regression coverage**

```powershell
cargo test
```

Expected: PASS

**Step 4: Run production build verification**

```powershell
pnpm build
```

Expected: PASS

**Step 5: Commit final cleanups if needed**

```powershell
git status --short
```

Expected: no unexpected uncommitted files.

