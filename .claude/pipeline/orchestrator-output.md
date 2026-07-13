# Orchestrator Output — 物件系統:牆壁線段工具與柱子矩形工具,含選取/移動/刪除
> Story: 場地白模產生器 (階段一) | Task 2 of 5 (rewritten task list) | Generated: 2026-07-13T00:10:00+08:00

## Task Type
FRONTEND

## Refined Requirement
Extend the Konva floor-plan editor (built in Task 1: `src/components/venue/PlanEditor.tsx`, geometry helpers in `src/lib/venue/plan.ts`) with an object system for walls and columns, plus a unified select/move/delete interaction model. This task does NOT include resize handles with live dimension labels for columns, or edge-length annotations on the floor polygon — those are Task 3.

Add a small mode toolbar above the canvas with three modes: `選取` (select, default), `牆壁` (wall), `柱子` (column).

- **選取模式 (default)**: Click a wall or column to select it. This selection is independent from the existing floor-vertex selection state from Task 1 (`selectedVertex`) — object selection here is a separate concern. A selected object shows a blue outline highlight (`#3b82f6`, matching the existing floor-polygon/vertex selection color). Dragging a selected wall's body (not an endpoint handle) or a selected column translates the whole object, snapping to 0.5m and clamped so the entire object stays within the 50x50m bounds. Delete or Backspace key removes the currently selected object; also provide an on-canvas/toolbar "刪除" button that does the same when something is selected (disabled/no-op when nothing selected). Clicking empty canvas space deselects.
- **牆壁模式**: Click-and-drag from a start point to an end point draws a new wall (a line segment with fixed 0.2m thickness, rendered as a solid strip, not just a thin line). Both the start and end point snap to 0.5m grid and are clamped to the 50x50m bounds while dragging (live preview during drag). On release: if the snapped start and end points are the same (drag shorter than one 0.5m snap unit), discard — no zero-length wall is created. Otherwise commit the new wall to the wall list and automatically switch back to 選取 mode with the new wall selected, so the user can immediately fine-tune it via endpoint handles.
- **柱子模式**: A single click places a new column, 0.5m x 0.5m, axis-aligned (no rotation in this task), centered at the clicked point. The center point snaps to 0.5m and the column's full extent is clamped so it stays entirely within the 50x50m bounds (i.e. clamp the center so `center ± 0.25m` never exceeds `[0, 50]`). After placement, automatically switch back to 選取 mode with the new column selected.
- **Wall endpoint editing**: When a wall is selected in 選取 mode, render two draggable circle handles at its two endpoints, visually consistent with the existing floor-polygon vertex handles (white fill, blue stroke, blue fill when actively dragged). Each handle is independently draggable, snapping to 0.5m and clamped to bounds. If a drag would make both endpoints coincide (zero-length wall), reject that update and revert to the last valid endpoint position (same "no zero-length wall" rule as creation). Dragging anywhere on the wall body other than an endpoint handle translates the entire wall (see 選取模式 above).
- **Placement bounds**: Walls and columns may be placed anywhere within the 50x50m canvas bounds, independent of the floor polygon's shape or position — no containment/intersection check against the floor polygon in this task.
- **Colors**: Wall fill = dark amber/brown (e.g. `#78350f`) rendered as a filled 0.2m-thick strip (a rotated rectangle/quad along the segment axis, not a stroked `Line`, so thickness reads correctly at any zoom). Column fill = mid-gray (e.g. `#78716c`) with a slightly darker stroke. Selected object (wall or column) = blue outline highlight (`#3b82f6`), overriding/augmenting the normal stroke while selected.
- **Multiplicity & data model**: Support unlimited walls and unlimited columns. Model each as an object in a flat array (e.g. `WallSegment[]`, `Column[]`) with a stable unique `id` (used for selection and deletion) plus their geometry in meters (wall: `{ id, start: PlanPoint, end: PlanPoint }`; column: `{ id, center: PlanPoint }` given fixed 0.5x0.5 size this task). All new geometry/snap/clamp logic should live in `src/lib/venue/plan.ts` (or a sibling pure module) following the existing pattern of keeping Konva/React out of geometry code, so it is directly reusable by the future 3D whitebox builder (Task 4).

