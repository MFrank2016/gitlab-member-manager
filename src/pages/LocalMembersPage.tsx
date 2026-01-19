import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addMembersToGroup, listLocalGroups, listLocalMembers } from "@/lib/invoke";
import type { LocalGroup, LocalMember } from "@/lib/types";

export function LocalMembersPage() {
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<LocalMember[]>([]);
  const [groups, setGroups] = React.useState<LocalGroup[]>([]);
  const [groupId, setGroupId] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  async function refresh() {
    const res = await listLocalMembers(query.trim() ? query.trim() : undefined);
    setItems(res);
  }

  async function refreshGroups() {
    const res = await listLocalGroups();
    setGroups(res);
  }

  React.useEffect(() => {
    void refresh();
    void refreshGroups();
  }, []);

  async function addToGroup() {
    if (!groupId) {
      alert("请选择分组");
      return;
    }
    const userIds = Array.from(selected);
    if (userIds.length === 0) return;
    await addMembersToGroup(Number(groupId), userIds);
    alert(`已添加 ${userIds.length} 人到分组`);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">本地成员库</h2>
        <p className="text-sm text-muted-foreground">从项目成员保存的本地成员，可用于创建“虚拟分组”。</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label>搜索</Label>
          <Input className="w-[320px]" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="username / name" />
        </div>
        <Button variant="secondary" onClick={refresh}>刷新</Button>

        <div className="grid gap-1">
          <Label>添加到分组</Label>
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
        <Button onClick={addToGroup} disabled={selected.size === 0}>加入分组</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>选择</TableHead>
            <TableHead>UserID</TableHead>
            <TableHead>用户名</TableHead>
            <TableHead>昵称</TableHead>
            <TableHead>更新时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((m) => (
            <TableRow key={m.userId}>
              <TableCell>
                <Checkbox
                  checked={selected.has(m.userId)}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(m.userId);
                    else next.delete(m.userId);
                    setSelected(next);
                  }}
                />
              </TableCell>
              <TableCell className="font-mono">{m.userId}</TableCell>
              <TableCell className="font-mono">{m.username}</TableCell>
              <TableCell>{m.name}</TableCell>
              <TableCell className="font-mono text-xs">{m.updatedAt}</TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">暂无本地成员</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
