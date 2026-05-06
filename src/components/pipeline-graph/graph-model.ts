import type { Connection, Edge, Node } from "@xyflow/react";

import {
  BUILTIN_NODE_MAP,
  createEdgeDraft,
  createNodeDraft,
  createStageDraft,
  ensureVariableRows,
  normalizeBuiltinParameters,
  type NodeDraft,
  type PipelineDraft,
  type StageDraft,
} from "@/components/pipeline-editor/draft-model";

export const STAGE_GROUP_NODE_TYPE = "stage-group";
export const PIPELINE_ACTION_NODE_TYPE = "pipeline-action";

const STAGE_GROUP_MIN_WIDTH = 320;
const STAGE_GROUP_MIN_HEIGHT = 360;
const STAGE_GROUP_GAP_X = 40;
const STAGE_GROUP_START_X = 24;
const STAGE_GROUP_START_Y = 32;
const STAGE_NODE_START_X = 96;
const STAGE_NODE_START_Y = 72;
const STAGE_NODE_WIDTH = 188;
const STAGE_NODE_GAP_X = 212;
const STAGE_NODE_GAP_Y = 116;
const STAGE_NODE_RIGHT_PADDING = 36;
const STAGE_NODE_BOTTOM_PADDING = 56;
const STAGE_NODE_SLOT_HEIGHT = 116;
const STAGE_NODE_MAX_COLUMNS = 2;

export type StageGraphNodeData = {
  kind: "stage";
  stageKey: string;
  name: string;
  enabled: boolean;
};

export type PipelineActionNodeData = {
  kind: "node";
  nodeKey: string;
  stageKey: string;
  nodeType: string;
  label: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
};

export type PipelineGraphNode = Node<StageGraphNodeData | PipelineActionNodeData>;
export type PipelineGraphEdge = Edge;

export type PipelineGraphState = {
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
};

export type StageGridSlot = {
  col: number;
  row: number;
};

export type StageGridLayout = {
  nodePositions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
};

type StagePositionedNode = Pick<NodeDraft, "nodeKey" | "position">;

function clampStageGridColumn(col: number) {
  return Math.min(Math.max(Math.round(col), 0), STAGE_NODE_MAX_COLUMNS - 1);
}

function getStageGridSlotIndex(slot: StageGridSlot) {
  return Math.max(0, Math.round(slot.row)) * STAGE_NODE_MAX_COLUMNS + clampStageGridColumn(slot.col);
}

function getStageGridSlotForIndex(index: number): StageGridSlot {
  const normalizedIndex = Math.max(0, Math.round(index));
  return {
    col: normalizedIndex % STAGE_NODE_MAX_COLUMNS,
    row: Math.floor(normalizedIndex / STAGE_NODE_MAX_COLUMNS),
  };
}

function getStageGridSlotFromPosition(position: { x: number; y: number }): StageGridSlot {
  return {
    col: clampStageGridColumn((position.x - STAGE_NODE_START_X) / STAGE_NODE_GAP_X),
    row: Math.max(0, Math.round((position.y - STAGE_NODE_START_Y) / STAGE_NODE_GAP_Y)),
  };
}

function getStageGridPosition(slot: StageGridSlot) {
  return {
    x: STAGE_NODE_START_X + clampStageGridColumn(slot.col) * STAGE_NODE_GAP_X,
    y: STAGE_NODE_START_Y + Math.max(0, Math.round(slot.row)) * STAGE_NODE_GAP_Y,
  };
}

function sortStagePositionedNodes<T extends StagePositionedNode>(nodes: T[]) {
  return [...nodes].sort((left, right) => {
    const leftIndex = getStageGridSlotIndex(getStageGridSlotFromPosition(left.position));
    const rightIndex = getStageGridSlotIndex(getStageGridSlotFromPosition(right.position));
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    if (left.position.y !== right.position.y) {
      return left.position.y - right.position.y;
    }
    if (left.position.x !== right.position.x) {
      return left.position.x - right.position.x;
    }
    return left.nodeKey.localeCompare(right.nodeKey);
  });
}

