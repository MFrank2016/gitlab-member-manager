import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import {
  cancelPipelineRun,
  createPipelineDefinition,
  deletePipelineDefinition,
  executePipelineRun,
  getPipelineDefinitionDetail,
  getPipelineRunDetail,
  getPipelineRunNodeDiagnostics,
  listPipelineDefinitions,
  listPipelineRuns,
  listWorkflowDefinitions,
  readCommandErrorMessage,
  retryPipelineRun,
  updatePipelineDefinition,
} from "@/lib/invoke";
import { ProjectGroupsPage } from "@/pages/ProjectGroupsPage";
import { WorkflowsPagePipeline } from "@/pages/WorkflowsPagePipeline";
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

    expect(await screen.findByTitle("托管项目")).toBeInTheDocument();
    expect(screen.getByTitle("项目分组")).toBeInTheDocument();
    expect(screen.getByTitle("工作流定义")).toBeInTheDocument();
    expect(screen.getByTitle("工作流运行")).toBeInTheDocument();
  });
});

describe("pipeline command error helpers", () => {
  it("prefers structured Chinese command errors and falls back for unknown payloads", () => {
    expect(
      readCommandErrorMessage(
        {
          category: "validation_failed",
          messageZh: "加载流水线失败",
          detail: "missing required pipeline variable",
        },
        "默认失败提示"
      )
    ).toBe("加载流水线失败");

    expect(readCommandErrorMessage({ unexpected: true }, "默认失败提示")).toBe("默认失败提示");
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
        const groupId = Number(args?.projectGroupId ?? 0);
        return groupProjectMap.get(groupId) ?? [];
      }
      if (cmd === "add_projects_to_group") {
        const groupId = Number(args?.projectGroupId ?? 0);
        const ids = (args?.managedProjectIds as number[]) ?? [];
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

    expect(await screen.findByText("添加托管项目")).toBeInTheDocument();
    const managedRow = screen.getByText("project-one").closest("tr");
    if (!managedRow) {
      throw new Error("Could not find managed project row for project-one");
    }
    fireEvent.click(within(managedRow).getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: /添加所选/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "add_projects_to_group",
        expect.objectContaining({
          projectGroupId: 1,
          managedProjectIds: [10],
        })
      );
    });

    expect(await screen.findByText("（已加入）")).toBeInTheDocument();
  });
});

describe.skip("workflow interactions", () => {
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
          variablesSchema: args?.variablesSchema ?? {},
          maxConcurrencyDefault: Number(args?.maxConcurrencyDefault ?? 1),
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

    fireEvent.click(await screen.findByTitle("工作流定义"));
    expect(await screen.findByRole("heading", { name: "工作流定义" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /新建工作流/i }));
    fireEvent.change(screen.getByPlaceholderText("工作流名称"), {
      target: { value: "release-flow" },
    });

    fireEvent.click(screen.getByRole("button", { name: /添加步骤/i }));
    fireEvent.change(screen.getByLabelText("步骤 2 类型"), {
      target: { value: "git_push" },
    });
    fireEvent.change(screen.getByLabelText("步骤 2 远程"), {
      target: { value: "upstream" },
    });
    fireEvent.click(screen.getByLabelText("步骤 2 上移"));

    fireEvent.click(screen.getByRole("button", { name: /^创建$/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "create_workflow_definition",
        expect.objectContaining({
          name: "release-flow",
          variablesSchema: {
            source_branch: "",
            target_branch: "",
          },
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

describe("pipeline definition upgrade smoke", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("shows pipeline terminology, schedules, and migrated legacy definitions in the editor", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_gitlab_config") return null;
      if (cmd === "list_workflow_definitions") return [];
      if (cmd === "list_pipeline_definitions") {
        return [
          {
            id: 91,
            name: "legacy-release-pipeline",
            description: "migrated legacy workflow",
            enabled: true,
            maxConcurrencyDefault: 2,
            legacyWorkflowDefinitionId: 44,
            createdAt: "2026-03-18T00:00:00Z",
            updatedAt: "2026-03-18T00:00:00Z",
            variablesCount: 1,
            nodesCount: 1,
            schedulesCount: 1,
          },
        ];
      }
      if (cmd === "list_project_groups") {
        return [
          {
            id: 7,
            name: "release-train",
            createdAt: "2026-03-18T00:00:00Z",
            updatedAt: "2026-03-18T00:00:00Z",
            projectsCount: 2,
          },
        ];
      }
      if (cmd === "create_pipeline_definition") {
        return {
          id: 11,
          name: String(args?.name ?? ""),
          description: String(args?.description ?? ""),
          enabled: Boolean(args?.enabled),
          maxConcurrencyDefault: Number(args?.maxConcurrencyDefault ?? 1),
          legacyWorkflowDefinitionId: null,
          createdAt: "2026-03-18T00:00:00Z",
          updatedAt: "2026-03-18T00:00:00Z",
          variables: args?.variables ?? [],
          nodes: args?.nodes ?? [],
          schedules: args?.schedules ?? [],
        };
      }
      return undefined;
    });

    render(<App />);

    fireEvent.click(await screen.findByTitle("工作流定义"));

    expect(await screen.findByRole("heading", { name: "流水线定义" })).toBeInTheDocument();
    expect(screen.getByText("legacy-release-pipeline")).toBeInTheDocument();
    expect(screen.getByText("迁移自工作流 #44")).toBeInTheDocument();

    fireEvent.click(screen.getByText("新建流水线"));
    expect(screen.getByText("基础信息")).toBeInTheDocument();
    expect(screen.getByText("变量")).toBeInTheDocument();
    expect(screen.getByText("节点")).toBeInTheDocument();
    expect(screen.getByText("调度")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加调度/i })).toBeInTheDocument();
  });

  it("jumps to the pipeline run monitor after starting a run from the definition list", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_gitlab_config") return null;
      if (cmd === "list_workflow_definitions") return [];
      if (cmd === "list_pipeline_definitions") {
        return [
          {
            id: 201,
            name: "switch-project-pipeline",
            description: "manual run jump coverage",
            enabled: true,
            maxConcurrencyDefault: 2,
            legacyWorkflowDefinitionId: null,
            createdAt: "2026-04-22T00:00:00Z",
            updatedAt: "2026-04-22T00:00:00Z",
            variablesCount: 1,
            nodesCount: 1,
            schedulesCount: 0,
          },
        ];
      }
      if (cmd === "list_project_groups") return [];
      if (cmd === "list_managed_projects") {
        return [
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
        ];
      }
      if (cmd === "get_pipeline_definition_detail") {
        expect(args).toEqual({ id: 201 });
        return {
          id: 201,
          name: "switch-project-pipeline",
          description: "manual run jump coverage",
          enabled: true,
          maxConcurrencyDefault: 2,
          legacyWorkflowDefinitionId: null,
          createdAt: "2026-04-22T00:00:00Z",
          updatedAt: "2026-04-22T00:00:00Z",
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
      if (cmd === "execute_pipeline_run") {
        expect(args).toEqual({
          request: {
            pipelineDefinitionId: 201,
            runParameters: {
              source_branch: "release/1.3",
            },
            maxConcurrencyOverride: null,
          },
        });
        return { pipelineRunId: 451 };
      }
      if (cmd === "list_pipeline_runs") {
        return {
          items: [
            {
              id: 451,
              pipelineDefinitionId: 201,
              pipelineDefinitionName: "switch-project-pipeline",
              projectGroupId: null,
              projectGroupName: null,
              legacyWorkflowRunId: null,
              sourcePipelineRunId: null,
              triggerKind: "manual",
              status: "pending",
              runParameters: { source_branch: "release/1.3" },
              maxConcurrency: 2,
              projectsTotal: 1,
              projectsQueued: 1,
              projectsRunning: 0,
              projectsSuccess: 0,
              projectsFailed: 0,
              projectsCancelled: 0,
              projectsFailedPrecheck: 0,
              startedAt: null,
              finishedAt: null,
              createdAt: "2026-04-22T00:00:00Z",
              updatedAt: "2026-04-22T00:00:00Z",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          hasNextPage: false,
        };
      }
      if (cmd === "get_pipeline_run_detail") {
        expect(args).toEqual({ id: 451 });
        return {
          id: 451,
          pipelineDefinitionId: 201,
          pipelineDefinitionName: "switch-project-pipeline",
          projectGroupId: null,
          projectGroupName: null,
          legacyWorkflowRunId: null,
          sourcePipelineRunId: null,
          triggerKind: "manual",
          status: "pending",
          runParameters: { source_branch: "release/1.3" },
          maxConcurrency: 2,
          projectsTotal: 1,
          projectsQueued: 1,
          projectsRunning: 0,
          projectsSuccess: 0,
          projectsFailed: 0,
          projectsCancelled: 0,
          projectsFailedPrecheck: 0,
          startedAt: null,
          finishedAt: null,
          createdAt: "2026-04-22T00:00:00Z",
          updatedAt: "2026-04-22T00:00:00Z",
          projects: [
            {
              id: 5501,
              managedProjectId: 11,
              gitlabProjectId: 1011,
              projectName: "web-service",
              projectPathWithNamespace: "team/web-service",
              repoPath: "D:/repos/web-service",
              status: "queued",
              summaryMessage: "queued",
              startedAt: null,
              finishedAt: null,
              nodes: [],
            },
          ],
        };
      }
      return undefined;
    });

    render(<App />);

    fireEvent.click(await screen.findByTitle("工作流定义"));
    expect(await screen.findByRole("heading", { name: "流水线定义" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "立即运行" }));
    const variableInput = await screen.findByLabelText("运行参数 Source Branch");
    fireEvent.change(variableInput, {
      target: { value: "release/1.3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始运行" }));

    expect(await screen.findByRole("heading", { name: "流水线运行" })).toBeInTheDocument();
    expect(screen.getByText("项目组 ID（旧运行）")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "运行 #451" })).toBeInTheDocument();
    expect(await screen.findAllByText("按步骤切换项目")).toHaveLength(2);
  });
});

