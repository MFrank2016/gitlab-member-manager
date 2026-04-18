import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type StructuredJsonEditorMode = "structured" | "json";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type StructuredJsonEditorProps = {
  value: unknown;
  onChange: (next: JsonValue) => void;
  testId?: string;
  "data-testid"?: string;
};

type JsonValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";

type EditorNode =
  | {
      id: string;
      kind: "object";
      fields: Array<{
        id: string;
        key: string;
        value: EditorNode;
      }>;
    }
  | {
      id: string;
      kind: "array";
      items: EditorNode[];
    }
  | {
      id: string;
      kind: "string";
      value: string;
    }
  | {
      id: string;
      kind: "number";
      value: string;
    }
  | {
      id: string;
      kind: "boolean";
      value: boolean;
    }
  | {
      id: string;
      kind: "null";
    };

let editorNodeSequence = 0;

function createEditorNodeId() {
  editorNodeSequence += 1;
  return `json-node-${editorNodeSequence}`;
}

function coerceJsonValue(value: unknown): JsonValue {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => coerceJsonValue(item));

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "object") {
    const next: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = coerceJsonValue(item);
    }
    return next;
  }

  return String(value);
}

function detectKind(value: JsonValue): JsonValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function createDefaultJsonValue(kind: JsonValueKind): JsonValue {
  switch (kind) {
    case "object":
      return {};
    case "array":
      return [];
    case "number":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "string":
    default:
      return "";
  }
}

function createEditorNode(value: JsonValue): EditorNode {
  const kind = detectKind(value);

  switch (kind) {
    case "object":
      return {
        id: createEditorNodeId(),
        kind: "object",
        fields: Object.entries(value as Record<string, JsonValue>).map(([key, entryValue]) => ({
          id: createEditorNodeId(),
          key,
          value: createEditorNode(entryValue),
        })),
      };
    case "array":
      return {
        id: createEditorNodeId(),
        kind: "array",
        items: (value as JsonValue[]).map((item) => createEditorNode(item)),
      };
    case "number":
      return {
        id: createEditorNodeId(),
        kind: "number",
        value: String(value),
      };
    case "boolean":
      return {
        id: createEditorNodeId(),
        kind: "boolean",
        value: value as boolean,
      };
    case "null":
      return {
        id: createEditorNodeId(),
        kind: "null",
      };
    case "string":
    default:
      return {
        id: createEditorNodeId(),
        kind: "string",
        value: String(value ?? ""),
      };
  }
}

function serializeEditorNode(node: EditorNode): JsonValue {
  switch (node.kind) {
    case "object": {
      const next: Record<string, JsonValue> = {};
      for (const field of node.fields) {
        if (field.key.trim() === "") continue;
        next[field.key] = serializeEditorNode(field.value);
      }
      return next;
    }
    case "array":
      return node.items.map((item) => serializeEditorNode(item));
    case "number": {
      const parsed = Number(node.value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case "boolean":
      return node.value;
    case "null":
      return null;
    case "string":
    default:
      return node.value;
  }
}

function formatJsonText(value: JsonValue) {
  return JSON.stringify(value, null, 2);
}

function createDefaultEditorNode(kind: JsonValueKind, existingId?: string) {
  const nextNode = createEditorNode(createDefaultJsonValue(kind));
  return existingId ? { ...nextNode, id: existingId } : nextNode;
}

function ValueKindSelect({
  value,
  ariaLabel,
  onChange,
}: {
  value: JsonValueKind;
  ariaLabel: string;
  onChange: (kind: JsonValueKind) => void;
}) {
  return (
    <select
      aria-label={ariaLabel}
      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value as JsonValueKind)}
    >
      <option value="object">对象</option>
      <option value="array">数组</option>
      <option value="string">字符串</option>
      <option value="number">数字</option>
      <option value="boolean">布尔</option>
      <option value="null">空值</option>
    </select>
  );
}

