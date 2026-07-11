# Architect Plan — 建立 2D 網格編輯器基礎 (場地白模產生器 Task 1)

> Story: 場地白模產生器 (階段一) | Task type: FRONTEND | Generated: 2026-07-12T10:30:00+08:00

## Overview

Build a new public `/venue` page hosting a pure client-side 2D grid editor: a DOM/CSS-grid of 1m×1m cells with resize controls (default 10×10m, max 50×50m / 2,500 cells) and a single implicit "paint floor" tool using click-toggle + drag-paint pointer interaction. Shared types and pure helpers go in `src/lib/venue/grid.ts` so Tasks 2–5 (more tools, labels, 3D generation) extend rather than restructure.

## Task Type Confirmed

FRONTEND — consistent with orchestrator-output.md. Zero `/api/*`, database, or persistence involvement. No contradictions found.

## Key Design Decisions (with justification)

1. **Rendering: DOM grid (CSS Grid), not canvas.**
   - Max 2,500 cells is trivially within DOM comfort range; each cell is a single `<div>` with a class swap on state change — React reconciliation at this scale is cheap.
   - Per-cell DOM nodes give free hit-testing for drag-paint (pointer events per cell), free accessibility hooks, and free `data-*` attributes for Playwright assertions — canvas would force manual coordinate math for all three.
   - Task 3's dimension labels compose naturally around a CSS grid (flank it with label rows/columns); a canvas would need its own label drawing.
   - Cell size fixed in px (e.g. 24px per 1m cell) via inline `gridTemplateColumns: repeat(width, 24px)` — inline style is required here because Tailwind cannot express dynamic repeat counts; this is the one sanctioned inline-style spot.

2. **Route: `/venue`** (`src/app/venue/page.tsx`). Verified against `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md` — folder + `page.tsx` default export is unchanged in Next.js 16.2.10. `05-server-and-client-components.md` confirms the `"use client"` boundary convention is unchanged.

3. **Public page — NO `src/proxy.ts` change.** The story imposes no login requirement, so `/venue` is public. `src/proxy.ts`'s `config.matcher` is a static literal `["/api/:path*", "/profile", "/login", "/register"]` — `/venue` is simply not matched, the proxy never runs for it, and it is public by default. **Explicitly: do not touch `src/proxy.ts`** (any edit there is auto-🔴 per AGENTS.md). If a later story decides this feature requires login, that becomes its own auth-adjacent task.

