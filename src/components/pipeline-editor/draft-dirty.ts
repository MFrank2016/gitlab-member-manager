import { buildPipelineCreatePayload, type PipelineDraft } from "@/components/pipeline-editor/draft-model";

function normalizeComparableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const normalized = normalizeComparableValue(
          (value as Record<string, unknown>)[key]
        );
        if (normalized !== undefined) {
          result[key] = normalized;
        }
        return result;
      }, {});
  }

  return value;
}

function buildComparableDraftSnapshot(draft: PipelineDraft) {
  return {
    name: draft.name,
    description: draft.description,
    enabled: draft.enabled,
    maxConcurrencyDefault: draft.maxConcurrencyDefault,
    variableRows: draft.variableRows.map((variable) => ({
      key: variable.key,
      label: variable.label,
      defaultValue: variable.defaultValue,
      required: variable.required,
    })),
    stages: draft.stages.map((stage) => ({
      stageKey: stage.stageKey,
      name: stage.name,
      enabled: stage.enabled,
    })),
    nodes: draft.nodes.map((node) => ({
      nodeKey: node.nodeKey,
      stageKey: node.stageKey,
      nodeType: node.nodeType,
      parameters: normalizeComparableValue(node.parameters),
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      enabled: node.enabled,
    })),
    edges: draft.edges.map((edge) => ({
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
    })),
    schedules: draft.schedules.map((schedule) => ({
      scheduleId: schedule.scheduleId,
      projectGroupId: schedule.projectGroupId ?? "",
      cronExpr: schedule.cronExpr,
      timezone: schedule.timezone,
      branch: schedule.branch,
      enabled: schedule.enabled,
      policy: schedule.policy,
      variables: normalizeComparableValue(schedule.variables),
    })),
  };
}

function buildComparablePipelineDraft(draft: PipelineDraft) {
  try {
    return {
      kind: "payload" as const,
      value: normalizeComparableValue(buildPipelineCreatePayload(draft)),
    };
  } catch {
    return {
      kind: "draft" as const,
      value: buildComparableDraftSnapshot(draft),
    };
  }
}

export function arePipelineDraftsEquivalent(
  left: PipelineDraft,
  right: PipelineDraft
) {
  return (
    JSON.stringify(buildComparablePipelineDraft(left)) ===
    JSON.stringify(buildComparablePipelineDraft(right))
  );
}
