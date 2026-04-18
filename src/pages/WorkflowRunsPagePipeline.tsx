import * as React from "react";
import { toast } from "sonner";

import { PipelineRunProjectMatrix } from "@/components/pipeline-run-monitor/PipelineRunProjectMatrix";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  cancelPipelineRun,
  getPipelineRunDetail,
  getPipelineRunNodeDiagnostics,
  listPipelineRuns,
  readCommandErrorMessage,
  retryPipelineRun,
} from "@/lib/invoke";
import type {
  PipelineRunDetail,
  PipelineRunListPage,
  PipelineRunListQuery,
  PipelineRunNode,
  PipelineRunNodeDiagnostics,
  PipelineRunProject,
} from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

const RUN_STATUS_CLASS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-700",
  waiting: "bg-violet-100 text-violet-700",
  cancelling: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  partial_failed: "bg-orange-100 text-orange-700",
  cancelled: "bg-zinc-200 text-zinc-700",
};

const PROJECT_STATUS_CLASS: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-700",
  waiting: "bg-violet-100 text-violet-700",
  success: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-zinc-200 text-zinc-700",
  failed_precheck: "bg-orange-100 text-orange-700",
};

const NODE_STATUS_CLASS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-700",
  waiting: "bg-violet-100 text-violet-700",
  success: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-zinc-200 text-zinc-700",
  cancelled: "bg-zinc-200 text-zinc-700",
};

const STATUS_TEXT: Record<string, string> = {
  pending: "待处理",
  running: "运行中",
  waiting: "等待中",
  cancelling: "取消中",
  completed: "已完成",
  partial_failed: "部分失败",
  cancelled: "已取消",
  queued: "排队中",
  success: "成功",
  failed: "失败",
  failed_precheck: "预检失败",
  skipped: "已跳过",
};

const REMOTE_STATUS_TEXT: Record<string, string> = {
  pending: "待处理",
  running: "运行中",
  waiting: "等待中",
  success: "成功",
  failed: "失败",
  cancelled: "已取消",
  canceled: "已取消",
  skipped: "已跳过",
  manual: "需手动处理",
  created: "已创建",
};

const TRIGGER_KIND_TEXT: Record<string, string> = {
  manual: "手动触发",
  retry_failed: "重试失败项目",
  schedule: "调度触发",
};

const NODE_TYPE_TEXT: Record<string, string> = {
  checkout_branch: "切换分支",
  git_pull: "拉取分支",
  git_merge: "合并分支",
  git_push: "推送分支",
  check_pipeline: "检查远端流水线",
  trigger_pipeline: "触发远端流水线",
  wait_pipeline: "等待远端流水线",
};

const DEFAULT_RUN_PAGE_SIZE = 20;
const AUTO_REFRESH_INTERVAL_MS = 10_000;

const RUN_STATUS_FILTER_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "pending", label: "待处理" },
  { value: "running", label: "运行中" },
  { value: "waiting", label: "等待中" },
  { value: "cancelling", label: "取消中" },
  { value: "completed", label: "已完成" },
  { value: "partial_failed", label: "部分失败" },
  { value: "cancelled", label: "已取消" },
];

type FilterState = {
  status: string;
  pipelineDefinitionId: string;
  projectGroupId: string;
};

type NodeDiagnosticsMap = Record<number, PipelineRunNodeDiagnostics | null | undefined>;
type ExpandedNodeMap = Record<number, boolean | undefined>;
type LoadingNodeMap = Record<number, boolean | undefined>;
type ProjectViewMode = "list" | "matrix";

function emptyRunPage(): PipelineRunListPage {
  return {
    items: [],
    page: 1,
    pageSize: DEFAULT_RUN_PAGE_SIZE,
    total: 0,
    hasNextPage: false,
  };
}

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

function nodeTypeLabel(nodeType: string) {
  return NODE_TYPE_TEXT[nodeType] ?? nodeType;
}

function triggerKindLabel(triggerKind: string) {
  return TRIGGER_KIND_TEXT[triggerKind] ?? triggerKind;
}

function remoteStatusLabel(status: string | null | undefined) {
  if (!status) return "-";
  const normalized = status.trim().toLowerCase();
  return REMOTE_STATUS_TEXT[normalized] ?? status;
}

