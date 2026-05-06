import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createEmptyPipelineDraft,
  type PipelineDraft,
} from "@/components/pipeline-editor/draft-model";
import { PipelineDefinitionEditorShell } from "@/components/pipeline-editor/PipelineDefinitionEditorShell";

vi.mock("@/components/pipeline-graph/PipelineGraphEditor", () => ({
  PipelineGraphEditor: () => <div data-testid="mock-pipeline-graph-editor">画布内容</div>,
}));

function renderShell(
  overrideProps: Partial<React.ComponentProps<typeof PipelineDefinitionEditorShell>> = {}
) {
  const props: React.ComponentProps<typeof PipelineDefinitionEditorShell> = {
    mode: "create",
    draft: createEmptyPipelineDraft(),
    managedProjects: [],
    dirty: false,
    saving: false,
    validating: false,
    onChange: vi.fn(),
    onBack: vi.fn(),
    onSave: vi.fn(),
    onValidate: vi.fn(),
    ...overrideProps,
  };

  render(<PipelineDefinitionEditorShell {...props} />);
  return props;
}

function ShellHarness() {
  const [draft, setDraft] = React.useState<PipelineDraft>(() => createEmptyPipelineDraft());

  return (
    <div className="grid gap-4">
      <pre data-testid="pipeline-draft-json">{JSON.stringify(draft)}</pre>
      <PipelineDefinitionEditorShell
        mode="create"
        draft={draft}
        managedProjects={[]}
        dirty={false}
        saving={false}
        validating={false}
        onChange={setDraft}
        onBack={() => undefined}
        onSave={() => undefined}
        onValidate={() => undefined}
      />
    </div>
  );
}

function parseDraft() {
  const raw = screen.getByTestId("pipeline-draft-json").textContent ?? "";
  return JSON.parse(raw) as PipelineDraft;
}

function activateTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  act(() => {
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  });
}

describe("PipelineDefinitionEditorShell", () => {
  it("defaults to the canvas tab and switches between global configuration tabs", () => {
    renderShell();

    expect(screen.getByRole("tab", { name: "画布" })).toHaveAttribute(
      "data-state",
      "active"
    );

    activateTab("变量");

    expect(screen.getByText("添加变量")).toBeInTheDocument();
  });

  it("triggers toolbar callbacks", () => {
    const props = renderShell();

    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    fireEvent.click(screen.getByRole("button", { name: "校验" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onValidate).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps variable editing semantics through draft and onChange", () => {
    render(<ShellHarness />);

    activateTab("变量");

    fireEvent.click(screen.getByRole("button", { name: "添加变量" }));

    const rows = screen.getAllByTestId("pipeline-variable-row");
    expect(rows).toHaveLength(1);
    const newestRow = rows[rows.length - 1];

    fireEvent.change(within(newestRow).getByLabelText("变量 1 键"), {
      target: { value: "release_branch" },
    });

    const nextDraft = parseDraft();
    expect(nextDraft.variableRows).toHaveLength(1);
    expect(nextDraft.variableRows[0]).toMatchObject({
      key: "release_branch",
      source: "manual",
    });
  });

  it("preserves draft state while switching between editor tabs", () => {
    render(<ShellHarness />);

    activateTab("基础信息");
    fireEvent.change(screen.getByLabelText("流水线名称"), {
      target: { value: "release-mainline" },
    });

    activateTab("变量");
    activateTab("基础信息");

    expect(screen.getByDisplayValue("release-mainline")).toBeInTheDocument();
    expect(parseDraft().name).toBe("release-mainline");
  });
});
