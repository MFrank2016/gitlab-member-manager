import type { MouseEventHandler } from "react";

import type { NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import type { StageGraphNodeData } from "./graph-model";

type StageGroupNodeData = StageGraphNodeData & {
  onContextMenu?: (payload: { stageKey: string; x: number; y: number }) => void;
};

export function StageGroupNode({
  data,
  selected,
}: NodeProps<StageGroupNodeData>) {
  const handleContextMenu: MouseEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    data.onContextMenu?.({
      stageKey: data.stageKey,
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <div
      data-testid={`pipeline-stage-node-card-${data.stageKey}`}
      onContextMenu={handleContextMenu}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border bg-white/95 p-3 text-slate-900 shadow-sm transition-colors",
        selected
          ? "border-sky-500 ring-4 ring-sky-100 shadow-sky-100/70"
          : "border-slate-300/90",
        !data.enabled && "bg-slate-100/90 text-slate-600"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-white">
              阶段
            </span>
            {selected ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                当前选中
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            <h4 className="break-words text-sm font-semibold leading-5">{data.name}</h4>
            <p className="truncate font-mono text-[10px] text-slate-500">{data.stageKey}</p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
            data.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
          )}
        >
          {data.enabled ? "已启用" : "已停用"}
        </span>
      </div>

      <div className="mt-3 flex flex-1 flex-col justify-between rounded-2xl border border-dashed border-slate-300/80 bg-slate-50/80 p-3 text-xs text-slate-600">
        <p className="font-medium text-slate-700">在这里放置动作节点并组织依赖关系。</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              data.enabled ? "bg-emerald-500" : "bg-slate-400"
            )}
          />
          <span>{data.enabled ? "当前阶段会参与执行" : "当前阶段已停用"}</span>
        </div>
      </div>
    </div>
  );
}
