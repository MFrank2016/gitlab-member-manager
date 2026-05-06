import { describe, expect, it } from "vitest";

import {
  BUILTIN_NODE_MAP,
  buildPipelineCreatePayload,
  createEmptyPipelineDraft,
  ensureVariableRows,
  normalizeBuiltinParameters,
  remapNodeDraftForType,
  toDraftFromDetail,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";

describe("pipeline draft model working path node", () => {
  it("registers switch_project as a builtin node with a managed project selector field", () => {
    const builtin = BUILTIN_NODE_MAP.get("switch_project");

    expect(builtin).toBeDefined();
    expect(builtin?.fields).toEqual([
      expect.objectContaining({
        key: "managedProjectId",
        label: "项目",
      }),
    ]);
  });

  it("registers set_working_path as a builtin node with a variable-friendly path field", () => {
    const builtin = BUILTIN_NODE_MAP.get("set_working_path");

    expect(builtin).toBeDefined();
    expect(builtin?.label).toBe("设置执行路径");
    expect(builtin?.fields).toEqual([
      expect.objectContaining({
        key: "path",
        label: "目标路径",
      }),
    ]);
    expect(builtin?.fields[0]?.placeholder).toContain("${repo_root}");
    expect(builtin?.fields[0]?.placeholder).toContain("../another-repo");
  });

  it("serializes relative and absolute working path nodes through the create payload builder", () => {
    const draft: PipelineDraft = {
      name: "release-pipeline",
      description: "",
      enabled: true,
      maxConcurrencyDefault: "1",
      variableRows: [],
      stages: [{ id: "stage-1", stageKey: "prepare", name: "准备", enabled: true }],
      nodes: [
        {
          id: "node-1",
          nodeKey: "working-path-relative",
          stageKey: "prepare",
          nodeType: "set_working_path",
          position: { x: 96, y: 72 },
          enabled: true,
          parameters: normalizeBuiltinParameters("set_working_path", {
            path: "../another-repo",
          }),
        },
        {
          id: "node-2",
          nodeKey: "working-path-absolute",
          stageKey: "prepare",
          nodeType: "set_working_path",
          position: { x: 96, y: 188 },
          enabled: true,
          parameters: normalizeBuiltinParameters("set_working_path", {
            path: "D:/repos/project-a",
          }),
        },
      ],
      edges: [],
      schedules: [],
    };

    expect(buildPipelineCreatePayload(draft).nodes).toEqual([
      {
        nodeType: "set_working_path",
        nodeKey: "working-path-relative",
        stageKey: "prepare",
        positionX: 96,
        positionY: 72,
        enabled: true,
        parameters: { path: "../another-repo" },
      },
      {
        nodeType: "set_working_path",
        nodeKey: "working-path-absolute",
        stageKey: "prepare",
        positionX: 96,
        positionY: 188,
        enabled: true,
        parameters: { path: "D:/repos/project-a" },
      },
    ]);
  });

  it("serializes switch_project nodes through the create payload builder", () => {
    const draft: PipelineDraft = {
      name: "release-pipeline",
      description: "",
      enabled: true,
      maxConcurrencyDefault: "1",
      variableRows: [],
      stages: [{ id: "stage-1", stageKey: "prepare", name: "准备", enabled: true }],
      nodes: [
        {
          id: "node-1",
          nodeKey: "switch-project",
          stageKey: "prepare",
          nodeType: "switch_project",
          position: { x: 96, y: 72 },
          enabled: true,
          parameters: normalizeBuiltinParameters("switch_project", {
            managedProjectId: "42",
          }),
        },
      ],
      edges: [],
      schedules: [],
    };

    expect(buildPipelineCreatePayload(draft).nodes).toEqual([
      {
        nodeType: "switch_project",
        nodeKey: "switch-project",
        stageKey: "prepare",
        positionX: 96,
        positionY: 72,
        enabled: true,
        parameters: { managedProjectId: "42" },
      },
    ]);
  });

  it("drops incompatible extra parameters when switching to another builtin node type", () => {
    expect(
      remapNodeDraftForType(
        {
          id: "node-1",
          nodeType: "check_pipeline",
          parameters: {
            project: "team/service-a",
            ref: "${source_branch}",
            sha: "abc123",
            unexpected: "should-be-removed",
          },
        },
        "trigger_pipeline"
      )
    ).toEqual({
      id: "node-1",
      nodeType: "trigger_pipeline",
      parameters: {
        project: "team/service-a",
        ref: "${source_branch}",
      },
    });
  });

  it("keeps inferred variables aligned to the latest placeholder instead of accumulating typing intermediates", () => {
    const node = (branch: string) => ({
      id: "node-1",
      nodeKey: "checkout-source",
      stageKey: "prepare",
      nodeType: "checkout_branch",
      position: { x: 96, y: 72 },
      enabled: true,
      parameters: normalizeBuiltinParameters("checkout_branch", { branch }),
    });

    const initialRows = ensureVariableRows([node("${source_branch}")], []);
    expect(initialRows.map((row) => row.key)).toEqual(["source_branch"]);

    const afterFirstEdit = ensureVariableRows([node("${r}")], initialRows);
    expect(afterFirstEdit.map((row) => row.key)).toEqual(["r"]);

    const afterSecondEdit = ensureVariableRows([node("${re}")], afterFirstEdit);
    expect(afterSecondEdit.map((row) => row.key)).toEqual(["re"]);

    const afterFinalEdit = ensureVariableRows([node("${release_branch}")], afterSecondEdit);
    expect(afterFinalEdit.map((row) => row.key)).toEqual(["release_branch"]);
  });

  it("creates an empty stage-aware draft with a default stage only", () => {
    const draft = createEmptyPipelineDraft();

    expect(draft.stages).toHaveLength(1);
    expect(draft.nodes).toEqual([]);
    expect(draft.edges).toEqual([]);
    expect(draft.variableRows).toEqual([]);
  });

  it("hydrates legacy stage-less definitions into a single default stage", () => {
    const draft = toDraftFromDetail({
      id: 9,
      name: "legacy-release",
      description: "",
      enabled: true,
      maxConcurrencyDefault: 2,
      createdAt: "2026-04-28T00:00:00Z",
      updatedAt: "2026-04-28T00:00:00Z",
      variables: [],
      stages: [],
      nodes: [
        {
          nodeOrder: 0,
          nodeType: "checkout_branch",
          parameters: { branch: "${source_branch}" },
          stageKey: null,
          nodeKey: null,
          positionX: 48,
          positionY: 60,
          enabled: true,
        },
      ],
      edges: [],
      schedules: [],
    });

    expect(draft.stages).toHaveLength(1);
    expect(draft.nodes[0]?.stageKey).toBe(draft.stages[0]?.stageKey);
    expect(draft.nodes[0]?.nodeKey).toBeTruthy();
  });

  it("preserves explicit stage-only detail payloads when hydrating without nodes", () => {
    const draft = toDraftFromDetail({
      id: 10,
      name: "empty-release",
      description: "",
      enabled: true,
      maxConcurrencyDefault: 2,
      createdAt: "2026-04-28T00:00:00Z",
      updatedAt: "2026-04-28T00:00:00Z",
      variables: [],
      stages: [
        {
          stageKey: "default_stage",
          name: "阶段 1",
          stageOrder: 0,
          enabled: true,
        },
      ],
      nodes: [],
      edges: [],
      schedules: [],
    });

    expect(draft.stages).toHaveLength(1);
    expect(draft.stages[0]?.stageKey).toBe("default_stage");
    expect(draft.nodes).toEqual([]);
    expect(draft.edges).toEqual([]);
    expect(draft.variableRows).toEqual([]);
  });

  it("serializes stages and edges together with nodes", () => {
    const draft: PipelineDraft = {
      name: "release-pipeline",
      description: "",
      enabled: true,
      maxConcurrencyDefault: "2",
      variableRows: [
        {
          id: "variable-1",
          key: "source_branch",
          label: "Source Branch",
          defaultValue: "main",
          required: true,
          source: "manual",
        },
        {
          id: "variable-2",
          key: "target_branch",
          label: "Target Branch",
          defaultValue: "release",
          required: true,
          source: "manual",
        },
      ],
      stages: [
        { id: "stage-1", stageKey: "prepare", name: "准备", enabled: true },
        { id: "stage-2", stageKey: "deploy", name: "发布", enabled: false },
      ],
      nodes: [
        {
          id: "node-1",
          nodeKey: "checkout-source",
          stageKey: "prepare",
          nodeType: "checkout_branch",
          position: { x: 96, y: 72 },
          enabled: true,
          parameters: normalizeBuiltinParameters("checkout_branch", {
            branch: "${source_branch}",
          }),
        },
        {
          id: "node-2",
          nodeKey: "trigger-release",
          stageKey: "deploy",
          nodeType: "trigger_pipeline",
          position: { x: 96, y: 72 },
          enabled: true,
          parameters: normalizeBuiltinParameters("trigger_pipeline", {
            project: "team/web-service",
            ref: "${target_branch}",
          }),
        },
      ],
      edges: [
        {
          id: "edge-1",
          sourceNodeKey: "checkout-source",
          targetNodeKey: "trigger-release",
        },
      ],
      schedules: [],
    };

    const payload = buildPipelineCreatePayload(draft);

    expect(payload.stages).toEqual([
      { stageKey: "prepare", name: "准备", enabled: true },
      { stageKey: "deploy", name: "发布", enabled: false },
    ]);
    expect(payload.edges).toEqual([
      {
        sourceNodeKey: "checkout-source",
        targetNodeKey: "trigger-release",
      },
    ]);
  });
});
