# Pipeline Graph Editor Usability Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild pipeline definition editing into a full-screen, usable graph editor inside the `workflows` tab without changing backend APIs or runtime semantics.

**Architecture:** Introduce a dedicated full-screen editor shell driven by `WorkflowsPagePipeline` view state, keep `PipelineDraft` as the single source of truth, and enhance the existing `@xyflow/react` editor with complete navigation, selection, and validation affordances. Reuse the current basics / variables / schedules sections by exporting them into a tabbed shell, and move selected-object editing plus validation feedback into explicit editor-side components.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, `@xyflow/react`, Radix Tabs, existing `shadcn/ui` wrappers

---

## Preflight

- Execute this plan in a dedicated git worktree before touching implementation code.
- Keep backend commands, payload shapes, and persistence models unchanged unless a failing test proves the current frontend payload is insufficient.
- Prefer small commits after each task.

### Task 1: Extract a full-screen editor shell and reusable form sections

**Files:**
- Create: `src/components/pipeline-editor/PipelineDefinitionEditorShell.tsx`
- Create: `src/components/pipeline-editor/__tests__/PipelineDefinitionEditorShell.test.tsx`
- Modify: `src/components/pipeline-editor/PipelineDraftForm.tsx`
- Modify: `src/components/ui/tabs.tsx` (only if test findings require minor styling hooks or attributes)

**Step 1: Write the failing shell test**

```tsx
it("defaults to the canvas tab and switches between global configuration tabs", () => {
  render(
    <PipelineDefinitionEditorShell
      mode="create"
      draft={createEmptyPipelineDraft()}
      managedProjects={[]}
      projectGroups={[]}
      dirty={false}
      saving={false}
      validating={false}
      onChange={vi.fn()}
      onBack={vi.fn()}
      onSave={vi.fn()}
      onValidate={vi.fn()}
    />
  );

  expect(screen.getByRole("tab", { name: "画布" })).toHaveAttribute("data-state", "active");
  fireEvent.click(screen.getByRole("tab", { name: "变量" }));
  expect(screen.getByText("添加变量")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/components/pipeline-editor/__tests__/PipelineDefinitionEditorShell.test.tsx
```

Expected: FAIL because `PipelineDefinitionEditorShell` does not exist and `PipelineDraftForm` does not expose reusable sections.

**Step 3: Write the minimal shell implementation**

```tsx
export function PipelineDefinitionEditorShell(props: PipelineDefinitionEditorShellProps) {
  const [activeTab, setActiveTab] = React.useState<EditorTab>("canvas");

  return (
    <section className="flex h-full flex-col">
      <header>{/* 返回、标题、保存/校验工具栏 */}</header>
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorTab)}>
        <TabsList>
          <TabsTrigger value="canvas">画布</TabsTrigger>
          <TabsTrigger value="variables">变量</TabsTrigger>
          <TabsTrigger value="schedules">调度</TabsTrigger>
          <TabsTrigger value="basics">基础信息</TabsTrigger>
        </TabsList>
        <TabsContent value="canvas">{props.canvas}</TabsContent>
        <TabsContent value="variables">{props.variables}</TabsContent>
        <TabsContent value="schedules">{props.schedules}</TabsContent>
        <TabsContent value="basics">{props.basics}</TabsContent>
      </Tabs>
    </section>
  );
}
```

