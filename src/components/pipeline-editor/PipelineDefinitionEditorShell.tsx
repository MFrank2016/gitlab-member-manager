import * as React from "react";

import { PipelineGraphEditor } from "@/components/pipeline-graph/PipelineGraphEditor";
import {
  PipelineBasicsSection,
  PipelineSchedulesSection,
  PipelineVariablesSection,
} from "@/components/pipeline-editor/PipelineDraftForm";
import type { PipelineDraft } from "@/components/pipeline-editor/draft-model";
import type { ValidationSummary } from "@/components/pipeline-editor/editor-validation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ManagedProject,
  PipelineScheduleRuntimeSnapshot,
} from "@/lib/types";

type EditorTab = "canvas" | "variables" | "schedules" | "basics";

export type PipelineDefinitionEditorShellProps = {
  mode: "create" | "edit";
  draft: PipelineDraft;
  managedProjects?: ManagedProject[];
  scheduleRuntimeSnapshots?: PipelineScheduleRuntimeSnapshot[];
  dirty: boolean;
  saving: boolean;
  validating: boolean;
  validationSummary?: ValidationSummary | null;
  onChange: (next: PipelineDraft) => void;
  onBack: () => void;
  onSave: () => void;
  onValidate: () => void;
};

function ShellPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-background p-4 ${className}`}>
      {children}
    </div>
  );
}

export function PipelineDefinitionEditorShell(
  props: PipelineDefinitionEditorShellProps
) {
  const {
    mode,
    draft,
    managedProjects = [],
    scheduleRuntimeSnapshots,
    dirty,
    saving,
    validating,
    validationSummary = null,
    onChange,
    onBack,
    onSave,
    onValidate,
  } = props;
  const [activeTab, setActiveTab] = React.useState<EditorTab>("canvas");

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              返回列表
            </Button>
            <h2 className="text-lg font-semibold">
              {mode === "create" ? "新建流水线定义" : "编辑流水线定义"}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {dirty ? "有未保存变更" : "所有修改已保存"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onValidate}
            disabled={validating}
          >
            {validating ? "校验中..." : "校验"}
          </Button>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </header>

      {validationSummary ? (
        <div
          role={validationSummary.ok ? "status" : "alert"}
          className={`rounded-xl border p-4 ${
            validationSummary.ok
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-destructive/40 bg-destructive/5"
          }`}
        >
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">
              {validationSummary.ok
                ? "校验通过"
                : `发现 ${validationSummary.issues.length} 个阻塞问题`}
            </h3>
            <p className="text-sm text-muted-foreground">
              {validationSummary.ok
                ? "当前定义已满足最小保存条件。"
                : "请先处理以下问题，再执行保存。"}
            </p>
          </div>
          {validationSummary.ok ? null : (
            <ul
              data-testid="pipeline-editor-validation-list"
              className="mt-3 list-disc space-y-1 pl-5 text-sm"
            >
              {validationSummary.issues.map((issue, index) => (
                <li key={`${issue.code}:${issue.path}:${index}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as EditorTab)}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <TabsList className="h-auto w-full justify-start gap-1 rounded-xl p-1">
          <TabsTrigger value="canvas">画布</TabsTrigger>
          <TabsTrigger value="variables">变量</TabsTrigger>
          <TabsTrigger value="schedules">调度</TabsTrigger>
          <TabsTrigger value="basics">基础信息</TabsTrigger>
        </TabsList>

        <TabsContent value="canvas" className="min-h-0 flex-1">
          <ShellPanel className="h-full min-h-[480px]">
            <PipelineGraphEditor
              draft={draft}
              managedProjects={managedProjects}
              onChange={onChange}
            />
          </ShellPanel>
        </TabsContent>

        <TabsContent value="variables">
          <ShellPanel>
            <PipelineVariablesSection draft={draft} onChange={onChange} />
          </ShellPanel>
        </TabsContent>

        <TabsContent value="schedules">
          <ShellPanel>
            <PipelineSchedulesSection
              draft={draft}
              scheduleRuntimeSnapshots={scheduleRuntimeSnapshots}
              onChange={onChange}
            />
          </ShellPanel>
        </TabsContent>

        <TabsContent value="basics">
          <ShellPanel>
            <PipelineBasicsSection draft={draft} onChange={onChange} />
          </ShellPanel>
        </TabsContent>
      </Tabs>
    </section>
  );
}
