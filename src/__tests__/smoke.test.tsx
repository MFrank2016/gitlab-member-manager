import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { ProjectGroupsPage } from "@/pages/ProjectGroupsPage";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("navigation smoke", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_gitlab_config") return null;
      if (cmd === "list_project_groups") return [];
      if (cmd === "list_managed_projects") return [];
      if (cmd === "list_project_group_projects") return [];
      return undefined;
    });
  });

  it("renders managed project navigation entries", async () => {
    render(<App />);

    expect(await screen.findByTitle("Managed Projects")).toBeInTheDocument();
    expect(screen.getByTitle("Project Groups")).toBeInTheDocument();
  });
});

describe("project group interactions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("assigns selected managed projects into the active group", async () => {
    const groups = [
      {
        id: 1,
        name: "release-train",
        createdAt: "2026-03-18T00:00:00Z",
        updatedAt: "2026-03-18T00:00:00Z",
        projectsCount: 0,
      },
    ];
    const managedProjects = [
      {
        id: 10,
        gitlabProjectId: 10001,
        name: "project-one",
        pathWithNamespace: "team/project-one",
        repoPath: "D:/repos/project-one",
        defaultBranch: "main",
        defaultRemote: "origin",
        enabled: true,
        createdAt: "2026-03-18T00:00:00Z",
        updatedAt: "2026-03-18T00:00:00Z",
      },
    ];
    const groupProjectMap = new Map<number, typeof managedProjects>([
      [1, []],
    ]);

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_project_groups") {
        return groups.map((group) => ({
          ...group,
          projectsCount: groupProjectMap.get(group.id)?.length ?? 0,
        }));
      }
      if (cmd === "list_managed_projects") return managedProjects;
      if (cmd === "list_project_group_projects") {
        const groupId = Number(args?.project_group_id ?? 0);
        return groupProjectMap.get(groupId) ?? [];
      }
      if (cmd === "add_projects_to_group") {
        const groupId = Number(args?.project_group_id ?? 0);
        const ids = (args?.managed_project_ids as number[]) ?? [];
        const current = groupProjectMap.get(groupId) ?? [];
        const next = [...current];
        for (const id of ids) {
          const project = managedProjects.find((item) => item.id === id);
          if (project && !next.some((item) => item.id === id)) {
            next.push(project);
          }
        }
        groupProjectMap.set(groupId, next);
        return undefined;
      }
      return undefined;
    });

    render(<ProjectGroupsPage />);

    expect(await screen.findByText("Add Managed Projects")).toBeInTheDocument();
    const checkboxes = await screen.findAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    fireEvent.click(screen.getByRole("button", { name: /add selected/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "add_projects_to_group",
        expect.objectContaining({
          project_group_id: 1,
          managed_project_ids: [10],
        })
      );
    });

    expect(await screen.findByText("(already added)")).toBeInTheDocument();
  });
});
