# QA Report — 建立 Konva 平面圖編輯器基礎
> Generated: 2026-07-12T23:45:00+08:00 | QA iteration: 1
> Story: 場地白模產生器 (階段一) | Task 1 of 5 | Task type: FRONTEND

## Summary
- Tests executed: 30 (9 AC checks + 4 edge cases + 2 error-state checks + 6 regression checks + 21 node-replay boundary assertions on `plan.ts`, itemized under Test Coverage)
- Passed: 30
- Failed: 0
- Blocked: 0 (live-browser interaction/visual assertions deferred to the `playwright` stage per pipeline design — this pass is static/code-level verification as instructed)

## Recommendation
APPROVED — QA sign-off granted for static/code-level verification. Both review Should-Fix issues are confirmed fixed. No new Critical/High/Medium bugs found. Proceed to `playwright` stage for live-browser acceptance gate.

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| 1. Canvas loads with gridlines + scale indication | ✅ PASS | `PlanEditor.tsx` renders `Rect` background (#fafaf9), 1m/5m `Line` gridlines (`buildGridLines`), axis tick labels every 5m, and a 5m scale bar + "5 公尺" label. Confirmed present in code; visual quality deferred to manual checklist / Playwright. |
| 2. Default 10x10 centered polygon with handles | ✅ PASS | `DEFAULT_FLOOR` = `[(20,20),(30,20),(30,30),(20,30)]`, centered at (25,25) in the 50x50 area. Node-replay: `JSON.stringify(DEFAULT_FLOOR)` matches expected square. 4 `Circle` handles rendered per vertex. |
| 3. Vertex drag snaps to 0.5m live | ✅ PASS | `handleVertexDragMove`/`handleVertexDragEnd` → `moveVertex` → `snapPoint` (snap then clamp). Node-replay: `snapToGrid(22.3)===22.5`, `snapToGrid(27.8)===28.0`. Write-back `node.position(snappedPx)` keeps handle synced with polygon Line during drag (per architect plan step 4). |
| 4. Double-click edge inserts snapped vertex, only within 0.5m of an edge | ✅ PASS (review fix confirmed) | `handleEdgeDblClick` (PlanEditor.tsx:104-108) now destructures `distance` from `findClosestEdge` and returns early when `distance > 0.5` before calling `insertVertexOnEdge`. Node-replay: insert at edge midpoint (distance 0) → 5 vertices, correct index/position; insert at exact vertex position → no-op (same array ref) via `insertVertexOnEdge`'s endpoint guard. This closes Review Issue 1. |
| 5. Vertex deletion >3 vertices removes + reflows | ✅ PASS | `removeVertex` filters out index; node-replay confirms 5-vertex polygon removing index 0 or last index reconnects the loop correctly (values match expected remaining vertices in order). |
| 6. 3-vertex floor rejects deletion (no-op) | ✅ PASS | `removeVertex` returns same array reference when `polygon.length <= MIN_FLOOR_VERTICES`. Node-replay confirms triangle removeVertex(0) returns identical reference (no mutation). |
| 7. Bounds clamping to [0,50], still snapped | ✅ PASS | `clampToBounds` clamps to `[0,50]` after `snapToGrid`; `safeNumber` guards non-finite inputs. Node-replay: `moveVertex(sq, 0, {x:-100,y:1000})` → `(0,50)`; `snapPoint({x:-5,y:60})` → `(0,50)`. |
| 8. Concave shapes render without validation errors | ✅ PASS | No self-intersection checks in `plan.ts` or `PlanEditor.tsx` (confirmed by code read); Konva `Line closed` handles concave point sets natively. No blocking logic present. Visual confirmation deferred to manual checklist. |
| 9. Old grid-cell editor + specs fully deleted | ✅ PASS | `git status` confirms deletion of `src/components/venue/GridEditor.tsx`, `src/lib/venue/grid.ts`, `playwright-tests/venue-grid-editor.spec.ts`, `playwright-tests/venue-toolbar.spec.ts`, `playwright-tests/venue-scale-stats.spec.ts`, `playwright-tests/pages/VenuePage.ts`, `manual-tests/venue-grid-editor.md`. `grep -rn "GridEditor\|venue/grid\|VenuePage" src playwright-tests manual-tests` → only coincidental `function VenuePage()` component name (not the deleted page-object class) remains. |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| Rapid drag far outside bounds → no NaN, correctly clamped | ✅ PASS | `safeNumber` guards `NaN`/`Infinity` before snap/clamp; node-replay: `snapPoint({x:NaN,y:Infinity})` → `(0,0)`, `snapPoint({x:-5,y:60})` → `(0,50)`; `moveVertex` extreme drag → `(0,50)`. |
| Double-click coinciding with existing vertex → no-op | ✅ PASS | Two independent guards: (1) Circle has no `onDblClick` handler and Konva bubbling goes up the node tree (Circle→Layer→Stage), not sideways to the `Line`, so a dblclick landing on a vertex's hit region (`hitStrokeWidth=16`) never reaches `handleEdgeDblClick`; (2) `insertVertexOnEdge`'s endpoint-equality guard is a second line of defense if a dblclick lands near-but-not-on a vertex within edge tolerance. Node-replay confirms guard #2: insert at `(20,20)` and `(30,20)` both return the same array reference. |
| Deleting vertex adjacent to closing edge reconnects loop | ✅ PASS | `removeVertex` uses `Array.filter`, index-agnostic; node-replay on a 5-vertex polygon confirms removing index 0 and removing the last index (4) both produce correctly-ordered 4-vertex loops. `findClosestEdge` also confirmed to correctly resolve the closing edge (index `length-1` connecting to index 0). |
| Container resize recomputes scale | ✅ PASS (code-level) | `ResizeObserver` on `containerRef` recomputes `stagePx` (clamped `[320,800]`) on width change; `pxPerMeter` is derived from `stagePx` on every render, so scale updates automatically. Polygon state stays in meters (untouched by resize), so interactions are not disrupted. Live-browser resize behavior also on the manual checklist (`manual-tests/venue-plan-editor.md`) and noted for a Playwright viewport sanity check per architect Test Plan. |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| Konva SSR mismatch (no crash on server render) | ✅ PASS | `PlanEditorLoader.tsx` uses `next/dynamic(..., { ssr: false })` inside a Client Component per Next 16 docs constraint; `npm run build` output shows `/venue` as `○ (Static)` — proves prerender succeeded with no `window is not defined` crash. |
| No network/API error states (N/A) | ✅ PASS (N/A) | Confirmed purely client-side; no fetch/API calls in `PlanEditor.tsx`/`plan.ts`. |

## Regression Check
| Feature | Result |
|---|---|
| `playwright-tests/membership-task7-task9.spec.ts` (adjacent story, unaffected) | ✅ PASS — file present, untouched, 9 `test(` blocks intact |
| `src/proxy.ts` / auth routes / page protection | ✅ PASS — zero diff on `src/proxy.ts`; `/venue` was already public, not in `PROTECTED_PAGES`/matcher, confirmed still absent |
| No other component/page references the deleted venue files | ✅ PASS — repo-wide grep for `venue` in `src/components`/`src/app` outside `venue/` dirs returns nothing |
| `npm run lint` | ✅ PASS — clean, no errors/warnings |
| `npx tsc --noEmit` (via `npm run build`) | ✅ PASS — clean |
| `npm run build` | ✅ PASS — succeeds; all routes render, `/venue` static-prerendered |

## Security Test
- Sensitive data exposure: PASS — no secrets/tokens/credentials in new files; no logging added
- Input validation: PASS — pointer coordinates NaN/Infinity-guarded (`safeNumber`), snapped to 0.5m grid, clamped to `[0,50]` at every mutation entry point in `plan.ts`
- Auth boundary: N/A — `/venue` is a public page, no auth surface touched, `src/proxy.ts` diff is empty, no new API routes

## Bugs Found

No Critical, High, or Medium bugs found. Both Should-Fix issues from `review-report.md` (iteration 1) were verified fixed in code:

1. **Review Issue 1 (edge-insert distance threshold)** — Confirmed fixed. `handleEdgeDblClick` now no-ops when `findClosestEdge` distance exceeds 0.5m before ever calling `insertVertexOnEdge`.
2. **Review Issue 2 (stale `selectedVertex` after deletion)** — Confirmed fixed. `handleVertexContextMenu` now shifts `selectedVertex` down by one when a lower-index vertex is deleted, clears it when the deleted vertex was itself selected, and leaves it unchanged otherwise — matching the review's suggested fix exactly.

### Bug 1 (Low, non-blocking): Keyboard-delete unconditionally clears `selectedVertex` even on a rejected (3-vertex-floor) deletion
- **Severity**: Low
- **Acceptance Criterion affected**: AC 6 (3-vertex floor rejects deletion) — functionally still passes (vertex count/positions unchanged), but a secondary UI-state side effect occurs
- **Steps to Reproduce**:
  1. Reduce polygon to exactly 3 vertices.
  2. Click a vertex to select it (`selectedVertex` set).
  3. Press `Delete` or `Backspace`.
- **Expected**: Since `removeVertex` no-ops at the 3-vertex floor, no state should change, including selection (arguably).
- **Actual**: `handleKeyDown` (PlanEditor.tsx:126-135) calls `setSelectedVertex(null)` unconditionally after calling `removeVertex`, even when `next === polygon` (rejected, no-op). The visual highlight on the selected vertex disappears even though nothing was actually deleted.
- **Impact**: Purely cosmetic/UX — no data corruption, no AC violation (polygon data and vertex count remain correct per spec wording, which only requires the polygon to still have 3 vertices). Does not block sign-off; logged for visibility. Does not require an implement-stage loop.

## Test Coverage
- New code coverage: `plan.ts` fully exercised via 21 targeted node-replay assertions (snap/clamp/NaN-safety, edge-detection incl. closing edge, insert incl. degenerate no-op at both endpoints, remove incl. floor guard and index-0/last-index reconnection, move/clamp extremes, scale conversions, default floor shape) — effectively 100% of exported pure-function branches. `PlanEditor.tsx`/`PlanEditorLoader.tsx`/`page.tsx` verified via full code read + `npm run build` (proves render/SSR path) + manual checklist (`manual-tests/venue-plan-editor.md`, visual/feel items) — no unit framework exists in this repo per AGENTS.md, so interactive DOM/canvas behavior verification is deferred to the `playwright` stage as designed.
- Minimum required: manual checklist or Playwright coverage for all new logic (per AGENTS.md QA Agent section / Testing Requirements)
- Status: PASS — manual checklist exists and covers all visual/feel items; Playwright specs for interactive ACs are the explicit next pipeline stage (already scoped in architect-plan.md Test Plan, not yet authored — expected, not a gap at this stage)

## Outcome
✅ QA sign-off granted. Feature meets all 9 acceptance criteria, all edge cases hold, no regressions, no Critical/High/Medium bugs (one Low, non-blocking UX note logged above). Routing to `playwright` stage for live-browser confirmation of drag/snap/insert/delete interactions and visual gridlines/scale.

## Playwright E2E Results
> Executed: 2026-07-13T00:05:00+08:00

New spec files (old grid-cell spec + page object were deleted in this task, per orchestrator-output.md replacement scope):
- `playwright-tests/venue-plan-editor.spec.ts`
- `playwright-tests/pages/PlanEditorPage.ts`

Testability approach: the `[data-testid="plan-editor"]` wrapper exposes live `data-vertex-count`/`data-vertices` (JSON, meters)/`data-px-per-meter`/`data-stage-size`. The page object owns meter→px conversion (no stage offset — meter (0,0) maps directly to the wrapper's top-left, scaled by `data-px-per-meter`) and drives drags/dblclicks/right-clicks via `page.mouse` at computed screen coordinates.

| Test | Acceptance Criterion | Result | Duration |
|---|---|---|---|
| AC1: canvas loads with gridlines/scale | Konva canvas renders, light background, fixed fit-to-screen scale (stage size / px-per-meter = 50m) | ✅ PASS | 1.1s |
| AC2: default 10x10 square, centered | 4 vertices, 10x10m bounding box, centroid ≈ (25,25) | ✅ PASS | 853ms |
| AC3: drag vertex snaps to 0.5m | Dragged vertex 0 to (23.2, 21.3) → snapped to (23, 21.5) | ✅ PASS | 1.0s |
| AC7 (bounds): drag far outside clamps | Dragged vertex 2 to (120, -30) → clamped to (50, 0), no NaN | ✅ PASS | 1.0s |
| AC4: dblclick edge midpoint inserts vertex | Right edge midpoint (30,25) insertion → count 4→5, new vertex present | ✅ PASS | 877ms |
| AC5/edge-case: dblclick deep inside is no-op | Center (25,25), >0.5m from all edges → count stays 4 | ✅ PASS | 863ms |
| AC5/AC6: right-click deletes vertex, floors at 3 | Repeated right-click 4→3, extra right-click at 3 stays 3 | ✅ PASS | 913ms |
| AC8: concave edit renders without crash | Dragged vertex 1 to (24,24), no pageerror events, canvas still visible | ✅ PASS | 1.0s |
| AC9: old grid-cell editor fully removed | No `venue-grid` testid, no `面積統計` text; old files confirmed absent from src/ | ✅ PASS | 858ms |

9/9 passed. No failures, no console/page errors observed.

### Failures
None.
