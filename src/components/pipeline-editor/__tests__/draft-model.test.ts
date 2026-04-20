import { describe, expect, it } from "vitest";

import {
  BUILTIN_NODE_MAP,
  buildPipelineCreatePayload,
  normalizeBuiltinParameters,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";

describe("pipeline draft model working path node", () => {
  it("registers set_working_path as a builtin node with a variable-friendly path field", () => {
    const builtin = BUILTIN_NODE_MAP.get("set_working_path");

    expect(builtin).toBeDefined();
    expect(builtin?.label).toBe("设置执行路径");
    expect(builtin?.fields).toEqual([
      expect.objectContaining({
        key: "path",
        label: "目标路径",
      }),
    ]);
    expect(builtin?.fields[0]?.placeholder).toContain("${repo_root}");
    expect(builtin?.fields[0]?.placeholder).toContain("../another-repo");
  });

  it("serializes relative and absolute working path nodes through the create payload builder", () => {
    const draft: PipelineDraft = {
      name: "release-pipeline",
      description: "",
      enabled: true,
      maxConcurrencyDefault: "1",
      variableRows: [],
      nodes: [
        {
          id: "node-1",
          nodeType: "set_working_path",
          parameters: normalizeBuiltinParameters("set_working_path", {
            path: "../another-repo",
          }),
        },
        {
          id: "node-2",
          nodeType: "set_working_path",
          parameters: normalizeBuiltinParameters("set_working_path", {
            path: "D:/repos/project-a",
          }),
        },
      ],
      schedules: [],
    };

    expect(buildPipelineCreatePayload(draft).nodes).toEqual([
      {
        nodeType: "set_working_path",
        parameters: { path: "../another-repo" },
      },
      {
        nodeType: "set_working_path",
        parameters: { path: "D:/repos/project-a" },
      },
    ]);
  });
});
