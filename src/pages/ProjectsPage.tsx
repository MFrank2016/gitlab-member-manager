import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { searchProjects } from "@/lib/invoke";
import type { ProjectSummary } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 20;

type Props = {
  onPickProject: (p: ProjectSummary) => void;
};

export function ProjectsPage({ onPickProject }: Props) {
  const [keyword, setKeyword] = React.useState("");
  const [items, setItems] = React.useState<ProjectSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>("");
  const [page, setPage] = React.useState(1);

  async function fetchPage(p: number) {
    setError("");
    setLoading(true);
    try {
      const res = await searchProjects(keyword.trim(), p, PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function onSearch() {
    setPage(1);
    await fetchPage(1);
  }

  function onPageChange(next: number) {
    setPage(next);
    void fetchPage(next);
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-col items-start gap-1">
      <div className="flex flex-col gap-2">
        {/* <h2 className="text-xl font-semibold">项目搜索</h2> */}
        <p className="text-sm text-muted-foreground">输入关键字搜索项目，点击行可选择项目。</p>
      </div>
        </PanelHeader>
        <PanelBody>
      <div className="flex flex-wrap gap-2 max-w-2xl">
        <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="关键字（项目名/namespace）" />
        <Button onClick={onSearch} disabled={loading}>
          {loading ? "搜索中..." : "搜索"}
        </Button>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            第 {safePage} / {pageCount} 页（共 {total}）
          </span>
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
            <TableHead>ID</TableHead>
            <TableHead>项目名</TableHead>
            <TableHead>Namespace</TableHead>
            <TableHead>描述</TableHead>
            <TableHead>最后更新时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((p) => (
            <TableRow
              key={p.id}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => onPickProject(p)}
            >
              <TableCell className="font-mono">{p.id}</TableCell>
              <TableCell>{p.name}</TableCell>
              <TableCell className="text-muted-foreground">{p.namespace}</TableCell>
              <TableCell className="text-muted-foreground line-clamp-2">{p.description ?? ""}</TableCell>
              <TableCell className="font-mono text-xs">{formatDateTime(p.lastActivityAt)}</TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                {loading ? "加载中..." : total === 0 ? "请输入关键字并搜索" : "无匹配结果"}
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