function toJsonText(value: unknown) {
  if (value === null || value === undefined) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hasFailedProject(project: PipelineRunProject) {
  return project.status === "failed" || project.status === "failed_precheck";
}

function sortedNodes(project: PipelineRunProject) {
  return [...project.nodes].sort((a, b) => a.nodeOrder - b.nodeOrder);
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildRunQuery(filters: FilterState, page: number): PipelineRunListQuery {
  return {
    page,
    pageSize: DEFAULT_RUN_PAGE_SIZE,
    status: filters.status || null,
    pipelineDefinitionId: parseOptionalNumber(filters.pipelineDefinitionId),
    projectGroupId: parseOptionalNumber(filters.projectGroupId),
  };
}

function isActiveRunStatus(status: string | null | undefined) {
  return status === "pending" || status === "running" || status === "waiting" || status === "cancelling";
}

function PipelineNodeCard({
  node,
  diagnostics,
  diagnosticsExpanded,
  loadingDiagnostics,
  onToggleDiagnostics,
}: {
  node: PipelineRunNode;
  diagnostics?: PipelineRunNodeDiagnostics | null;
  diagnosticsExpanded: boolean;
  loadingDiagnostics: boolean;
  onToggleDiagnostics: (nodeId: number) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">
          节点 {node.nodeOrder + 1} - {nodeTypeLabel(node.nodeType)}
        </h4>
        {statusPill(node.status, NODE_STATUS_CLASS)}
        <span className="text-xs text-muted-foreground">{node.summaryMessage}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <span className="text-muted-foreground">开始</span>
        <span className="font-mono">{formatDateTime(node.startedAt)}</span>
        <span className="text-muted-foreground">结束</span>
        <span className="font-mono">{formatDateTime(node.finishedAt)}</span>
        <span className="text-muted-foreground">远端流水线</span>
        <span className="font-mono">
          {typeof node.remotePipelineId === "number" ? `#${node.remotePipelineId}` : "-"}
        </span>
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">渲染后参数</span>
        <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
          {toJsonText(node.renderedParameters)}
        </pre>
      </div>
      {node.waitTarget ? (
        <div className="grid gap-1 rounded-md border border-border bg-background p-2 text-xs">
          <span className="text-muted-foreground">等待目标</span>
          <span>{node.waitTarget}</span>
          <span className="text-muted-foreground">最近远端状态</span>
          <span>{remoteStatusLabel(node.lastRemoteStatus)}</span>
          {typeof node.remotePipelineId === "number" ? <span>远端流水线 #{node.remotePipelineId}</span> : null}
        </div>
      ) : null}
      {node.titleZh || node.detailZh || node.suggestionZh ? (
        <div className="grid gap-1 rounded-md border border-border bg-background p-2 text-xs">
          {node.titleZh ? <span className="font-medium">{node.titleZh}</span> : null}
          {node.detailZh ? <span>{node.detailZh}</span> : null}
          {node.suggestionZh ? <span>{node.suggestionZh}</span> : null}
        </div>
      ) : null}
      <div className="grid gap-2">
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          aria-label="鏌ョ湅璇婃柇"
          onClick={() => onToggleDiagnostics(node.id)}
        >
          {diagnosticsExpanded ? "收起诊断" : "查看诊断"}
        </Button>
        {diagnosticsExpanded ? (
          loadingDiagnostics ? (
            <p className="text-xs text-muted-foreground">正在加载诊断信息...</p>
          ) : diagnostics ? (
            <div className="grid gap-2">
              {diagnostics.evidence ? (
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">技术证据</span>
                  <pre className="max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                    {diagnostics.evidence}
                  </pre>
                </div>
              ) : null}
              {diagnostics.stderr ? (
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">标准错误</span>
                  <pre className="max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                    {diagnostics.stderr}
                  </pre>
                </div>
              ) : null}
              {diagnostics.stdout ? (
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">标准输出</span>
                  <pre className="max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                    {diagnostics.stdout}
                  </pre>
                </div>
              ) : null}
              {diagnostics.waitContext ? (
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">等待上下文</span>
                  <pre className="max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                    {toJsonText(diagnostics.waitContext)}
                  </pre>
                </div>
              ) : null}
              {!diagnostics.evidence && !diagnostics.stderr && !diagnostics.stdout && !diagnostics.waitContext ? (
                <p className="text-xs text-muted-foreground">暂无额外诊断信息。</p>
              ) : null}
            </div>
          ) : null
        ) : null}
      </div>
    </div>
  );
}

export function WorkflowRunsPagePipeline() {
  const [runPage, setRunPage] = React.useState<PipelineRunListPage>(emptyRunPage);
  const [filters, setFilters] = React.useState<FilterState>({
    status: "",
    pipelineDefinitionId: "",
    projectGroupId: "",
  });
  const [selectedRunId, setSelectedRunId] = React.useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = React.useState<number | null>(null);
  const [runDetail, setRunDetail] = React.useState<PipelineRunDetail | null>(null);
  const [detailReloadVersion, setDetailReloadVersion] = React.useState(0);
  const [loadingRuns, setLoadingRuns] = React.useState(false);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  const [projectViewMode, setProjectViewMode] = React.useState<ProjectViewMode>("list");
  const [expandedNodes, setExpandedNodes] = React.useState<ExpandedNodeMap>({});
  const [nodeDiagnosticsById, setNodeDiagnosticsById] = React.useState<NodeDiagnosticsMap>({});
  const [loadingNodeDiagnosticsById, setLoadingNodeDiagnosticsById] = React.useState<LoadingNodeMap>({});
  const detailRequestTokenRef = React.useRef(0);
  const refreshRequestTokenRef = React.useRef(0);
  const selectedRunIdRef = React.useRef<number | null>(null);
  const previousSelectedRunIdRef = React.useRef<number | null>(null);
  const userSelectionVersionRef = React.useRef(0);

  const runs = runPage.items;

  React.useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  React.useEffect(() => {
    if (previousSelectedRunIdRef.current !== selectedRunId) {
      previousSelectedRunIdRef.current = selectedRunId;
      resetNodeDiagnosticsState();
    }
  }, [selectedRunId]);

  function resetNodeDiagnosticsState() {
    setExpandedNodes({});
    setNodeDiagnosticsById({});
    setLoadingNodeDiagnosticsById({});
  }

  function onSelectRun(runId: number) {
    userSelectionVersionRef.current += 1;
    setSelectedRunId(runId);
  }

  async function refreshRuns(
    preferredRunId?: number | null,
    pageOverride?: number,
    filtersOverride?: FilterState
  ) {
    const refreshRequestToken = refreshRequestTokenRef.current + 1;
    refreshRequestTokenRef.current = refreshRequestToken;
    const selectedRunAtRequestStart = selectedRunIdRef.current;
    const userSelectionVersionAtRequestStart = userSelectionVersionRef.current;
    const nextFilters = filtersOverride ?? filters;
    const nextPageNumber = pageOverride ?? runPage.page ?? 1;

    setLoadingRuns(true);
    try {
      const nextRunPage = await listPipelineRuns(buildRunQuery(nextFilters, nextPageNumber));
      if (refreshRequestToken !== refreshRequestTokenRef.current) return;

      const userChangedSelectionDuringRequest =
        userSelectionVersionRef.current !== userSelectionVersionAtRequestStart;
      const preferredId = userChangedSelectionDuringRequest
        ? selectedRunIdRef.current
        : (preferredRunId ?? selectedRunAtRequestStart);
      const nextSelectedId =
        preferredId && nextRunPage.items.some((item) => item.id === preferredId)
          ? preferredId
          : (nextRunPage.items[0]?.id ?? null);

      setRunPage(nextRunPage);
      setSelectedRunId(nextSelectedId);
      if (nextSelectedId && nextSelectedId === selectedRunIdRef.current) {
        setDetailReloadVersion((version) => version + 1);
      }
      if (!nextSelectedId) {
        detailRequestTokenRef.current += 1;
        setRunDetail(null);
        setSelectedProjectId(null);
        resetNodeDiagnosticsState();
        setLoadingDetail(false);
      }
    } catch (error) {
      if (refreshRequestToken !== refreshRequestTokenRef.current) return;
      toast.error(readCommandErrorMessage(error, "加载流水线运行记录失败。"));
      detailRequestTokenRef.current += 1;
      setRunPage(emptyRunPage());
      setSelectedRunId(null);
      setRunDetail(null);
      setSelectedProjectId(null);
      resetNodeDiagnosticsState();
      setLoadingDetail(false);
    } finally {
      if (refreshRequestToken === refreshRequestTokenRef.current) {
        setLoadingRuns(false);
      }
    }
  }

  React.useEffect(() => {
    void refreshRuns(undefined, 1, filters);
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

    void getPipelineRunDetail(selectedRunId)
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
        toast.error(readCommandErrorMessage(error, "加载流水线运行详情失败。"));
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
  const canRetryFailed = selectedRunDetail?.projects.some((project) => hasFailedProject(project)) ?? false;

  React.useEffect(() => {
    if (!selectedRunId || !isActiveRunStatus(activeRun?.status)) {
      return;
    }

    const intervalHandle = window.setInterval(() => {
      void refreshRuns(selectedRunId, runPage.page, filters);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [
    selectedRunId,
    activeRun?.status,
    runPage.page,
    filters.status,
    filters.pipelineDefinitionId,
    filters.projectGroupId,
  ]);

  async function onCancelRun() {
    if (!selectedRun) return;
    const targetRunId = selectedRun.id;

    setCancelling(true);
    try {
      await cancelPipelineRun(targetRunId);
      toast.success(`已提交取消请求：运行 #${targetRunId}`);
      await refreshRuns(targetRunId, runPage.page, filters);
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "取消流水线运行失败。"));
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
      const result = await retryPipelineRun({
        sourcePipelineRunId: selectedRunDetail.id,
        selectedManagedProjectIds: failedManagedProjectIds.length > 0 ? failedManagedProjectIds : null,
        maxConcurrencyOverride: null,
      });
      toast.success(`已创建重试运行：#${result.pipelineRunId}`);
      await refreshRuns(result.pipelineRunId, runPage.page, filters);
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "重试失败项目失败。"));
    } finally {
      setRetrying(false);
    }
  }

  async function onToggleDiagnostics(nodeId: number) {
    const expanded = !!expandedNodes[nodeId];
    if (expanded) {
      setExpandedNodes((current) => ({ ...current, [nodeId]: false }));
      return;
    }

    setExpandedNodes((current) => ({ ...current, [nodeId]: true }));
    if (nodeDiagnosticsById[nodeId] !== undefined || loadingNodeDiagnosticsById[nodeId]) {
      return;
    }

    setLoadingNodeDiagnosticsById((current) => ({ ...current, [nodeId]: true }));
    try {
      const diagnostics = await getPipelineRunNodeDiagnostics(nodeId);
      setNodeDiagnosticsById((current) => ({ ...current, [nodeId]: diagnostics }));
    } catch (error) {
      setExpandedNodes((current) => ({ ...current, [nodeId]: false }));
      toast.error(readCommandErrorMessage(error, "加载节点诊断失败。"));
    } finally {
      setLoadingNodeDiagnosticsById((current) => ({ ...current, [nodeId]: false }));
    }
  }

  function onApplyFilters() {
    userSelectionVersionRef.current += 1;
    void refreshRuns(null, 1, filters);
  }

  function onClearFilters() {
    const nextFilters = {
      status: "",
      pipelineDefinitionId: "",
      projectGroupId: "",
    };
    setFilters(nextFilters);
    userSelectionVersionRef.current += 1;
    void refreshRuns(null, 1, nextFilters);
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">流水线运行</h2>
            <p className="text-sm text-muted-foreground">
              查看各项目的流水线执行状态、等待信息和失败细节。
            </p>
          </div>
          <Button variant="secondary" onClick={() => void refreshRuns(selectedRunId, runPage.page, filters)} disabled={loadingRuns}>
            刷新
          </Button>
        </PanelHeader>
        <PanelBody>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">状态</span>
              <select
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={filters.status}
                onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              >
                {RUN_STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">流水线 ID</span>
              <input
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={filters.pipelineDefinitionId}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, pipelineDefinitionId: event.target.value }))
                }
                placeholder="例如 21"
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">项目组 ID</span>
              <input
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={filters.projectGroupId}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, projectGroupId: event.target.value }))
                }
                placeholder="例如 5"
              />
            </label>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={onApplyFilters} disabled={loadingRuns}>
                应用筛选
              </Button>
              <Button variant="outline" size="sm" onClick={onClearFilters} disabled={loadingRuns}>
                清空筛选
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>运行</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>流水线</TableHead>
                <TableHead>项目组</TableHead>
                <TableHead>更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id} className={selectedRunId === run.id ? "bg-muted/50" : ""} onClick={() => onSelectRun(run.id)}>
                  <TableCell className="font-mono">#{run.id}</TableCell>
                  <TableCell>{statusPill(run.status, RUN_STATUS_CLASS)}</TableCell>
                  <TableCell>{run.pipelineDefinitionName}</TableCell>
                  <TableCell>{run.projectGroupName}</TableCell>
                  <TableCell className="font-mono text-xs">{formatDateTime(run.updatedAt)}</TableCell>
                </TableRow>
              ))}
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {loadingRuns ? "流水线运行加载中..." : "暂无流水线运行记录。"}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              第 {runPage.page} 页 · 每页 {runPage.pageSize} 条 · 共 {runPage.total} 条
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loadingRuns || runPage.page <= 1}
                onClick={() => void refreshRuns(selectedRunId, runPage.page - 1, filters)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loadingRuns || !runPage.hasNextPage}
                onClick={() => void refreshRuns(selectedRunId, runPage.page + 1, filters)}
              >
                下一页
              </Button>
            </div>
          </div>
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-2">
          <PanelHeader className="flex-wrap gap-2">
            <h3 className="font-semibold">{activeRun ? `运行 #${activeRun.id}` : "运行概览"}</h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label="取消运行"
                onClick={() => void onCancelRun()}
                disabled={!canCancel || cancelling}
              >
                取消运行
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label="重试失败项目"
                onClick={() => void onRetryFailed()}
                disabled={!canRetryFailed || retrying}
              >
                重试失败项目
              </Button>
            </div>
          </PanelHeader>
          <PanelBody>
            {!activeRun ? (
              <p className="text-sm text-muted-foreground">请选择一个流水线运行查看详情。</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{activeRun.pipelineDefinitionName}</span>
                  {statusPill(activeRun.status, RUN_STATUS_CLASS)}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <span className="text-muted-foreground">项目组</span>
                  <span>{activeRun.projectGroupName}</span>
                  <span className="text-muted-foreground">触发方式</span>
                  <span>{triggerKindLabel(activeRun.triggerKind)}</span>
                  <span className="text-muted-foreground">最大并发</span>
                  <span>{activeRun.maxConcurrency}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
                  <div>成功：{activeRun.projectsSuccess}</div>
                  <div>失败：{activeRun.projectsFailed}</div>
                  <div>已取消：{activeRun.projectsCancelled}</div>
                  <div>运行中：{activeRun.projectsRunning}</div>
                  <div>排队中：{activeRun.projectsQueued}</div>
                  <div>预检失败：{activeRun.projectsFailedPrecheck}</div>
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
            <PanelHeader className="flex-wrap gap-2">
              <h3 className="font-semibold">项目级状态</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant={projectViewMode === "list" ? "secondary" : "outline"}
                  size="sm"
                  data-testid="pipeline-run-project-view-list"
                  aria-pressed={projectViewMode === "list"}
                  onClick={() => setProjectViewMode("list")}
                >
                  列表
                </Button>
                <Button
                  variant={projectViewMode === "matrix" ? "secondary" : "outline"}
                  size="sm"
                  data-testid="pipeline-run-project-view-matrix"
                  aria-pressed={projectViewMode === "matrix"}
                  onClick={() => setProjectViewMode("matrix")}
                >
                  矩阵
                </Button>
              </div>
            </PanelHeader>
            <PanelBody>
              {loadingDetail ? (
                <p className="text-sm text-muted-foreground">正在加载运行详情...</p>
              ) : selectedRunDetail ? (
                projectViewMode === "matrix" ? (
                  <PipelineRunProjectMatrix
                    projects={selectedRunDetail.projects}
                    selectedProjectId={selectedProjectId}
                    onSelectProject={setSelectedProjectId}
                    nodeTypeLabel={nodeTypeLabel}
                    statusLabel={status => STATUS_TEXT[status] ?? status.replaceAll("_", " ")}
                    remoteStatusLabel={remoteStatusLabel}
                  />
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
                      {selectedRunDetail.projects.map((project) => (
                        <TableRow key={project.id} className={selectedProjectId === project.id ? "bg-muted/50" : ""}>
                          <TableCell>
                            <button type="button" className="text-left text-sm font-medium hover:underline" onClick={() => setSelectedProjectId(project.id)}>
                              {project.projectName}
                            </button>
                            <div className="font-mono text-xs text-muted-foreground">{project.projectPathWithNamespace}</div>
                          </TableCell>
                          <TableCell>{statusPill(project.status, PROJECT_STATUS_CLASS)}</TableCell>
                          <TableCell className="text-xs">{project.summaryMessage || "-"}</TableCell>
                          <TableCell className="font-mono text-xs">{formatDateTime(project.finishedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )
              ) : (
                <p className="text-sm text-muted-foreground">请选择一个运行查看项目状态。</p>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <h3 className="font-semibold">{selectedProject ? `节点时间线 / 详情 - ${selectedProject.projectName}` : "节点时间线 / 详情"}</h3>
            </PanelHeader>
            <PanelBody>
              {!selectedProject ? (
                <p className="text-sm text-muted-foreground">请选择一个项目查看节点输出。</p>
              ) : (
                <div className="space-y-3">
                  {sortedNodes(selectedProject).map((node) => (
                    <PipelineNodeCard
                      key={node.id}
                      node={node}
                      diagnostics={nodeDiagnosticsById[node.id] ?? null}
                      diagnosticsExpanded={!!expandedNodes[node.id]}
                      loadingDiagnostics={!!loadingNodeDiagnosticsById[node.id]}
                      onToggleDiagnostics={(nodeId) => void onToggleDiagnostics(nodeId)}
                    />
                  ))}
                </div>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
