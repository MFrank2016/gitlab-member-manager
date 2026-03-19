import type { ProjectSummary } from "@/lib/types";

export type ManagedProjectOnboardingDefaults = {
  localRepoRoot?: string | null;
  defaultBranch?: string | null;
  defaultRemote?: string | null;
};

export type ManagedProjectDraft = {
  gitlabProjectId: string;
  name: string;
  pathWithNamespace: string;
  repoPath: string;
  defaultBranch: string;
  defaultRemote: string;
  enabled: boolean;
};

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/g, "");
}

function trimLeadingSeparators(value: string): string {
  return value.replace(/^[\\/]+/g, "");
}

export function deriveManagedProjectRepoPath(localRepoRoot: string, projectName: string): string {
  const root = trimTrailingSeparators(normalizeText(localRepoRoot));
  const name = trimLeadingSeparators(normalizeText(projectName));

  if (!root) return name;
  if (!name) return root;

  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${separator}${name}`;
}

export function createManagedProjectDraft(
  defaults: ManagedProjectOnboardingDefaults,
  project: Pick<ProjectSummary, "id" | "name" | "pathWithNamespace"> | null
): ManagedProjectDraft {
  const defaultBranch = normalizeText(defaults.defaultBranch) || "master";
  const defaultRemote = normalizeText(defaults.defaultRemote) || "origin";

  if (!project) {
    return {
      gitlabProjectId: "",
      name: "",
      pathWithNamespace: "",
      repoPath: "",
      defaultBranch,
      defaultRemote,
      enabled: true,
    };
  }

  return {
    gitlabProjectId: String(project.id),
    name: project.name,
    pathWithNamespace: project.pathWithNamespace,
    repoPath: deriveManagedProjectRepoPath(defaults.localRepoRoot ?? "", project.name),
    defaultBranch,
    defaultRemote,
    enabled: true,
  };
}

