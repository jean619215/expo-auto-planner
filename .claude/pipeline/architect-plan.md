# Architect Plan — 物件系統:牆壁線段工具與柱子矩形工具(選取/移動/刪除)

> Story: 場地白模產生器 (階段一) | Task type: FRONTEND | Generated: 2026-07-13T00:30:00+08:00

## Overview

Extend the existing Konva floor-plan editor with an additive wall/column object system: a `選取/牆壁/柱子` mode toolbar, pure meter-space geometry helpers in `plan.ts` for walls (`start`/`end`, fixed 0.2m thickness) and columns (`center`, fixed 0.5×0.5m), and a unified select/move/delete interaction. Floor-polygon editing from Task 1 stays untouched; object selection is separate, mutually-exclusive state.

## Task Type Confirmed

FRONTEND

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/components/venue/PlanToolbar.tsx` | Presentational HTML (non-Konva) mode toolbar: `選取`/`牆壁`/`柱子` segmented buttons + `刪除` button. Props: `mode`, `onModeChange`, `canDelete`, `onDelete`. Carries the `data-testid` + `aria-pressed` hooks. Keeps `PlanEditor.tsx` focused. |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/lib/venue/plan.ts` | Append pure geometry: `WallSegment`/`Column` types, `WALL_THICKNESS_M`/`COLUMN_SIZE_M` constants, id helper, `createWall`, `createColumn`, `translateWall`, `translateColumn`, `moveWallEndpoint`. React/Konva-free. |
| `src/components/venue/PlanEditor.tsx` | Add `mode`, `walls`, `columns`, `selectedObject` state; render toolbar, walls layer, columns, selection highlight, wall endpoint handles, and wall draw-preview; wire Stage pointer handlers for draw/place/deselect; extend keydown for object delete; add object `data-*` test hooks; gate floor-layer interactivity to select mode. |
| `playwright-tests/pages/PlanEditorPage.ts` | Add object accessors (`mode`, `wallCount`, `columnCount`, `selectedId`, `objects`), toolbar actions, `drawWall`, `placeColumn`/`clickAt`, `dragObjectBody`, `dragWallEndpoint`, `pressDelete`, `clickDelete`. |
| `manual-tests/venue-plan-editor.md` | Append a Task 2 checklist section (visual/手感 items Playwright can't judge). |

No changes to `src/proxy.ts`, any `/api/*` route, Supabase factories, or `next.config.ts`. No new dependencies (konva/react-konva already installed).

## Data Model (in `src/lib/venue/plan.ts`)

```ts
export const WALL_THICKNESS_M = 0.2;
export const COLUMN_SIZE_M = 0.5;

export interface WallSegment {
  id: string;
  start: PlanPoint; // meters
  end: PlanPoint;   // meters
}

export interface Column {
  id: string;
  center: PlanPoint; // meters; fixed COLUMN_SIZE_M square this task
}
```

- Field names `start`/`end` and `center` follow **orchestrator-output.md** (the authoritative spec), not the `a`/`b`/`size` shorthand in the task brief. Rationale: minimise churn against the finalized acceptance criteria; column size stays a shared constant (not a per-object `size`) because non-square/resizable columns are explicitly Task 3 / out-of-scope. Task 3 can widen `Column` to carry `size` then.
- **id generation:** `crypto.randomUUID()` via a small `createObjectId()` wrapper (with a counter fallback if unavailable). SSR-safe because `PlanEditor` is loaded `ssr:false` (see `PlanEditorLoader.tsx`) and ids are only minted inside client pointer-event handlers — never during render/SSR.

## Implementation Steps

### A. Pure geometry — `src/lib/venue/plan.ts` (append only; do not alter existing exports)

1. Add constants `WALL_THICKNESS_M = 0.2`, `COLUMN_SIZE_M = 0.5`, and the `WallSegment` / `Column` interfaces above.
2. Add `createObjectId(): string` — return `crypto.randomUUID()` when available, else a module-level incrementing counter string (`obj-<n>`). Keep it React-free (side-effect limited to the counter).
3. Add `samePoint(a: PlanPoint, b: PlanPoint): boolean` — `a.x === b.x && a.y === b.y` (reuse the local equality currently inlined in `insertVertexOnEdge`; optionally refactor that call site to use it — no behavior change).
4. Add `createWall(rawStart: PlanPoint, rawEnd: PlanPoint): WallSegment | null` — `snapPoint` both endpoints (existing helper already snaps **and** clamps to `[0,50]`); if `samePoint(start, end)` return `null` (zero-length reject); else return `{ id: createObjectId(), start, end }`.
5. Add `clampColumnCenter(p: PlanPoint): PlanPoint` — snap to grid, then clamp each axis to `[COLUMN_SIZE_M/2, VENUE_SIZE_M - COLUMN_SIZE_M/2]` = `[0.25, 49.75]` so the full extent stays in bounds. Do **not** reuse `clampToBounds` (that clamps to `[0,50]`, wrong for a center).
6. Add `createColumn(rawCenter: PlanPoint): Column` — `{ id: createObjectId(), center: clampColumnCenter(rawCenter) }`.
7. Add `translateWall(wall: WallSegment, deltaRaw: PlanPoint): WallSegment` — snap the delta to grid (`snapToGrid` per axis), then clamp the delta so **both** endpoints remain in `[0,50]`: for x, allowable delta ∈ `[-min(start.x,end.x), VENUE_SIZE_M - max(start.x,end.x)]` (same for y). Apply the clamped delta to both endpoints. This satisfies "entire object stays within bounds".
8. Add `translateColumn(col: Column, deltaRaw: PlanPoint): Column` — snap delta, apply to center, then `clampColumnCenter` the result (extent-aware clamp).
9. Add `moveWallEndpoint(wall: WallSegment, which: "start" | "end", rawPoint: PlanPoint): WallSegment` — `snapPoint(rawPoint)`; build the candidate wall with that endpoint replaced; if `samePoint(newStart, newEnd)` return the **original** wall unchanged (zero-length reject → caller reverts by re-snapping the handle node to the unchanged endpoint); else return the updated wall.
10. (Optional) Add `wallLengthM(wall)` only if it aids manual assertions; not required by any AC — skip unless trivially helpful.

### B. Toolbar — `src/components/venue/PlanToolbar.tsx` (new)

11. Client component. Define `type EditorMode = "select" | "wall" | "column"` canonically in `PlanEditor.tsx` and import it into the toolbar (one source of truth).
12. Render a button group: three mode buttons labelled `選取` / `牆壁` / `柱子` with `data-testid="tool-select" | "tool-wall" | "tool-column"`, each `aria-pressed={mode === value}`, calling `onModeChange(value)`. Active button visually distinct via Tailwind (e.g. blue bg when pressed), matching the app's existing plain button styling — no new design tokens.
13. Render a `刪除` button `data-testid="tool-delete"`, `disabled={!canDelete}`, `onClick={onDelete}`.
14. Do **not** use `data-testid="venue-grid"` or the text `面積統計` anywhere (Task 1 AC9 asserts their absence).

### C. Editor state & wiring — `src/components/venue/PlanEditor.tsx`

15. Add state: `mode` (`useState<EditorMode>("select")`), `walls` (`WallSegment[]`), `columns` (`Column[]`), `selectedObject` (`{ type: "wall" | "column"; id: string } | null`), `draftWall` (`{ start: PlanPoint; end: PlanPoint } | null`), and `draggingHandle` (`"start" | "end" | null`, for handle fill styling).
16. Keep existing `selectedVertex` state and all Task 1 handlers **unchanged**. Enforce mutual exclusivity: when selecting an object, `setSelectedVertex(null)`; when a floor vertex `onClick`/`onTap` fires, `setSelectedObject(null)` (add that one line to the existing vertex click handlers).
17. Render `<PlanToolbar mode={mode} onModeChange={handleModeChange} canDelete={selectedObject !== null} onDelete={deleteSelectedObject} />` above the `<Stage>`, inside the wrapper div.
18. `handleModeChange(next)`: `setMode(next)`, clear `draftWall`. (Mid-drag mode switches are out of scope per spec — no special handling required.)
19. Gate floor interactivity: wrap the existing floor-polygon `<Layer>` (the polygon `<Line>` + vertex `<Circle>`s) with `listening={mode === "select"}` so wall/column drawing never collides with vertex drag or edge dbl-click. Grid/label layers are already `listening={false}`.

### D. Draw & place via Stage pointer handlers

20. Add `<Stage>`-level `onMouseDown` / `onMouseMove` / `onMouseUp` (plus `onTouchStart`/`onTouchMove`/`onTouchEnd` mapping to the same logic) using `stage.getPointerPosition()` → `pxToMeters(pointer, pxPerMeter)`:
    - **wall mode:** `onMouseDown` → set `draftWall = { start: snapPoint(m), end: snapPoint(m) }`. `onMouseMove` (only if `draftWall`) → update `end: snapPoint(m)`. `onMouseUp` → `const w = createWall(draftWall.start, draftWall.end)`; if `w` append to `walls`, `setSelectedObject({type:"wall", id:w.id})`, `setSelectedVertex(null)`, `setMode("select")`; always clear `draftWall`.
    - **column mode:** `onMouseUp` (a click) → `const c = createColumn(m)`; append, select it, `setSelectedVertex(null)`, `setMode("select")`.
    - **select mode:** `onMouseDown` → if the event target is the Stage itself or a non-object node (grid/floor), i.e. `!isObjectNode(e.target)`, `setSelectedObject(null)` (empty-space / floor deselect). Detect object nodes by a Konva `name` set on wall/column/handle shapes (e.g. `name="object"`), checked via `e.target.name()`.
21. Render the **draft wall preview** while `draftWall` is set: a semi-transparent wall strip (same rect-strip renderer as committed walls, reduced opacity) so the user sees the live segment during drag.

### E. Render walls, columns, selection, endpoint handles (new `<Layer>` above floor layer)

22. **Wall strip renderer** — for each wall, render a Konva `<Rect>` centered on the segment axis: position at `metersToPx(start)`, `width = wallLengthPx`, `height = WALL_THICKNESS_M * pxPerMeter`, `offsetY = height/2`, `rotation = atan2(end-start) in degrees`, `fill="#78350f"`. When selected, add `stroke="#3b82f6"`, `strokeWidth` (2–3). Give it `name="object"`, `onClick`/`onTap` → select this wall (+ clear vertex). Make it `draggable` when selected (body translate, step 24). A stroked `<Line>` would misrepresent thickness — use the rotated filled Rect per spec.
23. **Column renderer** — for each column, a `<Rect>` of `COLUMN_SIZE_M*pxPerMeter` square, positioned at `metersToPx(center)` with `offsetX=offsetY=half`, `fill="#78716c"`, `stroke` a slightly darker gray (e.g. `#57534e`); selected → `stroke="#3b82f6"`. `name="object"`, `onClick` select, `draggable` when selected.
24. **Body translate via draggable** (mirror the Task 1 vertex drag pattern): on `onDragMove`/`onDragEnd`, read `node.position()`, compute `deltaPx = nodePos - originalRefPx` (ref = wall.start px, or column.center px), `deltaM = pxToMeters(deltaPx)`, call `translateWall`/`translateColumn`, `setState`, then **reset the node** to `metersToPx(new ref)` so Konva's own drag offset can't desync from snapped state. Gate `draggable={isSelected}` so click-to-select precedes move; a single click selects on mousedown, then a press-drag on the already-selected object translates.
25. **Wall endpoint handles** — only when `selectedObject?.type === "wall"`: render two `<Circle>` handles at start/end px, styled exactly like floor vertices (`radius 6`, `fill` white / `#3b82f6` while dragging that handle, `stroke="#3b82f6"`, `strokeWidth 2`, `hitStrokeWidth 16`, `draggable`), rendered **on top** of the wall strip so they win hit-testing. `onDragMove` → `moveWallEndpoint(wall, which, pxToMeters(node.pos))`; `setState`; reset node to `metersToPx(result[which])` (this auto-reverts on a zero-length reject because the helper returns the unchanged wall). `onDragStart/End` toggle `draggingHandle` for the fill swap.

### F. Delete + keyboard

26. `deleteSelectedObject()`: if `selectedObject === null` return (no-op); else remove that id from `walls` or `columns` and `setSelectedObject(null)`.
27. Extend the existing `handleKeyDown`: on `Delete`/`Backspace`, **object selection takes precedence** — if `selectedObject !== null` call `deleteSelectedObject()` and `return` (do not also run the floor-vertex delete branch); else fall through to the existing `selectedVertex` branch (unchanged). Honors the edge case "avoid handling the same Delete keypress for two selection concerns simultaneously."

### G. Test hooks on the wrapper div (keep all Task 1 attributes)

28. Add to the `data-testid="plan-editor"` div, alongside the existing `data-vertex-count`/`data-vertices`/`data-px-per-meter`/`data-stage-size`:
    - `data-mode={mode}`
    - `data-wall-count={walls.length}`
    - `data-column-count={columns.length}`
    - `data-selected-id={selectedObject?.id ?? ""}`
    - `data-selected-type={selectedObject?.type ?? ""}`
    - `data-objects={JSON.stringify({ walls, columns })}` (meter coordinates, for Playwright assertions)

### H. Page object — `playwright-tests/pages/PlanEditorPage.ts`

29. Add typed accessors: `mode()`, `wallCount()`, `columnCount()`, `selectedId()`, `selectedType()`, `objects()` (parses `data-objects` → `{ walls: WallSegment[]; columns: Column[] }`). Reuse existing `meterToScreen`.
30. Add toolbar actions via testids: `selectTool()`, `wallTool()`, `columnTool()`, `clickDelete()` (clicking `[data-testid="tool-delete"]`).
31. Add interactions driven by `page.mouse` at computed screen coords:
    - `drawWall(startMeter, endMeter)` — move→down at start, move to end (`steps: 8`), up.
    - `placeColumn(meter)` / `clickAt(meter)` — single `page.mouse.click`.
    - `dragObjectBody(fromMeter, toMeter)` — press-drag (down at a point on the object, move, up).
    - `dragWallEndpoint(wallId, which, toMeter)` — read the endpoint from `objects()`, drag it.
    - `pressDelete()` — focus editor, then `page.keyboard.press("Delete")`.
32. Note in the file header comment that a single `<Stage>` → single `<canvas>` still holds (`this.canvas` `.first()` unchanged); the new toolbar is plain DOM addressed by testid.

### I. Manual test checklist — `manual-tests/venue-plan-editor.md`

33. Append a `## Task 2 — 牆壁 / 柱子物件系統` section: toolbar appearance + active (aria-pressed) state; `選取` default on load; wall strip reads as a proper 0.2m-thick strip (not a hairline) at min/max window widths; wall dark-amber, column mid-gray fills; blue selection outline on selected object; endpoint handles visually match floor vertices; drag/snap 手感; `刪除` enabled only when something selected; auto-return to `選取` + auto-select after creating a wall/column.

## Data Flow

```
Toolbar (DOM)  --onModeChange-->  mode state
                                     |
Stage pointer (px) --pxToMeters--> meters --snapPoint/create*--> plan.ts (pure)
                                     |                               |
                                     v                               v
                    wall/column/select interaction           WallSegment/Column (meters)
                                     |                               |
                                     +----> walls/columns/selectedObject state
                                                     |
                        +----------------------------+----------------------------+
                        v                            v                            v
              Konva strip/rect render      wrapper data-* hooks           Task 4 (3D whitebox)
              (metersToPx)                 (Playwright reads)             future consumer of pure data
```

Geometry stays entirely in meters inside `plan.ts`; the component only converts meters↔px at the Konva boundary — identical to the Task 1 vertex pattern, so the object data is directly reusable by the future 3D builder.

## Test Plan

Automated coverage is Playwright (the FRONTEND acceptance gate) — extend `playwright-tests/venue-plan-editor.spec.ts` (or add a sibling `venue-objects.spec.ts`). No JS unit framework is installed, so pure-geometry checks are asserted through the browser via `data-objects`.

- **Playwright scenarios (one per AC):**
  - Default mode is `選取` on load (`data-mode`).
  - Wall mode: draw A→B → wall count +1, endpoints = snapped/clamped A/B, mode back to `選取`, `data-selected-type=wall` + new id selected.
  - Wall mode: sub-snap drag (start==end after snap) → no wall created.
  - Column mode: click → column count +1, center snapped & clamped to `[0.25,49.75]`, mode back to `選取`, column selected.
  - Select mode: click wall/column → selected id set; click empty space → selection cleared.
  - Body drag of selected wall & column → whole object translates, snapped 0.5m, stays in bounds.
  - Wall endpoint drag → only that endpoint moves, snapped/clamped, other endpoint fixed.
  - Endpoint drag onto the other endpoint → rejected, endpoint reverts (wall unchanged).
  - Delete/Backspace and `刪除` button remove the selected object + clear selection; no-op when nothing selected.
  - Multiplicity: create several walls+columns, select/move/delete one, others unaffected.
  - Bounds: drag object toward the edge → clamped so full extent stays inside 50×50.
- **Regression:** the 9 existing Task 1 tests in `venue-plan-editor.spec.ts` must still pass (object system is additive; default `select` mode preserves floor editing). Confirm AC9 assertions (`[data-testid="venue-grid"]` count 0, no `面積統計` text) are not reintroduced by the toolbar.
- **Manual:** the new Task 2 checklist items (visual/手感), plus a `pageerror` listener guard as used in Task 1.
- **Edge cases (from orchestrator-output):** short-drag wall discard; column extent clamp `[0.25,49.75]`; endpoint-onto-endpoint revert; independence from floor-vertex Delete (object selection precedence). Each must have an assertion.

## Architecture Notes

- **Wall as a rotated filled `<Rect>` strip**, not a stroked `<Line>` — spec-mandated so 0.2m thickness reads correctly at any zoom (stroke width wouldn't scale with meters). Rotation/offset math is the only non-trivial rendering piece; endpoint handles sit on a top layer so they always win hit-testing over the strip.
- **Selection model:** two independent states (`selectedVertex` for floor, `selectedObject` for walls/columns) kept mutually exclusive by clearing the other on select, rather than one merged discriminated union. This deliberately avoids touching Task 1's `selectedVertex` handlers/removal path (lower regression risk) while still giving unambiguous Delete semantics (object precedence). Slight deviation from the brief's "single discriminated selection" suggestion — flagged here; rationale is Task 1 safety.
- **Body translate reuses the Task 1 vertex-drag idiom** (read node pos → meter delta → pure helper → reset node), keeping one consistent Konva interaction pattern; `draggable` gated to the selected object so click-to-select precedes move.
- **`listening={mode==="select"}` on the floor layer** is the key isolation that prevents draw gestures from hijacking floor vertices — verify Task 1 interactions still work in the default mode.
- **Performance:** unlimited objects render as one `<Rect>` each on a single layer; fine for expected counts (tens–low hundreds). No memoization needed now; revisit `Layer` batching only if counts grow — out of scope.
- **No new deps, no API/proxy/auth/schema surface** — no escalation triggers hit.

## Security Checklist

- [ ] No hardcoded secrets or credentials (none involved — pure client-side canvas).
- [ ] Input validation at boundaries — all pointer coords pass through `snapPoint`/`clamp*`/`safeNumber` (NaN-safe) before entering state.
- [ ] Auth/permission checks — N/A; `/venue` is a public page, no API/session/cookie touched. No changes to `src/proxy.ts`.
- [ ] No sensitive data logged (no logging added; never log tokens/session).
- [ ] `service_role`/Supabase not imported into this client component (unchanged).
- [ ] No new data flows / no persistence (in-memory only, per story "本階段不做資料庫儲存").

## Definition of Done

- [ ] All implementation steps complete.
- [ ] All Task 2 Playwright scenarios written and passing; all 9 Task 1 tests still green (regression).
- [ ] Manual Task 2 checklist appended to `manual-tests/venue-plan-editor.md`.
- [ ] `plan.ts` additions are pure (no React/Konva/DOM imports); meter-space data reusable by Task 4.
- [ ] No TODOs, commented-out code, or debug logs.
- [ ] `npm run lint` and type-check (`npx tsc --noEmit` / `npm run build`) clean.
- [ ] Follows AGENTS.md: `@/*` imports, no inline Supabase clients, no new DB/ORM, frontend touches no `/api/*`.
- [ ] Security checklist passed.
