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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedProject } from "@/lib/types";

import { StructuredJsonEditor } from "../pipeline-editor/StructuredJsonEditor";
import {
  BUILTIN_NODE_MAP,
  BUILTIN_NODE_TYPES,
  createEdgeDraft,
  createNodeDraft,
  createStageDraft,
  ensureVariableRows,
  normalizeBuiltinParameters,
  remapNodeDraftForType,
  type NodeDraft,
  type PipelineDraft,
  type StageDraft,
} from "../pipeline-editor/draft-model";
import {
  PIPELINE_ACTION_NODE_TYPE,
  STAGE_GROUP_NODE_TYPE,
  buildGraphEditorState,
  removeSelectedGraphObject,
  syncDraftFromGraphState,
  validateGraphConnection,
  type PipelineGraphNode,
} from "./graph-model";
import { PipelineActionNode } from "./PipelineActionNode";
import { StageGroupNode } from "./StageGroupNode";

type PipelineGraphEditorProps = {
  draft: PipelineDraft;
  managedProjects?: ManagedProject[];
  onChange: (next: PipelineDraft) => void;
};

function splitBuiltinParameters(nodeType: string, parameters: Record<string, unknown>) {
  const builtin = BUILTIN_NODE_MAP.get(nodeType);
  if (!builtin) {
    return { builtinParameters: {}, extraParameters: parameters };
  }

  const normalized = normalizeBuiltinParameters(nodeType, parameters);
  const builtinParameters: Record<string, unknown> = {};
  const extraParameters: Record<string, unknown> = {};

  for (const field of builtin.fields) {
    builtinParameters[field.key] = normalized[field.key];
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (!(key in builtinParameters)) {
      extraParameters[key] = value;
    }
  }

  return { builtinParameters, extraParameters };
}

function mergeBuiltinParameters(
  nodeType: string,
  builtinParameters: Record<string, unknown>,
  extraParameters: Record<string, unknown>
) {
  return {
    ...extraParameters,
    ...normalizeBuiltinParameters(nodeType, builtinParameters),
  };
}

const nodeTypes = {
  [STAGE_GROUP_NODE_TYPE]: StageGroupNode,
  [PIPELINE_ACTION_NODE_TYPE]: PipelineActionNode,
};

function isActionGraphNode(node: PipelineGraphNode | null | undefined) {
  return node?.type === PIPELINE_ACTION_NODE_TYPE;
}

function isStageGraphNode(node: PipelineGraphNode | null | undefined) {
  return node?.type === STAGE_GROUP_NODE_TYPE;
}

