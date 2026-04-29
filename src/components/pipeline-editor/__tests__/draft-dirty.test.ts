import { beforeEach, describe, expect, it } from "vitest";

import {
  createEmptyPipelineDraft,
  resetPipelineDraftCountersForTest,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";
import { arePipelineDraftsEquivalent } from "@/components/pipeline-editor/draft-dirty";

function cloneDraft<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("arePipelineDraftsEquivalent", () => {
  beforeEach(() => {
    resetPipelineDraftCountersForTest();
  });

  it("treats a reverted create draft as equivalent to its baseline", () => {
    const baseline = createEmptyPipelineDraft();
    const changed: PipelineDraft = {
      ...baseline,
      name: "temp-release-pipeline",
    };
    const reverted: PipelineDraft = {
      ...changed,
      name: baseline.name,
    };

    expect(arePipelineDraftsEquivalent(changed, baseline)).toBe(false);
    expect(arePipelineDraftsEquivalent(reverted, baseline)).toBe(true);
  });

  it("ignores transient row and node ids when semantics are unchanged", () => {
    const baseline = createEmptyPipelineDraft();
    const sameMeaning = cloneDraft(baseline);

    sameMeaning.variableRows = sameMeaning.variableRows.map((row, index) => ({
      ...row,
      id: `other-variable-${index + 1}`,
      source: "manual",
    }));
    sameMeaning.stages = sameMeaning.stages.map((stage, index) => ({
      ...stage,
      id: `other-stage-${index + 1}`,
    }));
    sameMeaning.nodes = sameMeaning.nodes.map((node, index) => ({
      ...node,
      id: `other-node-${index + 1}`,
    }));

    expect(arePipelineDraftsEquivalent(sameMeaning, baseline)).toBe(true);
  });
});
