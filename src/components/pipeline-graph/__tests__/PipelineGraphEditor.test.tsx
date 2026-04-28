import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineGraphEditor } from "@/components/pipeline-graph/PipelineGraphEditor";
import {
  createEmptyPipelineDraft,
  resetPipelineDraftCountersForTest,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";

const mockFitView = vi.fn();

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
      selectionOnDrag?: boolean;
      children?: React.ReactNode;
    }) => {
      const [selectedNodeId, setSelectedNodeId] = ReactModule.useState<string | null>(null);

      ReactModule.useEffect(() => {
        onInit?.({ fitView: mockFitView });
      }, [onInit]);

      return (
        <div data-testid="mock-react-flow">
          <div data-testid="mock-react-flow-edge-count">{edges.length}</div>
          <div data-testid="mock-react-flow-selection-on-drag">
            {String(Boolean(selectionOnDrag))}
          </div>
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

function EditorHarness() {
  const [draft, setDraft] = React.useState(() => createEmptyPipelineDraft());
  const [visible, setVisible] = React.useState(true);

  return (
    <div className="grid gap-4">
      <button type="button" onClick={() => setVisible((current) => !current)}>
        重新挂载
      </button>
      <pre data-testid="pipeline-draft-json">{JSON.stringify(draft)}</pre>
      {visible ? (
        <PipelineGraphEditor draft={draft} managedProjects={[]} onChange={setDraft} />
      ) : null}
    </div>
  );
}

describe("PipelineGraphEditor", () => {
  beforeEach(() => {
    mockFitView.mockReset();
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

  it("adds a node into the selected stage", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    fireEvent.click(
      within(screen.getByTestId("graph-node-stage-2")).getByRole("button")
    );
    fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));

    await waitFor(() => {
      const draft = parseDraft();
      expect(draft.nodes).toHaveLength(2);
      expect(draft.nodes[1]?.stageKey).toBe("stage-2");
    });
  });

  it("connects nodes and blocks duplicate connections", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    fireEvent.click(
      within(screen.getByTestId("graph-node-stage-2")).getByRole("button")
    );
    fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));

    fireEvent.click(
      within(screen.getByTestId("graph-node-checkout_branch_node-1")).getByRole("button")
    );
    fireEvent.change(screen.getByLabelText("连接到节点"), {
      target: { value: "checkout_branch_node-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建连线" }));

    await waitFor(() => {
      expect(screen.getByTestId("mock-react-flow-edge-count")).toHaveTextContent("1");
    });

    fireEvent.change(screen.getByLabelText("连接到节点"), {
      target: { value: "checkout_branch_node-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建连线" }));
    expect(screen.getByText("该连线已存在")).toBeInTheDocument();
  });

  it("keeps graph state after unmount and remount", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    fireEvent.click(
      within(screen.getByTestId("graph-node-stage-2")).getByRole("button")
    );
    fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));

    fireEvent.click(screen.getByRole("button", { name: "重新挂载" }));
    fireEvent.click(screen.getByRole("button", { name: "重新挂载" }));

    await waitFor(() => {
      expect(screen.getByTestId("graph-node-stage-2")).toBeInTheDocument();
    });

    const draft = parseDraft();
    expect(draft.stages).toHaveLength(2);
    expect(draft.nodes).toHaveLength(2);
  });

  it("shows minimap and canvas controls for navigation", () => {
    render(<EditorHarness />);

    expect(screen.getByTestId("mock-react-flow-controls")).toBeInTheDocument();
    expect(screen.getByTestId("mock-react-flow-minimap")).toBeInTheDocument();
  });

  it("keeps a single-selection model for canvas interactions", () => {
    render(<EditorHarness />);

    expect(screen.getByTestId("mock-react-flow-selection-on-drag")).toHaveTextContent("false");
  });

  it("exposes a fit-view action", () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "适配全貌" }));

    expect(mockFitView).toHaveBeenCalledTimes(1);
  });

  it("deletes the selected node from the draft", async () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "删除选中对象" }));

    await waitFor(() => {
      expect(parseDraft().nodes).toHaveLength(0);
    });
  });

  it("tracks whether the selected object is a stage or a node", () => {
    render(<EditorHarness />);

    const summary = screen.getByTestId("pipeline-graph-selection-summary");
    expect(summary).toHaveTextContent("已选中节点");

    fireEvent.click(within(screen.getByTestId("graph-node-stage-1")).getByRole("button"));
    expect(summary).toHaveTextContent("已选中阶段");

    fireEvent.click(
      within(screen.getByTestId("graph-node-checkout_branch_node-1")).getByRole("button")
    );
    expect(summary).toHaveTextContent("已选中节点");
  });

  it("clears the active selection when the flow reports multiple selected nodes", () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "模拟多选" }));

    expect(screen.getByTestId("pipeline-graph-selection-summary")).toHaveTextContent(
      "未选中对象"
    );
    expect(screen.getByRole("button", { name: "删除选中对象" })).toBeDisabled();
  });

  it("does not allow adding a node when no graph object is selected", () => {
    render(<EditorHarness />);

    fireEvent.click(screen.getByRole("button", { name: "模拟多选" }));

    expect(
      screen.getByRole("button", { name: "在所选阶段添加节点" })
    ).toBeDisabled();
    expect(parseDraft().nodes).toHaveLength(1);
  });
});
