import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { searchProjects } from "@/lib/invoke";
import type { ProjectSummary } from "@/lib/types";

type Props = {
  onPickProject: (p: ProjectSummary) => void;
};

export function ProjectsPage({ onPickProject }: Props) {
  const [keyword, setKeyword] = React.useState("");
  const [items, setItems] = React.useState<ProjectSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>("");

  async function onSearch() {
    setError("");
    setLoading(true);
    try {
      const res = await searchProjects(keyword.trim());
      setItems(res);
    } catch (e) {
      setError(String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">项目搜索</h2>
        <p className="text-sm text-muted-foreground">输入关键字搜索项目，点击行可选择项目。</p>
      </div>

      <div className="flex gap-2 max-w-2xl">
        <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="关键字（项目名/namespace）" />
        <Button onClick={onSearch} disabled={loading}>
          {loading ? "搜索中..." : "搜索"}
        </Button>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

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
            <TableRow key={p.id} className="cursor-pointer" onClick={() => onPickProject(p)}>
              <TableCell className="font-mono">{p.id}</TableCell>
              <TableCell>{p.name}</TableCell>
              <TableCell className="text-muted-foreground">{p.namespace}</TableCell>
              <TableCell className="text-muted-foreground line-clamp-2">{p.description ?? ""}</TableCell>
              <TableCell className="font-mono text-xs">{p.lastActivityAt}</TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                {loading ? "加载中..." : "暂无数据"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
