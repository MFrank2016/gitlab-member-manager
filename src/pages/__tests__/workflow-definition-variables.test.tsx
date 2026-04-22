import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function getPipelineNameInput() {
  const input = document.getElementById("pipeline-name-input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("pipeline-name-input not found");
  }
  return input;
}

describe("pipeline definition editor", () => {
  beforeEach(() => {
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
          nodes: [
            {
              nodeOrder: 0,
              nodeType: "switch_project",
              parameters: { managedProjectId: "11" },
            },
          ],
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
          nodes: args?.nodes ?? [],
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

  it("shows pipeline sections and persists schedule-aware pipeline payloads", async () => {
    render(<WorkflowsPage />);

    expect(await screen.findByText("legacy-release-pipeline")).toBeInTheDocument();
    expect(screen.getByText("迁移自工作流 #91")).toBeInTheDocument();

    fireEvent.click(await getCreateTrigger());

    expect(screen.getByText("基础信息")).toBeInTheDocument();
    expect(screen.getByText("变量")).toBeInTheDocument();
    expect(screen.getByText("节点")).toBeInTheDocument();
    expect(screen.getByText("调度")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加调度/i })).toBeInTheDocument();

    const variableRows = await screen.findAllByTestId("pipeline-variable-row");
    expect(variableRows).toHaveLength(1);
    expect(within(variableRows[0]).getByDisplayValue("source_branch")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /添加节点/i }));
    await waitFor(() => {
      expect(screen.getAllByTestId("pipeline-variable-row")).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: /添加调度/i }));
    const scheduleRows = await screen.findAllByTestId("pipeline-schedule-row");
    expect(scheduleRows).toHaveLength(1);

    fireEvent.change(getPipelineNameInput(), {
      target: { value: "release-pipeline" },
    });
    fireEvent.click(getCreateSubmit());

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
          nodes: [
            {
              nodeType: "checkout_branch",
              parameters: { branch: "${source_branch}" },
            },
            {
              nodeType: "git_pull",
              parameters: { branch: "${target_branch}" },
            },
          ],
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
    });
  }, 15000);

  it("keeps create disabled until the draft is valid and shows a readiness summary", async () => {
    render(<WorkflowsPage />);

    fireEvent.click(await getCreateTrigger());

    const createButton = getCreateSubmit();
    expect(createButton).toBeDisabled();
    expect(screen.getByText("请先填写流水线名称。")).toBeInTheDocument();

    fireEvent.change(getPipelineNameInput(), {
      target: { value: "release-pipeline" },
    });

    await waitFor(() => {
      expect(createButton).not.toBeDisabled();
    });

    expect(screen.getByText("已就绪：1 个变量，1 个节点，0 个调度。")).toBeInTheDocument();
  });

  it("shows managed project names for switch_project nodes and persists the selection", async () => {
    render(<WorkflowsPage />);

    fireEvent.click(await getCreateTrigger());
    fireEvent.click(screen.getByRole("button", { name: /添加节点/i }));

    fireEvent.change(screen.getByLabelText("节点 2 类型"), {
      target: { value: "switch_project" },
    });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "web-service" })).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "worker-service" })
      ).toBeInTheDocument();
    });

    const projectSelect = screen.getByLabelText("节点 2 项目");
    fireEvent.change(projectSelect, { target: { value: "11" } });
    expect(screen.getByText("team/web-service · D:/repos/web-service")).toBeInTheDocument();

    fireEvent.change(getPipelineNameInput(), {
      target: { value: "cross-project-release" },
    });
    fireEvent.click(getCreateSubmit());

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "create_pipeline_definition",
        expect.objectContaining({
          name: "cross-project-release",
          nodes: [
            {
              nodeType: "checkout_branch",
              parameters: { branch: "${source_branch}" },
            },
            {
              nodeType: "switch_project",
              parameters: { managedProjectId: "11" },
            },
          ],
        })
      );
    });
  });

  it("rejects save when a referenced variable has been deleted from the form", async () => {
    render(<WorkflowsPage />);

    fireEvent.click(await getCreateTrigger());
    fireEvent.change(getPipelineNameInput(), {
      target: { value: "release-pipeline" },
    });

    const firstRow = await screen.findByTestId("pipeline-variable-row");
    fireEvent.click(within(firstRow).getByRole("button", { name: /source_branch/i }));

    const createButton = getCreateSubmit();
    await waitFor(() => {
      expect(createButton).toBeDisabled();
    });
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
