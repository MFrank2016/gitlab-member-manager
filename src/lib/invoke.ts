import { invoke } from "@tauri-apps/api/core";
import type {
  BatchResult,
  LocalGroup,
  LocalMember,
  ProjectMember,
  ProjectSummary,
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

export async function setGitLabConfig(baseUrl: string, token: string) {
  return loggedInvoke<void>("set_gitlab_config", { baseUrl, token });
}

export async function searchProjects(keyword: string) {
  return loggedInvoke<ProjectSummary[]>("search_projects", { keyword });
}

export async function listProjectMembers(project: string) {
  return loggedInvoke<ProjectMember[]>("list_project_members", { project });
}

export async function upsertLocalMembers(members: Array<{
  userId: number;
  username: string;
  name: string;
  avatarUrl?: string | null;
}>) {
  return loggedInvoke<void>("upsert_local_members", { members });
}

export async function listLocalMembers(query?: string) {
  return loggedInvoke<LocalMember[]>("list_local_members", { query });
}

export async function createLocalGroup(name: string) {
  return loggedInvoke<LocalGroup>("create_local_group", { name });
}

export async function listLocalGroups() {
  return loggedInvoke<LocalGroup[]>("list_local_groups");
}

export async function addMembersToGroup(groupId: number, userIds: number[]) {
  return loggedInvoke<void>("add_members_to_group", { groupId, userIds });
}

export async function removeMembersFromGroup(groupId: number, userIds: number[]) {
  return loggedInvoke<void>("remove_members_from_group", { groupId, userIds });
}

export async function listGroupMembers(groupId: number) {
  return loggedInvoke<LocalMember[]>("list_group_members", { groupId });
}

export async function batchAddMembersToProject(args: {
  project: string;
  userIds: number[];
  accessLevel: number;
  expiresAt?: string | null;
}) {
  return loggedInvoke<BatchResult>("batch_add_members_to_project", args);
}

export async function batchRemoveMembersFromProject(args: {
  project: string;
  userIds: number[];
}) {
  return loggedInvoke<BatchResult>("batch_remove_members_from_project", args);
}