function getStageGridDimensions(nodeCount: number) {
  const columnCount =
    nodeCount <= 1 ? 1 : Math.min(STAGE_NODE_MAX_COLUMNS, Math.max(nodeCount, 1));
  const rowCount = nodeCount > 0 ? Math.ceil(nodeCount / columnCount) : 1;
  return { columnCount, rowCount };
}

function getStageGridWidth(columnCount: number) {
  return Math.max(
    STAGE_GROUP_MIN_WIDTH,
    STAGE_NODE_START_X +
      (columnCount - 1) * STAGE_NODE_GAP_X +
      STAGE_NODE_WIDTH +
      STAGE_NODE_RIGHT_PADDING
  );
}

function getStageGridHeight(rowCount: number) {
  return Math.max(
    STAGE_GROUP_MIN_HEIGHT,
    STAGE_NODE_START_Y +
      (rowCount - 1) * STAGE_NODE_GAP_Y +
      STAGE_NODE_SLOT_HEIGHT +
      STAGE_NODE_BOTTOM_PADDING
  );
}

export function buildStageGridLayout(nodes: StagePositionedNode[]): StageGridLayout {
  const orderedNodes = sortStagePositionedNodes(nodes);
  const { columnCount, rowCount } = getStageGridDimensions(orderedNodes.length);
  const nodePositions = Object.fromEntries(
    orderedNodes.map((node, index) => [node.nodeKey, getStageGridPosition(getStageGridSlotForIndex(index))])
  );

  return {
    nodePositions,
    width: getStageGridWidth(columnCount),
    height: getStageGridHeight(rowCount),
  };
}

function reflowStageNodes<T extends NodeDraft>(nodes: T[]) {
  const layout = buildStageGridLayout(nodes);
  return sortStagePositionedNodes(nodes).map((node) => ({
    ...node,
    position: layout.nodePositions[node.nodeKey] ?? node.position,
  }));
}

function reflowNodesByStageOrder(nodes: NodeDraft[], orderedStageKeys: string[]) {
  const groupedNodes = new Map<string, NodeDraft[]>();
  for (const node of nodes) {
    const current = groupedNodes.get(node.stageKey) ?? [];
    current.push(node);
    groupedNodes.set(node.stageKey, current);
  }

  const nextNodes = orderedStageKeys.flatMap((stageKey) => reflowStageNodes(groupedNodes.get(stageKey) ?? []));
  const knownStageKeys = new Set(orderedStageKeys);
  for (const [stageKey, stageNodes] of groupedNodes.entries()) {
    if (!knownStageKeys.has(stageKey)) {
      nextNodes.push(...reflowStageNodes(stageNodes));
    }
  }

  return nextNodes;
}

export function reorderStageNodesForDrop(
  nodes: NodeDraft[],
  draggedNodeKey: string,
  targetSlot: StageGridSlot
) {
  const draggedNode = nodes.find((node) => node.nodeKey === draggedNodeKey);
  if (!draggedNode) {
    return reflowStageNodes(nodes);
  }

  const remainingNodes = sortStagePositionedNodes(
    nodes.filter((node) => node.nodeKey !== draggedNodeKey)
  );
  const targetIndex = Math.min(getStageGridSlotIndex(targetSlot), remainingNodes.length);
  const nextOrderedNodes = [
    ...remainingNodes.slice(0, targetIndex),
    draggedNode,
    ...remainingNodes.slice(targetIndex),
  ];

  return nextOrderedNodes.map((node, index) => ({
    ...node,
    position: getStageGridPosition(getStageGridSlotForIndex(index)),
  }));
}

