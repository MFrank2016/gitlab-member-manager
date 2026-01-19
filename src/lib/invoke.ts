import { invoke } from "@tauri-apps/api/core";
import type {
  BatchResult,
  LocalGroup,
  LocalMember,
  ProjectMember,
  ProjectSummary,
} from "@/lib/types";

export async function setGitLabConfig(baseUrl: string, token: string) {
  return invoke<void>("set_gitlab_config", { baseUrl, token });
}

export async function searchProjects(keyword: string) {
  return invoke<ProjectSummary[]>("search_projects", { keyword });
}

export async function listProjectMembers(project: string) {
  return invoke<ProjectMember[]>("list_project_members", { project });
}

export async function upsertLocalMembers(members: Array<{
  userId: number;
  username: string;
  name: string;
  avatarUrl?: string | null;
}>) {
  return invoke<void>("upsert_local_members", { members });
}

export async function listLocalMembers(query?: string) {
  return invoke<LocalMember[]>("list_local_members", { query });
}

export async function createLocalGroup(name: string) {
  return invoke<LocalGroup>("create_local_group", { name });
}

export async function listLocalGroups() {
  return invoke<LocalGroup[]>("list_local_groups");
}

export async function addMembersToGroup(groupId: number, userIds: number[]) {
  return invoke<void>("add_members_to_group", { groupId, userIds });
}

export async function removeMembersFromGroup(groupId: number, userIds: number[]) {
  return invoke<void>("remove_members_from_group", { groupId, userIds });
}

export async function listGroupMembers(groupId: number) {
  return invoke<LocalMember[]>("list_group_members", { groupId });
}

export async function batchAddMembersToProject(args: {
  project: string;
  userIds: number[];
  accessLevel: number;
  expiresAt?: string | null;
}) {
  return invoke<BatchResult>("batch_add_members_to_project", args);
}

export async function batchRemoveMembersFromProject(args: {
  project: string;
  userIds: number[];
}) {
  return invoke<BatchResult>("batch_remove_members_from_project", args);
}
