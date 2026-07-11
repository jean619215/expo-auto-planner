# Architect Plan — 擴充工具列:新增「畫牆壁」「畫柱子」「擦除」工具

> Story: 場地白模產生器 (階段一) | Task type: FRONTEND | Task 2 of 5 | Generated: 2026-07-12T14:30:00+08:00

## Overview

Widen the pure grid module's `CellType` to `"floor" | "wall" | "column"`, add a shared `Tool` type (`CellType | "eraser"`), and extend `GridEditor.tsx` with a 4-button radio-style toolbar plus a generalized `paintModeRef` stroke lock — the locked stroke action becomes "set to type X" or "clear to empty", resolved once from the first cell and the active tool. Purely client-side; no API, proxy, or auth changes.

## Task Type Confirmed

FRONTEND — confirmed. No route handlers, no `src/proxy.ts` changes (`/venue` is already a public page from Task 1), no Supabase involvement.

## Files to Create

| File path | Purpose |
| --------- | ------- |
| _None_    | All changes extend existing Task 1 files. |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/lib/venue/grid.ts` | Widen `CellType` to `"floor" \| "wall" \| "column"`; add shared `Tool` type and a `TOOLS` metadata array (id, Chinese label, testid). Stays React-free. |
| `src/components/venue/GridEditor.tsx` | Add `activeTool` state + toolbar UI (4 buttons above the grid); generalize `PaintMode`, `applyPaint`, and `handleCellPointerDown` to the semantics table; per-type cell colors; `data-cell-state` reflects all four states. |
| `manual-tests/venue-grid-editor.md` | Append Task 2 checklist items (tool switching, per-tool paint/toggle/overwrite, eraser, drag lock, resize keeps tool). |
| `playwright-tests/pages/VenuePage.ts` | Add tool-button locators, `selectTool()`, and per-type cell-count helpers (done at the playwright stage; listed here so the page object plan is agreed up front). |

`src/app/venue/page.tsx` needs **no change** — the toolbar lives inside `GridEditor`.
`playwright-tests/venue-grid-editor.spec.ts` (Task 1 suite) needs **no change** — 畫地板 is the default-selected tool on mount, and floor click/drag toggle semantics are byte-for-byte identical to Task 1, so all 9 existing ACs must still pass unmodified. Treat any Task 1 spec failure as a regression in the implementation, not a test to update.

## Implementation Steps

1. **`src/lib/venue/grid.ts` — widen `CellType`.** Change `export type CellType = "floor";` to `export type CellType = "floor" | "wall" | "column";` and update/remove the now-obsolete Task 2 forward-looking comment above it. `Map<string, CellType>`, `cellKey`, `validateGridSize`, and all constants are unchanged.

2. **`src/lib/venue/grid.ts` — add shared `Tool` type + metadata.** Below `CellType`, add:
   - `export type Tool = CellType | "eraser";`
   - `export const TOOLS: ReadonlyArray<{ id: Tool; label: string; testId: string }>` with, in this order:
     - `{ id: "floor",  label: "畫地板", testId: "tool-floor" }`
     - `{ id: "wall",   label: "畫牆壁", testId: "tool-wall" }`
     - `{ id: "column", label: "畫柱子", testId: "tool-column" }`
     - `{ id: "eraser", label: "擦除",   testId: "tool-eraser" }`

   Rationale: keeps `grid.ts` the single React-free source of truth for grid vocabulary. Task 4's 3D generator imports `CellType` only and never sees `Tool`; the Playwright page object can reference the same testid strings.

3. **`GridEditor.tsx` — generalize the stroke-lock type.** Replace `type PaintMode = "floor" | "empty" | null;` with `type PaintMode = CellType | "empty" | null;` (import `Tool` alongside the existing imports). `paintModeRef` keeps its exact role and lifecycle: set once at pointerdown, applied verbatim on pointerenter, nulled by grid pointerup / grid pointerleave / the window-level pointerup safety net. Do not touch the `useEffect` listener or the `releasePointerCapture` call.

4. **`GridEditor.tsx` — add tool-selection state.** `const [activeTool, setActiveTool] = useState<Tool>("floor");` — 畫地板 pre-selected on mount, satisfying AC1. Do NOT reset it in `handleResizeSubmit` (resize keeps tool selection; only `setCells(new Map())` clears data — existing line, unchanged), satisfying the last AC. Clicking the already-active button calls `setActiveTool` with the same value — React bails out on identical state, so it is a natural no-op (edge case covered).

5. **`GridEditor.tsx` — generalize `applyPaint`.** Signature becomes `applyPaint(key: string, mode: CellType | "empty")`: `mode === "empty"` → `next.delete(key)` (already a no-op for absent keys, which covers "eraser on empty cell"); otherwise `next.set(key, mode)`. Same immutable `new Map(prev)` pattern.

6. **`GridEditor.tsx` — resolve stroke mode in `handleCellPointerDown` per the semantics table.** Replace the current two-way ternary with:

   ```
   current = cells.get(key)            // CellType | undefined
   mode =
     activeTool === "eraser" → "empty"                     // always clear, idempotent
     current === activeTool  → "empty"                     // same-type toggle-off
     otherwise               → activeTool                  // empty→set, different-type→overwrite
   ```

   Then, exactly as today: `paintModeRef.current = mode; applyPaint(key, mode);`. Everything else in the handler (preventDefault, pointer-capture release) is untouched. `handleCellPointerEnter` is untouched — it already applies the locked mode without re-evaluation, which is precisely the required stroke-lock behavior (tool switching mid-drag has no effect on the in-flight stroke, since the mode was captured at pointerdown).

7. **`GridEditor.tsx` — per-type cell rendering.** In the cell loop, replace `const isFloor = cells.has(key)` with `const state = cells.get(key) ?? "empty";`, set `data-cell-state={state}`, and pick classes from a module-level lookup:

   | state    | classes |
   | -------- | ------- |
   | `floor`  | `border border-sky-400 bg-sky-300` (unchanged from Task 1) |
   | `wall`   | `border border-amber-800 bg-amber-700` (tan/brown) |
   | `column` | `border border-gray-600 bg-gray-500` (clearly darker than the empty-cell `border-gray-300`) |
   | `empty`  | `border border-gray-300 bg-white` (unchanged) |

   Define this as a `const CELL_CLASSES: Record<CellType | "empty", string>` at module scope (full literal class strings — never build Tailwind class names dynamically by string concatenation, or the v4 scanner won't emit them).

8. **`GridEditor.tsx` — toolbar UI.** Insert a toolbar between the resize form and the grid container (order: form → error → toolbar → grid): a `<div data-testid="venue-toolbar" role="toolbar" className="flex flex-wrap gap-2">` mapping over `TOOLS`. Each button:
   - `type="button"` (must not submit anything; it sits outside the form, but be explicit),
   - `data-testid={tool.testId}`,
   - `aria-pressed={activeTool === tool.id}` (machine-checkable active state for Playwright + a11y),
   - `onClick={() => setActiveTool(tool.id)}`,
   - style consistent with the existing 套用尺寸 button family: rounded-full, `px-5`, ~`h-11`, `font-medium`, `transition-colors`. Active = filled (`bg-foreground text-background`, mirroring 套用尺寸); inactive = outline (`border border-black/12 bg-transparent text-zinc-800 hover:border-zinc-500`). Exactly one button renders as filled at all times (radio semantics come free from single `activeTool` state).

9. **`manual-tests/venue-grid-editor.md` — append Task 2 checklist.** Add a `## Task 2 — 工具列（畫地板/畫牆壁/畫柱子/擦除）` section with numbered items covering: default tool is 畫地板 (filled state visible); switching tools moves the single active highlight; clicking the active button again does nothing visible; each paint tool sets empty cells to its color (地板淺藍 / 牆壁棕褐 / 柱子深灰, all distinguishable from each other and from empty); same-type click toggles back to empty; different-type click overwrites directly without erasing first; 擦除 clears any occupied type and no-ops on empty; drag with each tool applies the first-cell-resolved action to the whole stroke (including eraser dragged across mixed cells); mid-drag toolbar clicks don't alter the in-flight stroke; resize clears cells but keeps the selected tool (e.g. select 畫牆壁, resize, paint — still wall).

