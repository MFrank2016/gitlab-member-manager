# Pipeline Graph Editor Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复流程图编辑页的 6 个核心可用性问题，让新建流水线可以从默认阶段起步，稳定完成节点添加、选中、拖拽、缩放、摘要展示和保存前校验。

**Architecture:** 保持 `PipelineDraft` 作为唯一事实来源，先修正默认草稿与选择规则，再恢复 React Flow 基础交互，最后收敛画布布局和页面级保存路径。所有改动都限制在前端草稿模型、图编辑器、页面壳层和测试，不改后端 payload 与运行时语义。

**Tech Stack:** React 18, TypeScript, Vite, Vitest, `@xyflow/react`, shadcn/ui

---

## Preflight

- 在独立 git worktree 中执行本计划，不要直接在共享工作区边改边试。
- 保持后端命令、数据库结构和 payload 形状不变；如需调整，必须先用失败测试证明当前前端约束不成立。
- 每个任务完成后都做一次小提交，避免把默认草稿、画布交互和布局视觉混在同一个 commit 里。

### Task 1: 对齐默认草稿与持久化回填规则

**Files:**
- Modify: `src/components/pipeline-editor/draft-model.ts`
- Modify: `src/components/pipeline-editor/__tests__/draft-model.test.ts`
- Test: `src/components/pipeline-editor/__tests__/editor-validation.test.ts`

**Step 1: 写出失败测试，锁定新的默认草稿约束**

在 `src/components/pipeline-editor/__tests__/draft-model.test.ts` 增加或改写以下断言：

```ts
it("creates a default draft with one stage and no nodes", () => {
  const draft = createEmptyPipelineDraft();

  expect(draft.stages).toHaveLength(1);
  expect(draft.nodes).toEqual([]);
  expect(draft.edges).toEqual([]);
  expect(draft.variableRows).toEqual([]);
});

it("does not inject a fake node when hydrating a definition with no nodes", () => {
  const draft = toDraftFromDetail({
    id: 9,
    name: "empty-release",
    description: "",
    enabled: true,
    maxConcurrencyDefault: 2,
    createdAt: "2026-04-30T00:00:00Z",
    updatedAt: "2026-04-30T00:00:00Z",
    variables: [],
    stages: [{ stageKey: "default_stage", name: "阶段 1", stageOrder: 0, enabled: true }],
    nodes: [],
    edges: [],
    schedules: [],
  });

  expect(draft.stages).toHaveLength(1);
  expect(draft.nodes).toEqual([]);
});
```

**Step 2: 运行测试，确认它们先失败**

Run:

```bash
pnpm test -- src/components/pipeline-editor/__tests__/draft-model.test.ts
```

Expected: FAIL，因为当前默认草稿仍会创建 `checkout_branch` 节点，`toDraftFromDetail()` 在无节点时也会自动补节点。

**Step 3: 写最小实现，移除默认伪节点**

在 `src/components/pipeline-editor/draft-model.ts` 做最小修正：

```ts
export function createEmptyPipelineDraft(): PipelineDraft {
  const stage = buildDefaultStage();

  return {
    name: "",
    description: "",
    enabled: true,
    maxConcurrencyDefault: "2",
    variableRows: [],
    stages: [stage],
    nodes: [],
    edges: [],
    schedules: [],
  };
}
```

同时删除 `toDraftFromDetail()` 中“无节点时自动补一个默认节点”的分支，改为忠实保留空节点状态。

**Step 4: 重新运行相关测试**

Run:

```bash
pnpm test -- src/components/pipeline-editor/__tests__/draft-model.test.ts src/components/pipeline-editor/__tests__/editor-validation.test.ts
```

Expected:

- `draft-model.test.ts` PASS
- `editor-validation.test.ts` 继续 PASS，且“阶段无节点”只在显式校验时才阻塞保存

**Step 5: 提交**

```bash
git add -- "src/components/pipeline-editor/draft-model.ts" "src/components/pipeline-editor/__tests__/draft-model.test.ts"
git commit -m "fix: align pipeline draft defaults with graph editor flow"
```

### Task 2: 修复画布初始选中与添加节点主路径

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`

**Step 1: 写失败测试，覆盖默认阶段自动选中和新增节点选中**

在 `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx` 增加以下用例：

```tsx
it("auto-selects the first stage when the draft starts with no nodes", () => {
  render(<EditorHarness initialDraft={createEmptyPipelineDraft()} />);

  expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent("已选中阶段");
  expect(screen.getByRole("button", { name: "在所选阶段添加节点" })).toBeEnabled();
});

it("selects the newly added node and opens node editing", async () => {
  render(<EditorHarness initialDraft={createEmptyPipelineDraft()} />);

  fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));

  await waitFor(() => {
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent("已选中节点");
  });
});