export function PipelineGraphEditor({
  draft,
  managedProjects = [],
  onChange,
}: PipelineGraphEditorProps) {
  const reactFlowRef = React.useRef<{ fitView: () => void } | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => draft.nodes[0]?.nodeKey ?? draft.stages[0]?.stageKey ?? null
  );
  const [connectionTarget, setConnectionTarget] = React.useState("");
  const [graphMessage, setGraphMessage] = React.useState<string | null>(null);

  const graphState = React.useMemo(() => buildGraphEditorState(draft), [draft]);
  const graphNodeMap = React.useMemo(
    () => new Map(graphState.nodes.map((node) => [node.id, node])),
    [graphState.nodes]
  );

  React.useEffect(() => {
    if (!selectedId) {
      setSelectedId(draft.nodes[0]?.nodeKey ?? draft.stages[0]?.stageKey ?? null);
      return;
    }
    if (!graphNodeMap.has(selectedId)) {
      setSelectedId(draft.nodes[0]?.nodeKey ?? draft.stages[0]?.stageKey ?? null);
    }
  }, [draft.nodes, draft.stages, graphNodeMap, selectedId]);

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
  }

  function resolveActiveStageKey() {
    if (selectedActionNode) return selectedActionNode.stageKey;
    if (selectedStage) return selectedStage.stageKey;
    return draft.stages[0]?.stageKey ?? "";
  }

  function addNode() {
    const stageKey = resolveActiveStageKey();
    if (!stageKey) {
      setGraphMessage("请先创建一个阶段");
      return;
    }

    const nodesInStage = draft.nodes.filter((node) => node.stageKey === stageKey);
    const nextNode = createNodeDraft({
      stageKey,
      nodeType: "checkout_branch",
      position: {
        x: 96,
        y: 72 + nodesInStage.length * 116,
      },
    });

    updateNodes([...draft.nodes, nextNode]);
    setSelectedId(nextNode.nodeKey);
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
    }

    applyDraft(nextDraft);
  }

  function handleSelectionChange(params: { nodes: PipelineGraphNode[] }) {
    setSelectedId(params.nodes.at(-1)?.id ?? null);
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

    setSelectedId(null);
    setConnectionTarget("");
    applyDraft(removeSelectedGraphObject(draft, selectedGraphNode));
  }

  return (
    <section className="grid gap-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">流程图</h3>
        <p className="text-sm text-muted-foreground">
          用阶段容器组织节点，并通过连线表达执行依赖。
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
        <aside className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">编辑操作</h4>
            <p className="text-xs text-muted-foreground">
              先选中阶段或节点，再执行对应操作。
            </p>
          </div>
          <Button type="button" onClick={addStage}>
            添加阶段
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={addNode}
            disabled={!resolveActiveStageKey()}
          >
            在所选阶段添加节点
          </Button>
          <div className="grid gap-1">
            <Label htmlFor="pipeline-graph-connect-target">连接到节点</Label>
            <select
              id="pipeline-graph-connect-target"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
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
            onClick={createConnectionFromPanel}
            disabled={!selectedActionNode || !connectionTarget}
          >
            创建连线
          </Button>
          <Button type="button" variant="outline" onClick={fitCanvasToViewport}>
            适配全貌
          </Button>
          <Button
            type="button"
            variant="outline"
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

        <div className="h-[560px] rounded-2xl border border-border bg-slate-100/70" data-testid="pipeline-graph-editor">
          <ReactFlow
            nodes={graphState.nodes}
            edges={graphState.edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              reactFlowRef.current = instance;
            }}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onNodesChange={handleNodesChange}
            onSelectionChange={handleSelectionChange}
            onConnect={commitConnection}
            panOnDrag
            zoomOnScroll
            selectionOnDrag
            fitView
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>

        <aside className="grid gap-3 rounded-xl border border-border bg-background p-3">
          {!selectedGraphNode ? (
            <>
              <h4 className="text-sm font-semibold">属性面板</h4>
              <p className="text-sm text-muted-foreground">
                选中一个阶段或节点后，在这里编辑详细属性。
              </p>
            </>
          ) : selectedStage && !selectedActionNode ? (
            <>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">阶段属性</h4>
                <p className="text-xs text-muted-foreground">
                  修改阶段名称和启用状态。
                </p>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="pipeline-stage-name-input">阶段名称</Label>
                <Input
                  id="pipeline-stage-name-input"
                  value={selectedStage.name}
                  onChange={(event) =>
                    updateStage(selectedStage.stageKey, (current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="准备"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedStage.enabled}
                  onCheckedChange={(value) =>
                    updateStage(selectedStage.stageKey, (current) => ({
                      ...current,
                      enabled: Boolean(value),
                    }))
                  }
                />
                启用该阶段
              </label>
            </>
          ) : selectedActionNode ? (
            <PipelineNodePropertiesPanel
              node={selectedActionNode}
              stages={draft.stages}
              managedProjects={managedProjects}
              onChange={(updater) => updateNode(selectedActionNode.nodeKey, updater)}
            />
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function PipelineNodePropertiesPanel({
  node,
  stages,
  managedProjects,
  onChange,
}: {
  node: NodeDraft;
  stages: StageDraft[];
  managedProjects: ManagedProject[];
  onChange: (updater: (current: NodeDraft) => NodeDraft) => void;
}) {
  const builtin = BUILTIN_NODE_MAP.get(node.nodeType);
  const { builtinParameters, extraParameters } = splitBuiltinParameters(
    node.nodeType,
    node.parameters
  );

  function updateBuiltinField(fieldKey: string, nextValue: string) {
    onChange((current) => {
      const nextBuiltinParameters = { ...builtinParameters, [fieldKey]: nextValue };
      return {
        ...current,
        parameters: mergeBuiltinParameters(
          current.nodeType,
          nextBuiltinParameters,
          extraParameters
        ),
      };
    });
  }

  const selectedManagedProject =
    builtin?.value === "switch_project"
      ? managedProjects.find(
          (project) => String(project.id) === String(builtinParameters.managedProjectId ?? "")
        ) ?? null
      : null;

  return (
    <>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">节点属性</h4>
        <p className="text-xs text-muted-foreground">
          复用现有内建节点参数表单，修改类型、所属阶段和参数。
        </p>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="pipeline-node-stage-select">所属阶段</Label>
        <select
          id="pipeline-node-stage-select"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={node.stageKey}
          onChange={(event) =>
            onChange((current) => ({ ...current, stageKey: event.target.value }))
          }
        >
          {stages.map((stage) => (
            <option key={stage.stageKey} value={stage.stageKey}>
              {stage.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="pipeline-node-type-select">节点类型</Label>
        <select
          id="pipeline-node-type-select"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={builtin ? node.nodeType : "__custom__"}
          onChange={(event) =>
            onChange((current) => {
              if (event.target.value === "__custom__") {
                return {
                  ...current,
                  nodeType: builtin ? "" : current.nodeType,
                  parameters: builtin ? {} : current.parameters,
                };
              }
              return remapNodeDraftForType(current, event.target.value);
            })
          }
          aria-label="节点类型"
        >
          {BUILTIN_NODE_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
          <option value="__custom__">自定义节点</option>
        </select>
      </div>

      {!builtin ? (
        <div className="grid gap-1">
          <Label htmlFor="pipeline-custom-node-type-input">自定义节点类型</Label>
          <Input
            id="pipeline-custom-node-type-input"
            value={node.nodeType}
            onChange={(event) =>
              onChange((current) => ({ ...current, nodeType: event.target.value }))
            }
            placeholder="custom_release_gate"
          />
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={node.enabled}
          onCheckedChange={(value) =>
            onChange((current) => ({ ...current, enabled: Boolean(value) }))
          }
        />
        启用该节点
      </label>

      {builtin ? (
        <>
          <div className="grid gap-2">
            {builtin.fields.map((field) => {
              const fieldValue =
                typeof builtinParameters[field.key] === "string"
                  ? String(builtinParameters[field.key])
                  : "";

              if (builtin.value === "switch_project" && field.key === "managedProjectId") {
                return (
                  <div key={field.key} className="grid gap-1">
                    <Label htmlFor="pipeline-node-managed-project-select">{field.label}</Label>
                    <select
                      id="pipeline-node-managed-project-select"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={fieldValue}
                      onChange={(event) => updateBuiltinField(field.key, event.target.value)}
                      aria-label={field.label}
                    >
                      <option value="">{field.placeholder}</option>
                      {managedProjects.map((project) => (
                        <option key={project.id} value={String(project.id)}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                    {selectedManagedProject ? (
                      <p className="text-xs text-muted-foreground">
                        {selectedManagedProject.pathWithNamespace} · {selectedManagedProject.repoPath}
                      </p>
                    ) : managedProjects.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        暂无可选托管项目，请先在“托管项目”里配置。
                      </p>
                    ) : null}
                  </div>
                );
              }

              return (
                <div key={field.key} className="grid gap-1">
                  <Label htmlFor={`pipeline-node-field-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`pipeline-node-field-${field.key}`}
                    value={fieldValue}
                    onChange={(event) => updateBuiltinField(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    aria-label={field.label}
                  />
                </div>
              );
            })}
          </div>

          <div className="grid gap-1">
            <Label>附加参数</Label>
            <StructuredJsonEditor
              value={extraParameters}
              onChange={(nextValue) =>
                onChange((current) => {
                  const nextExtraParameters =
                    nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)
                      ? (nextValue as Record<string, unknown>)
                      : {};
                  return {
                    ...current,
                    parameters: mergeBuiltinParameters(
                      current.nodeType,
                      builtinParameters,
                      nextExtraParameters
                    ),
                  };
                })
              }
              testId={`pipeline-node-extra-parameter-editor-${node.nodeKey}`}
            />
          </div>
        </>
      ) : (
        <div className="grid gap-1">
          <Label>参数</Label>
          <StructuredJsonEditor
            value={node.parameters}
            onChange={(nextValue) =>
              onChange((current) => ({
                ...current,
                parameters:
                  nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)
                    ? (nextValue as Record<string, unknown>)
                    : {},
              }))
            }
            testId={`pipeline-node-structured-editor-${node.nodeKey}`}
          />
        </div>
      )}
    </>
  );
}