10. **Verify.** Run `npm run lint` and `npx tsc --noEmit`; run the existing Task 1 Playwright suite (`npx playwright test playwright-tests/venue-grid-editor.spec.ts`) against a dev server and confirm 9/9 still pass with zero spec edits; walk the new manual checklist in a browser.

## Data Flow

```
toolbar click ──> setActiveTool (React state, persists across resize)
                       │
cell pointerdown ──────┴──> resolve mode ONCE from (activeTool, cells.get(key)):
                              eraser → "empty" | same type → "empty" | else → activeTool
                            paintModeRef.current = mode; applyPaint(key, mode)
cell pointerenter (drag) ──> applyPaint(key, paintModeRef.current)   // no re-evaluation
pointerup / pointerleave / window pointerup ──> paintModeRef.current = null
                       │
cells: Map<string, CellType> ──> render: data-cell-state + CELL_CLASSES per cell
```

Empty remains "absent from the Map" — no `"empty"` variant enters `CellType`, keeping Task 4's 3D extrusion input model (iterate Map entries, extrude by type) intact.

## Test Plan

Per AGENTS.md: no JS unit framework — verification is the manual checklist (developer + QA stage) plus Playwright as the FRONTEND acceptance gate (playwright stage).

- **Manual checklist (developer must update + walk before handoff):** the new items from Step 9, plus a regression pass of the existing Task 1 items 1–11 (floor behavior must be unchanged).
- **Playwright (playwright stage) — regression:** existing `venue-grid-editor.spec.ts` runs unmodified, 9/9 green.
- **Playwright (playwright stage) — new coverage** (new spec file, e.g. `playwright-tests/venue-toolbar.spec.ts`, reusing `VenuePage`):
  - Page object additions: `toolButton(tool)` via the `tool-floor|wall|column|eraser` testids, `selectTool(tool)`, `activeTool()` reading `aria-pressed`, `cellsCountByState(state)` generalizing `floorCellsCount()`.
  - Default tool is floor (`tool-floor` has `aria-pressed="true"` on load and Task-1-style click paints floor).
  - Tool switching: exactly one `aria-pressed="true"` at a time.
  - Wall/column paint on empty cell → `data-cell-state="wall"/"column"` + `bg-amber-700` / `bg-gray-500` class assertions.
  - Same-type toggle-off for wall and column; different-type overwrite (floor→wall in one click); eraser clears each occupied type and no-ops on empty.
  - Drag stroke lock per tool using the existing `dragPaint` raw-mouse helper (including eraser drag across a mixed floor/wall/column/empty run → all empty).
  - Resize keeps tool: select 畫牆壁, resize, paint a cell → wall.