function JsonNodeEditor({
  node,
  onChange,
  root = false,
}: {
  node: EditorNode;
  onChange: (next: EditorNode) => void;
  root?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">{root ? "根值类型" : "值类型"}</span>
        <ValueKindSelect
          value={node.kind}
          ariaLabel={root ? "根值类型" : "值类型"}
          onChange={(kind) => onChange(createDefaultEditorNode(kind, node.id))}
        />
      </div>

      {node.kind === "object" ? (
        <ObjectEditor node={node} onChange={onChange} />
      ) : null}

      {node.kind === "array" ? (
        <ArrayEditor node={node} onChange={onChange} />
      ) : null}

      {node.kind === "string" ? (
        <Input
          aria-label="字符串值"
          value={node.value}
          onChange={(event) => onChange({ ...node, value: event.target.value })}
          placeholder="字符串值"
        />
      ) : null}

      {node.kind === "number" ? (
        <Input
          aria-label="数值"
          type="number"
          value={node.value}
          onChange={(event) => onChange({ ...node, value: event.target.value })}
          placeholder="数值"
        />
      ) : null}

      {node.kind === "boolean" ? (
        <select
          aria-label="布尔值"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={node.value ? "true" : "false"}
          onChange={(event) =>
            onChange({
              ...node,
              value: event.target.value === "true",
            })
          }
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : null}

      {node.kind === "null" ? (
        <span className="text-xs text-muted-foreground">当前值为空。</span>
      ) : null}
    </div>
  );
}

function ObjectEditor({
  node,
  onChange,
}: {
  node: Extract<EditorNode, { kind: "object" }>;
  onChange: (next: EditorNode) => void;
}) {
  function updateField(fieldId: string, updater: (field: Extract<typeof node.fields[number], object>) => typeof node.fields[number]) {
    onChange({
      ...node,
      fields: node.fields.map((field) => (field.id === fieldId ? updater(field) : field)),
    });
  }

  function removeField(fieldId: string) {
    onChange({
      ...node,
      fields: node.fields.filter((field) => field.id !== fieldId),
    });
  }

  function addField() {
    onChange({
      ...node,
      fields: [
        ...node.fields,
        {
          id: createEditorNodeId(),
          key: "",
          value: createDefaultEditorNode("string"),
        },
      ],
    });
  }

  return (
    <div
      data-testid="structured-json-object-editor"
      className="grid gap-2 rounded-md border border-border bg-muted/20 p-3"
    >
      <div data-testid="structured-json-field-list" className="grid gap-2">
        {node.fields.map((field) => (
          <div
            key={field.id}
            data-testid="structured-json-field-row"
            className="grid gap-2 rounded-md border border-border bg-background p-3"
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label="键名"
                value={field.key}
                onChange={(event) =>
                  updateField(field.id, (current) => ({
                    ...current,
                    key: event.target.value,
                  }))
                }
                placeholder="键名"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => removeField(field.id)}
              >
                删除字段
              </Button>
            </div>
            <JsonNodeEditor
              node={field.value}
              onChange={(nextValue) =>
                updateField(field.id, (current) => ({
                  ...current,
                  value: nextValue,
                }))
              }
            />
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={addField}>
        添加字段
      </Button>
    </div>
  );
}

function ArrayEditor({
  node,
  onChange,
}: {
  node: Extract<EditorNode, { kind: "array" }>;
  onChange: (next: EditorNode) => void;
}) {
  function updateItem(itemId: string, nextValue: EditorNode) {
    onChange({
      ...node,
      items: node.items.map((item) => (item.id === itemId ? nextValue : item)),
    });
  }

  function removeItem(itemId: string) {
    onChange({
      ...node,
      items: node.items.filter((item) => item.id !== itemId),
    });
  }

  function addItem() {
    onChange({
      ...node,
      items: [...node.items, createDefaultEditorNode("string")],
    });
  }

  return (
    <div
      data-testid="structured-json-array-editor"
      className="grid gap-2 rounded-md border border-border bg-muted/20 p-3"
    >
      {node.items.map((item, index) => (
        <div
          key={item.id}
          data-testid="structured-json-array-item"
          className="grid gap-2 rounded-md border border-border bg-background p-3"
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>数组项 {index + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => removeItem(item.id)}
            >
              删除项
            </Button>
          </div>
          <JsonNodeEditor node={item} onChange={(nextValue) => updateItem(item.id, nextValue)} />
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={addItem}>
        添加项
      </Button>
    </div>
  );
}

export function StructuredJsonEditor({
  value,
  onChange,
  testId,
  "data-testid": dataTestIdProp,
}: StructuredJsonEditorProps) {
  const dataTestId = dataTestIdProp ?? testId;
  const normalizedValue = React.useMemo(() => coerceJsonValue(value), [value]);
  const normalizedSignature = React.useMemo(() => JSON.stringify(normalizedValue), [normalizedValue]);
  const formattedValue = React.useMemo(() => formatJsonText(normalizedValue), [normalizedSignature]);
  const lastCommittedSignatureRef = React.useRef(normalizedSignature);
  const [mode, setMode] = React.useState<StructuredJsonEditorMode>("structured");
  const [draftRoot, setDraftRoot] = React.useState<EditorNode>(() => createEditorNode(normalizedValue));
  const [jsonText, setJsonText] = React.useState(() => formattedValue);
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (normalizedSignature !== lastCommittedSignatureRef.current) {
      setDraftRoot(createEditorNode(normalizedValue));
      lastCommittedSignatureRef.current = normalizedSignature;
    }

    if (mode === "structured" || jsonError == null) {
      setJsonText(formattedValue);
    }
  }, [formattedValue, jsonError, mode, normalizedSignature]);

  function commitStructuredChange(nextNode: EditorNode) {
    const serialized = serializeEditorNode(nextNode);
    lastCommittedSignatureRef.current = JSON.stringify(serialized);
    setDraftRoot(nextNode);
    onChange(serialized);
  }

  function switchMode(nextMode: StructuredJsonEditorMode) {
    setMode(nextMode);

    if (nextMode === "structured") {
      setDraftRoot(createEditorNode(normalizedValue));
      setJsonError(null);
      setJsonText(formattedValue);
      return;
    }

    setJsonText(formattedValue);
    setJsonError(null);
  }

  return (
    <div data-testid={dataTestId} className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "structured" ? "default" : "secondary"}
          onClick={() => switchMode("structured")}
        >
          结构化模式
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "json" ? "default" : "secondary"}
          onClick={() => switchMode("json")}
        >
          JSON 模式
        </Button>
      </div>

      {mode === "structured" ? (
        <JsonNodeEditor node={draftRoot} onChange={commitStructuredChange} root />
      ) : null}

      {mode === "json" ? (
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span className="text-sm font-medium">高级 JSON</span>
            <textarea
              aria-label="高级 JSON"
              className="min-h-28 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={jsonText}
              onChange={(event) => {
                const nextText = event.target.value;
                setJsonText(nextText);

                try {
                  const parsed = coerceJsonValue(JSON.parse(nextText));
                  lastCommittedSignatureRef.current = JSON.stringify(parsed);
                  onChange(parsed);
                  setJsonError(null);
                } catch {
                  setJsonError("JSON 格式无效，已保留最近一次有效值。");
                }
              }}
            />
          </label>
          {jsonError ? <span className="text-sm text-destructive">{jsonError}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
