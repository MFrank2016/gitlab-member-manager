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
        "flex h-full flex-col rounded-2xl border bg-slate-50/90 p-3 text-slate-900 shadow-sm",
        selected ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-300"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            阶段
          </p>
          <h4 className="text-sm font-semibold">{data.name}</h4>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            data.enabled
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-200 text-slate-600"
          )}
        >
          {data.enabled ? "启用" : "禁用"}
        </span>
      </div>
      <div className="mt-3 rounded-xl border border-dashed border-slate-300/80 bg-white/80 p-3 text-xs text-slate-500">
        在这个阶段中放置动作节点，并按需要连线。
      </div>
    </div>
  );
}
