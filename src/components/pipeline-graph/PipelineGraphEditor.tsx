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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedProject } from "@/lib/types";

import {
  BUILTIN_NODE_MAP,
  BUILTIN_NODE_TYPES,
  createEdgeDraft,
  createNodeDraft,
  createStageDraft,
  ensureVariableRows,
  getMissingBuiltinRequiredFields,
  normalizeBuiltinParameters,
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
  reorderStageNodesForDropPosition,
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

type ContextMenuState =
  | { kind: "stage"; stageKey: string; x: number; y: number }
  | { kind: "node"; nodeKey: string; x: number; y: number }
  | null;

type CreateNodeDialogState = {
  stageKey: string;
  nodeType: string;
  parameters: Record<string, unknown>;
  errors: string[];
} | null;

type SelectedGraphObject =
  | { kind: "stage"; id: string }
  | { kind: "node"; id: string }
  | null;

const nodeTypes = {
  [STAGE_GROUP_NODE_TYPE]: StageGroupNode,
  [PIPELINE_ACTION_NODE_TYPE]: PipelineActionNode,
};

const actionButtonClassName =
  "h-auto w-full justify-start whitespace-normal px-4 py-2.5 text-left leading-5";
const contextMenuItemClassName =
  "w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100";

function getDefaultSelectedObject(draft: PipelineDraft): SelectedGraphObject {
  if (draft.nodes[0]) {
    return { kind: "node", id: draft.nodes[0].nodeKey };
  }

  if (draft.stages[0]) {
    return { kind: "stage", id: draft.stages[0].stageKey };
  }

  return null;
}

function getDefaultActiveStageKey(draft: PipelineDraft) {
  return draft.nodes[0]?.stageKey ?? draft.stages[0]?.stageKey ?? null;
}

function getGraphNodeStageKey(node: PipelineGraphNode) {
  return isActionGraphNode(node) ? node.data.stageKey : node.data.stageKey;
}

function getSelectedGraphObject(node: PipelineGraphNode): Exclude<SelectedGraphObject, null> {
  return isActionGraphNode(node)
    ? { kind: "node", id: node.data.nodeKey }
    : { kind: "stage", id: node.data.stageKey };
}

function getBuiltinCreateParameters(
  nodeType: string,
  parameters: Record<string, unknown> = {}
) {
  const builtin = BUILTIN_NODE_MAP.get(nodeType);
  if (!builtin) {
    return {};
  }

  const normalized = normalizeBuiltinParameters(nodeType, parameters);
  return Object.fromEntries(
    builtin.fields.map((field) => [field.key, normalized[field.key] ?? ""])
  );
}

function validateCreateNodeDialogState(
  state: Exclude<CreateNodeDialogState, null>
) {
  const errors: string[] = [];
  const nodeType = state.nodeType.trim();

  if (!nodeType) {
    errors.push("节点类型为必填项。");
    return errors;
  }

  const builtin = BUILTIN_NODE_MAP.get(nodeType);
  if (!builtin) {
    errors.push("请选择有效的节点类型。");
    return errors;
  }

  const parameters = getBuiltinCreateParameters(nodeType, state.parameters);
  for (const field of getMissingBuiltinRequiredFields(nodeType, parameters)) {
    errors.push(`${field.label}为必填项。`);
  }

  return errors;
}

export function PipelineGraphEditor({
  draft,
  managedProjects = [],
  onChange,
}: PipelineGraphEditorProps) {
  const reactFlowRef = React.useRef<{ fitView: () => void } | null>(null);
  const [selectedObject, setSelectedObject] = React.useState<SelectedGraphObject>(
    () => getDefaultSelectedObject(draft)
  );
  const [activeStageKey, setActiveStageKey] = React.useState<string | null>(
    () => getDefaultActiveStageKey(draft)
  );
  const [connectionTarget, setConnectionTarget] = React.useState("");
  const [graphMessage, setGraphMessage] = React.useState<string | null>(null);
  const [contextMenuState, setContextMenuState] = React.useState<ContextMenuState>(null);
  const [createNodeDialogState, setCreateNodeDialogState] =
    React.useState<CreateNodeDialogState>(null);

  const graphState = React.useMemo(() => buildGraphEditorState(draft), [draft]);
  const graphNodes = React.useMemo(
    () =>
      graphState.nodes.map((node) => {
        if (isStageGraphNode(node)) {
          return {
            ...node,
            data: {
              ...node.data,
              onContextMenu: ({
                stageKey,
                x,
                y,
              }: {
                stageKey: string;
                x: number;
                y: number;
              }) => {
                setContextMenuState({ kind: "stage", stageKey, x, y });
              },
            } as PipelineGraphNode["data"],
          };
        }

        return {
          ...node,
          data: {
            ...node.data,
            onContextMenu: ({
              nodeKey,
              x,
              y,
            }: {
              nodeKey: string;
              x: number;
              y: number;
            }) => {
              setContextMenuState({ kind: "node", nodeKey, x, y });
            },
          } as PipelineGraphNode["data"],
        };
      }),
    [graphState.nodes]
  );
  const graphNodeMap = React.useMemo(
    () => new Map(graphState.nodes.map((node) => [node.id, node])),
    [graphState.nodes]
  );

  React.useEffect(() => {
    if (!selectedObject) {
      return;
    }

    const selectionStillExists =
      selectedObject.kind === "node"
        ? draft.nodes.some((node) => node.nodeKey === selectedObject.id)
        : draft.stages.some((stage) => stage.stageKey === selectedObject.id);

    if (!selectionStillExists) {
      setSelectedObject(null);
    }
  }, [draft.nodes, draft.stages, selectedObject]);

  React.useEffect(() => {
    if (activeStageKey && draft.stages.some((stage) => stage.stageKey === activeStageKey)) {
      return;
    }

    const fallbackStageKey = getDefaultActiveStageKey(draft);
    if (activeStageKey !== fallbackStageKey) {
      setActiveStageKey(fallbackStageKey);
    }
  }, [activeStageKey, draft]);

  React.useEffect(() => {
    if (
      createNodeDialogState &&
      !draft.stages.some((stage) => stage.stageKey === createNodeDialogState.stageKey)
    ) {
      setCreateNodeDialogState(null);
    }
  }, [createNodeDialogState, draft.stages]);

  const selectedGraphNode = selectedObject ? graphNodeMap.get(selectedObject.id) ?? null : null;
  const selectedActionNode =
    selectedObject?.kind === "node"
      ? draft.nodes.find((node) => node.nodeKey === selectedObject.id) ?? null
      : null;
  const selectedStage =
    selectedObject?.kind === "stage"
      ? draft.stages.find((stage) => stage.stageKey === selectedObject.id) ?? null
      : null;
  const activeStage =
    draft.stages.find((stage) => stage.stageKey === activeStageKey) ?? null;

  const selection = selectedActionNode
    ? { kind: "node" as const, nodeKey: selectedActionNode.nodeKey }
    : selectedStage
      ? { kind: "stage" as const, stageKey: selectedStage.stageKey }
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

  const contextMenuTargetId =
    contextMenuState?.kind === "stage"
      ? contextMenuState.stageKey
      : contextMenuState?.nodeKey ?? null;
  const contextMenuTargetNode = contextMenuTargetId
    ? graphNodeMap.get(contextMenuTargetId) ?? null
    : null;
  const createNodeBuiltin = createNodeDialogState
    ? BUILTIN_NODE_MAP.get(createNodeDialogState.nodeType) ?? null
    : null;
  const createNodeStage = createNodeDialogState
    ? draft.stages.find((stage) => stage.stageKey === createNodeDialogState.stageKey) ?? null
    : null;
  const createNodeParameters = createNodeDialogState
    ? getBuiltinCreateParameters(
        createNodeDialogState.nodeType,
        createNodeDialogState.parameters
      )
    : {};

  function applyDraft(nextDraft: PipelineDraft) {
    setGraphMessage(null);
    onChange(nextDraft);
  }

  function closeContextMenu() {
    setContextMenuState(null);
  }

  function closeCreateNodeDialog() {
    setCreateNodeDialogState(null);
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
    closeContextMenu();
    updateStages([...draft.stages, stage]);
    setSelectedObject({ kind: "stage", id: stage.stageKey });
    setActiveStageKey(stage.stageKey);
  }

  function resolveActiveStageKey() {
    return activeStageKey ?? "";
  }

  function startCreateNodeFromActiveStage() {
    const stageKey = resolveActiveStageKey();
    if (!stageKey) {
      setGraphMessage("请先创建一个阶段");
      return;
    }

    openCreateNodeDialog(stageKey);
  }

  function openCreateNodeDialog(stageKey: string) {
    closeContextMenu();
    setCreateNodeDialogState({
      stageKey,
      nodeType: "",
      parameters: {},
      errors: [],
    });
  }

  function updateStage(stageKey: string, updater: (stage: StageDraft) => StageDraft) {
    updateStages(
      draft.stages.map((stage) => (stage.stageKey === stageKey ? updater(stage) : stage))
    );
  }

  function updateNode(nodeKey: string, updater: (node: NodeDraft) => NodeDraft) {
    const nextNodes = draft.nodes.map((node) =>
      node.nodeKey === nodeKey ? updater(node) : node
    );
    const updatedNode = nextNodes.find((node) => node.nodeKey === nodeKey) ?? null;

    if (selectedObject?.kind === "node" && selectedObject.id === nodeKey && updatedNode) {
      setActiveStageKey(updatedNode.stageKey);
    }

    updateNodes(nextNodes);
  }

  function handleNodesChange(changes: NodeChange<PipelineGraphNode["data"]>[]) {
    const nextGraphNodes = applyNodeChanges(changes, graphState.nodes);

    const nextSelected = [...changes]
      .reverse()
      .find(
        (change): change is NodeChange & { id: string; selected: boolean } =>
          change.type === "select" && "selected" in change
      );
    if (nextSelected) {
      closeContextMenu();
      if (nextSelected.selected) {
        const nextGraphNode = nextGraphNodes.find((node) => node.id === nextSelected.id);
        if (nextGraphNode) {
          setSelectedObject(getSelectedGraphObject(nextGraphNode));
          setActiveStageKey(getGraphNodeStageKey(nextGraphNode));
        }
      } else {
        setSelectedObject(null);
      }
    }

    const hasStructuralChange = changes.some(
      (change) => change.type !== "select" && change.type !== "position"
    );
    if (!hasStructuralChange) {
      return;
    }

    applyDraft(
      syncDraftFromGraphState(draft, {
        nodes: nextGraphNodes,
        edges: graphState.edges,
      })
    );
  }

  function handleSelectionChange(params: { nodes: PipelineGraphNode[] }) {
    closeContextMenu();
    if (params.nodes.length !== 1) {
      setSelectedObject(null);
      return;
    }

    const node = params.nodes[0] ?? null;
    if (node) {
      setSelectedObject(getSelectedGraphObject(node));
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

  function handleNodeDragStop(node: PipelineGraphNode) {
    closeContextMenu();

    if (isStageGraphNode(node)) {
      const currentStageNode = graphNodeMap.get(node.id);
      if (!currentStageNode || !isStageGraphNode(currentStageNode)) {
        return;
      }

      applyDraft(
        syncDraftFromGraphState(draft, {
          nodes: graphState.nodes.map((graphNode) =>
            graphNode.id === node.id
              ? {
                  ...graphNode,
                  position: {
                    x: Math.round(node.position.x),
                    y: currentStageNode.position.y,
                  },
                }
              : graphNode
          ),
          edges: graphState.edges,
        })
      );
      return;
    }

    if (!isActionGraphNode(node)) {
      return;
    }

    const draggedNode = draft.nodes.find((item) => item.nodeKey === node.data.nodeKey);
    if (!draggedNode) {
      return;
    }

    if (node.parentId !== draggedNode.stageKey || node.data.stageKey !== draggedNode.stageKey) {
      return;
    }

    const stageNodes = draft.nodes.filter((item) => item.stageKey === draggedNode.stageKey);
    const reorderedStageNodes = reorderStageNodesForDropPosition(
      stageNodes,
      draggedNode.nodeKey,
      node.position
    );
    const reorderedStageNodeMap = new Map(
      reorderedStageNodes.map((stageNode) => [stageNode.nodeKey, stageNode])
    );

    updateNodes(
      draft.nodes.map((item) => reorderedStageNodeMap.get(item.nodeKey) ?? item)
    );
  }

  function deleteGraphObject(targetNode: PipelineGraphNode) {
    closeContextMenu();

    const nextDraft = removeSelectedGraphObject(draft, targetNode);
    const deletesCurrentSelection = selectedGraphNode?.id === targetNode.id;

    if (deletesCurrentSelection) {
      const fallbackStageKey = isActionGraphNode(targetNode)
        ? targetNode.data.stageKey
        : getDefaultActiveStageKey(nextDraft);

      setSelectedObject(null);
      setActiveStageKey(
        nextDraft.stages.some((stage) => stage.stageKey === fallbackStageKey)
          ? fallbackStageKey
          : getDefaultActiveStageKey(nextDraft)
      );
      setConnectionTarget("");
      applyDraft(nextDraft);
      return;
    }

    if (connectionTarget && !nextDraft.nodes.some((node) => node.nodeKey === connectionTarget)) {
      setConnectionTarget("");
    }

    applyDraft(nextDraft);
  }

  function handleContextMenuDelete() {
    if (!contextMenuTargetNode) {
      closeContextMenu();
      return;
    }

    deleteGraphObject(contextMenuTargetNode);
  }

  function deleteSelectedObject() {
    if (!selectedGraphNode) {
      setGraphMessage("请先选择一个阶段或节点");
      return;
    }

    deleteGraphObject(selectedGraphNode);
  }

  function updateCreateNodeType(nextNodeType: string) {
    setCreateNodeDialogState((current) =>
      current
        ? {
            ...current,
            nodeType: nextNodeType,
            parameters: getBuiltinCreateParameters(nextNodeType, current.parameters),
            errors: [],
          }
        : current
    );
  }

  function updateCreateNodeParameter(fieldKey: string, nextValue: string) {
    setCreateNodeDialogState((current) =>
      current
        ? {
            ...current,
            parameters: {
              ...current.parameters,
              [fieldKey]: nextValue,
            },
            errors: [],
          }
        : current
    );
  }

  function submitCreateNodeDialog() {
    if (!createNodeDialogState) {
      return;
    }

    const errors = validateCreateNodeDialogState(createNodeDialogState);
    if (errors.length > 0) {
      setCreateNodeDialogState((current) =>
        current
          ? {
              ...current,
              errors,
            }
          : current
      );
      return;
    }

    const nextNode = createNodeDraft({
      stageKey: createNodeDialogState.stageKey,
      nodeType: createNodeDialogState.nodeType,
      parameters: getBuiltinCreateParameters(
        createNodeDialogState.nodeType,
        createNodeDialogState.parameters
      ),
      position: getNextNodePositionInStage(draft.nodes, createNodeDialogState.stageKey),
    });

    closeCreateNodeDialog();
    updateNodes([...draft.nodes, nextNode]);
    setSelectedObject({ kind: "node", id: nextNode.nodeKey });
    setActiveStageKey(createNodeDialogState.stageKey);
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
            onClick={startCreateNodeFromActiveStage}
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
          className="relative min-w-0 h-[560px] rounded-2xl border border-border bg-slate-100/70"
          data-testid="pipeline-graph-editor"
        >
          <ReactFlow
            nodes={graphNodes}
            edges={graphState.edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              reactFlowRef.current = instance;
            }}
            onNodeClick={(_, node) => {
              closeContextMenu();
              setSelectedObject(getSelectedGraphObject(node));
              setActiveStageKey(getGraphNodeStageKey(node));
            }}
            onPaneClick={() => {
              closeContextMenu();
              setSelectedObject(null);
            }}
            onNodesChange={handleNodesChange}
            onNodeDragStop={(_, node) => handleNodeDragStop(node)}
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

          {contextMenuState ? (
            <div
              role="menu"
              aria-label={contextMenuState.kind === "stage" ? "阶段上下文菜单" : "节点上下文菜单"}
              className="fixed z-50 min-w-[144px] rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
              style={{
                left: contextMenuState.x,
                top: contextMenuState.y,
              }}
            >
              {contextMenuState.kind === "stage" ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="pipeline-graph-stage-context-add-node"
                    className={contextMenuItemClassName}
                    onClick={() => openCreateNodeDialog(contextMenuState.stageKey)}
                  >
                    添加节点
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="pipeline-graph-stage-context-delete"
                    className={contextMenuItemClassName}
                    onClick={handleContextMenuDelete}
                  >
                    删除阶段
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="pipeline-graph-node-context-delete"
                  className={contextMenuItemClassName}
                  onClick={handleContextMenuDelete}
                >
                  删除节点
                </button>
              )}
            </div>
          ) : null}
        </div>

        <PipelineGraphSelectionPanel
          selection={selection}
          stages={draft.stages}
          nodes={draft.nodes}
          managedProjects={managedProjects}
          onStageChange={updateStage}
          onNodeChange={updateNode}
        />
      </div>

      <Dialog
        open={Boolean(createNodeDialogState)}
        onOpenChange={(open) => {
          if (!open) {
            closeCreateNodeDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建节点</DialogTitle>
            <DialogDescription>
              {createNodeStage
                ? `在阶段“${createNodeStage.name}”中创建一个新节点。`
                : "创建一个新节点。"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1">
              <Label htmlFor="pipeline-create-node-type-select">节点类型</Label>
              <select
                id="pipeline-create-node-type-select"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={createNodeDialogState?.nodeType ?? ""}
                onChange={(event) => updateCreateNodeType(event.target.value)}
                aria-label="节点类型"
              >
                <option value="">请选择节点类型</option>
                {BUILTIN_NODE_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            {createNodeBuiltin ? (
              <div className="grid gap-2">
                {createNodeBuiltin.fields.map((field) => {
                  const fieldValue =
                    typeof createNodeParameters[field.key] === "string"
                      ? String(createNodeParameters[field.key])
                      : "";

                  if (
                    createNodeBuiltin.value === "switch_project" &&
                    field.key === "managedProjectId"
                  ) {
                    return (
                      <div key={field.key} className="grid gap-1">
                        <Label htmlFor="pipeline-create-node-managed-project-select">
                          {field.label}
                        </Label>
                        <select
                          id="pipeline-create-node-managed-project-select"
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                          value={fieldValue}
                          onChange={(event) =>
                            updateCreateNodeParameter(field.key, event.target.value)
                          }
                          aria-label={field.label}
                        >
                          <option value="">{field.placeholder}</option>
                          {managedProjects.map((project) => (
                            <option key={project.id} value={String(project.id)}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  return (
                    <div key={field.key} className="grid gap-1">
                      <Label htmlFor={`pipeline-create-node-field-${field.key}`}>
                        {field.label}
                      </Label>
                      <Input
                        id={`pipeline-create-node-field-${field.key}`}
                        value={fieldValue}
                        onChange={(event) =>
                          updateCreateNodeParameter(field.key, event.target.value)
                        }
                        placeholder={field.placeholder}
                        aria-label={field.label}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}

            {createNodeDialogState?.errors.length ? (
              <div className="grid gap-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {createNodeDialogState.errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeCreateNodeDialog}>
              取消
            </Button>
            <Button type="button" onClick={submitCreateNodeDialog}>
              创建节点
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
