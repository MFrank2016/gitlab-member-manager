import * as React from "react";

import { PipelineGraphEditor } from "@/components/pipeline-graph/PipelineGraphEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ManagedProject,
  PipelineScheduleRuntimeSnapshot,
  ProjectGroup,
} from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

import { StructuredJsonEditor } from "./StructuredJsonEditor";
import {
  SCHEDULE_POLICY_OPTIONS,
  createScheduleDraft,
  createVariableDraft,
  scheduleRuntimeMessage,
  scheduleRuntimeStateLabel,
  type PipelineDraft,
  type ScheduleDraft,
  type VariableDraft,
} from "./draft-model";

export type PipelineDraftFormProps = {
  draft: PipelineDraft;
  managedProjects?: ManagedProject[];
  projectGroups: ProjectGroup[];
  scheduleRuntimeSnapshots?: PipelineScheduleRuntimeSnapshot[];
  loadingScheduleRuntime?: boolean;
  onChange: (next: PipelineDraft) => void;
  onRefreshScheduleRuntime?: () => void;
};

export type PipelineBasicsSectionProps = {
  draft: PipelineDraft;
  onChange: (next: PipelineDraft) => void;
};

export type PipelineVariablesSectionProps = {
  draft: PipelineDraft;
  onChange: (next: PipelineDraft) => void;
};

export type PipelineSchedulesSectionProps = {
  draft: PipelineDraft;
  scheduleRuntimeSnapshots?: PipelineScheduleRuntimeSnapshot[];
  onChange: (next: PipelineDraft) => void;
};

function appendVariableRow(draft: PipelineDraft) {
  return {
    ...draft,
    variableRows: [...draft.variableRows, createVariableDraft("")],
  };
}

function patchVariableRow(
  draft: PipelineDraft,
  index: number,
  updater: (row: VariableDraft) => VariableDraft
) {
  return {
    ...draft,
    variableRows: draft.variableRows.map((row, rowIndex) =>
      rowIndex === index ? { ...updater(row), source: "manual" } : row
    ),
  };
}

function deleteVariableRow(draft: PipelineDraft, index: number) {
  return {
    ...draft,
    variableRows: draft.variableRows.filter((_, rowIndex) => rowIndex !== index),
  };
}

function appendSchedule(draft: PipelineDraft) {
  return {
    ...draft,
    schedules: [...draft.schedules, createScheduleDraft()],
  };
}

function patchSchedule(
  draft: PipelineDraft,
  index: number,
  updater: (schedule: ScheduleDraft) => ScheduleDraft
) {
  return {
    ...draft,
    schedules: draft.schedules.map((schedule, scheduleIndex) =>
      scheduleIndex === index ? updater(schedule) : schedule
    ),
  };
}

function deleteSchedule(draft: PipelineDraft, index: number) {
  return {
    ...draft,
    schedules: draft.schedules.filter((_, scheduleIndex) => scheduleIndex !== index),
  };
}

export function PipelineBasicsSection({
  draft,
  onChange,
}: PipelineBasicsSectionProps) {
  return (
    <section className="grid gap-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">基础信息</h3>
        <p className="text-sm text-muted-foreground">
          定义流水线名称、描述和默认并发策略。
        </p>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="pipeline-name-input">流水线名称</Label>
        <Input
          id="pipeline-name-input"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="发布主干回归"
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
            onChange={(event) =>
              onChange({ ...draft, maxConcurrencyDefault: event.target.value })
            }
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
  );
}

