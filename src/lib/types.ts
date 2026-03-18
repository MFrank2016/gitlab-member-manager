export type GitLabConfig = {
  baseUrl: string;
  token: string;
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
