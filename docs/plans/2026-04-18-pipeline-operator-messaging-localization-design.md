# Pipeline Operator Messaging Localization Design

Date: 2026-04-18
Status: confirmed for implementation

## Context

The runtime, monitoring, and scheduler slices are now largely complete, and the next OpenSpec task is `4.3`: preserve Chinese-first operator messaging for failures, waiting states, and recovery prompts.

The remaining inconsistency is not the overall product language, but a few operator-facing leak points where English still reaches the UI:

- frontend helper validation in `invoke.ts` still throws English-only messages such as `must be an object`
- `main.rs` still returns English strings for some GitLab config guard failures
- the pipeline run monitor still renders some raw remote status strings directly, which can surface values like `running` or `failed`

This slice should remove those last visible English leaks without changing runtime behavior or broadening scope into a full copy review of every internal log line.

## Goals

- make user-facing validation and command errors Chinese-first
- render remote pipeline statuses in Chinese in the run monitor
- keep operator-visible recovery and waiting guidance consistent with the existing Chinese-first pipeline failure envelope
- avoid changing internal scheduler or runtime semantics

## Non-Goals

- translating tracing logs, debug logs, or developer-only console output
- rewriting every historical summary message stored in the database
- redesigning the monitoring or definition-page layouts
- introducing i18n infrastructure or locale switching

## Decision Summary

### 1. Localize operator-facing helper errors at the source

The frontend input normalization helpers in `invoke.ts` should stop throwing English messages.

Instead of:

- `must be an object`
- `must be an array`

they should emit Chinese messages that already fit the existing UX:

- `必须是对象`
- `必须是数组`

This keeps create/update form validation Chinese-first even before any backend command is invoked.

### 2. Remove English GitLab config guard strings from command paths

The `require_cfg(...)` guard in `main.rs` still emits English raw strings for:

- missing config
- mutex poisoning

Those should become Chinese-first because they can surface through UI command failures.

This does not require changing the structured `pipeline_command_error(...)` categories, only the raw strings returned before categorization.

### 3. Translate raw remote status values before rendering

The run monitor currently renders `node.lastRemoteStatus` directly. That can expose GitLab-native English status values such as:

- `running`
- `success`
- `failed`
- `pending`

This slice should add a small frontend mapping helper that converts known remote statuses into Chinese labels while falling back safely for unknown values.

### 4. Prefer targeted normalization over large-scale data rewrites

Some summary fields may still contain legacy English text in older rows or in test fixtures. This slice should not introduce a migration or broad database rewrite.

Instead:

- localize live-rendered status fields through mapping helpers
- keep structured failure envelope fields (`titleZh`, `detailZh`, `suggestionZh`) as the preferred Chinese path
- leave stored historical free-text untouched unless a targeted surface is clearly operator-facing and easy to normalize

## Implementation Notes

The minimal file set is:

- `src/lib/invoke.ts`
- `src-tauri/src/main.rs`
- `src/pages/WorkflowRunsPagePipeline.tsx`
- focused smoke and unit-style coverage in `src/__tests__/smoke.test.tsx`

The runtime and scheduler backend modules should not need behavior changes for this slice.

## Testing Strategy

Add focused coverage for:

- `readCommandErrorMessage(...)` and helper validation paths returning Chinese-first strings
- run monitor rendering Chinese remote status labels instead of raw English values
- existing smoke coverage staying green after the operator-text changes

Rust verification only needs to confirm that command-layer changes did not regress pipeline runtime paths.

## Risks And Mitigations

### Risk: over-translating developer-only text

Mitigation:

- limit the slice to strings that are surfaced in UI messages or operator-visible detail panes
- leave tracing labels and debug output unchanged

### Risk: unknown remote statuses losing meaning

Mitigation:

- use a conservative mapping helper with fallback to the original value when no Chinese label is defined

### Risk: touching too many historical text paths

Mitigation:

- normalize only the known leak points in helper errors, command guards, and directly rendered remote statuses

## Recommended Implementation Order

1. add failing tests for Chinese-first helper and remote-status rendering
2. localize `invoke.ts` helper errors
3. localize `require_cfg(...)` raw command strings in `main.rs`
4. add remote-status label mapping in `WorkflowRunsPagePipeline.tsx`
5. run focused smoke, runtime, and OpenSpec verification
