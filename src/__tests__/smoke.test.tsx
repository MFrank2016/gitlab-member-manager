import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { ProjectGroupsPage } from "@/pages/ProjectGroupsPage";
import { WorkflowRunsPage } from "@/pages/WorkflowRunsPage";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
let runtimeWarnings: string[] = [];

beforeEach(() => {
  runtimeWarnings = [];
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

describe("navigation smoke", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_gitlab_config") return null;
      if (cmd === "list_project_groups") return [];
      if (cmd === "list_managed_projects") return [];
      if (cmd === "list_project_group_projects") return [];
      if (cmd === "list_workflow_definitions") return [];
      return undefined;
    });
  });

  it("renders managed project navigation entries", async () => {
    render(<App />);

    expect(await screen.findByTitle("Managed Projects")).toBeInTheDocument();
    expect(screen.getByTitle("Project Groups")).toBeInTheDocument();
    expect(screen.getByTitle("Workflows")).toBeInTheDocument();
    expect(screen.getByTitle("Workflow Runs")).toBeInTheDocument();
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
    const managedRow = screen.getByText("project-one").closest("tr");
    if (!managedRow) {
      throw new Error("Could not find managed project row for project-one");
    }
    fireEvent.click(within(managedRow).getByRole("checkbox"));

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

describe("workflow interactions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("creates workflow definitions with editable and ordered steps", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_gitlab_config") return null;
      if (cmd === "list_workflow_definitions") return [];
      if (cmd === "create_workflow_definition") {
        const steps = (args?.steps as Array<{ stepType: string; parameters: unknown }>) ?? [];
        return {
          id: 11,
          name: String(args?.name ?? ""),
          description: String(args?.description ?? ""),
          enabled: Boolean(args?.enabled),
          variablesSchema: args?.variables_schema ?? {},
          maxConcurrencyDefault: Number(args?.max_concurrency_default ?? 1),
          createdAt: "2026-03-18T00:00:00Z",
          updatedAt: "2026-03-18T00:00:00Z",
          steps: steps.map((step, index) => ({
            stepOrder: index,
            stepType: step.stepType,
            parameters: step.parameters ?? {},
          })),
        };
      }
      return undefined;
    });

    render(<App />);

    fireEvent.click(await screen.findByTitle("Workflows"));
    expect(await screen.findByText("Workflow Definitions")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /new workflow/i }));
    fireEvent.change(screen.getByPlaceholderText("workflow name"), {
      target: { value: "release-flow" },
    });

    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    fireEvent.change(screen.getByLabelText("Step 2 Type"), {
      target: { value: "git_push" },
    });
    fireEvent.change(screen.getByLabelText("Step 2 Remote"), {
      target: { value: "upstream" },
    });
    fireEvent.click(screen.getByLabelText("Move step 2 up"));

    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "create_workflow_definition",
        expect.objectContaining({
          name: "release-flow",
          steps: [
            {
              stepType: "git_push",
              parameters: { remote: "upstream" },
            },
            {
              stepType: "checkout_branch",
              parameters: { branch: "${source_branch}" },
            },
          ],
        })
      );
    });
  });
});

