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
        "min-w-[180px] rounded-xl border bg-white p-3 shadow-sm",
        selected ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-300"
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
          动作节点
        </p>
        <div className="text-sm font-semibold text-slate-900">{data.label}</div>
        <div className="text-xs text-slate-500">{data.nodeType}</div>
      </div>
      <div className="mt-2 text-xs text-slate-500">
        {data.enabled ? "节点已启用" : "节点已禁用"}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
