import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PipelineDraftForm } from "@/components/pipeline-editor/PipelineDraftForm";
import {
  buildPipelineCreatePayload,
  createEmptyPipelineDraft,
  getPipelineDraftReadiness,
  toDraftFromDetail,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";
import {
  createPipelineDefinition,
  deletePipelineDefinition,
  getPipelineDefinitionDetail,
  getPipelineScheduleRuntimeSnapshots,
  listPipelineDefinitions,
  listProjectGroups,
  readCommandErrorMessage,
  updatePipelineDefinition,
} from "@/lib/invoke";
import type { PipelineDefinitionListItem, PipelineScheduleRuntimeSnapshot, ProjectGroup } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function WorkflowsPagePipeline() {
  const [items, setItems] = React.useState<PipelineDefinitionListItem[]>([]);
  const [projectGroups, setProjectGroups] = React.useState<ProjectGroup[]>([]);
  const [loading, setLoading] = React.useState(false);
  const editRequestTokenRef = React.useRef(0);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createDraft, setCreateDraft] = React.useState<PipelineDraft>(createEmptyPipelineDraft);
  const [creating, setCreating] = React.useState(false);
  const createReadiness = getPipelineDraftReadiness(createDraft);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editDraft, setEditDraft] = React.useState<PipelineDraft>(createEmptyPipelineDraft);
  const [editingItem, setEditingItem] = React.useState<PipelineDefinitionListItem | null>(null);
  const [editScheduleRuntimeSnapshots, setEditScheduleRuntimeSnapshots] = React.useState<
    PipelineScheduleRuntimeSnapshot[]
  >([]);
  const [loadingEditScheduleRuntime, setLoadingEditScheduleRuntime] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
      if (!silent) {
        setLoading(true);
      }
      try {
        const [definitions, groups] = await Promise.all([listPipelineDefinitions(), listProjectGroups()]);
        setItems(definitions);
        setProjectGroups(groups);
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

  function handleEditOpenChange(open: boolean) {
    setEditOpen(open);
    if (!open) {
      setEditingItem(null);
      setEditDraft(createEmptyPipelineDraft());
      setEditScheduleRuntimeSnapshots([]);
      setLoadingEditScheduleRuntime(false);
    }
  }

  const refreshEditScheduleRuntime = React.useCallback(
    async (pipelineDefinitionId: number, { clearOnError = false }: { clearOnError?: boolean } = {}) => {
      setLoadingEditScheduleRuntime(true);
      try {
        const snapshots = await getPipelineScheduleRuntimeSnapshots(pipelineDefinitionId);
        setEditScheduleRuntimeSnapshots(snapshots);
      } catch (error) {
        if (clearOnError) {
          setEditScheduleRuntimeSnapshots([]);
        }
        toast.error(readCommandErrorMessage(error, "加载调度运行时状态失败。"));
      } finally {
        setLoadingEditScheduleRuntime(false);
      }
    },
    []
  );

  async function onCreate() {
    setCreating(true);
    try {
      const payload = buildPipelineCreatePayload(createDraft);
      await createPipelineDefinition(payload);
      toast.success("流水线已创建。");
      setCreateOpen(false);
      setCreateDraft(createEmptyPipelineDraft());
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

      setEditingItem(item);
      setEditDraft(toDraftFromDetail(detail));
      setEditOpen(true);
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

    setSaving(true);
    try {
      const payload = buildPipelineCreatePayload(editDraft);
      await updatePipelineDefinition({
        id: editingItem.id,
        ...payload,
      });
      toast.success("流水线已保存。");
      handleEditOpenChange(false);
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
                <p className={createReadiness.ready ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
                  {createReadiness.message}
                </p>
                <DialogFooter>
                  <Button variant="secondary" type="button" onClick={() => setCreateDraft(createEmptyPipelineDraft())}>
                    清空
                  </Button>
                  <Button type="button" onClick={() => void onCreate()} disabled={creating || !createReadiness.ready}>
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

      <Dialog open={editOpen} onOpenChange={handleEditOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>编辑流水线定义</DialogTitle>
            <DialogDescription>更新基础信息、节点顺序和调度规则。</DialogDescription>
          </DialogHeader>
          <PipelineDraftForm
            draft={editDraft}
            projectGroups={projectGroups}
            scheduleRuntimeSnapshots={editScheduleRuntimeSnapshots}
            loadingScheduleRuntime={loadingEditScheduleRuntime}
            onChange={setEditDraft}
            onRefreshScheduleRuntime={editingItem ? () => void refreshEditScheduleRuntime(editingItem.id) : undefined}
          />
          <DialogFooter>
            {editingItem ? (
              <Button
                variant="secondary"
                type="button"
                onClick={() => void refreshEditScheduleRuntime(editingItem.id)}
                disabled={loadingEditScheduleRuntime}
                data-testid="pipeline-schedule-runtime-refresh"
              >
                {loadingEditScheduleRuntime ? "刷新中..." : "刷新调度状态"}
              </Button>
            ) : null}
            <Button variant="secondary" type="button" onClick={() => handleEditOpenChange(false)}>
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
