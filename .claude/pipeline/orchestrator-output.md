# Orchestrator Output — 擴充工具列:新增「畫牆壁」「畫柱子」「擦除」工具
> Story: 場地白模產生器 (階段一) | Task 2 of 5 | Generated: 2026-07-12T14:10:00+08:00

## Task Type
FRONTEND

## Refined Requirement
Extend the Task 1 grid editor (`src/components/venue/GridEditor.tsx`, `src/lib/venue/grid.ts`) from a single implicit "paint floor" tool into a 4-tool palette: **畫地板 / 畫牆壁 / 畫柱子 / 擦除**. The user selects one tool at a time from a toolbar; the currently selected tool determines what cell type clicking/dragging on the grid produces. All four tools reuse the exact interaction model already built in Task 1 (pointerdown locks the stroke's effective action for that drag, pointerenter during an active drag applies the same action, window-level pointerup safety net, click-to-toggle for a single cell).

Type-system change: `CellType` in `src/lib/venue/grid.ts` becomes `"floor" | "wall" | "column"` (empty/unpainted stays "not in the Map", exactly as today — no `"empty"` variant is added to `CellType` itself). The Map remains `Map<string, CellType>` keyed by `cellKey(x,y)`.

Toolbar behavior:
- 4 buttons, text-label style consistent with the existing `套用尺寸` button (`GridEditor.tsx` lines 139-145) — rounded, clear active/selected state (visually distinct, e.g. filled vs outline).
- 畫地板 (floor) is the default-selected tool on mount / after resize, matching current Task 1 behavior with no toolbar.
- Exactly one tool is active at a time (radio-button semantics, not toggle-buttons-that-can-all-be-off).
- No keyboard shortcuts in this task.

Per-cell paint semantics when a tool is active and the user interacts with a cell (click, or drag-enter during a locked stroke):
- Target cell is **empty** (not in Map) → set to the active tool's type (floor/wall/column). Eraser on an already-empty cell is a no-op.
- Target cell already holds the **same type** as the active tool → clear it back to empty (toggle-off, same UX as Task 1's floor toggle). This applies to 畫地板/畫牆壁/畫柱子 tools; it does not apply to 擦除, whose only behavior is "always empty."
- Target cell holds a **different** type than the active tool (e.g. wall tool clicked on a floor cell) → overwrite directly to the active tool's type. No requirement to erase first.
- 擦除 (eraser) on any occupied cell (floor/wall/column) → clears to empty. 擦除 is idempotent — same result regardless of prior cell type.
- The "lock stroke mode from first cell" behavior from Task 1 must be preserved: whichever of (set-to-type / clear-to-empty) the first cell in a drag resolves to is what gets applied to every subsequent cell entered during that same drag, without re-evaluating per-cell semantics per cell. (Same as Task 1's existing `paintModeRef` pattern — extend its type rather than replace its design.)

Placement constraint: walls and columns may be painted on any cell regardless of whether it currently holds floor or is empty — no requirement that a wall/column sit "on top of" floor. This is a deliberate simplification confirmed for this grid-cell model (see Assumptions).

Color coding (must be visually distinct from each other and from empty/border):
- 地板 (floor): light blue — reuse existing `bg-sky-300` / `border-sky-400` from Task 1, unchanged.
- 牆壁 (wall): tan/brown — e.g. `bg-amber-700` / `border-amber-800` (exact Tailwind shade left to architect/developer discretion within the tan-brown family; must have sufficient contrast against floor blue, column gray, and empty white).
- 柱子 (column): gray — e.g. `bg-gray-500` / `border-gray-600` (must be visually distinct from the existing empty-cell border gray, `border-gray-300` — pick a noticeably darker/saturated gray).
- 空白 (empty/unpainted): unchanged — `bg-white` / `border-gray-300`.
- Update `data-cell-state` attribute (`GridEditor.tsx` line 98) to reflect all four states (`floor` / `wall` / `column` / `empty`) for testability (Playwright already relies on this pattern).

## Clarified Acceptance Criteria
- [ ] Given the grid editor is loaded, when it first renders (or after a resize), then 畫地板 is the pre-selected active tool.
- [ ] Given a tool is selected in the toolbar, when the user clicks it, then it becomes the sole active tool (visually indicated) and any previously active tool is deselected.
- [ ] Given 畫地板/畫牆壁/畫柱子 is active, when the user clicks an empty cell, then that cell becomes the corresponding type.
- [ ] Given 畫地板/畫牆壁/畫柱子 is active, when the user clicks a cell already of that same type, then the cell reverts to empty.
- [ ] Given 畫地板/畫牆壁/畫柱子 is active, when the user clicks a cell of a *different* occupied type, then the cell is overwritten to the active tool's type (no forced erase step).
- [ ] Given 擦除 is active, when the user clicks any occupied cell (floor/wall/column), then the cell becomes empty.
- [ ] Given 擦除 is active, when the user clicks an already-empty cell, then nothing changes (no-op, no error).
- [ ] Given any tool is active, when the user pointerdowns on a cell and drags across multiple cells without releasing, then every cell entered during the drag receives the same action (set-to-type or clear-to-empty) that was resolved for the first cell in the drag — matching Task 1's stroke-lock behavior.
- [ ] Given a drag stroke is in progress, when the pointer is released anywhere (including outside the grid, via the existing window-level pointerup listener), then the stroke ends cleanly and a new click/drag starts a fresh stroke evaluation.
- [ ] Given cells of all three painted types exist on the grid, when viewing the grid, then 地板/牆壁/柱子/空白 are each rendered in a distinct, easily distinguishable color.
- [ ] Given the grid size is changed via 套用尺寸, when the resize is applied, then the cell Map is cleared (existing Task 1 behavior, unchanged) and the active tool remains whatever was selected (tool selection is not reset by resize — only cell data is cleared).

## Edge Cases to Handle
- Rapid tool switching mid-drag is not a concern — Task 1's model already locks the mode at pointerdown; switching the toolbar selection has no effect on a stroke already in progress (the drag uses whatever was locked at its start).
- Eraser dragged across a mix of floor/wall/column/empty cells: all occupied cells become empty; already-empty cells are no-ops; this is uniform regardless of what type each cell held.
- Clicking the already-active toolbar button again: no-op (still selected, no visual flicker).
- Grid resize while a non-floor tool is active: cell data clears (existing behavior) but tool selection persists — user doesn't have to re-select 畫牆壁 after resizing.

## Error States
- None new. No validation/error states are introduced by this task — grid-size validation (`validateGridSize`) is unchanged from Task 1. Painting actions cannot fail (no async/network calls; purely local state).

## Out of Scope
- Real-world scale labels / axis rulers (Task 3).
- Validating irregular/non-contiguous floor shapes explicitly (Task 3, though this task's overwrite/toggle logic must not accidentally prevent non-contiguous shapes).
- 3D whitebox generation from the grid data (Task 4).
- Any persistence/database storage (explicitly out of scope for the whole story, per story architecture notes).
- Door/window concepts or variable wall/column height (explicitly excluded by story-level decision — fixed height only, applies to Task 4's 3D extrusion, not this task).
- Keyboard shortcuts for tool switching.

## Assumptions Made
(No human was available to answer interactively this session; each item below is a low-risk default rather than a scope decision — flag at review if any should change.)
1. **Overwrite over occupied cells is direct**, not gated behind erasing first — this is the standard paint-tool UX convention and matches "quick whitebox sketching" intent of the story.
2. **Toggle-back-to-empty on same-type click** is preserved per-tool (not just for floor) for consistency with Task 1, even though a dedicated eraser now exists — this avoids removing an established interaction pattern for floor.
3. **畫地板 is an explicit toolbar button**, not an implicit default with no button — the toolbar now uniformly exposes all 4 actions as equal peers, which is simpler to reason about and test than "3 buttons + 1 implicit mode."
4. **Text-label buttons**, no icons, no keyboard shortcuts — matches the plain, functional style of the existing 套用尺寸 button and avoids icon-design decisions this task doesn't need to make.
5. **Free placement** — walls/columns do not require an underlying floor cell. The grid-cell model (per story architecture notes) treats each cell's type independently; adding a "floor-required" constraint would be a new business rule not stated in the story and would complicate Task 4's 3D extrusion logic (which just needs to know each cell's type, not layering).

## Security Notes
None. Purely client-side UI state, no auth/session/data changes, no API calls involved in this task.
