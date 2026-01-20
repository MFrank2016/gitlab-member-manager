import * as React from "react";
import { ChevronsUpDown, Check } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProjectSummary } from "@/lib/types";
import { searchProjects } from "@/lib/invoke";

type Props = {
  value: ProjectSummary | null;
  onChange: (p: ProjectSummary | null) => void;
  placeholder?: string;
};

function isDigits(s: string) {
  return /^\d+$/.test(s);
}

export function ProjectCombobox({ value, onChange, placeholder }: Props) {
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<ProjectSummary[]>([]);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const hoverRef = React.useRef(false);

  React.useEffect(() => {
    if (!panelOpen) return;
    const q = query.trim();
    if (!q) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchProjects(q, 1, 30);
        if (!cancelled) setItems(res.items);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [panelOpen, query]);

  const q = query.trim();
  const showDirectId = q && isDigits(q);
  const formatProject = (p: ProjectSummary) =>
    `ID：${p.id}，空间：${p.namespace}，项目名：${p.name}`;
  const displayValue = panelOpen ? query : query || (value ? formatProject(value) : "");

  return (
    <div className="relative w-full">
      <Input
        className="pr-8 w-full"
        value={displayValue}
        onFocus={() => {
          setPanelOpen(true);
          if (!query && value) setQuery(formatProject(value));
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setPanelOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => {
            if (!hoverRef.current) setPanelOpen(false);
          }, 100);
        }}
        placeholder={placeholder ?? "输入项目名，模糊查询"}
      />
      <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />

      {panelOpen && (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md"
          onMouseEnter={() => {
            hoverRef.current = true;
          }}
          onMouseLeave={() => {
            hoverRef.current = false;
            setPanelOpen(false);
          }}
        >
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">输入后暂停 1 秒自动搜索</div>
          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="py-6 text-center text-sm text-muted-foreground">搜索中...</div>
            )}

            {!loading && showDirectId && (
              <button
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent focus:outline-none"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const pseudo: ProjectSummary = {
                    id: Number(q),
                    name: "",
                    namespace: "",
                    pathWithNamespace: `#${q}`,
                    description: null,
                    lastActivityAt: "",
                  };
                  onChange(pseudo);
                  setQuery(formatProject(pseudo));
                  setPanelOpen(false);
                }}
              >
                <Check
                  className={cn("mt-0.5 h-4 w-4 shrink-0", value?.id === Number(q) ? "opacity-100" : "opacity-0")}
                />
                <div className="text-sm font-medium">使用项目ID：{q}</div>
              </button>
            )}

            {!loading && items.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">无结果</div>
            )}

            {!loading &&
              items.map((p) => {
                const selected = value?.id === p.id;
                return (
                  <button
                    key={p.id}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent focus:outline-none"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(p);
                      setQuery(formatProject(p));
                      setPanelOpen(false);
                    }}
                  >
                    <Check className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
                    <div className="text-sm font-medium">
                      ID：{p.id}，空间：{p.namespace}，项目名：{p.name}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
