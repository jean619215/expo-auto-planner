# Orchestrator Output — 依平面圖資料建立 3D 白模

> Story: 場地白模產生器 (階段一) | Task 4 of 5 | Generated: 2026-07-14T00:00:00+08:00

## Task Type
FRONTEND

## Refined Requirement
Add a one-click "產生 3D 模型" action to the venue editor page that builds a Three.js whitebox scene from the current 2D floor-plan state (`FloorPolygon`, `WallSegment[]`, `Column[]` from `src/lib/venue/plan.ts`), using `three` + `@react-three/fiber` (+ `@react-three/drei`, installed now though unused until Task 5).

**Scope note vs. Tasks 1-3 change history**: the 3D approach (fixed 3m height, 0.1m floor slab, palette) was decided before the 2D editor pivoted from a grid-cell model to the current polygon/line-segment/object model. This task re-confirms those decisions still hold and restates the "no merge, one mesh per primitive" construction principle in terms of the current data shapes (polygon extrusion, per-segment wall boxes, per-instance column boxes) instead of the old per-cell boxes.

**Dependencies**: install `three`, `@react-three/fiber`, `@react-three/drei` together in this task.

**Component structure**: follow the existing `PlanEditorLoader.tsx` pattern — a new client-only loader component wrapping `dynamic(() => import('./VenueScene'), { ssr: false })` (or equivalent name, architect's call), since R3F/Three cannot SSR. The R3F `<Canvas>` scene component reads the current `polygon`, `walls`, `columns` state (lifted or passed down from wherever `PlanEditor.tsx` currently owns it) and builds the whitebox on demand — not continuously live-synced; regeneration only happens when the button is pressed (see Clarified AC below for the "on demand" semantics).

**Geometry construction** (meters, consuming `plan.ts` types directly — no unit conversion):
- **Floor**: build a `THREE.Shape` from the `FloorPolygon` points (in the XZ plane, y=0 top surface), extrude with `ExtrudeGeometry({ depth: 0.1, bevelEnabled: false })`, oriented/translated so the extrusion goes downward (top face at y=0, bottom face at y=-0.1). One mesh for the whole floor (single `Shape`, not one per triangle/edge).
- **Walls**: for each `WallSegment` in `walls`, one `BoxGeometry` sized `[wallLengthM(wall), 3, WALL_THICKNESS_M]` (length × height × thickness), positioned at the segment's midpoint `{(start.x+end.x)/2, 1.5, (start.y+end.y)/2}` (Three Y-up; plan-space y maps to Three Z), rotated about the Y axis by the segment's angle (`Math.atan2(end.y - start.y, end.x - start.x)` or equivalent, sign/axis convention is the architect's/developer's call as long as walls visually align with their 2D line segments). One mesh per wall, no merging.
- **Columns**: for each `Column` in `columns`, one `BoxGeometry` sized `[col.w, 3, col.h]`, positioned at `{col.center.x, 1.5, col.center.y}`. One mesh per column, no merging/instancing.
- Height is fixed at 3m for both walls and columns regardless of any per-instance data (there is no per-instance height field on `WallSegment`/`Column` — only `w`/`h` footprint on `Column`). No doors/windows/openings.

**Materials/colors** (flat `MeshStandardMaterial`, no textures, matching the 2D Konva palette):
- Floor: `#f5f5f4`
- Walls: `#78350f`
- Columns: `#78716c`

**Trigger — "產生 3D 模型" button**:
- Rendered on the venue editor page (`src/app/venue/page.tsx` / `PlanEditor.tsx` composition, architect's call on exact placement, e.g. a toolbar/action bar).
- Disabled when `walls.length === 0 && columns.length === 0`. Floor always exists (`DEFAULT_FLOOR` guarantees at least the default polygon), so floor-only state does NOT count as empty — the button stays enabled once at least one wall or column exists, even with the default floor untouched.
- On click, the 3D scene is (re)generated from the current 2D state at that moment (a snapshot-on-click, not a live-bound continuous sync — editing the 2D plan after generating does not retroactively update an already-rendered 3D scene until the button is pressed again). This scopes out needing a live-diffing/reactive 3D sync mechanism, which is not required by the story's acceptance criteria for this task.
- Clicking the button renders/mounts the 3D canvas **below** the existing 2D Konva canvas on the same page — both remain visible simultaneously. No toggle/tab/replace behavior in this task; that switching UX belongs to Task 5. Before the first click, no 3D canvas is mounted at all (not just hidden) — clicking mounts it, and subsequent clicks re-generate its contents in place.
- No lighting/camera-orbit polish requirement beyond what's needed to visually verify the geometry landed (basic ambient + directional light and a static default camera position framing the 50x50m bounds are sufficient; orbit controls are explicitly Task 5).

## Clarified Acceptance Criteria
- [ ] Given the venue editor page has loaded with the default floor polygon and no walls/columns, when the user views the page, then the "產生 3D 模型" button is visible but disabled.
- [ ] Given the user has added at least one wall OR one column (via existing Task 2 tools), when the user views the page, then the "產生 3D 模型" button becomes enabled.
- [ ] Given the button is enabled, when the user clicks "產生 3D 模型", then a Three.js/R3F canvas mounts below the 2D Konva canvas, rendering: the current floor polygon as a 0.1m-thick extruded slab (top face at y=0, color `#f5f5f4`), each current wall as a box sized to its length × 3m × 0.2m positioned/rotated along its 2D segment (color `#78350f`), and each current column as a box sized to its `w` × 3m × `h` footprint positioned at its 2D center (color `#78716c`).
- [ ] Given the 3D canvas has been generated once, when the user edits the 2D plan (moves/adds/removes a wall, column, or floor vertex) without clicking the button again, then the already-rendered 3D scene does NOT change (no live sync).
- [ ] Given the 3D canvas has been generated once, when the user edits the 2D plan and clicks "產生 3D 模型" again, then the 3D scene is rebuilt from scratch to reflect the current 2D state (stale meshes from the prior generation are not left behind).
- [ ] Given the user removes all walls and columns after having generated a 3D scene (back to floor-only), when state updates, then the button becomes disabled again (existing generated 3D scene, if any, is left as-is — re-disabling the button does not retroactively clear an already-rendered scene).
- [ ] Given the floor polygon is a concave/irregular shape (per Task 1), when the 3D scene is generated, then the floor slab extrusion follows the concave outline correctly (via `ExtrudeGeometry`/`Shape`, not a bounding-box approximation).
- [ ] Given the page is server-rendered (Next.js App Router), when the page first loads, then no SSR error/mismatch occurs from the Three.js/R3F canvas (client-only via `dynamic(..., { ssr: false })`, consistent with `PlanEditorLoader.tsx`'s existing pattern).

## Edge Cases to Handle
- Floor polygon with many vertices / highly concave (zig-zag) shapes must still extrude without `ExtrudeGeometry` throwing or producing degenerate/inverted-normal geometry — if `Shape`-from-polygon triangulation has known failure modes (e.g. self-intersecting edges), at minimum it must not crash the page; visual artifacts in a pathological self-intersecting case are acceptable (self-intersection was already out of scope/unvalidated in Task 1).
- A wall with zero or near-zero length cannot occur from `plan.ts` (`createWall`/`moveWallEndpoint` reject same-start/end points), so no defensive handling needed for degenerate wall geometry.
- Very large numbers of walls/columns (e.g. dozens) should still render without the page hanging — acceptable to rely on React/R3F's normal render path since each primitive is already capped by the 50x50m bounds; no special virtualization required for this task.
- Rapid repeated clicks on "產生 3D 模型" (e.g. double-click) must not leave duplicate/overlapping meshes from concurrent generations — regeneration should fully replace the previous scene's meshes each time (e.g. via React key/state replacement, not incremental appends).
- Wall rotation sign/axis convention: ensure the box's long axis actually aligns with the 2D segment direction (verify visually against at least one non-axis-aligned wall) — an inverted or perpendicular rotation would be a functional bug, not just cosmetic.

## Error States
- No network/API calls involved — this is pure client-side geometry generation from in-memory React state, so no server error states apply.
- If Three.js/R3F fails to initialize in the browser (e.g. WebGL unavailable), the failure should not crash the whole page/2D editor — the 3D canvas area may show an empty/broken state, but the 2D editor and rest of the page must remain functional. No specific fallback UI copy is mandated by this task; a console error is acceptable as a baseline, richer UX (e.g. "WebGL not supported" message) is a nice-to-have left to the architect/developer's discretion.

## Out of Scope
- Orbit controls (rotate/zoom the 3D view) — Task 5.
- 2D/3D toggle or replace UX, and any switching flow polish — Task 5.
- Live/reactive sync between 2D edits and an already-rendered 3D scene — explicitly snapshot-on-click only (see AC above).
- Doors, windows, openings, or any wall/column detail beyond flat-color boxes.
- Per-instance wall/column height (all fixed at 3m; no data model change to add a height field).
- Mesh merging/instancing/geometry optimization of any kind.
- Textures, shadows, advanced lighting, materials beyond flat `MeshStandardMaterial`.
- Persistence/database storage of the generated 3D scene or the 2D plan — out of scope for the whole story (階段一).
- Camera framing/animation polish beyond a static default view sufficient to see the generated geometry.

## Assumptions Made
- Button placement (toolbar vs. standalone) and exact loader/component file names (`VenueScene.tsx` or similar) are left to the architect — no user preference stated, follows `PlanEditorLoader.tsx` naming precedent loosely.
- Coordinate mapping: 2D plan-space `(x, y)` maps to Three.js `(x, z)` with plan `y` becoming Three `z`, Three `y` reserved for height/vertical. This is the natural mapping for a top-down floor plan and wasn't separately raised as a question since it has no user-facing behavioral ambiguity — only an internal implementation convention.
- "Snapshot-on-click" (no live sync) is inferred from the story's phrasing ("一鍵「產生 3D 模型」") implying an explicit generate action, not continuous binding; confirmed explicitly by user in the Q&A round (point 7 scoping split), stated here for the architect's benefit since it has real behavioral implications (AC 4 and 5 above).
- Regeneration on repeated clicks fully replaces prior meshes (no accumulation) — treated as an implementation-obvious requirement of a "generate" button, not raised as a separate question.

## Security Notes
No new security-sensitive surface: this task is client-only geometry generation with no new API routes, no auth changes, no data persistence, and no user-supplied external input beyond existing in-memory 2D editor state (already validated/clamped by `plan.ts`). No secrets or credentials involved. Standard Next.js client-component/SSR considerations apply for the Three.js/R3F canvas (client-only rendering via `dynamic(..., { ssr: false })`), consistent with the existing Konva editor's pattern — not a new security concern.