function buildStageLayouts(nodes: NodeDraft[]) {
  const groupedNodes = new Map<string, NodeDraft[]>();
  for (const node of nodes) {
    const current = groupedNodes.get(node.stageKey) ?? [];
    current.push(node);
    groupedNodes.set(node.stageKey, current);
  }

  return new Map(
    Array.from(groupedNodes.entries()).map(([stageKey, stageNodes]) => [
      stageKey,
      buildStageGridLayout(stageNodes),
    ])
  );
}

function buildStagePositions(stageKeys: string[], stageLayouts: Map<string, StageGridLayout>) {
  const positions = new Map<string, { x: number; y: number }>();
  let currentX = STAGE_GROUP_START_X;

  for (const stageKey of stageKeys) {
    positions.set(stageKey, { x: currentX, y: STAGE_GROUP_START_Y });
    currentX += (stageLayouts.get(stageKey)?.width ?? STAGE_GROUP_MIN_WIDTH) + STAGE_GROUP_GAP_X;
  }

  return positions;
}

export function getNextNodePositionInStage(
  nodes: Array<Pick<NodeDraft, "stageKey" | "position">>,
  stageKey: string
) {
  const stageNodes = nodes.filter((node) => node.stageKey === stageKey);
  return getStageGridPosition(getStageGridSlotForIndex(stageNodes.length));
}

function filterEdgesByRemainingNodeKeys(
  draft: PipelineDraft,
  remainingNodeKeys: Set<string>
) {
  return draft.edges.filter(
    (edge) =>
      remainingNodeKeys.has(edge.sourceNodeKey) && remainingNodeKeys.has(edge.targetNodeKey)
  );
}

export function isStageGraphNode(node: PipelineGraphNode): node is Node<StageGraphNodeData> {
  return (
    node.type === STAGE_GROUP_NODE_TYPE &&
    typeof (node.data as StageGraphNodeData | undefined)?.stageKey === "string"
  );
}

export function isActionGraphNode(node: PipelineGraphNode): node is Node<PipelineActionNodeData> {
  return (
    node.type === PIPELINE_ACTION_NODE_TYPE &&
    typeof (node.data as PipelineActionNodeData | undefined)?.nodeKey === "string"
  );
}

function getNodeLabel(nodeType: string) {
  return BUILTIN_NODE_MAP.get(nodeType)?.label ?? nodeType;
}

function sortStageNodes(nodes: PipelineGraphNode[]) {
  return [...nodes]
    .filter(isStageGraphNode)
    .sort((left, right) => {
      if (left.position.x !== right.position.x) {
        return left.position.x - right.position.x;
      }
      return left.position.y - right.position.y;
    });
}

function sortActionNodes(nodes: PipelineGraphNode[], orderedStageKeys: string[]) {
  const stageOrder = new Map(orderedStageKeys.map((stageKey, index) => [stageKey, index]));
  return [...nodes]
    .filter(isActionGraphNode)
    .sort((left, right) => {
      const leftOrder = stageOrder.get(left.data.stageKey) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = stageOrder.get(right.data.stageKey) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      const leftIndex = getStageGridSlotIndex(getStageGridSlotFromPosition(left.position));
      const rightIndex = getStageGridSlotIndex(getStageGridSlotFromPosition(right.position));
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      if (left.position.y !== right.position.y) {
        return left.position.y - right.position.y;
      }
      if (left.position.x !== right.position.x) {
        return left.position.x - right.position.x;
      }
      return left.id.localeCompare(right.id);
    });
}

function detectCycle(nodeKeys: string[], edges: { source: string; target: string }[]) {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const nodeKey of nodeKeys) {
    adjacency.set(nodeKey, []);
    indegree.set(nodeKey, 0);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([key]) => key);
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    visited += 1;

    for (const next of adjacency.get(current) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
      }
    }
  }

  return visited !== nodeKeys.length;
}

