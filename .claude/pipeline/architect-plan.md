# Architect Plan — 依平面圖資料建立 3D 白模 (Three.js + react-three-fiber)

> Story: 場地白模產生器 (階段一) | Task type: FRONTEND | Generated: 2026-07-14T03:00:00+08:00

## Overview

Add a pure client-side, snapshot-on-click 3D whitebox generator to the `/venue` page. `PlanEditor.tsx` gains a "產生 3D 模型" button and a `sceneSnapshot` + `generation` counter pair of state. Clicking the button copies the current `polygon`/`walls`/`columns` into `sceneSnapshot` and bumps `generation`; a new `VenueSceneLoader` (mirroring `PlanEditorLoader`'s `dynamic(..., { ssr: false })` pattern) mounts a `VenueScene` R3F `<Canvas>` below the existing Konva canvas only once `sceneSnapshot` is non-null, keyed by `generation` so every regeneration fully unmounts/remounts the scene (guaranteeing no stale mesh accumulation). `VenueScene` is a pure function of its snapshot props — no live subscription to `PlanEditor`'s live state — which satisfies the "no live sync" AC by construction rather than by extra guard logic.

## Task Type Confirmed

FRONTEND

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/components/venue/VenueScene.tsx` | R3F `<Canvas>` scene: builds floor `ExtrudeGeometry`, per-wall `BoxGeometry`, per-column `BoxGeometry` meshes from a snapshot of `{ polygon, walls, columns }` passed in as props. Exposes a `data-testid="venue-scene"` wrapper `<div>` around the `<Canvas>` with `data-*` attributes for Playwright (Canvas/WebGL content itself is opaque to Playwright, same constraint as the Konva `<canvas>`). |
| `src/components/venue/VenueSceneLoader.tsx` | Client-only loader: `dynamic(() => import("./VenueScene"), { ssr: false, loading: ... })`, same shape as `PlanEditorLoader.tsx`. Forwards `polygon`/`walls`/`columns`/`generation` props through. |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/components/venue/PlanEditor.tsx` | Add `sceneSnapshot` state (`{ polygon: FloorPolygon; walls: WallSegment[]; columns: Column[] } \| null`, initial `null`) and `generation` state (`number`, initial `0`). Add a "產生 3D 模型" button (standalone action row directly in `PlanEditor.tsx`, not inside `PlanToolbar` — see Architecture Notes). Wire `onClick` to a `handleGenerate3D` function that snapshots current `polygon`/`walls`/`columns` into `sceneSnapshot` and increments `generation`. Button `disabled={walls.length === 0 && columns.length === 0}`. Conditionally render `<VenueSceneLoader key={generation} polygon={sceneSnapshot.polygon} walls={sceneSnapshot.walls} columns={sceneSnapshot.columns} />` below the existing `<Stage>` (still inside the same wrapper `<div data-testid="plan-editor">`) only when `sceneSnapshot !== null`. |
| `package.json` / `package-lock.json` | Add `three`, `@react-three/fiber`, `@react-three/drei` to `dependencies` via `npm install three @react-three/fiber @react-three/drei` (installed together per orchestrator spec even though `drei` is unused until Task 5). |
| `manual-tests/venue-plan-editor.md` | Append a new `## Task 4 — 3D 白模產生器` section with visual/feel checks Playwright can't assert (see Test Plan below). |

## Implementation Steps

1. Run `npm install three @react-three/fiber @react-three/drei` at the repo root. Verify `package.json`/`package-lock.json` picked up all three packages and no peer-dependency warnings block install (React 19 + latest `@react-three/fiber`/`three` should be compatible; if npm reports a peer conflict, use `--legacy-peer-deps` only as a last resort and flag it in the plan's Architecture Notes retroactively — do not silently swallow the warning).

2. Create `src/components/venue/VenueScene.tsx`:
   - `"use client"` directive (R3F requires DOM/WebGL APIs unavailable during SSR).
   - Props: `interface VenueSceneProps { polygon: FloorPolygon; walls: WallSegment[]; columns: Column[]; }` (import types from `@/lib/venue/plan`).
   - Import `Canvas` from `@react-three/fiber`, `THREE` (`import * as THREE from "three"`) for `THREE.Shape`/`ExtrudeGeometry`.
   - **Floor mesh**: build a `THREE.Shape` from `polygon` points using the "extrude in local XY, then lay flat" technique: construct the `Shape` in its native XY plane using `(p.x, p.y)` directly (`shape.moveTo(polygon[0].x, polygon[0].y); polygon.slice(1).forEach(p => shape.lineTo(p.x, p.y)); shape.closePath();`), extrude with `new THREE.ExtrudeGeometry(shape, { depth: FLOOR_THICKNESS_M, bevelEnabled: false })`, then rotate the resulting `<mesh>` `-Math.PI / 2` about the X axis so the shape's local XY plane becomes world XZ (rotating the mesh, not the Shape's points, avoids re-deriving signed-area/winding math). After rotation, `ExtrudeGeometry`'s default depth direction (local +Z, which becomes world -Y after the -90° X rotation) extrudes downward from y=0, matching the "top face at y=0, bottom face at y=-0.1" requirement — verify this sign in step 8's manual smoke check and flip the rotation sign or negate `depth` if the slab lands above y=0 instead. Material: `<meshStandardMaterial color="#f5f5f4" side={THREE.DoubleSide} />` (`DoubleSide` avoids a black/invisible top face if the rotation ends up flipping the shape's winding order).
   - **Wall meshes**: `walls.map(wall => ...)` — one `<mesh>` per wall, `key={wall.id}`, `<boxGeometry args={[wallLengthM(wall), WALL_HEIGHT_M, WALL_THICKNESS_M]} />`, `position={[(wall.start.x + wall.end.x) / 2, WALL_HEIGHT_M / 2, (wall.start.y + wall.end.y) / 2]}` (plan y -> Three z), `rotation={[0, -Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x), 0]}` (negative sign because Three's Y-axis rotation follows the right-hand rule in a Z-forward/X-right/Y-up frame, which is the mirror image of the plan's X-right/Y-down 2D angle convention — this must be verified visually per Edge Case 5, see step 8). Material `#78350f`.
   - **Column meshes**: `columns.map(col => ...)` — one `<mesh>` per column, `key={col.id}`, `<boxGeometry args={[col.w, WALL_HEIGHT_M, col.h]} />`, `position={[col.center.x, WALL_HEIGHT_M / 2, col.center.y]}`. Material `#78716c`.
   - Local constants: `const WALL_HEIGHT_M = 3;` `const FLOOR_THICKNESS_M = 0.1;` (co-located in this file since `plan.ts` deliberately has no height field — per orchestrator's Out of Scope).
   - Lighting/camera: `<ambientLight intensity={0.6} />`, `<directionalLight position={[25, 40, 25]} intensity={0.8} />`, and a `<Canvas camera={{ position: [VENUE_SIZE_M * 0.7, VENUE_SIZE_M * 0.9, VENUE_SIZE_M * 0.7], fov: 50 }}>` (or equivalent static framing constant) sufficient to see the 50x50m bounds — no `OrbitControls` (Task 5 scope).
   - Root render: a wrapper `<div data-testid="venue-scene" data-generated="true" data-wall-mesh-count={walls.length} data-column-mesh-count={columns.length} data-floor-vertex-count={polygon.length} className="mt-4 h-[480px] w-full overflow-hidden rounded border border-stone-300 bg-stone-100">` containing the `<Canvas>`. See Testability section for why these attributes exist and are sufficient.
   - Wrap the `<Canvas>` return (or the whole component body) so a WebGL init failure doesn't crash the page: R3F's `<Canvas>` already catches context-creation errors internally and renders a blank canvas rather than throwing synchronously in most browsers, but as defense-in-depth confirm in manual testing (step 8) that a forced low-level failure doesn't take down `PlanEditor` — per orchestrator's Error States section ("console error is acceptable as a baseline"), do not over-build a fallback UI.

3. Create `src/components/venue/VenueSceneLoader.tsx`:
   - `"use client"` directive, `dynamic(() => import("./VenueScene"), { ssr: false, loading: () => <div className="flex h-[480px] w-full items-center justify-center rounded border border-stone-200 bg-stone-50 text-sm text-stone-500">載入中…</div> })`, forwarding `polygon`/`walls`/`columns` props straight through — same shape as `PlanEditorLoader.tsx`.

4. Modify `src/components/venue/PlanEditor.tsx`:
   - Import `VenueSceneLoader` from `./VenueSceneLoader`.
   - Add two new `useState` hooks near the existing `walls`/`columns` state:
     ```ts
     const [sceneSnapshot, setSceneSnapshot] = useState<{
       polygon: FloorPolygon;
       walls: WallSegment[];
       columns: Column[];
     } | null>(null);
     const [generation, setGeneration] = useState(0);
     ```
   - Add `handleGenerate3D`:
     ```ts
     function handleGenerate3D() {
       setSceneSnapshot({ polygon, walls, columns });
       setGeneration((g) => g + 1);
     }
     ```
     (Object literal copies the current array references — `polygon`/`walls`/`columns` are already replaced wholesale, never mutated in place, by every setter in `plan.ts`/`PlanEditor.tsx`, so a shallow copy is a safe, sufficient snapshot; no deep clone needed.)
   - Compute `const canGenerate3D = walls.length > 0 || columns.length > 0;` (equivalent to the spec's `!(walls.length === 0 && columns.length === 0)`, written the readable way).
   - Render the button. Recommendation (see Architecture Notes): add it directly in `PlanEditor.tsx`'s JSX as a standalone action row between `<PlanToolbar />` and `<Stage>`, NOT inside `PlanToolbar.tsx` — `PlanToolbar` is a controlled, stateless mode-switch component (`select`/`wall`/`column` + delete) with no knowledge of `sceneSnapshot`/3D concerns; adding a 3D-scene-specific button there would leak an unrelated concern into a component whose current props (`mode`, `onModeChange`, `canDelete`, `onDelete`) are all 2D-editor-mode-specific.
     ```tsx
     <button
       type="button"
       data-testid="generate-3d-button"
       disabled={!canGenerate3D}
       onClick={handleGenerate3D}
       className="mb-2 rounded border border-stone-300 bg-white px-3 py-1 text-sm font-medium text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
     >
       產生 3D 模型
     </button>
     ```
   - Render the scene conditionally, after `</Stage>` but still inside the wrapper `<div data-testid="plan-editor" ...>` (satisfies "below the existing 2D Konva canvas"; keeping it inside the same tracked wrapper is simplest since the wrapper already carries `tabIndex`/`onKeyDown` for the Delete-key handler and nesting doesn't interfere with that):
     ```tsx
     {sceneSnapshot && (
       <VenueSceneLoader
         key={generation}
         polygon={sceneSnapshot.polygon}
         walls={sceneSnapshot.walls}
         columns={sceneSnapshot.columns}
       />
     )}
     ```
   - Add `data-scene-generated={sceneSnapshot !== null}` and `data-generation={generation}` to the existing wrapper `<div data-testid="plan-editor" ...>`'s attribute list (alongside `data-wall-count`, `data-column-count`, etc.) so Playwright can assert generation state without querying into the (canvas-opaque) scene subtree, consistent with how `data-wall-count`/`data-column-count` already summarize Konva-canvas-opaque state today.

5. No changes needed to `src/app/venue/page.tsx` — `PlanEditor.tsx` owns the new button/canvas internally, consistent with how it already owns `PlanToolbar` and the Konva `<Stage>`.

6. Run `npm run lint` and fix any TypeScript/ESLint issues (strict mode — ensure all new props/state are explicitly typed, no `any`).

7. Manual dev-server smoke check (not automated, but required before declaring the task done — this is where the two sign-convention risks flagged in step 2 get resolved):
   - Confirm the floor slab's top face renders at y=0 and extrudes downward (not upward) — adjust the rotation sign/depth-negation in `VenueScene.tsx` if inverted.
   - Draw one non-axis-aligned wall (e.g. diagonal) in the 2D editor, generate the 3D scene, and visually confirm the 3D box's long axis lies along the same diagonal as the 2D segment, not perpendicular to it — adjust the wall rotation sign in `VenueScene.tsx` if inverted (per Edge Case 5 in orchestrator-output.md).

8. Write the Playwright spec `playwright-tests/venue-3d-scene.spec.ts` and extend `playwright-tests/pages/PlanEditorPage.ts` with the new accessors listed in the Test Plan below.

9. Append the `## Task 4 — 3D 白模產生器` section to `manual-tests/venue-plan-editor.md`.

## Data Flow

```
PlanEditor (owns polygon/walls/columns — live, mutated by 2D editing gestures)
        |
        | user clicks "產生 3D 模型"
        v
handleGenerate3D()
  -> setSceneSnapshot({ polygon, walls, columns })   // shallow copy, frozen at click time
  -> setGeneration(g => g + 1)                       // forces full remount on next click too
        |
        v
{sceneSnapshot && <VenueSceneLoader key={generation} polygon=... walls=... columns=... />}
        |
        | dynamic(..., { ssr: false }) — client-only chunk load
        v
VenueScene (pure render of the snapshot props it received — no subscription back to
            PlanEditor's live polygon/walls/columns state)
  -> THREE.Shape + ExtrudeGeometry  (floor, 1 mesh)
  -> BoxGeometry per wall            (walls.length meshes)
  -> BoxGeometry per column          (columns.length meshes)
```

Editing the 2D plan after a click mutates `polygon`/`walls`/`columns` in `PlanEditor`, but `sceneSnapshot` is untouched until the button is clicked again — `VenueScene` never re-renders from that edit (React only re-renders it when its own props, i.e. `sceneSnapshot.*`, change). The `key={generation}` on `VenueSceneLoader` additionally guarantees that even though `VenueScene`'s internal `<mesh>` list is keyed by `wall.id`/`col.id` (which would otherwise let React diff/patch matching keys across generations), a full unmount+remount happens on every click, so the "no stale meshes left behind" and "rapid double-click doesn't leave duplicates" ACs hold structurally rather than relying on `three`/R3F cleanup being perfect on a partial diff.

## Testability

Canvas/WebGL content is opaque to Playwright (same constraint the Konva `<canvas>` already has, per `PlanEditorPage.ts`'s existing doc comment). Following the established pattern (`data-wall-count`, `data-vertices`, `data-objects` JSON on the `plan-editor` wrapper), expose:

- On the `plan-editor` wrapper (`PlanEditor.tsx`): `data-scene-generated` (`"true"`/`"false"`), `data-generation` (integer, increments every click — lets a test assert regeneration happened even when mesh counts are unchanged between two clicks).
- The "產生 3D 模型" button: `data-testid="generate-3d-button"`, using the native `disabled` HTML attribute (Playwright's `toBeDisabled()`/`isDisabled()` reads this directly — no extra data attribute needed).
- On `VenueScene.tsx`'s wrapper `<div data-testid="venue-scene">`: `data-generated="true"` (presence of the element itself already implies this, but keeping it explicit matches the "assert scene mounted" pattern used elsewhere), `data-wall-mesh-count`, `data-column-mesh-count`, `data-floor-vertex-count` — sufficient to assert mesh counts match the 2D state at generation time, and (combined with `data-generation` on the outer wrapper) to assert regeneration replaced rather than appended (count stays correct after a second generation with a different wall/column count, rather than summing).

This is sufficient to cover every Clarified AC without needing to inspect the WebGL canvas pixel buffer: existence of `[data-testid="venue-scene"]` = canvas mounted; its absence before the first click = "not just hidden, not mounted at all"; `data-wall-mesh-count`/`data-column-mesh-count` after edits + re-click = "rebuilt from scratch, not stale"; `data-scene-generated`/button `disabled` on the outer wrapper = enable/disable state independent of whether a scene has ever been generated.

## Test Plan

### Unit tests
None — no unit/integration JS test framework installed for this project (per AGENTS.md); this is a FRONTEND task and Playwright is the acceptance gate.

### Playwright — new file `playwright-tests/venue-3d-scene.spec.ts`

First, extend `playwright-tests/pages/PlanEditorPage.ts` with:
- `readonly generateButton: Locator` (`[data-testid="generate-3d-button"]`)
- `readonly scene: Locator` (`[data-testid="venue-scene"]`)
- `async clickGenerate3D()` — clicks `generateButton`
- `async sceneGenerated(): Promise<boolean>` — reads `data-scene-generated` off the `plan-editor` wrapper
- `async generationCount(): Promise<number>` — reads `data-generation`
- `async sceneWallMeshCount(): Promise<number>` / `async sceneColumnMeshCount(): Promise<number>` / `async sceneFloorVertexCount(): Promise<number>` — read the corresponding `data-*` off `[data-testid="venue-scene"]`

Test cases (map directly to Clarified Acceptance Criteria):
1. On fresh page load (default floor, no walls/columns): `generateButton` is visible and disabled; `[data-testid="venue-scene"]` does not exist in the DOM at all.
2. After drawing one wall (reuse `PlanEditorPage.wallTool()` + `drawWall()` from Task 2/3 helpers): `generateButton` becomes enabled.
3. Click `generateButton`: `[data-testid="venue-scene"]` appears; `data-scene-generated="true"` on the wrapper; `sceneWallMeshCount() === 1`, `sceneColumnMeshCount() === 0`, `sceneFloorVertexCount() === 4` (default floor).
4. Edit the 2D plan after generation (add a column) without re-clicking: assert `sceneWallMeshCount()`/`sceneColumnMeshCount()` on `[data-testid="venue-scene"]` are unchanged (still reflect the pre-edit snapshot) — proves no live sync.
5. Click `generateButton` again after the edit: `data-generation` increments; `sceneColumnMeshCount()` now reflects the added column — proves regeneration picks up new state and replaces rather than appends (re-assert wall count too, to rule out double-counting).
6. Delete all walls/columns back to floor-only after having generated once: `generateButton` becomes disabled again; `[data-testid="venue-scene"]` still exists (existing scene is left as-is, not retroactively cleared).
7. Rapid double-click on `generateButton` (`Promise.all` of two `click()` calls, or two sequential clicks with no `waitFor` in between): after settling, `data-generation` reflects exactly two increments and mesh counts match the current 2D state exactly once (no duplication) — covers the "rapid repeated clicks" edge case.
8. Concave/irregular floor polygon (drag a vertex inward per the existing Task 1 concave-polygon test pattern in `venue-plan-editor.spec.ts`), then generate: assert no page error/console exception is thrown (`page.on("pageerror")` / `page.on("console", ...)` assertion) and `[data-testid="venue-scene"]` still mounts with `sceneFloorVertexCount()` matching the (now 5-vertex) polygon.
9. SSR sanity: navigating fresh to `/venue` produces no hydration-mismatch console error (assert via `page.on("console")` filtering for React hydration warnings, or reuse an existing pattern from `venue-plan-editor.spec.ts` if one already checks this for the Konva canvas).

### Edge cases to test (from orchestrator-output.md `Edge Cases to Handle`)
- Concave/zig-zag polygon does not crash generation (case 8 above).
- Rapid double-click does not duplicate meshes (case 7 above).
- Non-axis-aligned wall rotation direction — Playwright cannot visually verify rotation correctness (opaque canvas), so this remains a **manual** check (see manual-tests update below and step 8 of Implementation Steps); Playwright only asserts the mesh count/existence, not visual orientation.
- Zero-length wall: no test needed — `plan.ts`'s `createWall`/`moveWallEndpoint` already reject same-start/end points at the data layer (confirmed in orchestrator-output.md), so this can't reach `VenueScene`.

## Architecture Notes

- **Button placement**: chosen to live in `PlanEditor.tsx` directly (not `PlanToolbar.tsx`) to keep `PlanToolbar` scoped to 2D-editor-mode concerns only, per existing modularity boundaries in the codebase (`PlanToolbar` takes `mode`/`onModeChange`/`canDelete`/`onDelete` — all 2D-mode props). This is a deviation-adjacent judgment call flagged per AGENTS.md's "no deviations without flagging" rule, but it is additive (no existing `PlanToolbar` prop or behavior changes) and consistent with the single-responsibility split already established between `PlanEditor` (state owner) and `PlanToolbar` (dumb mode-switch UI).
- **Snapshot-not-live-sync** is implemented structurally (separate `sceneSnapshot` state copied only inside `handleGenerate3D`) rather than via a dirty-flag/guard — this is the simplest correct implementation of the spec's explicit no-live-sync requirement and avoids a class of stale-closure bugs a guard-based approach could introduce.
- **Full-replace-not-append** is implemented via `key={generation}` forcing an unmount/remount of the entire `VenueSceneLoader`/`VenueScene` subtree on every click, rather than relying on React's key-based reconciliation of individual `<mesh>` elements (which, if `wall.id`s partially overlap across generations, could in principle patch instead of replace some meshes — not a correctness bug per se, but the `key={generation}` approach is simpler to reason about and matches "stale meshes are not left behind" as a structural guarantee rather than an emergent property of correct id stability).
- **Known risk — wall rotation sign convention**: the orchestrator explicitly left the sign/axis convention as "architect's/developer's call as long as walls visually align" (Edge Case 5). Step 2 above proposes `rotation={[0, -Math.atan2(dy, dx), 0]}` as the starting guess (negated because Three's right-hand Y-rotation and the 2D plan's screen-space angle convention are mirror images of each other), but this **must** be verified visually per Implementation Step 7 before the task is considered done — Playwright cannot verify visual orientation (opaque canvas), so this is a manual gate, not an automated one.
- **Known risk — floor extrusion direction**: similarly, `ExtrudeGeometry`'s default depth direction combined with the `-90°` X-axis mesh rotation needs one manual visual check to confirm the slab extrudes downward from y=0 as specified, not upward. Flagged in Implementation Step 2 and re-confirmed in Step 7.
- **Performance**: "dozens of walls/columns" is explicitly acceptable to render via React's normal path per orchestrator's Edge Cases section — no instancing/merging is implemented (also explicitly Out of Scope). No performance work needed beyond what's specified.
- **WebGL failure resilience**: per orchestrator's Error States section, a console error is an acceptable baseline; no explicit WebGL-availability check or fallback UI is being added. If `npm install` or local testing reveals `@react-three/fiber`'s `<Canvas>` throws synchronously in a way that crashes `PlanEditor` (rather than degrading gracefully), that would be a scope-affecting finding to flag to the human before proceeding further — not expected, since R3F's `Canvas` is designed to isolate WebGL context-creation failures internally, but noted as a residual risk.

## Security Checklist

- [x] No hardcoded secrets or credentials — this task adds no env vars, no API calls, no credentials of any kind.
- [x] Input validation implemented at system boundaries — N/A: all geometry input is already validated/clamped by `plan.ts` (existing `snapPoint`/`clampToBounds`/`clampColumnCenter` etc.); `VenueScene` performs no new user-input parsing.
- [x] Auth/permission checks in place (if applicable) — N/A: `/venue` has no auth gate today (not in `PROTECTED_PAGES`), and this task doesn't change that; no new API routes are introduced.
- [x] No sensitive data logged — no logging is added by this task at all.
- [x] No new API routes, no `DATABASE_URL`/session/auth-adjacent code touched — confirms this task does NOT trigger the PR Reviewer's automatic 🔴 Critical rule in AGENTS.md.

## Definition of Done

- [ ] `three`, `@react-three/fiber`, `@react-three/drei` installed and present in `package.json`/`package-lock.json`.
- [ ] `src/components/venue/VenueScene.tsx` and `src/components/venue/VenueSceneLoader.tsx` created per Implementation Steps 2-3.
- [ ] `src/components/venue/PlanEditor.tsx` updated per Implementation Step 4 (button, snapshot state, generation counter, conditional scene render, new `data-*` attributes).
- [ ] `npm run lint` passes with no new errors/warnings.
- [ ] Manual smoke check (Implementation Step 7) confirms floor extrusion direction and wall rotation sign are visually correct — adjust code if either is inverted.
- [ ] `playwright-tests/venue-3d-scene.spec.ts` written per Test Plan and passing against a live dev server.
- [ ] `playwright-tests/pages/PlanEditorPage.ts` extended with the new accessors listed in Test Plan.
- [ ] `manual-tests/venue-plan-editor.md` updated with the new `## Task 4 — 3D 白模產生器` section.
- [ ] No TODOs, commented-out code, or debug logs.
- [ ] Code follows all rules in AGENTS.md (path alias `@/*`, ESLint core-web-vitals+typescript, no inline Supabase/API concerns — N/A here since this task touches neither).
- [ ] Security checklist passed.