describe("pipeline schedule runtime feedback", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("renders schedule runtime feedback in the edit form", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_pipeline_definitions") {
        return [
          {
            id: 91,
            name: "release-pipeline",
            description: "runtime feedback coverage",
            enabled: true,
            maxConcurrencyDefault: 2,
            legacyWorkflowDefinitionId: null,
            createdAt: "2026-03-18T00:00:00Z",
            updatedAt: "2026-03-18T00:00:00Z",
            variablesCount: 1,
            nodesCount: 1,
            schedulesCount: 1,
          },
        ];
      }
      if (cmd === "list_project_groups") {
        return [
          {
            id: 7,
            name: "release-train",
            createdAt: "2026-03-18T00:00:00Z",
            updatedAt: "2026-03-18T00:00:00Z",
            projectsCount: 2,
          },
        ];
      }
      if (cmd === "list_managed_projects") return [];
      if (cmd === "get_pipeline_definition_detail") {
        expect(args).toEqual({ id: 91 });
        return {
          id: 91,
          name: "release-pipeline",
          description: "runtime feedback coverage",
          enabled: true,
          maxConcurrencyDefault: 2,
          legacyWorkflowDefinitionId: null,
          createdAt: "2026-03-18T00:00:00Z",
          updatedAt: "2026-03-18T00:00:00Z",
          variables: [],
          nodes: [
            {
              nodeOrder: 0,
              nodeType: "checkout_branch",
              parameters: { branch: "${source_branch}" },
            },
          ],
          schedules: [
            {
              id: 701,
              scheduleOrder: 0,
              projectGroupId: 7,
              cronExpr: "0 9 * * 1-5",
              timezone: "Asia/Shanghai",
              branch: "main",
              enabled: true,
              policy: "queue_after_running",
              variables: {},
            },
          ],
        };
      }
      if (cmd === "get_pipeline_schedule_runtime_snapshots") {
        expect(args).toEqual({ pipelineDefinitionId: 91 });
        return [
          {
            scheduleId: 701,
            queued: true,
            lastDecision: "queued",
            lastDecisionAt: "2026-04-17T08:00:00Z",
            lastDecisionMessageZh: "检测到同定义仍有活跃 run，本次触发已加入排队队列。",
            nextTriggerAt: "2026-04-18T09:00:00+08:00",
          },
        ];
      }
      return undefined;
    });

    render(<WorkflowsPagePipeline />);

    const row = await screen.findByText("release-pipeline");
    fireEvent.click(within(row.closest("tr") as HTMLElement).getByRole("button", { name: "编辑" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_pipeline_schedule_runtime_snapshots", {
        pipelineDefinitionId: 91,
      });
    });

    const scheduleRows = await screen.findAllByTestId("pipeline-schedule-row");
    expect(within(scheduleRows[0]).getByTestId("pipeline-schedule-runtime-feedback")).toBeInTheDocument();
    expect(within(scheduleRows[0]).getByText("检测到同定义仍有活跃 run，本次触发已加入排队队列。")).toBeInTheDocument();
    expect(within(scheduleRows[0]).getByText("2026-04-18T09:00:00+08:00")).toBeInTheDocument();
  });
});

