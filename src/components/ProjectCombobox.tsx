import * as React from "react";
import { ChevronsUpDown, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<ProjectSummary[]>([]);

  React.useEffect(() => {
    if (!open) return;
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
        const res = await searchProjects(q);
        if (!cancelled) setItems(res);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, query]);

  const q = query.trim();
  const showDirectId = q && isDigits(q);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value ? value.pathWithNamespace : placeholder ?? "输入项目名或ID"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="输入关键字搜索项目..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{loading ? "搜索中..." : "无结果"}</CommandEmpty>

            {showDirectId && (
              <CommandGroup heading="Direct">
                <CommandItem
                  value={q}
                  onSelect={() => {
                    const pseudo: ProjectSummary = {
                      id: Number(q),
                      name: "",
                      namespace: "",
                      pathWithNamespace: `#${q}`,
                      description: null,
                      lastActivityAt: "",
                    };
                    onChange(pseudo);
                    setOpen(false);
                  }}
                >
                  使用项目ID：<span className="font-mono ml-2">{q}</span>
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading="Projects">
              {items.map((p) => {
                const selected = value?.id === p.id;
                return (
                  <CommandItem
                    key={p.id}
                    value={String(p.id)}
                    onSelect={() => {
                      onChange(p);
                      setOpen(false);
                    }}
                    className="flex items-start gap-2"
                  >
                    <Check
                      className={cn(
                        "mt-0.5 h-4 w-4",
                        selected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col gap-0.5">
                      <div className="text-sm font-medium">
                        {p.pathWithNamespace}{" "}
                        <span className="text-muted-foreground">(#{p.id})</span>
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {p.description ?? ""}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
