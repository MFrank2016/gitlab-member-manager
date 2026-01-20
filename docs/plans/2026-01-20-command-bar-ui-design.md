# Command Bar UI Redesign (Monochrome + GitLab Orange)

Date: 2026-01-20
Status: Approved (brainstorming sign-off)

## Context
The current UI is clean but flat. We want a more professional, data-centric workspace
without changing the underlying data flow or Tauri invoke behavior.

## Goals
- Establish a bold, professional shell with a top command bar and modular panels.
- Improve hierarchy and scanability for data-heavy pages.
- Keep monochrome aesthetic with a single GitLab orange accent.
- Add medium motion to improve perceived quality without distraction.
- Preserve light and dark mode parity.
- Stay fully offline (no external font/CDN usage).

## Non-goals
- No backend behavior changes.
- No new feature workflows beyond UI restructuring.

## Visual System
- Palette: grayscale surfaces with GitLab orange accent (#FC6D26).
- Surfaces: layered depth via subtle gradients in the app shell and solid card panels.
- Accent usage: focus rings, primary buttons, selected states, key highlights only.
- Borders: thin neutral borders; slightly higher contrast in dark mode.

## Typography
- Use a clean grotesk font bundled locally via @font-face.
- Fallback to a system sans stack if the font fails to load.
- Apply slightly tighter tracking for headers; keep body size readable.

## Layout
- App Shell: compact sidebar + top command bar + content area.
- Command Bar: global context on left, filters/search in center, primary actions on right.
- Content: stacked modular panels with clear headers and scoped actions.
- Tables: sticky headers, aligned columns, mono font for IDs/dates.

## Components
- CommandBar: host project context, filters, quick actions, status chip.
- Panel: card container with PanelHeader (title + subtitle + actions).
- ToolbarGroup: grouped actions with tight spacing and dividers.
- DataTable: table with sticky head, hover highlight, empty state slot.
- EmptyState: contextual empty copy and optional action button.

## Interaction and Motion
- Page load: command bar and panels fade/slide in with staggered timing.
- Hover: rows highlight; buttons lift slightly and brighten.
- Press: subtle scale down for buttons (short duration).
- Focus: GitLab orange ring for all interactive controls.

## Dark Mode
- Slightly lifted panel surfaces versus background.
- Borders and dividers increase contrast to avoid muddy separation.
- Accent remains GitLab orange for consistency.

## Error and State Handling
- Inline error text near relevant action areas.
- Disabled buttons during loading to prevent duplicate actions.
- Empty states distinguish between "not loaded", "no results", and "no match".

## Implementation Notes
- Add local font files under a repo folder (e.g., `src/assets/fonts/`).
- Define new CSS variables for panel elevation, command bar height, and accent.
- Introduce `CommandBar`, `Panel`, and layout primitives under `src/components/ui/`.
- Refactor each page to use the panel layout and toolbar patterns.

## Validation Checklist
- Light/dark parity looks consistent.
- Command bar layout remains readable at narrow widths.
- Focus and hover states are visible and accessible.
- Table sticky headers and pagination remain functional.
