import * as React from "react";

import { ProjectCombobox } from "@/components/ProjectCombobox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
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
  const [memberFilter, setMemberFilter] = React.useState("");
  const [memberPage, setMemberPage] = React.useState(1);

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

  React.useEffect(() => {
    setMemberPage(1);
  }, [memberFilter, members.length]);

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

  const membersPageSize = 50;
  const filteredMembers = members.filter((m) => {
    const q = memberFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      String(m.id).includes(q) ||
      m.username.toLowerCase().includes(q) ||
      (m.name ?? "").toLowerCase().includes(q)
    );
  });
  const membersPageCount = Math.max(1, Math.ceil(filteredMembers.length / membersPageSize));
  const safeMemberPage = Math.min(memberPage, membersPageCount);
  const pagedMembers = filteredMembers.slice(
    (safeMemberPage - 1) * membersPageSize,
    safeMemberPage * membersPageSize
  );

  const allChecked = pagedMembers.length > 0 && pagedMembers.every((m) => selectedIds.has(m.id));

  function toggleAll(checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) {
      pagedMembers.forEach((m) => next.add(m.id));
    } else {
      pagedMembers.forEach((m) => next.delete(m.id));
    }
    setSelectedIds(next);
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
    try {
      await upsertLocalMembers(
        selected.map((m) => ({
          userId: m.id,
          username: m.username,
          name: m.name,
          avatarUrl: m.avatarUrl ?? null,
        }))
      );
      toast.success(`已保存到本地成员：${selected.length} 个（已存在的会更新，未存在的会创建）`);
      await refreshGroups();
    } catch (e) {
      toast.error(`保存本地成员失败：${String(e)}`);
    }
  }

  async function batchAddByGroup() {
    if (!selectedProject) return;
    if (!groupId) {
      toast.error("请先选择分组");
      return;
    }
    const gid = Number(groupId);
    const groupMembers = await listGroupMembers(gid);
    const userIds = groupMembers.map((m) => m.userId);
    if (userIds.length === 0) {
      toast.error("该分组没有成员");
      return;
    }
    try {
      const res = await batchAddMembersToProject({
        project: String(selectedProject.id),
        userIds,
        accessLevel: Number(accessLevel),
        expiresAt: expiresAt.trim() ? expiresAt.trim() : null,
      });
      toast.success(`批量添加完成：成功 ${res.successUserIds.length}，失败 ${res.failed.length}`);
      await loadMembers(selectedProject);
    } catch (e) {
      toast.error(`批量添加失败：${String(e)}`);
    }
  }

  async function batchRemoveSelected() {
    if (!selectedProject) return;
    const userIds = Array.from(selectedIds);
    if (userIds.length === 0) return;
    const ok = confirm(`确认从项目移除 ${userIds.length} 个成员？`);
    if (!ok) return;
    try {
      const res = await batchRemoveMembersFromProject({ project: String(selectedProject.id), userIds });
      toast.success(`批量移除完成：成功 ${res.successUserIds.length}，失败 ${res.failed.length}`);
      await loadMembers(selectedProject);
    } catch (e) {
      toast.error(`批量移除失败：${String(e)}`);
    }
  }

  async function batchRemoveByGroup() {
    if (!selectedProject) return;
    if (!groupId) {
      toast.error("请先选择分组");
      return;
    }
    const gid = Number(groupId);
    const groupMembers = await listGroupMembers(gid);
    const userIds = groupMembers.map((m) => m.userId);
    if (userIds.length === 0) {
      toast.error("该分组没有成员");
      return;
    }
    const ok = confirm(`确认从项目移除分组(${gid})下的 ${userIds.length} 个成员？`);
    if (!ok) return;
    try {
      const res = await batchRemoveMembersFromProject({ project: String(selectedProject.id), userIds });
      toast.success(`批量移除完成：成功 ${res.successUserIds.length}，失败 ${res.failed.length}`);
      await loadMembers(selectedProject);
    } catch (e) {
      toast.error(`批量移除失败：${String(e)}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">项目成员管理</h2>
        <p className="text-sm text-muted-foreground">选择项目后查看成员，并支持保存到本地、按分组批量拉人/移除。</p>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-2 max-w-3xl">
          <Label>选择项目</Label>
          <ProjectCombobox
            value={selectedProject}
            onChange={(p) => {
              setSelectedProject(p);
              if (p) void loadMembers(p);
            }}
            placeholder="输入项目名，模糊查询"
          />
        </div>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="grid gap-1">
          <Label>分组</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="选择本地分组" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>
                  #{g.id} {g.name}【{g.membersCount ?? 0}人】
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
            type="date"
            className="w-[220px]"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>

        <div className="text-sm text-muted-foreground">已选择 {selectedIds.size} 人</div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={batchAddByGroup} disabled={!selectedProject}>
            按分组批量拉人
          </Button>
          <Button onClick={addSelectedToLocal} disabled={selectedIds.size === 0}>
            保存所选到本地成员
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:border-l md:border-border md:pl-3">
          <Button variant="destructive" onClick={batchRemoveByGroup} disabled={!selectedProject}>
            按分组批量移除
          </Button>
          <Button
            variant="destructive"
            onClick={batchRemoveSelected}
            disabled={!selectedProject || selectedIds.size === 0}
          >
            批量移除所选
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-1">
          <Label>过滤成员</Label>
          <Input
            className="w-[260px]"
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            placeholder="用户名 / 昵称 / ID"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            第 {safeMemberPage} / {membersPageCount} 页（共 {filteredMembers.length}）
          </span>
          <Button
            variant="secondary"
            onClick={() => setMemberPage((p) => Math.max(1, p - 1))}
            disabled={safeMemberPage <= 1}
          >
            上一页
          </Button>
          <Button
            variant="secondary"
            onClick={() => setMemberPage((p) => Math.min(membersPageCount, p + 1))}
            disabled={safeMemberPage >= membersPageCount}
          >
            下一页
          </Button>
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-lg border bg-card">
        <div className="max-h-[440px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
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
              {pagedMembers.map((m) => (
                <TableRow key={m.id} className="transition-colors hover:bg-muted/50">
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
              {filteredMembers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    {loading
                      ? "加载中..."
                      : selectedProject
                        ? memberFilter.trim()
                          ? "无匹配成员"
                          : "该项目暂无成员"
                        : "请选择项目"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