it("falls back to the owning stage after deleting the selected node", async () => {
  render(<EditorHarness initialDraft={createEmptyPipelineDraft()} />);

  fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));
  await screen.findByLabelText("节点类型");
  fireEvent.click(screen.getByRole("button", { name: "删除选中对象" }));

  await waitFor(() => {
    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent("已选中阶段");
  });
});
```

**Step 2: 运行测试，确认现状不满足**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx -t "auto-selects the first stage when the draft starts with no nodes|selects the newly added node and opens node editing|falls back to the owning stage after deleting the selected node"
```

Expected: FAIL，因为当前组件默认优先假设有节点，删除后也会直接清空选中。

**Step 3: 写最小实现，稳定默认选中与回退选中**

在 `src/components/pipeline-graph/PipelineGraphEditor.tsx` 中：

- 把初始 `selectedId` 保持为“首节点优先，否则首阶段”
- 当当前选中对象被删除时，优先回退到对应阶段
- 在无选中但存在阶段时，允许“在所选阶段添加节点”沿用默认阶段

最小实现形态应接近：

```tsx
const [selectedId, setSelectedId] = React.useState<string | null>(
  () => draft.nodes[0]?.nodeKey ?? draft.stages[0]?.stageKey ?? null
);

React.useEffect(() => {
  if (selectedId && graphNodeMap.has(selectedId)) return;
  setSelectedId(draft.nodes[0]?.nodeKey ?? draft.stages[0]?.stageKey ?? null);
}, [draft.nodes, draft.stages, graphNodeMap, selectedId]);
```

删除节点时，不要直接清空为 `null`，而是先推导出阶段回退目标。

**Step 4: 重新运行图编辑器测试**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx
```

Expected: PASS，且旧的“添加节点、切换属性面板、删除对象”测试仍然全部通过。

**Step 5: 提交**

```bash
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx"
git commit -m "fix: restore pipeline graph selection bootstrap"
```

### Task 3: 恢复画布导航能力并给新增节点提供安全落点

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/graph-model.ts`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`
- Modify: `src/components/pipeline-graph/__tests__/graph-model.test.ts`

**Step 1: 写失败测试，锁定导航透传与落点规则**

在测试里增加两个断言方向：

```tsx
it("passes pan and zoom controls through to React Flow", () => {
  render(<EditorHarness initialDraft={createEmptyPipelineDraft()} />);

  expect(screen.getByTestId("mock-react-flow-pan-on-drag")).toHaveTextContent("true");
  expect(screen.getByTestId("mock-react-flow-zoom-on-scroll")).toHaveTextContent("true");
});
```

```ts
it("computes a safe visible position for the next node inside a stage", () => {
  expect(getNextNodePositionInStage([])).toEqual({ x: 96, y: 72 });
  expect(getNextNodePositionInStage([{ position: { x: 96, y: 72 } } as NodeDraft])).toEqual({
    x: 96,
    y: 188,
  });
});
```

**Step 2: 运行测试，确认它们先失败**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-graph/__tests__/graph-model.test.ts
```

Expected: FAIL，因为当前 mock 没有观测 `zoomOnScroll` / `panOnDrag`，也没有显式的安全落点辅助函数。

**Step 3: 写最小实现，补齐样式与导航**

先在 `src/main.tsx` 增加官方样式入口：

```ts
import "@xyflow/react/dist/style.css";
import "@/styles/globals.css";
```

然后在 `graph-model.ts` 中提取安全落点函数，例如：

```ts
export function getNextNodePositionInStage(nodesInStage: NodeDraft[]) {
  return {
    x: 96,
    y: 72 + nodesInStage.length * 116,
  };
}
```

在 `PipelineGraphEditor.tsx` 中复用它，并保持：

- `panOnDrag`
- `zoomOnScroll`
- `fitView`
- `MiniMap`
- `Controls`

新增节点后，必要时调用一次轻量视口修正，保证新节点完整可见。

**Step 4: 重新运行目标测试**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/components/pipeline-graph/__tests__/graph-model.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add -- "src/main.tsx" "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/graph-model.ts" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx" "src/components/pipeline-graph/__tests__/graph-model.test.ts"
git commit -m "fix: restore pipeline graph navigation and node placement"
```

### Task 4: 调整三栏布局并将节点卡片收敛为摘要视图

**Files:**
- Modify: `src/components/pipeline-graph/PipelineGraphEditor.tsx`
- Modify: `src/components/pipeline-graph/StageGroupNode.tsx`
- Modify: `src/components/pipeline-graph/PipelineActionNode.tsx`
- Modify: `src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx`

**Step 1: 写失败测试，锁定布局和摘要展示约束**

增加以下断言：

```tsx
it("renders full-width action buttons in the left operation panel", () => {
  render(<EditorHarness initialDraft={createEmptyPipelineDraft()} />);

  expect(screen.getByRole("button", { name: "添加阶段" })).toHaveClass("w-full");
  expect(screen.getByRole("button", { name: "在所选阶段添加节点" })).toHaveClass("w-full");
});

it("shows only summary information on action nodes", async () => {
  render(<EditorHarness initialDraft={createEmptyPipelineDraft()} />);
  fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));

  await waitFor(() => {
    expect(screen.getByText("切换分支")).toBeInTheDocument();
    expect(screen.queryByText("分支")).not.toBeInTheDocument();
  });
});
```

**Step 2: 运行测试，确认当前类名和展示方式不匹配**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx -t "renders full-width action buttons in the left operation panel|shows only summary information on action nodes"
```

