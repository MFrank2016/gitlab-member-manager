import type { NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import type { StageGraphNodeData } from "./graph-model";

export function StageGroupNode({
  data,
  selected,
}: NodeProps<StageGraphNodeData>) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-3xl border bg-white/95 p-4 text-slate-900 shadow-sm transition-colors",
        selected
          ? "border-sky-500 ring-4 ring-sky-100 shadow-sky-100/70"
          : "border-slate-300/90",
        !data.enabled && "bg-slate-100/90 text-slate-600"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white">
              阶段容器
            </span>
            {selected ? (
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-semibold text-sky-700">
                当前选中
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{data.name}</h4>
            <p className="font-mono text-[11px] text-slate-500">{data.stageKey}</p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium",
            data.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
          )}
        >
          {data.enabled ? "已启用" : "已禁用"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 rounded-2xl border border-dashed border-slate-300/80 bg-slate-50/80 p-3 text-xs text-slate-600">
        <p>在这个阶段中放置动作节点，并按需要组织依赖关系。</p>
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              data.enabled ? "bg-emerald-500" : "bg-slate-400"
            )}
          />
          <span>{data.enabled ? "此阶段会参与执行" : "此阶段已停用"}</span>
        </div>
      </div>
    </div>
  );
}
