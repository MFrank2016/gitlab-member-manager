import { describe, expect, it } from "vitest";

import {
  createManagedProjectDraft,
  deriveManagedProjectRepoPath,
} from "@/lib/managed-project-onboarding";

describe("managed project onboarding helpers", () => {
  it("joins the local repo root with the project name without introducing duplicate separators", () => {
    expect(deriveManagedProjectRepoPath("D:/repos/", "api-service")).toBe("D:/repos/api-service");
    expect(deriveManagedProjectRepoPath("D:\\repos\\", "api-service")).toBe("D:\\repos\\api-service");
  });

  it("fills new managed project drafts with selected project data and configured defaults", () => {
    const draft = createManagedProjectDraft(
      {
        localRepoRoot: "D:/repos",
        defaultBranch: "release",
        defaultRemote: "upstream",
      },
      {
        id: 42,
        name: "api-service",
        pathWithNamespace: "team/api-service",
      }
    );

    expect(draft).toEqual({
      gitlabProjectId: "42",
      name: "api-service",
      pathWithNamespace: "team/api-service",
      repoPath: "D:/repos/api-service",
      defaultBranch: "release",
      defaultRemote: "upstream",
      enabled: true,
    });
  });

  it("falls back to master and origin when no project defaults are stored", () => {
    const draft = createManagedProjectDraft({}, null);

    expect(draft.defaultBranch).toBe("master");
    expect(draft.defaultRemote).toBe("origin");
    expect(draft.repoPath).toBe("");
  });
});