export function PipelineVariablesSection({
  draft,
  onChange,
}: PipelineVariablesSectionProps) {
  function addVariable() {
    onChange(appendVariableRow(draft));
  }

  function updateVariableRow(
    index: number,
    updater: (row: VariableDraft) => VariableDraft
  ) {
    onChange(patchVariableRow(draft, index, updater));
  }

  function removeVariableRow(index: number) {
    onChange(deleteVariableRow(draft, index));
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">变量</h3>
          <p className="text-sm text-muted-foreground">
            变量会自动从节点模板中推导，也可以手动补充。
          </p>
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
                updateVariableRow(index, (current) => ({
                  ...current,
                  key: event.target.value,
                }))
              }
              placeholder="source_branch"
            />
            <Input
              aria-label={`变量 ${index + 1} 标签`}
              value={row.label}
              onChange={(event) =>
                updateVariableRow(index, (current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
              placeholder="Source Branch"
            />
            <Input
              aria-label={`变量 ${row.key || index + 1} 默认值`}
              value={row.defaultValue}
              onChange={(event) =>
                updateVariableRow(index, (current) => ({
                  ...current,
                  defaultValue: event.target.value,
                }))
              }
              placeholder="默认值"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={row.required}
                onCheckedChange={(value) =>
                  updateVariableRow(index, (current) => ({
                    ...current,
                    required: Boolean(value),
                  }))
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
  );
}

export function PipelineSchedulesSection({
  draft,
  scheduleRuntimeSnapshots,
  onChange,
}: PipelineSchedulesSectionProps) {
  const scheduleRuntimeById = new Map(
    (scheduleRuntimeSnapshots ?? []).map((snapshot) => [snapshot.scheduleId, snapshot])
  );

  function addSchedule() {
    onChange(appendSchedule(draft));
  }

  function updateSchedule(
    index: number,
    updater: (schedule: ScheduleDraft) => ScheduleDraft
  ) {
    onChange(patchSchedule(draft, index, updater));
  }

  function removeSchedule(index: number) {
    onChange(deleteSchedule(draft, index));
  }

  function getScheduleRuntimeSnapshot(schedule: ScheduleDraft) {
    return schedule.scheduleId !== null
      ? (scheduleRuntimeById.get(schedule.scheduleId) ?? null)
      : null;
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">调度</h3>
          <p className="text-sm text-muted-foreground">
            配置 Cron、策略和调度变量；执行目标由流程图中的节点决定。
          </p>
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
                <Label>Cron</Label>
                <Input
                  value={schedule.cronExpr}
                  onChange={(event) =>
                    updateSchedule(index, (current) => ({
                      ...current,
                      cronExpr: event.target.value,
                    }))
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
                    updateSchedule(index, (current) => ({
                      ...current,
                      timezone: event.target.value,
                    }))
                  }
                  placeholder="Asia/Shanghai"
                  aria-label={`调度 ${index + 1} 时区`}
                />
              </div>
              <div className="grid gap-1">
                <Label>引用分支</Label>
                <Input
                  value={schedule.branch}
                  onChange={(event) =>
                    updateSchedule(index, (current) => ({
                      ...current,
                      branch: event.target.value,
                    }))
                  }
                  placeholder="留空表示按节点配置执行"
                  aria-label={`调度 ${index + 1} 引用分支`}
                />
              </div>
              <div className="grid gap-1">
                <Label>策略</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={schedule.policy}
                  onChange={(event) =>
                    updateSchedule(index, (current) => ({
                      ...current,
                      policy: event.target.value,
                    }))
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

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={schedule.enabled}
                onCheckedChange={(value) =>
                  updateSchedule(index, (current) => ({
                    ...current,
                    enabled: Boolean(value),
                  }))
                }
              />
              启用此调度
            </label>

            <div className="grid gap-1">
              <Label>调度变量</Label>
              <StructuredJsonEditor
                value={schedule.variables}
                onChange={(nextValue) =>
                  updateSchedule(index, (current) => ({
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
              <div
                data-testid="pipeline-schedule-runtime-feedback"
                className="grid gap-2 rounded-md border border-border bg-background p-3 text-xs"
              >
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">下一次触发</span>
                    <span className="font-mono">
                      {getScheduleRuntimeSnapshot(schedule)?.nextTriggerAt ??
                        (schedule.enabled ? "-" : "已禁用")}
                    </span>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">当前状态</span>
                    <span>
                      {scheduleRuntimeStateLabel(
                        getScheduleRuntimeSnapshot(schedule),
                        schedule.enabled
                      )}
                    </span>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">最近更新</span>
                    <span className="font-mono">
                      {getScheduleRuntimeSnapshot(schedule)?.lastDecisionAt
                        ? formatDateTime(
                            getScheduleRuntimeSnapshot(schedule)?.lastDecisionAt ?? null
                          )
                        : "-"}
                    </span>
                  </div>
                </div>
                <div className="grid gap-1">
                  <span className="text-muted-foreground">说明</span>
                  <span>
                    {scheduleRuntimeMessage(
                      getScheduleRuntimeSnapshot(schedule),
                      schedule.enabled
                    )}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PipelineDraftForm(props: PipelineDraftFormProps) {
  const {
    draft,
    managedProjects = [],
    projectGroups: _projectGroups,
    scheduleRuntimeSnapshots,
    onChange,
  } = props;

  return (
    <div className="grid gap-6">
      <PipelineBasicsSection draft={draft} onChange={onChange} />
      <PipelineVariablesSection draft={draft} onChange={onChange} />
      <PipelineGraphEditor
        draft={draft}
        managedProjects={managedProjects}
        onChange={onChange}
      />
      <PipelineSchedulesSection
        draft={draft}
        scheduleRuntimeSnapshots={scheduleRuntimeSnapshots}
        onChange={onChange}
      />
    </div>
  );
}
