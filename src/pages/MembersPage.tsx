import * as React from "react";

import { ProjectCombobox } from "@/components/ProjectCombobox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  batchAddMembersToProject,
  batchRemoveMembersFromProject,
  listGroupMembers,
  listLocalGroups,
  listProjectMembers,
  upsertLocalMembers,
} from "@/lib/invoke";
import type { LocalGroup, ProjectMember, ProjectSummary } from "@/lib/types";
import { ACCESS_LEVELS, accessLevelLabel } from "@/lib/types";

export function MembersPage() {
  const [selectedProject, setSelectedProject] = React.useState<ProjectSummary | null>(null);
  const [members, setMembers] = React.useState<ProjectMember[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>("");

  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());

  const [groups, setGroups] = React.useState<LocalGroup[]>([]);
  const [groupId, setGroupId] = React.useState<string>("");
  const [accessLevel, setAccessLevel] = React.useState<string>("30");
  const [expiresAt, setExpiresAt] = React.useState<string>("");

  async function refreshGroups() {
    try {
      const g = await listLocalGroups();
      setGroups(g);
    } catch {
      setGroups([]);
    }
  }

  React.useEffect(() => {
    refreshGroups();
  }, []);

  async function loadMembers(p: ProjectSummary) {
    setError("");
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const res = await listProjectMembers(String(p.id));
      setMembers(res);
    } catch (e) {
      setMembers([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const allChecked = members.length > 0 && selectedIds.size === members.length;

  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(members.map((m) => m.id)));
  }

  function toggleOne(id: number, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  }

  async function addSelectedToLocal() {
    const selected = members.filter((m) => selectedIds.has(m.id));
    if (selected.length === 0) return;
    await upsertLocalMembers(
      selected.map((m) => ({
        userId: m.id,
        username: m.username,
        name: m.name,
        avatarUrl: m.avatarUrl ?? null,
      }))
    );
    alert(`已保存 ${selected.length} 个成员到本地库`);
    await refreshGroups();
  }

  async function batchAddByGroup() {
    if (!selectedProject) return;
    if (!groupId) {
      alert("请先选择分组");
      return;
    }
    const gid = Number(groupId);
    const groupMembers = await listGroupMembers(gid);
    const userIds = groupMembers.map((m) => m.userId);
    if (userIds.length === 0) {
      alert("该分组没有成员");
      return;
    }
    const res = await batchAddMembersToProject({
      project: String(selectedProject.id),
      userIds,
      accessLevel: Number(accessLevel),
      expiresAt: expiresAt.trim() ? expiresAt.trim() : null,
    });
    alert(`批量添加完成：成功 ${res.successUserIds.length}，失败 ${res.failed.length}`);
    await loadMembers(selectedProject);
  }

  async function batchRemoveSelected() {
    if (!selectedProject) return;
    const userIds = Array.from(selectedIds);
    if (userIds.length === 0) return;
    const ok = confirm(`确认从项目移除 ${userIds.length} 个成员？`);
    if (!ok) return;
    const res = await batchRemoveMembersFromProject({ project: String(selectedProject.id), userIds });
    alert(`批量移除完成：成功 ${res.successUserIds.length}，失败 ${res.failed.length}`);
    await loadMembers(selectedProject);
  }

  async function batchRemoveByGroup() {
    if (!selectedProject) return;
    if (!groupId) {
      alert("请先选择分组");
      return;
    }
    const gid = Number(groupId);
    const groupMembers = await listGroupMembers(gid);
    const userIds = groupMembers.map((m) => m.userId);
    if (userIds.length === 0) {
      alert("该分组没有成员");
      return;
    }
    const ok = confirm(`确认从项目移除分组(${gid})下的 ${userIds.length} 个成员？`);
    if (!ok) return;
    const res = await batchRemoveMembersFromProject({ project: String(selectedProject.id), userIds });
    alert(`批量移除完成：成功 ${res.successUserIds.length}，失败 ${res.failed.length}`);
    await loadMembers(selectedProject);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">项目成员管理</h2>
        <p className="text-sm text-muted-foreground">选择项目后查看成员，并支持保存到本地、按分组批量拉人/移除。</p>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-2 max-w-3xl">
          <Label>选择项目</Label>
          <ProjectCombobox
            value={selectedProject}
            onChange={(p) => {
              setSelectedProject(p);
              if (p) void loadMembers(p);
            }}
            placeholder="输入项目ID或项目名"
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label>分组</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="选择本地分组" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name} (#{g.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label>权限</Label>
            <Select value={accessLevel} onValueChange={setAccessLevel}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCESS_LEVELS.map((a) => (
                  <SelectItem key={a.value} value={String(a.value)}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label>过期时间（可选）</Label>
            <Input
              className="w-[220px]"
              placeholder="YYYY-MM-DD"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>

          <Button variant="secondary" onClick={batchAddByGroup} disabled={!selectedProject}>
            按分组批量拉人
          </Button>
          <Button variant="destructive" onClick={batchRemoveByGroup} disabled={!selectedProject}>
            按分组批量移除
          </Button>

          <Button onClick={addSelectedToLocal} disabled={selectedIds.size === 0}>
            保存所选到本地成员
          </Button>
          <Button variant="destructive" onClick={batchRemoveSelected} disabled={!selectedProject || selectedIds.size === 0}>
            批量移除所选
          </Button>
        </div>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) => toggleAll(Boolean(v))}
                />
                <span>选择</span>
              </div>
            </TableHead>
            <TableHead>头像</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>用户名</TableHead>
            <TableHead>昵称</TableHead>
            <TableHead>权限</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead>过期时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <Checkbox
                  checked={selectedIds.has(m.id)}
                  onCheckedChange={(v) => toggleOne(m.id, Boolean(v))}
                />
              </TableCell>
              <TableCell>
                <Avatar className="h-8 w-8 rounded-full overflow-hidden">
                  <AvatarImage src={m.avatarUrl ?? undefined} />
                  <AvatarFallback>{m.name?.slice(0, 1) ?? "?"}</AvatarFallback>
                </Avatar>
              </TableCell>
              <TableCell className="font-mono">{m.id}</TableCell>
              <TableCell className="font-mono">{m.username}</TableCell>
              <TableCell>{m.name}</TableCell>
              <TableCell>{accessLevelLabel(m.accessLevel)}</TableCell>
              <TableCell className="font-mono text-xs">{m.createdAt ?? ""}</TableCell>
              <TableCell className="font-mono text-xs">{m.expiresAt ?? ""}</TableCell>
            </TableRow>
          ))}
          {members.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                {loading ? "加载中..." : "请选择项目"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
