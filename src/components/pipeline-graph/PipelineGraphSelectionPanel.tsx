import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedProject } from "@/lib/types";

import { StructuredJsonEditor } from "../pipeline-editor/StructuredJsonEditor";
import {
  BUILTIN_NODE_MAP,
  BUILTIN_NODE_TYPES,
  normalizeBuiltinParameters,
  remapNodeDraftForType,
  type NodeDraft,
  type StageDraft,
} from "../pipeline-editor/draft-model";

type PipelineGraphSelection =
  | { kind: "stage"; stage: StageDraft }
  | { kind: "node"; node: NodeDraft }
  | null;

export type PipelineGraphSelectionPanelProps = {
  selection: PipelineGraphSelection;
  stages: StageDraft[];
  managedProjects: ManagedProject[];
  onStageChange: (stageKey: string, updater: (current: StageDraft) => StageDraft) => void;
  onNodeChange: (nodeKey: string, updater: (current: NodeDraft) => NodeDraft) => void;
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

export function PipelineGraphSelectionPanel({
  selection,
  stages,
  managedProjects,
  onStageChange,
  onNodeChange,
}: PipelineGraphSelectionPanelProps) {
  if (selection?.kind === "stage") {
    return (
      <aside className="grid gap-4 rounded-xl border border-border bg-background p-4">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">阶段属性</h4>
          <p className="text-xs text-muted-foreground">修改阶段名称和启用状态。</p>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="pipeline-stage-name-input">阶段名称</Label>
          <Input
            id="pipeline-stage-name-input"
            value={selection.stage.name}
            onChange={(event) =>
              onStageChange(selection.stage.stageKey, (current) => ({
                ...current,
                name: event.target.value,
              }))
            }
            placeholder="准备"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={selection.stage.enabled}
            onCheckedChange={(value) =>
              onStageChange(selection.stage.stageKey, (current) => ({
                ...current,
                enabled: Boolean(value),
              }))
            }
          />
          启用该阶段
        </label>
      </aside>
    );
  }

  if (selection?.kind === "node") {
    return (
      <NodeSelectionPanel
        node={selection.node}
        stages={stages}
        managedProjects={managedProjects}
        onChange={(updater) => onNodeChange(selection.node.nodeKey, updater)}
      />
    );
  }

  return (
    <aside className="grid gap-3 rounded-xl border border-border bg-background p-4">
      <h4 className="text-sm font-semibold">属性面板</h4>
      <p className="text-sm text-muted-foreground">
        选中一个阶段或节点后，在这里编辑详细属性。
      </p>
    </aside>
  );
}

function NodeSelectionPanel({
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
    <aside className="grid gap-4 rounded-xl border border-border bg-background p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">节点属性</h4>
        <p className="text-xs text-muted-foreground">
          修改节点类型、所属阶段以及参数。
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
                        {selectedManagedProject.pathWithNamespace} / {selectedManagedProject.repoPath}
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
    </aside>
  );
}
