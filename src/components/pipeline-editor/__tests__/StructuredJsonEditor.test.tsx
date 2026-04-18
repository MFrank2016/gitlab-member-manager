import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import { StructuredJsonEditor, type JsonValue } from "../StructuredJsonEditor";

function StructuredJsonEditorHarness({ initialValue }: { initialValue: JsonValue }) {
  const [value, setValue] = useState<JsonValue>(initialValue);

  return (
    <div className="grid gap-3">
      <StructuredJsonEditor value={value} onChange={setValue} data-testid="structured-json-editor" />
      <pre data-testid="current-json">{JSON.stringify(value)}</pre>
    </div>
  );
}

describe("StructuredJsonEditor", () => {
  it("supports nested object and array editing in structured mode", () => {
    render(<StructuredJsonEditorHarness initialValue={{}} />);

    const getEditor = () => screen.getByTestId("structured-json-editor");
    const getRootObject = () =>
      within(getEditor()).getAllByTestId("structured-json-object-editor")[0] as HTMLElement;
    const getDirectChildByTestId = (element: HTMLElement, testId: string) =>
      Array.from(element.children).find(
        (child) => child instanceof HTMLElement && child.dataset.testid === testId
      ) as HTMLElement;
    const getDirectChildRows = (element: HTMLElement, testId: string) =>
      Array.from(element.children).filter(
        (child) => child instanceof HTMLElement && child.dataset.testid === testId
      ) as HTMLElement[];
    const getRootFields = () =>
      getDirectChildRows(getDirectChildByTestId(getRootObject(), "structured-json-field-list"), "structured-json-field-row");
    const clickRootAddField = () => {
      const button = Array.from(getRootObject().children).find(
        (child) => child instanceof HTMLButtonElement
      ) as HTMLButtonElement;
      fireEvent.click(button);
    };

    clickRootAddField();
    fireEvent.change(within(getRootFields()[0]).getByLabelText("键名"), {
      target: { value: "targets" },
    });
    fireEvent.change(within(getRootFields()[0]).getByLabelText("值类型"), {
      target: { value: "array" },
    });

    const targetsArray = within(getRootFields()[0]).getByTestId("structured-json-array-editor");
    fireEvent.click(within(targetsArray).getByRole("button", { name: "添加项" }));

    const getFirstArrayItem = () =>
      within(within(getRootFields()[0]).getByTestId("structured-json-array-editor")).getAllByTestId(
        "structured-json-array-item"
      )[0];

    fireEvent.change(within(getFirstArrayItem()).getByLabelText("值类型"), {
      target: { value: "object" },
    });

    const nestedObject = within(getFirstArrayItem()).getByTestId(
      "structured-json-object-editor"
    ) as HTMLElement;
    fireEvent.click(within(nestedObject).getByRole("button", { name: "添加字段" }));
    const nestedField = getDirectChildRows(
      getDirectChildByTestId(nestedObject, "structured-json-field-list"),
      "structured-json-field-row"
    )[0];
    fireEvent.change(within(nestedField).getByLabelText("键名"), {
      target: { value: "project" },
    });
    fireEvent.change(within(nestedField).getByLabelText("字符串值"), {
      target: { value: "team/service-a" },
    });

    clickRootAddField();
    fireEvent.change(within(getRootFields()[1]).getByLabelText("键名"), {
      target: { value: "retries" },
    });
    fireEvent.change(within(getRootFields()[1]).getByLabelText("值类型"), {
      target: { value: "number" },
    });
    fireEvent.change(within(getRootFields()[1]).getByLabelText("数值"), {
      target: { value: "2" },
    });

    clickRootAddField();
    fireEvent.change(within(getRootFields()[2]).getByLabelText("键名"), {
      target: { value: "notify" },
    });
    fireEvent.change(within(getRootFields()[2]).getByLabelText("值类型"), {
      target: { value: "boolean" },
    });
    fireEvent.change(within(getRootFields()[2]).getByLabelText("布尔值"), {
      target: { value: "true" },
    });

    clickRootAddField();
    fireEvent.change(within(getRootFields()[3]).getByLabelText("键名"), {
      target: { value: "notes" },
    });
    fireEvent.change(within(getRootFields()[3]).getByLabelText("值类型"), {
      target: { value: "null" },
    });

    expect(JSON.parse(screen.getByTestId("current-json").textContent ?? "null")).toEqual({
      targets: [{ project: "team/service-a" }],
      retries: 2,
      notify: true,
      notes: null,
    });
  });

  it("preserves the last valid value across invalid advanced JSON edits", () => {
    render(
      <StructuredJsonEditorHarness
        initialValue={{
          target: { project: "team/service-a" },
          approvals: 2,
        }}
      />
    );

    const editor = screen.getByTestId("structured-json-editor");
    fireEvent.click(within(editor).getByRole("button", { name: "JSON 模式" }));

    fireEvent.change(within(editor).getByLabelText("高级 JSON"), {
      target: {
        value: JSON.stringify(
          {
            target: { project: "team/service-b" },
            approvals: 3,
          },
          null,
          2
        ),
      },
    });

    expect(JSON.parse(screen.getByTestId("current-json").textContent ?? "null")).toEqual({
      target: { project: "team/service-b" },
      approvals: 3,
    });

    fireEvent.change(within(editor).getByLabelText("高级 JSON"), {
      target: { value: '{"target":' },
    });

    expect(within(editor).getByText("JSON 格式无效，已保留最近一次有效值。")).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("current-json").textContent ?? "null")).toEqual({
      target: { project: "team/service-b" },
      approvals: 3,
    });

    fireEvent.click(within(editor).getByRole("button", { name: "结构化模式" }));

    expect(within(editor).getByDisplayValue("target")).toBeInTheDocument();
    expect(within(editor).getByDisplayValue("approvals")).toBeInTheDocument();
    expect(within(editor).getByDisplayValue("3")).toBeInTheDocument();
  });
});