function buildStageNode(
  stage: StageDraft,
  position: { x: number; y: number },
  layout?: StageGridLayout
): PipelineGraphNode {
  return {
    id: stage.stageKey,
    type: STAGE_GROUP_NODE_TYPE,
    draggable: false,
    position,
    style: {
      width: layout?.width ?? STAGE_GROUP_MIN_WIDTH,
      height: layout?.height ?? STAGE_GROUP_MIN_HEIGHT,
    },
    data: {
      kind: "stage",
      stageKey: stage.stageKey,
      name: stage.name,
      enabled: stage.enabled,
    },
  };
}

function buildActionNode(node: NodeDraft, layout?: StageGridLayout): PipelineGraphNode {
  return {
    id: node.nodeKey,
    type: PIPELINE_ACTION_NODE_TYPE,
    parentId: node.stageKey,
    extent: "parent",
    position: {
      x: layout?.nodePositions[node.nodeKey]?.x ?? node.position.x,
      y: layout?.nodePositions[node.nodeKey]?.y ?? node.position.y,
    },
    data: {
      kind: "node",
      nodeKey: node.nodeKey,
      stageKey: node.stageKey,
      nodeType: node.nodeType,
      label: getNodeLabel(node.nodeType),
      enabled: node.enabled,
      parameters: normalizeBuiltinParameters(node.nodeType, node.parameters),
    },
  };
}

export function buildGraphEditorState(draft: PipelineDraft): PipelineGraphState {
  const stageLayouts = buildStageLayouts(draft.nodes);
  const stagePositions = buildStagePositions(
    draft.stages.map((stage) => stage.stageKey),
    stageLayouts
  );
  const stageNodes = draft.stages.map((stage) =>
    buildStageNode(
      stage,
      stagePositions.get(stage.stageKey) ?? { x: STAGE_GROUP_START_X, y: STAGE_GROUP_START_Y },
      stageLayouts.get(stage.stageKey)
    )
  );
  const actionNodes = draft.nodes.map((node) => buildActionNode(node, stageLayouts.get(node.stageKey)));

  return {
    nodes: [...stageNodes, ...actionNodes],
    edges: draft.edges.map((edge) => ({
      id: edge.id || `${edge.sourceNodeKey}->${edge.targetNodeKey}`,
      source: edge.sourceNodeKey,
      target: edge.targetNodeKey,
    })),
  };
}

export function validateGraphConnection(
  graphState: PipelineGraphState,
  connection: Pick<Connection, "source" | "target">
) {
  const source = connection.source?.trim() ?? "";
  const target = connection.target?.trim() ?? "";
  if (!source || !target) {
    return { valid: false, message: "请选择有效的源节点和目标节点" };
  }
  if (source === target) {
    return { valid: false, message: "节点不能连接到自身" };
  }

  const nodeMap = new Map(graphState.nodes.map((node) => [node.id, node]));
  const sourceNode = nodeMap.get(source);
  const targetNode = nodeMap.get(target);
  if (!sourceNode || !targetNode || !isActionGraphNode(sourceNode) || !isActionGraphNode(targetNode)) {
    return { valid: false, message: "只能在动作节点之间创建连线" };
  }

  if (graphState.edges.some((edge) => edge.source === source && edge.target === target)) {
    return { valid: false, message: "该连线已存在" };
  }

  const orderedStageKeys = sortStageNodes(graphState.nodes).map((node) => node.data.stageKey);
  const stageOrder = new Map(orderedStageKeys.map((stageKey, index) => [stageKey, index]));
  const sourceStageOrder = stageOrder.get(sourceNode.data.stageKey) ?? 0;
  const targetStageOrder = stageOrder.get(targetNode.data.stageKey) ?? 0;
  if (sourceStageOrder > targetStageOrder) {
    return { valid: false, message: "不能从后续阶段连回前置阶段" };
  }

  const nextEdges = [...graphState.edges, { source, target }];
  if (
    detectCycle(
      Array.from(nodeMap.keys()).filter((key) => isActionGraphNode(nodeMap.get(key)!)),
      nextEdges
    )
  ) {
    return { valid: false, message: "该连线会形成环" };
  }

  return { valid: true };
}

