import * as React from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type NodeChange,
} from "@xyflow/react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ManagedProject } from "@/lib/types";

import {
  BUILTIN_NODE_MAP,
  createEdgeDraft,
  createNodeDraft,
  createStageDraft,
  ensureVariableRows,
  type NodeDraft,
  type PipelineDraft,
  type StageDraft,
} from "../pipeline-editor/draft-model";
import {
  PIPELINE_ACTION_NODE_TYPE,
  STAGE_GROUP_NODE_TYPE,
  buildGraphEditorState,
  getNextNodePositionInStage,
  isActionGraphNode,
  isStageGraphNode,
  removeSelectedGraphObject,
  syncDraftFromGraphState,
  validateGraphConnection,
  type PipelineGraphNode,
} from "./graph-model";
import { PipelineActionNode } from "./PipelineActionNode";
import { PipelineGraphSelectionPanel } from "./PipelineGraphSelectionPanel";
import { StageGroupNode } from "./StageGroupNode";

type PipelineGraphEditorProps = {
  draft: PipelineDraft;
  managedProjects?: ManagedProject[];
  onChange: (next: PipelineDraft) => void;
};

const nodeTypes = {
  [STAGE_GROUP_NODE_TYPE]: StageGroupNode,
  [PIPELINE_ACTION_NODE_TYPE]: PipelineActionNode,
};

const actionButtonClassName =
  "h-auto w-full justify-start whitespace-normal px-4 py-2.5 text-left leading-5";

function getDefaultSelectedId(draft: PipelineDraft) {
  return draft.nodes[0]?.nodeKey ?? draft.stages[0]?.stageKey ?? null;
}

function getDefaultActiveStageKey(draft: PipelineDraft) {
  return draft.nodes[0]?.stageKey ?? draft.stages[0]?.stageKey ?? null;
}

function getGraphNodeStageKey(node: PipelineGraphNode) {
  return isActionGraphNode(node) ? node.data.stageKey : node.data.stageKey;
}

