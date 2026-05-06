import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineGraphEditor } from "@/components/pipeline-graph/PipelineGraphEditor";
import {
  createEmptyPipelineDraft,
  resetPipelineDraftCountersForTest,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";
import type { ManagedProject } from "@/lib/types";

const mockFitView = vi.fn();
let lastReactFlowProps:
  | {
      panOnDrag?: boolean;
      zoomOnScroll?: boolean;
      selectionOnDrag?: boolean;
    }
  | null = null;

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");

  return {
    Background: () => null,
    Controls: () => <div data-testid="mock-react-flow-controls" />,
    MiniMap: () => <div data-testid="mock-react-flow-minimap" />,
    Handle: () => null,
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
      onSelectionChange?: (params: {
        nodes: Array<Record<string, unknown>>;
        edges: Array<Record<string, unknown>>;
      }) => void;
      onInit?: (instance: { fitView: () => void }) => void;
      panOnDrag?: boolean;
      zoomOnScroll?: boolean;
      selectionOnDrag?: boolean;
      children?: React.ReactNode;
    }) => {
      lastReactFlowProps = {
        panOnDrag,
        zoomOnScroll,
        selectionOnDrag,
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
            onClick={() => {
              setSelectedNodeId(null);
              onSelectionChange?.({ nodes, edges: [] });
            }}
          >
            模拟多选
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
              <div key={String(node.id)} data-testid={`graph-node-${String(node.id)}`}>
                <button
                  type="button"
                  onClick={() => {
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

async function addNodeToSelectedStage(expectedCount: number) {
  fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));
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
    expect(screen.getByRole("button", { name: "在所选阶段添加节点" })).toBeEnabled();
  });

  it("uses a wider three-column layout and full-width action buttons", () => {
    render(<EditorHarness />);

    expect(screen.getByTestId("pipeline-graph-layout")).toHaveClass(
      "xl:grid-cols-[260px_minmax(0,1fr)_300px]"
    );

    for (const testId of [
      "pipeline-graph-add-stage-button",
      "pipeline-graph-add-node-button",
      "pipeline-graph-create-connection-button",
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

  it("adds a node into the selected stage", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    clickGraphObject("stage-2");
    const nextNode = await addNodeToSelectedStage(1);

    expect(nextNode.stageKey).toBe("stage-2");
  });

  it("selects the newly added node and opens node editing", async () => {
    render(<EditorHarness />);

    await addNodeToSelectedStage(1);

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
  });

  it("renders compact stage and action cards with a summary-only node view", async () => {
    render(<EditorHarness />);

    expect(screen.getByTestId("pipeline-stage-node-card-stage-1")).toHaveClass(
      "overflow-hidden",
      "p-3"
    );

    const nextNode = await addNodeToSelectedStage(1);
    const actionCard = screen.getByTestId(`pipeline-action-node-card-${nextNode.nodeKey}`);

    expect(actionCard).toHaveClass("w-[188px]", "p-3");
    expect(
      screen.getByTestId(`pipeline-action-node-summary-${nextNode.nodeKey}`)
    ).toHaveTextContent("检出分支：${source_branch}");
    expect(within(actionCard).queryByText(nextNode.nodeKey)).not.toBeInTheDocument();
    expect(within(actionCard).queryByText(nextNode.stageKey)).not.toBeInTheDocument();
  });

  it("selects a stage on left click and opens stage editing state", async () => {
    render(<EditorHarness />);

    await addNodeToSelectedStage(1);
    clickGraphObject("stage-1");

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中阶段"
    );
    expect(screen.getByLabelText("阶段名称")).toBeInTheDocument();
  });

  it("selects a node on left click and opens node editing state", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToSelectedStage(1);
    clickGraphObject("stage-1");
    clickGraphObject(nextNode.nodeKey);

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
  });

  it("opens the stage context menu on right click without changing the current selection", async () => {
    render(<EditorHarness />);

    await addNodeToSelectedStage(1);

    fireEvent.contextMenu(screen.getByTestId("pipeline-stage-node-card-stage-1"), {
      clientX: 160,
      clientY: 220,
    });

    expect(await screen.findByRole("menuitem", { name: "添加节点" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除阶段" })).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中节点"
    );
    expect(screen.getByLabelText("节点类型")).toBeInTheDocument();
  });

  it("opens the node context menu on right click without changing the current selection", async () => {
    render(<EditorHarness />);

    const nextNode = await addNodeToSelectedStage(1);
    clickGraphObject("stage-1");

    fireEvent.contextMenu(screen.getByTestId(`pipeline-action-node-card-${nextNode.nodeKey}`), {
      clientX: 240,
      clientY: 260,
    });

    expect(await screen.findByRole("menuitem", { name: "删除节点" })).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "已选中阶段"
    );
    expect(screen.getByLabelText("阶段名称")).toBeInTheDocument();
  });
  it("connects nodes and blocks duplicate connections", async () => {
    render(<EditorHarness />);

    const firstNode = await addNodeToSelectedStage(1);
    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    const secondNode = await addNodeToSelectedStage(2);

    clickGraphObject(firstNode.nodeKey);
    fireEvent.change(screen.getByLabelText("连接到节点"), {
      target: { value: secondNode.nodeKey },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建连线" }));

    await waitFor(() => {
      expect(screen.getByTestId("mock-react-flow-edge-count")).toHaveTextContent("1");
    });

    fireEvent.change(screen.getByLabelText("连接到节点"), {
      target: { value: secondNode.nodeKey },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建连线" }));
    expect(screen.getByText("该连线已存在")).toBeInTheDocument();
  });

  it("keeps graph state after unmount and remount", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    await addNodeToSelectedStage(1);

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

  it("passes pan and zoom toggles through to React Flow", () => {
    render(<EditorHarness />);

    expect(lastReactFlowProps?.panOnDrag).toBe(true);
    expect(lastReactFlowProps?.zoomOnScroll).toBe(true);
  });

  it("exposes a fit-view action", () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "适配全貌" }));

    expect(mockFitView).toHaveBeenCalledTimes(1);
  });

  it("keeps the stage context but disarms delete after removing the selected node", async () => {
    render(<EditorHarness />);

    const firstNode = await addNodeToSelectedStage(1);
    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    const secondNode = await addNodeToSelectedStage(2);

    expect(secondNode.stageKey).toBe("stage-2");
    fireEvent.click(screen.getByRole("button", { name: "删除选中对象" }));

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.nodes).toHaveLength(1);
      expect(draft.nodes[0]?.nodeKey).toBe(firstNode.nodeKey);
    });

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "未选中对象"
    );
    expect(screen.getByText("当前活动阶段：阶段 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "在所选阶段添加节点" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "删除选中对象" })).toBeDisabled();
  });

  it("tracks whether the selected object is a stage or a node", () => {
    render(<EditorHarness />);

    const summary = screen.getByTestId("pipeline-graph-selection-summary");
    expect(summary).toHaveTextContent("已选中阶段");

    fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));
    expect(summary).toHaveTextContent("已选中节点");

    clickGraphObject("stage-1");
    expect(summary).toHaveTextContent("已选中阶段");
  });

  it("switches the inspector between stage and node attributes", async () => {
    render(<EditorHarness />);

    expect(screen.getByLabelText("阶段名称")).toBeInTheDocument();

    await addNodeToSelectedStage(1);
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

    await addNodeToSelectedStage(1);
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

    await addNodeToSelectedStage(1);
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

  it("keeps add-node available after selection is cleared while stages remain", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟多选" }));

    expect(screen.getByRole("button", { name: "在所选阶段添加节点" })).toBeEnabled();

    const nextNode = await addNodeToSelectedStage(1);
    expect(nextNode.stageKey).toBe("stage-2");
  });
});
