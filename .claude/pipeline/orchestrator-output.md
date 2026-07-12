# Orchestrator Output — 建立 Konva 平面圖編輯器基礎

> Story: 場地白模產生器 (階段一) | Task 1 of 5 (rewritten task list) | Generated: 2026-07-12T22:15:00+08:00

## Task Type
FRONTEND

## Refined Requirement
Replace the existing grid-cell venue editor entirely with a new professional floor-plan-style 2D editor foundation, built with Konva.js via `react-konva`. This task covers **only**: the canvas/stage setup, reference gridlines, scale indication, and floor polygon editing. Walls, columns, resize handles, and dimension labels are explicitly deferred to later tasks (2 and 3).

**Replacement scope (explicit):** This task deletes/replaces the old grid-cell editor implementation in full, since the user has confirmed a full swap (改版備註 in the story file), not an incremental migration:
- Delete `src/app/venue/page.tsx` (old grid-cell page) — replace with a new page that mounts the Konva editor.
- Delete `src/components/venue/GridEditor.tsx` (old grid-cell component) — replace with new Konva-based components (e.g. `FloorPlanEditor.tsx`, exact structure left to architect).
- Delete `src/lib/venue/grid.ts` (old grid-cell coordinate/cell logic) — not reusable for polygon-based geometry; replace with new geometry helpers (snapping, bounds-clamping, polygon math) as needed.
- Delete the old Playwright specs tied to grid-cell behavior: `playwright-tests/venue-grid-editor.spec.ts`, `playwright-tests/venue-scale-stats.spec.ts`, `playwright-tests/venue-toolbar.spec.ts`.
- Delete/rewrite `playwright-tests/pages/VenuePage.ts` (old page object) — a new page object matching the new DOM/canvas structure will be created per-task starting with this one's Playwright stage.
- New Playwright specs for this task's acceptance criteria are created fresh at the `playwright` pipeline stage (not part of this orchestrator/architect scope beyond noting they must exist).

