import { Button } from "@/components/ui/button";
import type { PipelineRunStage, PipelineRunStatus } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

const STAGE_STATUS_CLASS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-700",
  waiting: "bg-violet-100 text-violet-700",
  success: "bg-emerald-100 text-emerald-700",
  partial_failed: "bg-orange-100 text-orange-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-zinc-200 text-zinc-700",
  reused: "bg-cyan-100 text-cyan-700",
};

const STAGE_STATUS_TEXT: Record<string, string> = {
  pending: "待处理",
  running: "运行中",
  waiting: "等待中",
  success: "成功",
  partial_failed: "部分失败",
  failed: "失败",
  cancelled: "已取消",
  reused: "已复用",
};

const ACTIVE_RUN_STATUSES = new Set<PipelineRunStatus>([
  "pending",
  "running",
  "waiting",
  "cancelling",
]);

const BLOCKING_STAGE_STATUSES = new Set(["failed", "partial_failed", "cancelled"]);

type PipelineRunStageSummaryProps = {
  runStatus: PipelineRunStatus;
  stages: PipelineRunStage[];
  retrying?: boolean;
  onRetryFullRun?: (() => void) | undefined;
  onRetryStage?: ((stageId: number) => void) | undefined;
};

function stageStatusLabel(status: string) {
  return STAGE_STATUS_TEXT[status] ?? status.replaceAll("_", " ");
}

function stageName(stage: PipelineRunStage) {
  const name = stage.stageNameSnapshot.trim();
  return name || stage.stageKey;
}

function isRetryableStage(stage: PipelineRunStage) {
  return stage.status !== "pending" && stage.status !== "running" && stage.status !== "waiting";
}

function getBlockingReason(stage: PipelineRunStage, stages: PipelineRunStage[]) {
  if (stage.status !== "pending") {
    return null;
  }

  const blockingStage = [...stages]
    .filter((candidate) => candidate.stageOrder < stage.stageOrder)
    .sort((left, right) => right.stageOrder - left.stageOrder)
    .find((candidate) => BLOCKING_STAGE_STATUSES.has(candidate.status));

  if (!blockingStage) {
    return null;
  }

  return `阻断原因：前序阶段「${stageName(blockingStage)}」${stageStatusLabel(
    blockingStage.status
  )}，当前阶段未进入调度。`;
}

export function PipelineRunStageSummary({
  runStatus,
  stages,
  retrying = false,
  onRetryFullRun,
  onRetryStage,
}: PipelineRunStageSummaryProps) {
  if (stages.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无阶段摘要。</p>;
  }

  const sortedStages = [...stages].sort((left, right) => left.stageOrder - right.stageOrder);
  const canRetry = !ACTIVE_RUN_STATUSES.has(runStatus);

  return (
    <div className="space-y-4">
      {canRetry && (onRetryFullRun || onRetryStage) ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">重试入口</p>
            <p className="text-xs text-muted-foreground">
              全量重试会新建一条运行记录；阶段重试会复用前序成功阶段，仅重跑当前阶段及其下游。
            </p>
          </div>
          {onRetryFullRun ? (
            <Button
              variant="secondary"
              size="sm"
              className="w-fit"
              disabled={retrying}
              onClick={onRetryFullRun}
            >
              重试全量运行
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        {sortedStages.map((stage) => {
          const blockingReason = getBlockingReason(stage, sortedStages);
          const showStageRetry = canRetry && !!onRetryStage && isRetryableStage(stage);

          return (
            <section
              key={stage.id}
              className="space-y-3 rounded-lg border border-border bg-card p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold">
                      阶段 {stage.stageOrder + 1} · {stageName(stage)}
                    </h4>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                        STAGE_STATUS_CLASS[stage.status] ?? "bg-muted text-foreground"
                      )}
                    >
                      {stageStatusLabel(stage.status)}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{stage.stageKey}</p>
                </div>
                {showStageRetry ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={retrying}
                    onClick={() => onRetryStage?.(stage.id)}
                  >
                    {`从阶段「${stageName(stage)}」重试`}
                  </Button>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-muted-foreground">开始时间</span>
                <span className="font-mono">{formatDateTime(stage.startedAt)}</span>
                <span className="text-muted-foreground">结束时间</span>
                <span className="font-mono">{formatDateTime(stage.finishedAt)}</span>
              </div>

              {stage.summaryMessage ? (
                <p className="text-sm text-foreground">{stage.summaryMessage}</p>
              ) : null}
              {blockingReason ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {blockingReason}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
