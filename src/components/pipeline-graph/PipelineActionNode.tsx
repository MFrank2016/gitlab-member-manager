import type { MouseEventHandler } from "react";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import {
  ACTION_DRAG_HANDLE_CLASSNAME,
  type PipelineActionNodeData,
} from "./graph-model";

type PipelineActionNodeViewData = PipelineActionNodeData & {
  onContextMenu?: (payload: { nodeKey: string; x: number; y: number }) => void;
  onSelect?: (payload: { nodeKey: string }) => void;
};

function getStringParameter(
  parameters: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getConfiguredParameterCount(parameters: Record<string, unknown>) {
  return Object.values(parameters).filter((value) => {
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (value && typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    return value !== null && value !== undefined;
  }).length;
}

function buildActionSummary(data: PipelineActionNodeData) {
  switch (data.nodeType) {
    case "checkout_branch": {
      const branch = getStringParameter(data.parameters, "branch", "ref", "targetBranch");
      return branch ? `检出分支：${branch}` : "检出仓库默认分支";
    }
    case "switch_project": {
      const managedProjectId = getStringParameter(data.parameters, "managedProjectId");
      return managedProjectId ? `切换到项目 #${managedProjectId}` : "待选择目标项目";
    }
    default: {
      const configuredCount = getConfiguredParameterCount(data.parameters);
      return configuredCount > 0 ? `已配置 ${configuredCount} 个参数` : "待补充参数";
    }
  }
}

function formatNodeType(nodeType: string) {
  return nodeType.replaceAll("_", " ");
}

export function PipelineActionNode({
  data: rawData,
  selected,
}: NodeProps) {
  const data = rawData as PipelineActionNodeViewData;
  const summary = buildActionSummary(data);
  const handleContextMenu: MouseEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    data.onContextMenu?.({
      nodeKey: data.nodeKey,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    event.stopPropagation();
    data.onSelect?.({ nodeKey: data.nodeKey });
  };

  return (
    <div
      data-testid={`pipeline-action-node-card-${data.nodeKey}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={cn(
        "w-[188px] max-w-[188px] overflow-hidden rounded-xl border bg-white/95 p-3 shadow-sm transition-colors",
        selected
          ? "border-sky-500 ring-4 ring-sky-100 shadow-sky-100/70"
          : "border-slate-300/90",
        !data.enabled && "bg-slate-100/90 text-slate-600"
      )}
    >
      <Handle type="target" position={Position.Left} />

      <div className="space-y-2.5">
        <div
          data-testid={`pipeline-action-drag-handle-${data.nodeKey}`}
          className={cn(
            ACTION_DRAG_HANDLE_CLASSNAME,
            "-mx-3 -mt-3 mb-3 flex items-center justify-between border-b border-slate-200/80 bg-slate-100/90 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500 cursor-grab active:cursor-grabbing"
          )}
        >
          <span>拖动</span>
          <span className="font-mono tracking-[0.3em] text-slate-400">:::</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white">
            动作
          </span>
          {selected ? (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
              当前选中
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              data.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
            )}
          >
            {data.enabled ? "已启用" : "已停用"}
          </span>
        </div>

        <div className="space-y-1">
          <div className="break-words text-sm font-semibold leading-5 text-slate-900">
            {data.label}
          </div>
          <p
            data-testid={`pipeline-action-node-summary-${data.nodeKey}`}
            className="break-words text-xs leading-5 text-slate-600"
          >
            {summary}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">
          <span className="truncate">{formatNodeType(data.nodeType)}</span>
          <span>{data.enabled ? "就绪" : "停用"}</span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
