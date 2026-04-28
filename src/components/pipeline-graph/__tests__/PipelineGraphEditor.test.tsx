import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineGraphEditor } from "@/components/pipeline-graph/PipelineGraphEditor";
import {
  createEmptyPipelineDraft,
  resetPipelineDraftCountersForTest,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");

  return {
    Background: () => null,
    Controls: () => null,
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
    }: {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
      nodeTypes?: Record<string, React.ComponentType<Record<string, unknown>>>;
      onNodeClick?: (event: unknown, node: Record<string, unknown>) => void;
    }) => (
      <div data-testid="mock-react-flow">
        <div data-testid="mock-react-flow-edge-count">{edges.length}</div>
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
              <button type="button" onClick={() => onNodeClick?.({}, node)}>
                {label}
              </button>
              {Component ? (
                <Component
                  id={String(node.id)}
                  data={data}
                  selected={false}
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
    ),
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
});
