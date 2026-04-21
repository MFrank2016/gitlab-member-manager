import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PipelineScheduleRuntimeSnapshot, ProjectGroup } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

import { StructuredJsonEditor } from "./StructuredJsonEditor";
import {
  BUILTIN_NODE_MAP,
  BUILTIN_NODE_TYPES,
  SCHEDULE_POLICY_OPTIONS,
  createNodeDraft,
  createScheduleDraft,
  createVariableDraft,
  ensureVariableRows,
  normalizeBuiltinParameters,
  remapNodeDraftForType,
  scheduleRuntimeMessage,
  scheduleRuntimeStateLabel,
  type NodeDraft,
  type PipelineDraft,
  type ScheduleDraft,
  type VariableDraft,
} from "./draft-model";

type PipelineDraftFormProps = {
  draft: PipelineDraft;
  projectGroups: ProjectGroup[];
  scheduleRuntimeSnapshots?: PipelineScheduleRuntimeSnapshot[];
  loadingScheduleRuntime?: boolean;
  onChange: (next: PipelineDraft) => void;
  onRefreshScheduleRuntime?: () => void;
};

function splitBuiltinParameters(nodeType: string, parameters: Record<string, unknown>) {
  const builtin = BUILTIN_NODE_MAP.get(nodeType);
  if (!builtin) {
    return { builtinParameters: {}, extraParameters: parameters };
  }

  const normalized = normalizeBuiltinParameters(nodeType, parameters);
  const builtinParameters: Record<string, unknown> = {};
  const extraParameters: Record<string, unknown> = {};

  for (const field of builtin.fields) {
    builtinParameters[field.key] = normalized[field.key];
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (!(key in builtinParameters)) {
      extraParameters[key] = value;
    }
  }

  return { builtinParameters, extraParameters };
}

function mergeBuiltinParameters(
  nodeType: string,
  builtinParameters: Record<string, unknown>,
  extraParameters: Record<string, unknown>
) {
  return {
    ...extraParameters,
    ...normalizeBuiltinParameters(nodeType, builtinParameters),
  };
}

function PipelineBasicsSection({
  draft,
  onChange,
}: {
  draft: PipelineDraft;
  onChange: (next: PipelineDraft) => void;
}) {
  return (
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
          <Checkbox checked={draft.enabled} onCheckedChange={(value) => onChange({ ...draft, enabled: Boolean(value) })} />
          启用
        </label>
      </div>
    </section>
  );
}

