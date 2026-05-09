// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildConnectionDrivenStageLayout,
  centerStageContent,
  orderStagesByDependencies,
  resolveDropIntent,
  type StageDropRegion,
} from "@/components/pipeline-graph/connection-layout";

describe("connection-driven layout", () => {
  it("places the first direct successor to the right of its parent", () => {
    const layout = buildConnectionDrivenStageLayout({
      nodes: [{ nodeKey: "node-a" }, { nodeKey: "node-b" }],
      edges: [{ sourceNodeKey: "node-a", targetNodeKey: "node-b" }],
    });

    expect(layout.nodeBoxes["node-a"]).toMatchObject({
      x: 0,
      y: 0,
      width: 188,
      height: 116,
    });
    expect(layout.nodeBoxes["node-b"]).toMatchObject({
      x: 212,
      y: 0,
      width: 188,
      height: 116,
    });
  });

  it("stacks multiple direct successors vertically and centers the parent", () => {
    const layout = buildConnectionDrivenStageLayout({
      nodes: [{ nodeKey: "node-a" }, { nodeKey: "node-b" }, { nodeKey: "node-c" }],
      edges: [
        { sourceNodeKey: "node-a", targetNodeKey: "node-b" },
        { sourceNodeKey: "node-a", targetNodeKey: "node-c" },
      ],
    });

    expect(layout.nodeBoxes["node-b"]?.x).toBe(layout.nodeBoxes["node-c"]?.x);
    expect(layout.nodeBoxes["node-b"]?.y).toBeLessThan(layout.nodeBoxes["node-c"]?.y ?? 0);
    expect(layout.nodeBoxes["node-a"]?.centerY).toBe(
      (layout.nodeBoxes["node-b"]!.centerY + layout.nodeBoxes["node-c"]!.centerY) / 2
    );
  });

  it("centers the content box inside the stage frame", () => {
    expect(
      centerStageContent({
        stageWidth: 640,
        stageHeight: 480,
        contentBounds: { minX: 0, minY: 0, width: 400, height: 264 },
      })
    ).toEqual({ offsetX: 120, offsetY: 108 });
  });

  it("keeps a stable topological order for stages", () => {
    expect(
      orderStagesByDependencies(
        ["stage-a", "stage-b", "stage-c"],
        [
          { sourceStageKey: "stage-a", targetStageKey: "stage-c" },
          { sourceStageKey: "stage-c", targetStageKey: "stage-b" },
        ]
      )
    ).toEqual(["stage-a", "stage-c", "stage-b"]);
  });

  it("maps raw drop coordinates to the nearest stage and slot intent", () => {
    const regions: StageDropRegion[] = [
      {
        stageKey: "stage-a",
        x: 24,
        y: 32,
        width: 320,
        height: 360,
      },
      {
        stageKey: "stage-b",
        x: 384,
        y: 32,
        width: 532,
        height: 476,
      },
    ];

    expect(
      resolveDropIntent({
        point: { x: 640, y: 240 },
        stageRegions: regions,
        contentStart: { x: 96, y: 72 },
        columnGap: 212,
        rowGap: 148,
      })
    ).toEqual({
      stageKey: "stage-b",
      column: 1,
      row: 1,
    });
  });
});
