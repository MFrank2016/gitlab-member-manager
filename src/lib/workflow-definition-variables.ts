export type WorkflowStepLike = {
  stepType: string;
  parameters?: unknown;
};

const VARIABLE_PATTERN = /\$\{\s*([^{}]+?)\s*\}/g;

function collectFromValue(value: unknown, target: Set<string>) {
  if (typeof value === "string") {
    for (const match of value.matchAll(VARIABLE_PATTERN)) {
      const name = match[1]?.trim();
      if (name) target.add(name);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectFromValue(item, target);
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectFromValue(item, target);
    }
  }
}

export function collectReferencedWorkflowVariables(steps: WorkflowStepLike[]): string[] {
  const variables = new Set<string>();
  for (const step of steps) {
    collectFromValue(step.parameters, variables);
  }
  return Array.from(variables).sort();
}

export function mergeDeclaredWorkflowVariables(
  declaredVariables: Record<string, string>,
  steps: WorkflowStepLike[]
): Record<string, string> {
  const merged = { ...declaredVariables };
  for (const variableName of collectReferencedWorkflowVariables(steps)) {
    if (!(variableName in merged)) {
      merged[variableName] = "";
    }
  }
  return merged;
}

export function validateDeclaredWorkflowVariables(
  declaredVariables: Record<string, string>,
  steps: WorkflowStepLike[]
): string[] {
  const missing = collectReferencedWorkflowVariables(steps).filter(
    (variableName) => !(variableName in declaredVariables)
  );
  return Array.from(new Set(missing)).sort();
}