function PipelineVariablesSection({
  variableRows,
  onAdd,
  onUpdate,
  onRemove,
}: {
  variableRows: VariableDraft[];
  onAdd: () => void;
  onUpdate: (index: number, updater: (row: VariableDraft) => VariableDraft) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">变量</h3>
          <p className="text-sm text-muted-foreground">变量会自动从节点模板中推导，也可以手动补充。</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onAdd}>
          添加变量
        </Button>
      </div>
      <div className="grid gap-2">
        {variableRows.map((row, index) => (
          <div
            key={row.id}
            data-testid="pipeline-variable-row"
            className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
          >
            <Input
              aria-label={`变量 ${index + 1} 键`}
              value={row.key}
              onChange={(event) => onUpdate(index, (current) => ({ ...current, key: event.target.value }))}
              placeholder="变量键"
            />
            <Input
              aria-label={`变量 ${index + 1} 标签`}
              value={row.label}
              onChange={(event) => onUpdate(index, (current) => ({ ...current, label: event.target.value }))}
              placeholder="变量标签"
            />
            <Input
              aria-label={`变量 ${row.key || index + 1} 默认值`}
              value={row.defaultValue}
              onChange={(event) => onUpdate(index, (current) => ({ ...current, defaultValue: event.target.value }))}
              placeholder="默认值"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={row.required}
                onCheckedChange={(value) => onUpdate(index, (current) => ({ ...current, required: Boolean(value) }))}
              />
              必填
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => onRemove(index)}
              aria-label={`删除变量 ${row.key || index + 1}`}
            >
              删除
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PipelineNodeCard({
  node,
  index,
  onUpdate,
  onMove,
  onRemove,
  disableRemove,
}: {
  node: NodeDraft;
  index: number;
  onUpdate: (index: number, updater: (node: NodeDraft) => NodeDraft) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  disableRemove: boolean;
}) {
  const builtin = BUILTIN_NODE_MAP.get(node.nodeType);
  const { builtinParameters, extraParameters } = splitBuiltinParameters(node.nodeType, node.parameters);
  const selectValue = builtin ? node.nodeType : "__custom__";

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">节点 {index + 1}</h4>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => onMove(index, -1)} disabled={index === 0}>
            上移
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onMove(index, 1)}>
            下移
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => onRemove(index)}
            disabled={disableRemove}
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
          value={selectValue}
          onChange={(event) =>
            onUpdate(index, (current) => {
              if (event.target.value === "__custom__") {
                return {
                  ...current,
                  nodeType: builtin ? "" : current.nodeType,
                  parameters: builtin ? {} : current.parameters,
                };
              }

              const nextNodeType = event.target.value;
              return remapNodeDraftForType(current, nextNodeType);
            })
          }
          aria-label={`节点 ${index + 1} 类型`}
        >
          {BUILTIN_NODE_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
          <option value="__custom__">自定义节点</option>
        </select>
      </div>

      {!builtin ? (
        <div className="grid gap-1">
          <Label>自定义节点类型</Label>
          <Input
            aria-label={`节点 ${index + 1} 自定义类型`}
            value={node.nodeType}
            onChange={(event) => onUpdate(index, (current) => ({ ...current, nodeType: event.target.value }))}
            placeholder="custom_release_gate"
          />
        </div>
      ) : null}

      {builtin ? (
        <div className="grid gap-3">
          <div className="grid gap-2">
            {builtin.fields.map((field) => (
              <div key={field.key} className="grid gap-1">
                <Label>{field.label}</Label>
                <Input
                  value={typeof builtinParameters[field.key] === "string" ? String(builtinParameters[field.key]) : ""}
                  onChange={(event) =>
                    onUpdate(index, (current) => {
                      const nextBuiltinParameters = { ...builtinParameters, [field.key]: event.target.value };
                      return {
                        ...current,
                        parameters: mergeBuiltinParameters(current.nodeType, nextBuiltinParameters, extraParameters),
                      };
                    })
                  }
                  placeholder={field.placeholder}
                  aria-label={`节点 ${index + 1} ${field.label}`}
                />
              </div>
            ))}
          </div>

          <div className="grid gap-1">
            <Label>附加参数</Label>
            <StructuredJsonEditor
              value={extraParameters}
              onChange={(nextValue) =>
                onUpdate(index, (current) => {
                  const nextExtraParameters =
                    nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)
                      ? (nextValue as Record<string, unknown>)
                      : {};
                  return {
                    ...current,
                    parameters: mergeBuiltinParameters(current.nodeType, builtinParameters, nextExtraParameters),
                  };
                })
              }
              testId={`pipeline-node-extra-parameter-editor-${index}`}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-1">
          <Label>参数</Label>
          <StructuredJsonEditor
            value={node.parameters}
              onChange={(nextValue) =>
                onUpdate(index, (current) => ({
                  ...current,
                  parameters:
                    nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)
                      ? (nextValue as Record<string, unknown>)
                      : {},
                }))
              }
            testId={`pipeline-node-structured-editor-${index}`}
          />
        </div>
      )}
    </div>
  );
}

function PipelineNodesSection({
  nodes,
  onAdd,
  onUpdate,
  onMove,
  onRemove,
}: {
  nodes: NodeDraft[];
  onAdd: () => void;
  onUpdate: (index: number, updater: (node: NodeDraft) => NodeDraft) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">节点</h3>
          <p className="text-sm text-muted-foreground">按顺序定义本地 Git 节点和远端 GitLab 节点。</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onAdd}>
          添加节点
        </Button>
      </div>
      {nodes.map((node, index) => (
        <PipelineNodeCard
          key={node.id}
          node={node}
          index={index}
          onUpdate={onUpdate}
          onMove={onMove}
          onRemove={onRemove}
          disableRemove={nodes.length <= 1}
        />
      ))}
    </section>
  );
}