export function syncDraftFromGraphState(
  draft: PipelineDraft,
  graphState: PipelineGraphState
): PipelineDraft {
  const existingStageMap = new Map(draft.stages.map((stage) => [stage.stageKey, stage]));
  const existingNodeMap = new Map(draft.nodes.map((node) => [node.nodeKey, node]));
  const orderedStageNodes = sortStageNodes(graphState.nodes);
  const stages =
    orderedStageNodes.length > 0
      ? orderedStageNodes.map((node) => {
          const previous = existingStageMap.get(node.data.stageKey);
          return createStageDraft({
            id: node.id,
            stageKey: node.data.stageKey,
            name: node.data.name,
            enabled: node.data.enabled ?? previous?.enabled ?? true,
          });
        })
      : draft.stages.length > 0
        ? draft.stages
        : [createStageDraft({ name: "阶段 1", stageKey: "stage_1" })];

  const orderedStageKeys = stages.map((stage) => stage.stageKey);
  const firstStageKey = orderedStageKeys[0] ?? "";
  const nextNodes = sortActionNodes(graphState.nodes, orderedStageKeys).map((node) => {
    const previous = existingNodeMap.get(node.data.nodeKey);
    const stageKey = orderedStageKeys.includes(node.data.stageKey)
      ? node.data.stageKey
      : firstStageKey;

    return createNodeDraft({
      id: node.id,
      nodeKey: node.data.nodeKey,
      stageKey,
      nodeType: node.data.nodeType,
      parameters: node.data.parameters,
      position: {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      },
      enabled: node.data.enabled ?? previous?.enabled ?? true,
    });
  });
  const nodes = reflowNodesByStageOrder(nextNodes, orderedStageKeys);

  const nodeKeySet = new Set(nodes.map((node) => node.nodeKey));
  const edges = graphState.edges
    .filter((edge) => nodeKeySet.has(edge.source) && nodeKeySet.has(edge.target))
    .map((edge) => createEdgeDraft(edge.source, edge.target, edge.id || `${edge.source}->${edge.target}`));

  return {
    ...draft,
    stages,
    nodes,
    edges,
    variableRows: ensureVariableRows(nodes, draft.variableRows),
  };
}

export function removeSelectedGraphObject(
  draft: PipelineDraft,
  selectedNode: PipelineGraphNode
): PipelineDraft {
  if (isActionGraphNode(selectedNode)) {
    const remainingNodes = draft.nodes.filter((node) => node.nodeKey !== selectedNode.data.nodeKey);
    const nodes = reflowNodesByStageOrder(
      remainingNodes,
      draft.stages.map((stage) => stage.stageKey)
    );
    const nodeKeySet = new Set(nodes.map((node) => node.nodeKey));

    return {
      ...draft,
      nodes,
      edges: filterEdgesByRemainingNodeKeys(draft, nodeKeySet),
      variableRows: ensureVariableRows(nodes, draft.variableRows),
    };
  }

  if (isStageGraphNode(selectedNode)) {
    const stages = draft.stages.filter((stage) => stage.stageKey !== selectedNode.data.stageKey);
    const remainingNodes = draft.nodes.filter((node) => node.stageKey !== selectedNode.data.stageKey);
    const nodes = reflowNodesByStageOrder(
      remainingNodes,
      stages.map((stage) => stage.stageKey)
    );
    const nodeKeySet = new Set(nodes.map((node) => node.nodeKey));

    return {
      ...draft,
      stages,
      nodes,
      edges: filterEdgesByRemainingNodeKeys(draft, nodeKeySet),
      variableRows: ensureVariableRows(nodes, draft.variableRows),
    };
  }

  return draft;
}
