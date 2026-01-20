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
