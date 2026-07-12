# Architect Plan — 建立 Konva 平面圖編輯器基礎

> Story: 場地白模產生器 (階段一) | Task type: FRONTEND | Generated: 2026-07-12T23:05:00+08:00
> Task 1 of 5 (rewritten task list). Source of truth: `.claude/pipeline/orchestrator-output.md`.

## Overview

Fully replace the old grid-cell venue editor with a Konva.js (react-konva) floor-plan editor foundation: fit-to-screen 50x50m canvas with 1m/5m gridlines and meter scale labels, plus an editable floor polygon (vertex drag / edge-insert / vertex-delete, 0.5m snap, bounds clamp). All geometry state lives in **meters** in a pure lib module; pixels exist only at render time — this is deliberate so Tasks 4–5 (3D whitebox) can consume the same meter-space data.

## Task Type Confirmed

FRONTEND — confirmed. Purely client-side canvas UI; no API routes, no persistence, no auth surface. No contradiction found with the orchestrator spec.

## Dependency Decision (verified 2026-07-12)

- Add `konva` (^10.3.0) and `react-konva` (^19.2.5) as regular dependencies.
- Verified: `react-konva@19.2.5` peerDependencies are `react ^19.2.0`, `react-dom ^19.2.0` (project: 19.2.4 ✓) and `konva ^8 || ^7.2.5 || ^9 || ^10` (✓). No React 18/19 mismatch risk.
- Konva touches `window`/`canvas` at import time → must never render (or be imported) server-side. Per `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` in this Next.js 16 version: **`ssr: false` only works when `dynamic()` is called inside a Client Component** — it cannot go directly in a Server Component page. Hence the loader-component structure below (same pattern the voided R3F plan used, re-verified against the docs shipped in this repo).

## Files to Delete (full replacement, per story 改版備註 + orchestrator spec)

| File path | Reason |
| --------- | ------ |
| `src/components/venue/GridEditor.tsx` | Old grid-cell editor component — replaced by Konva editor |
| `src/lib/venue/grid.ts` | Grid-cell coordinate/cell logic — not reusable for polygon geometry |
| `playwright-tests/venue-grid-editor.spec.ts` | Tests grid-cell behavior that no longer exists |
| `playwright-tests/venue-toolbar.spec.ts` | Tests old wall/column/eraser toolbar (also removed) |
| `playwright-tests/venue-scale-stats.spec.ts` | Tests old scale/stats UI |
| `playwright-tests/pages/VenuePage.ts` | Old page object bound to the deleted DOM structure |
| `manual-tests/venue-grid-editor.md` | Old manual checklist — replaced (see Files to Create) |

`src/app/venue/page.tsx` is modified (rewritten in place), not deleted — route path `/venue` stays the same, so existing nav links keep working.

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/lib/venue/plan.ts` | Pure geometry/domain module (no React, no Konva import): types, constants, snap/clamp, polygon vertex insert/delete math, px↔meter scale helpers. Unit-testable in isolation and directly reusable by the future 3D scene builder. |
| `src/components/venue/PlanEditor.tsx` | `"use client"` Konva editor: Stage + layers (grid, labels, polygon), all interaction handlers. Holds polygon state in meters. |
| `src/components/venue/PlanEditorLoader.tsx` | `"use client"` thin wrapper: `const PlanEditor = dynamic(() => import("./PlanEditor"), { ssr: false, loading: ... })`. Exists solely because `ssr: false` must live in a Client Component in this Next version. |
| `manual-tests/venue-plan-editor.md` | New manual visual-check checklist for this task (grid look, scale legibility, polygon feel). |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/app/venue/page.tsx` | Rewrite: stays a Server Component shell (heading 「場地規劃」, layout classes consistent with current page), renders `<PlanEditorLoader />` instead of `<GridEditor />`. |
| `package.json` | Add `konva` + `react-konva` dependencies (via `npm install konva react-konva`). |

**No changes** to `src/proxy.ts` — `/venue` is not in `PROTECTED_PAGES` today (verified by grep: no venue reference in proxy.ts), pages are public by default, and no new API routes are added. Matcher untouched.

## Implementation Steps

1. **Install dependencies.** `npm install konva react-konva`. Confirm `react-konva@^19.2.5` / `konva@^10` land in `package.json`.

2. **Delete old implementation.** Remove `src/components/venue/GridEditor.tsx`, `src/lib/venue/grid.ts`, `playwright-tests/venue-grid-editor.spec.ts`, `playwright-tests/venue-toolbar.spec.ts`, `playwright-tests/venue-scale-stats.spec.ts`, `playwright-tests/pages/VenuePage.ts`, `manual-tests/venue-grid-editor.md`. Grep for any remaining imports of `GridEditor` / `@/lib/venue/grid` (expect only `src/app/venue/page.tsx`, fixed in step 7).

