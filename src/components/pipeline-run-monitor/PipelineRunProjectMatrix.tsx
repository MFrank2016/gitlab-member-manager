import * as React from "react";

import { cn } from "@/lib/utils";
import type { PipelineRunProjectStatus, PipelineRunNodeStatus, PipelineRunProject } from "@/lib/types";

import { buildPipelineRunProjectMatrix } from "./matrix-model";

const MATRIX_NODE_STATUS_CLASS: Record<string, string> = {
  pending: "border-slate-200 bg-slate-50 text-slate-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  waiting: "border-violet-200 bg-violet-50 text-violet-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  skipped: "border-zinc-200 bg-zinc-100 text-zinc-700",
  cancelled: "border-zinc-200 bg-zinc-100 text-zinc-700",
};

type PipelineRunProjectMatrixProps = {
  projects: PipelineRunProject[];
  selectedProjectId: number | null;
  onSelectProject: (projectId: number) => void;
  nodeTypeLabel: (nodeType: string) => string;
  statusLabel: (status: PipelineRunProjectStatus | PipelineRunNodeStatus) => string;
  remoteStatusLabel: (status: string | null | undefined) => string;
};

export function PipelineRunProjectMatrix({
  projects,
  selectedProjectId,
  onSelectProject,
  nodeTypeLabel,
  statusLabel,
  remoteStatusLabel,
}: PipelineRunProjectMatrixProps) {
  const matrix = React.useMemo(() => buildPipelineRunProjectMatrix(projects), [projects]);

  if (matrix.rows.length === 0 || matrix.columns.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无可用于矩阵视图的项目节点数据。</p>;
  }

  return (
    <div data-testid="pipeline-run-project-matrix" className="overflow-x-auto rounded-xl border border-border/70 bg-card">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            <th className="min-w-52 px-3 py-2 text-left text-xs font-semibold text-muted-foreground">项目</th>
            {matrix.columns.map((column) => (
              <th
                key={column.key}
                className="min-w-36 border-l border-border px-3 py-2 text-left align-top"
              >
                <div className="text-xs font-semibold text-foreground">节点 {column.nodeOrder + 1}</div>
                <div className="text-xs text-muted-foreground">{nodeTypeLabel(column.nodeType)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => {
            const isSelected = selectedProjectId === row.project.id;

            return (
              <tr
                key={row.project.id}
                data-testid={`pipeline-run-matrix-row-${row.project.id}`}
                className={cn("border-b border-border/60 align-top", isSelected && "bg-muted/30")}
              >
                <th className="px-3 py-2 text-left align-top">
                  <button
                    type="button"
                    className="grid gap-1 text-left"
                    aria-label={`项目 ${row.project.projectName}`}
                    onClick={() => onSelectProject(row.project.id)}
                  >
                    <span className="text-sm font-medium hover:underline">{row.project.projectName}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.project.projectPathWithNamespace}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      项目状态: {statusLabel(row.project.status)}
                    </span>
                  </button>
                </th>
                {row.cells.map((cell) => {
                  const status = cell.node?.status ?? null;
                  const statusClassName = status
                    ? MATRIX_NODE_STATUS_CLASS[status] ?? "border-border bg-muted/20 text-foreground"
                    : "border-dashed border-border bg-background text-muted-foreground";

                  return (
                    <td key={cell.columnKey} className="border-l border-border px-2 py-2 align-top">
                      <button
                        type="button"
                        data-testid={`pipeline-run-matrix-cell-${row.project.id}-${cell.nodeOrder}`}
                        className={cn(
                          "grid w-full gap-1 rounded-lg border p-2 text-left transition-colors hover:brightness-95",
                          isSelected && "ring-1 ring-ring/30",
                          statusClassName
                        )}
                        onClick={() => onSelectProject(row.project.id)}
                      >
                        <span className="text-xs font-semibold">
                          {status ? statusLabel(status) : "未执行"}
                        </span>
                        {cell.node?.waitTarget ? (
                          <span className="text-[11px] leading-5">{cell.node.waitTarget}</span>
                        ) : null}
                        {cell.node?.lastRemoteStatus ? (
                          <span className="text-[11px] leading-5">
                            远端: {remoteStatusLabel(cell.node.lastRemoteStatus)}
                          </span>
                        ) : null}
                        {cell.node?.summaryMessage ? (
                          <span className="text-[11px] leading-5">{cell.node.summaryMessage}</span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
