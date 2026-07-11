# Orchestrator Output — 建立 2D 網格編輯器基礎
> Story: 場地白模產生器 (階段一) | Task 1 of 5 | Generated: 2026-07-12

## Task Type
FRONTEND

## Refined Requirement
Build the foundational 2D grid editor for the venue whitebox generator. This is a pure frontend, single-session feature (no persistence, no backend/API involvement, no database). It establishes:

1. **Grid rendering**: A 2D grid where each cell represents exactly 1 meter × 1 meter (fixed scale, non-configurable in this task or any future task).
2. **Outer bounding box sizing**: The grid renders immediately on page load with a default size of **10m × 10m** (i.e., a 10×10 cell grid). The user can resize the grid afterward via width/height (meter) controls. Resizing the grid **clears/resets all existing floor-cell selections** — no attempt to preserve or truncate prior selections across a resize. A **maximum grid size guard** of **50m × 50m, or 2,500 total cells, whichever is more restrictive** is enforced — the resize control must reject/clamp input beyond this bound with a clear message to the user (see Error States).
3. **Floor tool (only tool in this task)**: Exactly one tool exists in this task — "畫地板" (paint floor). No toolbar/tool-switching UI is required yet (that's Task 2) — a single implicit tool is active for the whole grid.
4. **Interaction model (click + drag-paint)** — this model must be implemented generically enough that Task 2 (wall/column/eraser tools) can reuse it without rework:
   - **Single click (no drag)** on a cell toggles that one cell: empty → floor, or floor → empty.
   - **Click-and-drag**: on `pointerdown`/`mousedown`, record the state of the first cell touched. If it was empty, the drag paints all cells the pointer passes over to "floor." If it was floor, the drag paints all cells the pointer passes over to "empty" (erase). The state decision is made once at drag start and applied consistently to every cell entered during that same drag stroke — cells are not re-toggled individually as the pointer passes over them.
   - Drag ends on `pointerup`/`mouseup` (or pointer leaving the grid area, per standard drag-to-paint conventions — architect/developer may choose the precise event handling, but behavior must match: releasing or leaving ends the paint stroke).
   - Non-contiguous / irregular floor shapes must be achievable (e.g., via multiple separate click or drag strokes) — this task does not need to validate contiguity, and irregular shapes are explicitly allowed per story scope.
5. **Cell types this task cares about**: only "floor" and "empty" (unselected). Wall and column cell types are out of scope (Task 2).
6. **Visual/color spec** (explicit, developer must use these unless a stronger design-system reason emerges — flag to architect if so):
   - Empty (unselected) cell: neutral light gray/white fill with a subtle border/gridline (e.g., light gray border on a white or very-light-gray fill) — must work in both light and dark viewing contexts if the app has a dark mode; if no dark mode exists yet, plain light theme is fine.
   - Floor cell: light blue fill (chosen to leave tan/beige and gray open for wall/column cell types in Task 2, avoiding color collisions).
   - Gridlines/cell borders must be visible enough to distinguish individual 1m cells at the default 10×10 size.
7. **Real-world scale indication**: this task does not require a full ruler/axis-label system (that's Task 3's job), but since 1 cell = 1 meter is a fixed, load-bearing fact of this feature, the grid should be visually recognizable as a grid of unit cells (e.g., uniform cell sizing) so Task 3 can add scale/axis labels on top without restructuring the grid rendering.

## Clarified Acceptance Criteria
- [ ] Given the page loads, when no user interaction has occurred yet, then a 10m × 10m grid (10×10 cells) renders by default, all cells in the "empty" state.
- [ ] Given the grid is rendered, when the user provides new width/height values (in meters) via resize controls, then the grid re-renders at the new dimensions and all previously-painted floor cells are cleared/reset.
- [ ] Given the user enters a width or height exceeding 50m, or a combination exceeding 2,500 total cells, when they attempt to apply the resize, then the resize is rejected (or clamped) and a clear message is shown explaining the limit.
- [ ] Given an empty cell, when the user clicks it (no drag), then it becomes a floor cell (visually shown in light blue).
- [ ] Given a floor cell, when the user clicks it (no drag), then it becomes empty again (visually shown in light gray/white).
- [ ] Given the user presses down on an empty cell and drags across multiple cells, when the drag is in progress, then every cell the pointer passes over becomes a floor cell (regardless of that cell's prior state).
- [ ] Given the user presses down on a floor cell and drags across multiple cells, when the drag is in progress, then every cell the pointer passes over becomes empty (erased), regardless of that cell's prior state.
- [ ] Given a drag stroke is released (pointer up) or leaves the grid boundary, when this occurs, then the paint stroke ends cleanly — no further cells are affected until a new click/drag begins.
- [ ] Given the user paints floor cells in a non-contiguous or irregular pattern (multiple disconnected strokes), when they do so, then the resulting shape is preserved with no automatic connection, filling, or validation applied.
- [ ] Given the user has painted floor cells and then navigates away from or reloads the page, when they return, then no prior grid state is restored (no persistence in this task/stage).

## Edge Cases to Handle
- Resizing to a smaller grid than the current one: existing selections are discarded entirely (not just the out-of-bounds ones) — simplest, consistent behavior per user decision.
- Resize input of 0, negative, or non-numeric values: must be rejected with a validation message (do not silently clamp to some arbitrary minimum without telling the user); a sensible minimum (e.g., 1m × 1m) should be enforced.
- Drag starting on one cell and the pointer leaving the grid entirely mid-drag, then re-entering: treat as drag ended when pointer left; re-entering without a new pointerdown should not resume painting (avoids surprising behavior) — flag to architect/developer as the expected default, but this is a minor UX nuance they may confirm.
- Rapid clicking (click interpreted as a zero-distance drag): must still behave as a single toggle, not a no-op or double-toggle.
- Touch input (mobile/tablet): not a hard requirement for this task's acceptance criteria, but if trivially supportable via pointer events, developer should prefer `pointerdown`/`pointermove`/`pointerup` over mouse-only events for future-proofing. Not blocking if out of reach this task.

## Error States
- Resize exceeds max grid guard (50m × 50m or 2,500 cells) → resize is not applied; inline validation message shown (e.g., "Maximum grid size is 50m × 50m (2,500 cells)"), grid remains at its previous valid dimensions.
- Resize input invalid (non-numeric, zero, negative) → resize is not applied; inline validation message shown, grid remains at its previous valid dimensions.

## Out of Scope
- Wall, column, and eraser tools (Task 2).
- Toolbar / tool-switching UI (Task 2 introduces the first toolbar; this task has exactly one implicit tool, no UI chrome for tool selection).
- Scale ruler / axis meter labels (Task 3).
- Explicit non-contiguous shape validation/rendering polish (Task 3 confirms this works correctly; this task just must not prevent it).
- 3D model generation, Three.js/react-three-fiber integration, orbit controls (Task 4/5).
- Any persistence (database, localStorage, session storage) of grid state — out of scope for the entire story's Stage 1, not just this task.
- Any backend/API route work — this is 100% client-side/frontend state (e.g., component state or a client-side store), no `/api/*` involvement.
- Undo/redo functionality (not mentioned anywhere in story; do not add speculatively).

## Assumptions Made
- Default grid size of 10m × 10m chosen as a reasonable, immediately-usable starting point (user deferred to orchestrator's judgment).
- Max grid guard of 50m × 50m / 2,500 cells chosen as a performance-safe upper bound for DOM-based or canvas-based cell rendering at this stage (user deferred to orchestrator's judgment); architect may adjust the technical enforcement mechanism but should not change the numeric limits without flagging back.
- Floor color chosen as light blue (vs. tan/beige) specifically to avoid future collision with likely wall (tan/brown) and column (gray) colors in Task 2 — this is a product/design judgment call, not yet reviewed by a designer; acceptable to adjust later if it clashes with an established design system.
- No dark-mode requirement is confirmed to exist elsewhere in this codebase; color spec assumes light theme is sufficient unless the architect finds an existing dark-mode convention to align with.
- Drag-to-paint ending on pointer-leaving-grid (not just pointer-up) is assumed the expected behavior; if the architect/developer finds this awkward to implement cleanly, it's a minor point they may raise, not a blocking requirement.

## Security Notes
None applicable — this task involves no auth, no API routes, no data persistence, and no user input beyond client-side grid dimension numbers (which must be validated as described above, but there is no injection/security surface since nothing is sent to a server or stored).
