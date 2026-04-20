import {
  mergeDeclaredWorkflowVariables,
  validateDeclaredWorkflowVariables,
  type WorkflowStepLike,
} from "@/lib/workflow-definition-variables";
import type {
  PipelineDefinitionDetail,
  PipelineNodeInput,
  PipelineScheduleRuntimeSnapshot,
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
    fields: [{ key: "remote", label: "远程", placeholder: "origin" }],
    defaults: { remote: "origin" },
  },
  {
    value: "set_working_path",
    label: "设置执行路径",
    fields: [
      {
        key: "path",
        label: "目标路径",
        placeholder: "${repo_root}/subdir 或 ../another-repo",
      },
    ],
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
};

export type NodeDraft = {
  id: string;
  nodeType: string;
  parameters: Record<string, unknown>;
};

export type ScheduleDraft = {
  id: string;
  scheduleId: number | null;
  projectGroupId: string;
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
  nodes: NodeDraft[];
  schedules: ScheduleDraft[];
};

let nodeDraftCounter = 0;
let variableDraftCounter = 0;
let scheduleDraftCounter = 0;

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

export function createNodeDraft(nodeType = "checkout_branch", parameters: unknown = undefined): NodeDraft {
  const base = isRecord(parameters) ? parameters : {};
  return {
    id: nextNodeDraftId(),
    nodeType,
    parameters: normalizeBuiltinParameters(nodeType, base),
  };
}

export function createVariableDraft(
  key: string,
  label = toDefaultVariableLabel(key),
  defaultValue = "",
  required = true
): VariableDraft {
  return {
    id: nextVariableDraftId(),
    key,
    label,
    defaultValue,
    required,
  };
}

export function createScheduleDraft(projectGroupId?: number | null, overrides?: Partial<ScheduleDraft>): ScheduleDraft {
  const variables = overrides?.variables ?? {};
  return {
    id: nextScheduleDraftId(),
    scheduleId: overrides?.scheduleId ?? null,
    projectGroupId: overrides?.projectGroupId ?? (projectGroupId ? String(projectGroupId) : ""),
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
  const merged = mergeDeclaredWorkflowVariables(variableRowsToDefaults(variableRows), pipelineNodesForVariableSync(nodes));
  const existingKeys = new Set(
    variableRows
      .map((row) => row.key.trim())
      .filter((key) => key.length > 0)
  );

  const appendedRows = Object.keys(merged)
    .filter((key) => !existingKeys.has(key))
    .map((key) => createVariableDraft(key, toDefaultVariableLabel(key), merged[key] ?? ""));

  return appendedRows.length > 0 ? [...variableRows, ...appendedRows] : variableRows;
}

export function createEmptyPipelineDraft(): PipelineDraft {
  const nodes = [createNodeDraft()];
  return {
    name: "",
    description: "",
    enabled: true,
    maxConcurrencyDefault: "2",
    variableRows: ensureVariableRows(nodes, []),
    nodes,
    schedules: [],
  };
}

export function toDraftFromDetail(detail: PipelineDefinitionDetail): PipelineDraft {
  const nodes = [...detail.nodes]
    .sort((a, b) => a.nodeOrder - b.nodeOrder)
    .map((node) => createNodeDraft(node.nodeType, node.parameters));
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
      createScheduleDraft(schedule.projectGroupId, {
        scheduleId: schedule.id,
        projectGroupId: schedule.projectGroupId ? String(schedule.projectGroupId) : "",
        cronExpr: schedule.cronExpr,
        timezone: schedule.timezone,
        branch: schedule.branch ?? "",
        enabled: schedule.enabled,
        policy: schedule.policy,
        variables: isRecord(schedule.variables) ? schedule.variables : {},
      })
    );

  return {
    name: detail.name,
    description: detail.description,
    enabled: detail.enabled,
    maxConcurrencyDefault: String(detail.maxConcurrencyDefault),
    variableRows: ensureVariableRows(nodes, variableRows),
    nodes: nodes.length > 0 ? nodes : [createNodeDraft()],
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

function buildNodePayloads(nodes: NodeDraft[]): PipelineNodeInput[] {
  if (nodes.length === 0) {
    throw new Error("至少需要一个流水线节点。");
  }

  return nodes.map((node, index) => {
    const nodeType = node.nodeType.trim();
    if (!nodeType) {
      throw new Error(`节点 ${index + 1} 的类型不能为空。`);
    }

    const builtin = BUILTIN_NODE_MAP.get(nodeType);
    if (builtin) {
      return {
        nodeType,
        parameters: normalizeBuiltinParameters(nodeType, node.parameters),
      };
    }

    if (!isRecord(node.parameters)) {
      throw new Error(`节点 ${index + 1} 的参数必须是 JSON 对象。`);
    }

    return {
      nodeType,
      parameters: node.parameters,
    };
  });
}

function buildSchedulePayloads(schedules: ScheduleDraft[]) {
  return schedules.map((schedule, index) => {
    const projectGroupId = Number(schedule.projectGroupId);
    if (!Number.isInteger(projectGroupId) || projectGroupId < 1) {
      throw new Error(`调度 ${index + 1} 的目标项目组不能为空。`);
    }

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
      projectGroupId,
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

  const variables = buildPipelineVariables(draft.variableRows);
  const nodes = buildNodePayloads(draft.nodes);
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
    nodes,
    schedules,
  };
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
  if (snapshot?.lastDecisionMessageZh) {
    return snapshot.lastDecisionMessageZh;
  }
  if (!enabled) {
    return "调度已禁用，不会自动触发。";
  }
  return "暂无运行时反馈，可点击“刷新调度状态”查看最新结果。";
}
