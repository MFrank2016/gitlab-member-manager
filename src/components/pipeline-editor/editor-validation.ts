import {
  buildPipelineCreatePayload,
  getMissingBuiltinRequiredFields,
  type EdgeDraft,
  type NodeDraft,
  type PipelineDraft,
  type StageDraft,
} from "@/components/pipeline-editor/draft-model";

export type ValidationIssueCode =
  | "pipeline_name_required"
  | "pipeline_has_no_stages"
  | "stage_has_no_nodes"
  | "node_type_required"
  | "node_required_parameter_missing"
  | "edge_duplicate"
  | "edge_backward"
  | "edge_cyclic"
  | "payload_build_failed";

export type ValidationIssue = {
  code: ValidationIssueCode;
  path: string;
  message: string;
};

export type ValidationSummary = {
  ok: boolean;
  issues: ValidationIssue[];
};

const FALLBACK_PAYLOAD_ERROR_MESSAGE = "请先完善流水线配置。";

function createIssue(
  code: ValidationIssueCode,
  path: string,
  message: string
): ValidationIssue {
  return { code, path, message };
}

function createNodePath(node: NodeDraft, index: number) {
  const nodeKey = node.nodeKey.trim();
  return `node:${nodeKey || node.id || `index-${index}`}`;
}

function createEdgePath(sourceNodeKey: string, targetNodeKey: string) {
  return `edge:${sourceNodeKey}->${targetNodeKey}`;
}

function buildStageOrder(stages: StageDraft[]) {
  return new Map(stages.map((stage, index) => [stage.stageKey.trim(), index]));
}

function buildNodeMap(nodes: NodeDraft[]) {
  return new Map(nodes.map((node) => [node.nodeKey.trim(), node] as const));
}

function detectCycle(nodeKeys: string[], edges: EdgeDraft[]) {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const nodeKey of nodeKeys) {
    adjacency.set(nodeKey, []);
    indegree.set(nodeKey, 0);
  }

  for (const edge of edges) {
    if (!adjacency.has(edge.sourceNodeKey) || !adjacency.has(edge.targetNodeKey)) {
      continue;
    }
    adjacency.get(edge.sourceNodeKey)?.push(edge.targetNodeKey);
    indegree.set(
      edge.targetNodeKey,
      (indegree.get(edge.targetNodeKey) ?? 0) + 1
    );
  }

  const queue = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([nodeKey]) => nodeKey);
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

function collectStageIssues(draft: PipelineDraft, issues: ValidationIssue[]) {
  if (draft.stages.length === 0) {
    issues.push(
      createIssue(
        "pipeline_has_no_stages",
        "pipeline:stages",
        "至少需要一个阶段。"
      )
    );
    return;
  }

  const nodeCountByStageKey = new Map<string, number>();
  for (const node of draft.nodes) {
    const stageKey = node.stageKey.trim();
    if (!stageKey) continue;
    nodeCountByStageKey.set(stageKey, (nodeCountByStageKey.get(stageKey) ?? 0) + 1);
  }

  for (const stage of draft.stages) {
    const stageKey = stage.stageKey.trim();
    if ((nodeCountByStageKey.get(stageKey) ?? 0) > 0) {
      continue;
    }
    issues.push(
      createIssue(
        "stage_has_no_nodes",
        `stage:${stageKey}`,
        `阶段“${stage.name.trim() || stageKey}”至少需要一个可执行节点。`
      )
    );
  }
}

function collectNodeIssues(draft: PipelineDraft, issues: ValidationIssue[]) {
  draft.nodes.forEach((node, index) => {
    const nodeType = node.nodeType.trim();
    if (!nodeType) {
      issues.push(
        createIssue(
          "node_type_required",
          createNodePath(node, index),
          "节点类型不能为空。"
        )
      );
      return;
    }

    const missingRequiredFields = getMissingBuiltinRequiredFields(nodeType, node.parameters);
    for (const field of missingRequiredFields) {
      issues.push(
        createIssue(
          "node_required_parameter_missing",
          `${createNodePath(node, index)}:parameter:${field.key}`,
          `节点 ${node.nodeKey.trim() || node.id || index + 1} 缺少必填参数：${field.label}。`
        )
      );
    }
  });
}

function collectEdgeIssues(draft: PipelineDraft, issues: ValidationIssue[]) {
  const stageOrder = buildStageOrder(draft.stages);
  const nodesByKey = buildNodeMap(draft.nodes);
  const uniqueEdges: EdgeDraft[] = [];
  const seenPairs = new Set<string>();

  for (const edge of draft.edges) {
    const sourceNodeKey = edge.sourceNodeKey.trim();
    const targetNodeKey = edge.targetNodeKey.trim();
    if (!sourceNodeKey || !targetNodeKey) {
      continue;
    }

    const path = createEdgePath(sourceNodeKey, targetNodeKey);
    if (seenPairs.has(path)) {
      issues.push(
        createIssue(
          "edge_duplicate",
          path,
          `连线 ${sourceNodeKey} -> ${targetNodeKey} 重复定义。`
        )
      );
      continue;
    }
    seenPairs.add(path);

    uniqueEdges.push({
      ...edge,
      sourceNodeKey,
      targetNodeKey,
    });

    const sourceNode = nodesByKey.get(sourceNodeKey);
    const targetNode = nodesByKey.get(targetNodeKey);
    if (!sourceNode || !targetNode) {
      continue;
    }

    const sourceStageOrder = stageOrder.get(sourceNode.stageKey.trim());
    const targetStageOrder = stageOrder.get(targetNode.stageKey.trim());
    if (
      sourceStageOrder !== undefined &&
      targetStageOrder !== undefined &&
      sourceStageOrder > targetStageOrder
    ) {
      issues.push(
        createIssue(
          "edge_backward",
          path,
          `不允许从后置阶段连回前置阶段：${sourceNodeKey} -> ${targetNodeKey}。`
        )
      );
    }
  }

  const cycleNodeKeys = Array.from(nodesByKey.keys()).filter((nodeKey) => nodeKey.length > 0);
  if (cycleNodeKeys.length > 0 && detectCycle(cycleNodeKeys, uniqueEdges)) {
    issues.push(
      createIssue(
        "edge_cyclic",
        "pipeline:edges",
        "节点连线不能形成环。"
      )
    );
  }
}

export function validatePipelineEditorDraft(draft: PipelineDraft): ValidationSummary {
  const issues: ValidationIssue[] = [];

  if (!draft.name.trim()) {
    issues.push(
      createIssue(
        "pipeline_name_required",
        "pipeline:name",
        "请先填写流水线名称。"
      )
    );
  }

  collectStageIssues(draft, issues);
  collectNodeIssues(draft, issues);
  collectEdgeIssues(draft, issues);

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function buildPipelineEditorValidationSummary(
  draft: PipelineDraft
): ValidationSummary {
  const summary = validatePipelineEditorDraft(draft);
  if (!summary.ok) {
    return summary;
  }

  try {
    buildPipelineCreatePayload(draft);
    return summary;
  } catch (error) {
    return {
      ok: false,
      issues: [
        createIssue(
          "payload_build_failed",
          "pipeline:payload",
          error instanceof Error ? error.message : FALLBACK_PAYLOAD_ERROR_MESSAGE
        ),
      ],
    };
  }
}