## Clarified Acceptance Criteria
- [ ] Given the editor is open, when no mode is explicitly chosen, then 選取 (select) mode is active by default.
- [ ] Given 牆壁模式 is active, when the user click-drags from point A to point B, then a wall (0.2m fixed thickness) is created between the 0.5m-snapped, bounds-clamped versions of A and B, mode returns to 選取, and the new wall is selected.
- [ ] Given 牆壁模式 is active, when the click-drag start and end snap to the same point, then no wall is created.
- [ ] Given 柱子模式 is active, when the user clicks a point, then a 0.5x0.5m column is placed centered at the 0.5m-snapped, bounds-clamped point, mode returns to 選取, and the new column is selected.
- [ ] Given 選取模式 is active, when the user clicks a wall or column, then that object becomes selected and shows a blue outline highlight.
- [ ] Given 選取模式 is active, when the user clicks empty canvas space, then any current object selection is cleared.
- [ ] Given a wall or column is selected, when the user drags its body, then it moves as a whole, snapping to 0.5m and staying within the 50x50m bounds.
- [ ] Given a wall is selected, when the user drags one of its two endpoint handles, then that endpoint moves independently, snapping to 0.5m and staying within bounds, without moving the other endpoint.
- [ ] Given a wall is selected, when an endpoint drag would make both endpoints coincide, then the drag is rejected and the endpoint reverts to its last valid position.
- [ ] Given a wall or column is selected, when the user presses Delete/Backspace (or clicks the 刪除 control), then that object is removed from the plan and selection is cleared.
- [ ] Given nothing is selected, when the user presses Delete/Backspace or clicks 刪除, then nothing happens (no error, no-op).
- [ ] Given any number of walls/columns exist, then each is independently selectable, movable, and deletable without affecting the others.
- [ ] Given a wall or column would be placed/dragged outside the 50x50m bounds, then its position is clamped so the entire object remains within bounds.

## Edge Cases to Handle
- Wall drawn with a very short drag (below 0.5m snap threshold) → no wall created (per zero-length rule above).
- Wall/column dragged toward the canvas edge → clamped so the full object (not just its reference point) stays inside 50x50m — for a column this means clamping the center to `[0.25, 49.75]` on each axis; for a wall each endpoint clamps to `[0, 50]` independently (thickness is visual/rendering only, not part of the bounds-clamp math, consistent with how the thin polygon vertices clamp today).
- Dragging a wall endpoint on top of the other endpoint → rejected, reverts (no zero-length wall via editing either).
- Switching modes mid-interaction (e.g. pressing a toolbar button while mid-drag) is out of scope for explicit handling — acceptable to let the in-progress drag either complete or be abandoned; no crash requirement beyond that.
- Selecting an object of one type (e.g. wall) does not need to interact with floor-vertex selection state from Task 1 — they are independent selection concerns for this task (floor vertex editing already has its own Delete-key/right-click removal path from Task 1; wall/column Delete only fires when a wall/column is selected, not a floor vertex — avoid handling the same Delete keypress for two selection concerns simultaneously if a conflict is discovered during implementation, and prefer object selection to take precedence if both are somehow set).
- No undo/redo requirement in this task.

## Error States
- No network/API error states apply — this is a pure client-side, in-memory editing task (per story: "本階段不做資料庫儲存").
- No validation-failure UI needed beyond the two silent-reject behaviors above (short drag, zero-length endpoint edit) — both are silent no-ops, no toast/error message required.

## Out of Scope
- Column/wall resize handles and live dimension (meters) labels during resize — Task 3.
- Floor polygon edge-length annotations — Task 3.
- Column rotation or non-square column sizes.
- Containment/intersection checks between walls/columns and the floor polygon.
- Undo/redo.
- Persistence/database storage of the plan.
- 3D whitebox generation from the object data (Task 4) — this task only needs to produce clean, reusable meter-space data structures for that future consumer.
- Multi-select (selecting more than one object at a time).

## Assumptions Made
- Wall creation uses click-drag (mousedown at start, mouseup at end) rather than click-click-click, matching the user's confirmed proposal.
- After committing a new wall or column, the editor auto-returns to 選取 mode (rather than staying in creation mode for rapid multi-placement) — user confirmed this explicitly.
- The existing floor-polygon vertex selection/deletion (Task 1, `selectedVertex` state + its own Delete-key handler in `PlanEditor.tsx`) remains untouched; new wall/column selection is additive, separate state.
- Wall thickness (0.2m) is rendered as a filled quad, not a stroked line, so it visually reads as a proper wall strip at any zoom/scale — this is an implementation detail for the architect/developer to size correctly in px given `computePxPerMeter`.

## Security Notes
None — purely client-side canvas editing, no new data flows, no auth/session/API surface touched. Consistent with AGENTS.md noting no security-sensitive concerns for this greenfield frontend-only feature.
