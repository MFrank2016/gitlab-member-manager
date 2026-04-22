import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedProjectsPage } from "@/pages/ManagedProjectsPage";

const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

describe("managed project onboarding", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
    openMock.mockResolvedValue("D:/repos/custom-api-service");

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_gitlab_config") {
        return {
          baseUrl: "https://gitlab.example.com",
          token: "glpat-123",
          localRepoRoot: "D:/repos",
          defaultBranch: "master",
          defaultRemote: "origin",
        };
      }
      if (cmd === "list_managed_projects") return [];
      if (cmd === "search_projects") {
        if (String(args?.keyword ?? "").includes("api")) {
          return [[
            {
              id: 42,
              name: "api-service",
              namespace: "team",
              pathWithNamespace: "team/api-service",
              description: "API service",
              lastActivityAt: "2026-03-18T00:00:00Z",
            },
          ], 1];
        }
        return [[], 0];
      }
      if (cmd === "create_managed_project") {
        return {
          id: 99,
          gitlabProjectId: Number(args?.gitlabProjectId ?? 0),
          name: String(args?.name ?? ""),
          pathWithNamespace: String(args?.pathWithNamespace ?? ""),
          repoPath: String(args?.repoPath ?? ""),
          defaultBranch: String(args?.defaultBranch ?? ""),
          defaultRemote: String(args?.defaultRemote ?? ""),
          enabled: Boolean(args?.enabled),
          createdAt: "2026-03-18T00:00:00Z",
          updatedAt: "2026-03-18T00:00:00Z",
        };
      }
      return undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefills from a GitLab project selection and lets the repo path be chosen from the directory picker", async () => {
    render(<ManagedProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: "新建托管项目" }));
    await waitFor(() => {
      expect(screen.getByLabelText("默认分支")).toHaveValue("master");
      expect(screen.getByLabelText("默认远程")).toHaveValue("origin");
    });

    fireEvent.change(screen.getByPlaceholderText("搜索 GitLab 项目"), {
      target: { value: "api" },
    });

    const selectedProject = await screen.findByText(/api-service/);
    fireEvent.click(selectedProject.closest("button") ?? selectedProject);

    expect(screen.getByLabelText("GitLab 项目 ID")).toHaveValue(42);
    expect(screen.getByLabelText("名称")).toHaveValue("api-service");
    expect(screen.getByLabelText("命名空间路径")).toHaveValue("team/api-service");
    expect(screen.getByLabelText("本地仓库路径")).toHaveValue("D:/repos/api-service");

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: true,
        multiple: false,
      })
    );
    expect(screen.getByLabelText("本地仓库路径")).toHaveValue("D:/repos/custom-api-service");

    fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "create_managed_project",
        expect.objectContaining({
          gitlabProjectId: 42,
          name: "api-service",
          pathWithNamespace: "team/api-service",
          repoPath: "D:/repos/custom-api-service",
          defaultBranch: "master",
          defaultRemote: "origin",
          enabled: true,
        })
      );
    });
  }, 15000);
});