**New implementation (this task):**
- Add `react-konva` (and `konva`) as a new dependency — not yet installed in the project.
- A `/venue` page (or equivalent route, architect's call) renders a Konva `Stage`/`Layer` representing a professional 2D floor-plan canvas:
  - Light/neutral background suitable for a floor-plan look.
  - Reference gridlines drawn at a fixed real-world interval (recommend 1m minor lines, with a slightly stronger line every 5m) covering the 50x50m usable area.
  - A visible scale indication (e.g. a scale bar or an axis/ruler label showing meters) so the user can judge real-world size at a glance.
  - The stage renders at a **fixed fit-to-screen scale** (px-per-meter computed once so the full 50x50m bounds fit in the viewport) — no zoom/pan in this task.
- Floor polygon editing:
  - On load, a default floor polygon is pre-populated: a 10m x 10m square, positioned so it sits roughly centered within the 50x50m canvas.
  - Each vertex is a draggable handle. Dragging a vertex updates the polygon shape live.
  - Double-clicking on a polygon edge inserts a new vertex at the (snapped) click point on that edge, splitting the edge into two.
  - Vertex deletion is in scope: right-click a vertex (or select it and press Delete/Backspace) removes it, provided the polygon retains at least 3 vertices (minimum enforced; deletion attempts below 3 vertices are no-ops).
  - All vertex drag/insert operations snap to a 0.5m grid.
  - No vertex may be dragged (or inserted) outside the 50x50m usable bounds — position is clamped to the nearest valid in-bounds snapped point.
  - The polygon may become non-convex/concave freely. Self-intersecting polygons are **not** validated or blocked in this task (may look wrong, acceptable for now).

## Clarified Acceptance Criteria
- [ ] Given the user navigates to the venue editor page, when the page loads, then a Konva-rendered canvas appears showing a light-background floor-plan-style view with visible reference gridlines and a scale indication (e.g. scale bar or labeled ruler in meters).
- [ ] Given the canvas has loaded, when no user interaction has occurred yet, then a default 10m x 10m square floor polygon is displayed, roughly centered in the 50x50m canvas area, with visible vertex handles.
- [ ] Given a floor polygon vertex handle, when the user drags it, then the vertex follows the drag, snapping to the nearest 0.5m grid position, and the polygon shape updates live as it's dragged.
- [ ] Given a floor polygon edge, when the user double-clicks a point on that edge, then a new vertex is inserted at the (0.5m-snapped) clicked location, and the edge is split into two segments through the new vertex.
- [ ] Given a polygon vertex and the polygon currently has more than 3 vertices, when the user right-clicks the vertex (or selects it and presses Delete/Backspace), then the vertex is removed and the polygon reflows through the remaining vertices.
- [ ] Given a polygon with exactly 3 vertices, when the user attempts to delete a vertex, then the deletion is rejected (no-op) and the polygon still has 3 vertices.
- [ ] Given a vertex drag or edge-insertion that would place a point outside the 50x50m usable bounds, when the drag/insert completes, then the resulting point is clamped to the nearest valid in-bounds position (still snapped to 0.5m).
- [ ] Given the polygon is edited into a concave/irregular shape, when rendering, then the canvas displays the concave polygon correctly without validation errors or crashes (self-intersection is not checked/blocked).
- [ ] Given the old grid-cell venue editor previously existed, when this task is complete, then it and its dedicated Playwright specs no longer exist in the codebase (replaced by the new implementation).

## Edge Cases to Handle
- Dragging a vertex rapidly to a screen position far outside the 50x50m canvas area must still clamp/snap correctly (no NaN/negative coordinates, no vertex left outside bounds).
- Double-click near an existing vertex (not clearly "on the edge, away from vertices") should not create a degenerate zero-length edge — if the snapped insertion point coincides with an existing vertex, treat it as a no-op.
- Deleting a vertex adjacent to the shape's "closing" edge (first/last vertex in the array) must still correctly reconnect the polygon loop.
- Resizing the browser window: since this task uses fixed fit-to-screen scale, the stage should recompute the fit scale on resize (or, at minimum, remain usable/not distorted — exact resize behavior left to architect, but must not break interactions).
- Window/viewport too small to show the full 50x50m grid at a legible scale: acceptable to have a minimum practical scale; not a blocker for this task, but note if labels become illegible at small viewports.

## Error States
- No network/API error states apply — this task is purely client-side canvas interaction with no persistence.
- If `react-konva`/`konva` fails to load or initialize (e.g. SSR mismatch under Next.js App Router), the page must not crash the whole app — architect/developer should ensure the canvas component is client-only (`"use client"` / dynamic import with `ssr: false` as appropriate for Konva's canvas dependency).

## Out of Scope
- Wall (line-segment) tool and column (rectangle) tool — Task 2.
- Object selection/move/resize for walls/columns, delete of walls/columns — Task 2.
- Real-time dimension labels on selection/resize, floor polygon edge-length annotations — Task 3.
- 3D white-box generation and "產生 3D 模型" button — Task 4.
- 3D orbit-control viewer and 2D/3D view-switch flow — Task 5.
- Any persistence/database storage of the floor plan — explicitly out of scope for the whole story (階段一).
- Viewport zoom/pan on the 2D canvas — deferred; fixed fit-to-screen scale is sufficient for this task (may be revisited in Task 3 if dimension-label crowding demands it, but not required now).
- Self-intersecting polygon validation/warnings — deferred, not handled in this task or committed to any future task yet.

## Assumptions Made
(Proposed defaults confirmed — low-stakes, user readily accepts recommended defaults per prior interactions; proceeding without a blocking Q&A round-trip. Flagged here for visibility; may be overridden before/during architect review.)
- Default starting polygon: 10m x 10m square, centered-ish in the 50x50m canvas.
- Vertex insertion: double-click on an edge inserts a snapped vertex at that point.
- Vertex deletion is in scope for this task: right-click or select+Delete/Backspace, with a minimum-3-vertices floor.
- Canvas viewport: fixed fit-to-screen scale for the full 50x50m bounds; no wheel-zoom/pan in this task (may reconsider alongside Task 3's dimension-annotation work if needed).
- Polygon self-intersection is not validated in this task.
- Old grid-cell editor code (`src/app/venue/page.tsx`, `src/components/venue/GridEditor.tsx`, `src/lib/venue/grid.ts`) and its 3 Playwright specs + `VenuePage.ts` page object are deleted/replaced as part of this task's implementation, per the story's 改版備註 confirming a full swap rather than incremental migration.

## Security Notes
No new security-sensitive surface: this task is a client-only, non-persisted canvas UI (no new API routes, no auth changes, no data storage). No secrets or credentials involved. Standard Next.js client-component/SSR considerations apply for the Konva canvas (client-only rendering), not a security concern per se.
