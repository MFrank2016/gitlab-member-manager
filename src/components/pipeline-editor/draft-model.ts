import {
  mergeDeclaredWorkflowVariables,
  validateDeclaredWorkflowVariables,
  type WorkflowStepLike,
} from "@/lib/workflow-definition-variables";
import type {
  PipelineDefinitionDetail,
  PipelineEdgeInput,
  PipelineNodeInput,
  PipelineScheduleRuntimeSnapshot,
  PipelineStageInput,
  PipelineVariableInput,
} from "@/lib/types";

type FieldDefinition = {
  key: string;
  label: string;
  placeholder: string;
};

type BuiltinNodeTypeDefinition = {
  value: string;
  label: string;
  fields: FieldDefinition[];
  defaults: Record<string, string>;
};

export const BUILTIN_NODE_TYPES: BuiltinNodeTypeDefinition[] = [
  {
    value: "switch_project",
    label: "切换项目",
    fields: [{ key: "managedProjectId", label: "项目", placeholder: "请选择项目" }],
    defaults: { managedProjectId: "" },
  },
  {
    value: "checkout_branch",
    label: "切换分支",
    fields: [{ key: "branch", label: "分支", placeholder: "${source_branch}" }],
    defaults: { branch: "${source_branch}" },
  },
  {
    value: "git_pull",
    label: "拉取分支",
    fields: [{ key: "branch", label: "分支", placeholder: "${target_branch}" }],
    defaults: { branch: "${target_branch}" },
  },
  {
    value: "git_merge",
    label: "合并分支",
    fields: [{ key: "from", label: "来源分支", placeholder: "${source_branch}" }],
    defaults: { from: "${source_branch}" },
  },
  {
    value: "git_push",
    label: "推送分支",
    fields: [{ key: "remote", label: "远端", placeholder: "origin" }],
    defaults: { remote: "origin" },
  },
  {
    value: "set_working_path",
    label: "设置执行路径",
    fields: [{ key: "path", label: "目标路径", placeholder: "${repo_root}/subdir 或 ../another-repo" }],
    defaults: { path: "" },
  },
  {
    value: "check_pipeline",
    label: "检查远端流水线",
    fields: [
      { key: "project", label: "GitLab 项目", placeholder: "team/service" },
      { key: "ref", label: "引用", placeholder: "${source_branch}" },
      { key: "sha", label: "提交 SHA", placeholder: "可选" },
    ],
    defaults: { project: "", ref: "${source_branch}", sha: "" },
  },
  {
    value: "trigger_pipeline",
    label: "触发远端流水线",
    fields: [
      { key: "project", label: "GitLab 项目", placeholder: "team/service" },
      { key: "ref", label: "引用", placeholder: "${target_branch}" },
    ],
    defaults: { project: "", ref: "${target_branch}" },
  },
  {
    value: "wait_pipeline",
    label: "等待远端流水线",
    fields: [
      { key: "project", label: "GitLab 项目", placeholder: "team/service" },
      { key: "ref", label: "引用", placeholder: "${target_branch}" },
      { key: "sha", label: "提交 SHA", placeholder: "可选" },
    ],
    defaults: { project: "", ref: "${target_branch}", sha: "" },
  },
];

export const BUILTIN_NODE_MAP = new Map(BUILTIN_NODE_TYPES.map((item) => [item.value, item]));

export const SCHEDULE_POLICY_OPTIONS = [
  { value: "skip_if_running", label: "运行中跳过" },
  { value: "queue_after_running", label: "运行后排队" },
  { value: "allow_parallel", label: "允许并行" },
];

export type VariableDraft = {
  id: string;
  key: string;
  label: string;
  defaultValue: string;
  required: boolean;
  source: "manual" | "inferred";
};

export type StageDraft = {
  id: string;
  stageKey: string;
  name: string;
  enabled: boolean;
};

export type NodeDraft = {
  id: string;
  nodeKey: string;
  stageKey: string;
  nodeType: string;
  parameters: Record<string, unknown>;
  position: {
    x: number;
    y: number;
  };
  enabled: boolean;
};

