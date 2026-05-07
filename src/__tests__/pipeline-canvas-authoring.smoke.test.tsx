import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowsPagePipeline } from "@/pages/WorkflowsPagePipeline";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@xyflow/react", async () => {
  return {
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    MiniMap: () => null,
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
      children,
    }: {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
      nodeTypes?: Record<string, any>;
      onNodeClick?: (event: unknown, node: Record<string, unknown>) => void;
      children?: any;
    }) => (
      <div data-testid="mock-react-flow">
        <div data-testid="mock-react-flow-edge-count">{edges.length}</div>
        {children}
        {nodes.map((node) => {
          const Component = node.type && nodeTypes ? nodeTypes[String(node.type)] : null;
          const data = (node.data ?? {}) as Record<string, unknown>;

          return (
            <div
              key={String(node.id)}
              data-id={String(node.id)}
              data-testid={`graph-node-${String(node.id)}`}
              onClick={() => onNodeClick?.({}, node)}
            >
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

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
let runtimeWarnings: string[] = [];

beforeEach(() => {
  runtimeWarnings = [];
  invokeMock.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    const message = args
      .map((arg) => (typeof arg === "string" ? arg : String(arg)))
      .join(" ");
    runtimeWarnings.push(message);
  });
});

afterEach(() => {
  try {
    expect(runtimeWarnings).toEqual([]);
  } finally {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  }
});

describe("pipeline canvas authoring smoke", () => {
  function activateEditorTab(name: string) {
    act(() => {
      fireEvent.mouseDown(screen.getByRole("tab", { name }), {
        button: 0,
        ctrlKey: false,
      });
    });
  }

  async function openCreatePipelineEditor() {
    render(<WorkflowsPagePipeline />);
    fireEvent.click(await screen.findByRole("button", { name: "新建流水线" }));
  }

  function openStageContextMenu(stageKey: string, clientX = 160, clientY = 220) {
    fireEvent.contextMenu(screen.getByTestId(`pipeline-stage-node-card-${stageKey}`), {
      clientX,
      clientY,
    });
  }

  function expectNoProjectGroupFetch() {
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).not.toContain(
      "list_project_groups"
    );
  }

  it("covers the page-level canvas authoring flow from create mode through save", async () => {
    const managedProjects = [
      {
        id: 11,
        gitlabProjectId: 1011,
        name: "web-service",
        pathWithNamespace: "team/web-service",
        repoPath: "D:/repos/web-service",
        defaultBranch: "main",
        defaultRemote: "origin",
        enabled: true,
        createdAt: "2026-04-22T00:00:00Z",
        updatedAt: "2026-04-22T00:00:00Z",
      },
      {
        id: 12,
        gitlabProjectId: 1012,
        name: "worker-service",
        pathWithNamespace: "team/worker-service",
        repoPath: "D:/repos/worker-service",
        defaultBranch: "main",
        defaultRemote: "origin",
        enabled: true,
        createdAt: "2026-04-22T00:00:00Z",
        updatedAt: "2026-04-22T00:00:00Z",
      },
    ];
    const createdDefinitions: Array<{ id: number; name: string }> = [];
    let draftStageKey = "";

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_pipeline_definitions") {
        return createdDefinitions.map((item) => ({
          id: item.id,
          name: item.name,
          description: "",
          enabled: true,
          maxConcurrencyDefault: 1,
          legacyWorkflowDefinitionId: null,
          createdAt: "2026-04-22T00:00:00Z",
          updatedAt: "2026-04-22T00:00:00Z",
          variablesCount: 0,
          nodesCount: 1,
          schedulesCount: 0,
        }));
      }
      if (cmd === "list_managed_projects") return managedProjects;
      if (cmd === "create_pipeline_definition") {
        expect(args).toEqual(
          expect.objectContaining({
            name: "switch-project-authoring-flow",
            stages: [
              expect.objectContaining({
                stageKey: draftStageKey,
                name: "release-stage",
              }),
            ],
            nodes: [
              expect.objectContaining({
                nodeType: "switch_project",
                stageKey: draftStageKey,
                parameters: { managedProjectId: "12" },
              }),
            ],
          })
        );
        createdDefinitions.push({
          id: 501,
          name: String(args?.name ?? ""),
        });
        return undefined;
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    await openCreatePipelineEditor();

    const stageCard = await screen.findByTestId(/pipeline-stage-node-card-/);
    if (!(stageCard instanceof HTMLElement)) {
      throw new Error("Could not find initial pipeline stage card");
    }
    draftStageKey =
      stageCard.getAttribute("data-testid")?.replace("pipeline-stage-node-card-", "") ?? "";

    openStageContextMenu(draftStageKey);
    fireEvent.click(await screen.findByTestId("pipeline-graph-stage-context-add-node"));

    const nodeTypeSelect = document.getElementById("pipeline-create-node-type-select");
    if (!(nodeTypeSelect instanceof HTMLSelectElement)) {
      throw new Error("pipeline-create-node-type-select not found");
    }
    const createNodeDialog = nodeTypeSelect.closest('[role="dialog"]');
    if (!(createNodeDialog instanceof HTMLElement)) {
      throw new Error("create-node dialog not found");
    }
    fireEvent.change(nodeTypeSelect, {
      target: { value: "switch_project" },
    });

    const managedProjectSelect = document.getElementById(
      "pipeline-create-node-managed-project-select"
    );
    if (!(managedProjectSelect instanceof HTMLSelectElement)) {
      throw new Error("pipeline-create-node-managed-project-select not found");
    }
    fireEvent.change(managedProjectSelect, {
      target: { value: "11" },
    });

    fireEvent.click(within(createNodeDialog).getByRole("button", { name: "创建节点" }));

    await waitFor(() => {
      const inspectorManagedProjectSelect = document.getElementById(
        "pipeline-node-managed-project-select"
      );
      expect(inspectorManagedProjectSelect).toBeInstanceOf(HTMLSelectElement);
      expect(inspectorManagedProjectSelect).toHaveValue("11");
    });

    const inspectorManagedProjectSelect = document.getElementById(
      "pipeline-node-managed-project-select"
    );
    if (!(inspectorManagedProjectSelect instanceof HTMLSelectElement)) {
      throw new Error("pipeline-node-managed-project-select not found");
    }

    fireEvent.change(inspectorManagedProjectSelect, {
      target: { value: "12" },
    });
    expect(
      await screen.findByText("team/worker-service / D:/repos/worker-service")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`pipeline-stage-node-card-${draftStageKey}`));
    const stageNameInput = document.getElementById("pipeline-stage-name-input");
    if (!(stageNameInput instanceof HTMLInputElement)) {
      throw new Error("pipeline-stage-name-input not found");
    }
    fireEvent.change(stageNameInput, {
      target: { value: "release-stage" },
    });

    activateEditorTab("基础信息");
    const pipelineNameInput = document.getElementById("pipeline-name-input");
    if (!(pipelineNameInput instanceof HTMLInputElement)) {
      throw new Error("pipeline-name-input not found");
    }
    fireEvent.change(pipelineNameInput, {
      target: { value: "switch-project-authoring-flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "create_pipeline_definition",
        expect.objectContaining({
          name: "switch-project-authoring-flow",
        })
      );
    });

    expect(await screen.findByText("switch-project-authoring-flow")).toBeInTheDocument();
    expectNoProjectGroupFetch();
  });
});