export function PipelineGraphEditor({
  draft,
  managedProjects = [],
  onChange,
}: PipelineGraphEditorProps) {
  const reactFlowRef = React.useRef<{ fitView: () => void } | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => getDefaultSelectedId(draft)
  );
  const [activeStageKey, setActiveStageKey] = React.useState<string | null>(
    () => getDefaultActiveStageKey(draft)
  );
  const [connectionTarget, setConnectionTarget] = React.useState("");
  const [graphMessage, setGraphMessage] = React.useState<string | null>(null);

  const graphState = React.useMemo(() => buildGraphEditorState(draft), [draft]);
  const graphNodeMap = React.useMemo(
    () => new Map(graphState.nodes.map((node) => [node.id, node])),
    [graphState.nodes]
  );

  React.useEffect(() => {
    if (selectedId && !graphNodeMap.has(selectedId)) {
      setSelectedId(null);
    }
  }, [graphNodeMap, selectedId]);

  React.useEffect(() => {
    if (activeStageKey && draft.stages.some((stage) => stage.stageKey === activeStageKey)) {
      return;
    }

    const fallbackStageKey = getDefaultActiveStageKey(draft);
    if (activeStageKey !== fallbackStageKey) {
      setActiveStageKey(fallbackStageKey);
    }
  }, [activeStageKey, draft]);

  const selectedGraphNode = selectedId ? graphNodeMap.get(selectedId) ?? null : null;
  const selectedActionNode =
    selectedGraphNode && isActionGraphNode(selectedGraphNode)
      ? draft.nodes.find((node) => node.nodeKey === selectedGraphNode.data.nodeKey) ?? null
      : null;
  const selectedStage =
    selectedGraphNode && isStageGraphNode(selectedGraphNode)
      ? draft.stages.find((stage) => stage.stageKey === selectedGraphNode.data.stageKey) ?? null
      : selectedActionNode
        ? draft.stages.find((stage) => stage.stageKey === selectedActionNode.stageKey) ?? null
        : null;
  const activeStage =
    draft.stages.find((stage) => stage.stageKey === activeStageKey) ?? null;

  const selection = selectedActionNode
    ? { kind: "node" as const, node: selectedActionNode }
    : selectedStage && selectedGraphNode && isStageGraphNode(selectedGraphNode)
      ? { kind: "stage" as const, stage: selectedStage }
      : null;

  const connectionCandidates = draft.nodes.filter(
    (node) => node.nodeKey !== selectedActionNode?.nodeKey
  );
  const selectedSummary = selectedActionNode
    ? `已选中节点：${BUILTIN_NODE_MAP.get(selectedActionNode.nodeType)?.label ?? selectedActionNode.nodeType}`
    : selectedStage
      ? `已选中阶段：${selectedStage.name}`
      : "未选中对象";
  const selectedSummaryHint = selectedActionNode
    ? selectedActionNode.nodeKey
    : selectedStage
      ? selectedStage.stageKey
      : activeStage
        ? `当前活动阶段：${activeStage.name}`
        : "先在画布中选择一个阶段或节点";

  function applyDraft(nextDraft: PipelineDraft) {
    setGraphMessage(null);
    onChange(nextDraft);
  }

  function updateNodes(nextNodes: NodeDraft[]) {
    applyDraft({
      ...draft,
      nodes: nextNodes,
      variableRows: ensureVariableRows(nextNodes, draft.variableRows),
    });
  }

  function updateStages(nextStages: StageDraft[]) {
    applyDraft({
      ...draft,
      stages: nextStages,
    });
  }

  function addStage() {
    const nextIndex = draft.stages.length + 1;
    const stage = createStageDraft({
      id: `stage-${nextIndex}`,
      stageKey: `stage-${nextIndex}`,
      name: `阶段 ${nextIndex}`,
      enabled: true,
    });
    updateStages([...draft.stages, stage]);
    setSelectedId(stage.stageKey);
    setActiveStageKey(stage.stageKey);
  }

  function resolveActiveStageKey() {
    return activeStageKey ?? "";
  }

  function addNode() {
    const stageKey = resolveActiveStageKey();
    if (!stageKey) {
      setGraphMessage("请先创建一个阶段");
      return;
    }

    const nextNode = createNodeDraft({
      stageKey,
      nodeType: "checkout_branch",
      position: getNextNodePositionInStage(draft.nodes, stageKey),
    });

    updateNodes([...draft.nodes, nextNode]);
    setSelectedId(nextNode.nodeKey);
    setActiveStageKey(stageKey);
  }

  function updateStage(stageKey: string, updater: (stage: StageDraft) => StageDraft) {
    updateStages(
      draft.stages.map((stage) => (stage.stageKey === stageKey ? updater(stage) : stage))
    );
  }

  function updateNode(nodeKey: string, updater: (node: NodeDraft) => NodeDraft) {
    updateNodes(
      draft.nodes.map((node) => (node.nodeKey === nodeKey ? updater(node) : node))
    );
  }

  function handleNodesChange(changes: NodeChange<PipelineGraphNode["data"]>[]) {
    const nextGraphNodes = applyNodeChanges(changes, graphState.nodes);
    const nextDraft = syncDraftFromGraphState(draft, {
      nodes: nextGraphNodes,
      edges: graphState.edges,
    });

    const nextSelected = [...changes]
      .reverse()
      .find(
        (change): change is NodeChange & { id: string; selected: boolean } =>
          change.type === "select" && "selected" in change
      );
    if (nextSelected) {
      setSelectedId(nextSelected.selected ? nextSelected.id : null);
      if (nextSelected.selected) {
        const nextGraphNode = nextGraphNodes.find((node) => node.id === nextSelected.id);
        if (nextGraphNode) {
          setActiveStageKey(getGraphNodeStageKey(nextGraphNode));
        }
      }
    }

    applyDraft(nextDraft);
  }

  function handleSelectionChange(params: { nodes: PipelineGraphNode[] }) {
    if (params.nodes.length !== 1) {
      setSelectedId(null);
      return;
    }

    const node = params.nodes[0] ?? null;
    setSelectedId(node?.id ?? null);
    if (node) {
      setActiveStageKey(getGraphNodeStageKey(node));
    }
  }

  function commitConnection(connection: Connection) {
    const result = validateGraphConnection(graphState, connection);
    if (!result.valid) {
      setGraphMessage(result.message ?? "连线无效");
      return;
    }
    if (!connection.source || !connection.target) {
      return;
    }

    applyDraft({
      ...draft,
      edges: [...draft.edges, createEdgeDraft(connection.source, connection.target)],
    });
    setConnectionTarget("");
  }

  function createConnectionFromPanel() {
    if (!selectedActionNode) {
      setGraphMessage("请先选择一个源节点");
      return;
    }

    commitConnection({
      source: selectedActionNode.nodeKey,
      target: connectionTarget,
    });
  }

  function fitCanvasToViewport() {
    reactFlowRef.current?.fitView();
  }

  function deleteSelectedObject() {
    if (!selectedGraphNode) {
      setGraphMessage("请先选择一个阶段或节点");
      return;
    }

    const nextDraft = removeSelectedGraphObject(draft, selectedGraphNode);
    const fallbackStageKey = isActionGraphNode(selectedGraphNode)
      ? selectedGraphNode.data.stageKey
      : getDefaultActiveStageKey(nextDraft);

    setSelectedId(null);
    setActiveStageKey(
      nextDraft.stages.some((stage) => stage.stageKey === fallbackStageKey)
        ? fallbackStageKey
        : getDefaultActiveStageKey(nextDraft)
    );
    setConnectionTarget("");
    applyDraft(nextDraft);
  }

  return (
    <section className="grid gap-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">流程图</h3>
        <p className="text-sm text-muted-foreground">
          用阶段容器组织节点，并通过连线表达执行依赖。
        </p>
      </div>

      <div
        data-testid="pipeline-graph-layout"
        className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_300px]"
      >
        <aside
          data-testid="pipeline-graph-actions-panel"
          className="grid content-start gap-3 rounded-xl border border-border bg-muted/20 p-3"
        >
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">编辑操作</h4>
            <p className="text-xs text-muted-foreground">
              先选中阶段或节点，再执行对应操作。
            </p>
          </div>
          <Button
            type="button"
            data-testid="pipeline-graph-add-stage-button"
            className={actionButtonClassName}
            onClick={addStage}
          >
            添加阶段
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-testid="pipeline-graph-add-node-button"
            className={actionButtonClassName}
            onClick={addNode}
            disabled={!resolveActiveStageKey()}
          >
            在所选阶段添加节点
          </Button>
          <div className="grid gap-1">
            <Label htmlFor="pipeline-graph-connect-target">连接到节点</Label>
            <select
              id="pipeline-graph-connect-target"
              className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-5"
              value={connectionTarget}
              onChange={(event) => setConnectionTarget(event.target.value)}
              disabled={!selectedActionNode}
              aria-label="连接到节点"
            >
              <option value="">请选择目标节点</option>
              {connectionCandidates.map((node) => (
                <option key={node.nodeKey} value={node.nodeKey}>
                  {BUILTIN_NODE_MAP.get(node.nodeType)?.label ?? node.nodeType}（{node.nodeKey}）
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="outline"
            data-testid="pipeline-graph-create-connection-button"
            className={actionButtonClassName}
            onClick={createConnectionFromPanel}
            disabled={!selectedActionNode || !connectionTarget}
          >
            创建连线
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="pipeline-graph-fit-view-button"
            className={actionButtonClassName}
            onClick={fitCanvasToViewport}
          >
            适配全貌
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="pipeline-graph-delete-button"
            className={actionButtonClassName}
            onClick={deleteSelectedObject}
            disabled={!selectedGraphNode}
          >
            删除选中对象
          </Button>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <p
              className="text-sm font-medium text-foreground"
              data-testid="pipeline-graph-selection-summary"
            >
              {selectedSummary}
            </p>
            <p className="text-xs text-muted-foreground">{selectedSummaryHint}</p>
          </div>
          {graphMessage ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {graphMessage}
            </p>
          ) : null}
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            当前共有 {draft.stages.length} 个阶段，{draft.nodes.length} 个节点，{draft.edges.length} 条连线。
          </div>
        </aside>

        <div
          className="min-w-0 h-[560px] rounded-2xl border border-border bg-slate-100/70"
          data-testid="pipeline-graph-editor"
        >
          <ReactFlow
            nodes={graphState.nodes}
            edges={graphState.edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              reactFlowRef.current = instance;
            }}
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
              setActiveStageKey(getGraphNodeStageKey(node));
            }}
            onNodesChange={handleNodesChange}
            onSelectionChange={handleSelectionChange}
            onConnect={commitConnection}
            panOnDrag
            zoomOnScroll
            selectionOnDrag={false}
            fitView
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>

        <PipelineGraphSelectionPanel
          selection={selection}
          stages={draft.stages}
          managedProjects={managedProjects}
          onStageChange={updateStage}
          onNodeChange={updateNode}
        />
      </div>
    </section>
  );
}
