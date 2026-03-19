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
  addProjectsToGroup,
  createProjectGroup,
  deleteProjectGroup,
  listManagedProjects,
  listProjectGroupProjects,
  listProjectGroups,
  removeProjectsFromGroup,
  updateProjectGroup,
} from "@/lib/invoke";
import type { ManagedProject, ProjectGroup } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function ProjectGroupsPage() {
  const [groups, setGroups] = React.useState<ProjectGroup[]>([]);
  const [managedProjects, setManagedProjects] = React.useState<ManagedProject[]>([]);
  const [groupProjects, setGroupProjects] = React.useState<ManagedProject[]>([]);
  const [activeGroupId, setActiveGroupId] = React.useState<number | null>(null);
  const [selectedManagedIds, setSelectedManagedIds] = React.useState<Set<number>>(new Set());
  const [loading, setLoading] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [newGroupName, setNewGroupName] = React.useState("");

  const [editOpen, setEditOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState<ProjectGroup | null>(null);
  const [editGroupName, setEditGroupName] = React.useState("");

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;
  const groupProjectIds = new Set(groupProjects.map((project) => project.id));

  async function refreshGroups(preferredGroupId?: number | null) {
    const result = await listProjectGroups();
    const preferred = preferredGroupId ?? activeGroupId;
    const nextActiveGroupId =
      preferred && result.some((group) => group.id === preferred)
        ? preferred
        : (result[0]?.id ?? null);

    setGroups(result);
    setActiveGroupId(nextActiveGroupId);
    return nextActiveGroupId;
  }

  async function refreshManagedProjects() {
    setManagedProjects(await listManagedProjects());
  }

  async function refreshGroupProjects(groupId: number | null) {
    if (!groupId) {
      setGroupProjects([]);
      return;
    }
    setGroupProjects(await listProjectGroupProjects(groupId));
  }

  async function refreshAll() {
    setLoading(true);
    try {
      const nextActiveGroupId = await refreshGroups(activeGroupId);
      await Promise.all([
        refreshManagedProjects(),
        refreshGroupProjects(nextActiveGroupId),
      ]);
    } catch (error) {
      toast.error(`加载项目分组失败：${String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refreshAll();
  }, []);

  React.useEffect(() => {
    void refreshGroupProjects(activeGroupId);
    setSelectedManagedIds(new Set());
  }, [activeGroupId]);

  async function onCreateGroup() {
    if (!newGroupName.trim()) {
      toast.error("分组名称不能为空。");
      return;
    }
    try {
      const created = await createProjectGroup(newGroupName.trim());
      setCreateOpen(false);
      setNewGroupName("");
      await refreshGroups();
      setActiveGroupId(created.id);
      toast.success("项目分组已创建。");
    } catch (error) {
      toast.error(`创建分组失败：${String(error)}`);
    }
  }

  function openEditGroup(group: ProjectGroup) {
    setEditingGroup(group);
    setEditGroupName(group.name);
    setEditOpen(true);
  }

  async function onSaveEditGroup() {
    if (!editingGroup) return;
    if (!editGroupName.trim()) {
      toast.error("分组名称不能为空。");
      return;
    }

    try {
      await updateProjectGroup(editingGroup.id, editGroupName.trim());
      setEditOpen(false);
      setEditingGroup(null);
      await refreshGroups();
      toast.success("项目分组已更新。");
    } catch (error) {
      toast.error(`更新分组失败：${String(error)}`);
    }
  }

  async function onDeleteGroup(group: ProjectGroup) {
    if (!confirm(`确定删除项目分组“${group.name}”吗？`)) return;
    try {
      await deleteProjectGroup(group.id);
      await refreshGroups();
      toast.success("项目分组已删除。");
    } catch (error) {
      toast.error(`删除分组失败：${String(error)}`);
    }
  }

  function toggleSelectManaged(id: number, checked: boolean) {
    setSelectedManagedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function addSelectedProjects() {
    if (!activeGroupId) {
      toast.error("请先选择项目分组。");
      return;
    }
    const idsToAdd = Array.from(selectedManagedIds).filter((id) => !groupProjectIds.has(id));
    if (idsToAdd.length === 0) {
      toast.error("没有可加入的项目。");
      return;
    }

    try {
      await addProjectsToGroup(activeGroupId, idsToAdd);
      setSelectedManagedIds(new Set());
      await Promise.all([refreshGroups(), refreshGroupProjects(activeGroupId)]);
      toast.success(`已向分组中加入 ${idsToAdd.length} 个项目。`);
    } catch (error) {
      toast.error(`加入项目失败：${String(error)}`);
    }
  }

  async function removeProjectFromActiveGroup(projectId: number) {
    if (!activeGroupId) return;
    try {
      await removeProjectsFromGroup(activeGroupId, [projectId]);
      await Promise.all([refreshGroups(), refreshGroupProjects(activeGroupId)]);
      toast.success("项目已移出分组。");
    } catch (error) {
      toast.error(`移出项目失败：${String(error)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">项目分组</h2>
            <p className="text-sm text-muted-foreground">
              将托管项目组织成本地分组，用于后续批量操作。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void refreshAll()} disabled={loading}>
              刷新
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>新建分组</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>新建项目分组</DialogTitle>
                  <DialogDescription>使用本地项目分组来组织后续批量操作。</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                  <Label>名称</Label>
                  <Input
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="例如：release-train"
                    autoFocus
                  />
                </div>
                <DialogFooter>
                  <Button variant="secondary" onClick={() => setNewGroupName("")}>
                    清空
                  </Button>
                  <Button onClick={() => void onCreateGroup()}>创建</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </PanelHeader>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-2">
          <PanelHeader>
            <h3 className="font-semibold">分组列表</h3>
          </PanelHeader>
          <PanelBody>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>项目数</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow
                    key={group.id}
                    className={activeGroupId === group.id ? "bg-muted/50" : ""}
                    onClick={() => setActiveGroupId(group.id)}
                  >
                    <TableCell className="font-mono">{group.id}</TableCell>
                    <TableCell>{group.name}</TableCell>
                    <TableCell>{group.projectsCount}</TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEditGroup(group)}>
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => void onDeleteGroup(group)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {groups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      暂无项目分组。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </PanelBody>
        </Panel>

        <div className="space-y-4 xl:col-span-3">
          <Panel>
            <PanelHeader>
              <div className="space-y-1">
                <h3 className="font-semibold">
                  分组内项目 {activeGroup ? `- ${activeGroup.name}` : ""}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {activeGroup ? `更新于 ${formatDateTime(activeGroup.updatedAt)}` : "请选择一个分组查看项目。"}
                </p>
              </div>
            </PanelHeader>
            <PanelBody>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>GitLab ID</TableHead>
                    <TableHead>命名空间路径</TableHead>
                    <TableHead>仓库路径</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupProjects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-mono">{project.gitlabProjectId}</TableCell>
                      <TableCell className="font-mono text-xs">{project.pathWithNamespace}</TableCell>
                      <TableCell className="font-mono text-xs">{project.repoPath}</TableCell>
                      <TableCell>{project.enabled ? "启用" : "禁用"}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => void removeProjectFromActiveGroup(project.id)}
                        >
                          移除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {groupProjects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        {activeGroup ? "当前分组还没有项目。" : "尚未选择分组。"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader className="flex-wrap gap-2">
              <h3 className="font-semibold">添加托管项目</h3>
              <Button
                size="sm"
                onClick={() => void addSelectedProjects()}
                disabled={!activeGroup || selectedManagedIds.size === 0}
              >
                添加所选（{selectedManagedIds.size}）
              </Button>
            </PanelHeader>
            <PanelBody>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>选择</TableHead>
                    <TableHead>GitLab ID</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>路径</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managedProjects.map((project) => {
                    const alreadyInGroup = groupProjectIds.has(project.id);
                    return (
                      <TableRow key={project.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedManagedIds.has(project.id)}
                            disabled={alreadyInGroup || !activeGroup}
                            onCheckedChange={(value) => toggleSelectManaged(project.id, Boolean(value))}
                          />
                        </TableCell>
                        <TableCell className="font-mono">{project.gitlabProjectId}</TableCell>
                        <TableCell>
                          {project.name}
                          {alreadyInGroup && (
                            <span className="ml-2 text-xs text-muted-foreground">（已加入）</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{project.pathWithNamespace}</TableCell>
                      </TableRow>
                    );
                  })}
                  {managedProjects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        暂无托管项目。
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑项目分组</DialogTitle>
            <DialogDescription>更新本地项目分组名称。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>名称</Label>
            <Input
              value={editGroupName}
              onChange={(e) => setEditGroupName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void onSaveEditGroup()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
