export type GitLabConfig = {
  baseUrl: string;
  token: string;
  localRepoRoot?: string | null;
  defaultBranch?: string | null;
  defaultRemote?: string | null;
};

export type ProjectSummary = {
  id: number;
  name: string;
  namespace: string;
  pathWithNamespace: string;
  description?: string | null;
  lastActivityAt: string;
};

export type ProjectMember = {
  id: number;
  username: string;
  name: string;
  avatarUrl?: string | null;
  accessLevel: number;
  createdAt?: string | null;
  expiresAt?: string | null;
};

export type LocalMember = {
  userId: number;
  username: string;
  name: string;
  avatarUrl?: string | null;
  updatedAt: string;
  projectId?: number | null;
  projectName?: string | null;
};

export type LocalGroup = {
  id: number;
  name: string;
  createdAt: string;
  membersCount: number;
};

export type ManagedProject = {
  id: number;
  gitlabProjectId: number;
  name: string;
  pathWithNamespace: string;
  repoPath: string;
  defaultBranch: string;
  defaultRemote: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProjectGroup = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  projectsCount: number;
};

export type WorkflowStepInput = {
  stepType: string;
  parameters?: unknown;
};

export type WorkflowStep = {
  stepOrder: number;
  stepType: string;
  parameters: unknown;
};

export type PipelineVariableInput = {
  key: string;
  label: string;
  defaultValue?: string | null;
  valueType: string;
  required?: boolean;
  options?: unknown;
};

export type PipelineVariable = {
  variableOrder: number;
  key: string;
  label: string;
  defaultValue?: string | null;
  valueType: string;
  required: boolean;
  options: unknown;
};

export type PipelineNodeInput = {
  nodeType: string;
  parameters?: unknown;
};

export type PipelineNode = {
  nodeOrder: number;
  nodeType: string;
  parameters: unknown;
};

export type PipelineScheduleInput = {
  projectGroupId: number;
  cronExpr: string;
  timezone: string;
  branch?: string | null;
  enabled?: boolean;
  policy: string;
  variables?: unknown;
};

export type PipelineSchedule = {
  scheduleOrder: number;
  projectGroupId: number | null;
  cronExpr: string;
  timezone: string;
  branch?: string | null;
  enabled: boolean;
  policy: string;
  variables: unknown;
};

export type PipelineDefinitionListItem = {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  maxConcurrencyDefault: number;
  legacyWorkflowDefinitionId?: number | null;
  createdAt: string;
  updatedAt: string;
  variablesCount: number;
  nodesCount: number;
  schedulesCount: number;
};

export type PipelineDefinitionDetail = {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  maxConcurrencyDefault: number;
  legacyWorkflowDefinitionId?: number | null;
  createdAt: string;
  updatedAt: string;
  variables: PipelineVariable[];
  nodes: PipelineNode[];
  schedules: PipelineSchedule[];
};

export type PipelineRunStatus =
  | "pending"
  | "running"
  | "waiting"
  | "cancelling"
  | "completed"
  | "partial_failed"
  | "cancelled";

export type PipelineRunProjectStatus =
  | "queued"
  | "running"
  | "waiting"
  | "success"
  | "failed"
  | "cancelled"
  | "failed_precheck";

export type PipelineRunNodeStatus =
  | "pending"
  | "running"
  | "waiting"
  | "success"
  | "failed"
  | "skipped"
  | "cancelled";

export type PipelineRunNode = {
  id: number;
  pipelineNodeId?: number | null;
  nodeOrder: number;
  nodeType: string;
  renderedParameters: unknown;
  status: PipelineRunNodeStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  summaryMessage: string;
  errorCode?: string | null;
  titleZh?: string | null;
  detailZh?: string | null;
  suggestionZh?: string | null;
  evidence?: string | null;
  waitTarget?: string | null;
  lastRemoteStatus?: string | null;
  remotePipelineId?: number | null;
  waitContext?: unknown | null;
};

export type PipelineRunProject = {
  id: number;
  managedProjectId?: number | null;
  gitlabProjectId: number;
  projectName: string;
  projectPathWithNamespace: string;
  repoPath: string;
  status: PipelineRunProjectStatus;
  summaryMessage: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  nodes: PipelineRunNode[];
};