describe("pipeline definition structured editor guardrails", () => {
  const projectGroup = {
    id: 7,
    name: "release-train",
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    projectsCount: 2,
  };

  beforeEach(() => {
    invokeMock.mockReset();
  });

  function setupPipelineEditorMocks(detail: {
    id: number;
    name: string;
    description: string;
    enabled: boolean;
    maxConcurrencyDefault: number;
    variables: Array<Record<string, unknown>>;
    nodes: Array<Record<string, unknown>>;
    schedules: Array<Record<string, unknown>>;
  }) {
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_pipeline_definitions") {
        return [
          {
            id: detail.id,
            name: detail.name,
            description: detail.description,
            enabled: detail.enabled,
            maxConcurrencyDefault: detail.maxConcurrencyDefault,
            legacyWorkflowDefinitionId: null,
            createdAt: "2026-03-18T00:00:00Z",
            updatedAt: "2026-03-18T00:00:00Z",
            variablesCount: detail.variables.length,
            nodesCount: detail.nodes.length,
            schedulesCount: detail.schedules.length,
          },
        ];
      }
      if (cmd === "list_project_groups") return [projectGroup];
      if (cmd === "list_managed_projects") return [];
      if (cmd === "get_pipeline_definition_detail") {
        expect(args).toEqual({ id: detail.id });
        return {
          id: detail.id,
          name: detail.name,
          description: detail.description,
          enabled: detail.enabled,
          maxConcurrencyDefault: detail.maxConcurrencyDefault,
          legacyWorkflowDefinitionId: null,
          createdAt: "2026-03-18T00:00:00Z",
          updatedAt: "2026-03-18T00:00:00Z",
          variables: detail.variables,
          nodes: detail.nodes,
          schedules: detail.schedules,
        };
      }
      if (cmd === "get_pipeline_schedule_runtime_snapshots") return [];
      if (cmd === "update_pipeline_definition") return undefined;
      return undefined;
    });
  }

  async function openEditDialog(name: string) {
    render(<WorkflowsPagePipeline />);

    const row = await screen.findByText(name);
    fireEvent.click(within(row.closest("tr") as HTMLElement).getByRole("button", { name: "编辑" }));

    await screen.findByRole("heading", { name: "编辑流水线定义" });
    return screen.getByRole("dialog");
  }

  it("supports structured editing for nested custom-node parameters", async () => {
    setupPipelineEditorMocks({
      id: 151,
      name: "custom-node-structured-editor",
      description: "structured editor red phase",
      enabled: true,
      maxConcurrencyDefault: 2,
      variables: [],
      nodes: [
        {
          nodeOrder: 0,
          nodeType: "custom_release_gate",
          parameters: {},
        },
      ],
      schedules: [],
    });

    const dialog = await openEditDialog("custom-node-structured-editor");
    const editor = within(dialog).getByTestId("pipeline-node-structured-editor-0");

    fireEvent.click(within(editor).getByRole("button", { name: "添加字段" }));
    const rootField = within(editor).getAllByTestId("structured-json-field-row")[0];
    fireEvent.change(within(rootField).getByLabelText("键名"), {
      target: { value: "targets" },
    });
    fireEvent.change(within(rootField).getByLabelText("值类型"), {
      target: { value: "array" },
    });

    const arrayEditor = within(rootField).getByTestId("structured-json-array-editor");
    fireEvent.click(within(arrayEditor).getByRole("button", { name: "添加项" }));
    const firstItem = within(arrayEditor).getAllByTestId("structured-json-array-item")[0];
    fireEvent.change(within(firstItem).getByLabelText("值类型"), {
      target: { value: "object" },
    });

    const nestedObject = within(firstItem).getByTestId("structured-json-object-editor");
    fireEvent.click(within(nestedObject).getByRole("button", { name: "添加字段" }));
    const nestedField = within(nestedObject).getAllByTestId("structured-json-field-row")[0];
    fireEvent.change(within(nestedField).getByLabelText("键名"), {
      target: { value: "project" },
    });
    fireEvent.change(within(nestedField).getByLabelText("字符串值"), {
      target: { value: "team/service-a" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "update_pipeline_definition",
        expect.objectContaining({
          id: 151,
          nodes: [
            {
              nodeType: "custom_release_gate",
              parameters: {
                targets: [{ project: "team/service-a" }],
              },
            },
          ],
        })
      );
    });
  });

  it("edits schedule variables through the structured editor path", async () => {
    setupPipelineEditorMocks({
      id: 152,
      name: "schedule-variables-structured-editor",
      description: "schedule variable red phase",
      enabled: true,
      maxConcurrencyDefault: 2,
      variables: [],
      nodes: [
        {
          nodeOrder: 0,
          nodeType: "checkout_branch",
          parameters: { branch: "${source_branch}" },
        },
      ],
      schedules: [
        {
          id: 701,
          scheduleOrder: 0,
          projectGroupId: 7,
          cronExpr: "0 9 * * 1-5",
          timezone: "Asia/Shanghai",
          branch: null,
          enabled: true,
          policy: "skip_if_running",
          variables: {},
        },
      ],
    });

    const dialog = await openEditDialog("schedule-variables-structured-editor");
    const scheduleEditor = within(dialog).getByTestId("pipeline-schedule-variables-editor-0");

    fireEvent.click(within(scheduleEditor).getByRole("button", { name: "添加字段" }));
    const rootField = within(scheduleEditor).getAllByTestId("structured-json-field-row")[0];
    fireEvent.change(within(rootField).getByLabelText("键名"), {
      target: { value: "release_window" },
    });
    fireEvent.change(within(rootField).getByLabelText("值类型"), {
      target: { value: "object" },
    });

    const nestedObject = within(rootField).getByTestId("structured-json-object-editor");
    fireEvent.click(within(nestedObject).getByRole("button", { name: "添加字段" }));
    const nestedField = within(nestedObject).getAllByTestId("structured-json-field-row")[0];
    fireEvent.change(within(nestedField).getByLabelText("键名"), {
      target: { value: "lane" },
    });
    fireEvent.change(within(nestedField).getByLabelText("字符串值"), {
      target: { value: "stable" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "update_pipeline_definition",
        expect.objectContaining({
          id: 152,
          schedules: [
            expect.objectContaining({
              variables: {
                release_window: {
                  lane: "stable",
                },
              },
            }),
          ],
        })
      );
    });
  });

  it("preserves the last valid structured value across invalid advanced JSON edits", async () => {
    setupPipelineEditorMocks({
      id: 153,
      name: "structured-json-fallback",
      description: "advanced json fallback red phase",
      enabled: true,
      maxConcurrencyDefault: 2,
      variables: [],
      nodes: [
        {
          nodeOrder: 0,
          nodeType: "custom_release_gate",
          parameters: {
            target: { project: "team/service-a" },
            approvals: 2,
          },
        },
      ],
      schedules: [],
    });

    const dialog = await openEditDialog("structured-json-fallback");
    const editor = within(dialog).getByTestId("pipeline-node-structured-editor-0");

    expect(within(editor).getByRole("button", { name: "结构化模式" })).toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: "JSON 模式" }));
    fireEvent.change(within(editor).getByLabelText("高级 JSON"), {
      target: { value: '{"target":' },
    });
    expect(within(editor).getByText("JSON 格式无效，已保留最近一次有效值。")).toBeInTheDocument();

    fireEvent.click(within(editor).getByRole("button", { name: "结构化模式" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "update_pipeline_definition",
        expect.objectContaining({
          id: 153,
          nodes: [
            {
              nodeType: "custom_release_gate",
              parameters: {
                target: { project: "team/service-a" },
                approvals: 2,
              },
            },
          ],
        })
      );
    });
  });
});

