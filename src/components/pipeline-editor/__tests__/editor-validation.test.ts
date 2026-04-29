import { describe, expect, it } from "vitest";

import {
  createEdgeDraft,
  createEmptyPipelineDraft,
  createNodeDraft,
  createStageDraft,
} from "@/components/pipeline-editor/draft-model";
import { validatePipelineEditorDraft } from "@/components/pipeline-editor/editor-validation";

function createValidDraft() {
  const draft = createEmptyPipelineDraft();
  draft.name = "release-train";
  return draft;
}

describe("validatePipelineEditorDraft", () => {
  it("reports an empty pipeline name", () => {
    const draft = createValidDraft();
    draft.name = "   ";

    expect(validatePipelineEditorDraft(draft)).toEqual(
      expect.objectContaining({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "pipeline_name_required",
            path: "pipeline:name",
          }),
        ]),
      })
    );
  });

  it("reports when the pipeline has no stages", () => {
    const draft = createValidDraft();
    draft.stages = [];
    draft.nodes = [];

    expect(validatePipelineEditorDraft(draft)).toEqual(
      expect.objectContaining({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "pipeline_has_no_stages",
            path: "pipeline:stages",
          }),
        ]),
      })
    );
  });

  it("reports a stage without executable nodes", () => {
    const draft = createValidDraft();
    draft.stages = [createStageDraft({ stageKey: "stage-1", name: "准备" })];
    draft.nodes = [];

    expect(validatePipelineEditorDraft(draft)).toEqual(
      expect.objectContaining({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "stage_has_no_nodes",
            path: "stage:stage-1",
          }),
        ]),
      })
    );
  });

  it("reports a node with a missing type", () => {
    const draft = createValidDraft();
    const stage = createStageDraft({ stageKey: "stage-1", name: "准备" });
    const node = createNodeDraft({
      nodeKey: "node-a",
      stageKey: stage.stageKey,
      nodeType: "   ",
    });
    draft.stages = [stage];
    draft.nodes = [node];

    expect(validatePipelineEditorDraft(draft)).toEqual(
      expect.objectContaining({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "node_type_required",
            path: "node:node-a",
          }),
        ]),
      })
    );
  });

  it("reports duplicate edges", () => {
    const draft = createValidDraft();
    const stage = createStageDraft({ stageKey: "stage-1", name: "准备" });
    const nodeA = createNodeDraft({
      nodeKey: "node-a",
      stageKey: stage.stageKey,
      nodeType: "checkout_branch",
    });
    const nodeB = createNodeDraft({
      nodeKey: "node-b",
      stageKey: stage.stageKey,
      nodeType: "git_pull",
    });
    draft.stages = [stage];
    draft.nodes = [nodeA, nodeB];
    draft.edges = [
      createEdgeDraft(nodeA.nodeKey, nodeB.nodeKey, "edge-a"),
      createEdgeDraft(nodeA.nodeKey, nodeB.nodeKey, "edge-b"),
    ];

    expect(validatePipelineEditorDraft(draft)).toEqual(
      expect.objectContaining({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "edge_duplicate",
            path: `edge:${nodeA.nodeKey}->${nodeB.nodeKey}`,
          }),
        ]),
      })
    );
  });

  it("reports cyclic edges", () => {
    const draft = createValidDraft();
    const stage = createStageDraft({ stageKey: "stage-1", name: "准备" });
    const nodeA = createNodeDraft({
      nodeKey: "node-a",
      stageKey: stage.stageKey,
      nodeType: "checkout_branch",
    });
    const nodeB = createNodeDraft({
      nodeKey: "node-b",
      stageKey: stage.stageKey,
      nodeType: "git_pull",
    });
    draft.stages = [stage];
    draft.nodes = [nodeA, nodeB];
    draft.edges = [
      createEdgeDraft(nodeA.nodeKey, nodeB.nodeKey),
      createEdgeDraft(nodeB.nodeKey, nodeA.nodeKey),
    ];

    expect(validatePipelineEditorDraft(draft)).toEqual(
      expect.objectContaining({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "edge_cyclic",
            path: "pipeline:edges",
          }),
        ]),
      })
    );
  });

  it("reports backward edges across stages", () => {
    const draft = createValidDraft();
    const stageA = createStageDraft({ stageKey: "stage-a", name: "准备" });
    const stageB = createStageDraft({ stageKey: "stage-b", name: "发布" });
    const nodeA = createNodeDraft({
      nodeKey: "node-a",
      stageKey: stageA.stageKey,
      nodeType: "checkout_branch",
    });
    const nodeB = createNodeDraft({
      nodeKey: "node-b",
      stageKey: stageB.stageKey,
      nodeType: "git_push",
    });
    draft.stages = [stageA, stageB];
    draft.nodes = [nodeA, nodeB];
    draft.edges = [createEdgeDraft(nodeB.nodeKey, nodeA.nodeKey)];

    expect(validatePipelineEditorDraft(draft)).toEqual(
      expect.objectContaining({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "edge_backward",
            path: `edge:${nodeB.nodeKey}->${nodeA.nodeKey}`,
          }),
        ]),
      })
    );
  });
});
