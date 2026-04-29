import { Handle, Position, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import type { PipelineActionNodeData } from "./graph-model";

export function PipelineActionNode({
  data,
  selected,
}: NodeProps<PipelineActionNodeData>) {
  return (
    <div
      className={cn(
        "min-w-[220px] rounded-2xl border bg-white/95 p-4 shadow-sm transition-colors",
        selected
          ? "border-sky-500 ring-4 ring-sky-100 shadow-sky-100/70"
          : "border-slate-300/90",
        !data.enabled && "bg-slate-100/90 text-slate-600"
      )}
    >
      <Handle type="target" position={Position.Left} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white">
            动作节点
          </span>
          {selected ? (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-semibold text-sky-700">
              当前选中
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-medium",
              data.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
            )}
          >
            {data.enabled ? "已启用" : "已禁用"}
          </span>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-900">{data.label}</div>
          <div className="font-mono text-[11px] text-slate-500">{data.nodeKey}</div>
        </div>

        <div className="grid gap-1 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
          <div>
            <span className="text-slate-500">节点类型：</span>
            <span className="font-medium text-slate-900">{data.nodeType}</span>
          </div>
          <div>
            <span className="text-slate-500">所属阶段：</span>
            <span className="font-medium text-slate-900">{data.stageKey}</span>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
