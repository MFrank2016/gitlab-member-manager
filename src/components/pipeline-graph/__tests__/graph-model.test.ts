import { describe, expect, it } from "vitest";

import {
  buildPipelineCreatePayload,
  createEmptyPipelineDraft,
  createNodeDraft,
  createStageDraft,
  ensureVariableRows,
  toDraftFromDetail,
} from "@/components/pipeline-editor/draft-model";
import {
  buildGraphEditorState,
  getNextNodePositionInStage,
  removeSelectedGraphObject,
  syncDraftFromGraphState,
  validateGraphConnection,
} from "@/components/pipeline-graph/graph-model";
import type { PipelineDefinitionDetail } from "@/lib/types";

const pipelineDetail: PipelineDefinitionDetail = {
  id: 101,
  name: "release-pipeline",
  description: "graph definition",
  enabled: true,
  maxConcurrencyDefault: 2,
  legacyWorkflowDefinitionId: null,
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
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
    {
      variableOrder: 1,
      key: "target_branch",
      label: "Target Branch",
      defaultValue: "release",
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
    {
      id: 2,
      stageKey: "deploy",
      name: "发布",
      stageOrder: 1,
      enabled: true,
    },
  ],
  nodes: [
    {
      nodeOrder: 0,
      nodeType: "checkout_branch",
      parameters: { branch: "${source_branch}" },
      stageKey: "prepare",
      nodeKey: "checkout_source",
      positionX: 96,
      positionY: 72,
      enabled: true,
    },
    {
      nodeOrder: 1,
      nodeType: "trigger_pipeline",
      parameters: { project: "team/web-service", ref: "${target_branch}" },
      stageKey: "deploy",
      nodeKey: "trigger_release",
      positionX: 96,
      positionY: 72,
      enabled: true,
    },
  ],
  edges: [
    {
      id: 11,
      sourceNodeKey: "checkout_source",
      targetNodeKey: "trigger_release",
    },
  ],
  schedules: [],
};

