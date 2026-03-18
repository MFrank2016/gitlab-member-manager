import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createWorkflowDefinition,
  deleteWorkflowDefinition,
  getWorkflowDefinitionDetail,
  listWorkflowDefinitions,
  updateWorkflowDefinition,
} from "@/lib/invoke";
import type { WorkflowDefinitionDetail, WorkflowDefinitionListItem } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type StepFieldDefinition = {
  key: string;
  label: string;
  placeholder: string;
};

type BuiltinStepTypeDefinition = {
  value: string;
  label: string;
  fields: StepFieldDefinition[];
  defaults: Record<string, string>;
};

const BUILTIN_STEP_TYPES: BuiltinStepTypeDefinition[] = [
  {
    value: "checkout_branch",
    label: "checkout_branch",
    fields: [{ key: "branch", label: "Branch", placeholder: "${source_branch}" }],
    defaults: { branch: "${source_branch}" },
  },
  {
    value: "git_pull",
    label: "git_pull",
    fields: [{ key: "branch", label: "Branch", placeholder: "${target_branch}" }],
    defaults: { branch: "${target_branch}" },
  },
  {
    value: "git_merge",
    label: "git_merge",
    fields: [{ key: "from", label: "From", placeholder: "${source_branch}" }],
    defaults: { from: "${source_branch}" },
  },
  {
    value: "git_push",
    label: "git_push",
    fields: [{ key: "remote", label: "Remote", placeholder: "origin" }],
    defaults: { remote: "origin" },
  },
];

const BUILTIN_STEP_MAP = new Map(BUILTIN_STEP_TYPES.map((item) => [item.value, item]));

type StepDraft = {
  id: string;
  stepType: string;
  parameters: Record<string, unknown>;
  customParametersText: string;
};

type WorkflowDraft = {
  name: string;
  description: string;
  enabled: boolean;
  maxConcurrencyDefault: string;
  variablesSchemaText: string;
  steps: StepDraft[];
};

let stepDraftCounter = 0;

