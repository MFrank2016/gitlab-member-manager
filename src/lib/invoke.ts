import { invoke } from "@tauri-apps/api/core";
import type {
  BatchResult,
  CommandError,
  LocalGroup,
  LocalMember,
  ManagedProject,
  PipelineDefinitionDetail,
  PipelineDefinitionListItem,
  PipelineNodeInput,
  PipelineRunDetail,
  PipelineRunExecuteRequest,
  PipelineRunExecuteResult,
  PipelineRunListPage,
  PipelineRunListQuery,
  PipelineRunNodeDiagnostics,
  PipelineRunRetryRequest,
  PipelineScheduleInput,
  PipelineScheduleRuntimeSnapshot,
  PipelineVariableInput,
  ProjectGroup,
  ProjectGroupMemberSyncRow,
  ProjectMember,
  ProjectSummary,
  WorkflowDefinitionDetail,
  WorkflowDefinitionListItem,
  WorkflowRunDetail,
  WorkflowRunExecuteRequest,
  WorkflowRunExecuteResult,
  WorkflowRunListItem,
  WorkflowRunRetryFailedRequest,
  WorkflowStepInput,
} from "@/lib/types";
import { logger } from "@/lib/logger";

// 敏感字段列表，这些字段在日志中会被脱敏
const SENSITIVE_FIELDS = ["token", "password", "secret", "apiKey"];

/**
 * 脱敏处理参数对象
 */
function sanitizeArgs(args?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!args) return args;
  
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_FIELDS.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = typeof value === "string" ? `***[${value.length}chars]` : "***";
    } else if (Array.isArray(value)) {
      sanitized[key] = `Array(${value.length})`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * 简化结果用于日志输出
 */
function summarizeResult(result: unknown): unknown {
  if (Array.isArray(result)) {
    return { type: "Array", length: result.length };
  }
  if (result === null || result === undefined) {
    return result;
  }
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    // 对于批量操作结果，显示更多信息
    if ("successUserIds" in obj && "failed" in obj) {
      return {
        successCount: (obj.successUserIds as unknown[])?.length ?? 0,
        failedCount: (obj.failed as unknown[])?.length ?? 0,
      };
    }
    return { type: "Object", keys: Object.keys(obj) };
  }
  return result;
}

function normalizeJsonObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${fieldName} must be an object`);
}

function normalizeJsonArray(value: unknown, fieldName: string): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  throw new Error(`${fieldName} must be an array`);
}

/**
 * 带日志的 invoke 包装函数
 */
async function loggedInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  const safeArgs = sanitizeArgs(args);
  
  logger.info(`[invoke] ${cmd}`, safeArgs);
  
  try {
    const result = await invoke<T>(cmd, args);
    const duration = (performance.now() - start).toFixed(2);
    logger.info(`[invoke] ${cmd} success (${duration}ms)`, summarizeResult(result));
    return result;
  } catch (error) {
    const duration = (performance.now() - start).toFixed(2);
    logger.error(`[invoke] ${cmd} failed (${duration}ms)`, error);
    throw error;
  }
}

function readErrorMessage(error: unknown): string | null {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.messageZh === "string" && record.messageZh.trim()) {
      return record.messageZh;
    }
    if (typeof record.message_zh === "string" && record.message_zh.trim()) {
      return record.message_zh;
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }
  return null;
}

export function isCommandError(error: unknown): error is CommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).category === "string" &&
    typeof (error as Record<string, unknown>).messageZh === "string"
  );
}

export function readCommandErrorMessage(error: unknown, fallback: string): string {
  if (isCommandError(error)) {
    return error.messageZh;
  }

  const rawMessage = readErrorMessage(error);
  if (rawMessage) {
    return rawMessage;
  }

  return fallback;
}

export async function getGitLabConfig(): Promise<{
  baseUrl: string;
  token: string;
  localRepoRoot?: string | null;
  defaultBranch?: string | null;
  defaultRemote?: string | null;
} | null> {
  return loggedInvoke<{
    baseUrl: string;
    token: string;
    localRepoRoot?: string | null;
    defaultBranch?: string | null;
    defaultRemote?: string | null;
  } | null>("get_gitlab_config");
}

export async function setGitLabConfig(args: {
  baseUrl: string;
  token: string;
  localRepoRoot?: string | null;
  defaultBranch?: string | null;
  defaultRemote?: string | null;
}) {
  return loggedInvoke<void>("set_gitlab_config", {
    baseUrl: args.baseUrl,
    token: args.token,
    local_repo_root: args.localRepoRoot ?? null,
    default_branch: args.defaultBranch ?? null,
    default_remote: args.defaultRemote ?? null,
  });
}

export async function searchProjects(
  keyword: string,
  page = 1,
  perPage = 20
): Promise<{ items: ProjectSummary[]; total: number }> {
  const [items, total] = await loggedInvoke<[ProjectSummary[], number]>("search_projects", {
    keyword,
    page,
    per_page: perPage,
  });
  return { items, total };
}

export async function listProjectMembers(
  project: string,
  page = 1,
  perPage = 50
): Promise<{ members: ProjectMember[]; total: number }> {
  const [members, total] = await loggedInvoke<[ProjectMember[], number]>("list_project_members", {
    project,
    page,
    per_page: perPage,
  });
  return { members, total };
}

export async function createManagedProject(args: {
  gitlabProjectId: number;
  name: string;
  pathWithNamespace: string;
  repoPath: string;
  defaultBranch?: string | null;
  defaultRemote?: string | null;
  enabled?: boolean;
}) {
  const normalizedDefaultBranch = args.defaultBranch?.trim();
  const normalizedDefaultRemote = args.defaultRemote?.trim();

  return loggedInvoke<ManagedProject>("create_managed_project", {
    gitlab_project_id: args.gitlabProjectId,
    name: args.name,
    path_with_namespace: args.pathWithNamespace,
    repo_path: args.repoPath,
    default_branch: normalizedDefaultBranch ? normalizedDefaultBranch : null,
    default_remote: normalizedDefaultRemote ? normalizedDefaultRemote : null,
    enabled: args.enabled ?? true,
  });
}

export async function listManagedProjects() {
  return loggedInvoke<ManagedProject[]>("list_managed_projects");
}

export async function updateManagedProject(args: {
  id: number;
  gitlabProjectId: number;
  name: string;
  pathWithNamespace: string;
  repoPath: string;
  defaultBranch: string;
  defaultRemote: string;
  enabled: boolean;
}) {
  return loggedInvoke<void>("update_managed_project", {
    id: args.id,
    gitlab_project_id: args.gitlabProjectId,
    name: args.name,
    path_with_namespace: args.pathWithNamespace,
    repo_path: args.repoPath,
    default_branch: args.defaultBranch,
    default_remote: args.defaultRemote,
    enabled: args.enabled,
  });
}

export async function deleteManagedProject(id: number) {
  return loggedInvoke<void>("delete_managed_project", { id });
}

export async function createProjectGroup(name: string) {
  return loggedInvoke<ProjectGroup>("create_project_group", { name });
}

export async function listProjectGroups() {
  return loggedInvoke<ProjectGroup[]>("list_project_groups");
}

export async function updateProjectGroup(id: number, name: string) {
  return loggedInvoke<void>("update_project_group", { id, name });
}

export async function deleteProjectGroup(id: number) {
  return loggedInvoke<void>("delete_project_group", { id });
}

export async function addProjectsToGroup(projectGroupId: number, managedProjectIds: number[]) {
  return loggedInvoke<void>("add_projects_to_group", {
    project_group_id: projectGroupId,
    managed_project_ids: managedProjectIds,
  });
}

export async function removeProjectsFromGroup(projectGroupId: number, managedProjectIds: number[]) {
  return loggedInvoke<void>("remove_projects_from_group", {
    project_group_id: projectGroupId,
    managed_project_ids: managedProjectIds,
  });
}

export async function listProjectGroupProjects(projectGroupId: number) {
  return loggedInvoke<ManagedProject[]>("list_project_group_projects", {
    project_group_id: projectGroupId,
  });
}

function toWorkflowStepPayload(step: WorkflowStepInput) {
  return {
    stepType: step.stepType.trim(),
    parameters: normalizeJsonObject(step.parameters, "workflow step parameters"),
  };
}

function toPipelineNodePayload(node: PipelineNodeInput) {
  return {
    nodeType: node.nodeType.trim(),
    parameters: normalizeJsonObject(node.parameters, "pipeline node parameters"),
  };
}

function toPipelineVariablePayload(variable: PipelineVariableInput) {
  return {
    key: variable.key.trim(),
    label: variable.label.trim(),
    defaultValue: variable.defaultValue ?? null,
    valueType: variable.valueType.trim(),
    required: variable.required ?? false,
    options: normalizeJsonArray(variable.options, "pipeline variable options"),
  };
}

function toPipelineSchedulePayload(schedule: PipelineScheduleInput) {
  return {
    projectGroupId: schedule.projectGroupId,
    cronExpr: schedule.cronExpr.trim(),
    timezone: schedule.timezone.trim(),
    branch: schedule.branch?.trim() ? schedule.branch.trim() : null,
    enabled: schedule.enabled ?? true,
    policy: schedule.policy.trim(),
    variables: normalizeJsonObject(schedule.variables, "pipeline schedule variables"),
  };
}

export async function createWorkflowDefinition(args: {
  name: string;
  description?: string | null;
  enabled?: boolean;
  variablesSchema?: unknown;
  maxConcurrencyDefault?: number;
  steps: WorkflowStepInput[];
}) {
  const normalizedDescription = args.description?.trim();

  return loggedInvoke<WorkflowDefinitionDetail>("create_workflow_definition", {
    name: args.name,
    description: normalizedDescription ?? "",
    enabled: args.enabled ?? true,
    variables_schema: normalizeJsonObject(args.variablesSchema, "variablesSchema"),
    max_concurrency_default: args.maxConcurrencyDefault ?? 2,
    steps: args.steps.map(toWorkflowStepPayload),
  });
}

export async function createPipelineDefinition(args: {
  name: string;
  description?: string | null;
  enabled?: boolean;
  maxConcurrencyDefault?: number;
  variables?: PipelineVariableInput[];
  nodes: PipelineNodeInput[];
  schedules?: PipelineScheduleInput[];
}) {
  const normalizedDescription = args.description?.trim();

  return loggedInvoke<PipelineDefinitionDetail>("create_pipeline_definition", {
    name: args.name,
    description: normalizedDescription ?? "",
    enabled: args.enabled ?? true,
    max_concurrency_default: args.maxConcurrencyDefault ?? 2,
    variables: (args.variables ?? []).map(toPipelineVariablePayload),
    nodes: args.nodes.map(toPipelineNodePayload),
    schedules: (args.schedules ?? []).map(toPipelineSchedulePayload),
  });
}

export async function listWorkflowDefinitions() {
  return loggedInvoke<WorkflowDefinitionListItem[]>("list_workflow_definitions");
}

export async function listPipelineDefinitions() {
  return loggedInvoke<PipelineDefinitionListItem[]>("list_pipeline_definitions");
}

export async function getWorkflowDefinitionDetail(id: number) {
  return loggedInvoke<WorkflowDefinitionDetail>("get_workflow_definition_detail", { id });
}

export async function getPipelineDefinitionDetail(id: number) {
  return loggedInvoke<PipelineDefinitionDetail>("get_pipeline_definition_detail", { id });
}

export async function getPipelineScheduleRuntimeSnapshots(pipelineDefinitionId: number) {
  return loggedInvoke<PipelineScheduleRuntimeSnapshot[]>("get_pipeline_schedule_runtime_snapshots", {
    pipeline_definition_id: pipelineDefinitionId,
  });
}

export async function updateWorkflowDefinition(args: {
  id: number;
  name: string;
  description?: string | null;
  enabled: boolean;
  variablesSchema: unknown;
  maxConcurrencyDefault: number;
  steps: WorkflowStepInput[];
}) {
  const normalizedDescription = args.description?.trim();

  return loggedInvoke<void>("update_workflow_definition", {
    id: args.id,
    name: args.name,
    description: normalizedDescription ?? "",
    enabled: args.enabled,
    variables_schema: normalizeJsonObject(args.variablesSchema, "variablesSchema"),
    max_concurrency_default: args.maxConcurrencyDefault,
    steps: args.steps.map(toWorkflowStepPayload),
  });
}

export async function updatePipelineDefinition(args: {
  id: number;
  name: string;
  description?: string | null;
  enabled: boolean;
  maxConcurrencyDefault: number;
  variables: PipelineVariableInput[];
  nodes: PipelineNodeInput[];
  schedules: PipelineScheduleInput[];
}) {
  const normalizedDescription = args.description?.trim();

  return loggedInvoke<void>("update_pipeline_definition", {
    id: args.id,
    name: args.name,
    description: normalizedDescription ?? "",
    enabled: args.enabled,
    max_concurrency_default: args.maxConcurrencyDefault,
    variables: args.variables.map(toPipelineVariablePayload),
    nodes: args.nodes.map(toPipelineNodePayload),
    schedules: args.schedules.map(toPipelineSchedulePayload),
  });
}

export async function deleteWorkflowDefinition(id: number) {
  return loggedInvoke<void>("delete_workflow_definition", { id });
}

export async function deletePipelineDefinition(id: number) {
  return loggedInvoke<void>("delete_pipeline_definition", { id });
}

export async function listWorkflowRuns() {
  return loggedInvoke<WorkflowRunListItem[]>("list_workflow_runs");
}

export async function listPipelineRuns(query: PipelineRunListQuery = {}) {
  return loggedInvoke<PipelineRunListPage>("list_pipeline_runs", {
    query: {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      status: query.status ?? null,
      pipelineDefinitionId: query.pipelineDefinitionId ?? null,
      projectGroupId: query.projectGroupId ?? null,
    },
  });
}

export async function executePipelineRun(request: PipelineRunExecuteRequest) {
  return loggedInvoke<PipelineRunExecuteResult>("execute_pipeline_run", {
    request: {
      pipelineDefinitionId: request.pipelineDefinitionId,
      projectGroupId: request.projectGroupId,
      runParameters: normalizeJsonObject(request.runParameters, "runParameters"),
      maxConcurrencyOverride: request.maxConcurrencyOverride ?? null,
    },
  });
}

export async function cancelPipelineRun(pipelineRunId: number) {
  return loggedInvoke<void>("cancel_pipeline_run", {
    pipeline_run_id: pipelineRunId,
  });
}

export async function retryPipelineRun(request: PipelineRunRetryRequest) {
  return loggedInvoke<PipelineRunExecuteResult>("retry_pipeline_run", {
    request: {
      sourcePipelineRunId: request.sourcePipelineRunId,
      selectedManagedProjectIds: request.selectedManagedProjectIds ?? null,
      maxConcurrencyOverride: request.maxConcurrencyOverride ?? null,
    },
  });
}

export async function executeWorkflowRun(request: WorkflowRunExecuteRequest) {
  return loggedInvoke<WorkflowRunExecuteResult>("execute_workflow_run", {
    request: {
      workflowDefinitionId: request.workflowDefinitionId,
      projectGroupId: request.projectGroupId,
      runParameters: normalizeJsonObject(request.runParameters, "runParameters"),
      maxConcurrencyOverride: request.maxConcurrencyOverride ?? null,
    },
  });
}

export async function cancelWorkflowRun(workflowRunId: number) {
  return loggedInvoke<void>("cancel_workflow_run", {
    workflow_run_id: workflowRunId,
  });
}

export async function retryFailedWorkflowRun(request: WorkflowRunRetryFailedRequest) {
  return loggedInvoke<WorkflowRunExecuteResult>("retry_failed_workflow_run", {
    request: {
      sourceWorkflowRunId: request.sourceWorkflowRunId,
      selectedManagedProjectIds: request.selectedManagedProjectIds ?? null,
      maxConcurrencyOverride: request.maxConcurrencyOverride ?? null,
    },
  });
}

export async function getWorkflowRunDetail(id: number) {
  return loggedInvoke<WorkflowRunDetail>("get_workflow_run_detail", { id });
}

export async function getPipelineRunDetail(id: number) {
  return loggedInvoke<PipelineRunDetail>("get_pipeline_run_detail", { id });
}

export async function getPipelineRunNodeDiagnostics(id: number) {
  return loggedInvoke<PipelineRunNodeDiagnostics>("get_pipeline_run_node_diagnostics", { id });
}

export async function syncProjectGroupMembers(args: {
  projectGroupId: number;
  sourceLocalGroupId?: number | null;
  selectedUserIds?: number[];
  accessLevel: number;
  expiresAt?: string | null;
}) {
  const normalizedExpiresAt = args.expiresAt?.trim();

  return loggedInvoke<ProjectGroupMemberSyncRow[]>("sync_project_group_members", {
    project_group_id: args.projectGroupId,
    source_local_group_id: args.sourceLocalGroupId ?? null,
    selected_user_ids: args.selectedUserIds ?? [],
    access_level: args.accessLevel,
    expires_at: normalizedExpiresAt ? normalizedExpiresAt : null,
  });
}

export async function upsertLocalMembers(members: Array<{
  userId: number;
  username: string;
  name: string;
  avatarUrl?: string | null;
  projectId?: number | null;
  projectName?: string | null;
}>) {
  return loggedInvoke<void>("upsert_local_members", { members });
}

export async function listLocalMembers(
  query?: string | null,
  page = 1,
  perPage = 50
): Promise<{ items: LocalMember[]; total: number }> {
  const [items, total] = await loggedInvoke<[LocalMember[], number]>("list_local_members", {
    query: query && query.trim() ? query.trim() : null,
    page,
    per_page: perPage,
  });
  return { items, total };
}

export async function deleteLocalMembers(userIds: number[]) {
  return loggedInvoke<void>("delete_local_members", { user_ids: userIds });
}

export async function createLocalGroup(name: string) {
  return loggedInvoke<LocalGroup>("create_local_group", { name });
}

export async function listLocalGroups() {
  return loggedInvoke<LocalGroup[]>("list_local_groups");
}

export async function updateLocalGroup(id: number, name: string) {
  return loggedInvoke<void>("update_local_group", { id, name });
}

export async function deleteLocalGroup(id: number) {
  return loggedInvoke<void>("delete_local_group", { id });
}

export async function addMembersToGroup(groupId: number, userIds: number[]) {
  return loggedInvoke<void>("add_members_to_group", {
    group_id: groupId,
    user_ids: userIds,
  });
}

export async function removeMembersFromGroup(groupId: number, userIds: number[]) {
  return loggedInvoke<void>("remove_members_from_group", {
    group_id: groupId,
    user_ids: userIds,
  });
}

export async function listGroupMembers(groupId: number) {
  return loggedInvoke<LocalMember[]>("list_group_members", { group_id: groupId });
}

export async function batchAddMembersToProject(args: {
  project: string;
  userIds: number[];
  accessLevel: number;
  expiresAt?: string | null;
}) {
  const normalizedExpiresAt = args.expiresAt?.trim();

  return loggedInvoke<BatchResult>("batch_add_members_to_project", {
    project: args.project,
    user_ids: args.userIds,
    access_level: args.accessLevel,
    expires_at: normalizedExpiresAt ? normalizedExpiresAt : null,
  });
}

export async function addMemberToProject(args: {
  project: string;
  userId: number;
  accessLevel: number;
  expiresAt?: string | null;
}) {
  // 注意：Tauri command 参数名会按 camelCase 进行匹配（例如 user_ids -> userIds）
  const normalizedExpiresAt = args.expiresAt?.trim();
  return loggedInvoke<void>("add_member_to_project", {
    project: args.project,
    user_id: args.userId,
    access_level: args.accessLevel,
    expires_at: normalizedExpiresAt ? normalizedExpiresAt : null,
  });
}

export async function batchRemoveMembersFromProject(args: {
  project: string;
  userIds: number[];
}) {
  return loggedInvoke<BatchResult>("batch_remove_members_from_project", {
    project: args.project,
    user_ids: args.userIds,
  });
}