export type EdgeDraft = {
  id: string;
  sourceNodeKey: string;
  targetNodeKey: string;
};

export type ScheduleDraft = {
  id: string;
  scheduleId: number | null;
  projectGroupId?: string;
  cronExpr: string;
  timezone: string;
  branch: string;
  enabled: boolean;
  policy: string;
  variables: Record<string, unknown>;
};

export type PipelineDraft = {
  name: string;
  description: string;
  enabled: boolean;
  maxConcurrencyDefault: string;
  variableRows: VariableDraft[];
  stages: StageDraft[];
  nodes: NodeDraft[];
  edges: EdgeDraft[];
  schedules: ScheduleDraft[];
};

type CreateStageDraftOptions = {
  id?: string;
  stageKey?: string;
  name?: string;
  enabled?: boolean;
};

type CreateNodeDraftOptions = {
  id?: string;
  nodeKey?: string;
  stageKey?: string;
  nodeType?: string;
  parameters?: unknown;
  position?: {
    x: number;
    y: number;
  };
  enabled?: boolean;
};

let nodeDraftCounter = 0;
let variableDraftCounter = 0;
let scheduleDraftCounter = 0;
let stageDraftCounter = 0;
let edgeDraftCounter = 0;

export function resetPipelineDraftCountersForTest() {
  nodeDraftCounter = 0;
  variableDraftCounter = 0;
  scheduleDraftCounter = 0;
  stageDraftCounter = 0;
  edgeDraftCounter = 0;
}

function nextNodeDraftId() {
  nodeDraftCounter += 1;
  return `node-${nodeDraftCounter}`;
}

function nextVariableDraftId() {
  variableDraftCounter += 1;
  return `variable-${variableDraftCounter}`;
}

function nextScheduleDraftId() {
  scheduleDraftCounter += 1;
  return `schedule-${scheduleDraftCounter}`;
}

function nextStageDraftId() {
  stageDraftCounter += 1;
  return `stage-${stageDraftCounter}`;
}

function nextEdgeDraftId() {
  edgeDraftCounter += 1;
  return `edge-${edgeDraftCounter}`;
}