describe("workflow run monitoring interactions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads run details and supports cancel/retry-failed actions", async () => {
    const runList = [
      {
        id: 301,
        workflowDefinitionId: 91,
        workflowDefinitionName: "release-flow",
        projectGroupId: 5,
        projectGroupName: "release-train",
        sourceWorkflowRunId: null,
        triggerKind: "manual",
        status: "running",
        runParameters: { source_branch: "main", target_branch: "release/1.2" },
        maxConcurrency: 2,
        projectsTotal: 2,
        projectsQueued: 0,
        projectsRunning: 0,
        projectsSuccess: 1,
        projectsFailed: 1,
        projectsCancelled: 0,
        projectsFailedPrecheck: 0,
        startedAt: "2026-03-18T00:00:00Z",
        finishedAt: "2026-03-18T00:08:00Z",
        createdAt: "2026-03-18T00:00:00Z",
        updatedAt: "2026-03-18T00:08:00Z",
      },
    ];

    const runDetail = {
      ...runList[0],
      projects: [
        {
          id: 901,
          managedProjectId: 501,
          gitlabProjectId: 1001,
          projectName: "api-service",
          projectPathWithNamespace: "platform/api-service",
          repoPath: "D:/repos/api-service",
          status: "success",
          summaryMessage: "all steps completed",
          startedAt: "2026-03-18T00:00:10Z",
          finishedAt: "2026-03-18T00:03:20Z",
          steps: [
            {
              id: 1,
              workflowStepId: 1,
              stepOrder: 0,
              stepType: "checkout_branch",
              renderedParameters: { branch: "main" },
              status: "success",
              startedAt: "2026-03-18T00:00:10Z",
              finishedAt: "2026-03-18T00:00:30Z",
              stdout: "checked out",
              stderr: "",
              exitCode: 0,
              summaryMessage: "ok",
            },
          ],
        },
        {
          id: 902,
          managedProjectId: 502,
          gitlabProjectId: 1002,
          projectName: "web-service",
          projectPathWithNamespace: "platform/web-service",
          repoPath: "D:/repos/web-service",
          status: "failed",
          summaryMessage: "git_merge failed",
          startedAt: "2026-03-18T00:03:30Z",
          finishedAt: "2026-03-18T00:08:00Z",
          steps: [
            {
              id: 2,
              workflowStepId: 1,
              stepOrder: 0,
              stepType: "checkout_branch",
              renderedParameters: { branch: "main" },
              status: "success",
              startedAt: "2026-03-18T00:03:30Z",
              finishedAt: "2026-03-18T00:04:00Z",
              stdout: "checked out",
              stderr: "",
              exitCode: 0,
              summaryMessage: "ok",
            },
            {
              id: 3,
              workflowStepId: 2,
              stepOrder: 1,
              stepType: "git_merge",
              renderedParameters: { from: "release/1.2" },
              status: "failed",
              startedAt: "2026-03-18T00:04:00Z",
              finishedAt: "2026-03-18T00:08:00Z",
              stdout: "",
              stderr: "conflict on README.md",
              exitCode: 1,
              summaryMessage: "merge conflict",
            },
          ],
        },
      ],
    };

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_gitlab_config") return null;
      if (cmd === "list_workflow_runs") return runList;
      if (cmd === "get_workflow_run_detail") {
        const id = Number(args?.id ?? 0);
        return id === 301 ? runDetail : undefined;
      }
      if (cmd === "cancel_workflow_run") return undefined;
      if (cmd === "retry_failed_workflow_run") return { workflowRunId: 999 };
      return undefined;
    });

    render(<App />);

    fireEvent.click(await screen.findByTitle("Workflow Runs"));

    expect(await screen.findByRole("heading", { name: "Workflow Runs" })).toBeInTheDocument();
    expect((await screen.findAllByText("release-flow")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Run #301/)).toBeInTheDocument();
    expect(screen.getAllByText("release-train").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Project web-service" }));
    expect(await screen.findByText("Step 2 - git_merge")).toBeInTheDocument();
    expect(screen.getByText("conflict on README.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel run/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("cancel_workflow_run", { workflow_run_id: 301 });
    });

    fireEvent.click(screen.getByRole("button", { name: /retry failed/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("retry_failed_workflow_run", {
        request: {
          sourceWorkflowRunId: 301,
          selectedManagedProjectIds: [502],
          maxConcurrencyOverride: null,
        },
      });
    });
  });

  it("targets actions to the current selection while next detail is still loading", async () => {
    const runList = [
      {
        id: 301,
        workflowDefinitionId: 91,
        workflowDefinitionName: "release-flow",
        projectGroupId: 5,
        projectGroupName: "release-train",
        sourceWorkflowRunId: null,
        triggerKind: "manual",
        status: "running",
        runParameters: {},
        maxConcurrency: 2,
        projectsTotal: 1,
        projectsQueued: 0,
        projectsRunning: 1,
        projectsSuccess: 0,
        projectsFailed: 0,
        projectsCancelled: 0,
        projectsFailedPrecheck: 0,
        startedAt: "2026-03-18T00:00:00Z",
        finishedAt: null,
        createdAt: "2026-03-18T00:00:00Z",
        updatedAt: "2026-03-18T00:01:00Z",
      },
      {
        id: 302,
        workflowDefinitionId: 91,
        workflowDefinitionName: "release-flow",
        projectGroupId: 5,
        projectGroupName: "release-train",
        sourceWorkflowRunId: null,
        triggerKind: "manual",
        status: "running",
        runParameters: {},
        maxConcurrency: 2,
        projectsTotal: 1,
        projectsQueued: 0,
        projectsRunning: 1,
        projectsSuccess: 0,
        projectsFailed: 0,
        projectsCancelled: 0,
        projectsFailedPrecheck: 0,
        startedAt: "2026-03-18T00:10:00Z",
        finishedAt: null,
        createdAt: "2026-03-18T00:10:00Z",
        updatedAt: "2026-03-18T00:11:00Z",
      },
    ];

    const runDetail301 = {
      ...runList[0],
      projects: [
        {
          id: 901,
          managedProjectId: 501,
          gitlabProjectId: 1001,
          projectName: "api-service",
          projectPathWithNamespace: "platform/api-service",
          repoPath: "D:/repos/api-service",
          status: "failed",
          summaryMessage: "git merge failed",
          startedAt: "2026-03-18T00:00:10Z",
          finishedAt: "2026-03-18T00:01:00Z",
          steps: [],
        },
      ],
    };

    const runDetail302 = {
      ...runList[1],
      projects: [
        {
          id: 902,
          managedProjectId: 502,
          gitlabProjectId: 1002,
          projectName: "web-service",
          projectPathWithNamespace: "platform/web-service",
          repoPath: "D:/repos/web-service",
          status: "running",
          summaryMessage: "still running",
          startedAt: "2026-03-18T00:10:10Z",
          finishedAt: null,
          steps: [],
        },
      ],
    };

    let resolveRun302: ((value: typeof runDetail302) => void) | null = null;
    const run302DetailPromise = new Promise<typeof runDetail302>((resolve) => {
      resolveRun302 = resolve;
    });

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_workflow_runs") return runList;
      if (cmd === "get_workflow_run_detail") {
        const id = Number(args?.id ?? 0);
        if (id === 301) return runDetail301;
        if (id === 302) return run302DetailPromise;
      }
      if (cmd === "cancel_workflow_run") return undefined;
      return undefined;
    });

    render(<WorkflowRunsPage />);

    await screen.findByText("#301");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry failed/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByText("#302"));
    expect(screen.getByRole("button", { name: /retry failed/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /cancel run/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("cancel_workflow_run", { workflow_run_id: 302 });
    });

    resolveRun302?.(runDetail302);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry failed/i })).toBeDisabled();
    });
  });

  it("refreshes run detail when selected run id does not change", async () => {
    const runList = [
      {
        id: 301,
        workflowDefinitionId: 91,
        workflowDefinitionName: "release-flow",
        projectGroupId: 5,
        projectGroupName: "release-train",
        sourceWorkflowRunId: null,
        triggerKind: "manual",
        status: "running",
        runParameters: {},
        maxConcurrency: 2,
        projectsTotal: 1,
        projectsQueued: 0,
        projectsRunning: 0,
        projectsSuccess: 0,
        projectsFailed: 1,
        projectsCancelled: 0,
        projectsFailedPrecheck: 0,
        startedAt: "2026-03-18T00:00:00Z",
        finishedAt: null,
        createdAt: "2026-03-18T00:00:00Z",
        updatedAt: "2026-03-18T00:01:00Z",
      },
    ];

    const firstDetail = {
      ...runList[0],
      projects: [
        {
          id: 901,
          managedProjectId: 501,
          gitlabProjectId: 1001,
          projectName: "api-service",
          projectPathWithNamespace: "platform/api-service",
          repoPath: "D:/repos/api-service",
          status: "failed",
          summaryMessage: "merge failed",
          startedAt: "2026-03-18T00:00:10Z",
          finishedAt: "2026-03-18T00:01:00Z",
          steps: [],
        },
      ],
    };

    const secondDetail = {
      ...runList[0],
      projects: [
        {
          id: 901,
          managedProjectId: 501,
          gitlabProjectId: 1001,
          projectName: "api-service",
          projectPathWithNamespace: "platform/api-service",
          repoPath: "D:/repos/api-service",
          status: "success",
          summaryMessage: "ok",
          startedAt: "2026-03-18T00:00:10Z",
          finishedAt: "2026-03-18T00:01:00Z",
          steps: [],
        },
      ],
    };

    let detailCallCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_workflow_runs") return runList;
      if (cmd === "get_workflow_run_detail") {
        const id = Number(args?.id ?? 0);
        if (id !== 301) return undefined;
        detailCallCount += 1;
        return detailCallCount === 1 ? firstDetail : secondDetail;
      }
      return undefined;
    });

    render(<WorkflowRunsPage />);

    await screen.findByText("#301");
    await waitFor(() => {
      const retryButtons = screen.getAllByRole("button", { name: /retry failed/i });
      expect(retryButtons[retryButtons.length - 1]).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/i }));

    await waitFor(() => {
      expect(detailCallCount).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      const retryButtons = screen.getAllByRole("button", { name: /retry failed/i });
      expect(retryButtons[retryButtons.length - 1]).toBeDisabled();
    });
  });

  it("keeps newer user selection when refresh resolves late", async () => {
    const runList = [
      {
        id: 301,
        workflowDefinitionId: 91,
        workflowDefinitionName: "release-flow",
        projectGroupId: 5,
        projectGroupName: "release-train",
        sourceWorkflowRunId: null,
        triggerKind: "manual",
        status: "running",
        runParameters: {},
        maxConcurrency: 2,
        projectsTotal: 1,
        projectsQueued: 0,
        projectsRunning: 1,
        projectsSuccess: 0,
        projectsFailed: 0,
        projectsCancelled: 0,
        projectsFailedPrecheck: 0,
        startedAt: "2026-03-18T00:00:00Z",
        finishedAt: null,
        createdAt: "2026-03-18T00:00:00Z",
        updatedAt: "2026-03-18T00:01:00Z",
      },
      {
        id: 302,
        workflowDefinitionId: 91,
        workflowDefinitionName: "release-flow",
        projectGroupId: 5,
        projectGroupName: "release-train",
        sourceWorkflowRunId: null,
        triggerKind: "manual",
        status: "running",
        runParameters: {},
        maxConcurrency: 2,
        projectsTotal: 1,
        projectsQueued: 0,
        projectsRunning: 1,
        projectsSuccess: 0,
        projectsFailed: 0,
        projectsCancelled: 0,
        projectsFailedPrecheck: 0,
        startedAt: "2026-03-18T00:10:00Z",
        finishedAt: null,
        createdAt: "2026-03-18T00:10:00Z",
        updatedAt: "2026-03-18T00:11:00Z",
      },
    ];

    let listCallCount = 0;
    let resolveDelayedRefresh: ((value: typeof runList) => void) | null = null;
    const delayedRefreshPromise = new Promise<typeof runList>((resolve) => {
      resolveDelayedRefresh = resolve;
    });

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_workflow_runs") {
        listCallCount += 1;
        if (listCallCount === 2) {
          return delayedRefreshPromise;
        }
        return runList;
      }
      if (cmd === "get_workflow_run_detail") {
        const id = Number(args?.id ?? 0);
        const run = runList.find((item) => item.id === id);
        if (!run) return undefined;
        return { ...run, projects: [] };
      }
      return undefined;
    });

    render(<WorkflowRunsPage />);

    await screen.findByText("#301");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Run #301" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/i }));
    fireEvent.click(screen.getByText("#302"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Run #302" })).toBeInTheDocument();
    });

    resolveDelayedRefresh?.(runList);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Run #302" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "Run #301" })).not.toBeInTheDocument();
  });

  it("ignores stale in-flight detail responses after selection is cleared", async () => {
    const initialRunList = [
      {
        id: 301,
        workflowDefinitionId: 91,
        workflowDefinitionName: "release-flow",
        projectGroupId: 5,
        projectGroupName: "release-train",
        sourceWorkflowRunId: null,
        triggerKind: "manual",
        status: "running",
        runParameters: {},
        maxConcurrency: 2,
        projectsTotal: 1,
        projectsQueued: 0,
        projectsRunning: 1,
        projectsSuccess: 0,
        projectsFailed: 0,
        projectsCancelled: 0,
        projectsFailedPrecheck: 0,
        startedAt: "2026-03-18T00:00:00Z",
        finishedAt: null,
        createdAt: "2026-03-18T00:00:00Z",
        updatedAt: "2026-03-18T00:01:00Z",
      },
    ];

    const lateDetail = {
      ...initialRunList[0],
      projects: [
        {
          id: 999,
          managedProjectId: 999,
          gitlabProjectId: 999,
          projectName: "late-project",
          projectPathWithNamespace: "late/project",
          repoPath: "D:/repos/late-project",
          status: "running",
          summaryMessage: "late response",
          startedAt: "2026-03-18T00:00:10Z",
          finishedAt: null,
          steps: [],
        },
      ],
    };

    let currentRunList = initialRunList;
    let resolveDetail: ((value: typeof lateDetail) => void) | null = null;
    const delayedDetail = new Promise<typeof lateDetail>((resolve) => {
      resolveDetail = resolve;
    });

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_workflow_runs") return currentRunList;
      if (cmd === "get_workflow_run_detail") return delayedDetail;
      return undefined;
    });

    render(<WorkflowRunsPage />);

    await screen.findByText("#301");

    currentRunList = [];
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/i }));
    await screen.findByText("No workflow runs found.");

    resolveDetail?.(lateDetail);

    await waitFor(() => {
      expect(screen.getByText("Select a workflow run to inspect details.")).toBeInTheDocument();
    });
    expect(screen.queryByText("late-project")).not.toBeInTheDocument();
  });
});
