import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineGraphEditor } from "@/components/pipeline-graph/PipelineGraphEditor";
import { buildGraphEditorState } from "@/components/pipeline-graph/graph-model";
import {
  createEmptyPipelineDraft,
  createNodeDraft,
  createStageDraft,
  resetPipelineDraftCountersForTest,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";
import type { ManagedProject } from "@/lib/types";

const mockFitView = vi.fn();
type MockReactFlowNode = Record<string, unknown> & {
  id: string;
  data?: Record<string, unknown>;
  parentId?: string;
  position?: { x: number; y: number };
};

let lastReactFlowProps:
  | {
      panOnDrag?: boolean | number[];
      zoomOnScroll?: boolean;
      selectionOnDrag?: boolean;
      nodes: MockReactFlowNode[];
      onNodeDrag?: (event: unknown, node: MockReactFlowNode) => void;
      onNodeDragStop?: (event: unknown, node: MockReactFlowNode) => void;
      onNodeContextMenu?: (
        event: { preventDefault: () => void; clientX: number; clientY: number },
        node: MockReactFlowNode
      ) => void;
      onSelectionChange?: (params: {
        nodes: Array<Record<string, unknown>>;
        edges: Array<Record<string, unknown>>;
      }) => void;
      onPaneClick?: () => void;
    }
  | null = null;

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");

  return {
    Background: () => null,
    Controls: () => <div data-testid="mock-react-flow-controls" />,
    MiniMap: () => <div data-testid="mock-react-flow-minimap" />,
    Handle: ({
      type,
      position,
      className,
      style,
    }: {
      type?: string;
      position?: string;
      className?: string;
      style?: Record<string, unknown>;
    }) => (
      <div
        data-testid={`mock-handle-${type ?? "unknown"}-${position ?? "unknown"}`}
        className={className}
        data-style={JSON.stringify(style ?? {})}
      />
    ),
    Position: {
      Top: "top",
      Right: "right",
      Bottom: "bottom",
      Left: "left",
    },
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
    ReactFlow: ({
      nodes,
      edges,
      nodeTypes,
      onNodeClick,
      onNodeContextMenu,
      onNodeDrag,
      onNodeDragStop,
      onPaneClick,
      onSelectionChange,
      onInit,
      panOnDrag,
      zoomOnScroll,
      selectionOnDrag,
      children,
    }: {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
      nodeTypes?: Record<string, React.ComponentType<Record<string, unknown>>>;
      onNodeClick?: (event: unknown, node: Record<string, unknown>) => void;
      onNodeContextMenu?: (
        event: { preventDefault: () => void; clientX: number; clientY: number },
        node: MockReactFlowNode
      ) => void;
      onNodeDrag?: (event: unknown, node: MockReactFlowNode) => void;
      onNodeDragStop?: (event: unknown, node: MockReactFlowNode) => void;
      onPaneClick?: () => void;
      onSelectionChange?: (params: {
        nodes: Array<Record<string, unknown>>;
        edges: Array<Record<string, unknown>>;
      }) => void;
      onInit?: (instance: { fitView: () => void }) => void;
      panOnDrag?: boolean | number[];
      zoomOnScroll?: boolean;
      selectionOnDrag?: boolean;
      children?: React.ReactNode;
    }) => {
      lastReactFlowProps = {
        panOnDrag,
        zoomOnScroll,
        selectionOnDrag,
        nodes: nodes as MockReactFlowNode[],
        onNodeDrag,
        onNodeDragStop,
        onNodeContextMenu,
        onSelectionChange,
        onPaneClick,
      };
      const [selectedNodeId, setSelectedNodeId] = ReactModule.useState<string | null>(null);

      ReactModule.useEffect(() => {
        onInit?.({ fitView: mockFitView });
      }, [onInit]);

      return (
        <div data-testid="mock-react-flow">
          <div data-testid="mock-react-flow-edge-count">{edges.length}</div>
          <button
            type="button"
            data-testid="mock-react-flow-multiselect"
            onClick={() => {
              setSelectedNodeId(null);
              onSelectionChange?.({ nodes, edges: [] });
            }}
          >
            模拟多选
          </button>
          <button
            type="button"
            data-testid="mock-react-flow-pane-click"
            onClick={() => {
              setSelectedNodeId(null);
              onPaneClick?.();
            }}
          >
            mock pane click
          </button>
          {children}
          {nodes.map((node) => {
            const Component = node.type && nodeTypes ? nodeTypes[String(node.type)] : null;
            const data = (node.data ?? {}) as Record<string, unknown>;
            const label =
              typeof data.name === "string"
                ? data.name
                : typeof data.label === "string"
                  ? data.label
                  : String(node.id);

            return (
              <div
                key={String(node.id)}
                data-testid={`graph-node-${String(node.id)}`}
                onClick={() => {
                  setSelectedNodeId(String(node.id));
                  onNodeClick?.({}, node);
                  onSelectionChange?.({ nodes: [node], edges: [] });
                }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedNodeId(String(node.id));
                    onNodeClick?.({}, node);
                    onSelectionChange?.({ nodes: [node], edges: [] });
                  }}
                >
                  {label}
                </button>
                {Component ? (
                  <Component
                    id={String(node.id)}
                    data={data}
                    selected={selectedNodeId === String(node.id)}
                    dragging={false}
                    type={String(node.type ?? "")}
                    zIndex={0}
                    isConnectable
                    xPos={0}
                    yPos={0}
                    targetPosition="top"
                    sourcePosition="bottom"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      );
    },
  };
});

function parseDraft() {
  const raw = screen.getByTestId("pipeline-draft-json").textContent ?? "";
  return JSON.parse(raw) as PipelineDraft;
}

function clickGraphObject(id: string) {
  fireEvent.click(within(screen.getByTestId(`graph-node-${id}`)).getByRole("button"));
}

function clickCanvasPane() {
  fireEvent.click(screen.getByTestId("mock-react-flow-pane-click"));
}

function reportEmptySelectionChange() {
  act(() => {
    lastReactFlowProps?.onSelectionChange?.({ nodes: [], edges: [] });
  });
}

function dragGraphNode(
  id: string,
  position: { x: number; y: number },
  overrides: Partial<MockReactFlowNode> = {}
) {
  const node = lastReactFlowProps?.nodes.find((item) => String(item.id) === id);
  expect(node).toBeDefined();

  const nextNode: MockReactFlowNode = {
    ...(node as MockReactFlowNode),
    ...overrides,
    position,
    data: {
      ...((node?.data ?? {}) as Record<string, unknown>),
      ...((overrides.data ?? {}) as Record<string, unknown>),
    },
  };

  act(() => {
    lastReactFlowProps?.onNodeDragStop?.({}, nextNode);
  });
}

function previewDragGraphNode(
  id: string,
  position: { x: number; y: number },
  overrides: Partial<MockReactFlowNode> = {}
) {
  const node = lastReactFlowProps?.nodes.find((item) => String(item.id) === id);
  expect(node).toBeDefined();

  const nextNode: MockReactFlowNode = {
    ...(node as MockReactFlowNode),
    ...overrides,
    position,
    data: {
      ...((node?.data ?? {}) as Record<string, unknown>),
      ...((overrides.data ?? {}) as Record<string, unknown>),
    },
  };

  act(() => {
    lastReactFlowProps?.onNodeDrag?.({}, nextNode);
  });
}

function openStageContextMenu(stageKey: string, clientX = 160, clientY = 220) {
  fireEvent.contextMenu(screen.getByTestId(`pipeline-stage-node-card-${stageKey}`), {
    clientX,
    clientY,
  });
}

function openNodeContextMenu(nodeKey: string, clientX = 240, clientY = 260) {
  fireEvent.contextMenu(screen.getByTestId(`pipeline-action-node-card-${nodeKey}`), {
    clientX,
    clientY,
  });
}

function openContextMenuViaReactFlow(id: string, clientX = 180, clientY = 220) {
  const node = lastReactFlowProps?.nodes.find((item) => String(item.id) === id);
  expect(node).toBeDefined();

  act(() => {
    lastReactFlowProps?.onNodeContextMenu?.(
      {
        preventDefault: () => undefined,
        clientX,
        clientY,
      },
      node as MockReactFlowNode
    );
  });
}

async function openCreateNodeDialogFromStageStartAnchor(stageKey: string) {
  fireEvent.click(screen.getByTestId(`pipeline-stage-start-anchor-trigger-${stageKey}`));
  await screen.findByRole("button", { name: "创建节点" });
}

async function openCreateNodeDialogFromNodeOutput(nodeKey: string) {
  fireEvent.click(screen.getByTestId(`pipeline-node-output-anchor-${nodeKey}`));
  await screen.findByRole("button", { name: "创建节点" });
}

async function addNodeToStage(stageKey: string, expectedCount: number) {
  const stageNodes = parseDraft().nodes.filter((node) => node.stageKey === stageKey);
  if (stageNodes.length === 0) {
    await openCreateNodeDialogFromStageStartAnchor(stageKey);
  } else {
    await openCreateNodeDialogFromNodeOutput(stageNodes[stageNodes.length - 1]!.nodeKey);
  }
  fireEvent.change(screen.getByLabelText("节点类型"), {
    target: { value: "checkout_branch" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建节点" }));
  await waitFor(() => {
    expect(parseDraft().nodes).toHaveLength(expectedCount);
  });
  return parseDraft().nodes[expectedCount - 1]!;
}

const managedProjectsFixture: ManagedProject[] = [
  {
    id: 101,
    gitlabProjectId: 1001,
    name: "alpha-service",
    pathWithNamespace: "team/alpha-service",
    repoPath: "D:/repos/alpha-service",
    defaultBranch: "main",
    defaultRemote: "origin",
    enabled: true,
    createdAt: "2026-04-29T09:00:00Z",
    updatedAt: "2026-04-29T09:00:00Z",
  },
];

function EditorHarness({
  initialDraft,
  managedProjects = [],
}: {
  initialDraft?: PipelineDraft;
  managedProjects?: ManagedProject[];
}) {
  const [draft, setDraft] = React.useState(() => initialDraft ?? createEmptyPipelineDraft());
  const [visible, setVisible] = React.useState(true);

  return (
    <div className="grid gap-4">
      <button type="button" onClick={() => setVisible((current) => !current)}>
        重新挂载
      </button>
      <pre data-testid="pipeline-draft-json">{JSON.stringify(draft)}</pre>
      {visible ? (
        <PipelineGraphEditor
          draft={draft}
          managedProjects={managedProjects}
          onChange={setDraft}
        />
      ) : null}
    </div>
  );
}

describe("PipelineGraphEditor", () => {
  beforeEach(() => {
    mockFitView.mockReset();
    lastReactFlowProps = null;
    resetPipelineDraftCountersForTest();
  });

  it("adds a stage", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));

    await waitFor(() => {
      expect(screen.getByTestId("graph-node-stage-2")).toBeInTheDocument();
    });

    expect(parseDraft().stages).toHaveLength(2);
  });

  it("auto-selects the first stage when the draft starts with no nodes", () => {
    render(<EditorHarness />);

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中阶段"
    );
    expect(screen.getByTestId("pipeline-stage-start-anchor-trigger-stage-1")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-graph-add-node-button")).not.toBeInTheDocument();
  });

  it("uses a wider three-column layout and full-width action buttons", () => {
    render(<EditorHarness />);

    expect(screen.getByTestId("pipeline-graph-layout")).toHaveClass(
      "xl:grid-cols-[260px_minmax(0,1fr)_300px]"
    );

    for (const testId of [
      "pipeline-graph-add-stage-button",
      "pipeline-graph-fit-view-button",
      "pipeline-graph-delete-button",
    ]) {
      expect(screen.getByTestId(testId)).toHaveClass(
        "w-full",
        "justify-start",
        "whitespace-normal",
        "text-left"
      );
    }
  });

  it("keeps node creation and connection entrypoints on anchors only", () => {
    render(<EditorHarness />);

    expect(screen.queryByLabelText("连接到节点")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-graph-create-connection-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-graph-add-node-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-anchor-guidance")).toHaveTextContent(
      "通过阶段起始锚点创建首个节点"
    );
  });

  it("adds a node into the selected stage", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    clickGraphObject("stage-2");
    const nextNode = await addNodeToStage("stage-2", 1);

    expect(nextNode.stageKey).toBe("stage-2");
  });

  it("opens the create-node dialog from the clicked stage start anchor", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));

    await openCreateNodeDialogFromStageStartAnchor("stage-2");

    expect(screen.getByRole("heading", { name: "创建节点" })).toBeInTheDocument();
    expect(screen.getByText("在阶段“阶段 2”中创建一个新节点。")).toBeInTheDocument();
    expect(parseDraft().nodes).toHaveLength(0);
  });

  it("selects the newly added node and opens node editing", async () => {
    render(<EditorHarness />);

    await addNodeToStage("stage-1", 1);

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
  });

  it("renders start anchors and fixed-size action cards with type-plus-name node content", async () => {
    render(<EditorHarness />);

    expect(screen.getByTestId("pipeline-stage-node-card-stage-1")).toHaveClass(
      "overflow-visible",
      "p-3"
    );
    expect(screen.getByTestId("pipeline-stage-start-anchor-stage-1")).toBeInTheDocument();

    const nextNode = await addNodeToStage("stage-1", 1);
    const actionCard = screen.getByTestId(`pipeline-action-node-card-${nextNode.nodeKey}`);

    expect(actionCard).toHaveClass("w-[188px]", "h-[116px]", "p-3");
    expect(within(actionCard).getByText("checkout branch")).toBeInTheDocument();
    expect(within(actionCard).getByText("切换分支")).toBeInTheDocument();
    expect(screen.getByTestId(`pipeline-node-output-anchor-${nextNode.nodeKey}`)).toBeInTheDocument();
    expect(within(actionCard).queryByText(/检出分支：/)).not.toBeInTheDocument();
    expect(within(actionCard).queryByText("当前选中")).not.toBeInTheDocument();
    expect(within(actionCard).queryByText("已启用")).not.toBeInTheDocument();
  });

  it("selects a stage on left click and opens stage editing state", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToStage("stage-1", 1);
    clickGraphObject(nextNode.nodeKey);
    clickGraphObject("stage-1");

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中阶段"
    );
    expect(document.getElementById("pipeline-stage-name-input")).not.toBeNull();
    expect(document.getElementById("pipeline-node-type-select")).toBeNull();
  });

  it("selects a node on left click and opens node editing state", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToStage("stage-1", 1);
    clickGraphObject(nextNode.nodeKey);

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(document.getElementById("pipeline-node-type-select")).not.toBeNull();
    expect(document.getElementById("pipeline-stage-name-input")).toBeNull();
  });

  it("opens the stage context menu on right click without changing the current selection", async () => {
    render(<EditorHarness />);

    await addNodeToStage("stage-1", 1);

    openStageContextMenu("stage-1");

    expect(await screen.findByTestId("pipeline-graph-stage-context-delete")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-graph-stage-context-add-node")).not.toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
  });

  it("keeps node creation off the stage context menu", async () => {
    render(<EditorHarness />);

    openStageContextMenu("stage-1");

    expect(await screen.findByTestId("pipeline-graph-stage-context-delete")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-graph-stage-context-add-node")).not.toBeInTheDocument();
    expect(screen.getByTestId("pipeline-stage-start-anchor-trigger-stage-1")).toBeInTheDocument();
  });

  it("opens the create-node dialog from an empty-stage start anchor", async () => {
    render(<EditorHarness />);

    await openCreateNodeDialogFromStageStartAnchor("stage-1");

    expect(screen.getByRole("heading", { name: "创建节点" })).toBeInTheDocument();
    expect(screen.getByText("在阶段“阶段 1”中创建一个新节点。")).toBeInTheDocument();
    expect(parseDraft().nodes).toHaveLength(0);
    expect(parseDraft().edges).toHaveLength(0);
  });

  it("opens successor creation from a node output anchor without mutating the draft", async () => {
    render(<EditorHarness />);

    const sourceNode = await addNodeToStage("stage-1", 1);
    const beforeDraft = parseDraft();

    await openCreateNodeDialogFromNodeOutput(sourceNode.nodeKey);

    expect(screen.getByRole("heading", { name: "创建节点" })).toBeInTheDocument();
    expect(parseDraft()).toEqual(beforeDraft);
  });

  it("creates a successor edge from the node output anchor and keeps cancel side-effect free", async () => {
    render(<EditorHarness managedProjects={managedProjectsFixture} />);

    const sourceNode = await addNodeToStage("stage-1", 1);

    await openCreateNodeDialogFromNodeOutput(sourceNode.nodeKey);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "创建节点" })).not.toBeInTheDocument();
    });

    expect(parseDraft().nodes).toHaveLength(1);
    expect(parseDraft().edges).toHaveLength(0);

    await openCreateNodeDialogFromNodeOutput(sourceNode.nodeKey);
    const createDialog = screen.getByRole("dialog");
    fireEvent.change(within(createDialog).getByLabelText("节点类型"), {
      target: { value: "switch_project" },
    });
    fireEvent.change(within(createDialog).getByLabelText("项目"), {
      target: { value: "101" },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "创建节点" }));

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.nodes).toHaveLength(2);
      expect(draft.edges).toHaveLength(1);
    });

    const draft = parseDraft();
    const createdNode = draft.nodes.find((node) => node.nodeKey !== sourceNode.nodeKey);
    expect(createdNode).toBeDefined();
    expect(draft.edges).toEqual([
      expect.objectContaining({
        sourceNodeKey: sourceNode.nodeKey,
        targetNodeKey: createdNode?.nodeKey,
      }),
    ]);
  });

  it("allows optional builtin fields to stay empty during creation", async () => {
    render(<EditorHarness />);

    await openCreateNodeDialogFromStageStartAnchor("stage-1");
    fireEvent.change(screen.getByLabelText("节点类型"), {
      target: { value: "check_pipeline" },
    });
    fireEvent.change(screen.getByLabelText("GitLab 项目"), {
      target: { value: "team/service" },
    });
    fireEvent.change(screen.getByLabelText("引用"), {
      target: { value: "${source_branch}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

    await waitFor(() => {
      expect(parseDraft().nodes).toHaveLength(1);
    });

    expect(parseDraft().nodes[0]).toEqual(
      expect.objectContaining({
        nodeType: "check_pipeline",
        parameters: {
          project: "team/service",
          ref: "${source_branch}",
          sha: "",
        },
      })
    );
    expect(screen.queryByText(/提交 SHA.*必填/)).not.toBeInTheDocument();
  });

  it("requires a node type and required fields before creation", async () => {
    render(<EditorHarness managedProjects={managedProjectsFixture} />);

    await openCreateNodeDialogFromStageStartAnchor("stage-1");
    fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

    expect(screen.getByText(/节点类型.*必填/)).toBeInTheDocument();
    expect(parseDraft().nodes).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("节点类型"), {
      target: { value: "switch_project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

    expect(screen.getByText(/项目.*必填/)).toBeInTheDocument();
    expect(parseDraft().nodes).toHaveLength(0);
  });

  it("keeps the draft unchanged when the create-node dialog is invalid", async () => {
    render(<EditorHarness />);

    const beforeDraft = parseDraft();

    await openCreateNodeDialogFromStageStartAnchor("stage-1");
    fireEvent.change(screen.getByLabelText("节点类型"), {
      target: { value: "set_working_path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

    expect(screen.getByText(/目标路径.*必填/)).toBeInTheDocument();
    expect(parseDraft()).toEqual(beforeDraft);
  });

  it("creates a valid node from the dialog, selects it, and opens node editing", async () => {
    render(<EditorHarness managedProjects={managedProjectsFixture} />);

    await openCreateNodeDialogFromStageStartAnchor("stage-1");
    fireEvent.change(screen.getByLabelText("节点类型"), {
      target: { value: "switch_project" },
    });
    fireEvent.change(screen.getByLabelText("项目"), {
      target: { value: "101" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.nodes).toHaveLength(1);
      expect(draft.nodes[0]).toEqual(
        expect.objectContaining({
          stageKey: "stage-1",
          nodeType: "switch_project",
          parameters: { managedProjectId: "101" },
        })
      );
    });

    const createdNode = parseDraft().nodes[0];
    expect(createdNode).toBeDefined();
    expect(screen.queryByRole("heading", { name: "创建节点" })).not.toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
    expect(screen.getByTestId(`graph-node-${createdNode?.nodeKey}`)).toBeInTheDocument();
  });

  it("opens the node context menu on right click without changing the current selection", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToStage("stage-1", 1);
    clickGraphObject("stage-1");

    openNodeContextMenu(nextNode.nodeKey);

    expect(await screen.findByTestId("pipeline-graph-node-context-delete")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中阶段"
    );
    expect(screen.getByLabelText("阶段名称")).toBeInTheDocument();
  });

  it("deletes the right-clicked stage from the context menu without retargeting selection", async () => {
    render(<EditorHarness />);

    const firstNode = await addNodeToStage("stage-1", 1);
    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    clickGraphObject(firstNode.nodeKey);

    openStageContextMenu("stage-2");
    fireEvent.click(screen.getByTestId("pipeline-graph-stage-context-delete"));

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.stages).toHaveLength(1);
      expect(draft.stages[0]?.stageKey).toBe("stage-1");
    });

    expect(screen.queryByTestId("graph-node-stage-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
  });

  it("falls back to the owning stage after deleting the selected node", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToStage("stage-1", 1);

    openNodeContextMenu(nextNode.nodeKey);
    fireEvent.click(screen.getByTestId("pipeline-graph-node-context-delete"));

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.nodes).toHaveLength(0);
    });

    expect(screen.queryByTestId(`graph-node-${nextNode.nodeKey}`)).not.toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中阶段"
    );
    expect(screen.getByTestId("pipeline-stage-start-anchor-trigger-stage-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除选中对象" })).toBeEnabled();
    expect(document.getElementById("pipeline-stage-name-input")).not.toBeNull();
    expect(document.getElementById("pipeline-node-type-select")).toBeNull();
  });
  it("shows a preview edge while creating a successor from a node output anchor", async () => {
    render(<EditorHarness />);

    const firstNode = await addNodeToStage("stage-1", 1);

    await openCreateNodeDialogFromNodeOutput(firstNode.nodeKey);

    expect(screen.getByTestId("pipeline-graph-preview-edge")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByTestId("pipeline-graph-preview-edge")).not.toBeInTheDocument();
    });
  });

  it("keeps graph state after unmount and remount", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    await addNodeToStage("stage-2", 1);

    fireEvent.click(screen.getByRole("button", { name: "重新挂载" }));
    fireEvent.click(screen.getByRole("button", { name: "重新挂载" }));

    await waitFor(() => {
      expect(screen.getByTestId("graph-node-stage-2")).toBeInTheDocument();
    });

    const draft = parseDraft();
    expect(draft.stages).toHaveLength(2);
    expect(draft.nodes).toHaveLength(1);
  });

  it("shows minimap and canvas controls for navigation", () => {
    render(<EditorHarness />);

    expect(screen.getByTestId("mock-react-flow-controls")).toBeInTheDocument();
    expect(screen.getByTestId("mock-react-flow-minimap")).toBeInTheDocument();
  });

  it("keeps a single-selection model for canvas interactions", () => {
    render(<EditorHarness />);

    expect(lastReactFlowProps?.selectionOnDrag).toBe(false);
  });

  it("keeps pane dragging enabled while preserving zoom", () => {
    render(<EditorHarness />);

    expect(lastReactFlowProps?.panOnDrag).toBe(true);
    expect(lastReactFlowProps?.zoomOnScroll).toBe(true);
  });

  it("configures explicit drag handles for stage and action nodes", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToStage("stage-1", 1);
    expect(screen.getByTestId("pipeline-stage-drag-handle-stage-1")).toBeInTheDocument();
    expect(
      screen.getByTestId(`pipeline-action-drag-handle-${nextNode.nodeKey}`)
    ).toBeInTheDocument();

    const stageNode = lastReactFlowProps?.nodes.find((node) => node.id === "stage-1");
    const actionNode = lastReactFlowProps?.nodes.find((node) => node.id === nextNode.nodeKey);
    expect(stageNode?.dragHandle).toBe(".pipeline-stage-drag-handle");
    expect(actionNode?.dragHandle).toBe(".pipeline-action-drag-handle");
  });

  it("renders larger visible connection handles without clipping node cards", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToStage("stage-1", 1);
    const actionCard = screen.getByTestId(`pipeline-action-node-card-${nextNode.nodeKey}`);
    const stageCard = screen.getByTestId("pipeline-stage-node-card-stage-1");

    expect(actionCard).toHaveClass("overflow-visible");
    expect(stageCard).toHaveClass("overflow-visible");

    const targetHandle = within(actionCard).getByTestId("mock-handle-target-left");
    const sourceHandle = within(actionCard).getByTestId("mock-handle-source-right");
    expect(targetHandle).toHaveClass("!h-4", "!w-4", "!border-2");
    expect(sourceHandle).toHaveClass("!h-4", "!w-4", "!border-2");
    expect(targetHandle.getAttribute("data-style")).toContain("\"width\":16");
    expect(sourceHandle.getAttribute("data-style")).toContain("\"width\":16");
  });

  it("opens the stage context menu from the React Flow node contextmenu callback", async () => {
    render(<EditorHarness />);

    openContextMenuViaReactFlow("stage-1");

    expect(await screen.findByTestId("pipeline-graph-stage-context-delete")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-graph-stage-context-add-node")).not.toBeInTheDocument();
  });

  it("exposes a fit-view action", () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "适配全貌" }));

    expect(mockFitView).toHaveBeenCalledTimes(1);
  });

  it("keeps the stage context but disarms delete after removing the selected node", async () => {
    render(<EditorHarness />);

    const firstNode = await addNodeToStage("stage-1", 1);
    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    const secondNode = await addNodeToStage("stage-2", 2);

    expect(secondNode.stageKey).toBe("stage-2");
    fireEvent.click(screen.getByRole("button", { name: "删除选中对象" }));

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.nodes).toHaveLength(1);
      expect(draft.nodes[0]?.nodeKey).toBe(firstNode.nodeKey);
    });

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中阶段"
    );
    expect(screen.getByTestId("pipeline-stage-start-anchor-trigger-stage-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除选中对象" })).toBeEnabled();
    expect(document.getElementById("pipeline-stage-name-input")).not.toBeNull();
    expect(document.getElementById("pipeline-node-type-select")).toBeNull();
  });

  it("tracks whether the selected object is a stage or a node", async () => {
    render(<EditorHarness />);

    const summary = screen.getByTestId("pipeline-graph-selection-summary");
    expect(summary).toHaveTextContent("已选中阶段");

    await openCreateNodeDialogFromStageStartAnchor("stage-1");
    expect(summary).toHaveTextContent("已选中阶段");

    fireEvent.change(screen.getByLabelText("节点类型"), {
      target: { value: "checkout_branch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

    expect(summary).toHaveTextContent("已选中节点");

    clickGraphObject("stage-1");
    expect(summary).toHaveTextContent("已选中阶段");
  });

  it("selects the stage from the stage card body itself", () => {
    render(<EditorHarness />);

    clickCanvasPane();
    expect(document.getElementById("pipeline-stage-name-input")).toBeNull();

    fireEvent.click(screen.getByTestId("pipeline-stage-node-card-stage-1"));

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中阶段"
    );
    expect(document.getElementById("pipeline-stage-name-input")).not.toBeNull();
  });

  it("selects the node from the node card body itself", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToStage("stage-1", 1);
    clickCanvasPane();
    expect(document.getElementById("pipeline-node-type-select")).toBeNull();

    fireEvent.click(screen.getByTestId(`pipeline-action-node-card-${nextNode.nodeKey}`));

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(document.getElementById("pipeline-node-type-select")).not.toBeNull();
  });

  it("keeps the current selection when React Flow reports an empty transient selection", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToStage("stage-1", 1);
    fireEvent.click(screen.getByTestId(`pipeline-action-node-card-${nextNode.nodeKey}`));
    reportEmptySelectionChange();

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(document.getElementById("pipeline-node-type-select")).not.toBeNull();
  });

  it("switches the inspector between stage and node attributes", async () => {
    render(<EditorHarness />);

    expect(screen.getByLabelText("阶段名称")).toBeInTheDocument();

    await addNodeToStage("stage-1", 1);
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
  });

  it("writes back stage name and enabled state changes", async () => {
    render(<EditorHarness />);

    fireEvent.click(within(screen.getByTestId("graph-node-stage-1")).getByRole("button"));
    fireEvent.change(screen.getByLabelText("阶段名称"), {
      target: { value: "准备阶段" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "启用该阶段" }));

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.stages[0]?.name).toBe("准备阶段");
      expect(draft.stages[0]?.enabled).toBe(false);
    });
  });

  it("remaps the selected node type and resets builtin parameters", async () => {
    render(<EditorHarness />);

    await addNodeToStage("stage-1", 1);
    fireEvent.change(screen.getByLabelText("节点类型"), {
      target: { value: "switch_project" },
    });

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.nodes[0]?.nodeType).toBe("switch_project");
      expect(draft.nodes[0]?.parameters).toEqual({ managedProjectId: "" });
    });

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(screen.getByRole("button", { name: "删除选中对象" })).toBeEnabled();
  });

  it("shows switch_project project options and writes back the selected project", async () => {
    render(<EditorHarness managedProjects={managedProjectsFixture} />);

    await addNodeToStage("stage-1", 1);
    fireEvent.change(screen.getByLabelText("节点类型"), {
      target: { value: "switch_project" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("项目")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("项目"), {
      target: { value: "101" },
    });

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.nodes[0]?.parameters).toEqual({ managedProjectId: "101" });
    });

    expect(screen.getByText("team/alpha-service / D:/repos/alpha-service")).toBeInTheDocument();
  });

  it("supports structured editing for nested custom-node parameters", async () => {
    const initialDraft: PipelineDraft = {
      ...createEmptyPipelineDraft(),
      nodes: [
        {
          id: "node_1",
          nodeKey: "node_1",
          stageKey: "default_stage",
          nodeType: "custom_release_gate",
          enabled: true,
          position: { x: 120, y: 72 },
          parameters: {},
        },
      ],
    };

    render(<EditorHarness initialDraft={initialDraft} />);

    const editor = screen.getByTestId("pipeline-node-structured-editor-node_1");
    fireEvent.click(within(editor).getByRole("button", { name: "添加字段" }));

    const rootField = within(editor).getAllByTestId("structured-json-field-row")[0];
    fireEvent.change(within(rootField).getByLabelText("键名"), {
      target: { value: "targets" },
    });
    fireEvent.change(within(rootField).getByLabelText("值类型"), {
      target: { value: "array" },
    });

    const arrayEditor = within(rootField).getByTestId("structured-json-array-editor");
    fireEvent.click(within(arrayEditor).getByRole("button", { name: "添加项" }));
    const firstItem = within(arrayEditor).getAllByTestId("structured-json-array-item")[0];
    fireEvent.change(within(firstItem).getByLabelText("值类型"), {
      target: { value: "object" },
    });

    const nestedObject = within(firstItem).getByTestId("structured-json-object-editor");
    fireEvent.click(within(nestedObject).getByRole("button", { name: "添加字段" }));
    const nestedField = within(nestedObject).getAllByTestId("structured-json-field-row")[0];
    fireEvent.change(within(nestedField).getByLabelText("键名"), {
      target: { value: "project" },
    });
    fireEvent.change(within(nestedField).getByLabelText("字符串值"), {
      target: { value: "team/service-a" },
    });

    await waitFor(() => {
      expect(parseDraft().nodes[0]?.parameters).toEqual({
        targets: [{ project: "team/service-a" }],
      });
    });
  });

  it("preserves the last valid structured value across invalid advanced JSON edits", async () => {
    const initialDraft: PipelineDraft = {
      ...createEmptyPipelineDraft(),
      nodes: [
        {
          id: "node_1",
          nodeKey: "node_1",
          stageKey: "default_stage",
          nodeType: "custom_release_gate",
          enabled: true,
          position: { x: 120, y: 72 },
          parameters: {
            target: { project: "team/service-a" },
            approvals: 2,
          },
        },
      ],
    };

    render(<EditorHarness initialDraft={initialDraft} />);

    const editor = screen.getByTestId("pipeline-node-structured-editor-node_1");
    expect(within(editor).getByRole("button", { name: "结构化模式" })).toBeInTheDocument();

    fireEvent.click(within(editor).getByRole("button", { name: "JSON 模式" }));
    fireEvent.change(within(editor).getByLabelText("高级 JSON"), {
      target: { value: '{"target":' },
    });

    expect(
      within(editor).getByText("JSON 格式无效，已保留最近一次有效值。")
    ).toBeInTheDocument();

    fireEvent.click(within(editor).getByRole("button", { name: "结构化模式" }));

    expect(parseDraft().nodes[0]?.parameters).toEqual({
      target: { project: "team/service-a" },
      approvals: 2,
    });
  });

  it("reorders dragged stages and keeps them on horizontal lanes", async () => {
    const initialDraft: PipelineDraft = {
      ...createEmptyPipelineDraft(),
      stages: [
        createStageDraft({
          id: "stage-1",
          stageKey: "stage-1",
          name: "Stage 1",
          enabled: true,
        }),
        createStageDraft({
          id: "stage-2",
          stageKey: "stage-2",
          name: "Stage 2",
          enabled: true,
        }),
      ],
      nodes: [],
    };

    render(<EditorHarness initialDraft={initialDraft} />);

    dragGraphNode("stage-2", { x: 0, y: 220 });

    await waitFor(() => {
      expect(parseDraft().stages.map((stage) => stage.stageKey)).toEqual(["stage-2", "stage-1"]);
    });

    const stageNodes = buildGraphEditorState(parseDraft()).nodes.filter(
      (node) => node.type === "stage-group"
    );
    expect(stageNodes.map((node) => node.position)).toEqual([
      { x: 24, y: 32 },
      { x: 384, y: 32 },
    ]);
  });

  it("reflows a dragged node within the same stage after dropping onto an occupied slot", async () => {
    const initialDraft: PipelineDraft = {
      ...createEmptyPipelineDraft(),
      nodes: [
        createNodeDraft({
          id: "node-a",
          nodeKey: "node-a",
          stageKey: "stage-1",
          nodeType: "checkout_branch",
          position: { x: 96, y: 72 },
        }),
        createNodeDraft({
          id: "node-b",
          nodeKey: "node-b",
          stageKey: "stage-1",
          nodeType: "checkout_branch",
          position: { x: 308, y: 72 },
        }),
        createNodeDraft({
          id: "node-c",
          nodeKey: "node-c",
          stageKey: "stage-1",
          nodeType: "checkout_branch",
          position: { x: 96, y: 188 },
        }),
      ],
    };

    render(<EditorHarness initialDraft={initialDraft} />);

    dragGraphNode("node-c", { x: 280, y: 92 });

    await waitFor(() => {
      const positions = Object.fromEntries(
        parseDraft().nodes.map((node) => [node.nodeKey, node.position])
      );
      expect(positions).toEqual({
        "node-a": { x: 96, y: 72 },
        "node-b": { x: 96, y: 188 },
        "node-c": { x: 308, y: 72 },
      });
    });

    expect(
      new Set(parseDraft().nodes.map((node) => `${node.position.x}:${node.position.y}`)).size
    ).toBe(3);
  });

  it("reassigns a dragged node into the target stage", async () => {
    const initialDraft: PipelineDraft = {
      ...createEmptyPipelineDraft(),
      stages: [
        createStageDraft({
          id: "stage-1",
          stageKey: "stage-1",
          name: "Stage 1",
          enabled: true,
        }),
        createStageDraft({
          id: "stage-2",
          stageKey: "stage-2",
          name: "Stage 2",
          enabled: true,
        }),
      ],
      nodes: [
        createNodeDraft({
          id: "node-a",
          nodeKey: "node-a",
          stageKey: "stage-1",
          nodeType: "checkout_branch",
          position: { x: 96, y: 72 },
        }),
      ],
    };

    render(<EditorHarness initialDraft={initialDraft} />);

    dragGraphNode(
      "node-a",
      { x: 96, y: 72 },
      {
        parentId: "stage-2",
        data: {
          stageKey: "stage-2",
        },
      }
    );

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.nodes[0]).toEqual(
        expect.objectContaining({
          nodeKey: "node-a",
          stageKey: "stage-2",
        })
      );
    });
  });

  it("shows drag target feedback before completing a cross-stage move", async () => {
    const initialDraft: PipelineDraft = {
      ...createEmptyPipelineDraft(),
      stages: [
        createStageDraft({
          id: "stage-1",
          stageKey: "stage-1",
          name: "Stage 1",
          enabled: true,
        }),
        createStageDraft({
          id: "stage-2",
          stageKey: "stage-2",
          name: "Stage 2",
          enabled: true,
        }),
      ],
      nodes: [
        createNodeDraft({
          id: "node-a",
          nodeKey: "node-a",
          stageKey: "stage-1",
          nodeType: "checkout_branch",
          position: { x: 96, y: 72 },
        }),
      ],
    };

    render(<EditorHarness initialDraft={initialDraft} />);

    previewDragGraphNode(
      "node-a",
      { x: 96, y: 72 },
      {
        parentId: "stage-2",
        data: {
          stageKey: "stage-2",
        },
      }
    );

    expect(screen.getByTestId("pipeline-stage-drop-preview-stage-2")).toBeInTheDocument();
  });

  it("reorders stages after a cross-stage move when dependencies require a different legal order", async () => {
    const initialDraft: PipelineDraft = {
      ...createEmptyPipelineDraft(),
      stages: [
        createStageDraft({
          id: "stage-1",
          stageKey: "stage-1",
          name: "Stage 1",
          enabled: true,
        }),
        createStageDraft({
          id: "stage-2",
          stageKey: "stage-2",
          name: "Stage 2",
          enabled: true,
        }),
        createStageDraft({
          id: "stage-3",
          stageKey: "stage-3",
          name: "Stage 3",
          enabled: true,
        }),
      ],
      nodes: [
        createNodeDraft({
          id: "node-a",
          nodeKey: "node-a",
          stageKey: "stage-1",
          nodeType: "checkout_branch",
          position: { x: 96, y: 72 },
        }),
        createNodeDraft({
          id: "node-b",
          nodeKey: "node-b",
          stageKey: "stage-2",
          nodeType: "trigger_pipeline",
          position: { x: 96, y: 72 },
        }),
        createNodeDraft({
          id: "node-c",
          nodeKey: "node-c",
          stageKey: "stage-3",
          nodeType: "wait_pipeline",
          position: { x: 96, y: 72 },
        }),
      ],
      edges: [
        {
          id: "node-c->node-b",
          sourceNodeKey: "node-c",
          targetNodeKey: "node-b",
        },
      ],
    };

    render(<EditorHarness initialDraft={initialDraft} />);

    dragGraphNode(
      "node-a",
      { x: 96, y: 72 },
      {
        parentId: "stage-3",
        data: {
          stageKey: "stage-3",
        },
      }
    );

    await waitFor(() => {
      expect(parseDraft().stages.map((stage) => stage.stageKey)).toEqual([
        "stage-1",
        "stage-3",
        "stage-2",
      ]);
    });
  });

  it("preserves stage context but clears the explicit selection on multi-select", () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟多选" }));

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "未选中对象"
    );
    expect(screen.getByText("当前活动阶段：阶段 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除选中对象" })).toBeDisabled();
  });

  it("keeps anchor-driven creation available after selection is cleared while stages remain", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByTestId("pipeline-graph-add-stage-button"));
    fireEvent.click(screen.getByTestId("mock-react-flow-multiselect"));

    expect(screen.getByTestId("pipeline-stage-start-anchor-trigger-stage-2")).toBeInTheDocument();

    const nextNode = await addNodeToStage("stage-2", 1);
    expect(nextNode.stageKey).toBe("stage-2");
  });

  it("falls back to another stage after deleting the selected stage", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByTestId("pipeline-graph-add-stage-button"));
    clickGraphObject("stage-2");
    fireEvent.click(screen.getByTestId("pipeline-graph-delete-button"));

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.stages).toHaveLength(1);
      expect(draft.stages[0]?.stageKey).toBe("stage-1");
    });

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中阶段"
    );
    expect(screen.getByTestId("pipeline-stage-start-anchor-trigger-stage-1")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-delete-button")).toBeEnabled();
    expect(document.getElementById("pipeline-stage-name-input")).not.toBeNull();
    expect(document.getElementById("pipeline-node-type-select")).toBeNull();
  });

  it("resets the inspector to the empty state on blank-canvas click without blocking node expansion", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToStage("stage-1", 1);
    clickGraphObject(nextNode.nodeKey);
    clickCanvasPane();

    expect(screen.getByTestId("pipeline-graph-delete-button")).toBeDisabled();
    expect(document.getElementById("pipeline-stage-name-input")).toBeNull();
    expect(document.getElementById("pipeline-node-type-select")).toBeNull();
    expect(screen.getByTestId(`pipeline-node-output-anchor-${nextNode.nodeKey}`)).toBeInTheDocument();
  });

  it("keeps stage-local anchor creation aligned after moving the selected node to another stage", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByTestId("pipeline-graph-add-stage-button"));
    clickGraphObject("stage-1");
    const movedNode = await addNodeToStage("stage-1", 1);
    clickGraphObject("stage-2");
    const targetStageNode = await addNodeToStage("stage-2", 2);
    clickGraphObject(movedNode.nodeKey);

    const stageSelect = document.getElementById("pipeline-node-stage-select");
    expect(stageSelect).not.toBeNull();
    fireEvent.change(stageSelect as HTMLSelectElement, {
      target: { value: "stage-2" },
    });

    await waitFor(() => {
      const draft = parseDraft();
      const movedNodeDraft = draft.nodes.find((node) => node.nodeKey === movedNode.nodeKey);
      const targetStageNodeDraft = draft.nodes.find(
        (node) => node.nodeKey === targetStageNode.nodeKey
      );
      expect(movedNodeDraft?.stageKey).toBe("stage-2");
      expect(targetStageNodeDraft?.stageKey).toBe("stage-2");
      expect(movedNodeDraft?.position).toEqual({ x: 308, y: 72 });
      expect(
        new Set(
          draft.nodes
            .filter((node) => node.stageKey === "stage-2")
            .map((node) => `${node.position.x}:${node.position.y}`)
        ).size
      ).toBe(2);
    });

    clickCanvasPane();

    const nextNode = await addNodeToStage("stage-2", 3);
    expect(nextNode.stageKey).toBe("stage-2");
  });
});
