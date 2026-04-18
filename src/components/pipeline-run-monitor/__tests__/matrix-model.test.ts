import { describe, expect, it } from "vitest";

import type { PipelineRunProject } from "@/lib/types";

import { buildPipelineRunProjectMatrix } from "../matrix-model";

function createProject(partial: Partial<PipelineRunProject> & Pick<PipelineRunProject, "id" | "projectName" | "projectPathWithNamespace" | "status" | "summaryMessage" | "nodes">): PipelineRunProject {
  return {
    managedProjectId: null,
    gitlabProjectId: 0,
    repoPath: "D:/repos/example",
    startedAt: null,
    finishedAt: null,
    ...partial,
  };
}

describe("buildPipelineRunProjectMatrix", () => {
  it("builds stable columns from the union of project nodes", () => {
    const matrix = buildPipelineRunProjectMatrix([
      createProject({
        id: 11,
        projectName: "service-a",
        projectPathWithNamespace: "team/service-a",
        status: "running",
        summaryMessage: "waiting",
        nodes: [
          {
            id: 100,
            pipelineNodeId: 10,
            nodeOrder: 0,
            nodeType: "wait_pipeline",
            renderedParameters: {},
            status: "waiting",
            startedAt: null,
            finishedAt: null,
            exitCode: null,
            summaryMessage: "waiting",
            errorCode: null,
            titleZh: null,
            detailZh: null,
            suggestionZh: null,
            waitTarget: "team/service-a@main",
            lastRemoteStatus: "running",
            remotePipelineId: 777,
          },
        ],
      }),
      createProject({
        id: 12,
        projectName: "service-b",
        projectPathWithNamespace: "team/service-b",
        status: "failed",
        summaryMessage: "failed",
        nodes: [
          {
            id: 200,
            pipelineNodeId: 10,
            nodeOrder: 0,
            nodeType: "wait_pipeline",
            renderedParameters: {},
            status: "success",
            startedAt: null,
            finishedAt: null,
            exitCode: null,
            summaryMessage: "success",
            errorCode: null,
            titleZh: null,
            detailZh: null,
            suggestionZh: null,
            waitTarget: null,
            lastRemoteStatus: "success",
            remotePipelineId: 778,
          },
          {
            id: 201,
            pipelineNodeId: 11,
            nodeOrder: 1,
            nodeType: "trigger_pipeline",
            renderedParameters: {},
            status: "failed",
            startedAt: null,
            finishedAt: null,
            exitCode: null,
            summaryMessage: "failed",
            errorCode: "pipeline_failed",
            titleZh: "远端流水线失败",
            detailZh: "failed",
            suggestionZh: "retry",
            waitTarget: null,
            lastRemoteStatus: "failed",
            remotePipelineId: 778,
          },
        ],
      }),
    ]);

    expect(matrix.columns).toHaveLength(2);
    expect(matrix.columns.map((column) => [column.nodeOrder, column.nodeType])).toEqual([
      [0, "wait_pipeline"],
      [1, "trigger_pipeline"],
    ]);
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[0].cells.map((cell) => cell.node?.status ?? null)).toEqual(["waiting", null]);
    expect(matrix.rows[1].cells.map((cell) => cell.node?.status ?? null)).toEqual(["success", "failed"]);
  });
});