describe("pipeline wrapper smoke", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("exposes pipeline-named invoke wrappers while keeping workflow wrappers intact", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_pipeline_definitions") return [];
      if (cmd === "create_pipeline_definition") {
        return {
          id: 11,
          name: "release-pipeline",
          description: "",
          enabled: true,
          maxConcurrencyDefault: 2,
          legacyWorkflowDefinitionId: null,
          createdAt: "2026-03-18T00:00:00Z",
          updatedAt: "2026-03-18T00:00:00Z",
          variables: [],
          nodes: [],
          schedules: [],
        };
      }
      if (cmd === "list_pipeline_runs") {
        return {
          items: [],
          page: 2,
          pageSize: 20,
          total: 0,
          hasNextPage: false,
        };
      }
      if (cmd === "execute_pipeline_run") {
        return {
          pipelineRunId: 302,
        };
      }
      if (cmd === "cancel_pipeline_run") return undefined;
      if (cmd === "retry_pipeline_run") {
        return {
          pipelineRunId: 303,
        };
      }
      if (cmd === "get_pipeline_run_detail") {
        return {
          id: 301,
          pipelineDefinitionId: 11,
          pipelineDefinitionName: "release-pipeline",
          projectGroupId: 5,
          projectGroupName: "release-train",
          legacyWorkflowRunId: null,
          triggerKind: "manual",
          status: "running",
          runParameters: {},
          maxConcurrency: 2,
          projectsTotal: 0,
          projectsQueued: 0,
          projectsRunning: 0,
          projectsSuccess: 0,
          projectsFailed: 0,
          projectsCancelled: 0,
          projectsFailedPrecheck: 0,
          startedAt: null,
          finishedAt: null,
          createdAt: "2026-03-18T00:00:00Z",
          updatedAt: "2026-03-18T00:00:00Z",
          projects: [],
        };
      }
      if (cmd === "get_pipeline_run_node_diagnostics") {
        return {
          runNodeId: 602,
          stdout: "",
          stderr: "remote pipeline failed",
          evidence: "pipeline #777 status=failed",
          waitContext: { kind: "pipeline" },
        };
      }
      if (cmd === "get_pipeline_definition_detail") {
        return {
          id: 11,
          name: "release-pipeline",
          description: "",
          enabled: true,
          maxConcurrencyDefault: 2,
          legacyWorkflowDefinitionId: null,
          createdAt: "2026-03-18T00:00:00Z",
          updatedAt: "2026-03-18T00:00:00Z",
          variables: [
            {
              variableOrder: 0,
              key: "source_branch",
              label: "Source Branch",
              defaultValue: "main",
              valueType: "string",
              required: true,
              options: [],
            },
          ],
          nodes: [
            {
              nodeOrder: 0,
              nodeType: "checkout_branch",
              parameters: { branch: "${source_branch}" },
            },
          ],
          schedules: [],
        };
      }
      if (cmd === "update_pipeline_definition") return undefined;
      if (cmd === "delete_pipeline_definition") return undefined;
      if (cmd === "list_workflow_definitions") {
        return [
          {
            id: 91,
            name: "legacy-flow",
            description: "workflow compatibility",
            enabled: true,
            variablesSchema: {},
            maxConcurrencyDefault: 2,
            createdAt: "2026-03-18T00:00:00Z",
            updatedAt: "2026-03-18T00:00:00Z",
            stepsCount: 1,
          },
        ];
      }
      return undefined;
    });

    const pipelineList = await listPipelineDefinitions();
    await createPipelineDefinition({
      name: "release-pipeline",
      variables: [
        {
          key: "source_branch",
          label: "Source Branch",
          defaultValue: "main",
          valueType: "string",
          required: true,
          options: ["main", "release"],
        },
      ],
      nodes: [
        {
          nodeType: "checkout_branch",
          parameters: { branch: "${source_branch}" },
        },
      ],
      schedules: [],
    });
    const pipelineDetail = await getPipelineDefinitionDetail(11);
    await updatePipelineDefinition({
      id: 11,
      name: "release-pipeline",
      description: "",
      enabled: true,
      maxConcurrencyDefault: 2,
      variables: [
        {
          key: "source_branch",
          label: "Source Branch",
          defaultValue: "main",
          valueType: "string",
          required: true,
          options: ["main", "release"],
        },
      ],
      nodes: [
        {
          nodeType: "checkout_branch",
          parameters: { branch: "${source_branch}" },
        },
      ],
      schedules: [],
    });
	    await deletePipelineDefinition(11);
	    const executeResult = await executePipelineRun({
	      pipelineDefinitionId: 11,
	      runParameters: {
	        source_branch: "release",
	      },
	      maxConcurrencyOverride: 1,
	    });
	    await cancelPipelineRun(302);
	    const retryResult = await retryPipelineRun({
	      sourcePipelineRunId: 301,
	      selectedManagedProjectIds: [44],
	      maxConcurrencyOverride: 1,
	    });
	    const pipelineRuns = await listPipelineRuns({
	      page: 2,
	      pageSize: 20,
	      status: "running",
	      pipelineDefinitionId: 11,
	      projectGroupId: 5,
	    });
	    const runDetail = await getPipelineRunDetail(301);
	    const nodeDiagnostics = await getPipelineRunNodeDiagnostics(602);
	    const workflowList = await listWorkflowDefinitions();

    expect(pipelineList).toEqual([]);
    expect(pipelineDetail.nodes).toHaveLength(1);
	    expect(pipelineDetail.variables[0].options).toEqual([]);
	    expect(executeResult.pipelineRunId).toBe(302);
	    expect(retryResult.pipelineRunId).toBe(303);
	    expect(pipelineRuns.items).toEqual([]);
	    expect(pipelineRuns.page).toBe(2);
	    expect(runDetail.projects).toEqual([]);
	    expect(nodeDiagnostics.stderr).toBe("remote pipeline failed");
	    expect(workflowList[0].name).toBe("legacy-flow");

    expect(invokeMock).toHaveBeenCalledWith("list_pipeline_definitions", undefined);
    expect(invokeMock).toHaveBeenCalledWith(
      "create_pipeline_definition",
      expect.objectContaining({
        name: "release-pipeline",
        variables: [
          expect.objectContaining({
            key: "source_branch",
            options: ["main", "release"],
          }),
        ],
      })
    );
    expect(invokeMock).toHaveBeenCalledWith("get_pipeline_definition_detail", { id: 11 });
    expect(invokeMock).toHaveBeenCalledWith(
      "update_pipeline_definition",
      expect.objectContaining({
        id: 11,
        variables: [
          expect.objectContaining({
            key: "source_branch",
            options: ["main", "release"],
          }),
        ],
      })
    );
	    expect(invokeMock).toHaveBeenCalledWith("delete_pipeline_definition", { id: 11 });
	    expect(invokeMock).toHaveBeenCalledWith("execute_pipeline_run", {
	      request: {
	        pipelineDefinitionId: 11,
	        runParameters: {
	          source_branch: "release",
	        },
	        maxConcurrencyOverride: 1,
	      },
	    });
	    expect(invokeMock).toHaveBeenCalledWith("cancel_pipeline_run", {
	      pipelineRunId: 302,
	    });
	    expect(invokeMock).toHaveBeenCalledWith("retry_pipeline_run", {
	      request: {
	        sourcePipelineRunId: 301,
	        selectedManagedProjectIds: [44],
	        maxConcurrencyOverride: 1,
	      },
	    });
	    expect(invokeMock).toHaveBeenCalledWith("list_pipeline_runs", {
	      query: {
	        page: 2,
	        pageSize: 20,
	        status: "running",
	        pipelineDefinitionId: 11,
	        projectGroupId: 5,
	      },
	    });
	    expect(invokeMock).toHaveBeenCalledWith("get_pipeline_run_detail", { id: 301 });
	    expect(invokeMock).toHaveBeenCalledWith("get_pipeline_run_node_diagnostics", { id: 602 });
	    expect(invokeMock).toHaveBeenCalledWith("list_workflow_definitions", undefined);
  });

  it("operator messaging: rejects invalid pipeline variable options with Chinese helper text", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(
      createPipelineDefinition({
        name: "invalid-options-pipeline",
        variables: [
          {
            key: "source_branch",
            label: "Source Branch",
            defaultValue: "main",
            valueType: "string",
            required: true,
            options: { invalid: true },
          },
        ],
        nodes: [
          {
            nodeType: "checkout_branch",
            parameters: { branch: "${source_branch}" },
          },
        ],
        schedules: [],
      })
    ).rejects.toThrow("pipeline variable options 必须是数组");

    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("pipeline run monitor interactions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("renders a project-by-node matrix view for cross-project troubleshooting", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_pipeline_runs") {
        return {
          items: [
            {
              id: 401,
              pipelineDefinitionId: 21,
              pipelineDefinitionName: "release-pipeline",
              projectGroupId: 5,
              projectGroupName: "release-train",
              legacyWorkflowRunId: null,
              sourcePipelineRunId: null,
              triggerKind: "manual",
              status: "running",
              runParameters: { source_branch: "release" },
              maxConcurrency: 2,
              projectsTotal: 2,
              projectsQueued: 0,
              projectsRunning: 1,
              projectsSuccess: 0,
              projectsFailed: 1,
              projectsCancelled: 0,
              projectsFailedPrecheck: 0,
              startedAt: "2026-04-18T00:00:00Z",
              finishedAt: null,
              createdAt: "2026-04-18T00:00:00Z",
              updatedAt: "2026-04-18T00:05:00Z",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          hasNextPage: false,
        };
      }
      if (cmd === "get_pipeline_run_detail") {
        expect(args).toEqual({ id: 401 });
        return {
          id: 401,
          pipelineDefinitionId: 21,
          pipelineDefinitionName: "release-pipeline",
          projectGroupId: 5,
          projectGroupName: "release-train",
          legacyWorkflowRunId: null,
          sourcePipelineRunId: null,
          triggerKind: "manual",
          status: "running",
          runParameters: { source_branch: "release" },
          maxConcurrency: 2,
          projectsTotal: 2,
          projectsQueued: 0,
          projectsRunning: 1,
          projectsSuccess: 0,
          projectsFailed: 1,
          projectsCancelled: 0,
          projectsFailedPrecheck: 0,
          startedAt: "2026-04-18T00:00:00Z",
          finishedAt: null,
          createdAt: "2026-04-18T00:00:00Z",
          updatedAt: "2026-04-18T00:05:00Z",
          projects: [
            {
              id: 5001,
              managedProjectId: 6001,
              gitlabProjectId: 7001,
              projectName: "service-a",
              projectPathWithNamespace: "team/service-a",
              repoPath: "D:/repos/service-a",
              status: "running",
              summaryMessage: "waiting on remote pipeline",
              startedAt: "2026-04-18T00:00:10Z",
              finishedAt: null,
              nodes: [
                {
                  id: 8001,
                  pipelineNodeId: 10,
                  nodeOrder: 0,
                  nodeType: "wait_pipeline",
                  renderedParameters: { project: "team/service-a", ref: "main" },
                  status: "waiting",
                  startedAt: "2026-04-18T00:00:10Z",
                  finishedAt: null,
                  exitCode: null,
                  summaryMessage: "waiting on upstream",
                  errorCode: null,
                  titleZh: null,
                  detailZh: null,
                  suggestionZh: null,
                  waitTarget: "team/service-a@main",
                  lastRemoteStatus: "running",
                  remotePipelineId: 777,
                },
                {
                  id: 8002,
                  pipelineNodeId: 11,
                  nodeOrder: 1,
                  nodeType: "trigger_pipeline",
                  renderedParameters: { project: "team/service-a", ref: "main" },
                  status: "pending",
                  startedAt: null,
                  finishedAt: null,
                  exitCode: null,
                  summaryMessage: "pending",
                  errorCode: null,
                  titleZh: null,
                  detailZh: null,
                  suggestionZh: null,
                  waitTarget: null,
                  lastRemoteStatus: null,
                  remotePipelineId: null,
                },
              ],
            },
            {
              id: 5002,
              managedProjectId: 6002,
              gitlabProjectId: 7002,
              projectName: "service-b",
              projectPathWithNamespace: "team/service-b",
              repoPath: "D:/repos/service-b",
              status: "failed",
              summaryMessage: "remote pipeline failed",
              startedAt: "2026-04-18T00:00:20Z",
              finishedAt: "2026-04-18T00:04:30Z",
              nodes: [
                {
                  id: 8101,
                  pipelineNodeId: 10,
                  nodeOrder: 0,
                  nodeType: "wait_pipeline",
                  renderedParameters: { project: "team/service-b", ref: "main" },
                  status: "success",
                  startedAt: "2026-04-18T00:00:20Z",
                  finishedAt: "2026-04-18T00:01:00Z",
                  exitCode: null,
                  summaryMessage: "upstream done",
                  errorCode: null,
                  titleZh: null,
                  detailZh: null,
                  suggestionZh: null,
                  waitTarget: "team/service-b@main",
                  lastRemoteStatus: "success",
                  remotePipelineId: 778,
                },
                {
                  id: 8102,
                  pipelineNodeId: 11,
                  nodeOrder: 1,
                  nodeType: "trigger_pipeline",
                  renderedParameters: { project: "team/service-b", ref: "main" },
                  status: "failed",
                  startedAt: "2026-04-18T00:01:00Z",
                  finishedAt: "2026-04-18T00:04:30Z",
                  exitCode: null,
                  summaryMessage: "service-b trigger failed",
                  errorCode: "pipeline_failed",
                  titleZh: "service-b 远端流水线失败",
                  detailZh: "service-b target pipeline ended with failed",
                  suggestionZh: "inspect remote pipeline before retry",
                  waitTarget: null,
                  lastRemoteStatus: "failed",
                  remotePipelineId: 778,
                },
              ],
            },
          ],
        };
      }
      return undefined;
    });

    render(<WorkflowRunsPage />);

    await screen.findByText("#401");
    fireEvent.click(await screen.findByTestId("pipeline-run-project-view-matrix"));

    const matrix = await screen.findByTestId("pipeline-run-project-matrix");
    const waitingCell = within(matrix).getByTestId("pipeline-run-matrix-cell-5001-0");
    const failedCell = within(matrix).getByTestId("pipeline-run-matrix-cell-5002-1");

    expect(within(waitingCell).getByText("等待中")).toBeInTheDocument();
    expect(within(waitingCell).getByText("远端: 运行中")).toBeInTheDocument();
    expect(within(failedCell).getByText("失败")).toBeInTheDocument();

    fireEvent.click(failedCell);

    expect(await screen.findByText("service-b 远端流水线失败")).toBeInTheDocument();
    expect(screen.getByText("service-b target pipeline ended with failed")).toBeInTheDocument();
  });

  it("renders a fallback label when a pipeline run has no project group metadata", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_pipeline_runs") {
        return {
          items: [
            {
              id: 451,
              pipelineDefinitionId: 29,
              pipelineDefinitionName: "switch-project-pipeline",
              projectGroupId: null,
              projectGroupName: null,
              legacyWorkflowRunId: null,
              sourcePipelineRunId: null,
              triggerKind: "schedule",
              status: "completed",
              runParameters: {},
              maxConcurrency: 1,
              projectsTotal: 1,
              projectsQueued: 0,
              projectsRunning: 0,
              projectsSuccess: 1,
              projectsFailed: 0,
              projectsCancelled: 0,
              projectsFailedPrecheck: 0,
              startedAt: "2026-04-18T00:00:00Z",
              finishedAt: "2026-04-18T00:00:10Z",
              createdAt: "2026-04-18T00:00:00Z",
              updatedAt: "2026-04-18T00:00:10Z",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          hasNextPage: false,
        };
      }
      if (cmd === "get_pipeline_run_detail") {
        expect(args).toEqual({ id: 451 });
        return {
          id: 451,
          pipelineDefinitionId: 29,
          pipelineDefinitionName: "switch-project-pipeline",
          projectGroupId: null,
          projectGroupName: null,
          legacyWorkflowRunId: null,
          sourcePipelineRunId: null,
          triggerKind: "schedule",
          status: "completed",
          runParameters: {},
          maxConcurrency: 1,
          projectsTotal: 1,
          projectsQueued: 0,
          projectsRunning: 0,
          projectsSuccess: 1,
          projectsFailed: 0,
          projectsCancelled: 0,
          projectsFailedPrecheck: 0,
          startedAt: "2026-04-18T00:00:00Z",
          finishedAt: "2026-04-18T00:00:10Z",
          createdAt: "2026-04-18T00:00:00Z",
          updatedAt: "2026-04-18T00:00:10Z",
          projects: [
            {
              id: 5501,
              managedProjectId: 6601,
              gitlabProjectId: 7601,
              projectName: "service-a",
              projectPathWithNamespace: "team/service-a",
              repoPath: "D:/repos/service-a",
              status: "success",
              summaryMessage: "all nodes completed",
              startedAt: "2026-04-18T00:00:00Z",
              finishedAt: "2026-04-18T00:00:10Z",
              nodes: [],
            },
          ],
        };
      }
      return undefined;
    });

    render(<WorkflowRunsPage />);

    expect(await screen.findAllByText("按步骤切换项目")).toHaveLength(2);
    expect(await screen.findAllByText("switch-project-pipeline")).toHaveLength(2);
  });

  it("operator messaging: renders Chinese remote status labels in the run monitor", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_gitlab_config") return null;
      if (cmd === "list_pipeline_runs") {
        return {
          items: [
            {
              id: 301,
              pipelineDefinitionId: 21,
              pipelineDefinitionName: "release-pipeline",
              projectGroupId: 5,
              projectGroupName: "release-train",
              legacyWorkflowRunId: null,
              sourcePipelineRunId: null,
              triggerKind: "manual",
              status: "running",
              runParameters: { source_branch: "release" },
              maxConcurrency: 2,
              projectsTotal: 1,
              projectsQueued: 0,
              projectsRunning: 1,
              projectsSuccess: 0,
              projectsFailed: 1,
              projectsCancelled: 0,
              projectsFailedPrecheck: 0,
              startedAt: "2026-04-14T10:00:00Z",
              finishedAt: null,
              createdAt: "2026-04-14T10:00:00Z",
              updatedAt: "2026-04-14T10:05:00Z",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          hasNextPage: false,
        };
      }
      if (cmd === "get_pipeline_run_detail") {
        return {
          id: 301,
          pipelineDefinitionId: 21,
          pipelineDefinitionName: "release-pipeline",
          projectGroupId: 5,
          projectGroupName: "release-train",
          legacyWorkflowRunId: null,
          sourcePipelineRunId: null,
          triggerKind: "manual",
          status: "running",
          runParameters: { source_branch: "release" },
          maxConcurrency: 2,
          projectsTotal: 1,
          projectsQueued: 0,
          projectsRunning: 1,
          projectsSuccess: 0,
          projectsFailed: 1,
          projectsCancelled: 0,
          projectsFailedPrecheck: 0,
          startedAt: "2026-04-14T10:00:00Z",
          finishedAt: null,
          createdAt: "2026-04-14T10:00:00Z",
          updatedAt: "2026-04-14T10:05:00Z",
          projects: [
            {
              id: 401,
              managedProjectId: 502,
              gitlabProjectId: 1001,
              projectName: "service-a",
              projectPathWithNamespace: "team/service-a",
              repoPath: "D:/repos/service-a",
              status: "failed",
              summaryMessage: "远端流水线失败",
              startedAt: "2026-04-14T10:00:00Z",
              finishedAt: "2026-04-14T10:05:00Z",
              nodes: [
                {
                  id: 601,
                  pipelineNodeId: 10,
                  nodeOrder: 0,
                  nodeType: "wait_pipeline",
                  renderedParameters: { project: "team/service-a", ref: "main" },
                  status: "waiting",
                  startedAt: "2026-04-14T10:01:00Z",
                  finishedAt: null,
	                  exitCode: null,
                  summaryMessage: "等待远端流水线完成",
                  errorCode: null,
                  titleZh: null,
                  detailZh: null,
                  suggestionZh: null,
	                  waitTarget: "team/service-a@main",
	                  lastRemoteStatus: "running",
	                  remotePipelineId: 777,
	                },
                {
                  id: 602,
                  pipelineNodeId: 11,
                  nodeOrder: 1,
                  nodeType: "trigger_pipeline",
                  renderedParameters: { project: "team/service-a", ref: "main" },
                  status: "failed",
                  startedAt: "2026-04-14T10:02:00Z",
                  finishedAt: "2026-04-14T10:05:00Z",
	                  exitCode: null,
                  summaryMessage: "远端流水线失败",
                  errorCode: "pipeline_failed",
                  titleZh: "远端流水线失败",
                  detailZh: "目标项目的流水线最终状态为 failed。",
                  suggestionZh: "请先查看远端流水线日志，再决定是否重试。",
	                  waitTarget: null,
	                  lastRemoteStatus: "failed",
	                  remotePipelineId: 777,
	                },
              ],
            },
          ],
        };
      }
      if (cmd === "get_pipeline_run_node_diagnostics") {
        expect(args).toEqual({ id: 602 });
        return {
          runNodeId: 602,
          stdout: "",
          stderr: "remote pipeline failed",
          evidence: "pipeline #777 status=failed",
          waitContext: { kind: "pipeline" },
        };
      }
      if (cmd === "cancel_pipeline_run") return undefined;
      if (cmd === "retry_pipeline_run") {
        return { pipelineRunId: 302 };
      }
      return undefined;
    });

    render(<App />);

    fireEvent.click(await screen.findByTitle("工作流运行"));
    expect(await screen.findByRole("heading", { name: "流水线运行" })).toBeInTheDocument();
    expect(await screen.findByText("等待目标")).toBeInTheDocument();
    expect(screen.getByText("team/service-a@main")).toBeInTheDocument();
    const remoteStatusLabel = screen.getByText("最近远端状态");
    expect(within(remoteStatusLabel.parentElement as HTMLElement).getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("远端流水线 #777")).toBeInTheDocument();
    const failureTitleMatches = await screen.findAllByText("远端流水线失败");
    expect(failureTitleMatches.length).toBeGreaterThan(0);
    expect(screen.getByText("目标项目的流水线最终状态为 failed。")).toBeInTheDocument();
    expect(screen.getByText("请先查看远端流水线日志，再决定是否重试。")).toBeInTheDocument();
	    expect(screen.queryByText("pipeline #777 status=failed")).not.toBeInTheDocument();

	    fireEvent.click(screen.getAllByRole("button", { name: /鏌ョ湅璇婃柇/i })[1]);
	    expect(await screen.findByText("pipeline #777 status=failed")).toBeInTheDocument();
	    expect(await screen.findByText("remote pipeline failed")).toBeInTheDocument();
	    await waitFor(() => {
	      expect(invokeMock).toHaveBeenCalledWith("get_pipeline_run_node_diagnostics", {
	        id: 602,
	      });
	    });

    fireEvent.click(screen.getByRole("button", { name: /取消运行/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("cancel_pipeline_run", {
        pipelineRunId: 301,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /重试失败项目/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("retry_pipeline_run", {
        request: {
          sourcePipelineRunId: 301,
          selectedManagedProjectIds: [502],
          maxConcurrencyOverride: null,
        },
      });
    });
  });
});

