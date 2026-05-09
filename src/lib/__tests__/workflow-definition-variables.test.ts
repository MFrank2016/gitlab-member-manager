// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  collectReferencedWorkflowVariables,
  mergeDeclaredWorkflowVariables,
  validateDeclaredWorkflowVariables,
} from "@/lib/workflow-definition-variables";

describe("workflow definition variables", () => {
  it("collects placeholder variables from nested step parameters", () => {
    const variables = collectReferencedWorkflowVariables([
      {
        stepType: "checkout_branch",
        parameters: { branch: "${target_branch}" },
      },
      {
        stepType: "custom",
        parameters: {
          args: ["--from", "${source_branch}", "--flag=${target_branch}"],
          env: {
            PR_TITLE: "merge ${source_branch} into ${target_branch}",
          },
        },
      },
    ]);

    expect(variables).toEqual(["source_branch", "target_branch"]);
  });

  it("adds missing variables with empty-string defaults while preserving existing values", () => {
    const nextVariables = mergeDeclaredWorkflowVariables(
      {
        source_branch: "release/1.2",
      },
      [
        {
          stepType: "checkout_branch",
          parameters: { branch: "${target_branch}" },
        },
        {
          stepType: "git_merge",
          parameters: { from: "${source_branch}" },
        },
      ]
    );

    expect(nextVariables).toEqual({
      source_branch: "release/1.2",
      target_branch: "",
    });
  });

  it("reports missing declarations for referenced variables", () => {
    const missing = validateDeclaredWorkflowVariables(
      {
        source_branch: "",
      },
      [
        {
          stepType: "checkout_branch",
          parameters: { branch: "${target_branch}" },
        },
        {
          stepType: "git_merge",
          parameters: { from: "${source_branch}" },
        },
      ]
    );

    expect(missing).toEqual(["target_branch"]);
  });
});

