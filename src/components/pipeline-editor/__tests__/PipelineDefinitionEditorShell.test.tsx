import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyPipelineDraft } from "@/components/pipeline-editor/draft-model";
import { PipelineDefinitionEditorShell } from "@/components/pipeline-editor/PipelineDefinitionEditorShell";

vi.mock("@/components/pipeline-graph/PipelineGraphEditor", () => ({
  PipelineGraphEditor: () => <div data-testid="mock-pipeline-graph-editor">画布内容</div>,
}));

describe("PipelineDefinitionEditorShell", () => {
  it("defaults to the canvas tab and switches between global configuration tabs", () => {
    render(
      <PipelineDefinitionEditorShell
        mode="create"
        draft={createEmptyPipelineDraft()}
        managedProjects={[]}
        projectGroups={[]}
        dirty={false}
        saving={false}
        validating={false}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onValidate={vi.fn()}
      />
    );

    expect(screen.getByRole("tab", { name: "画布" })).toHaveAttribute(
      "data-state",
      "active"
    );

    fireEvent.click(screen.getByRole("tab", { name: "变量" }));

    expect(screen.getByText("添加变量")).toBeInTheDocument();
  });
});
