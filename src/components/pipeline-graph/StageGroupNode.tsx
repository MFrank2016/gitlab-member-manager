import type { MouseEventHandler } from "react";

import type { NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import {
  STAGE_DRAG_HANDLE_CLASSNAME,
  type StageGraphNodeData,
} from "./graph-model";

type StageGroupNodeData = StageGraphNodeData & {
  onContextMenu?: (payload: { stageKey: string; x: number; y: number }) => void;
  onStartCreate?: (payload: { stageKey: string }) => void;
  previewHint?: string;
  previewTone?: "create" | "drag";
};

export function StageGroupNode({
  data: rawData,
  selected,
}: NodeProps) {
  const data = rawData as StageGroupNodeData;
  const showStartAnchor = data.nodeCount === 0;
  const isPreviewTarget = Boolean(data.previewHint);
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
        "flex h-full min-h-0 flex-col overflow-visible rounded-3xl border bg-white/95 p-3 text-slate-900 shadow-sm transition-colors",
        selected
          ? "border-sky-500 ring-4 ring-sky-100 shadow-sky-100/70"
          : "border-slate-300/90",
        isPreviewTarget &&
          (data.previewTone === "create"
            ? "border-sky-400 ring-4 ring-sky-100 shadow-sky-100/70"
            : "border-amber-400 ring-4 ring-amber-100 shadow-amber-100/70"),
        !data.enabled && "bg-slate-100/90 text-slate-600"
      )}
    >
      <div
        data-testid={`pipeline-stage-drag-handle-${data.stageKey}`}
        className={cn(
          STAGE_DRAG_HANDLE_CLASSNAME,
          "-mx-3 -mt-3 mb-3 flex items-center justify-between rounded-t-3xl border-b border-slate-200/80 bg-slate-100/90 px-3 py-2 text-[11px] font-medium text-slate-500 cursor-grab active:cursor-grabbing"
        )}
      >
        <span className="pointer-events-none">拖动阶段</span>
        <span className="pointer-events-none font-mono tracking-[0.3em] text-slate-400">:::</span>
      </div>

      <div className="nodrag flex items-start justify-between gap-2">
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
      {isPreviewTarget ? (
        <div
          data-testid={`pipeline-stage-drop-preview-${data.stageKey}`}
          className={cn(
            "nodrag mt-2 rounded-xl px-3 py-2 text-[11px]",
            data.previewTone === "create"
              ? "border border-sky-200 bg-sky-50 text-sky-700"
              : "border border-amber-200 bg-amber-50 text-amber-700"
          )}
        >
          {data.previewHint}
        </div>
      ) : null}

      <div className="nodrag mt-3 flex flex-1 flex-col justify-center rounded-2xl border border-dashed border-slate-300/80 bg-slate-50/80 p-3 text-xs text-slate-600">
        {showStartAnchor ? (
          <div
            data-testid={`pipeline-stage-start-anchor-${data.stageKey}`}
            className="mx-auto flex w-full max-w-[220px] items-center justify-between rounded-2xl border border-slate-300 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50/60"
          >
            <span className="space-y-1">
              <span className="block text-sm font-semibold text-slate-800">从这里开始</span>
              <span className="block text-[11px] text-slate-500">
                通过右侧连接点创建首个节点
              </span>
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-sky-200 bg-sky-100 text-sky-700">
              <div
                data-testid={`pipeline-stage-start-anchor-trigger-${data.stageKey}`}
                className="flex h-6 w-6 items-center justify-center rounded-full"
                onClick={(event) => {
                  event.stopPropagation();
                  data.onStartCreate?.({ stageKey: data.stageKey });
                }}
              >
                +
              </div>
            </span>
          </div>
        ) : (
          <p className="text-center font-medium text-slate-700">
            从已有节点继续扩展流程，并让画布自动整理结构。
          </p>
        )}
      </div>
    </div>
  );
}
