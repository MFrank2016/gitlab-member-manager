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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listGroupMembers, listLocalGroups, createLocalGroup, removeMembersFromGroup } from "@/lib/invoke";
import type { LocalGroup, LocalMember } from "@/lib/types";

export function GroupsPage() {
  const [groups, setGroups] = React.useState<LocalGroup[]>([]);
  const [activeGroup, setActiveGroup] = React.useState<LocalGroup | null>(null);
  const [members, setMembers] = React.useState<LocalMember[]>([]);
  const [newName, setNewName] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);

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

  async function onCreate() {
    if (!newName.trim()) return;
    await createLocalGroup(newName.trim());
    setNewName("");
    await refresh();
    setCreateOpen(false);
  }

  async function removeOne(userId: number) {
    if (!activeGroup) return;
    await removeMembersFromGroup(activeGroup.id, [userId]);
    await openGroup(activeGroup);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">本地虚拟分组</h2>
        <p className="text-sm text-muted-foreground">分组只保存在本地 SQLite，用于批量拉人/移除。</p>
      </div>

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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h3 className="font-semibold">分组列表</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.id} className="cursor-pointer" onClick={() => void openGroup(g)}>
                  <TableCell className="font-mono">{g.id}</TableCell>
                  <TableCell className={activeGroup?.id === g.id ? "font-semibold" : ""}>{g.name}</TableCell>
                  <TableCell className="font-mono text-xs">{g.createdAt}</TableCell>
                </TableRow>
              ))}
              {groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">暂无分组</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">分组成员 {activeGroup ? `— ${activeGroup.name}` : ""}</h3>
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
              {members.map((m) => (
                <TableRow key={m.userId}>
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
              {activeGroup && members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">该分组暂无成员</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
