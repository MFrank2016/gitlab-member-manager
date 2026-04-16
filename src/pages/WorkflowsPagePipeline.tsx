import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createPipelineDefinition,
  deletePipelineDefinition,
  getPipelineDefinitionDetail,
  listPipelineDefinitions,
  listProjectGroups,
  readCommandErrorMessage,
  updatePipelineDefinition,
} from "@/lib/invoke";
import {
  mergeDeclaredWorkflowVariables,
  validateDeclaredWorkflowVariables,
  type WorkflowStepLike,
} from "@/lib/workflow-definition-variables";
import type {
  PipelineDefinitionDetail,
  PipelineDefinitionListItem,
  PipelineNodeInput,
  PipelineVariableInput,
  ProjectGroup,
} from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type FieldDefinition = {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
};

type BuiltinNodeTypeDefinition = {
  value: string;
  label: string;
  fields: FieldDefinition[];
  defaults: Record<string, string>;
};

const BUILTIN_NODE_TYPES: BuiltinNodeTypeDefinition[] = [
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

const BUILTIN_NODE_MAP = new Map(BUILTIN_NODE_TYPES.map((item) => [item.value, item]));

const SCHEDULE_POLICY_OPTIONS = [
  { value: "skip_if_running", label: "运行中跳过" },
  { value: "queue_after_running", label: "运行后排队" },
  { value: "allow_parallel", label: "允许并行" },
];

type VariableDraft = {
  id: string;
  key: string;
  label: string;
  defaultValue: string;
  required: boolean;
};

type NodeDraft = {
  id: string;
  nodeType: string;
  parameters: Record<string, unknown>;
  customParametersText: string;
};

type ScheduleDraft = {
  id: string;
  projectGroupId: string;
  cronExpr: string;
  timezone: string;
  branch: string;
  enabled: boolean;
  policy: string;
  variables: Record<string, unknown>;
  variablesText: string;
};

type PipelineDraft = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string, fieldName: string): Record<string, unknown> {
  const normalized = raw.trim() || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(`${fieldName} 必须是合法的 JSON。`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${fieldName} 必须是 JSON 对象。`);
  }

  return parsed;
}

function toDefaultVariableLabel(key: string) {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeBuiltinParameters(nodeType: string, parameters: Record<string, unknown>) {
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
  return normalized;
}

function createNodeDraft(nodeType = "checkout_branch", parameters: unknown = undefined): NodeDraft {
  const base = isRecord(parameters) ? parameters : {};
  const normalizedBase = normalizeBuiltinParameters(nodeType, base);

  return {
    id: nextNodeDraftId(),
    nodeType,
    parameters: normalizedBase,
    customParametersText: JSON.stringify(normalizedBase, null, 2),
  };
}

function createVariableDraft(
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

function createScheduleDraft(projectGroupId?: number | null, overrides?: Partial<ScheduleDraft>): ScheduleDraft {
  const variables = overrides?.variables ?? {};
  return {
    id: nextScheduleDraftId(),
    projectGroupId: overrides?.projectGroupId ?? (projectGroupId ? String(projectGroupId) : ""),
    cronExpr: overrides?.cronExpr ?? "0 9 * * 1-5",
    timezone: overrides?.timezone ?? "Asia/Shanghai",
    branch: overrides?.branch ?? "",
    enabled: overrides?.enabled ?? true,
    policy: overrides?.policy ?? "skip_if_running",
    variables,
    variablesText: overrides?.variablesText ?? JSON.stringify(variables, null, 2),
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

function ensureVariableRows(nodes: NodeDraft[], variableRows: VariableDraft[]) {
  const merged = mergeDeclaredWorkflowVariables(
    variableRowsToDefaults(variableRows),
    pipelineNodesForVariableSync(nodes)
  );
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

function createEmptyPipelineDraft(): PipelineDraft {
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

function toDraftFromDetail(detail: PipelineDefinitionDetail): PipelineDraft {
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
        projectGroupId: schedule.projectGroupId ? String(schedule.projectGroupId) : "",
        cronExpr: schedule.cronExpr,
        timezone: schedule.timezone,
        branch: schedule.branch ?? "",
        enabled: schedule.enabled,
        policy: schedule.policy,
        variables: isRecord(schedule.variables) ? schedule.variables : {},
        variablesText: JSON.stringify(schedule.variables ?? {}, null, 2),
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

    return {
      nodeType,
      parameters: parseJsonObject(node.customParametersText, `节点 ${index + 1} 的参数`),
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

    const branch = schedule.branch.trim();
    return {
      projectGroupId,
      cronExpr,
      timezone,
      branch: branch || null,
      enabled: schedule.enabled,
      policy,
      variables: parseJsonObject(schedule.variablesText, `调度 ${index + 1} 的变量 JSON`),
    };
  });
}

function buildPipelineCreatePayload(draft: PipelineDraft) {
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

function PipelineDraftForm({
  draft,
  projectGroups,
  onChange,
}: {
  draft: PipelineDraft;
  projectGroups: ProjectGroup[];
  onChange: (next: PipelineDraft) => void;
}) {
  function updateDraft(next: PipelineDraft, { syncVariables = true }: { syncVariables?: boolean } = {}) {
    if (!syncVariables) {
      onChange(next);
      return;
    }

    onChange({
      ...next,
      variableRows: ensureVariableRows(next.nodes, next.variableRows),
    });
  }

  function updateNode(index: number, updater: (node: NodeDraft) => NodeDraft) {
    updateDraft({
      ...draft,
      nodes: draft.nodes.map((node, nodeIndex) => (nodeIndex === index ? updater(node) : node)),
    });
  }

  function addNode() {
    updateDraft({
      ...draft,
      nodes: [...draft.nodes, createNodeDraft("git_pull")],
    });
  }

  function removeNode(index: number) {
    updateDraft({
      ...draft,
      nodes: draft.nodes.filter((_, nodeIndex) => nodeIndex !== index),
    });
  }

  function moveNode(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.nodes.length) return;

    const nextNodes = [...draft.nodes];
    [nextNodes[index], nextNodes[target]] = [nextNodes[target], nextNodes[index]];
    updateDraft({ ...draft, nodes: nextNodes });
  }

  function updateNodeType(index: number, nodeType: string) {
    updateNode(index, (node) => {
      const nextParameters = normalizeBuiltinParameters(nodeType, node.parameters);
      return {
        ...node,
        nodeType,
        parameters: nextParameters,
        customParametersText: JSON.stringify(nextParameters, null, 2),
      };
    });
  }

  function updateBuiltinField(index: number, key: string, value: string) {
    updateNode(index, (node) => {
      const parameters = { ...node.parameters, [key]: value };
      return {
        ...node,
        parameters,
        customParametersText: JSON.stringify(parameters, null, 2),
      };
    });
  }

  function updateCustomText(index: number, value: string) {
    updateNode(index, (node) => {
      let parameters = node.parameters;
      try {
        parameters = parseJsonObject(value, "节点参数");
      } catch {
        // Keep last valid state while the user edits invalid JSON.
      }

      return {
        ...node,
        parameters,
        customParametersText: value,
      };
    });
  }

  function addVariable() {
    updateDraft(
      {
        ...draft,
        variableRows: [...draft.variableRows, createVariableDraft("")],
      },
      { syncVariables: false }
    );
  }

  function updateVariableRow(index: number, updater: (row: VariableDraft) => VariableDraft) {
    updateDraft(
      {
        ...draft,
        variableRows: draft.variableRows.map((row, rowIndex) => (rowIndex === index ? updater(row) : row)),
      },
      { syncVariables: false }
    );
  }

  function removeVariableRow(index: number) {
    updateDraft(
      {
        ...draft,
        variableRows: draft.variableRows.filter((_, rowIndex) => rowIndex !== index),
      },
      { syncVariables: false }
    );
  }

  function addSchedule() {
    updateDraft(
      {
        ...draft,
        schedules: [...draft.schedules, createScheduleDraft(projectGroups[0]?.id ?? null)],
      },
      { syncVariables: false }
    );
  }

  function updateSchedule(index: number, updater: (schedule: ScheduleDraft) => ScheduleDraft) {
    updateDraft(
      {
        ...draft,
        schedules: draft.schedules.map((schedule, scheduleIndex) =>
          scheduleIndex === index ? updater(schedule) : schedule
        ),
      },
      { syncVariables: false }
    );
  }

  function removeSchedule(index: number) {
    updateDraft(
      {
        ...draft,
        schedules: draft.schedules.filter((_, scheduleIndex) => scheduleIndex !== index),
      },
      { syncVariables: false }
    );
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">基础信息</h3>
          <p className="text-sm text-muted-foreground">定义流水线名称、描述和默认并发策略。</p>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="pipeline-name-input">流水线名称</Label>
          <Input
            id="pipeline-name-input"
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            placeholder="流水线名称"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="pipeline-description-input">描述</Label>
          <Input
            id="pipeline-description-input"
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            placeholder="可选描述"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="pipeline-max-concurrency-input">默认最大并发数</Label>
            <Input
              id="pipeline-max-concurrency-input"
              type="number"
              min={1}
              value={draft.maxConcurrencyDefault}
              onChange={(event) => onChange({ ...draft, maxConcurrencyDefault: event.target.value })}
            />
          </div>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.enabled}
              onCheckedChange={(value) => onChange({ ...draft, enabled: Boolean(value) })}
            />
            启用
          </label>
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">变量</h3>
            <p className="text-sm text-muted-foreground">变量会自动从节点模板中推导，也可以手动补充。</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={addVariable}>
            添加变量
          </Button>
        </div>
        <div className="grid gap-2">
          {draft.variableRows.map((row, index) => (
            <div
              key={row.id}
              data-testid="pipeline-variable-row"
              className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
            >
              <Input
                aria-label={`变量 ${index + 1} 键`}
                value={row.key}
                onChange={(event) =>
                  updateVariableRow(index, (current) => ({ ...current, key: event.target.value }))
                }
                placeholder="变量键"
              />
              <Input
                aria-label={`变量 ${index + 1} 标签`}
                value={row.label}
                onChange={(event) =>
                  updateVariableRow(index, (current) => ({ ...current, label: event.target.value }))
                }
                placeholder="变量标签"
              />
              <Input
                aria-label={`变量 ${row.key || index + 1} 默认值`}
                value={row.defaultValue}
                onChange={(event) =>
                  updateVariableRow(index, (current) => ({ ...current, defaultValue: event.target.value }))
                }
                placeholder="默认值"
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={row.required}
                  onCheckedChange={(value) =>
                    updateVariableRow(index, (current) => ({ ...current, required: Boolean(value) }))
                  }
                />
                必填
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => removeVariableRow(index)}
                aria-label={`删除变量 ${row.key || index + 1}`}
              >
                删除
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">节点</h3>
            <p className="text-sm text-muted-foreground">按顺序定义本地 Git 节点和远端 GitLab 节点。</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={addNode}>
            添加节点
          </Button>
        </div>
        {draft.nodes.map((node, index) => {
          const builtin = BUILTIN_NODE_MAP.get(node.nodeType);
          const hasCustomOption = Boolean(node.nodeType) && !builtin;

          return (
            <div key={node.id} className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">节点 {index + 1}</h4>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveNode(index, -1)}
                    disabled={index === 0}
                    aria-label={`节点 ${index + 1} 上移`}
                  >
                    上移
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveNode(index, 1)}
                    disabled={index === draft.nodes.length - 1}
                    aria-label={`节点 ${index + 1} 下移`}
                  >
                    下移
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => removeNode(index)}
                    disabled={draft.nodes.length <= 1}
                    aria-label={`删除节点 ${index + 1}`}
                  >
                    删除
                  </Button>
                </div>
              </div>
              <div className="grid gap-1">
                <Label>节点类型</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={node.nodeType}
                  onChange={(event) => updateNodeType(index, event.target.value)}
                  aria-label={`节点 ${index + 1} 类型`}
                >
                  {BUILTIN_NODE_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                  {hasCustomOption && <option value={node.nodeType}>{node.nodeType}</option>}
                </select>
              </div>
              {builtin ? (
                <div className="grid gap-2">
                  {builtin.fields.map((field) => (
                    <div key={field.key} className="grid gap-1">
                      <Label>{field.label}</Label>
                      <Input
                        value={typeof node.parameters[field.key] === "string" ? String(node.parameters[field.key]) : ""}
                        onChange={(event) => updateBuiltinField(index, field.key, event.target.value)}
                        placeholder={field.placeholder}
                        aria-label={`节点 ${index + 1} ${field.label}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-1">
                  <Label>参数（JSON 对象）</Label>
                  <textarea
                    className="min-h-24 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={node.customParametersText}
                    onChange={(event) => updateCustomText(index, event.target.value)}
                    aria-label={`节点 ${index + 1} 参数 JSON`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">调度</h3>
            <p className="text-sm text-muted-foreground">为流水线绑定目标项目组和调度策略。</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={addSchedule}>
            添加调度
          </Button>
        </div>
        <div className="grid gap-2">
          {draft.schedules.map((schedule, index) => (
            <div
              key={schedule.id}
              data-testid="pipeline-schedule-row"
              className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">调度 {index + 1}</h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => removeSchedule(index)}
                  aria-label={`删除调度 ${index + 1}`}
                >
                  删除
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <Label>目标项目组</Label>
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={schedule.projectGroupId}
                    onChange={(event) =>
                      updateSchedule(index, (current) => ({ ...current, projectGroupId: event.target.value }))
                    }
                    aria-label={`调度 ${index + 1} 目标项目组`}
                  >
                    <option value="">请选择项目组</option>
                    {projectGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label>Cron</Label>
                  <Input
                    value={schedule.cronExpr}
                    onChange={(event) =>
                      updateSchedule(index, (current) => ({ ...current, cronExpr: event.target.value }))
                    }
                    placeholder="0 9 * * 1-5"
                    aria-label={`调度 ${index + 1} Cron`}
                  />
                </div>
                <div className="grid gap-1">
                  <Label>时区</Label>
                  <Input
                    value={schedule.timezone}
                    onChange={(event) =>
                      updateSchedule(index, (current) => ({ ...current, timezone: event.target.value }))
                    }
                    placeholder="Asia/Shanghai"
                    aria-label={`调度 ${index + 1} 时区`}
                  />
                </div>
                <div className="grid gap-1">
                  <Label>策略</Label>
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={schedule.policy}
                    onChange={(event) =>
                      updateSchedule(index, (current) => ({ ...current, policy: event.target.value }))
                    }
                    aria-label={`调度 ${index + 1} 策略`}
                  >
                    {SCHEDULE_POLICY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function WorkflowsPagePipeline() {
  const [items, setItems] = React.useState<PipelineDefinitionListItem[]>([]);
  const [projectGroups, setProjectGroups] = React.useState<ProjectGroup[]>([]);
  const [loading, setLoading] = React.useState(false);
  const editRequestTokenRef = React.useRef(0);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createDraft, setCreateDraft] = React.useState<PipelineDraft>(createEmptyPipelineDraft);
  const [creating, setCreating] = React.useState(false);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editDraft, setEditDraft] = React.useState<PipelineDraft>(createEmptyPipelineDraft);
  const [editingItem, setEditingItem] = React.useState<PipelineDefinitionListItem | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function refresh({ silent = false }: { silent?: boolean } = {}): Promise<boolean> {
    setLoading(true);
    try {
      const [nextItems, nextProjectGroups] = await Promise.all([
        listPipelineDefinitions(),
        listProjectGroups(),
      ]);
      setItems(nextItems);
      setProjectGroups(nextProjectGroups);
      return true;
    } catch (error) {
      if (!silent) {
        toast.error(readCommandErrorMessage(error, "加载流水线定义失败。"));
      }
      setItems([]);
      setProjectGroups([]);
      return false;
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refresh();
  }, []);

  async function onCreate() {
    let payload: ReturnType<typeof buildPipelineCreatePayload>;
    try {
      payload = buildPipelineCreatePayload(createDraft);
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "创建流水线前校验失败。"));
      return;
    }

    setCreating(true);
    try {
      await createPipelineDefinition(payload);
      setCreateOpen(false);
      setCreateDraft(createEmptyPipelineDraft());
      if (await refresh({ silent: true })) {
        toast.success("流水线已创建。");
      }
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "创建流水线失败。"));
    } finally {
      setCreating(false);
    }
  }

  async function startEdit(item: PipelineDefinitionListItem) {
    const requestToken = editRequestTokenRef.current + 1;
    editRequestTokenRef.current = requestToken;
    try {
      const detail = await getPipelineDefinitionDetail(item.id);
      if (requestToken !== editRequestTokenRef.current) return;
      setEditingItem(item);
      setEditDraft(toDraftFromDetail(detail));
      setEditOpen(true);
    } catch (error) {
      if (requestToken !== editRequestTokenRef.current) return;
      toast.error(readCommandErrorMessage(error, "加载流水线详情失败。"));
    }
  }

  async function onSaveEdit() {
    if (!editingItem) return;
    let payload: ReturnType<typeof buildPipelineCreatePayload>;
    try {
      payload = buildPipelineCreatePayload(editDraft);
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "更新流水线前校验失败。"));
      return;
    }

    setSaving(true);
    try {
      await updatePipelineDefinition({ id: editingItem.id, ...payload });
      setEditOpen(false);
      setEditingItem(null);
      if (await refresh({ silent: true })) {
        toast.success("流水线已更新。");
      }
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "更新流水线失败。"));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(item: PipelineDefinitionListItem) {
    if (!confirm(`确定删除流水线“${item.name}”吗？`)) return;
    try {
      await deletePipelineDefinition(item.id);
      if (await refresh({ silent: true })) {
        toast.success("流水线已删除。");
      }
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "删除流水线失败。"));
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">流水线定义</h2>
            <p className="text-sm text-muted-foreground">
              为项目分组定义可复用的发布流水线，统一管理变量、节点和调度规则。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
              刷新
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>新建流水线</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
                <DialogHeader>
                  <DialogTitle>新建流水线定义</DialogTitle>
                  <DialogDescription>配置节点顺序、变量和调度策略。</DialogDescription>
                </DialogHeader>
                <PipelineDraftForm draft={createDraft} projectGroups={projectGroups} onChange={setCreateDraft} />
                <DialogFooter>
                  <Button variant="secondary" type="button" onClick={() => setCreateDraft(createEmptyPipelineDraft())}>
                    清空
                  </Button>
                  <Button type="button" onClick={() => void onCreate()} disabled={creating}>
                    创建
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </PanelHeader>
        <PanelBody>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>节点数</TableHead>
                <TableHead>调度数</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono">{item.id}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div>{item.name}</div>
                      {item.legacyWorkflowDefinitionId ? (
                        <p className="text-xs text-muted-foreground">迁移自工作流 #{item.legacyWorkflowDefinitionId}</p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{item.enabled ? "启用" : "禁用"}</TableCell>
                  <TableCell>{item.nodesCount}</TableCell>
                  <TableCell>{item.schedulesCount}</TableCell>
                  <TableCell className="font-mono text-xs">{formatDateTime(item.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void startEdit(item)}>
                        编辑
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void onDelete(item)}>
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {loading ? "加载中..." : "暂无流水线定义。"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>编辑流水线定义</DialogTitle>
            <DialogDescription>更新基础信息、节点顺序和调度规则。</DialogDescription>
          </DialogHeader>
          <PipelineDraftForm draft={editDraft} projectGroups={projectGroups} onChange={setEditDraft} />
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={() => void onSaveEdit()} disabled={saving}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
