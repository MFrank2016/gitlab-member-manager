import * as React from "react";
import { cn } from "@/lib/utils";

export function CommandBar({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="command-bar"
      className={cn(
        "flex items-center justify-between gap-4 border-b border-border bg-background/80 px-6 py-3 backdrop-blur",
        className
      )}
      {...props}
    />
  );
}

export function CommandBarSection({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="command-bar-section"
      className={cn("flex items-center gap-3", className)}
      {...props}
    />
  );
}

export function CommandBarTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      data-slot="command-bar-title"
      className={cn("text-sm font-semibold uppercase tracking-wide", className)}
      {...props}
    />
  );
}