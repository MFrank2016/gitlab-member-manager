import type { MouseEventHandler } from "react";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import { ACTION_DRAG_HANDLE_CLASSNAME, type PipelineActionNodeData } from "./graph-model";

type PipelineActionNodeViewData = PipelineActionNodeData & {
  onContextMenu?: (payload: { nodeKey: string; x: number; y: number }) => void;
  onCreateSuccessor?: (payload: { nodeKey: string; stageKey: string }) => void;
  isSuccessorPreviewSource?: boolean;
};

function formatNodeType(nodeType: string) {
  return nodeType.replaceAll("_", " ");
}

export function PipelineActionNode({
  data: rawData,
  selected,
}: NodeProps) {
  const data = rawData as PipelineActionNodeViewData;
  const targetHandleStyle = { width: 16, height: 16, left: -8 };
  const sourceHandleStyle = { width: 16, height: 16, right: -8 };
  const handleContextMenu: MouseEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    data.onContextMenu?.({
      nodeKey: data.nodeKey,
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <div
      data-testid={`pipeline-action-node-card-${data.nodeKey}`}
      onContextMenu={handleContextMenu}
      className={cn(
        "h-[116px] w-[188px] max-w-[188px] overflow-visible rounded-xl border bg-white/95 p-3 shadow-sm transition-colors",
        selected
          ? "border-sky-500 ring-4 ring-sky-100 shadow-sky-100/70"
          : "border-slate-300/90",
        !data.enabled && "bg-slate-100/90 text-slate-600"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-4 !w-4 !rounded-full !border-2 !border-white !bg-sky-500 shadow-sm"
        style={targetHandleStyle}
      />

      <div className="flex h-full flex-col space-y-2.5">
        <div
          data-testid={`pipeline-action-drag-handle-${data.nodeKey}`}
          className={cn(
            ACTION_DRAG_HANDLE_CLASSNAME,
            "-mx-3 -mt-3 mb-3 flex items-center justify-between border-b border-slate-200/80 bg-slate-100/90 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500 cursor-grab active:cursor-grabbing"
          )}
        >
          <span className="pointer-events-none">拖动</span>
          <span className="pointer-events-none font-mono tracking-[0.3em] text-slate-400">:::</span>
        </div>

        <div className="nodrag flex flex-1 flex-col justify-between">
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              {formatNodeType(data.nodeType)}
            </div>
            <div className="break-words text-sm font-semibold leading-5 text-slate-900">
              {data.label}
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            {data.enabled ? "连接后自动整理布局" : "该节点当前已停用"}
          </div>
        </div>
      </div>

      <div
        data-testid={`pipeline-node-output-anchor-${data.nodeKey}`}
        className="absolute right-0 top-1/2 flex h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-transparent"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          data.onCreateSuccessor?.({
            nodeKey: data.nodeKey,
            stageKey: data.stageKey,
          });
        }}
      >
        <Handle
          type="source"
          position={Position.Right}
          className={cn(
            "!h-4 !w-4 !rounded-full !border-2 !border-white shadow-sm",
            data.isSuccessorPreviewSource ? "!bg-sky-600 ring-4 ring-sky-100" : "!bg-sky-500"
          )}
          style={sourceHandleStyle}
        />
      </div>
    </div>
  );
}
