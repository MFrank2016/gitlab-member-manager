import type { PipelineRunNode, PipelineRunProject } from "@/lib/types";

export type PipelineRunMatrixColumn = {
  key: string;
  nodeOrder: number;
  nodeType: string;
  pipelineNodeId?: number | null;
};

export type PipelineRunMatrixCell = {
  columnKey: string;
  nodeOrder: number;
  nodeType: string;
  node: PipelineRunNode | null;
};

export type PipelineRunMatrixRow = {
  project: PipelineRunProject;
  cells: PipelineRunMatrixCell[];
};

export type PipelineRunProjectMatrixModel = {
  columns: PipelineRunMatrixColumn[];
  rows: PipelineRunMatrixRow[];
};

function compareColumns(left: PipelineRunMatrixColumn, right: PipelineRunMatrixColumn) {
  if (left.nodeOrder !== right.nodeOrder) return left.nodeOrder - right.nodeOrder;

  const leftPipelineNodeId = left.pipelineNodeId ?? Number.MAX_SAFE_INTEGER;
  const rightPipelineNodeId = right.pipelineNodeId ?? Number.MAX_SAFE_INTEGER;
  if (leftPipelineNodeId !== rightPipelineNodeId) return leftPipelineNodeId - rightPipelineNodeId;

  return left.nodeType.localeCompare(right.nodeType);
}

export function getPipelineRunMatrixColumnKey(node: Pick<PipelineRunNode, "nodeOrder" | "pipelineNodeId" | "nodeType">) {
  return `${node.nodeOrder}:${node.pipelineNodeId ?? "legacy"}:${node.nodeType}`;
}

export function buildPipelineRunProjectMatrix(projects: PipelineRunProject[]): PipelineRunProjectMatrixModel {
  const columnsByKey = new Map<string, PipelineRunMatrixColumn>();

  for (const project of projects) {
    for (const node of project.nodes) {
      const key = getPipelineRunMatrixColumnKey(node);
      if (columnsByKey.has(key)) continue;
      columnsByKey.set(key, {
        key,
        nodeOrder: node.nodeOrder,
        nodeType: node.nodeType,
        pipelineNodeId: node.pipelineNodeId ?? null,
      });
    }
  }

  const columns = [...columnsByKey.values()].sort(compareColumns);
  const rows = projects.map((project) => {
    const nodeByColumnKey = new Map<string, PipelineRunNode>();
    for (const node of project.nodes) {
      nodeByColumnKey.set(getPipelineRunMatrixColumnKey(node), node);
    }

    return {
      project,
      cells: columns.map((column) => ({
        columnKey: column.key,
        nodeOrder: column.nodeOrder,
        nodeType: column.nodeType,
        node: nodeByColumnKey.get(column.key) ?? null,
      })),
    };
  });

  return { columns, rows };
}