describe("pipeline run auto refresh", () => {
  function createIntervalTracker() {
    type TrackedInterval = {
      callback: () => void | Promise<void>;
      delay?: number;
      handle: number;
    };

    const trackedIntervals: TrackedInterval[] = [];
    const activeHandles = new Set<number>();
    let nextHandle = 1;

    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(((callback: TimerHandler, delay?: number) => {
        const handle = nextHandle++;
        if (typeof callback === "function") {
          trackedIntervals.push({
            callback: callback as () => void | Promise<void>,
            delay: typeof delay === "number" ? delay : undefined,
            handle,
          });
        }
        activeHandles.add(handle);
        return handle as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval);

    const clearIntervalSpy = vi
      .spyOn(globalThis, "clearInterval")
      .mockImplementation(((handle?: number | ReturnType<typeof setInterval>) => {
        activeHandles.delete(handle as number);
      }) as typeof clearInterval);

    function getActiveAutoRefreshIntervals() {
      return trackedIntervals.filter((entry) => entry.delay === 10_000 && activeHandles.has(entry.handle));
    }

    return {
      clearIntervalSpy,
      getActiveAutoRefreshIntervals,
      setIntervalSpy,
    };
  }

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("auto refreshes the selected active pipeline run", async () => {
    const { clearIntervalSpy, getActiveAutoRefreshIntervals, setIntervalSpy } = createIntervalTracker();

    const runningRun = {
      id: 901,
      pipelineDefinitionId: 44,
      pipelineDefinitionName: "release-pipeline",
      projectGroupId: 7,
      projectGroupName: "release-train",
      legacyWorkflowRunId: null,
      sourcePipelineRunId: null,
      triggerKind: "manual",
      status: "running",
      runParameters: { source_branch: "release" },
      maxConcurrency: 2,
      projectsTotal: 1,
      projectsQueued: 0,
      projectsRunning: 1,
      projectsSuccess: 0,
      projectsFailed: 0,
      projectsCancelled: 0,
      projectsFailedPrecheck: 0,
      startedAt: "2026-04-17T00:00:00Z",
      finishedAt: null,
      createdAt: "2026-04-17T00:00:00Z",
      updatedAt: "2026-04-17T00:00:10Z",
    };

    const runningDetail = {
      ...runningRun,
      projects: [
        {
          id: 4001,
          managedProjectId: 6001,
          gitlabProjectId: 7001,
          projectName: "service-a",
          projectPathWithNamespace: "team/service-a",
          repoPath: "D:/repos/service-a",
          status: "running",
          summaryMessage: "running",
          startedAt: "2026-04-17T00:00:00Z",
          finishedAt: null,
          nodes: [
            {
              id: 5001,
              pipelineNodeId: 1,
              nodeOrder: 0,
              nodeType: "wait_pipeline",
              renderedParameters: { project: "team/service-a", ref: "main" },
              status: "waiting",
              startedAt: "2026-04-17T00:00:01Z",
              finishedAt: null,
              exitCode: null,
              summaryMessage: "waiting",
              errorCode: null,
              titleZh: null,
              detailZh: null,
              suggestionZh: null,
              waitTarget: "team/service-a@main",
              lastRemoteStatus: "running",
              remotePipelineId: 777,
            },
          ],
        },
      ],
    };

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_pipeline_runs") {
        return {
          items: [runningRun],
          page: 1,
          pageSize: 20,
          total: 1,
          hasNextPage: false,
        };
      }
      if (cmd === "get_pipeline_run_detail") return runningDetail;
      return undefined;
    });

    render(<WorkflowRunsPage />);

    expect(await screen.findByText("team/service-a@main")).toBeInTheDocument();
    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalled();
      expect(getActiveAutoRefreshIntervals().length).toBeGreaterThan(0);
    });
    const listCallsBeforeTick = invokeMock.mock.calls.filter(([cmd]) => cmd === "list_pipeline_runs").length;
    expect(listCallsBeforeTick).toBe(1);

    const activeIntervals = getActiveAutoRefreshIntervals();
    const activeRefreshCallback = activeIntervals[activeIntervals.length - 1]?.callback;
    expect(activeRefreshCallback).toBeDefined();
    await act(async () => {
      await activeRefreshCallback?.();
    });

    await waitFor(() => {
      const listCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "list_pipeline_runs").length;
      expect(listCalls).toBeGreaterThanOrEqual(2);
    });

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("stops auto refresh after the selected pipeline run becomes terminal", async () => {
    const { clearIntervalSpy, getActiveAutoRefreshIntervals, setIntervalSpy } = createIntervalTracker();

    const runningRun = {
      id: 902,
      pipelineDefinitionId: 45,
      pipelineDefinitionName: "release-pipeline",
      projectGroupId: 8,
      projectGroupName: "release-train",
      legacyWorkflowRunId: null,
      sourcePipelineRunId: null,
      triggerKind: "manual",
      status: "running",
      runParameters: { source_branch: "release" },
      maxConcurrency: 2,
      projectsTotal: 1,
      projectsQueued: 0,
      projectsRunning: 1,
      projectsSuccess: 0,
      projectsFailed: 0,
      projectsCancelled: 0,
      projectsFailedPrecheck: 0,
      startedAt: "2026-04-17T00:00:00Z",
      finishedAt: null,
      createdAt: "2026-04-17T00:00:00Z",
      updatedAt: "2026-04-17T00:00:10Z",
    };
    const completedRun = {
      ...runningRun,
      status: "completed",
      projectsRunning: 0,
      projectsSuccess: 1,
      finishedAt: "2026-04-17T00:00:20Z",
      updatedAt: "2026-04-17T00:00:20Z",
    };

    let listCallIndex = 0;
    let detailCallIndex = 0;

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_pipeline_runs") {
        listCallIndex += 1;
        const run = listCallIndex >= 2 ? completedRun : runningRun;
        return {
          items: [run],
          page: 1,
          pageSize: 20,
          total: 1,
          hasNextPage: false,
        };
      }
      if (cmd === "get_pipeline_run_detail") {
        detailCallIndex += 1;
        const run = detailCallIndex >= 2 ? completedRun : runningRun;
        return {
          ...run,
          projects: [
            {
              id: 4002,
              managedProjectId: 6002,
              gitlabProjectId: 7002,
              projectName: "service-b",
              projectPathWithNamespace: "team/service-b",
              repoPath: "D:/repos/service-b",
              status: run.status === "completed" ? "success" : "running",
              summaryMessage: run.status,
              startedAt: "2026-04-17T00:00:00Z",
              finishedAt: run.finishedAt,
              nodes: [
                {
                  id: 5002,
                  pipelineNodeId: 1,
                  nodeOrder: 0,
                  nodeType: "wait_pipeline",
                  renderedParameters: { project: "team/service-b", ref: "main" },
                  status: run.status === "completed" ? "success" : "running",
                  startedAt: "2026-04-17T00:00:01Z",
                  finishedAt: run.finishedAt,
                  exitCode: null,
                  summaryMessage: run.status,
                  errorCode: null,
                  titleZh: null,
                  detailZh: null,
                  suggestionZh: null,
                  waitTarget: "team/service-b@main",
                  lastRemoteStatus: run.status === "completed" ? "success" : "running",
                  remotePipelineId: 778,
                },
              ],
            },
          ],
        };
      }
      return undefined;
    });

    render(<WorkflowRunsPage />);

    expect(await screen.findByText("team/service-b@main")).toBeInTheDocument();
    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalled();
      expect(getActiveAutoRefreshIntervals().length).toBeGreaterThan(0);
    });

    const activeIntervals = getActiveAutoRefreshIntervals();
    const activeRefreshCallback = activeIntervals[activeIntervals.length - 1]?.callback;
    expect(activeRefreshCallback).toBeDefined();
    await act(async () => {
      await activeRefreshCallback?.();
    });

    await waitFor(() => {
      const listCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "list_pipeline_runs").length;
      expect(listCalls).toBe(2);
    });
    await waitFor(() => {
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(getActiveAutoRefreshIntervals()).toHaveLength(0);
    });

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

