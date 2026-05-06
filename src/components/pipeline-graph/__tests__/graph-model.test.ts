import { beforeEach, describe, expect, it } from "vitest";

import {
  buildPipelineCreatePayload,
  createEmptyPipelineDraft,
  createNodeDraft,
  createStageDraft,
  ensureVariableRows,
  resetPipelineDraftCountersForTest,
  toDraftFromDetail,
} from "@/components/pipeline-editor/draft-model";
import {
  buildGraphEditorState,
  buildStageGridLayout,
  getNextNodePositionInStage,
  removeSelectedGraphObject,
  reorderStageNodesForDrop,
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
  beforeEach(() => {
    resetPipelineDraftCountersForTest();
  });

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

  it("expands stage container size when a stage needs more grid slots", () => {
    const compactLayout = buildStageGridLayout([
      createNodeDraft({
        stageKey: "stage-1",
        position: { x: 96, y: 72 },
      }),
    ]);
    const expandedLayout = buildStageGridLayout([
      createNodeDraft({
        stageKey: "stage-1",
        position: { x: 96, y: 72 },
      }),
      createNodeDraft({
        stageKey: "stage-1",
        position: { x: 96, y: 188 },
      }),
      createNodeDraft({
        stageKey: "stage-1",
        position: { x: 96, y: 304 },
      }),
      createNodeDraft({
        stageKey: "stage-1",
        position: { x: 96, y: 420 },
      }),
      createNodeDraft({
        stageKey: "stage-1",
        position: { x: 96, y: 536 },
      }),
    ]);

    expect(compactLayout.width).toBe(320);
    expect(compactLayout.height).toBe(360);
    expect(expandedLayout.width).toBe(532);
    expect(expandedLayout.height).toBe(476);
  });

  it("lays out stage nodes in a two-dimensional grid with fixed slot gaps", () => {
    const nodes = [
      createNodeDraft({
        stageKey: "stage-1",
        position: { x: 0, y: 0 },
      }),
      createNodeDraft({
        stageKey: "stage-1",
        position: { x: 0, y: 0 },
      }),
      createNodeDraft({
        stageKey: "stage-1",
        position: { x: 0, y: 0 },
      }),
    ];
    const layout = buildStageGridLayout(nodes);

    expect(layout.nodePositions[nodes[0]!.nodeKey]).toEqual({ x: 96, y: 72 });
    expect(layout.nodePositions[nodes[1]!.nodeKey]).toEqual({ x: 308, y: 72 });
    expect(layout.nodePositions[nodes[2]!.nodeKey]).toEqual({ x: 96, y: 188 });
  });

  it("returns the next available two-dimensional slot inside the target stage", () => {
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

    expect(getNextNodePositionInStage(nodes, "prepare")).toEqual({ x: 308, y: 72 });
    expect(getNextNodePositionInStage(nodes, "deploy")).toEqual({ x: 96, y: 188 });
    expect(getNextNodePositionInStage(nodes, "verify")).toEqual({ x: 96, y: 72 });
  });

  it("reflows a dropped stage node into non-overlapping canonical grid coordinates", () => {
    const nodes = [
      createNodeDraft({
        nodeKey: "node-a",
        stageKey: "stage-1",
        position: { x: 96, y: 72 },
      }),
      createNodeDraft({
        nodeKey: "node-b",
        stageKey: "stage-1",
        position: { x: 96, y: 188 },
      }),
      createNodeDraft({
        nodeKey: "node-c",
        stageKey: "stage-1",
        position: { x: 96, y: 304 },
      }),
    ];

    const reordered = reorderStageNodesForDrop(nodes, "node-c", { col: 1, row: 0 });

    expect(reordered.map((node) => [node.nodeKey, node.position])).toEqual([
      ["node-a", { x: 96, y: 72 }],
      ["node-c", { x: 308, y: 72 }],
      ["node-b", { x: 96, y: 188 }],
    ]);
    expect(new Set(reordered.map((node) => `${node.position.x}:${node.position.y}`)).size).toBe(3);
    expect(reordered[1]!.position.x - reordered[0]!.position.x).toBe(212);
    expect(reordered[2]!.position.y - reordered[0]!.position.y).toBe(116);
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
        positionX: 308,
        positionY: 72,
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

  it("recalculates stage positions after the stage order changes", () => {
    const baseDraft = createEmptyPipelineDraft();
    const prepareStage = createStageDraft({
      id: "prepare",
      stageKey: "prepare",
      name: "准备",
      enabled: true,
    });
    const deployStage = createStageDraft({
      id: "deploy",
      stageKey: "deploy",
      name: "发布",
      enabled: true,
    });
    const draft = {
      ...baseDraft,
      stages: [prepareStage, deployStage],
      nodes: [
        createNodeDraft({
          nodeKey: "prepare-1",
          stageKey: "prepare",
          nodeType: "checkout_branch",
          position: { x: 96, y: 72 },
        }),
        createNodeDraft({
          nodeKey: "prepare-2",
          stageKey: "prepare",
          nodeType: "checkout_branch",
          position: { x: 96, y: 188 },
        }),
        createNodeDraft({
          nodeKey: "prepare-3",
          stageKey: "prepare",
          nodeType: "checkout_branch",
          position: { x: 96, y: 304 },
        }),
        createNodeDraft({
          nodeKey: "prepare-4",
          stageKey: "prepare",
          nodeType: "checkout_branch",
          position: { x: 96, y: 420 },
        }),
        createNodeDraft({
          nodeKey: "prepare-5",
          stageKey: "prepare",
          nodeType: "checkout_branch",
          position: { x: 96, y: 536 },
        }),
        createNodeDraft({
          nodeKey: "deploy-1",
          stageKey: "deploy",
          nodeType: "trigger_pipeline",
          position: { x: 96, y: 72 },
        }),
      ],
    };

    const graphState = buildGraphEditorState(draft);
    const prepareNode = graphState.nodes.find((node) => node.id === "prepare");
    const deployNode = graphState.nodes.find((node) => node.id === "deploy");

    expect(prepareNode?.style).toMatchObject({ width: 532, height: 476 });
    expect(deployNode?.position.x).toBe(596);

    const reorderedDraft = syncDraftFromGraphState(draft, {
      nodes: graphState.nodes.map((node) => {
        if (node.id === "deploy") {
          return {
            ...node,
            position: { x: 0, y: 32 },
          };
        }
        if (node.id === "prepare") {
          return {
            ...node,
            position: { x: 800, y: 32 },
          };
        }
        return node;
      }),
      edges: graphState.edges,
    });
    const reorderedGraphState = buildGraphEditorState(reorderedDraft);
    const reorderedPrepareNode = reorderedGraphState.nodes.find((node) => node.id === "prepare");
    const reorderedDeployNode = reorderedGraphState.nodes.find((node) => node.id === "deploy");

    expect(reorderedDraft.stages.map((stage) => stage.stageKey)).toEqual(["deploy", "prepare"]);
    expect(reorderedDeployNode?.position.x).toBe(24);
    expect(reorderedPrepareNode?.position.x).toBe(384);
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
