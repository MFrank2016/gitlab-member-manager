import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  cancelWorkflowRun,
  getWorkflowRunDetail,
  listWorkflowRuns,
  retryFailedWorkflowRun,
} from "@/lib/invoke";
import type { WorkflowRunDetail, WorkflowRunListItem, WorkflowRunProject } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

const RUN_STATUS_CLASS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-700",
  cancelling: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  partial_failed: "bg-orange-100 text-orange-700",
  cancelled: "bg-zinc-200 text-zinc-700",
};

const PROJECT_STATUS_CLASS: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-700",
  success: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-zinc-200 text-zinc-700",
  failed_precheck: "bg-orange-100 text-orange-700",
};

const STEP_STATUS_CLASS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-700",
  success: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-zinc-200 text-zinc-700",
  cancelled: "bg-zinc-200 text-zinc-700",
};

const STATUS_TEXT: Record<string, string> = {
  pending: "待处理",
  running: "运行中",
  cancelling: "取消中",
  completed: "已完成",
  partial_failed: "部分失败",
  cancelled: "已取消",
  queued: "排队中",
  success: "成功",
  failed: "失败",
  failed_precheck: "预检查失败",
  skipped: "已跳过",
};

const TRIGGER_KIND_TEXT: Record<string, string> = {
  manual: "手动触发",
  retry_failed: "重试失败项",
};

const STEP_TYPE_TEXT: Record<string, string> = {
  checkout_branch: "切换分支",
  git_pull: "拉取分支",
  git_merge: "合并分支",
  git_push: "推送分支",
};

function statusPill(label: string, className: Record<string, string>) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize",
        className[label] ?? "bg-muted text-foreground"
      )}
    >
      {STATUS_TEXT[label] ?? label.replaceAll("_", " ")}
    </span>
  );
}

function workflowStepTypeLabel(stepType: string) {
  return STEP_TYPE_TEXT[stepType] ?? stepType;
}

function triggerKindLabel(triggerKind: string) {
  return TRIGGER_KIND_TEXT[triggerKind] ?? triggerKind;
}

