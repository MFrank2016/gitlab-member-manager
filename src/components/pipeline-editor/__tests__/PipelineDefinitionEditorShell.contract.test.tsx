import * as React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyPipelineDraft } from "@/components/pipeline-editor/draft-model";
import { PipelineDefinitionEditorShell } from "@/components/pipeline-editor/PipelineDefinitionEditorShell";

const triggerSpy = vi.fn();

vi.mock("@/components/pipeline-graph/PipelineGraphEditor", () => ({
  PipelineGraphEditor: () => <div data-testid="mock-pipeline-graph-editor">画布内容</div>,
}));

vi.mock("@/components/ui/tabs", () => {
  return {
    Tabs: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
    TabsList: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
    TabsTrigger: ({
      children,
      onClick,
      value,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      value: string;
    }) => {
      triggerSpy({ value, hasOnClick: typeof onClick === "function" });
      return <button type="button">{children}</button>;
    },
    TabsContent: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
  };
});

describe("PipelineDefinitionEditorShell contract", () => {
  it("does not attach redundant click handlers to tab triggers", () => {
    triggerSpy.mockClear();

    render(
      <PipelineDefinitionEditorShell
        mode="create"
        draft={createEmptyPipelineDraft()}
        managedProjects={[]}
        dirty={false}
        saving={false}
        validating={false}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onValidate={vi.fn()}
      />
    );

    expect(triggerSpy).toHaveBeenCalled();
    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ value: "canvas", hasOnClick: false })
    );
    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ value: "variables", hasOnClick: false })
    );
    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ value: "schedules", hasOnClick: false })
    );
    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ value: "basics", hasOnClick: false })
    );
  });
});
