# Command Bar UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the UI into a professional command-bar shell with modular panels, monochrome palette, and GitLab orange accent, using only local assets.

**Architecture:** Keep the React + Vite + Tailwind stack and Tauri invoke flows unchanged. Add new UI primitives (CommandBar, Panel) and refactor pages to consume them. Centralize theme tokens, motion utilities, and local fonts in `globals.css`.

**Tech Stack:** React 18, Vite, Tailwind CSS v4, Radix UI, lucide-react, Tauri.

---

## Prerequisites
- Use @superpowers:using-git-worktrees to create an isolated worktree before implementation.
- Confirm the local font files are available offline (no external fetch).

---

### Task 1: Add a minimal UI test harness

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/__tests__/smoke.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("runs in jsdom", () => {
    expect(document.body).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL with "Missing script: test" or "vitest: not found"

**Step 3: Add minimal test setup**

```json
// package.json (scripts)
"test": "vitest run"
```

```json
// package.json (devDependencies)
"@testing-library/jest-dom": "^6.4.2",
"@testing-library/react": "^14.2.1",
"jsdom": "^24.0.0",
"vitest": "^2.0.0"
```

```ts
// vite.config.ts (add test block)
test: {
  environment: "jsdom",
  globals: true,
  setupFiles: "src/test/setup.ts",
},
```

```ts
// src/test/setup.ts
import "@testing-library/jest-dom";
```

**Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json vite.config.ts src/test/setup.ts src/__tests__/smoke.test.tsx
git commit -m "test: add vitest ui harness"
```

---

### Task 2: Add Panel primitives

**Files:**
- Create: `src/components/ui/panel.tsx`
- Test: `src/components/ui/__tests__/panel.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { Panel, PanelHeader, PanelTitle, PanelBody } from "../panel";

it("renders panel structure", () => {
  render(
    <Panel>
      <PanelHeader>
        <PanelTitle>Members</PanelTitle>
      </PanelHeader>
      <PanelBody>Body</PanelBody>
    </Panel>
  );
  expect(screen.getByText("Members")).toBeInTheDocument();
  expect(screen.getByText("Body")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test src/components/ui/__tests__/panel.test.tsx`
Expected: FAIL with "Cannot find module '../panel'"

**Step 3: Write minimal implementation**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="panel"
      className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", className)}
      {...props}
    />
  );
}

export function PanelHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="panel-header"
      className={cn("flex items-center justify-between gap-3 pb-3", className)}
      {...props}
    />
  );
}

export function PanelTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      data-slot="panel-title"
      className={cn("text-base font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="panel-body" className={cn("space-y-3", className)} {...props} />
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test src/components/ui/__tests__/panel.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/ui/panel.tsx src/components/ui/__tests__/panel.test.tsx
git commit -m "ui: add panel primitives"
```

---

### Task 3: Add CommandBar primitives

**Files:**
- Create: `src/components/ui/command-bar.tsx`
- Test: `src/components/ui/__tests__/command-bar.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { CommandBar, CommandBarSection, CommandBarTitle } from "../command-bar";

it("renders command bar sections", () => {
  render(
    <CommandBar>
      <CommandBarSection>
        <CommandBarTitle>Projects</CommandBarTitle>
      </CommandBarSection>
    </CommandBar>
  );
  expect(screen.getByText("Projects")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test src/components/ui/__tests__/command-bar.test.tsx`
Expected: FAIL with "Cannot find module '../command-bar'"

**Step 3: Write minimal implementation**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function CommandBar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm test src/components/ui/__tests__/command-bar.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/ui/command-bar.tsx src/components/ui/__tests__/command-bar.test.tsx
git commit -m "ui: add command bar primitives"
```

---

### Task 4: Add local fonts, theme tokens, and motion utilities

**Files:**
- Create: `src/assets/fonts/SpaceGrotesk-Regular.woff2`
- Create: `src/assets/fonts/SpaceGrotesk-Medium.woff2`
- Create: `src/assets/fonts/SpaceGrotesk-SemiBold.woff2`
- Modify: `src/styles/globals.css`

**Step 1: Add local font assets**

Place the offline font files in `src/assets/fonts/` (no external downloads).

**Step 2: Add @font-face and theme tokens**

```css
@font-face {
  font-family: "Space Grotesk";
  src: url("/src/assets/fonts/SpaceGrotesk-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

Add tokens:
- `--accent: #FC6D26;`
- `--command-bar-height: 56px;`
- new surface layers for panel/background contrast
- keyframes for `fade-in-up` and `stagger`

**Step 3: Manual verification**

Run: `pnpm dev`
Expected: App loads with new font applied and no console errors.

**Step 4: Commit**

```bash
git add src/assets/fonts src/styles/globals.css
git commit -m "ui: add local font and theme tokens"
```

---

### Task 5: Update shared UI controls for new styling

**Files:**
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/select.tsx`
- Modify: `src/components/ui/table.tsx`
- Modify: `src/components/ui/checkbox.tsx`

**Step 1: Write the failing test**

```tsx
import { render } from "@testing-library/react";
import { Button } from "../button";

it("applies accent focus ring", () => {
  const { getByRole } = render(<Button>Save</Button>);
  expect(getByRole("button").className).toMatch(/ring/);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test src/components/ui/__tests__/button.test.tsx`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```tsx
// button.tsx (class additions)
"transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
```

Update inputs and tables to match the new panel aesthetic:
- inputs: slightly taller, subtle inner shadow
- tables: sticky header background and row hover overlay
- checkboxes: use accent ring and hover

**Step 4: Run test to verify it passes**

Run: `pnpm test src/components/ui/__tests__/button.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/ui/button.tsx src/components/ui/input.tsx src/components/ui/select.tsx src/components/ui/table.tsx src/components/ui/checkbox.tsx src/components/ui/__tests__/button.test.tsx
git commit -m "ui: refresh shared controls"
```

---

### Task 6: Refresh sidebar and app shell layout

**Files:**
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/App.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { Sidebar } from "../sidebar";

it("renders collapsed state", () => {
  render(
    <Sidebar activeTab="settings" onTabChange={() => {}} collapsed onCollapsedChange={() => {}} />
  );
  expect(screen.getByText("GL")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test src/components/ui/__tests__/sidebar.test.tsx`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Update sidebar:
- tighter width range (collapsed/expanded)
- nav items with `data-active` and accent line on active
- add `title` attribute on icons for tooltip fallback

Update app shell:
- replace header with `CommandBar`
- move project context chip into command bar
- apply `panel-grid` layout and background gradient

**Step 4: Run test to verify it passes**

Run: `pnpm test src/components/ui/__tests__/sidebar.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/ui/sidebar.tsx src/App.tsx src/components/ui/__tests__/sidebar.test.tsx
git commit -m "ui: refresh sidebar and app shell"
```

---

### Task 7: Refactor Projects page to panels

**Files:**
- Modify: `src/pages/ProjectsPage.tsx`

**Step 1: Implement layout changes**

- Wrap the search form in a `Panel`
- Use `PanelHeader` for title + description
- Move filters + pagination into a toolbar row
- Apply `Table` inside a bordered panel body

**Step 2: Manual verification**

Run: `pnpm dev`
Expected: Projects page uses panels, table header is sticky, pagination aligned.

**Step 3: Commit**

```bash
git add src/pages/ProjectsPage.tsx
git commit -m "ui: refactor projects page layout"
```

---

### Task 8: Refactor Members page to panels

**Files:**
- Modify: `src/pages/MembersPage.tsx`

**Step 1: Implement layout changes**

- Convert the action bar into a `Panel` with header actions
- Split filters and batch actions into a dedicated toolbar section
- Move members table into its own `Panel`

**Step 2: Manual verification**

Run: `pnpm dev`
Expected: Members page has clear sections and improved hierarchy.

**Step 3: Commit**

```bash
git add src/pages/MembersPage.tsx
git commit -m "ui: refactor members page layout"
```

---

### Task 9: Refactor Local Members page to panels

**Files:**
- Modify: `src/pages/LocalMembersPage.tsx`

**Step 1: Implement layout changes**

- Use `Panel` blocks for import/export and list sections
- Align filters and pagination to match other pages

**Step 2: Manual verification**

Run: `pnpm dev`
Expected: Local members layout matches the new panel system.

**Step 3: Commit**

```bash
git add src/pages/LocalMembersPage.tsx
git commit -m "ui: refactor local members page layout"
```

---

### Task 10: Refactor Groups page to panels

**Files:**
- Modify: `src/pages/GroupsPage.tsx`

**Step 1: Implement layout changes**

- Use `Panel` for group list and actions
- Standardize empty states and toolbar spacing

**Step 2: Manual verification**

Run: `pnpm dev`
Expected: Groups page reads like a cohesive workspace.

**Step 3: Commit**

```bash
git add src/pages/GroupsPage.tsx
git commit -m "ui: refactor groups page layout"
```

---

### Task 11: Refactor Settings page to panels

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

**Step 1: Implement layout changes**

- Use `Panel` for each settings section
- Move primary actions into panel headers

**Step 2: Manual verification**

Run: `pnpm dev`
Expected: Settings page aligns with new design system.

**Step 3: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "ui: refactor settings page layout"
```

---

### Task 12: Final verification

**Files:**
- None (verification only)

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: PASS

**Step 2: Build**

Run: `pnpm run build`
Expected: PASS

**Step 3: Manual visual QA**

- Light/dark parity
- Command bar spacing at narrow widths
- Hover/press/focus states visible