Edge cases from orchestrator-output.md (mid-drag tool switch, eraser over mixed cells, re-click active button, resize with non-floor tool active) are all covered across the manual + Playwright items above.

## Architecture Notes

- **No deviations** from Task 1's established patterns — this is a deliberate type-widening of the existing `paintModeRef` design, exactly the extension point the Task 1 code comment in `grid.ts` reserved.
- `Tool` lives in `grid.ts` rather than `GridEditor.tsx`: slightly wider than strictly necessary for rendering, but it keeps label/testid vocabulary in one React-free module shared with the Playwright page object, and `TOOLS` ordering doubles as the toolbar order spec. Task 4 remains unaffected (imports `CellType` only).
- Performance: unchanged profile — one `Map` copy per painted cell, max 2500 cells, no memoization needed (same conclusion as Task 1's review). The class lookup is a static object; no per-render allocation concerns.
- Risk areas: (a) Tailwind class emission — use full literal strings in `CELL_CLASSES` (Step 7 note); (b) Task 1 Playwright regression is the guardrail that floor semantics didn't drift — run it before handoff, not just at the playwright stage.

## Security Checklist

- [ ] No hardcoded secrets or credentials (none involved — no network calls at all)
- [ ] Input validation implemented at system boundaries (only boundary is `validateGridSize`, unchanged)
- [ ] Auth/permission checks in place — N/A; `/venue` remains a public page, `src/proxy.ts` untouched (verify zero diff at review)
- [ ] No sensitive data logged (no logging added)
- [ ] No Supabase client usage introduced in frontend code (AGENTS.md rule — this task must not import from `src/lib/supabase/`)
- [ ] No new localStorage/persistence introduced (story-level: no persistence)

## Definition of Done

- [ ] All implementation steps 1–10 complete
- [ ] All 11 acceptance criteria in orchestrator-output.md demonstrably satisfied
- [ ] Manual checklist updated (Step 9) and walked in a real browser
- [ ] Existing Task 1 Playwright suite passes 9/9 with zero spec modifications
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] No TODOs, commented-out code, or debug logs
- [ ] `src/proxy.ts`, `src/app/api/**`, `src/lib/supabase/**` have zero diff
- [ ] Security checklist passed
