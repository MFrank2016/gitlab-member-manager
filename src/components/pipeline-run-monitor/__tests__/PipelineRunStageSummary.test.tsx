import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PipelineRunStage } from "@/lib/types";

import { PipelineRunStageSummary } from "../PipelineRunStageSummary";

function createStage(
  partial: Partial<PipelineRunStage> &
    Pick<
      PipelineRunStage,
      "id" | "stageOrder" | "stageKey" | "stageNameSnapshot" | "status" | "summaryMessage"
    >
): PipelineRunStage {
  return {
    startedAt: "2026-04-28T10:00:00Z",
    finishedAt: "2026-04-28T10:05:00Z",
    pipelineStageId: partial.id,
    ...partial,
  };
}

describe("PipelineRunStageSummary", () => {
  it("renders stage status, block reasons, and retry controls for terminal runs", () => {
    const onRetryFullRun = vi.fn();
    const onRetryStage = vi.fn();

    render(
      <PipelineRunStageSummary
        runStatus="partial_failed"
        stages={[
          createStage({
            id: 11,
            stageOrder: 0,
            stageKey: "merge_gate",
            stageNameSnapshot: "合并门禁",
            status: "failed",
            summaryMessage: "2 个项目成功，1 个项目失败",
          }),
          createStage({
            id: 12,
            stageOrder: 1,
            stageKey: "release_verify",
            stageNameSnapshot: "发版验证",
            status: "pending",
            summaryMessage: "",
            startedAt: null,
            finishedAt: null,
          }),
        ]}
        onRetryFullRun={onRetryFullRun}
        onRetryStage={onRetryStage}
      />
    );

    expect(
      screen.getByRole("button", { name: "从阶段「合并门禁」重试" })
    ).toBeInTheDocument();
    expect(screen.getByText("2 个项目成功，1 个项目失败")).toBeInTheDocument();
    expect(
      screen.getByText("阻断原因：前序阶段「合并门禁」失败，当前阶段未进入调度。")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试全量运行" }));
    fireEvent.click(screen.getByRole("button", { name: "从阶段「合并门禁」重试" }));

    expect(onRetryFullRun).toHaveBeenCalledOnce();
    expect(onRetryStage).toHaveBeenCalledWith(11);
  });

  it("hides retry controls while the run is still active", () => {
    render(
      <PipelineRunStageSummary
        runStatus="running"
        stages={[
          createStage({
            id: 21,
            stageOrder: 0,
            stageKey: "merge_gate",
            stageNameSnapshot: "合并门禁",
            status: "running",
            summaryMessage: "正在等待远端流水线",
            finishedAt: null,
          }),
        ]}
      />
    );

    expect(screen.queryByRole("button", { name: "重试全量运行" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "从阶段「合并门禁」重试" })
    ).not.toBeInTheDocument();
  });
});
