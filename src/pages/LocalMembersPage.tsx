import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addMembersToGroup, listLocalGroups, listLocalMembers } from "@/lib/invoke";
import { toast } from "sonner";
import type { LocalGroup, LocalMember } from "@/lib/types";

export function LocalMembersPage() {
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<LocalMember[]>([]);
  const [groups, setGroups] = React.useState<LocalGroup[]>([]);
  const [groupId, setGroupId] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [tableFilter, setTableFilter] = React.useState("");
  const [page, setPage] = React.useState(1);

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

  React.useEffect(() => {
    setPage(1);
  }, [tableFilter, items.length]);

  async function addToGroup() {
    if (!groupId) {
      toast.error("请选择分组");
      return;
    }
    const userIds = Array.from(selected);
    if (userIds.length === 0) return;
    try {
      await addMembersToGroup(Number(groupId), userIds);
      toast.success(`加入分组成功：共处理 ${userIds.length} 人；已在分组中的成员会被更新，其余成员会新增。`);
    } catch (e) {
      toast.error(`加入分组失败：${String(e)}`);
    }
  }

  const pageSize = 50;
  const filteredItems = items.filter((m) => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      String(m.userId).includes(q) ||
      m.username.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q)
    );
  });
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);

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
          <Label>过滤当前结果</Label>
          <Input
            className="w-[240px]"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder="用户名 / 昵称 / ID"
          />
        </div>

        <div className="grid gap-1">
          <Label>添加到分组</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="选择本地分组" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>
                  #{g.id} {g.name}【{g.membersCount}人】
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={addToGroup} disabled={selected.size === 0}>加入分组</Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          第 {safePage} / {pageCount} 页（共 {filteredItems.length}）
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
          >
            上一页
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
          >
            下一页
          </Button>
        </div>
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
          {pagedItems.map((m) => (
            <TableRow key={m.userId} className="transition-colors hover:bg-muted/50">
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
          {filteredItems.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                {items.length === 0 ? "暂无本地成员" : "无匹配结果"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