Expected: FAIL，因为当前按钮没有整列铺满约束，节点摘要展示也没有明确被测试锁定。

**Step 3: 写最小实现，收敛成摘要节点**

在 `PipelineGraphEditor.tsx` 调整三栏布局和按钮样式：

```tsx
<div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
  <aside className="grid gap-3 ...">
    <Button className="w-full whitespace-normal text-left" ...>
      在所选阶段添加节点
    </Button>
  </aside>
</div>
```

在 `PipelineActionNode.tsx` 中只保留：

- 节点标签
- 节点类型
- 阶段标识
- 启用状态

不要在节点卡片上直接展示详细字段表单或长参数内容。

同时适度放大 `StageGroupNode.tsx` 和 `PipelineActionNode.tsx` 的尺寸基线，保证节点完整可见。

**Step 4: 重新运行组件测试**

Run:

```bash
pnpm test -- src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx
```

Expected: PASS，且视觉结构相关断言全部通过。

**Step 5: 提交**

```bash
git add -- "src/components/pipeline-graph/PipelineGraphEditor.tsx" "src/components/pipeline-graph/StageGroupNode.tsx" "src/components/pipeline-graph/PipelineActionNode.tsx" "src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx"
git commit -m "fix: improve pipeline graph layout and node summaries"
```

### Task 5: 打通页面级创建路径并完成最终验证

**Files:**
- Modify: `src/pages/WorkflowsPagePipeline.tsx`
- Modify: `src/__tests__/smoke.test.tsx`
- Test: `src/components/pipeline-editor/__tests__/editor-validation.test.ts`

**Step 1: 写失败测试，锁定新建页主路径**

在 `src/__tests__/smoke.test.tsx` 里新增或改写以下用例：

```tsx
it("opens create mode with one selected stage and no default nodes", async () => {
  render(<WorkflowsPagePipeline />);

  fireEvent.click(await screen.findByRole("button", { name: "新建流水线" }));

  expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent("已选中阶段");
  expect(screen.getAllByTestId(/graph-node-stage-/)).toHaveLength(1);
  expect(screen.queryAllByTestId(/graph-node-.*node-/)).toHaveLength(0);
  expect(screen.getByRole("button", { name: "在所选阶段添加节点" })).toBeEnabled();
});

it("allows the create flow to continue from the default stage", async () => {
  render(<WorkflowsPagePipeline />);

  fireEvent.click(await screen.findByRole("button", { name: "新建流水线" }));
  fireEvent.change(screen.getByLabelText("流水线名称"), {
    target: { value: "release-pipeline" },
  });
  fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));

  await waitFor(() => {
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
  });
});
```

**Step 2: 运行测试，确认页面级行为先失败**

Run:

```bash
pnpm test -- src/__tests__/smoke.test.tsx -t "opens create mode with one selected stage and no default nodes|allows the create flow to continue from the default stage"
```

Expected: FAIL，因为当前页面测试和实现仍以“默认已有节点”为前提。

**Step 3: 写最小实现，打通页面级默认路径**

在 `src/pages/WorkflowsPagePipeline.tsx` 中：

- 新建时继续使用 `createEmptyPipelineDraft()`，但接受“1 阶段 0 节点”的新默认
- 不再假设 create mode 一进来就有默认节点
- 保持保存前 `getPipelineDraftReadiness()` 的拦截逻辑
- 保持校验摘要与中文错误提示

必要时更新“创建成功”和“校验失败”提示文案，但不要改后端命令签名。

**Step 4: 运行最终验证**

Run:

```bash
pnpm test -- src/components/pipeline-editor/__tests__/draft-model.test.ts src/components/pipeline-editor/__tests__/editor-validation.test.ts src/components/pipeline-graph/__tests__/graph-model.test.ts src/components/pipeline-graph/__tests__/PipelineGraphEditor.test.tsx src/__tests__/smoke.test.tsx
pnpm build
```

Expected:

- 目标 Vitest 套件全部 PASS
- `pnpm build` PASS
- 手工验证中，画布拖拽、缩放、点击选中、新增节点完整可见均正常

**Step 5: 提交**

```bash
git add -- "src/pages/WorkflowsPagePipeline.tsx" "src/__tests__/smoke.test.tsx"
git commit -m "fix: unblock pipeline graph create flow"
```

## Final verification checklist

- [ ] 新建流程图时默认只有 1 个阶段、0 个节点
- [ ] 新建页打开后默认阶段自动选中
- [ ] “在所选阶段添加节点”进入页面即可直接点击
- [ ] 左侧长按钮不再溢出边框
- [ ] 空白画布可拖拽
- [ ] 滚轮可缩放
- [ ] 阶段和节点均可点击选中
- [ ] 新增节点默认完整可见
- [ ] 画布节点只展示名称和简要信息
- [ ] 保存前校验继续生效，且错误提示保持中文
