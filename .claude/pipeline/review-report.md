# Code Review Report — 擴充工具列:新增「畫牆壁」「畫柱子」「擦除」工具 (Task 2 of 5)
> Generated: 2026-07-12T15:35:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
Clean, minimal type-widening implementation that follows the architect plan step-for-step with zero deviations. Paint semantics, stroke lock, toolbar radio behavior, colors, and testability attributes all match the spec exactly; lint, tsc, and production build pass, and the unmodified Task 1 Playwright suite is 9/9 green against a live dev server, confirming no floor-behavior regression.

## Verification Detail

### Paint semantics (spec table) — MATCH
`handleCellPointerDown` (GridEditor.tsx:80-88) resolves the mode exactly once per stroke: `eraser → "empty"` (always, idempotent — `next.delete` on absent key is a no-op, covering eraser-on-empty); `current === activeTool → "empty"` (same-type toggle-off; unreachable for eraser since `"eraser"` never equals a `CellType`); otherwise `→ activeTool` (empty-set and different-type overwrite in one branch). `paintModeRef.current = mode` then `applyPaint(key, mode)` — identical lifecycle to Task 1. `handleCellPointerEnter` (91-94) applies the locked mode verbatim with no per-cell re-evaluation; grid pointerup/pointerleave and the window-level pointerup safety net are untouched. Mid-drag tool switching cannot affect an in-flight stroke (mode captured at pointerdown).

### grid.ts — MATCH
`CellType = "floor" | "wall" | "column"`; `Tool = CellType | "eraser"`; `TOOLS: ReadonlyArray<{id, label, testId}>` in the planned order (floor/wall/column/eraser) with the exact labels and `tool-*` testids. Module remains React-free (no React imports; only types + constants). Obsolete Task-2 forward-looking comment removed. `cellKey`, `validateGridSize`, constants unchanged. Empty stays "absent from the Map" — no `"empty"` variant leaked into `CellType`, preserving Task 4's extrusion input model.

### Toolbar — MATCH
Single `activeTool` state gives radio semantics for free (exactly one `aria-pressed="true"` at all times); default `"floor"` on mount (AC1). Buttons: `type="button"`, `data-testid={tool.testId}`, `aria-pressed`, filled-vs-outline styles consistent with 套用尺寸. Clicking the active button calls `setActiveTool` with the identical value — React bails out, natural visual no-op. `role="toolbar"` + `data-testid="venue-toolbar"` present. Order: form → error → toolbar → grid, as planned.

### Colors / data-cell-state — MATCH
`CELL_CLASSES` at module scope with full literal Tailwind strings (v4 scanner-safe): floor `bg-sky-300/border-sky-400` (unchanged from Task 1), wall `bg-amber-700/border-amber-800`, column `bg-gray-500/border-gray-600` (clearly darker than empty's `border-gray-300`), empty unchanged. `data-cell-state` now reports all four states via `cells.get(key) ?? "empty"`.

### Resize behavior — MATCH
`handleResizeSubmit` clears cells (`setCells(new Map())`) and does NOT touch `activeTool` — tool selection persists across resize (last AC).

### Task 1 regression — PASS
`playwright-tests/` has zero diff (spec and page object byte-identical). Re-ran `npx playwright test playwright-tests/venue-grid-editor.spec.ts` against a live dev server: **9/9 passed** with zero spec modifications.

### Build gates — PASS
- `npm run lint` — clean
- `npx tsc --noEmit` — clean
- `npm run build` — succeeds; `/venue` still prerendered static

### Manual checklist — UPDATED
`manual-tests/venue-grid-editor.md` gains a 13-item Task 2 section covering every planned scenario: default tool, radio switching, active-button re-click no-op, per-tool paint colors, same-type toggle, cross-type overwrite, eraser on occupied/empty, per-tool drag stroke lock (incl. eraser over mixed cells), mid-drag toolbar clicks, and resize-keeps-tool.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None.

## 🟡 Should Fix (Auto-resolved by Developer)
None.

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1
- **File**: src/components/venue/GridEditor.tsx:178
- **Issue**: The active toolbar button omits the `hover:bg-[#383838]` hover treatment that the visually identical 套用尺寸 button has. Arguably deliberate (hover feedback on an already-selected radio button is noise), but noting the one-class divergence from the "mirror 套用尺寸" style family for consistency awareness.
- **Impact**: Cosmetic only.

### Suggestion 2
- **File**: src/lib/venue/grid.ts:10
- **Issue**: `TOOLS` is a `ReadonlyArray` (per plan), but its element objects remain mutable. Appending `as const` (or `Readonly<{...}>` elements) would make the metadata fully immutable.
- **Impact**: Theoretical only; no code mutates it.

## Security Assessment
- Secrets scan: PASS (no secrets, tokens, env access, or network calls — purely local UI state)
- Input validation: N/A (only boundary is `validateGridSize`, unchanged)
- Auth/authz: N/A — `src/proxy.ts`, `src/app/api/**`, `src/lib/supabase/**` verified zero diff; no Supabase imports in frontend code
- No new localStorage/persistence introduced
- Test coverage: manual checklist updated (13 new items); Playwright regression 9/9 green; new Playwright coverage scheduled for the playwright stage per plan

## Plan Compliance
- [x] All architect plan steps (1–10) implemented
- [x] Implementation matches plan intent (`VenuePage.ts` additions correctly deferred to the playwright stage per the plan)
- [x] No unauthorised scope additions (only the 3 planned files changed; `page.tsx` untouched as specified)

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| — | No exchanges needed; zero critical or should-fix findings. | — |
