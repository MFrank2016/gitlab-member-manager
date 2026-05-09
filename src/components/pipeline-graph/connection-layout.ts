export const CONNECTION_LAYOUT_NODE_WIDTH = 188;
export const CONNECTION_LAYOUT_NODE_HEIGHT = 116;
export const CONNECTION_LAYOUT_COLUMN_GAP = 212;
export const CONNECTION_LAYOUT_ROW_GAP = 32;

export type ConnectionLayoutNodeInput = {
  nodeKey: string;
};

export type ConnectionLayoutEdgeInput = {
  sourceNodeKey: string;
  targetNodeKey: string;
};

export type ConnectionLayoutNodeBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerY: number;
};

export type ConnectionLayoutBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type ConnectionDrivenStageLayout = {
  nodeBoxes: Record<string, ConnectionLayoutNodeBox>;
  contentBounds: ConnectionLayoutBounds;
};

export type StageDependency = {
  sourceStageKey: string;
  targetStageKey: string;
};

export type StageDropRegion = {
  stageKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function buildStableNodeOrder(nodes: ConnectionLayoutNodeInput[]) {
  return new Map(nodes.map((node, index) => [node.nodeKey, index]));
}

function createEmptyBounds(): ConnectionLayoutBounds {
  return {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    width: 0,
    height: 0,
  };
}

export function centerStageContent({
  stageWidth,
  stageHeight,
  contentBounds,
}: {
  stageWidth: number;
  stageHeight: number;
  contentBounds: Pick<ConnectionLayoutBounds, "minX" | "minY" | "width" | "height">;
}) {
  return {
    offsetX: Math.round((stageWidth - contentBounds.width) / 2 - contentBounds.minX),
    offsetY: Math.round((stageHeight - contentBounds.height) / 2 - contentBounds.minY),
  };
}

export function orderStagesByDependencies(
  stageKeys: string[],
  dependencies: StageDependency[]
) {
  const stageOrder = new Map(stageKeys.map((stageKey, index) => [stageKey, index]));
  const adjacency = new Map(stageKeys.map((stageKey) => [stageKey, new Set<string>()]));
  const indegree = new Map(stageKeys.map((stageKey) => [stageKey, 0]));

  for (const dependency of dependencies) {
    if (
      !adjacency.has(dependency.sourceStageKey) ||
      !adjacency.has(dependency.targetStageKey) ||
      dependency.sourceStageKey === dependency.targetStageKey
    ) {
      continue;
    }

    const targets = adjacency.get(dependency.sourceStageKey)!;
    if (targets.has(dependency.targetStageKey)) {
      continue;
    }

    targets.add(dependency.targetStageKey);
    indegree.set(
      dependency.targetStageKey,
      (indegree.get(dependency.targetStageKey) ?? 0) + 1
    );
  }

  const queue = stageKeys
    .filter((stageKey) => (indegree.get(stageKey) ?? 0) === 0)
    .sort((left, right) => (stageOrder.get(left) ?? 0) - (stageOrder.get(right) ?? 0));
  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    ordered.push(current);

    const nextKeys = Array.from(adjacency.get(current) ?? []).sort(
      (left, right) => (stageOrder.get(left) ?? 0) - (stageOrder.get(right) ?? 0)
    );
    for (const next of nextKeys) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
        queue.sort((left, right) => (stageOrder.get(left) ?? 0) - (stageOrder.get(right) ?? 0));
      }
    }
  }

  if (ordered.length === stageKeys.length) {
    return ordered;
  }

  const seen = new Set(ordered);
  return [...ordered, ...stageKeys.filter((stageKey) => !seen.has(stageKey))];
}

