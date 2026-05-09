import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetPipelineDraftCountersForTest } from "@/components/pipeline-editor/draft-model";
import { WorkflowsPage } from "@/pages/WorkflowsPage";

const invokeMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");

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

const projectGroups = [
  {
    id: 7,
    name: "release-train",
    createdAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
    projectsCount: 2,
  },
];

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
    createdAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
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
    createdAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
  },
];

function getCreateTrigger() {
  return screen.getByRole("button", { name: "新建流水线" });
}

function getCreateSubmit() {
  return screen.getByRole("button", { name: /^创建$/ });
}

function getSaveButton() {
  return screen.getByRole("button", { name: "保存" });
}

function getPipelineNameInput() {
  const input = document.getElementById("pipeline-name-input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("pipeline-name-input not found");
  }
  return input;
}

function activateEditorTab(name: string) {
  act(() => {
    fireEvent.mouseDown(screen.getByRole("tab", { name }), {
      button: 0,
      ctrlKey: false,
    });
  });
}

/*

async function addNodeToSelectedStage(expectedCount: number) {
  fireEvent.click(screen.getByTestId("pipeline-graph-add-node-button"));
  await waitFor(() => {
    expect(screen.getAllByTestId(/graph-node-checkout_branch_node-/)).toHaveLength(
      expectedCount
    );
  });
}

*/

/*

async function addNodeToSelectedStage(expectedCount: number) {
  fireEvent.click(screen.getByRole("button", { name: "在所选阶段添加节点" }));
  await waitFor(() => {
    expect(screen.getAllByTestId(/graph-node-checkout_branch_node-/)).toHaveLength(
      expectedCount
    );
  });
}

*/

async function clickAddNode(expectedCount: number) {
  if (expectedCount === 1) {
    const startAnchorTriggers = await screen.findAllByTestId(
      /pipeline-stage-start-anchor-trigger-/
    );
    fireEvent.click(startAnchorTriggers[0]!);
  } else {
    const nodeOutputAnchors = await screen.findAllByTestId(/pipeline-node-output-anchor-/);
    fireEvent.click(nodeOutputAnchors[nodeOutputAnchors.length - 1]!);
  }
  const createNodeTypeSelect = document.getElementById("pipeline-create-node-type-select");
  if (!(createNodeTypeSelect instanceof HTMLSelectElement)) {
    throw new Error("pipeline-create-node-type-select not found");
  }
  const createNodeDialog = createNodeTypeSelect.closest('[role="dialog"]');
  if (!(createNodeDialog instanceof HTMLElement)) {
    throw new Error("create-node dialog not found");
  }
  fireEvent.change(createNodeTypeSelect, {
    target: { value: "checkout_branch" },
  });
  fireEvent.click(within(createNodeDialog).getByRole("button", { name: "创建节点" }));
  await waitFor(() => {
    expect(screen.getAllByTestId(/graph-node-checkout_branch_node-/)).toHaveLength(
      expectedCount
    );
  });
}