function toJsonText(value: unknown) {
  if (value === null || value === undefined) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hasFailedProject(project: WorkflowRunProject) {
  return project.status === "failed" || project.status === "failed_precheck";
}

export function WorkflowRunsPage() {
  const [runs, setRuns] = React.useState<WorkflowRunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = React.useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = React.useState<number | null>(null);
  const [runDetail, setRunDetail] = React.useState<WorkflowRunDetail | null>(null);
  const [detailReloadVersion, setDetailReloadVersion] = React.useState(0);
  const [loadingRuns, setLoadingRuns] = React.useState(false);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  const detailRequestTokenRef = React.useRef(0);
  const refreshRequestTokenRef = React.useRef(0);
  const selectedRunIdRef = React.useRef<number | null>(null);
  const userSelectionVersionRef = React.useRef(0);

  React.useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  function onSelectRun(runId: number) {
    userSelectionVersionRef.current += 1;
    setSelectedRunId(runId);
  }

  async function refreshRuns(preferredRunId?: number | null) {
    const refreshRequestToken = refreshRequestTokenRef.current + 1;
    refreshRequestTokenRef.current = refreshRequestToken;
    const selectedRunAtRequestStart = selectedRunIdRef.current;
    const userSelectionVersionAtRequestStart = userSelectionVersionRef.current;

    setLoadingRuns(true);
    try {
      const nextRuns = await listWorkflowRuns();
      if (refreshRequestToken !== refreshRequestTokenRef.current) return;

      const userChangedSelectionDuringRequest =
        userSelectionVersionRef.current !== userSelectionVersionAtRequestStart;
      const preferredId = userChangedSelectionDuringRequest
        ? selectedRunIdRef.current
        : (preferredRunId ?? selectedRunAtRequestStart);
      const nextSelectedId =
        preferredId && nextRuns.some((item) => item.id === preferredId)
          ? preferredId
          : (nextRuns[0]?.id ?? null);

      setRuns(nextRuns);
      setSelectedRunId(nextSelectedId);

      // Keep detail in sync even when selection is unchanged, and invalidate stale in-flight loads.
      if (nextSelectedId && nextSelectedId === selectedRunId) {
        setDetailReloadVersion((version) => version + 1);
      }
      if (!nextSelectedId) {
        detailRequestTokenRef.current += 1;
        setRunDetail(null);
        setSelectedProjectId(null);
        setLoadingDetail(false);
      }
    } catch (error) {
      if (refreshRequestToken !== refreshRequestTokenRef.current) return;
      toast.error(`Load workflow runs failed: ${String(error)}`);
      detailRequestTokenRef.current += 1;
      setRuns([]);
      setSelectedRunId(null);
      setRunDetail(null);
      setSelectedProjectId(null);
      setLoadingDetail(false);
    } finally {
      if (refreshRequestToken === refreshRequestTokenRef.current) {
        setLoadingRuns(false);
      }
    }
  }

  React.useEffect(() => {
    void refreshRuns();
  }, []);

  React.useEffect(() => {
    const requestToken = detailRequestTokenRef.current + 1;
    detailRequestTokenRef.current = requestToken;

    if (!selectedRunId) {
      setRunDetail(null);
      setSelectedProjectId(null);
      setLoadingDetail(false);
      return;
    }

    setRunDetail(null);
    setLoadingDetail(true);

    void getWorkflowRunDetail(selectedRunId)
      .then((detail) => {
        if (requestToken !== detailRequestTokenRef.current) return;
        setRunDetail(detail);
        setSelectedProjectId((currentProjectId) =>
          detail.projects.some((project) => project.id === currentProjectId)
            ? currentProjectId
            : (detail.projects[0]?.id ?? null)
        );
      })
      .catch((error) => {
        if (requestToken !== detailRequestTokenRef.current) return;
        setRunDetail(null);
        setSelectedProjectId(null);
        toast.error(`Load workflow run detail failed: ${String(error)}`);
      })
      .finally(() => {
        if (requestToken !== detailRequestTokenRef.current) return;
        setLoadingDetail(false);
      });
  }, [selectedRunId, detailReloadVersion]);

  const selectedRun = runs.find((item) => item.id === selectedRunId) ?? null;
  const selectedRunDetail =
    selectedRunId !== null && runDetail?.id === selectedRunId ? runDetail : null;
  const activeRun = selectedRunDetail ?? selectedRun;
  const selectedProject =
    selectedRunDetail?.projects.find((project) => project.id === selectedProjectId) ?? null;
  const canCancel = selectedRun?.status === "pending" || selectedRun?.status === "running";
  const canRetryFailed =
    Boolean(selectedRunDetail) && selectedRunDetail.projects.some((project) => hasFailedProject(project));

  async function onCancelRun() {
    if (!selectedRun) return;
    const targetRunId = selectedRun.id;

    setCancelling(true);
    try {
      await cancelWorkflowRun(targetRunId);
      toast.success(`Cancel requested for run #${targetRunId}.`);
      await refreshRuns(targetRunId);
    } catch (error) {
      toast.error(`Cancel workflow run failed: ${String(error)}`);
    } finally {
      setCancelling(false);
    }
  }

  async function onRetryFailed() {
    if (!selectedRunDetail) return;

    const failedManagedProjectIds = selectedRunDetail.projects
      .filter((project) => hasFailedProject(project))
      .map((project) => project.managedProjectId)
      .filter((id): id is number => typeof id === "number");

    setRetrying(true);
    try {
      const result = await retryFailedWorkflowRun({
        sourceWorkflowRunId: selectedRunDetail.id,
        selectedManagedProjectIds: failedManagedProjectIds.length > 0 ? failedManagedProjectIds : null,
        maxConcurrencyOverride: null,
      });
      toast.success(`Retry run queued as #${result.workflowRunId}.`);
      await refreshRuns(result.workflowRunId);
    } catch (error) {
      toast.error(`Retry failed projects failed: ${String(error)}`);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">工作流运行</h2>
            <p className="text-sm text-muted-foreground">
              查看所有托管项目上的工作流执行状态。
            </p>
          </div>
          <Button variant="secondary" onClick={() => void refreshRuns()} disabled={loadingRuns}>
            刷新
          </Button>
        </PanelHeader>
        <PanelBody>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>运行</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>工作流</TableHead>
                <TableHead>项目分组</TableHead>
                <TableHead>更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow
                  key={run.id}
                  className={selectedRunId === run.id ? "bg-muted/50" : ""}
                  onClick={() => onSelectRun(run.id)}
                >
                  <TableCell className="font-mono">#{run.id}</TableCell>
                  <TableCell>{statusPill(run.status, RUN_STATUS_CLASS)}</TableCell>
                  <TableCell>{run.workflowDefinitionName}</TableCell>
                  <TableCell>{run.projectGroupName}</TableCell>
                  <TableCell className="font-mono text-xs">{formatDateTime(run.updatedAt)}</TableCell>
                </TableRow>
              ))}
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {loadingRuns ? "工作流运行加载中..." : "暂无工作流运行记录。"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-2">
          <PanelHeader className="flex-wrap gap-2">
            <h3 className="font-semibold">
              {activeRun ? `运行 #${activeRun.id}` : "运行概览"}
            </h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onCancelRun()}
                disabled={!canCancel || cancelling}
              >
                取消运行
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onRetryFailed()}
                disabled={!canRetryFailed || retrying}
              >
                重试失败项
              </Button>
            </div>
          </PanelHeader>
          <PanelBody>
            {!activeRun ? (
              <p className="text-sm text-muted-foreground">请选择一个工作流运行查看详情。</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{activeRun.workflowDefinitionName}</span>
                  {statusPill(activeRun.status, RUN_STATUS_CLASS)}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <span className="text-muted-foreground">项目分组</span>
                  <span>{activeRun.projectGroupName}</span>
                  <span className="text-muted-foreground">触发方式</span>
                  <span>{triggerKindLabel(activeRun.triggerKind)}</span>
                  <span className="text-muted-foreground">最大并发</span>
                  <span>{activeRun.maxConcurrency}</span>
                  <span className="text-muted-foreground">创建时间</span>
                  <span className="font-mono">{formatDateTime(activeRun.createdAt)}</span>
                  <span className="text-muted-foreground">开始时间</span>
                  <span className="font-mono">{formatDateTime(activeRun.startedAt)}</span>
                  <span className="text-muted-foreground">结束时间</span>
                  <span className="font-mono">{formatDateTime(activeRun.finishedAt)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
                  <div>成功：{activeRun.projectsSuccess}</div>
                  <div>失败：{activeRun.projectsFailed}</div>
                  <div>已取消：{activeRun.projectsCancelled}</div>
                  <div>运行中：{activeRun.projectsRunning}</div>
                  <div>排队中：{activeRun.projectsQueued}</div>
                  <div>预检查失败：{activeRun.projectsFailedPrecheck}</div>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">运行参数</span>
                  <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/20 p-2 font-mono text-xs">
                    {toJsonText(activeRun.runParameters)}
                  </pre>
                </div>
              </div>
            )}
          </PanelBody>
        </Panel>

        <div className="space-y-4 xl:col-span-3">
          <Panel>
            <PanelHeader>
              <h3 className="font-semibold">项目级状态</h3>
            </PanelHeader>
            <PanelBody>
              {loadingDetail ? (
                <p className="text-sm text-muted-foreground">正在加载运行详情...</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>项目</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>摘要</TableHead>
                      <TableHead>结束时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRunDetail?.projects.map((project) => (
                      <TableRow
                        key={project.id}
                        className={selectedProjectId === project.id ? "bg-muted/50" : ""}
                      >
                        <TableCell>
                          <button
                            type="button"
                            className="text-left text-sm font-medium hover:underline"
                            onClick={() => setSelectedProjectId(project.id)}
                            aria-label={`项目 ${project.projectName}`}
                          >
                            {project.projectName}
                          </button>
                          <div className="font-mono text-xs text-muted-foreground">
                            {project.projectPathWithNamespace}
                          </div>
                        </TableCell>
                        <TableCell>{statusPill(project.status, PROJECT_STATUS_CLASS)}</TableCell>
                        <TableCell className="text-xs">{project.summaryMessage || "-"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatDateTime(project.finishedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(selectedRunDetail?.projects.length ?? 0) === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          当前运行暂无项目级记录。
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <h3 className="font-semibold">
                步骤时间线 / 详情
                {selectedProject ? ` - ${selectedProject.projectName}` : ""}
              </h3>
            </PanelHeader>
            <PanelBody>
              {!selectedProject ? (
                <p className="text-sm text-muted-foreground">
                  请先选择上方项目行查看步骤输出。
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedProject.steps
                    .slice()
                    .sort((a, b) => a.stepOrder - b.stepOrder)
                    .map((step) => (
                      <div key={step.id} className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold">
                            步骤 {step.stepOrder + 1} - {workflowStepTypeLabel(step.stepType)}
                          </h4>
                          {statusPill(step.status, STEP_STATUS_CLASS)}
                          <span className="text-xs text-muted-foreground">{step.summaryMessage}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <span className="text-muted-foreground">开始</span>
                          <span className="font-mono">{formatDateTime(step.startedAt)}</span>
                          <span className="text-muted-foreground">结束</span>
                          <span className="font-mono">{formatDateTime(step.finishedAt)}</span>
                          <span className="text-muted-foreground">退出码</span>
                          <span className="font-mono">{step.exitCode ?? "-"}</span>
                        </div>
                        <div className="grid gap-1">
                          <span className="text-xs text-muted-foreground">渲染后参数</span>
                          <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                            {toJsonText(step.renderedParameters)}
                          </pre>
                        </div>
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                          <div className="grid gap-1">
                            <span className="text-xs text-muted-foreground">标准输出</span>
                            <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                              {step.stdout || "（空）"}
                            </pre>
                          </div>
                          <div className="grid gap-1">
                            <span className="text-xs text-muted-foreground">标准错误</span>
                            <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                              {step.stderr || "（空）"}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  {selectedProject.steps.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      当前项目没有记录到工作流步骤。
                    </p>
                  )}
                </div>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
