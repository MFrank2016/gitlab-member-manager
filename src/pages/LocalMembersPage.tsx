import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addMembersToGroup, deleteLocalMembers, listLocalGroups, listLocalMembers } from "@/lib/invoke";
import { toast } from "sonner";
import type { LocalGroup, LocalMember } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 50;

export function LocalMembersPage() {
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<LocalMember[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [groups, setGroups] = React.useState<LocalGroup[]>([]);
  const [groupId, setGroupId] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [page, setPage] = React.useState(1);

  async function fetch(pageNum: number) {
    setLoading(true);
    try {
      const res = await listLocalMembers(
        query.trim() || undefined,
        pageNum,
        PAGE_SIZE
      );
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function refreshGroups() {
    const res = await listLocalGroups();
    setGroups(res);
  }

  React.useEffect(() => {
    void fetch(1);
    void refreshGroups();
  }, []);

  async function onSearch() {
    setPage(1);
    setSelected(new Set());
    await fetch(1);
  }

  function onPageChange(next: number) {
    setPage(next);
    setSelected(new Set());
    void fetch(next);
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const allChecked = items.length > 0 && items.every((m) => selected.has(m.userId));

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(items.map((m) => m.userId)));
    } else {
      setSelected(new Set());
    }
  }

  async function addToGroup() {
    if (!groupId) {
      toast.error("请选择分组");
      return;
    }
    const userIds = Array.from(selected);
    if (userIds.length === 0) return;
    try {
      await addMembersToGroup(Number(groupId), userIds);
      toast.success(`加入分组成功：共 ${userIds.length} 人`);
      await refreshGroups();
    } catch (e) {
      toast.error(`加入分组失败：${String(e)}`);
    }
  }

  async function onDeleteSelected() {
    const userIds = Array.from(selected);
    if (userIds.length === 0) return;
    const ok = confirm(`确认从本地成员中删除 ${userIds.length} 人？`);
    if (!ok) return;
    try {
      await deleteLocalMembers(userIds);
      toast.success(`已删除 ${userIds.length} 人`);
      setSelected(new Set());
      setPage(1);
      await fetch(1);
      await refreshGroups();
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-col items-start gap-1">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">从项目成员保存的本地成员，可用于创建“虚拟分组”。支持分页、筛选、全选、删除。</p>
      </div>
        </PanelHeader>
        <PanelBody>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label>搜索</Label>
          <Input
            className="w-[320px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="用户名 / 昵称 / ID，按回车或点搜索"
          />
        </div>
        <Button variant="secondary" onClick={onSearch} disabled={loading}>
          搜索
        </Button>

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
        <Button onClick={addToGroup} disabled={selected.size === 0}>
          加入分组
        </Button>

        <Button variant="destructive" onClick={onDeleteSelected} disabled={selected.size === 0}>
          批量删除
        </Button>
      </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          第 {safePage} / {pageCount} 页（共 {total}）
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => onPageChange(Math.max(1, safePage - 1))}
            disabled={safePage <= 1 || loading}
          >
            上一页
          </Button>
          <Button
            variant="secondary"
            onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
            disabled={safePage >= pageCount || loading}
          >
            下一页
          </Button>
        </div>
        </PanelHeader>
        <PanelBody>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) => toggleAll(Boolean(v))}
                />
                <span>全选</span>
              </div>
            </TableHead>
            <TableHead>UserID</TableHead>
            <TableHead>用户名</TableHead>
            <TableHead>昵称</TableHead>
            <TableHead>项目</TableHead>
            <TableHead>更新时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((m) => (
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
              <TableCell className="text-muted-foreground max-w-[200px] truncate" title={m.projectName ?? undefined}>
                {m.projectName ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">{formatDateTime(m.updatedAt)}</TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                {loading ? "加载中..." : "暂无本地成员，可在项目成员页保存"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
        </PanelBody>
      </Panel>
    </div>
  );
}