export function buildConnectionDrivenStageLayout({
  nodes,
  edges,
}: {
  nodes: ConnectionLayoutNodeInput[];
  edges: ConnectionLayoutEdgeInput[];
}): ConnectionDrivenStageLayout {
  if (nodes.length === 0) {
    return {
      nodeBoxes: {},
      contentBounds: createEmptyBounds(),
    };
  }

  const nodeOrder = buildStableNodeOrder(nodes);
  const adjacency = new Map<string, string[]>(
    nodes.map((node) => [node.nodeKey, []])
  );
  const indegree = new Map<string, number>(nodes.map((node) => [node.nodeKey, 0]));

  for (const edge of edges) {
    if (!adjacency.has(edge.sourceNodeKey) || !adjacency.has(edge.targetNodeKey)) {
      continue;
    }
    adjacency.get(edge.sourceNodeKey)!.push(edge.targetNodeKey);
    indegree.set(edge.targetNodeKey, (indegree.get(edge.targetNodeKey) ?? 0) + 1);
  }

  for (const targets of adjacency.values()) {
    targets.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
  }

  const roots = nodes
    .map((node) => node.nodeKey)
    .filter((nodeKey) => (indegree.get(nodeKey) ?? 0) === 0)
    .sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));

  const subtreeHeightCache = new Map<string, number>();
  const subtreeBoundsCache = new Map<string, ConnectionLayoutNodeBox>();
  const visiting = new Set<string>();

  function getChildren(nodeKey: string) {
    return adjacency.get(nodeKey) ?? [];
  }

  function measureSubtreeHeight(nodeKey: string): number {
    const cached = subtreeHeightCache.get(nodeKey);
    if (cached !== undefined) {
      return cached;
    }

    if (visiting.has(nodeKey)) {
      return CONNECTION_LAYOUT_NODE_HEIGHT;
    }

    visiting.add(nodeKey);
    const children = getChildren(nodeKey);
    const height =
      children.length === 0
        ? CONNECTION_LAYOUT_NODE_HEIGHT
        : children.reduce((sum, childKey, index) => {
            const childHeight = measureSubtreeHeight(childKey);
            return sum + childHeight + (index > 0 ? CONNECTION_LAYOUT_ROW_GAP : 0);
          }, 0);
    visiting.delete(nodeKey);
    subtreeHeightCache.set(nodeKey, height);
    return height;
  }

  function placeNode(nodeKey: string, depth: number, topY: number): void {
    if (subtreeBoundsCache.has(nodeKey)) {
      return;
    }

    const children = getChildren(nodeKey);
    const subtreeHeight = measureSubtreeHeight(nodeKey);
    let currentChildTop = topY;

    for (const childKey of children) {
      placeNode(childKey, depth + 1, currentChildTop);
      currentChildTop += measureSubtreeHeight(childKey) + CONNECTION_LAYOUT_ROW_GAP;
    }

    const x = depth * CONNECTION_LAYOUT_COLUMN_GAP;
    const y =
      children.length === 0
        ? topY
        : topY + Math.round((subtreeHeight - CONNECTION_LAYOUT_NODE_HEIGHT) / 2);

    subtreeBoundsCache.set(nodeKey, {
      x,
      y,
      width: CONNECTION_LAYOUT_NODE_WIDTH,
      height: CONNECTION_LAYOUT_NODE_HEIGHT,
      centerY: y + CONNECTION_LAYOUT_NODE_HEIGHT / 2,
    });
  }

  let currentRootTop = 0;
  for (const rootKey of roots) {
    placeNode(rootKey, 0, currentRootTop);
    currentRootTop += measureSubtreeHeight(rootKey) + CONNECTION_LAYOUT_ROW_GAP;
  }

  const unplacedKeys = nodes
    .map((node) => node.nodeKey)
    .filter((nodeKey) => !subtreeBoundsCache.has(nodeKey));
  for (const nodeKey of unplacedKeys) {
    placeNode(nodeKey, 0, currentRootTop);
    currentRootTop += measureSubtreeHeight(nodeKey) + CONNECTION_LAYOUT_ROW_GAP;
  }

  const nodeBoxes = Object.fromEntries(subtreeBoundsCache.entries());
  const boxes = Object.values(nodeBoxes);
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    nodeBoxes,
    contentBounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

function distanceSquared(left: { x: number; y: number }, right: { x: number; y: number }) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

export function resolveDropIntent({
  point,
  stageRegions,
  contentStart,
  columnGap,
  rowGap,
}: {
  point: { x: number; y: number };
  stageRegions: StageDropRegion[];
  contentStart: { x: number; y: number };
  columnGap: number;
  rowGap: number;
}) {
  const containingStage =
    stageRegions.find(
      (region) =>
        point.x >= region.x &&
        point.x <= region.x + region.width &&
        point.y >= region.y &&
        point.y <= region.y + region.height
    ) ?? null;

  const targetStage =
    containingStage ??
    [...stageRegions].sort((left, right) => {
      const leftCenter = {
        x: left.x + left.width / 2,
        y: left.y + left.height / 2,
      };
      const rightCenter = {
        x: right.x + right.width / 2,
        y: right.y + right.height / 2,
      };
      return distanceSquared(point, leftCenter) - distanceSquared(point, rightCenter);
    })[0];

  if (!targetStage) {
    return {
      stageKey: "",
      column: 0,
      row: 0,
    };
  }

  const relativeX = point.x - (targetStage.x + contentStart.x);
  const relativeY = point.y - (targetStage.y + contentStart.y);

  return {
    stageKey: targetStage.stageKey,
    column: Math.max(0, Math.round(relativeX / columnGap)),
    row: Math.max(0, Math.round(relativeY / rowGap)),
  };
}
