import * as React from "react";
import { toast } from "sonner";

import { PipelineDefinitionEditorShell } from "@/components/pipeline-editor/PipelineDefinitionEditorShell";
import { arePipelineDraftsEquivalent } from "@/components/pipeline-editor/draft-dirty";
import {
  buildPipelineCreatePayload,
  createEmptyPipelineDraft,
  getPipelineDraftReadiness,
  toDraftFromDetail,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";
import {
  buildPipelineEditorValidationSummary,
  type ValidationSummary,
} from "@/components/pipeline-editor/editor-validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createPipelineDefinition,
  deletePipelineDefinition,
  executePipelineRun,
  getPipelineDefinitionDetail,
  getPipelineScheduleRuntimeSnapshots,
  listPipelineRuns,
  listManagedProjects,
  listPipelineDefinitions,
  readCommandErrorMessage,
  updatePipelineDefinition,
} from "@/lib/invoke";
import type {
  ManagedProject,
  PipelineDefinitionDetail,
  PipelineDefinitionListItem,
  PipelineScheduleRuntimeSnapshot,
} from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type WorkflowsPagePipelineProps = {
  onRunStarted?: (pipelineRunId: number) => void;
};

type DefinitionEditorMode = "idle" | "creating" | "editing";
type ActiveDefinitionEditorMode = Exclude<DefinitionEditorMode, "idle">;

const LEAVE_EDITOR_CONFIRM_MESSAGE = "当前有未保存修改，离开后将丢失，是否继续？";
const VALIDATION_FAILURE_MESSAGE = (issueCount: number) =>
  `请先处理 ${issueCount} 个校验问题。`;

const RUN_MONITOR_VISIBILITY_TIMEOUT_MS = 2000;
const RUN_MONITOR_VISIBILITY_POLL_INTERVAL_MS = 100;
const RUN_MONITOR_VISIBILITY_PAGE_SIZE = 50;