4. **State shape: sparse `Map<string, CellType>`** keyed `"x,y"` (col,row; 0-indexed; key built by a `cellKey(x, y)` helper), where absence = empty.
   - `CellType = "floor"` today, widening to `"floor" | "wall" | "column"` in Task 2 with zero structural change (a 2D array of booleans would need re-typing; a `Set` couldn't hold cell types at all).
   - Resize-clears-everything is `new Map()` — matches the spec's "discard all selections on resize" exactly.
   - Task 4's 3D generator iterates `for y in 0..height, for x in 0..width` and looks up `cells.get(cellKey(x,y))` — deterministic and O(1) per cell.
   - Grid dimensions live separately as `{ widthM: number; heightM: number }` state (meters == cells, 1:1 fixed scale).

5. **Client-component boundary:** `src/app/venue/page.tsx` stays a server component (title/shell only) and renders `<GridEditor />`, which carries `"use client"`. All state, pointer handling, and validation UI live in `GridEditor`. One component file for now — no toolbar/panel split yet (AGENTS.md: don't invent premature patterns; Task 2 introduces the toolbar and will extract what it needs).

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/lib/venue/grid.ts` | Shared types + pure helpers for the whole feature: `CellType` union, `cellKey(x, y)`, `GridSize` type, constants (`DEFAULT_GRID_SIZE = 10`, `MIN_DIMENSION_M = 1`, `MAX_DIMENSION_M = 50`, `MAX_TOTAL_CELLS = 2500`, `CELL_SIZE_PX`), and `validateGridSize(widthInput, heightInput)` returning `{ ok: true; size: GridSize } \| { ok: false; error: string }` with Traditional-Chinese error messages. No React imports — pure functions, reusable by Task 4's 3D generator. |
| `src/components/venue/GridEditor.tsx` | `"use client"` component: grid + resize controls + floor-paint interaction (full behavior in Implementation Steps). |
| `src/app/venue/page.tsx` | Server component page: heading (e.g. 「場地規劃」) + `<GridEditor />`. Optional `metadata` title per existing page conventions. |
| `manual-tests/venue-grid-editor.md` | Manual verification checklist for this feature area (see Test Plan). New top-level `manual-tests/` directory — `supabase/tests/` is auth/API-specific and wrong home for a pure-frontend feature; future frontend feature checklists also go here. |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| — none — | No existing file changes. Explicitly: `src/proxy.ts` untouched (see Decision 3); no nav link added to `src/components/AuthNav.tsx` or the home page (not in scope/acceptance criteria — flag to product if discoverability is wanted later). |

## Implementation Steps

1. **Create `src/lib/venue/grid.ts`** with:
   - `export type CellType = "floor";` (a one-member union, with a comment noting Task 2 widens it to `"floor" | "wall" | "column"`).
   - `export type GridSize = { widthM: number; heightM: number };`
   - Constants: `DEFAULT_GRID_SIZE: GridSize = { widthM: 10, heightM: 10 }`, `MIN_DIMENSION_M = 1`, `MAX_DIMENSION_M = 50`, `MAX_TOTAL_CELLS = 2500`, `CELL_SIZE_PX = 24`.
   - `export function cellKey(x: number, y: number): string` → `` `${x},${y}` ``.
   - `export function validateGridSize(widthInput: string, heightInput: string): { ok: true; size: GridSize } | { ok: false; error: string }` — parse with `Number()`, reject NaN/non-integer/<1 (「寬度與高度必須是至少 1 的整數公尺數」-style message), reject dimension > 50 or width×height > 2,500 (「最大網格為 50m × 50m(2,500 格)」-style message). Reject, don't clamp, per spec ("do not silently clamp… without telling the user").

2. **Create `src/components/venue/GridEditor.tsx`** (`"use client"`), following the state/handler style of `src/app/profile/page.tsx`:
   - State: `size: GridSize` (init `DEFAULT_GRID_SIZE`), `cells: Map<string, CellType>` (init empty `Map`), `widthInput: string` / `heightInput: string` (controlled inputs, init `"10"`), `sizeError: string`.
   - Ref (not state — no re-render needed): `paintModeRef: "floor" | "empty" | null` for the active drag stroke.

3. **Resize controls** (top of component): two labeled numeric text inputs (寬/公尺, 高/公尺) + 「套用尺寸」 button. On submit: call `validateGridSize`; on `ok: false` set `sizeError` (rendered inline, red text, and keep grid at previous valid dimensions); on `ok: true` set `size`, `setCells(new Map())` (full reset per spec), clear `sizeError`.

4. **Grid rendering**: a container `<div>` with `style={{ display: "grid", gridTemplateColumns: repeat(size.widthM, CELL_SIZE_PX px), gridTemplateRows: repeat(size.heightM, CELL_SIZE_PX px) }}`, plus `touch-action: none` (pointer-event drag on touch) and `select-none` (no text-selection during drag). Render `size.heightM × size.widthM` cell `<div>`s (row-major), each with:
   - `key={cellKey(x, y)}`
   - Tailwind classes — empty: `bg-white border border-gray-300` (or `bg-gray-50`); floor: `bg-sky-300 border border-sky-400` (light blue per spec; light theme only — no dark-mode convention exists in this codebase, confirmed assumption in orchestrator-output.md).
   - Playwright hooks: `data-x={x} data-y={y} data-cell-state={"floor" | "empty"}` and the grid container gets `data-testid="venue-grid"`; resize inputs/button and error message get stable `data-testid`s too (`grid-width-input`, `grid-height-input`, `grid-resize-apply`, `grid-size-error`).

5. **Pointer interaction** (per-cell handlers; the generic model Task 2 reuses — Task 2 only changes *what value* gets painted, not the stroke mechanics):
   - Cell `onPointerDown`: `event.preventDefault()`; determine stroke mode from the first cell's current state — `paintModeRef.current = cells.has(key) ? "empty" : "floor"` — then immediately apply it to that cell. This makes a zero-distance click a single clean toggle (edge case: rapid clicking).
   - **Pointer-capture pitfall (must implement)**: browsers implicitly capture the pointer to the `pointerdown` target, which would stop `pointerenter` firing on other cells mid-drag. In `onPointerDown`, call `event.currentTarget.releasePointerCapture(event.pointerId)` (guarded with `hasPointerCapture` check) so enter events flow to sibling cells.
   - Cell `onPointerEnter`: if `paintModeRef.current !== null`, apply that mode to the entered cell (set or delete in a new `Map` copy). Never re-toggle per cell — the mode decided at stroke start applies to every cell entered.
   - Stroke end: grid container `onPointerUp` and `onPointerLeave` both set `paintModeRef.current = null`. Also register a `window`-level `pointerup` listener (in a `useEffect`) as a safety net for release outside the grid. Pointer leaving then re-entering without a new pointerdown does NOT resume painting (mode already nulled) — matches the orchestrator's expected default.
   - Apply helper: `applyPaint(key)` builds `new Map(prev)` then `set(key, "floor")` or `delete(key)` — immutable update so React re-renders only on real changes.

6. **Create `src/app/venue/page.tsx`**: server component exporting default `VenuePage` rendering a page heading and `<GridEditor />`; import via `@/components/venue/GridEditor`. Add `export const metadata = { title: ... }` consistent with existing pages if they do so (developer: check `src/app/login/page.tsx` siblings; if they don't, skip).

7. **Create `manual-tests/venue-grid-editor.md`**: checklist covering every acceptance criterion + edge case (contents listed in Test Plan below).

8. **Verify**: `npm run lint`, `npx tsc --noEmit`, `npm run build` all pass; `npm run dev` and manually run the checklist happy path. No TODOs, no debug logs, no commented-out code.

## Data Flow

```
User input (resize form)         User input (pointer on cells)
        │                                   │
        ▼                                   ▼
validateGridSize (pure, lib)      onPointerDown → decide stroke mode (ref)
   ok? ──no──► sizeError state    onPointerEnter → applyPaint(mode)
   │yes                           onPointerUp/Leave → mode = null
   ▼                                        │
setSize + setCells(new Map())               ▼
        │                     setCells(new Map(prev) ± key)
        └────────────┬──────────────────────┘
                     ▼
        render: width×height cell divs,
        class from cells.get(cellKey(x,y))
```
All state is component-local; nothing leaves the browser. (Task 4 will later consume `size` + `cells` to generate the 3D model — this shape is the contract.)

## Test Plan

No JS unit-test framework exists (per AGENTS.md) — verification is manual checklist now + Playwright at the pipeline's playwright stage.

- **Manual checklist** (`manual-tests/venue-grid-editor.md`), one item per acceptance criterion + edge case from orchestrator-output.md:
  1. Page load → 10×10 grid, all empty.
  2. Resize to valid size (e.g. 20×15) → grid re-renders, prior floor cells cleared.
  3. Resize to smaller than current → all selections discarded.
  4. Resize width 51 / height 51 / 50×51-style >2,500-cell combos → rejected, inline max-size message, grid unchanged.
  5. Resize 0 / negative / non-numeric / decimal → rejected, inline validation message, grid unchanged.
  6. Single click empty cell → light blue floor; single click floor cell → back to empty.
  7. Drag starting on empty cell across mixed cells → all become floor; drag starting on floor cell → all become empty.
  8. Rapid clicking one cell → clean toggles (no double-toggle/no-op).
  9. Pointer up / pointer leaving grid ends stroke; re-entering without new press paints nothing.
  10. Multiple disconnected strokes → non-contiguous shape preserved, no auto-fill/validation.
  11. Reload page → all state gone (no persistence).
- **Playwright (acceptance gate, playwright stage)**: the `data-testid`/`data-x`/`data-y`/`data-cell-state` hooks in step 4 are placed specifically so a page object (`playwright-tests/pages/` pattern) can assert cell states and simulate `mouse.down()/move()/up()` drags. Spec file lands at the playwright stage, not this task's implement stage — but the hooks land now.
- **Unit tests**: none possible (no framework); `validateGridSize` is written as a pure function so it becomes trivially unit-testable the day a framework is added.

## Architecture Notes

- **New feature module layout** established here: `src/lib/venue/` (pure logic/types) + `src/components/venue/` (client components) + `src/app/venue/` (route). Tasks 2–5 add to these three folders (e.g. Task 4: `src/lib/venue/whitebox.ts` consuming `GridSize` + `Map<string, CellType>`).
- **Deviation from "no inline styles" instinct**: dynamic `gridTemplateColumns/Rows` must be inline (Tailwind can't generate dynamic repeat counts). Confined to the grid container.
- **`CellType` as a one-member union** looks odd today but is deliberate — it makes the `Map` value type the extension point Task 2 needs.
- **Performance**: 2,500 divs with immutable `Map` copies per painted cell is fine; each `pointerenter` triggers one state update max. If drag feel ever degrades at 50×50, memoizing rows is the escape hatch — do not pre-optimize now.
- **Numeric limits (50m / 2,500 cells / default 10×10)** kept exactly as the orchestrator set them — no change flagged.
- Colors are Tailwind light-theme only; no dark-mode convention exists in this codebase (checked — nothing else implements one), matching the orchestrator's assumption.

## Security Checklist

- [ ] No hardcoded secrets or credentials (nothing secret exists in this task at all)
- [ ] Input validation implemented at system boundaries — resize inputs validated client-side via `validateGridSize`; this is the only boundary (no server round-trip exists)
- [ ] Auth/permission checks — N/A: intentionally public page; `src/proxy.ts` untouched (verify in review that the diff contains no proxy/auth changes)
- [ ] No sensitive data logged — no logging at all in this task
- [ ] No Supabase client usage anywhere in the new files (feature is 100% client-local; AGENTS.md rule "frontend never calls Supabase directly" trivially satisfied by calling nothing)

## Definition of Done

- [ ] All implementation steps 1–8 complete
- [ ] All 11 manual checklist items written in `manual-tests/venue-grid-editor.md` and the happy path hand-verified against `npm run dev`
- [ ] All 10 acceptance criteria in orchestrator-output.md satisfiable via the checklist
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build` all pass
- [ ] No TODOs, commented-out code, or debug logs
- [ ] `@/*` import alias used throughout; code style matches `src/app/profile/page.tsx` conventions
- [ ] `src/proxy.ts` and all existing files untouched
- [ ] Security checklist passed