function toSafeKey(value: string, fallback: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function fallbackStageName(index: number) {
  return `阶段 ${index + 1}`;
}

function defaultStagePositionStageKey() {
  const id = nextStageDraftId();
  return { id, stageKey: toSafeKey(id, id) };
}

function defaultNodeKeyFromType(nodeType: string, id: string) {
  return toSafeKey(`${nodeType}_${id}`, id);
}

function buildDefaultStage() {
  const base = defaultStagePositionStageKey();
  return createStageDraft({
    id: base.id,
    stageKey: base.stageKey,
    name: "阶段 1",
    enabled: true,
  });
}

function sortStages(stages: StageDraft[]) {
  return [...stages].sort((left, right) => left.stageKey.localeCompare(right.stageKey));
}

function sortNodesByStageOrder(nodes: NodeDraft[], stages: StageDraft[]) {
  const stageOrder = new Map(stages.map((stage, index) => [stage.stageKey, index]));
  return [...nodes].sort((left, right) => {
    const leftOrder = stageOrder.get(left.stageKey) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = stageOrder.get(right.stageKey) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (left.position.y !== right.position.y) return left.position.y - right.position.y;
    if (left.position.x !== right.position.x) return left.position.x - right.position.x;
    return left.nodeKey.localeCompare(right.nodeKey);
  });
}

function buildEdgeId(sourceNodeKey: string, targetNodeKey: string) {
  return `${sourceNodeKey}->${targetNodeKey}`;
}

function detectCycle(nodeKeys: string[], edges: PipelineEdgeInput[]) {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const key of nodeKeys) {
    adjacency.set(key, []);
    indegree.set(key, 0);
  }

  for (const edge of edges) {
    adjacency.get(edge.sourceNodeKey)?.push(edge.targetNodeKey);
    indegree.set(
      edge.targetNodeKey,
      (indegree.get(edge.targetNodeKey) ?? 0) + 1
    );
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toDefaultVariableLabel(key: string) {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeBuiltinParameters(nodeType: string, parameters: Record<string, unknown>) {
  const builtin = BUILTIN_NODE_MAP.get(nodeType);
  if (!builtin) return parameters;

  const normalized: Record<string, unknown> = {};
  for (const field of builtin.fields) {
    const raw = parameters[field.key];
    normalized[field.key] =
      typeof raw === "string"
        ? raw
        : raw === undefined || raw === null
          ? (builtin.defaults[field.key] ?? "")
          : String(raw);
  }

  for (const [key, value] of Object.entries(parameters)) {
    if (!(key in normalized)) {
      normalized[key] = value;
    }
  }

  return normalized;
}

export function remapNodeDraftForType(node: NodeDraft, nextNodeType: string): NodeDraft {
  const sourceParameters = isRecord(node.parameters) ? node.parameters : {};
  const builtin = BUILTIN_NODE_MAP.get(nextNodeType);

  if (!builtin) {
    return {
      ...node,
      nodeType: nextNodeType,
      parameters: sourceParameters,
    };
  }

  const nextParameters: Record<string, unknown> = {};
  for (const field of builtin.fields) {
    const raw = sourceParameters[field.key];
    nextParameters[field.key] =
      typeof raw === "string"
        ? raw
        : raw === undefined || raw === null
          ? (builtin.defaults[field.key] ?? "")
          : String(raw);
  }

  return {
    ...node,
    nodeType: nextNodeType,
    parameters: nextParameters,
  };
}

export function createStageDraft(overrides?: CreateStageDraftOptions): StageDraft {
  const baseId = overrides?.id ?? nextStageDraftId();
  const stageKey = toSafeKey(overrides?.stageKey ?? baseId, baseId);

  return {
    id: baseId,
    stageKey,
    name: overrides?.name?.trim() || "新阶段",
    enabled: overrides?.enabled ?? true,
  };
}

export function createNodeDraft(
  nodeTypeOrOptions: string | CreateNodeDraftOptions = "checkout_branch",
  parameters: unknown = undefined
): NodeDraft {
  const options =
    typeof nodeTypeOrOptions === "string"
      ? ({
          nodeType: nodeTypeOrOptions,
          parameters,
        } satisfies CreateNodeDraftOptions)
      : nodeTypeOrOptions;

  const baseId = options.id ?? nextNodeDraftId();
  const nodeType = options.nodeType ?? "checkout_branch";
  const nodeKey = toSafeKey(
    options.nodeKey ?? defaultNodeKeyFromType(nodeType, baseId),
    baseId
  );
  const base = isRecord(options.parameters) ? options.parameters : {};

  return {
    id: baseId,
    nodeKey,
    stageKey: options.stageKey ?? "",
    nodeType,
    parameters: normalizeBuiltinParameters(nodeType, base),
    position: options.position ?? { x: 96, y: 72 },
    enabled: options.enabled ?? true,
  };
}

export function createEdgeDraft(
  sourceNodeKey: string,
  targetNodeKey: string,
  id = buildEdgeId(sourceNodeKey, targetNodeKey)
): EdgeDraft {
  return {
    id: id || nextEdgeDraftId(),
    sourceNodeKey,
    targetNodeKey,
  };
}

export function createVariableDraft(
  key: string,
  label = toDefaultVariableLabel(key),
  defaultValue = "",
  required = true,
  source: VariableDraft["source"] = "manual"
): VariableDraft {
  return {
    id: nextVariableDraftId(),
    key,
    label,
    defaultValue,
    required,
    source,
  };
}

export function createScheduleDraft(overrides?: Partial<ScheduleDraft>): ScheduleDraft {
  const variables = overrides?.variables ?? {};
  return {
    id: overrides?.id ?? nextScheduleDraftId(),
    scheduleId: overrides?.scheduleId ?? null,
    projectGroupId: overrides?.projectGroupId,
    cronExpr: overrides?.cronExpr ?? "0 9 * * 1-5",
    timezone: overrides?.timezone ?? "Asia/Shanghai",
    branch: overrides?.branch ?? "",
    enabled: overrides?.enabled ?? true,
    policy: overrides?.policy ?? "skip_if_running",
    variables,
  };
}

function pipelineNodesForVariableSync(nodes: NodeDraft[]): WorkflowStepLike[] {
  return nodes.map((node) => ({
    stepType: node.nodeType.trim(),
    parameters: BUILTIN_NODE_MAP.get(node.nodeType.trim())
      ? normalizeBuiltinParameters(node.nodeType, node.parameters)
      : node.parameters,
  }));
}

function variableRowsToDefaults(rows: VariableDraft[]) {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    result[key] = row.defaultValue;
  }
  return result;
}

export function ensureVariableRows(nodes: NodeDraft[], variableRows: VariableDraft[]) {
  const pipelineNodes = pipelineNodesForVariableSync(nodes);
  const merged = mergeDeclaredWorkflowVariables(variableRowsToDefaults(variableRows), pipelineNodes);
  const referencedKeys = new Set(Object.keys(mergeDeclaredWorkflowVariables({}, pipelineNodes)));
  const retainedRows = variableRows.filter((row) => {
    const key = row.key.trim();
    if (!key) {
      return row.source !== "inferred";
    }
    if (referencedKeys.has(key)) {
      return true;
    }
    return row.source !== "inferred";
  });
  const existingKeys = new Set(retainedRows.map((row) => row.key.trim()).filter((key) => key.length > 0));

  const appendedRows = Array.from(referencedKeys)
    .filter((key) => !existingKeys.has(key))
    .map((key) => createVariableDraft(key, toDefaultVariableLabel(key), merged[key] ?? "", true, "inferred"));

  return appendedRows.length > 0 ? [...retainedRows, ...appendedRows] : retainedRows;
}

function createDraftStageSetFromNodeKeys(nodeStageKeys: (string | null | undefined)[]) {
  const uniqueStageKeys = nodeStageKeys
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  if (uniqueStageKeys.length === 0) {
    return [buildDefaultStage()];
  }

  return Array.from(new Set(uniqueStageKeys)).map((stageKey, index) =>
    createStageDraft({
      id: stageKey,
      stageKey,
      name: fallbackStageName(index),
      enabled: true,
    })
  );
}

function ensureDraftHasStageCoverage(stages: StageDraft[], nodes: NodeDraft[]) {
  if (stages.length === 0) {
    return createDraftStageSetFromNodeKeys(nodes.map((node) => node.stageKey));
  }

  const stageKeys = new Set(stages.map((stage) => stage.stageKey));
  const uncoveredStageKeys = Array.from(
    new Set(
      nodes
        .map((node) => node.stageKey.trim())
        .filter((stageKey) => stageKey.length > 0 && !stageKeys.has(stageKey))
    )
  );

  if (uncoveredStageKeys.length === 0) {
    return stages;
  }

  return [
    ...stages,
    ...uncoveredStageKeys.map((stageKey, index) =>
      createStageDraft({
        id: stageKey,
        stageKey,
        name: fallbackStageName(stages.length + index),
        enabled: true,
      })
    ),
  ];
}

export function createEmptyPipelineDraft(): PipelineDraft {
  const stage = buildDefaultStage();
  const nodes = [
    createNodeDraft({
      stageKey: stage.stageKey,
      nodeType: "checkout_branch",
      parameters: undefined,
    }),
  ];

  return {
    name: "",
    description: "",
    enabled: true,
    maxConcurrencyDefault: "2",
    variableRows: ensureVariableRows(nodes, []),
    stages: [stage],
    nodes,
    edges: [],
    schedules: [],
  };
}

export function toDraftFromDetail(detail: PipelineDefinitionDetail): PipelineDraft {
  const stages =
    detail.stages.length > 0
      ? [...detail.stages]
          .sort((a, b) => a.stageOrder - b.stageOrder)
          .map((stage) =>
            createStageDraft({
              id: stage.stageKey,
              stageKey: stage.stageKey,
              name: stage.name,
              enabled: stage.enabled,
            })
          )
      : createDraftStageSetFromNodeKeys(detail.nodes.map((node) => node.stageKey));

  const fallbackStageKey = stages[0]?.stageKey ?? buildDefaultStage().stageKey;
  const nodes = [...detail.nodes]
    .sort((a, b) => a.nodeOrder - b.nodeOrder)
    .map((node, index) =>
      createNodeDraft({
        id: node.nodeKey?.trim() || `node-${index + 1}`,
        nodeKey: node.nodeKey?.trim() || undefined,
        stageKey: node.stageKey?.trim() || fallbackStageKey,
        nodeType: node.nodeType,
        parameters: node.parameters,
        position: {
          x: Number.isFinite(node.positionX) ? node.positionX : 96,
          y: Number.isFinite(node.positionY) ? node.positionY : 72 + index * 116,
        },
        enabled: node.enabled,
      })
    );

  const coveredStages = ensureDraftHasStageCoverage(stages, nodes);
  const stageKeySet = new Set(coveredStages.map((stage) => stage.stageKey));
  const normalizedNodes =
    nodes.length > 0
      ? nodes.map((node) => ({
          ...node,
          stageKey: stageKeySet.has(node.stageKey) ? node.stageKey : coveredStages[0]?.stageKey ?? "",
        }))
      : [
          createNodeDraft({
            stageKey: coveredStages[0]?.stageKey ?? "",
            nodeType: "checkout_branch",
          }),
        ];

  const variableRows = [...detail.variables]
    .sort((a, b) => a.variableOrder - b.variableOrder)
    .map((variable) =>
      createVariableDraft(
        variable.key,
        variable.label,
        typeof variable.defaultValue === "string" ? variable.defaultValue : "",
        variable.required
      )
    );

  const schedules = [...detail.schedules]
    .sort((a, b) => a.scheduleOrder - b.scheduleOrder)
    .map((schedule) =>
      createScheduleDraft({
        id: `schedule-${schedule.id}`,
        scheduleId: schedule.id,
        projectGroupId: schedule.projectGroupId ? String(schedule.projectGroupId) : undefined,
        cronExpr: schedule.cronExpr,
        timezone: schedule.timezone,
        branch: schedule.branch ?? "",
        enabled: schedule.enabled,
        policy: schedule.policy,
        variables: isRecord(schedule.variables) ? schedule.variables : {},
      })
    );

  const edges = detail.edges.map((edge) =>
    createEdgeDraft(edge.sourceNodeKey, edge.targetNodeKey, buildEdgeId(edge.sourceNodeKey, edge.targetNodeKey))
  );

  return {
    name: detail.name,
    description: detail.description,
    enabled: detail.enabled,
    maxConcurrencyDefault: String(detail.maxConcurrencyDefault),
    variableRows: ensureVariableRows(normalizedNodes, variableRows),
    stages: coveredStages,
    nodes: normalizedNodes,
    edges,
    schedules,
  };
}

function buildPipelineVariables(variableRows: VariableDraft[]): PipelineVariableInput[] {
  const variables: PipelineVariableInput[] = [];
  const seenKeys = new Set<string>();

  for (const row of variableRows) {
    const key = row.key.trim();
    const label = row.label.trim();
    if (!key) {
      throw new Error("变量键不能为空。");
    }
    if (!label) {
      throw new Error(`变量 ${key} 的标签不能为空。`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`变量键重复：${key}`);
    }
    seenKeys.add(key);

    variables.push({
      key,
      label,
      defaultValue: row.defaultValue,
      valueType: "string",
      required: row.required,
      options: [],
    });
  }

  return variables;
}

function buildStagePayloads(stages: StageDraft[]): PipelineStageInput[] {
  if (stages.length === 0) {
    throw new Error("至少需要一个阶段。");
  }

  const seenKeys = new Set<string>();
  return stages.map((stage, index) => {
    const stageKey = stage.stageKey.trim();
    const name = stage.name.trim();
    if (!stageKey) {
      throw new Error(`阶段 ${index + 1} 的标识不能为空。`);
    }
    if (!name) {
      throw new Error(`阶段 ${index + 1} 的名称不能为空。`);
    }
    if (seenKeys.has(stageKey)) {
      throw new Error(`阶段标识重复：${stageKey}`);
    }
    seenKeys.add(stageKey);
    return {
      stageKey,
      name,
      enabled: stage.enabled,
    };
  });
}

function buildNodePayloads(nodes: NodeDraft[], stages: StageDraft[]): PipelineNodeInput[] {
  if (nodes.length === 0) {
    throw new Error("至少需要一个流水线节点。");
  }

  const validStageKeys = new Set(stages.map((stage) => stage.stageKey.trim()));
  const seenNodeKeys = new Set<string>();

  return sortNodesByStageOrder(nodes, stages).map((node, index) => {
    const nodeType = node.nodeType.trim();
    const nodeKey = node.nodeKey.trim();
    const stageKey = node.stageKey.trim();

    if (!nodeKey) {
      throw new Error(`节点 ${index + 1} 的标识不能为空。`);
    }
    if (seenNodeKeys.has(nodeKey)) {
      throw new Error(`节点标识重复：${nodeKey}`);
    }
    seenNodeKeys.add(nodeKey);

    if (!stageKey) {
      throw new Error(`节点 ${nodeKey} 必须归属一个阶段。`);
    }
    if (!validStageKeys.has(stageKey)) {
      throw new Error(`节点 ${nodeKey} 归属了不存在的阶段：${stageKey}`);
    }
    if (!nodeType) {
      throw new Error(`节点 ${nodeKey} 的类型不能为空。`);
    }
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      throw new Error(`节点 ${nodeKey} 的位置无效。`);
    }

    const builtin = BUILTIN_NODE_MAP.get(nodeType);
    if (builtin) {
      return {
        nodeType,
        parameters: normalizeBuiltinParameters(nodeType, node.parameters),
        stageKey,
        nodeKey,
        positionX: Math.round(node.position.x),
        positionY: Math.round(node.position.y),
        enabled: node.enabled,
      };
    }

    if (!isRecord(node.parameters)) {
      throw new Error(`节点 ${nodeKey} 的参数必须是 JSON 对象。`);
    }

    return {
      nodeType,
      parameters: node.parameters,
      stageKey,
      nodeKey,
      positionX: Math.round(node.position.x),
      positionY: Math.round(node.position.y),
      enabled: node.enabled,
    };
  });
}

function buildEdgePayloads(
  edges: EdgeDraft[],
  nodes: PipelineNodeInput[],
  stages: PipelineStageInput[]
): PipelineEdgeInput[] {
  const nodeByKey = new Map(nodes.map((node) => [node.nodeKey ?? "", node]));
  const stageOrder = new Map(stages.map((stage, index) => [stage.stageKey, index]));
  const seenPairs = new Set<string>();

  const payloads = edges.map((edge, index) => {
    const sourceNodeKey = edge.sourceNodeKey.trim();
    const targetNodeKey = edge.targetNodeKey.trim();
    if (!sourceNodeKey || !targetNodeKey) {
      throw new Error(`连线 ${index + 1} 缺少源节点或目标节点。`);
    }
    if (sourceNodeKey === targetNodeKey) {
      throw new Error(`节点 ${sourceNodeKey} 不能连接到自身。`);
    }

    const pairKey = buildEdgeId(sourceNodeKey, targetNodeKey);
    if (seenPairs.has(pairKey)) {
      throw new Error(`连线重复：${sourceNodeKey} -> ${targetNodeKey}`);
    }
    seenPairs.add(pairKey);

    const sourceNode = nodeByKey.get(sourceNodeKey);
    const targetNode = nodeByKey.get(targetNodeKey);
    if (!sourceNode || !targetNode) {
      throw new Error(`连线引用了不存在的节点：${sourceNodeKey} -> ${targetNodeKey}`);
    }

    const sourceStageOrder = stageOrder.get(sourceNode.stageKey ?? "") ?? 0;
    const targetStageOrder = stageOrder.get(targetNode.stageKey ?? "") ?? 0;
    if (sourceStageOrder > targetStageOrder) {
      throw new Error(`不能从后续阶段连回前置阶段：${sourceNodeKey} -> ${targetNodeKey}`);
    }

    return {
      sourceNodeKey,
      targetNodeKey,
    };
  });

  if (detectCycle(Array.from(nodeByKey.keys()), payloads)) {
    throw new Error("节点连线不能形成环。");
  }

  return payloads;
}

function buildSchedulePayloads(schedules: ScheduleDraft[]) {
  return schedules.map((schedule, index) => {
    const cronExpr = schedule.cronExpr.trim();
    if (!cronExpr) {
      throw new Error(`调度 ${index + 1} 的 Cron 表达式不能为空。`);
    }

    const timezone = schedule.timezone.trim();
    if (!timezone) {
      throw new Error(`调度 ${index + 1} 的时区不能为空。`);
    }

    const policy = schedule.policy.trim();
    if (!policy) {
      throw new Error(`调度 ${index + 1} 的策略不能为空。`);
    }

    if (!isRecord(schedule.variables)) {
      throw new Error(`调度 ${index + 1} 的变量必须是 JSON 对象。`);
    }

    const branch = schedule.branch.trim();
    return {
      cronExpr,
      timezone,
      branch: branch || null,
      enabled: schedule.enabled,
      policy,
      variables: schedule.variables,
    };
  });
}

export function buildPipelineCreatePayload(draft: PipelineDraft) {
  const name = draft.name.trim();
  if (!name) {
    throw new Error("流水线名称不能为空。");
  }

  const maxConcurrencyDefault = Number(draft.maxConcurrencyDefault);
  if (!Number.isInteger(maxConcurrencyDefault) || maxConcurrencyDefault < 1) {
    throw new Error("默认最大并发数必须是大于等于 1 的整数。");
  }

  const stages = buildStagePayloads(draft.stages);
  const variables = buildPipelineVariables(draft.variableRows);
  const nodes = buildNodePayloads(draft.nodes, draft.stages);
  const edges = buildEdgePayloads(draft.edges, nodes, stages);
  const schedules = buildSchedulePayloads(draft.schedules);
  const missingVariables = validateDeclaredWorkflowVariables(
    Object.fromEntries(variables.map((variable) => [variable.key, variable.defaultValue ?? ""])),
    nodes.map((node) => ({ stepType: node.nodeType, parameters: node.parameters }))
  );

  if (missingVariables.length > 0) {
    throw new Error(`流水线变量未声明：${missingVariables.join(", ")}`);
  }

  return {
    name,
    description: draft.description.trim(),
    enabled: draft.enabled,
    maxConcurrencyDefault,
    variables,
    stages,
    nodes,
    edges,
    schedules,
  };
}

export function getPipelineDraftReadiness(draft: PipelineDraft) {
  if (!draft.name.trim()) {
    return {
      ready: false,
      message: "请先填写流水线名称。",
    };
  }

  try {
    const payload = buildPipelineCreatePayload(draft);
    return {
      ready: true,
      message: `已就绪：${payload.stages.length} 个阶段，${payload.nodes.length} 个节点，${payload.schedules.length} 个调度。`,
    };
  } catch (error) {
    return {
      ready: false,
      message: error instanceof Error ? error.message : "请先完善流水线配置。",
    };
  }
}

export function scheduleRuntimeStateLabel(
  snapshot: PipelineScheduleRuntimeSnapshot | null | undefined,
  enabled: boolean
) {
  if (!enabled) return "已禁用";
  switch (snapshot?.lastDecision) {
    case "started":
      return "最近已触发";
    case "queued":
      return "已排队";
    case "skipped":
      return "最近跳过";
    default:
      return "空闲";
  }
}

export function scheduleRuntimeMessage(
  snapshot: PipelineScheduleRuntimeSnapshot | null | undefined,
  enabled: boolean
) {
  if (!enabled) return "当前调度已禁用。";
  if (!snapshot) return "暂无调度运行反馈。";

  switch (snapshot.lastDecision) {
    case "started":
      return snapshot.lastDecisionMessageZh ?? "最近一次调度已经成功触发。";
    case "queued":
      return snapshot.lastDecisionMessageZh ?? "最近一次调度已进入排队。";
    case "skipped":
      return snapshot.lastDecisionMessageZh ?? "最近一次调度被跳过。";
    default:
      return snapshot.lastDecisionMessageZh ?? "调度处于空闲状态。";
  }
}