function PipelineSchedulesSection({
  schedules,
  projectGroups,
  scheduleRuntimeSnapshots,
  onAdd,
  onUpdate,
  onRemove,
}: {
  schedules: ScheduleDraft[];
  projectGroups: ProjectGroup[];
  scheduleRuntimeSnapshots?: PipelineScheduleRuntimeSnapshot[];
  onAdd: () => void;
  onUpdate: (index: number, updater: (schedule: ScheduleDraft) => ScheduleDraft) => void;
  onRemove: (index: number) => void;
}) {
  const scheduleRuntimeById = new Map((scheduleRuntimeSnapshots ?? []).map((snapshot) => [snapshot.scheduleId, snapshot]));

  function getScheduleRuntimeSnapshot(schedule: ScheduleDraft) {
    return schedule.scheduleId !== null ? (scheduleRuntimeById.get(schedule.scheduleId) ?? null) : null;
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">调度</h3>
          <p className="text-sm text-muted-foreground">为流水线绑定目标项目组和调度策略。</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onAdd}>
          添加调度
        </Button>
      </div>
      <div className="grid gap-2">
        {schedules.map((schedule, index) => (
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
                onClick={() => onRemove(index)}
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
                  onChange={(event) => onUpdate(index, (current) => ({ ...current, projectGroupId: event.target.value }))}
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
                  onChange={(event) => onUpdate(index, (current) => ({ ...current, cronExpr: event.target.value }))}
                  placeholder="0 9 * * 1-5"
                  aria-label={`调度 ${index + 1} Cron`}
                />
              </div>
              <div className="grid gap-1">
                <Label>时区</Label>
                <Input
                  value={schedule.timezone}
                  onChange={(event) => onUpdate(index, (current) => ({ ...current, timezone: event.target.value }))}
                  placeholder="Asia/Shanghai"
                  aria-label={`调度 ${index + 1} 时区`}
                />
              </div>
              <div className="grid gap-1">
                <Label>策略</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={schedule.policy}
                  onChange={(event) => onUpdate(index, (current) => ({ ...current, policy: event.target.value }))}
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

            <div className="grid gap-1">
              <Label>调度变量</Label>
              <StructuredJsonEditor
                value={schedule.variables}
              onChange={(nextValue) =>
                onUpdate(index, (current) => ({
                  ...current,
                  variables:
                    nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)
                      ? (nextValue as Record<string, unknown>)
                      : {},
                }))
              }
              testId={`pipeline-schedule-variables-editor-${index}`}
            />
          </div>

            {schedule.scheduleId !== null ? (
              <div data-testid="pipeline-schedule-runtime-feedback" className="grid gap-2 rounded-md border border-border bg-background p-3 text-xs">
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">下一次触发</span>
                    <span className="font-mono">
                      {getScheduleRuntimeSnapshot(schedule)?.nextTriggerAt ?? (schedule.enabled ? "-" : "已禁用")}
                    </span>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">当前状态</span>
                    <span>{scheduleRuntimeStateLabel(getScheduleRuntimeSnapshot(schedule), schedule.enabled)}</span>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">最近更新</span>
                    <span className="font-mono">
                      {getScheduleRuntimeSnapshot(schedule)?.lastDecisionAt
                        ? formatDateTime(getScheduleRuntimeSnapshot(schedule)?.lastDecisionAt ?? null)
                        : "-"}
                    </span>
                  </div>
                </div>
                <div className="grid gap-1">
                  <span className="text-muted-foreground">说明</span>
                  <span>{scheduleRuntimeMessage(getScheduleRuntimeSnapshot(schedule), schedule.enabled)}</span>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PipelineDraftForm({
  draft,
  projectGroups,
  scheduleRuntimeSnapshots,
  onChange,
}: PipelineDraftFormProps) {
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
      <PipelineBasicsSection draft={draft} onChange={onChange} />
      <PipelineVariablesSection
        variableRows={draft.variableRows}
        onAdd={addVariable}
        onUpdate={updateVariableRow}
        onRemove={removeVariableRow}
      />
      <PipelineNodesSection nodes={draft.nodes} onAdd={addNode} onUpdate={updateNode} onMove={moveNode} onRemove={removeNode} />
      <PipelineSchedulesSection
        schedules={draft.schedules}
        projectGroups={projectGroups}
        scheduleRuntimeSnapshots={scheduleRuntimeSnapshots}
        onAdd={addSchedule}
        onUpdate={updateSchedule}
        onRemove={removeSchedule}
      />
    </div>
  );
}