describe.skip("workflow run monitoring interactions", () => {
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

    fireEvent.click(await screen.findByTitle("工作流运行"));

    expect(await screen.findByRole("heading", { name: "工作流运行" })).toBeInTheDocument();
    expect((await screen.findAllByText("release-flow")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/运行 #301/)).toBeInTheDocument();
    expect(screen.getAllByText("release-train").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "项目 web-service" }));
    expect(await screen.findByText("步骤 2 - 合并分支")).toBeInTheDocument();
    expect(screen.getByText("conflict on README.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /取消运行/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("cancel_workflow_run", { workflowRunId: 301 });
    });

    fireEvent.click(screen.getByRole("button", { name: /重试失败项/i }));
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
      expect(screen.getByRole("button", { name: /重试失败项/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByText("#302"));
    expect(screen.getByRole("button", { name: /重试失败项/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /取消运行/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("cancel_workflow_run", { workflowRunId: 302 });
    });

    resolveRun302?.(runDetail302);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /重试失败项/i })).toBeDisabled();
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
      const retryButtons = screen.getAllByRole("button", { name: /重试失败项/i });
      expect(retryButtons[retryButtons.length - 1]).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /^刷新$/i }));

    await waitFor(() => {
      expect(detailCallCount).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      const retryButtons = screen.getAllByRole("button", { name: /重试失败项/i });
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
      expect(screen.getByRole("heading", { name: "运行 #301" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^刷新$/i }));
    fireEvent.click(screen.getByText("#302"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "运行 #302" })).toBeInTheDocument();
    });

    resolveDelayedRefresh?.(runList);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "运行 #302" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "运行 #301" })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /^刷新$/i }));
    await screen.findByText("暂无工作流运行记录。");

    resolveDetail?.(lateDetail);

    await waitFor(() => {
      expect(screen.getByText("请选择一个工作流运行查看详情。")).toBeInTheDocument();
    });
    expect(screen.queryByText("late-project")).not.toBeInTheDocument();
  });
});