3. **Create `src/lib/venue/plan.ts`** — pure module, exports:
   - Types: `PlanPoint { x: number; y: number }` (meters, x→right, y→down in plan space), `FloorPolygon = PlanPoint[]` (ordered vertex loop, implicitly closed).
   - Constants: `VENUE_SIZE_M = 50`, `SNAP_M = 0.5`, `MIN_FLOOR_VERTICES = 3`, `GRID_MINOR_M = 1`, `GRID_MAJOR_M = 5`, `DEFAULT_FLOOR: FloorPolygon` = 10x10m square centered at (25,25): `[(20,20),(30,20),(30,30),(20,30)]`.
   - `snapToGrid(v: number): number` — round to nearest 0.5m.
   - `clampToBounds(v: number): number` — clamp to `[0, 50]`.
   - `snapPoint(p: PlanPoint): PlanPoint` — snap then clamp both axes (clamp AFTER snap so a snap to 50.5 still lands on 50.0; since 0 and 50 are themselves on the 0.5 grid, clamped results remain snapped). Must be NaN-safe: guard non-finite inputs by treating them as 0 (covers pathological drag events).
   - `closestPointOnSegment(a: PlanPoint, b: PlanPoint, p: PlanPoint): PlanPoint` — projection clamped to the segment, used for edge insertion.
   - `findClosestEdge(polygon: FloorPolygon, p: PlanPoint): { edgeIndex: number; point: PlanPoint; distance: number }` — resolves which edge a double-click targets (iterates all edges; edge i connects vertex i → vertex (i+1) % length, so the closing edge is handled uniformly).
   - `insertVertexOnEdge(polygon: FloorPolygon, edgeIndex: number, rawPoint: PlanPoint): FloorPolygon` — projects `rawPoint` onto edge `edgeIndex`, snaps the result; **no-op (returns same array) if the snapped point equals either edge endpoint** (degenerate zero-length edge guard from the spec's edge cases). Otherwise returns a new array with the vertex spliced in at `edgeIndex + 1`.
   - `removeVertex(polygon: FloorPolygon, index: number): FloorPolygon` — returns new array without vertex `index`; **no-op if `polygon.length <= MIN_FLOOR_VERTICES`**. Works for index 0 and last index (loop reconnects naturally since closing is implicit).
   - `moveVertex(polygon: FloorPolygon, index: number, rawPoint: PlanPoint): FloorPolygon` — snapPoint then replace (immutable).
   - Scale helpers: `computePxPerMeter(stagePx: number): number` (= `stagePx / VENUE_SIZE_M`), `metersToPx(p: PlanPoint, pxPerMeter: number)`, `pxToMeters(p: {x,y}, pxPerMeter: number)`.
   - No Konva or React imports in this file — keep it pure (developer must respect this; the 3D tasks will import it).

4. **Create `src/components/venue/PlanEditor.tsx`** (`"use client"`):
   - **Stage sizing / fit-to-screen:** wrap the Konva `Stage` in a `div ref` container; measure container width on mount and via a `ResizeObserver`; `stagePx = min(containerWidth, 800)` (square stage, floored at a practical minimum of ~320px), `pxPerMeter = computePxPerMeter(stagePx)`. Resize recomputes scale; polygon state (meters) is untouched, so interactions survive resize (spec edge case). No zoom/pan.
   - **Layers (bottom → top):**
     1. *Grid layer* (`listening={false}` for performance): light background `Rect` (light neutral, e.g. `#fafaf9`), minor `Line`s every 1m (thin, e.g. `#e7e5e4`), major `Line`s every 5m (stronger, e.g. `#d6d3d1`), and a border rect around the 50x50 bounds.
     2. *Labels layer* (`listening={false}`): axis tick labels in meters every 5m along top and left edges (`0, 5, 10 … 50`), plus a small scale bar (e.g. a 5m segment labeled 「5 公尺」) near a corner. Satisfies the "scale indication" criterion; keep labels legible at min stage size (~12px font at 320px stage is the floor noted in the spec's small-viewport edge case).
     3. *Floor layer*: closed `Line` (`points` from polygon meters→px, `closed`, semi-transparent fill e.g. `#bfdbfe` at ~50% + solid stroke `#3b82f6` 2px) + one draggable `Circle` handle per vertex (radius ~6px, white fill, blue stroke; larger `hitStrokeWidth` for grab comfort).
   - **State:** single `useState<FloorPolygon>(DEFAULT_FLOOR)` in meters + `useState<number | null>` for `selectedVertex`. Never store px in state.
   - **Vertex drag:** on each `Circle`, `onDragMove`: convert the node's px position → meters (`pxToMeters`), run `moveVertex` (snap+clamp in meter space), set state, and **write the snapped px position back to the Konva node** (`node.position(metersToPx(...))`) so the handle visually sticks to the snapped point during drag (Konva keeps its own node position mid-drag; without the write-back the handle and the polygon line diverge). Polygon `Line` re-renders live from state. `onDragEnd` runs the same conversion once more as a settle step. Rapid off-canvas drags are covered because clamp happens in meter space on every move event.
   - **Edge insertion (double-click):** `onDblClick` on the floor `Line` (and as fallback on the Stage, filtered to clicks within ~0.5m of an edge): take `stage.getPointerPosition()` px → meters, `findClosestEdge`, then `insertVertexOnEdge`. If the helper returns the same array (degenerate case), do nothing. Note: a dbl-click on a vertex handle hits the `Circle`, not the `Line`, so "double-click near an existing vertex" naturally no-ops — plus the helper's endpoint guard as second line of defense.
   - **Vertex deletion:** `onContextMenu` on each `Circle` → `evt.preventDefault()` + `removeVertex(index)`. Additionally, clicking a handle sets `selectedVertex` (visual highlight, e.g. filled blue), and a `keydown` listener (on a focusable wrapper div with `tabIndex={0}`, not `window`, to avoid leaking global handlers) maps `Delete`/`Backspace` → `removeVertex(selectedVertex)`. Both paths are no-ops at 3 vertices via the lib guard; clear/adjust `selectedVertex` after deletion.
   - **Concave shapes:** Konva's `Line closed` renders concave polygons fine; no validation added (per spec, self-intersection is explicitly not blocked).
   - **Playwright/testability hooks (critical — canvas has no per-shape DOM):** the wrapper div carries:
     - `data-testid="plan-editor"`
     - `data-vertex-count={polygon.length}`
     - `data-vertices={JSON.stringify(polygon)}` (meter coordinates, snapped — assertions read exact meter values, immune to px rounding)
     - `data-px-per-meter={pxPerMeter}` and `data-stage-size={stagePx}` — the page object reads these to compute px coordinates for `page.mouse` gestures (meter→px math lives in the page object, mirroring `metersToPx`).
     - The Konva `Stage` container div sits inside this wrapper, so `boundingBox()` of the wrapper's canvas gives the px origin.
     No hidden debug UI beyond data attributes; this is the agreed strategy for all canvas assertions (same class of problem as the 3D canvas later).

5. **Create `src/components/venue/PlanEditorLoader.tsx`** (`"use client"`): `next/dynamic` import of `./PlanEditor` with `{ ssr: false, loading: () => <載入中 placeholder div with fixed min-height> }`. This is the only file that knows PlanEditor is client-only. (Verified against `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`: `ssr: false` must be inside a Client Component in this Next version.)

6. **Rewrite `src/app/venue/page.tsx`**: keep it a Server Component; same page chrome as today (`<main>` layout, 「場地規劃」 heading — widen container beyond `max-w-4xl` if needed for an 800px stage + padding), body renders `<PlanEditorLoader />`.

7. **Cleanup + verify build.** Grep repo for `GridEditor`, `venue/grid`, `VenuePage` — zero references must remain. Run `npm run lint` and `npm run build` (build also proves no SSR evaluation of Konva: the page must prerender without `window is not defined`).

8. **Create `manual-tests/venue-plan-editor.md`** — visual/feel checklist Playwright can't judge: floor-plan aesthetic (light bg, minor/major grid contrast), label legibility at ~360px-wide viewport, drag smoothness/snap feel, scale bar correctness, concave shape rendering, browser-resize behavior.

9. **Update pipeline state + logs** per workflow rules (developer repeats at implement stage).

## Data Flow

```
User gesture (mouse on canvas, px)
  → Konva event (Stage pointer position / node drag position, px)
  → pxToMeters(pxPerMeter)                                      [PlanEditor]
  → pure geometry op: moveVertex / insertVertexOnEdge / removeVertex
      (snap 0.5m → clamp [0,50] → min-3 / degenerate guards)    [plan.ts]
  → setState(FloorPolygon in meters)                            [PlanEditor]
  → render: metersToPx per vertex → Konva Line + Circles        [PlanEditor]
  → wrapper data-vertices / data-vertex-count updated           [DOM, for tests]
```
Meters are the single source of truth; px is a render-time projection. Task 4's 3D scene builder will consume `FloorPolygon` from `plan.ts` unchanged.

## Test Plan

No JS unit-test framework exists in this repo (per AGENTS.md) — automated verification is Playwright (acceptance gate) + manual checklist. `plan.ts` is pure, so its behavior is fully exercisable through Playwright via the meter-space `data-vertices` attribute.

- **Playwright (created at the `playwright` pipeline stage, planned here):**
  - New `playwright-tests/pages/PlanEditorPage.ts` (page object): reads `data-px-per-meter` + canvas bounding box, owns meter→px math (`meterToScreen(p)`), exposes `dragVertex(fromMeters, toMeters)`, `dblClickAt(meters)`, `rightClickVertex(meters)`, `vertexCount()`, `vertices()` (parsed from `data-vertices`), `pressDelete()`. All gestures via `page.mouse` at computed screen px.
  - New `playwright-tests/venue-plan-editor.spec.ts`, covering each acceptance criterion:
    1. Load `/venue` → canvas visible, grid/scale labels present, `data-vertex-count === 4`, `data-vertices` equals the default 10x10 square `[(20,20),(30,20),(30,30),(20,30)]`.
    2. Drag a vertex toward an off-grid target (e.g. 22.3, 27.8) → vertex lands at (22.5, 28.0) (snap assertion in meters).
    3. Drag a vertex far outside the stage (toward −5, 60 in meter terms) → vertex clamped to (0, 50), all coordinates finite and in-bounds.
    4. Double-click an edge midpoint → vertex count 5, new vertex at the snapped edge point, correct array position.
    5. Double-click at an existing vertex position → vertex count unchanged (degenerate no-op).
    6. Right-click a vertex (count > 3) → count decrements; also cover deleting vertex index 0 (closing-edge reconnection).
    7. Reduce to 3 vertices, attempt right-click delete and Delete-key delete → count stays 3.
    8. Concave shape: drag one vertex inward past the polygon interior → no crash, `data-vertices` reflects the concave loop.
    9. Regression: `playwright-tests/membership-task7-task9.spec.ts` still green; the three deleted venue specs no longer exist (verified at review stage, not in a spec).
- **Manual checklist** (`manual-tests/venue-plan-editor.md`): visual grid quality, 5m-major-line contrast, scale bar/axis labels, drag feel, resize behavior, small-viewport legibility.
- **Edge cases from orchestrator-output.md** mapped: rapid out-of-bounds drag → spec 3; dbl-click near vertex → spec 5; closing-edge vertex deletion → spec 6; browser resize → manual checklist (plus a lightweight Playwright viewport-resize sanity check if stable); tiny viewport → manual checklist.

## Architecture Notes

- **Loader indirection** (`PlanEditorLoader`) is not gold-plating: this Next 16 line rejects `ssr: false` in Server Components (verified in bundled docs). Same pattern the (now void) R3F plan validated.
- **Meter-space state** is the load-bearing decision of this task — Tasks 2–5 (walls, columns, dimension labels, 3D extrusion) all extend `plan.ts` types. Any deviation that stores px in state must be flagged, not silently made.
- **`data-vertices` JSON attribute** grows with vertex count; fine at this scale (tens of vertices). If Task 2/3 object counts ever make it heavy, switch strategies then — not now.
- **Konva drag position write-back** (step 4) is the known fiddly spot: Konva nodes own their position mid-drag, so React state alone won't keep handle and polygon in sync while snapping. Write-back in `onDragMove` (or equivalently a `dragBoundFunc` returning the snapped px position) is required; developer should pick one and be consistent.
- **Performance:** ~100 grid lines (51 vertical + 51 horizontal) on a static `listening={false}` layer is trivial for Konva; no memoization needed.
- Old grid editor commits (3afc5fc/2cae7b4/e9cf950) remain in git history; nothing to preserve in the working tree.

## Security Checklist

- [ ] No hardcoded secrets or credentials (none involved — no network/API/persistence in this task)
- [ ] Input validation at system boundaries — geometry inputs (pointer coords) are NaN-guarded, snapped, and clamped in `plan.ts`
- [ ] Auth/permission checks: N/A — `/venue` stays a public page; `src/proxy.ts` untouched (no PROTECTED_PAGES/matcher change, no API allowlist change)
- [ ] No sensitive data logged (no logging added)
- [ ] `service_role` / Supabase clients: not touched, not imported
- [ ] No Playwright credentials involved (page is public; no login needed for the new spec)

## Definition of Done

- [ ] `konva` + `react-konva` installed; versions compatible with react 19.2.4 (react-konva ^19.2.5, konva ^10)
- [ ] All 7 old files deleted; zero remaining references to `GridEditor`, `@/lib/venue/grid`, or the `VenuePage` page object
- [ ] `plan.ts`, `PlanEditor.tsx`, `PlanEditorLoader.tsx`, rewritten `venue/page.tsx`, `manual-tests/venue-plan-editor.md` created per steps above
- [ ] All 9 acceptance criteria from orchestrator-output.md implementable/observable via the data-attribute hooks
- [ ] `npm run lint` clean; `npm run build` succeeds (proves no SSR crash from Konva)
- [ ] No TODOs, commented-out code, or debug logs
- [ ] Code follows AGENTS.md rules (`@/*` alias, no direct Supabase usage, no proxy changes)
- [ ] Security checklist passed