describe("pipeline graph model", () => {
  it("converts a stage-aware pipeline detail into React Flow group nodes and edges", () => {
    const draft = toDraftFromDetail(pipelineDetail);
    const graphState = buildGraphEditorState(draft);

    expect(graphState.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "prepare",
          type: "stage-group",
          draggable: false,
          data: expect.objectContaining({
            stageKey: "prepare",
            name: "准备",
          }),
        }),
        expect.objectContaining({
          id: "deploy",
          type: "stage-group",
          draggable: false,
          data: expect.objectContaining({
            stageKey: "deploy",
            name: "发布",
          }),
        }),
        expect.objectContaining({
          id: "checkout_source",
          type: "pipeline-action",
          parentId: "prepare",
          position: { x: 96, y: 72 },
          data: expect.objectContaining({
            nodeKey: "checkout_source",
            stageKey: "prepare",
            nodeType: "checkout_branch",
          }),
        }),
        expect.objectContaining({
          id: "trigger_release",
          type: "pipeline-action",
          parentId: "deploy",
          position: { x: 96, y: 72 },
          data: expect.objectContaining({
            nodeKey: "trigger_release",
            stageKey: "deploy",
            nodeType: "trigger_pipeline",
          }),
        }),
      ])
    );
    expect(graphState.edges).toEqual([
      expect.objectContaining({
        id: "checkout_source->trigger_release",
        source: "checkout_source",
        target: "trigger_release",
      }),
    ]);
  });

  it("keeps the next node on the last fully visible slot inside the target stage", () => {
    const nodes = [
      createNodeDraft({
        stageKey: "prepare",
        nodeType: "checkout_branch",
        parameters: { branch: "${source_branch}" },
        position: { x: 96, y: 72 },
      }),
      createNodeDraft({
        stageKey: "deploy",
        nodeType: "trigger_pipeline",
        parameters: {
          project: "team/web-service",
          ref: "${target_branch}",
        },
        position: { x: 144, y: 220 },
      }),
      createNodeDraft({
        stageKey: "deploy",
        nodeType: "wait_pipeline",
        parameters: {
          project: "team/web-service",
          ref: "${target_branch}",
          sha: "",
        },
        position: { x: 48, y: 360 },
      }),
    ];

    expect(getNextNodePositionInStage(nodes, "prepare")).toEqual({ x: 96, y: 188 });
    expect(getNextNodePositionInStage(nodes, "deploy")).toEqual({ x: 96, y: 188 });
    expect(getNextNodePositionInStage(nodes, "verify")).toEqual({ x: 96, y: 72 });
  });

  it("serializes graph edits back into the persisted stage-aware payload shape", () => {
    const draft = toDraftFromDetail(pipelineDetail);
    const graphState = buildGraphEditorState(draft);
    const nextState = {
      nodes: [
        ...graphState.nodes.map((node) =>
          node.id === "deploy"
            ? {
                ...node,
                position: { x: 520, y: 32 },
                data: { ...node.data, name: "灰度发布" },
              }
            : node
        ),
        {
          id: "wait_remote",
          type: "pipeline-action" as const,
          parentId: "deploy",
          position: { x: 144, y: 220 },
          data: {
            nodeKey: "wait_remote",
            stageKey: "deploy",
            nodeType: "wait_pipeline",
            label: "等待远端流水线",
            enabled: true,
            parameters: {
              project: "team/web-service",
              ref: "${target_branch}",
              sha: "",
            },
          },
        },
      ],
      edges: [
        ...graphState.edges,
        {
          id: "trigger_release->wait_remote",
          source: "trigger_release",
          target: "wait_remote",
        },
      ],
    };

    const nextDraft = syncDraftFromGraphState(draft, nextState);
    const payload = buildPipelineCreatePayload(nextDraft);

    expect(payload.stages).toEqual([
      { stageKey: "prepare", name: "准备", enabled: true },
      { stageKey: "deploy", name: "灰度发布", enabled: true },
    ]);
    expect(payload.nodes).toEqual([
      expect.objectContaining({
        nodeKey: "checkout_source",
        stageKey: "prepare",
        positionX: 96,
        positionY: 72,
      }),
      expect.objectContaining({
        nodeKey: "trigger_release",
        stageKey: "deploy",
        positionX: 96,
        positionY: 72,
      }),
      expect.objectContaining({
        nodeKey: "wait_remote",
        stageKey: "deploy",
        nodeType: "wait_pipeline",
        positionX: 144,
        positionY: 220,
        parameters: {
          project: "team/web-service",
          ref: "${target_branch}",
          sha: "",
        },
      }),
    ]);
    expect(payload.edges).toEqual([
      {
        sourceNodeKey: "checkout_source",
        targetNodeKey: "trigger_release",
      },
      {
        sourceNodeKey: "trigger_release",
        targetNodeKey: "wait_remote",
      },
    ]);
  });

  it("blocks duplicate, self-loop and reverse-stage connections", () => {
    const draft = toDraftFromDetail(pipelineDetail);
    const graphState = buildGraphEditorState(draft);

    expect(
      validateGraphConnection(graphState, {
        source: "checkout_source",
        target: "trigger_release",
      })
    ).toEqual({
      valid: false,
      message: "该连线已存在",
    });

    expect(
      validateGraphConnection(graphState, {
        source: "checkout_source",
        target: "checkout_source",
      })
    ).toEqual({
      valid: false,
      message: "节点不能连接到自身",
    });

    expect(
      validateGraphConnection(graphState, {
        source: "trigger_release",
        target: "checkout_source",
      })
    ).toEqual({
      valid: false,
      message: "不能从后续阶段连回前置阶段",
    });
  });

  it("removes a stage together with its nodes, edges, and inferred variable rows", () => {
    const baseDraft = createEmptyPipelineDraft();
    const prepareNode = createNodeDraft({
      id: "checkout-source",
      nodeKey: "checkout_source",
      stageKey: "stage-1",
      nodeType: "checkout_branch",
      parameters: {
        branch: "${source_branch}",
      },
      position: { x: 96, y: 72 },
    });
    const deployStage = createStageDraft({
      id: "deploy",
      stageKey: "deploy",
      name: "发布",
      enabled: true,
    });
    const deployNode = createNodeDraft({
      id: "trigger-release",
      nodeKey: "trigger_release",
      stageKey: "deploy",
      nodeType: "trigger_pipeline",
      parameters: {
        project: "team/web-service",
        ref: "${deploy_branch}",
      },
      position: { x: 96, y: 72 },
    });
    const draft = {
      ...baseDraft,
      stages: [...baseDraft.stages, deployStage],
      nodes: [prepareNode, deployNode],
      edges: [
        {
          id: "checkout_source->trigger_release",
          sourceNodeKey: "checkout_source",
          targetNodeKey: "trigger_release",
        },
      ],
    };
    draft.variableRows = ensureVariableRows(draft.nodes, draft.variableRows);

    const graphState = buildGraphEditorState(draft);
    const deployStageNode = graphState.nodes.find((node) => node.id === "deploy");

    expect(deployStageNode).toBeDefined();

    const nextDraft = removeSelectedGraphObject(draft, deployStageNode!);

    expect(nextDraft.stages.map((stage) => stage.stageKey)).toEqual(["stage-1"]);
    expect(nextDraft.nodes.map((node) => node.nodeKey)).toEqual(["checkout_source"]);
    expect(nextDraft.edges).toEqual([]);
    expect(nextDraft.variableRows.map((row) => row.key)).toEqual(["source_branch"]);
  });
});
