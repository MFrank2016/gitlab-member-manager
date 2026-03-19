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

describe("workflow definition variable editor", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_workflow_definitions") return [];
      if (cmd === "create_workflow_definition") {
        return {
          id: 101,
          name: String(args?.name ?? ""),
          description: String(args?.description ?? ""),
          enabled: Boolean(args?.enabled),
          variablesSchema: args?.variables_schema ?? {},
          maxConcurrencyDefault: Number(args?.max_concurrency_default ?? 1),
          createdAt: "2026-03-19T00:00:00Z",
          updatedAt: "2026-03-19T00:00:00Z",
          steps: [],
        };
      }
      return undefined;
    });
  });

  it("auto-adds referenced variables and persists them as default-value pairs", async () => {
    render(<WorkflowsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "新建工作流" }));

    expect(screen.getByRole("option", { name: /当前分支/ })).toBeInTheDocument();

    const variableRows = await screen.findAllByTestId("workflow-variable-row");
    expect(variableRows).toHaveLength(1);
    expect(within(variableRows[0]).getByDisplayValue("source_branch")).toBeInTheDocument();
    expect(within(variableRows[0]).getByPlaceholderText("默认值")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /添加步骤/i }));
    await waitFor(() => {
      expect(screen.getAllByTestId("workflow-variable-row")).toHaveLength(2);
    });

    fireEvent.change(screen.getByPlaceholderText("工作流名称"), {
      target: { value: "release-flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "create_workflow_definition",
        expect.objectContaining({
          name: "release-flow",
          variables_schema: {
            source_branch: "",
            target_branch: "",
          },
        })
      );
    });
  });

  it("rejects save when a referenced variable has been deleted from the form", async () => {
    render(<WorkflowsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "新建工作流" }));

    fireEvent.change(screen.getByPlaceholderText("工作流名称"), {
      target: { value: "release-flow" },
    });

    const firstRow = await screen.findByTestId("workflow-variable-row");
    fireEvent.click(within(firstRow).getByRole("button", { name: /删除变量 source_branch/i }));

    fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("source_branch"));
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "create_workflow_definition",
      expect.anything()
    );
  });
});