function nextStepDraftId() {
  stepDraftCounter += 1;
  return `step-${stepDraftCounter}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string, fieldName: string): Record<string, unknown> {
  const normalized = raw.trim() || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }

  return parsed;
}

function normalizeBuiltinParameters(stepType: string, parameters: Record<string, unknown>) {
  const builtin = BUILTIN_STEP_MAP.get(stepType);
  if (!builtin) return parameters;

  const normalized: Record<string, unknown> = {};
  for (const field of builtin.fields) {
    const raw = parameters[field.key];
    normalized[field.key] = typeof raw === "string"
      ? raw
      : (raw === undefined || raw === null ? (builtin.defaults[field.key] ?? "") : String(raw));
  }
  return normalized;
}

function createStepDraft(stepType = "checkout_branch", parameters: unknown = undefined): StepDraft {
  const base = isRecord(parameters) ? parameters : {};
  const normalizedBase = normalizeBuiltinParameters(stepType, base);

  return {
    id: nextStepDraftId(),
    stepType,
    parameters: normalizedBase,
    customParametersText: JSON.stringify(normalizedBase, null, 2),
  };
}

function createEmptyWorkflowDraft(): WorkflowDraft {
  return {
    name: "",
    description: "",
    enabled: true,
    maxConcurrencyDefault: "2",
    variablesSchemaText: "{}",
    steps: [createStepDraft()],
  };
}

function toDraftFromDetail(detail: WorkflowDefinitionDetail): WorkflowDraft {
  const sortedSteps = [...detail.steps].sort((a, b) => a.stepOrder - b.stepOrder);
  return {
    name: detail.name,
    description: detail.description,
    enabled: detail.enabled,
    maxConcurrencyDefault: String(detail.maxConcurrencyDefault),
    variablesSchemaText: JSON.stringify(
      isRecord(detail.variablesSchema) ? detail.variablesSchema : {},
      null,
      2
    ),
    steps: sortedSteps.length > 0
      ? sortedSteps.map((step) => createStepDraft(step.stepType, step.parameters))
      : [createStepDraft()],
  };
}

function buildStepPayloads(steps: StepDraft[]) {
  if (steps.length === 0) {
    throw new Error("At least one workflow step is required.");
  }

  return steps.map((step, index) => {
    const stepType = step.stepType.trim();
    if (!stepType) {
      throw new Error(`Step ${index + 1} type is required.`);
    }

    const builtin = BUILTIN_STEP_MAP.get(stepType);
    if (builtin) {
      const normalized = normalizeBuiltinParameters(stepType, step.parameters);
      return { stepType, parameters: normalized };
    }

    return {
      stepType,
      parameters: parseJsonObject(step.customParametersText, `Step ${index + 1} parameters`),
    };
  });
}

function WorkflowDraftForm({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (next: WorkflowDraft) => void;
}) {
  function updateStep(index: number, updater: (step: StepDraft) => StepDraft) {
    onChange({
      ...draft,
      steps: draft.steps.map((step, stepIndex) => (stepIndex === index ? updater(step) : step)),
    });
  }

  function addStep() {
    onChange({
      ...draft,
      steps: [...draft.steps, createStepDraft("git_pull")],
    });
  }

  function removeStep(index: number) {
    onChange({
      ...draft,
      steps: draft.steps.filter((_, stepIndex) => stepIndex !== index),
    });
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.steps.length) return;

    const nextSteps = [...draft.steps];
    [nextSteps[index], nextSteps[target]] = [nextSteps[target], nextSteps[index]];
    onChange({ ...draft, steps: nextSteps });
  }

  function updateStepType(index: number, stepType: string) {
    updateStep(index, (step) => {
      const nextParameters = normalizeBuiltinParameters(stepType, step.parameters);
      return {
        ...step,
        stepType,
        parameters: nextParameters,
        customParametersText: JSON.stringify(nextParameters, null, 2),
      };
    });
  }

  function updateBuiltinField(index: number, key: string, value: string) {
    updateStep(index, (step) => {
      const parameters = { ...step.parameters, [key]: value };
      return {
        ...step,
        parameters,
        customParametersText: JSON.stringify(parameters, null, 2),
      };
    });
  }

  function updateCustomText(index: number, value: string) {
    updateStep(index, (step) => ({ ...step, customParametersText: value }));
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <Label>Name</Label>
        <Input
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="workflow name"
        />
      </div>

      <div className="grid gap-1">
        <Label>Description</Label>
        <Input
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          placeholder="optional description"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <Label>Max Concurrency Default</Label>
          <Input
            type="number"
            min={1}
            value={draft.maxConcurrencyDefault}
            onChange={(event) => onChange({ ...draft, maxConcurrencyDefault: event.target.value })}
          />
        </div>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <Checkbox
            checked={draft.enabled}
            onCheckedChange={(value) => onChange({ ...draft, enabled: Boolean(value) })}
          />
          Enabled
        </label>
      </div>

      <div className="grid gap-1">
        <Label>Variables Schema (JSON Object)</Label>
        <textarea
          className="min-h-24 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={draft.variablesSchemaText}
          onChange={(event) => onChange({ ...draft, variablesSchemaText: event.target.value })}
        />
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <Label>Workflow Steps</Label>
          <Button type="button" size="sm" variant="secondary" onClick={addStep}>
            Add Step
          </Button>
        </div>

        {draft.steps.map((step, index) => {
          const builtin = BUILTIN_STEP_MAP.get(step.stepType);
          const hasCustomOption = Boolean(step.stepType) && !builtin;

          return (
            <div key={step.id} className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Step {index + 1}</h4>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move step ${index + 1} up`}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === draft.steps.length - 1}
                    aria-label={`Move step ${index + 1} down`}
                  >
                    Down
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => removeStep(index)}
                    aria-label={`Remove step ${index + 1}`}
                    disabled={draft.steps.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>

              <div className="grid gap-1">
                <Label>Step Type</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={step.stepType}
                  onChange={(event) => updateStepType(index, event.target.value)}
                  aria-label={`Step ${index + 1} Type`}
                >
                  {BUILTIN_STEP_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                  {hasCustomOption && (
                    <option value={step.stepType}>{step.stepType}</option>
                  )}
                </select>
              </div>

              {builtin ? (
                <div className="grid gap-2">
                  {builtin.fields.map((field) => (
                    <div key={field.key} className="grid gap-1">
                      <Label>{field.label}</Label>
                      <Input
                        value={
                          typeof step.parameters[field.key] === "string"
                            ? String(step.parameters[field.key])
                            : ""
                        }
                        onChange={(event) =>
                          updateBuiltinField(index, field.key, event.target.value)
                        }
                        placeholder={field.placeholder}
                        aria-label={`Step ${index + 1} ${field.label}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-1">
                  <Label>Parameters (JSON Object)</Label>
                  <textarea
                    className="min-h-24 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={step.customParametersText}
                    onChange={(event) => updateCustomText(index, event.target.value)}
                    aria-label={`Step ${index + 1} Parameters JSON`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildWorkflowCreatePayload(draft: WorkflowDraft) {
  const name = draft.name.trim();
  if (!name) {
    throw new Error("Workflow name cannot be empty.");
  }

  const maxConcurrencyDefault = Number(draft.maxConcurrencyDefault);
  if (!Number.isInteger(maxConcurrencyDefault) || maxConcurrencyDefault < 1) {
    throw new Error("Max concurrency default must be an integer >= 1.");
  }

  return {
    name,
    description: draft.description.trim(),
    enabled: draft.enabled,
    variablesSchema: parseJsonObject(draft.variablesSchemaText, "Variables schema"),
    maxConcurrencyDefault,
    steps: buildStepPayloads(draft.steps),
  };
}

export function WorkflowsPage() {
  const [items, setItems] = React.useState<WorkflowDefinitionListItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const editRequestTokenRef = React.useRef(0);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createDraft, setCreateDraft] = React.useState<WorkflowDraft>(createEmptyWorkflowDraft);
  const [creating, setCreating] = React.useState(false);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editDraft, setEditDraft] = React.useState<WorkflowDraft>(createEmptyWorkflowDraft);
  const [editingItem, setEditingItem] = React.useState<WorkflowDefinitionListItem | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function refresh({ silent = false }: { silent?: boolean } = {}): Promise<boolean> {
    setLoading(true);
    try {
      setItems(await listWorkflowDefinitions());
      return true;
    } catch (error) {
      if (!silent) {
        toast.error(`Load workflows failed: ${String(error)}`);
      }
      setItems([]);
      return false;
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refresh();
  }, []);

  async function onCreate() {
    let payload: ReturnType<typeof buildWorkflowCreatePayload>;
    try {
      payload = buildWorkflowCreatePayload(createDraft);
    } catch (error) {
      toast.error(String(error));
      return;
    }

    setCreating(true);
    try {
      await createWorkflowDefinition(payload);
      setCreateOpen(false);
      setCreateDraft(createEmptyWorkflowDraft());
      if (await refresh({ silent: true })) {
        toast.success("Workflow created.");
      } else {
        toast.error("Workflow created, but refreshing workflow list failed.");
      }
    } catch (error) {
      toast.error(`Create workflow failed: ${String(error)}`);
    } finally {
      setCreating(false);
    }
  }

  async function startEdit(item: WorkflowDefinitionListItem) {
    const requestToken = editRequestTokenRef.current + 1;
    editRequestTokenRef.current = requestToken;
    try {
      const detail = await getWorkflowDefinitionDetail(item.id);
      if (requestToken !== editRequestTokenRef.current) return;
      setEditingItem(item);
      setEditDraft(toDraftFromDetail(detail));
      setEditOpen(true);
    } catch (error) {
      if (requestToken !== editRequestTokenRef.current) return;
      toast.error(`Load workflow detail failed: ${String(error)}`);
    }
  }

  async function onSaveEdit() {
    if (!editingItem) return;

    let payload: ReturnType<typeof buildWorkflowCreatePayload>;
    try {
      payload = buildWorkflowCreatePayload(editDraft);
    } catch (error) {
      toast.error(String(error));
      return;
    }

    setSaving(true);
    try {
      await updateWorkflowDefinition({
        id: editingItem.id,
        ...payload,
      });
      setEditOpen(false);
      setEditingItem(null);
      if (await refresh({ silent: true })) {
        toast.success("Workflow updated.");
      } else {
        toast.error("Workflow updated, but refreshing workflow list failed.");
      }
    } catch (error) {
      toast.error(`Update workflow failed: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(item: WorkflowDefinitionListItem) {
    if (!confirm(`Delete workflow "${item.name}"?`)) return;

    try {
      await deleteWorkflowDefinition(item.id);
      if (await refresh({ silent: true })) {
        toast.success("Workflow deleted.");
      } else {
        toast.error("Workflow deleted, but refreshing workflow list failed.");
      }
    } catch (error) {
      toast.error(`Delete workflow failed: ${String(error)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Workflow Definitions</h2>
            <p className="text-sm text-muted-foreground">
              Define reusable ordered git workflows for project-group automation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>New Workflow</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Create Workflow Definition</DialogTitle>
                  <DialogDescription>
                    Add ordered git steps and configure workflow defaults.
                  </DialogDescription>
                </DialogHeader>
                <WorkflowDraftForm draft={createDraft} onChange={setCreateDraft} />
                <DialogFooter>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setCreateDraft(createEmptyWorkflowDraft())}
                  >
                    Clear
                  </Button>
                  <Button type="button" onClick={() => void onCreate()} disabled={creating}>
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </PanelHeader>
        <PanelBody>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Max Concurrency</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono">{item.id}</TableCell>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>{item.enabled ? "Enabled" : "Disabled"}</TableCell>
                  <TableCell>{item.stepsCount}</TableCell>
                  <TableCell>{item.maxConcurrencyDefault}</TableCell>
                  <TableCell className="font-mono text-xs">{formatDateTime(item.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void startEdit(item)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void onDelete(item)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {loading ? "Loading..." : "No workflows defined yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Workflow Definition</DialogTitle>
            <DialogDescription>
              Update metadata, step order, and built-in step parameters.
            </DialogDescription>
          </DialogHeader>
          <WorkflowDraftForm draft={editDraft} onChange={setEditDraft} />
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void onSaveEdit()} disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