At the same time, refactor `PipelineDraftForm.tsx` so the current `PipelineBasicsSection`, `PipelineVariablesSection`, and `PipelineSchedulesSection` become exported reusable sections instead of being trapped inside one monolithic wrapper.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/components/pipeline-editor/__tests__/PipelineDefinitionEditorShell.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add -- "src/components/pipeline-editor/PipelineDefinitionEditorShell.tsx" "src/components/pipeline-editor/__tests__/PipelineDefinitionEditorShell.test.tsx" "src/components/pipeline-editor/PipelineDraftForm.tsx" "src/components/ui/tabs.tsx"
git commit -m "feat: add pipeline editor shell"
```

### Task 2: Replace create/edit dialogs with `WorkflowsPagePipeline` full-screen editor state

**Files:**
- Modify: `src/pages/WorkflowsPagePipeline.tsx`
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Write the failing integration test**

Add a focused smoke test that verifies clicking `新建流水线` renders the full-screen editor shell instead of the create dialog content.

```tsx
it("opens the full-screen pipeline editor instead of the create dialog", async () => {
  render(<WorkflowsPagePipeline />);

  fireEvent.click(await screen.findByRole("button", { name: "新建流水线" }));

  expect(screen.getByRole("button", { name: "返回列表" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "画布" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/__tests__/smoke.test.tsx -t "opens the full-screen pipeline editor instead of the create dialog"
```

Expected: FAIL because the page still opens a `Dialog`.

**Step 3: Write the minimal page-state refactor**

```tsx
type DefinitionEditorMode = "idle" | "creating" | "editing";

const [editorMode, setEditorMode] = React.useState<DefinitionEditorMode>("idle");

if (editorMode !== "idle") {
  return (
    <PipelineDefinitionEditorShell
      mode={editorMode === "creating" ? "create" : "edit"}
      draft={activeDraft}
      onBack={handleEditorBack}
      onSave={handleEditorSave}
      onValidate={handleValidate}
      ...
    />
  );
}
```

Keep the run dialog path intact. Remove only the create/edit dialog wrappers and move their loading / save state into the editor mode.

**Step 4: Run the integration slice**

Run:

```bash
pnpm test -- src/__tests__/smoke.test.tsx -t "opens the full-screen pipeline editor instead of the create dialog"
```

Expected: PASS

**Step 5: Commit**

```bash
git add -- "src/pages/WorkflowsPagePipeline.tsx" "src/__tests__/smoke.test.tsx"
git commit -m "feat: switch pipeline definition editing to full screen"
```

### Task 3: Upgrade `PipelineGraphEditor` navigation, selection, and canvas controls

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/graph-model.ts`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`

**Step 1: Write the failing graph-editor tests**

Extend the current mock-based graph-editor test suite to cover:

- `MiniMap` and `Controls` render
- editor exposes a “适配全貌” action
- delete action removes the selected node
- the editor tracks selected stage vs selected node

```tsx
it("shows minimap and canvas controls for navigation", () => {
  render(<EditorHarness />);
  expect(screen.getByTestId("mock-react-flow-controls")).toBeInTheDocument();
  expect(screen.getByTestId("mock-react-flow-minimap")).toBeInTheDocument();
});

it("deletes the selected node from the draft", async () => {
  render(<EditorHarness />);
  fireEvent.click(screen.getByRole("button", { name: "删除选中对象" }));
  await waitFor(() => expect(parseDraft().nodes).toHaveLength(0));
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx
```

Expected: FAIL because the editor does not expose `MiniMap`, fit-view action, or selected-object deletion.

**Step 3: Implement the minimal graph interaction upgrades**

```tsx
<ReactFlow
  nodes={graphState.nodes}
  edges={graphState.edges}
  nodeTypes={nodeTypes}
  onNodesChange={handleNodesChange}
  onSelectionChange={handleSelectionChange}
  panOnDrag
  zoomOnScroll
  selectionOnDrag
  fitView
>
  <Background />
  <MiniMap />
  <Controls />
</ReactFlow>
```

Add explicit editor actions:

- `适配全貌`
- `删除选中对象`
- selected-object summary in local editor state

Keep `draft` as the single source of truth: every node deletion, position move, and selection-derived mutation must flow through `onChange`.

**Step 4: Run graph tests again**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/graph-model.ts" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx"
git commit -m "feat: improve pipeline graph navigation and selection"
```

### Task 4: Extract selected-object editing and improve stage/node readability

**Files:**
- Create: `src/components/pipeline-graph/PipelineGraphSelectionPanel.tsx`
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/StageGroupNode.tsx`
- Modify: `src/components/pipeline-graph/PipelineActionNode.tsx`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`

**Step 1: Write the failing selection-panel test**

Add a test proving stage selection shows stage attributes while node selection shows node attributes.

```tsx
it("switches the inspector between stage and node attributes", async () => {
  render(<EditorHarness />);

  fireEvent.click(within(screen.getByTestId("graph-node-stage-1")).getByRole("button"));
  expect(screen.getByLabelText("阶段名称")).toBeInTheDocument();

  fireEvent.click(within(screen.getByTestId("graph-node-checkout_branch_node-1")).getByRole("button"));
  expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx -t "switches the inspector between stage and node attributes"
```

Expected: FAIL because the inspector is still entangled inside `PipelineGraphEditor` and does not have stable labels.

**Step 3: Write the minimal extraction**

```tsx
export function PipelineGraphSelectionPanel(props: PipelineGraphSelectionPanelProps) {
  if (props.selection?.kind === "stage") {
    return <StageInspector ... />;
  }
  if (props.selection?.kind === "node") {
    return <NodeInspector ... />;
  }
  return <EmptyInspectorHint />;
}
```

At the same time, update `StageGroupNode.tsx` and `PipelineActionNode.tsx` so selection, disabled state, and structural labels are visually obvious.

**Step 4: Re-run the focused test**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx -t "switches the inspector between stage and node attributes"
```

Expected: PASS

**Step 5: Commit**

```bash
git add -- "src/components/pipeline-graph/PipelineGraphSelectionPanel.tsx" "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/StageGroupNode.tsx" "src/components/pipeline-graph/PipelineActionNode.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx"
git commit -m "feat: extract pipeline graph selection panel"
```

### Task 5: Add editor validation summary and unsaved-change protection

**Files:**
- Create: `src/components/pipeline-editor/editor-validation.ts`
- Create: `src/components/pipeline-editor/__tests__/editor-validation.test.ts`
- Modify: `src/components/pipeline-editor/PipelineDefinitionEditorShell.tsx`
- Modify: `src/pages/WorkflowsPagePipeline.tsx`
- Modify: `src/__tests__/smoke.test.tsx`

**Step 1: Write failing validation tests**

Create validation tests for the minimum blocking cases:

- empty pipeline name
- no stages
- stage with no nodes
- node missing type
- duplicate / cyclic / backward edges

```ts
it("reports a stage without executable nodes", () => {
  const draft = createEmptyPipelineDraft();
  draft.stages = [createStageDraft({ stageKey: "stage-1", name: "准备" })];
  draft.nodes = [];

  expect(validatePipelineEditorDraft(draft)).toEqual(
    expect.objectContaining({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "stage_has_no_nodes", path: "stage:stage-1" }),
      ]),
    })
  );
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
pnpm test -- src/components/pipeline-editor/__tests__/editor-validation.test.ts
```

Expected: FAIL because the validation helper does not exist.

**Step 3: Implement validation helper and unsaved guard**

```ts
export function validatePipelineEditorDraft(draft: PipelineDraft): ValidationSummary {
  const issues: ValidationIssue[] = [];
  if (!draft.name.trim()) issues.push(...);
  if (draft.stages.length === 0) issues.push(...);
  return { ok: issues.length === 0, issues };
}
```

Wire the result into the shell:

- `校验` button shows a summary list
- `保存` shows blocking issues before calling the backend
- `返回列表` confirms when `dirty === true`

**Step 4: Run unit + smoke checks**

Run:

```bash
pnpm test -- src/components/pipeline-editor/__tests__/editor-validation.test.ts src/__tests__/smoke.test.tsx -t "warns before leaving the pipeline editor with unsaved changes"
```

Expected: PASS

**Step 5: Commit**

```bash
git add -- "src/components/pipeline-editor/editor-validation.ts" "src/components/pipeline-editor/__tests__/editor-validation.test.ts" "src/components/pipeline-editor/PipelineDefinitionEditorShell.tsx" "src/pages/WorkflowsPagePipeline.tsx" "src/__tests__/smoke.test.tsx"
git commit -m "feat: add pipeline editor validation feedback"
```

### Task 6: Finish integration coverage and run final verification

**Files:**
- Modify: `src/__tests__/smoke.test.tsx`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`
- Modify: `src/components/pipeline-editor/__tests__/PipelineDefinitionEditorShell.test.tsx`

**Step 1: Add the remaining failing integration expectations**

Cover the end-to-end editor flow:

- entering create mode
- entering edit mode with fetched detail
- switching tabs without losing draft state
- returning to list after canceling with no changes
- keeping run dialog behavior intact

```tsx
it("preserves draft edits across tab switches in full-screen editor mode", async () => {
  render(<WorkflowsPagePipeline />);
  fireEvent.click(await screen.findByRole("button", { name: "新建流水线" }));
  fireEvent.click(screen.getByRole("tab", { name: "基础信息" }));
  fireEvent.change(screen.getByLabelText("流水线名称"), { target: { value: "release-mainline" } });
  fireEvent.click(screen.getByRole("tab", { name: "变量" }));
  fireEvent.click(screen.getByRole("tab", { name: "基础信息" }));
  expect(screen.getByDisplayValue("release-mainline")).toBeInTheDocument();
});
```

**Step 2: Run the targeted suite and verify failures**

Run:

```bash
pnpm test -- src/__tests__/smoke.test.tsx src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-editor/__tests__/PipelineDefinitionEditorShell.test.tsx
```

Expected: FAIL until all missing integration edges are handled.

**Step 3: Implement the minimal missing integration fixes**

Typical fixes in this step should be small and integration-focused:

- stabilize `draft` ownership in `WorkflowsPagePipeline`
- keep `selectedId` / current tab from resetting incorrectly
- ensure editor back-navigation clears transient state

```tsx
function handleEditorBack() {
  if (dirty && !window.confirm("当前有未保存修改，离开后将丢失，是否继续？")) {
    return;
  }
  setEditorMode("idle");
  setEditorDraft(createEmptyPipelineDraft());
}
```

**Step 4: Run full frontend verification**

Run:

```bash
pnpm test -- src/components/pipeline-editor/__tests__/PipelineDefinitionEditorShell.test.tsx src/components/pipeline-editor/__tests__/editor-validation.test.ts src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/__tests__/smoke.test.tsx
pnpm build
```

Expected:

- All selected Vitest suites PASS
- `pnpm build` completes successfully with no TypeScript or bundling errors

**Step 5: Commit**

```bash
git add -- "src/__tests__/smoke.test.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx" "src/components/pipeline-editor/__tests__/PipelineDefinitionEditorShell.test.tsx"
git commit -m "test: cover full-screen pipeline editor flow"
```

## Final verification checklist

- [ ] `新建流水线` and `编辑` enter the full-screen editor state
- [ ] `立即运行` still uses the existing run dialog flow
- [ ] `画布 / 变量 / 调度 / 基础信息` tabs all render correctly
- [ ] canvas exposes `MiniMap`, controls, pan, zoom, and fit-view
- [ ] stage order remains stable and nodes stay within stage ownership
- [ ] unsaved changes trigger a Chinese confirmation before leaving
- [ ] validation problems surface as object-aware Chinese feedback before save
- [ ] `pnpm build` passes