export type PipelineRunListItem = {
  id: number;
  pipelineDefinitionId: number;
  pipelineDefinitionName: string;
  projectGroupId: number;
  projectGroupName: string;
  legacyWorkflowRunId?: number | null;
  sourcePipelineRunId?: number | null;
  triggerKind: string;
  status: PipelineRunStatus;
  runParameters: unknown;
  maxConcurrency: number;
  projectsTotal: number;
  projectsQueued: number;
  projectsRunning: number;
  projectsSuccess: number;
  projectsFailed: number;
  projectsCancelled: number;
  projectsFailedPrecheck: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelineRunDetail = PipelineRunListItem & {
  projects: PipelineRunProject[];
};

export type WorkflowDefinitionListItem = {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  variablesSchema: unknown;
  maxConcurrencyDefault: number;
  createdAt: string;
  updatedAt: string;
  stepsCount: number;
};

export type WorkflowDefinitionDetail = {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  variablesSchema: unknown;
  maxConcurrencyDefault: number;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
};

export type WorkflowRunExecuteRequest = {
  workflowDefinitionId: number;
  projectGroupId: number;
  runParameters?: Record<string, unknown>;
  maxConcurrencyOverride?: number | null;
};

export type WorkflowRunExecuteResult = {
  workflowRunId: number;
};

export type WorkflowRunRetryFailedRequest = {
  sourceWorkflowRunId: number;
  selectedManagedProjectIds?: number[] | null;
  maxConcurrencyOverride?: number | null;
};

export type PipelineRunExecuteRequest = {
  pipelineDefinitionId: number;
  projectGroupId: number;
  runParameters?: Record<string, unknown>;
  maxConcurrencyOverride?: number | null;
};

export type PipelineRunExecuteResult = {
  pipelineRunId: number;
};

export type PipelineRunRetryRequest = {
  sourcePipelineRunId: number;
  selectedManagedProjectIds?: number[] | null;
  maxConcurrencyOverride?: number | null;
};

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "cancelling"
  | "completed"
  | "partial_failed"
  | "cancelled";

export type WorkflowRunProjectStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "failed_precheck";

export type WorkflowRunStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "cancelled";

export type WorkflowRunStep = {
  id: number;
  workflowStepId?: number | null;
  stepOrder: number;
  stepType: string;
  renderedParameters: unknown;
  status: WorkflowRunStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  summaryMessage: string;
};

export type WorkflowRunProject = {
  id: number;
  managedProjectId?: number | null;
  gitlabProjectId: number;
  projectName: string;
  projectPathWithNamespace: string;
  repoPath: string;
  status: WorkflowRunProjectStatus;
  summaryMessage: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  steps: WorkflowRunStep[];
};

export type WorkflowRunListItem = {
  id: number;
  workflowDefinitionId: number;
  workflowDefinitionName: string;
  projectGroupId: number;
  projectGroupName: string;
  sourceWorkflowRunId?: number | null;
  triggerKind: string;
  status: WorkflowRunStatus;
  runParameters: unknown;
  maxConcurrency: number;
  projectsTotal: number;
  projectsQueued: number;
  projectsRunning: number;
  projectsSuccess: number;
  projectsFailed: number;
  projectsCancelled: number;
  projectsFailedPrecheck: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunDetail = WorkflowRunListItem & {
  projects: WorkflowRunProject[];
};

export type ProjectGroupMemberSyncRow = {
  managedProjectId: number;
  gitlabProjectId: number;
  projectName: string;
  projectPathWithNamespace: string;
  attemptedUserIds: number[];
  successUserIds: number[];
  failed: BatchItemError[];
  success: boolean;
};

export type BatchItemError = {
  userId: number;
  message: string;
};

export type BatchResult = {
  successUserIds: number[];
  failed: BatchItemError[];
};

export const ACCESS_LEVELS: { label: string; value: number }[] = [
  { label: "Guest (10)", value: 10 },
  { label: "Reporter (20)", value: 20 },
  { label: "Developer (30)", value: 30 },
  { label: "Maintainer (40)", value: 40 },
];

export function accessLevelLabel(level: number): string {
  return ACCESS_LEVELS.find((x) => x.value === level)?.label ?? String(level);
}
