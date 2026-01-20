import * as React from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  listGroupMembers,
  listLocalGroups,
  createLocalGroup,
  updateLocalGroup,
  deleteLocalGroup,
  removeMembersFromGroup,
} from "@/lib/invoke";
import type { LocalGroup, LocalMember } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { toast } from "sonner";

export function GroupsPage() {
  const [groups, setGroups] = React.useState<LocalGroup[]>([]);
  const [activeGroup, setActiveGroup] = React.useState<LocalGroup | null>(null);
  const [members, setMembers] = React.useState<LocalMember[]>([]);
  const [newName, setNewName] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState<LocalGroup | null>(null);
  const [editName, setEditName] = React.useState("");
  const [groupFilter, setGroupFilter] = React.useState("");
  const [groupPage, setGroupPage] = React.useState(1);
  const [memberFilter, setMemberFilter] = React.useState("");
  const [memberPage, setMemberPage] = React.useState(1);

  async function refresh() {
    const g = await listLocalGroups();
    setGroups(g);
  }

  async function openGroup(g: LocalGroup) {
    setActiveGroup(g);
    const ms = await listGroupMembers(g.id);
    setMembers(ms);
  }

  React.useEffect(() => {
    void refresh();
  }, []);

  React.useEffect(() => {
    setGroupPage(1);
  }, [groupFilter, groups.length]);

  React.useEffect(() => {
    setMemberPage(1);
  }, [memberFilter, members.length]);

  async function onCreate() {
    if (!newName.trim()) return;
    await createLocalGroup(newName.trim());
    setNewName("");
    await refresh();
    setCreateOpen(false);
  }

  function openEdit(g: LocalGroup, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingGroup(g);
    setEditName(g.name);
    setEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editingGroup || !editName.trim()) return;
    await updateLocalGroup(editingGroup.id, editName.trim());
    await refresh();
    setActiveGroup((prev) =>
      prev && prev.id === editingGroup.id ? { ...prev, name: editName.trim() } : prev
    );
    setEditOpen(false);
    setEditingGroup(null);
    toast.success("已更新分组名称");
  }

  async function onDeleteGroup(g: LocalGroup, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`确认删除分组「${g.name}」？成员关联将被移除。`)) return;
    try {
      await deleteLocalGroup(g.id);
      await refresh();
      if (activeGroup?.id === g.id) {
        setActiveGroup(null);
        setMembers([]);
      }
      toast.success("已删除分组");
    } catch (err) {
      toast.error(`删除失败：${String(err)}`);
    }
  }

  async function removeOne(userId: number) {
    if (!activeGroup) return;
    await removeMembersFromGroup(activeGroup.id, [userId]);
    await openGroup(activeGroup);
  }

  const groupPageSize = 20;
  const filteredGroups = groups.filter((g) => {
    const q = groupFilter.trim().toLowerCase();
    if (!q) return true;
    return String(g.id).includes(q) || g.name.toLowerCase().includes(q);
  });
  const groupPageCount = Math.max(1, Math.ceil(filteredGroups.length / groupPageSize));
  const safeGroupPage = Math.min(groupPage, groupPageCount);
  const pagedGroups = filteredGroups.slice(
    (safeGroupPage - 1) * groupPageSize,
    safeGroupPage * groupPageSize
  );

  const memberPageSize = 50;
  const filteredMembers = members.filter((m) => {
    const q = memberFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      String(m.userId).includes(q) ||
      m.username.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q)
    );
  });
  const memberPageCount = Math.max(1, Math.ceil(filteredMembers.length / memberPageSize));
  const safeMemberPage = Math.min(memberPage, memberPageCount);
  const pagedMembers = filteredMembers.slice(
    (safeMemberPage - 1) * memberPageSize,
    safeMemberPage * memberPageSize
  );

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-col items-start gap-1">
        <div className="space-y-1">
                <h2 className="text-xl font-semibold">本地虚拟分组</h2>
                <p className="text-sm text-muted-foreground">分组只保存在本地 SQLite，用于批量拉人/移除。</p>
              </div>
        </PanelHeader>
        <PanelBody>
        <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={refresh}>刷新</Button>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                  <DialogTrigger asChild>
                    <Button>新建分组</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[480px] space-y-4">
                    <DialogHeader className="space-y-1">
                      <DialogTitle>新建分组</DialogTitle>
                      <DialogDescription>给分组取一个好记的名字，便于批量拉人/移除。</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                      <Label>分组名称</Label>
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        autoFocus
                        placeholder="例如：backend-team"
                      />
                    </div>
                    <DialogFooter className="gap-2">
                      <Button variant="secondary" onClick={() => setNewName("")}>
                        清空
                      </Button>
                      <Button onClick={onCreate} disabled={!newName.trim()}>
                        创建
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Dialog open={editOpen} onOpenChange={setEditOpen}>
                  <DialogContent className="sm:max-w-[480px] space-y-4">
                    <DialogHeader className="space-y-1">
                      <DialogTitle>编辑分组</DialogTitle>
                      <DialogDescription>修改分组名称。</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                      <Label>分组名称</Label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                        placeholder="例如：backend-team"
                      />
                    </div>
                    <DialogFooter className="gap-2">
                      <Button variant="secondary" onClick={() => setEditOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={onSaveEdit} disabled={!editName.trim()}>
                        保存
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Panel>
        <PanelHeader className="flex flex-col gap-2">
          <h3 className="font-semibold">分组列表</h3>
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div className="grid gap-1">
                        <Label>过滤分组</Label>
                        <Input
                          className="w-[240px]"
                          value={groupFilter}
                          onChange={(e) => setGroupFilter(e.target.value)}
                          placeholder="名称 / ID"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>
                          第 {safeGroupPage} / {groupPageCount} 页（共 {filteredGroups.length}）
                        </span>
                        <Button
                          variant="secondary"
                          onClick={() => setGroupPage((p) => Math.max(1, p - 1))}
                          disabled={safeGroupPage <= 1}
                        >
                          上一页
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setGroupPage((p) => Math.min(groupPageCount, p + 1))}
                          disabled={safeGroupPage >= groupPageCount}
                        >
                          下一页
                        </Button>
                      </div>
                    </div>
        </PanelHeader>
        <PanelBody>
          <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>名称</TableHead>
                          <TableHead>创建时间</TableHead>
                          <TableHead>操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedGroups.map((g) => (
                          <TableRow
                            key={g.id}
                            className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                              activeGroup?.id === g.id ? "bg-muted/50" : ""
                            }`}
                            onClick={() => void openGroup(g)}
                          >
                            <TableCell className="font-mono">{g.id}</TableCell>
                            <TableCell className={activeGroup?.id === g.id ? "font-semibold" : ""}>{g.name}</TableCell>
                            <TableCell className="font-mono text-xs">{formatDateTime(g.createdAt)}</TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="sm" onClick={(e) => openEdit(g, e)}>
                                  编辑
                                </Button>
                                <Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => void onDeleteGroup(g, e)}>
                                  删除
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredGroups.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground">
                              {groups.length === 0 ? "暂无分组" : "无匹配结果"}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader className="flex flex-col gap-2">
          <h3 className="font-semibold">分组成员 {activeGroup ? `— ${activeGroup.name}` : ""}</h3>
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div className="grid gap-1">
                        <Label>过滤成员</Label>
                        <Input
                          className="w-[240px]"
                          value={memberFilter}
                          onChange={(e) => setMemberFilter(e.target.value)}
                          placeholder="用户名 / 昵称 / ID"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>
                          第 {safeMemberPage} / {memberPageCount} 页（共 {filteredMembers.length}）
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
                          onClick={() => setMemberPage((p) => Math.min(memberPageCount, p + 1))}
                          disabled={safeMemberPage >= memberPageCount}
                        >
                          下一页
                        </Button>
                      </div>
                    </div>
        </PanelHeader>
        <PanelBody>
          <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>UserID</TableHead>
                          <TableHead>用户名</TableHead>
                          <TableHead>昵称</TableHead>
                          <TableHead>操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedMembers.map((m) => (
                          <TableRow key={m.userId} className="transition-colors hover:bg-muted/50">
                            <TableCell className="font-mono">{m.userId}</TableCell>
                            <TableCell className="font-mono">{m.username}</TableCell>
                            <TableCell>{m.name}</TableCell>
                            <TableCell>
                              <Button variant="destructive" size="sm" onClick={() => void removeOne(m.userId)}>
                                移除
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {!activeGroup && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground">请选择左侧分组</TableCell>
                          </TableRow>
                        )}
                        {activeGroup && filteredMembers.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground">
                              {members.length === 0 ? "该分组暂无成员" : "无匹配结果"}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
        </PanelBody>
      </Panel>
      </div>
    </div>
  );
}