export function WorkflowsPagePipeline({
  onRunStarted,
}: WorkflowsPagePipelineProps = {}) {
  const [items, setItems] = React.useState<PipelineDefinitionListItem[]>([]);
  const [managedProjects, setManagedProjects] = React.useState<ManagedProject[]>([]);
  const [loading, setLoading] = React.useState(false);
  const editRequestTokenRef = React.useRef(0);
  const createDraftSeedRef = React.useRef<PipelineDraft>(createEmptyPipelineDraft());
  const editDraftSeedRef = React.useRef<PipelineDraft>(createEmptyPipelineDraft());

  const [editorMode, setEditorMode] = React.useState<DefinitionEditorMode>("idle");
  const [createBaselineDraft, setCreateBaselineDraft] = React.useState<PipelineDraft>(
    createDraftSeedRef.current
  );
  const [createDraft, setCreateDraft] = React.useState<PipelineDraft>(
    createDraftSeedRef.current
  );
  const [createValidationSummary, setCreateValidationSummary] =
    React.useState<ValidationSummary | null>(null);
  const [creating, setCreating] = React.useState(false);
  const createReadiness = getPipelineDraftReadiness(createDraft);

  const [editBaselineDraft, setEditBaselineDraft] = React.useState<PipelineDraft>(
    editDraftSeedRef.current
  );
  const [editDraft, setEditDraft] = React.useState<PipelineDraft>(
    editDraftSeedRef.current
  );
  const [editingItem, setEditingItem] =
    React.useState<PipelineDefinitionListItem | null>(null);
  const [editScheduleRuntimeSnapshots, setEditScheduleRuntimeSnapshots] =
    React.useState<PipelineScheduleRuntimeSnapshot[]>([]);
  const [loadingEditScheduleRuntime, setLoadingEditScheduleRuntime] =
    React.useState(false);
  const [editValidationSummary, setEditValidationSummary] =
    React.useState<ValidationSummary | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const editReadiness = getPipelineDraftReadiness(editDraft);

  const runRequestTokenRef = React.useRef(0);
  const [runOpen, setRunOpen] = React.useState(false);
  const [runItem, setRunItem] = React.useState<PipelineDefinitionListItem | null>(null);
  const [runDetail, setRunDetail] = React.useState<PipelineDefinitionDetail | null>(null);
  const [runParameters, setRunParameters] = React.useState<Record<string, string>>({});
  const [loadingRunDetail, setLoadingRunDetail] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  const refresh = React.useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const [definitions, projects] = await Promise.all([
          listPipelineDefinitions(),
          listManagedProjects(),
        ]);
        setItems(definitions);
        setManagedProjects(projects);
        return true;
      } catch (error) {
        toast.error(readCommandErrorMessage(error, "加载流水线定义失败。"));
        return false;
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    []
  );

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  function resetCreateDraft() {
    const nextDraft = createEmptyPipelineDraft();
    setCreateBaselineDraft(nextDraft);
    setCreateDraft(nextDraft);
    setCreateValidationSummary(null);
  }

  function resetEditDraft() {
    const nextDraft = createEmptyPipelineDraft();
    setEditingItem(null);
    setEditBaselineDraft(nextDraft);
    setEditDraft(nextDraft);
    setEditValidationSummary(null);
    setEditScheduleRuntimeSnapshots([]);
    setLoadingEditScheduleRuntime(false);
  }

  function openCreateEditor() {
    resetCreateDraft();
    setEditorMode("creating");
  }

  function setValidationSummaryForMode(
    mode: ActiveDefinitionEditorMode,
    summary: ValidationSummary | null
  ) {
    if (mode === "editing") {
      setEditValidationSummary(summary);
      return;
    }
    setCreateValidationSummary(summary);
  }

  function runDraftValidation(
    mode: ActiveDefinitionEditorMode,
    draft: PipelineDraft
  ) {
    const summary = buildPipelineEditorValidationSummary(draft);
    setValidationSummaryForMode(mode, summary);
    return summary;
  }

  function reportValidationOutcome(
    summary: ValidationSummary,
    { successMessage }: { successMessage?: string } = {}
  ) {
    if (summary.ok) {
      if (successMessage) {
        toast.success(successMessage);
      }
      return true;
    }

    toast.error(VALIDATION_FAILURE_MESSAGE(summary.issues.length));
    return false;
  }

  function handleEditorBack() {
    if (activeDirty && !window.confirm(LEAVE_EDITOR_CONFIRM_MESSAGE)) {
      return;
    }

    if (editorMode === "editing") {
      resetEditDraft();
    } else if (editorMode === "creating") {
      resetCreateDraft();
    }
    setEditorMode("idle");
  }

  const refreshEditScheduleRuntime = React.useCallback(
    async (
      pipelineDefinitionId: number,
      { clearOnError = false }: { clearOnError?: boolean } = {}
    ) => {
      setLoadingEditScheduleRuntime(true);
      try {
        const snapshots = await getPipelineScheduleRuntimeSnapshots(
          pipelineDefinitionId
        );
        setEditScheduleRuntimeSnapshots(snapshots);
      } catch (error) {
        if (clearOnError) {
          setEditScheduleRuntimeSnapshots([]);
        }
        toast.error(readCommandErrorMessage(error, "加载调度运行状态失败。"));
      } finally {
        setLoadingEditScheduleRuntime(false);
      }
    },
    []
  );

  async function onCreate() {
    if (!createReadiness.ready) {
      toast.error(createReadiness.message);
      return;
    }

    setCreating(true);
    try {
      const payload = buildPipelineCreatePayload(createDraft);
      await createPipelineDefinition(payload);
      toast.success("流水线已创建。");
      setEditorMode("idle");
      resetCreateDraft();
      await refresh({ silent: true });
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "创建流水线失败。"));
    } finally {
      setCreating(false);
    }
  }

  async function startEdit(item: PipelineDefinitionListItem) {
    const requestToken = editRequestTokenRef.current + 1;
    editRequestTokenRef.current = requestToken;
    setLoadingEditScheduleRuntime(false);

    try {
      const detail = await getPipelineDefinitionDetail(item.id);
      if (editRequestTokenRef.current !== requestToken) {
        return;
      }

      const nextDraft = toDraftFromDetail(detail);
      setEditingItem(item);
      setEditBaselineDraft(nextDraft);
      setEditDraft(nextDraft);
      setEditValidationSummary(null);
      setEditorMode("editing");
      setEditScheduleRuntimeSnapshots([]);
      void refreshEditScheduleRuntime(item.id, { clearOnError: true });
    } catch (error) {
      if (editRequestTokenRef.current !== requestToken) {
        return;
      }
      toast.error(readCommandErrorMessage(error, "加载流水线详情失败。"));
    }
  }

  async function onSaveEdit() {
    if (!editingItem) return;
    if (!editReadiness.ready) {
      toast.error(editReadiness.message);
      return;
    }

    setSaving(true);
    try {
      const payload = buildPipelineCreatePayload(editDraft);
      await updatePipelineDefinition({
        id: editingItem.id,
        ...payload,
      });
      toast.success("流水线已保存。");
      setEditorMode("idle");
      resetEditDraft();
      await refresh({ silent: true });
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "保存流水线失败。"));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(item: PipelineDefinitionListItem) {
    if (!confirm(`确定删除流水线“${item.name}”吗？`)) return;

    try {
      await deletePipelineDefinition(item.id);
      toast.success("流水线已删除。");
      await refresh({ silent: true });
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "删除流水线失败。"));
    }
  }

  async function handleValidate() {
    setValidating(true);
    try {
      if (editorMode === "idle") {
        return;
      }

      const summary = runDraftValidation(editorMode, activeDraft);
      reportValidationOutcome(summary, {
        successMessage: "流水线定义校验通过。",
      });
    } finally {
      setValidating(false);
    }
  }

  async function handleEditorSave() {
    if (editorMode === "idle") {
      return;
    }

    const summary = runDraftValidation(editorMode, activeDraft);
    if (!reportValidationOutcome(summary)) {
      return;
    }

    if (editorMode === "creating") {
      await onCreate();
      return;
    }

    if (editorMode === "editing") {
      await onSaveEdit();
    }
  }

  function handleRunOpenChange(open: boolean) {
    setRunOpen(open);
    if (!open) {
      setRunItem(null);
      setRunDetail(null);
      setRunParameters({});
      setLoadingRunDetail(false);
    }
  }

  async function startRun(item: PipelineDefinitionListItem) {
    const requestToken = runRequestTokenRef.current + 1;
    runRequestTokenRef.current = requestToken;
    setRunOpen(true);
    setRunItem(item);
    setRunDetail(null);
    setRunParameters({});
    setLoadingRunDetail(true);

    try {
      const detail = await getPipelineDefinitionDetail(item.id);
      if (runRequestTokenRef.current !== requestToken) {
        return;
      }
      setRunDetail(detail);
      setRunParameters(
        Object.fromEntries(
          detail.variables.map((variable) => [variable.key, variable.defaultValue ?? ""])
        )
      );
    } catch (error) {
      if (runRequestTokenRef.current !== requestToken) {
        return;
      }
      toast.error(readCommandErrorMessage(error, "加载运行参数失败。"));
      handleRunOpenChange(false);
    } finally {
      if (runRequestTokenRef.current === requestToken) {
        setLoadingRunDetail(false);
      }
    }
  }

  async function onRunNow() {
    if (!runItem) return;

    setRunning(true);
    try {
      const result = await executePipelineRun({
        pipelineDefinitionId: runItem.id,
        runParameters,
        maxConcurrencyOverride: null,
      });
      toast.success(`已创建运行 #${result.pipelineRunId}`);
      handleRunOpenChange(false);
      if (onRunStarted) {
        await waitForRunVisibility(result.pipelineRunId, runItem.id);
        onRunStarted(result.pipelineRunId);
      }
    } catch (error) {
      toast.error(readCommandErrorMessage(error, "启动流水线运行失败。"));
    } finally {
      setRunning(false);
    }
  }

  async function waitForRunVisibility(
    pipelineRunId: number,
    pipelineDefinitionId: number
  ) {
    const deadline = Date.now() + RUN_MONITOR_VISIBILITY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const page = await listPipelineRuns({
          page: 1,
          pageSize: RUN_MONITOR_VISIBILITY_PAGE_SIZE,
          status: null,
          pipelineDefinitionId,
          projectGroupId: null,
          sortBy: "updatedAt",
          sortDirection: "desc",
        });
        if (page.items.some((item) => item.id === pipelineRunId)) {
          return;
        }
      } catch {
        // 启动后短轮询只用于改善跳转时机，不额外打断用户流程。
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, RUN_MONITOR_VISIBILITY_POLL_INTERVAL_MS);
      });
    }
  }

  const missingRunVariable = runDetail?.variables.find((variable) => {
    if (!variable.required) return false;
    return !(runParameters[variable.key] ?? "").trim();
  });

  const activeDraft = editorMode === "editing" ? editDraft : createDraft;
  const activeDirty =
    editorMode === "editing"
      ? !arePipelineDraftsEquivalent(editDraft, editBaselineDraft)
      : !arePipelineDraftsEquivalent(createDraft, createBaselineDraft);
  const activeSaving = editorMode === "editing" ? saving : creating;
  const activeValidationSummary =
    editorMode === "editing" ? editValidationSummary : createValidationSummary;
  const activeScheduleRuntimeSnapshots =
    editorMode === "editing" ? editScheduleRuntimeSnapshots : undefined;

  if (editorMode !== "idle") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PipelineDefinitionEditorShell
          mode={editorMode === "creating" ? "create" : "edit"}
          draft={activeDraft}
          managedProjects={managedProjects}
          scheduleRuntimeSnapshots={activeScheduleRuntimeSnapshots}
          dirty={activeDirty}
          saving={activeSaving}
          validating={validating}
          validationSummary={activeValidationSummary}
          onChange={
            editorMode === "editing"
              ? (next) => {
                  setEditDraft(next);
                  setValidationSummaryForMode("editing", null);
                }
              : (next) => {
                  setCreateDraft(next);
                  setValidationSummaryForMode("creating", null);
                }
          }
          onBack={handleEditorBack}
          onSave={() => void handleEditorSave()}
          onValidate={() => void handleValidate()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">流水线定义</h2>
            <p className="text-sm text-muted-foreground">
              定义可复用的发布流水线，统一管理变量、节点和调度规则。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
              刷新
            </Button>
            <Button onClick={openCreateEditor}>新建流水线</Button>
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
                        <p className="text-xs text-muted-foreground">
                          迁移自工作流 #{item.legacyWorkflowDefinitionId}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{item.enabled ? "启用" : "禁用"}</TableCell>
                  <TableCell>{item.nodesCount}</TableCell>
                  <TableCell>{item.schedulesCount}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDateTime(item.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void startRun(item)}
                      >
                        立即运行
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void startEdit(item)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void onDelete(item)}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {loading ? "加载中..." : "暂无流水线定义。"}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>

      <Dialog open={runOpen} onOpenChange={handleRunOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>立即运行流水线</DialogTitle>
            <DialogDescription>
              {runItem
                ? `为“${runItem.name}”填写运行参数并立即启动。`
                : "填写运行参数并立即启动。"}
            </DialogDescription>
          </DialogHeader>
          {loadingRunDetail ? (
            <p className="text-sm text-muted-foreground">正在加载运行参数...</p>
          ) : runDetail ? (
            <div className="grid gap-3">
              {runDetail.variables.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  当前流水线没有运行参数，可直接启动。
                </p>
              ) : (
                runDetail.variables.map((variable) => (
                  <label key={variable.key} className="grid gap-1">
                    <span className="text-sm font-medium">
                      运行参数 {variable.label}
                    </span>
                    <input
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                      aria-label={`运行参数 ${variable.label}`}
                      value={runParameters[variable.key] ?? ""}
                      onChange={(event) =>
                        setRunParameters((current) => ({
                          ...current,
                          [variable.key]: event.target.value,
                        }))
                      }
                      placeholder={variable.defaultValue ?? ""}
                    />
                    <span className="text-xs text-muted-foreground">
                      {variable.key}
                      {variable.required ? " · 必填" : " · 可选"}
                    </span>
                  </label>
                ))
              )}
              {missingRunVariable ? (
                <p className="text-sm text-destructive">
                  请先填写必填参数：{missingRunVariable.label}
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              type="button"
              onClick={() => handleRunOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void onRunNow()}
              disabled={
                running || loadingRunDetail || !!missingRunVariable || !runItem || !runDetail
              }
            >
              开始运行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
