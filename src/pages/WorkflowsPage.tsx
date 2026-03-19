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
    label: "切换分支",
    fields: [{ key: "branch", label: "分支", placeholder: "${source_branch}" }],
    defaults: { branch: "${source_branch}" },
  },
  {
    value: "git_pull",
    label: "拉取分支",
    fields: [{ key: "branch", label: "分支", placeholder: "${target_branch}" }],
    defaults: { branch: "${target_branch}" },
  },
  {
    value: "git_merge",
    label: "合并分支",
    fields: [{ key: "from", label: "来源分支", placeholder: "${source_branch}" }],
    defaults: { from: "${source_branch}" },
  },
  {
    value: "git_push",
    label: "推送分支",
    fields: [{ key: "remote", label: "远程", placeholder: "origin" }],
    defaults: { remote: "origin" },
  },
];

const BUILTIN_STEP_MAP = new Map(BUILTIN_STEP_TYPES.map((item) => [item.value, item]));

function workflowStepTypeLabel(stepType: string) {
  return BUILTIN_STEP_MAP.get(stepType)?.label ?? stepType;
}

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
    throw new Error(`${fieldName} 必须是合法的 JSON。`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${fieldName} 必须是 JSON 对象。`);
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
    throw new Error("至少需要一个工作流步骤。");
  }

  return steps.map((step, index) => {
    const stepType = step.stepType.trim();
    if (!stepType) {
      throw new Error(`步骤 ${index + 1} 的类型不能为空。`);
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
        <Label>名称</Label>
        <Input
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="工作流名称"
        />
      </div>

      <div className="grid gap-1">
        <Label>描述</Label>
        <Input
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          placeholder="可选描述"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <Label>默认最大并发数</Label>
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
          启用
        </label>
      </div>

      <div className="grid gap-1">
        <Label>变量结构（JSON 对象）</Label>
        <textarea
          className="min-h-24 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={draft.variablesSchemaText}
          onChange={(event) => onChange({ ...draft, variablesSchemaText: event.target.value })}
        />
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <Label>工作流步骤</Label>
          <Button type="button" size="sm" variant="secondary" onClick={addStep}>
            添加步骤
          </Button>
        </div>

        {draft.steps.map((step, index) => {
          const builtin = BUILTIN_STEP_MAP.get(step.stepType);
          const hasCustomOption = Boolean(step.stepType) && !builtin;

          return (
            <div key={step.id} className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">步骤 {index + 1}</h4>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    aria-label={`步骤 ${index + 1} 上移`}
                  >
                    上移
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === draft.steps.length - 1}
                    aria-label={`步骤 ${index + 1} 下移`}
                  >
                    下移
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => removeStep(index)}
                    aria-label={`删除步骤 ${index + 1}`}
                    disabled={draft.steps.length <= 1}
                  >
                    删除
                  </Button>
                </div>
              </div>

              <div className="grid gap-1">
                <Label>步骤类型</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={step.stepType}
                  onChange={(event) => updateStepType(index, event.target.value)}
                  aria-label={`步骤 ${index + 1} 类型`}
                >
                  {BUILTIN_STEP_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                  {hasCustomOption && (
                    <option value={step.stepType}>{workflowStepTypeLabel(step.stepType)}</option>
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
                        aria-label={`步骤 ${index + 1} ${field.label}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-1">
                  <Label>参数（JSON 对象）</Label>
                  <textarea
                    className="min-h-24 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={step.customParametersText}
                    onChange={(event) => updateCustomText(index, event.target.value)}
                    aria-label={`步骤 ${index + 1} 参数 JSON`}
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
    throw new Error("工作流名称不能为空。");
  }

  const maxConcurrencyDefault = Number(draft.maxConcurrencyDefault);
  if (!Number.isInteger(maxConcurrencyDefault) || maxConcurrencyDefault < 1) {
    throw new Error("默认最大并发数必须是大于等于 1 的整数。");
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
        toast.error(`加载工作流失败：${String(error)}`);
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
        toast.success("工作流已创建。");
      } else {
        toast.error("工作流已创建，但刷新工作流列表失败。");
      }
    } catch (error) {
      toast.error(`创建工作流失败：${String(error)}`);
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
      toast.error(`加载工作流详情失败：${String(error)}`);
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
        toast.success("工作流已更新。");
      } else {
        toast.error("工作流已更新，但刷新工作流列表失败。");
      }
    } catch (error) {
      toast.error(`更新工作流失败：${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(item: WorkflowDefinitionListItem) {
    if (!confirm(`确定删除工作流“${item.name}”吗？`)) return;

    try {
      await deleteWorkflowDefinition(item.id);
      if (await refresh({ silent: true })) {
        toast.success("工作流已删除。");
      } else {
        toast.error("工作流已删除，但刷新工作流列表失败。");
      }
    } catch (error) {
      toast.error(`删除工作流失败：${String(error)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">工作流定义</h2>
            <p className="text-sm text-muted-foreground">
              为项目分组自动化定义可复用的有序 Git 工作流。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
              刷新
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>新建工作流</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>新建工作流定义</DialogTitle>
                  <DialogDescription>
                    添加有序的 Git 步骤，并配置工作流默认值。
                  </DialogDescription>
                </DialogHeader>
                <WorkflowDraftForm draft={createDraft} onChange={setCreateDraft} />
                <DialogFooter>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setCreateDraft(createEmptyWorkflowDraft())}
                  >
                    清空
                  </Button>
                  <Button type="button" onClick={() => void onCreate()} disabled={creating}>
                    创建
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
                <TableHead>名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>步骤数</TableHead>
                <TableHead>最大并发</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono">{item.id}</TableCell>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>{item.enabled ? "启用" : "禁用"}</TableCell>
                  <TableCell>{item.stepsCount}</TableCell>
                  <TableCell>{item.maxConcurrencyDefault}</TableCell>
                  <TableCell className="font-mono text-xs">{formatDateTime(item.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void startEdit(item)}>
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void onDelete(item)}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {loading ? "加载中..." : "暂无工作流定义。"}
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
            <DialogTitle>编辑工作流定义</DialogTitle>
            <DialogDescription>
              更新元数据、步骤顺序以及内置步骤参数。
            </DialogDescription>
          </DialogHeader>
          <WorkflowDraftForm draft={editDraft} onChange={setEditDraft} />
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={() => void onSaveEdit()} disabled={saving}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