describe("pipeline definition editor", () => {
  beforeEach(() => {
    resetPipelineDraftCountersForTest();
    invokeMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_workflow_definitions") return [];
      if (cmd === "list_pipeline_definitions") {
        return [
          {
            id: 201,
            name: "legacy-release-pipeline",
            description: "migrated legacy workflow",
            enabled: true,
            maxConcurrencyDefault: 2,
            legacyWorkflowDefinitionId: 91,
            createdAt: "2026-04-14T00:00:00Z",
            updatedAt: "2026-04-14T00:00:00Z",
            variablesCount: 1,
            nodesCount: 2,
            schedulesCount: 1,
          },
        ];
      }
      if (cmd === "list_project_groups") return projectGroups;
      if (cmd === "list_managed_projects") return managedProjects;
      if (cmd === "get_pipeline_definition_detail") {
        return {
          id: 201,
          name: "legacy-release-pipeline",
          description: "migrated legacy workflow",
          enabled: true,
          maxConcurrencyDefault: 2,
          legacyWorkflowDefinitionId: 91,
          createdAt: "2026-04-14T00:00:00Z",
          updatedAt: "2026-04-14T00:00:00Z",
          variables: [
            {
              variableOrder: 0,
              key: "source_branch",
              label: "Source Branch",
              defaultValue: "release/1.2",
              valueType: "string",
              required: true,
              options: [],
            },
          ],
          stages: [
            {
              id: 1,
              stageKey: "prepare",
              name: "准备",
              stageOrder: 0,
              enabled: true,
            },
          ],
          nodes: [
            {
              nodeOrder: 0,
              nodeType: "switch_project",
              parameters: { managedProjectId: "11" },
              stageKey: "prepare",
              nodeKey: "switch_project_prepare",
              positionX: 96,
              positionY: 72,
              enabled: true,
            },
          ],
          edges: [],
          schedules: [],
        };
      }
      if (cmd === "create_pipeline_definition") {
        return {
          id: 101,
          name: String(args?.name ?? ""),
          description: String(args?.description ?? ""),
          enabled: Boolean(args?.enabled),
          maxConcurrencyDefault: Number(args?.maxConcurrencyDefault ?? 1),
          legacyWorkflowDefinitionId: null,
          createdAt: "2026-04-14T00:00:00Z",
          updatedAt: "2026-04-14T00:00:00Z",
          variables: args?.variables ?? [],
          stages: args?.stages ?? [],
          nodes: args?.nodes ?? [],
          edges: args?.edges ?? [],
          schedules: args?.schedules ?? [],
        };
      }
      if (cmd === "execute_pipeline_run") {
        return {
          pipelineRunId: 301,
        };
      }
      return undefined;
    });
  });

  it("shows the graph editor and persists stage-aware payloads", async () => {
  render(<WorkflowsPage />);

  expect(await screen.findByText("legacy-release-pipeline")).toBeInTheDocument();
  expect(screen.getByText("迁移自工作流 #91")).toBeInTheDocument();

  fireEvent.click(getCreateTrigger());

  expect(screen.getByText("基础信息")).toBeInTheDocument();
  expect(screen.getByText("变量")).toBeInTheDocument();
  expect(screen.getByText("流程图")).toBeInTheDocument();
  expect(screen.getByText("调度")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加阶段" })).toBeInTheDocument();

	  await clickAddNode(1);
	  await clickAddNode(2);
	  const actionNodes = screen.getAllByTestId(/graph-node-checkout_branch_node-/);
	  const firstNode = actionNodes[0];
	  const secondNodeKey =
	    actionNodes[actionNodes.length - 1]
	      ?.getAttribute("data-testid")
	      ?.replace("graph-node-", "") ?? "";
  fireEvent.click(
    within(actionNodes[actionNodes.length - 1]!).getByRole("button")
  );
  fireEvent.change(screen.getByLabelText("节点类型"), {
    target: { value: "git_pull" },
  });
  fireEvent.change(screen.getByLabelText("分支"), {
    target: { value: "${target_branch}" },
  });

	  await waitFor(() => {
	    expect(screen.getByTestId("mock-react-flow-edge-count")).toHaveTextContent("1");
	  });

  activateEditorTab("调度");
  fireEvent.click(screen.getByRole("button", { name: "添加调度" }));
  const scheduleRows = await screen.findAllByTestId("pipeline-schedule-row");
  expect(scheduleRows).toHaveLength(1);

  activateEditorTab("基础信息");
  fireEvent.change(getPipelineNameInput(), {
    target: { value: "release-pipeline" },
  });
  fireEvent.click(getSaveButton());

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith(
      "create_pipeline_definition",
      expect.objectContaining({
        name: "release-pipeline",
        maxConcurrencyDefault: 2,
        variables: [
          {
            key: "source_branch",
            label: "Source Branch",
            defaultValue: "",
            valueType: "string",
            required: true,
            options: [],
          },
          {
            key: "target_branch",
            label: "Target Branch",
            defaultValue: "",
            valueType: "string",
            required: true,
            options: [],
          },
        ],
        stages: [
          expect.objectContaining({
            name: "阶段 1",
            enabled: true,
          }),
        ],
        nodes: expect.arrayContaining([
          expect.objectContaining({
            nodeType: "checkout_branch",
            positionX: expect.any(Number),
            positionY: expect.any(Number),
            enabled: true,
            parameters: { branch: "${source_branch}" },
          }),
          expect.objectContaining({
            nodeType: "git_pull",
            positionX: expect.any(Number),
            positionY: expect.any(Number),
            enabled: true,
            parameters: { branch: "${target_branch}" },
          }),
        ]),
        edges: [expect.any(Object)],
        schedules: [
          {
            cronExpr: "0 9 * * 1-5",
            timezone: "Asia/Shanghai",
            branch: null,
            enabled: true,
            policy: "skip_if_running",
            variables: {},
          },
        ],
      })
    );

    const createCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "create_pipeline_definition"
    );
    const payload = createCall?.[1] as
      | {
          stages?: Array<{
            stageKey: string;
          }>;
          nodes?: Array<{
            stageKey: string;
            positionX: number;
            positionY: number;
          }>;
        }
      | undefined;
    const stageKey = payload?.stages?.[0]?.stageKey ?? "";
    const stageOneNodes = (payload?.nodes ?? []).filter((node) => node.stageKey === stageKey);
    expect(stageOneNodes).toHaveLength(2);
    expect(stageOneNodes.every((node) => Number.isFinite(node.positionX))).toBe(true);
    expect(stageOneNodes.every((node) => Number.isFinite(node.positionY))).toBe(true);
    expect(
      new Set(stageOneNodes.map((node) => `${node.positionX}:${node.positionY}`)).size
    ).toBe(stageOneNodes.length);
  });
}, 15000);

  it("blocks create saves until the draft is valid and then allows saving", async () => {
  render(<WorkflowsPage />);

  fireEvent.click(getCreateTrigger());
  activateEditorTab("基础信息");

  const saveButton = getSaveButton();
  fireEvent.click(saveButton);
  expect(screen.getByText("请先填写流水线名称。")).toBeInTheDocument();

  fireEvent.change(getPipelineNameInput(), {
    target: { value: "release-pipeline" },
  });

  activateEditorTab("画布");
  await clickAddNode(1);

  fireEvent.click(saveButton);
  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith(
      "create_pipeline_definition",
      expect.objectContaining({
        name: "release-pipeline",
      })
    );
  });
});

  it("shows managed project names for switch_project nodes and persists the selection", async () => {
  render(<WorkflowsPage />);

  fireEvent.click(getCreateTrigger());
  await clickAddNode(1);
  fireEvent.change(screen.getByLabelText("节点类型"), {
    target: { value: "switch_project" },
  });

  await waitFor(() => {
    expect(screen.getByRole("option", { name: "web-service" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "worker-service" })).toBeInTheDocument();
  });

  const projectSelect = screen.getByLabelText("项目");
  fireEvent.change(projectSelect, { target: { value: "11" } });
  expect(screen.getByText("team/web-service / D:/repos/web-service")).toBeInTheDocument();

  activateEditorTab("基础信息");
  fireEvent.change(getPipelineNameInput(), {
    target: { value: "cross-project-release" },
  });
  fireEvent.click(getSaveButton());

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith(
      "create_pipeline_definition",
      expect.objectContaining({
        name: "cross-project-release",
        nodes: expect.arrayContaining([
          expect.objectContaining({
            nodeType: "switch_project",
            positionX: 96,
            positionY: 72,
            enabled: true,
            parameters: { managedProjectId: "11" },
          }),
        ]),
      })
    );
  });
});

  it("rejects save when a referenced variable has been deleted from the form", async () => {
  render(<WorkflowsPage />);

  fireEvent.click(getCreateTrigger());
  activateEditorTab("基础信息");
  fireEvent.change(getPipelineNameInput(), {
    target: { value: "release-pipeline" },
  });

  activateEditorTab("画布");
  await clickAddNode(1);
  activateEditorTab("变量");
  const firstRow = await screen.findByTestId("pipeline-variable-row");
  fireEvent.click(within(firstRow).getByRole("button", { name: /source_branch/i }));

  const saveButton = getSaveButton();
  fireEvent.click(saveButton);
  expect(screen.getByText(/source_branch/)).toBeInTheDocument();
  expect(invokeMock).not.toHaveBeenCalledWith(
    "create_pipeline_definition",
    expect.anything()
  );
});

  it("launches a pipeline run without asking for a project group", async () => {
    render(<WorkflowsPage />);

    expect(await screen.findByText("legacy-release-pipeline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "立即运行" }));

    const variableInput = await screen.findByLabelText("运行参数 Source Branch");
    expect(variableInput).toHaveValue("release/1.2");

    fireEvent.change(variableInput, {
      target: { value: "release/1.3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始运行" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_pipeline_run", {
        request: {
          pipelineDefinitionId: 201,
          runParameters: {
            source_branch: "release/1.3",
          },
          maxConcurrencyOverride: null,
        },
      });
    });
  });
});
