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
      if (cmd === "create_pipeline_definition") {
        return {
          id: 101,
          name: String(args?.name ?? ""),
          description: String(args?.description ?? ""),
          enabled: Boolean(args?.enabled),
          maxConcurrencyDefault: Number(args?.max_concurrency_default ?? 1),
          legacyWorkflowDefinitionId: null,
          createdAt: "2026-04-14T00:00:00Z",
          updatedAt: "2026-04-14T00:00:00Z",
          variables: args?.variables ?? [],
          nodes: args?.nodes ?? [],
          schedules: args?.schedules ?? [],
        };
      }
      return undefined;
    });
  });

  it("shows pipeline sections and persists schedule-aware pipeline payloads", async () => {
    render(<WorkflowsPage />);

    expect(await screen.findByText("legacy-release-pipeline")).toBeInTheDocument();
    expect(screen.getByText("迁移自工作流 #91")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "新建流水线" }));

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

    fireEvent.change(screen.getByLabelText("调度 1 目标项目组"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("流水线名称"), {
      target: { value: "release-pipeline" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "create_pipeline_definition",
        expect.objectContaining({
          name: "release-pipeline",
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
              projectGroupId: 7,
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

  it("rejects save when a referenced variable has been deleted from the form", async () => {
    render(<WorkflowsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "新建流水线" }));
    fireEvent.change(screen.getByLabelText("流水线名称"), {
      target: { value: "release-pipeline" },
    });

    const firstRow = await screen.findByTestId("pipeline-variable-row");
    fireEvent.click(within(firstRow).getByRole("button", { name: /删除变量 source_branch/i }));

    fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("source_branch"));
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "create_pipeline_definition",
      expect.anything()
    );
  });
});
