# Architect Plan — 3D 檢視器整合:orbit controls 旋轉/縮放,2D 編輯與 3D 預覽切換流程

> Story: 場地白模產生器 (階段一) | Task type: FRONTEND | Task 5 of 5 (LAST task of story) | Generated: 2026-07-14T16:00:00+08:00

## Overview

Add constrained `<OrbitControls>` (from `@react-three/drei`, already installed, unused since Task 4) to `VenueScene.tsx`, and restructure `PlanEditor.tsx`'s Task-4 "both canvases stacked, always visible" placeholder into a strict 2-step linear wizard (`edit` → `preview`) driven by a single new `step` state value. The existing "產生 3D 模型" button and its snapshot-on-click generation logic (`sceneSnapshot`/`generation`) are reused unchanged in substance, merely extended to also flip `step` and renamed/retested as `next-step-button`. Task 4's Playwright regression suite (`venue-3d-scene.spec.ts`) is updated in place — several tests' premises (both canvases visible simultaneously) no longer hold under the wizard and must be reworked or removed, not silently left broken.

## Task Type Confirmed

FRONTEND — confirmed, no contradiction found. No new API routes, no auth/data-persistence surface, no backend involvement (matches AGENTS.md's Frontend/Backend split and the orchestrator's Security Notes).

## Files to Create

None. This task modifies existing components only; no new files are needed (no new page, no new lib module — `step` is local UI state colocated with the existing `sceneSnapshot`/`generation` state per AGENTS.md's "no service layer / no premature abstraction" convention).

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/components/venue/VenueScene.tsx` | Import `OrbitControls` from `@react-three/drei`; render it inside `<Canvas>` with the constrained config; add `data-orbit-controls="true"` to the scene container div. |
| `src/components/venue/PlanEditor.tsx` | Add `step` state (`"edit" \| "preview"`); rename `handleGenerate3D` → `handleNextStep` (adds `setStep("preview")`); add `handleBackToEdit`; restructure JSX so `step-edit` (toolbar + button + `<Stage>`) and `step-preview` (`VenueSceneLoader` + back button) are mutually exclusive; rename `data-testid="generate-3d-button"` → `data-testid="next-step-button"`; button label "產生 3D 模型" → "下一步"; add `data-testid="back-to-edit-button"`; add `data-step` attribute to the outer wrapper. |
| `playwright-tests/venue-3d-scene.spec.ts` | Update in place: rework/remove tests whose premise (both canvases visible together) no longer holds; add new step-toggling coverage. Full breakdown in "Playwright spec updates" below. |
| `playwright-tests/pages/PlanEditorPage.ts` | Rename `generateButton` → `nextStepButton` (new selector `next-step-button`), add `backToEditButton`, `stepEdit`, `stepPreview` locators, `orbitControlsPresent()` accessor, `clickNextStep()`/`clickBackToEdit()` methods (renaming `clickGenerate3D`). |
| `manual-tests/venue-plan-editor.md` | Append a new `## Task 5 — 3D 檢視器整合` section covering OrbitControls drag/zoom/pan feel and angle/distance clamping (Playwright cannot verify these — WebGL is opaque). |

## Implementation Steps

### A. `VenueScene.tsx` — OrbitControls

1. Add `import { OrbitControls } from "@react-three/drei";` at the top of `src/components/venue/VenueScene.tsx`, alongside the existing `three`/`@react-three/fiber` imports.
2. Inside the `<Canvas>` element (after the existing `<ambientLight>`/`<directionalLight>`, position doesn't matter since it's a control, not a mesh — place it right after the lights, before `<FloorMesh>`, for readability), add:
   ```tsx
   <OrbitControls
     enableRotate
     enableZoom
     enablePan
     maxPolarAngle={Math.PI / 2 - 0.05}
     minDistance={5}
     maxDistance={150}
     target={[VENUE_SIZE_M / 2, 0, VENUE_SIZE_M / 2]}
   />
   ```
   `VENUE_SIZE_M` is already imported in this file — reuse it, do not hardcode `25`.
3. On the outer `<div data-testid="venue-scene" ...>` container (the one that already carries `data-generated`, `data-wall-mesh-count`, `data-column-mesh-count`, `data-floor-vertex-count`), add a new static attribute `data-orbit-controls="true"`. This is unconditional (OrbitControls is always mounted whenever `VenueScene` renders — there's no "orbit controls failed to load" state to model per the orchestrator's Error States section, WebGL failure is out of scope for richer handling).
4. No other changes to `VenueScene.tsx` — camera `position`, lighting, mesh-building logic are untouched (Task 4 scope).

### B. `PlanEditor.tsx` — 2-step wizard restructure

5. Add a new state declaration next to `sceneSnapshot`/`generation` (around line 94-99):
   ```tsx
   type WizardStep = "edit" | "preview";
   const [step, setStep] = useState<WizardStep>("edit");
   ```
6. Rename `handleGenerate3D` (line 198-201) to `handleNextStep` and extend it:
   ```tsx
   function handleNextStep() {
     setSceneSnapshot({ polygon, walls, columns });
     setGeneration((g) => g + 1);
     setStep("preview");
   }
   ```
   This preserves Task 4's exact snapshot/generation semantics (same synchronous same-click-handler update the orchestrator's edge case requires for the double-click race) and adds the step transition in the same synchronous call — no separate effect, no async gap.
7. Add a new handler:
   ```tsx
   function handleBackToEdit() {
     setStep("edit");
   }
   ```
   Deliberately does **not** touch `sceneSnapshot` or `generation` — per orchestrator spec, going back must not discard/reset 2D state, and per the confirmed edge case, the cached snapshot is irrelevant until the next `handleNextStep` call regenerates it from scratch anyway (Step 2 is unreachable without going through `handleNextStep` again).
8. Restructure the returned JSX (currently lines 375-798). Keep the outer wrapper `<div data-testid="plan-editor" ...>` exactly as-is (all existing `data-*` attributes on it stay — `data-scene-generated={sceneSnapshot !== null}` and `data-generation={generation}` remain on this always-mounted wrapper, unchanged, so they stay assertable regardless of which step is showing). Add one new attribute to this wrapper: `data-step={step}`.
9. Inside the wrapper, replace the current always-rendered "toolbar + button + Stage" block followed by the conditionally-rendered `VenueSceneLoader` with two mutually exclusive conditional blocks:
   ```tsx
   {step === "edit" && (
     <div data-testid="step-edit">
       <PlanToolbar
         mode={mode}
         onModeChange={handleModeChange}
         canDelete={selectedObject !== null}
         onDelete={deleteSelectedObject}
       />
       <button
         type="button"
         data-testid="next-step-button"
         disabled={!canGenerate3D}
         onClick={handleNextStep}
         className="mb-2 rounded border border-stone-300 bg-white px-3 py-1 text-sm font-medium text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
       >
         下一步
       </button>
       <Stage ...>
         {/* unchanged Layer/content from current implementation */}
       </Stage>
     </div>
   )}
   {step === "preview" && sceneSnapshot && (
     <div data-testid="step-preview">
       <button
         type="button"
         data-testid="back-to-edit-button"
         onClick={handleBackToEdit}
         className="mb-2 rounded border border-stone-300 bg-white px-3 py-1 text-sm font-medium text-stone-700"
       >
         返回編輯
       </button>
       <VenueSceneLoader
         key={generation}
         polygon={sceneSnapshot.polygon}
         walls={sceneSnapshot.walls}
         columns={sceneSnapshot.columns}
       />
     </div>
   )}
   ```
   The `sceneSnapshot &&` guard on the preview branch is defensive only (per spec, Step 2 is never reachable without a prior `handleNextStep` call, so `sceneSnapshot` is always non-null whenever `step === "preview"` in practice) — it prevents a theoretical crash if `step` were ever set to `"preview"` by future code without a snapshot, consistent with not trusting invariants silently.
10. Move the entire `<Stage>...</Stage>` JSX block (lines 413-788) unchanged into the `step === "edit"` branch — no changes to any Konva layer/shape logic, event handlers, or geometry math inside it.
11. Double-check `containerRef`/`ResizeObserver` (lines 76, 101-115) still targets the *outer* wrapper (`data-testid="plan-editor"`), which remains mounted in both steps — sizing logic (`stagePx`) needs no change since it only affects the `<Stage>` which is now conditionally rendered but still sized from the same always-mounted container.
12. `handleKeyDown` (Delete/Backspace) stays wired to the outer wrapper's `onKeyDown` as today. It only acts on `selectedObject`/`selectedVertex`, both of which can only be non-null while in `step === "edit"` (2D tools aren't rendered in `step === "preview"`), so no extra guard is needed — leave as-is.
13. Remove the old standalone button block (former lines 404-412) entirely — it's replaced by the button now nested inside the `step === "edit"` branch (step 9 above). Do not leave two buttons or dead code behind.

## Data Flow

1. **Step 1 (edit)**: user interacts with `<Stage>` → local `polygon`/`walls`/`columns` state updates (unchanged from Tasks 1-3).
2. User clicks `next-step-button` → `handleNextStep` synchronously (a) snapshots current `polygon`/`walls`/`columns` into `sceneSnapshot`, (b) increments `generation`, (c) sets `step = "preview"`.
3. React re-renders: `step-edit` branch unmounts (2D `<Stage>` destroyed), `step-preview` branch mounts `VenueSceneLoader` (keyed by `generation`, forcing a fresh `VenueScene` mount — same full-replace pattern as Task 4) with the frozen `sceneSnapshot` values as props.
4. `VenueScene` renders meshes from the snapshot props (unchanged Task 4 logic) plus the new `OrbitControls`, which reads no external state — it's self-contained camera-interaction wiring scoped to the `<Canvas>`.
5. User clicks `back-to-edit-button` → `handleBackToEdit` sets `step = "edit"`. `step-preview` unmounts (3D canvas + WebGL context destroyed — expected cleanup via React unmount, same as any conditionally-rendered R3F tree). `step-edit` remounts with `polygon`/`walls`/`columns` untouched (they were never part of the step transition), so the 2D editor visually resumes exactly where it left off.
6. Repeat from step 2 for regeneration — `sceneSnapshot`/`generation` are overwritten each time `handleNextStep` runs, never merged/appended.

## Test Plan

### Unit tests
None — no unit/integration JS test framework installed per AGENTS.md; this is pure UI state + a declarative R3F prop (`OrbitControls` config), not independently unit-testable logic worth introducing a framework for.

### Playwright spec updates — `playwright-tests/venue-3d-scene.spec.ts`

Modify in place (same file, since it's testing the same button-click-generates flow, just restructured), and rename the `describe` block to `"Venue Plan Editor - Task 4 & 5: 3D whitebox scene + step wizard"` so it's clear both tasks' coverage lives here.

**Tests to change (premise still valid, selectors/assertions need updating):**
1. *"default state: generate button visible and disabled, no scene mounted"* → rename to reference `nextStepButton`; additionally assert `editor.stepEdit` is visible and `editor.stepPreview` has count 0.
2. *"button becomes enabled after adding one wall"* → swap `generateButton` → `nextStepButton`, otherwise unchanged.
3. *"clicking generate mounts the scene with mesh counts matching current 2D state"* → swap to `clickNextStep()`; add assertions that `editor.stepEdit` now has count 0 (2D `<Stage>` unmounted) and `editor.stepPreview` is visible; add assertion `await editor.scene.getAttribute("data-orbit-controls")` equals `"true"`.
8. *"concave floor polygon generates without crashing"* → swap `clickGenerate3D()` → `clickNextStep()`; keep the rest (mesh count, no page errors) — still valid, just relocated to Step 2.
9. *"no hydration-mismatch console errors on fresh page load"* → unaffected, no changes needed (still exercises fresh Step 1 load).

**Tests to remove (premise no longer holds under the wizard — flag explicitly, do not silently drop coverage without a replacement):**
4. *"editing the 2D plan after generation does not change the already-rendered scene"* — under the wizard, the 2D editor and the rendered 3D scene are never visible/interactable at the same time (Step 2 has no 2D tools; going back to Step 1 unmounts the 3D scene). The scenario this test exercised (interleave a 2D edit while a stale 3D scene is still on screen) is now structurally impossible, not just untested. Remove it; its intent ("edits don't retroactively mutate an already-generated scene") is now covered indirectly by test 6 below via the `data-scene-generated`/`data-generation` attributes on the always-mounted wrapper.
7. *"rapid double-click does not duplicate meshes"* — the double-click race no longer targets a stable element: after the first click's synchronous handler runs, `step-edit` (and therefore `next-step-button`) unmounts before a second `.click()` on the same locator can land, so `Promise.all([...click(), ...click()])` against the same locator will error (element detached) rather than exercise the intended race. Remove this specific test. Replace with a **new** test asserting the simpler, now-structurally-guaranteed invariant: a single click transitions atomically (button click → generation+1 AND step flips to preview in the same render, never an intermediate state where generation incremented but step hasn't flipped, or vice versa) — assert both `editor.generationCount()` and `editor.stepPreview` visibility change together after one `click()`. Note in the PR description / architecture notes that the button unmounting after one click is itself the mechanism that makes the old double-click failure mode structurally harder to hit (not proof it's impossible at the raw DOM-event level, but a meaningful mitigation) — flag this nuance for the reviewer rather than claiming it's fully proven.

**New tests to add:**
- *"back-to-edit returns to Step 1 with 2D state fully intact"*: navigate → draw a wall → add a column → `clickNextStep()` → assert `stepPreview` visible/`stepEdit` count 0 → `clickBackToEdit()` → assert `stepEdit` visible/`stepPreview` count 0 → assert `wallCount()`/`columnCount()`/`objects()` unchanged from before advancing.
- *"editing after going back and clicking 下一步 again regenerates from scratch"* (replaces old test 5's intent, reworked for the wizard): navigate → draw one wall → `clickNextStep()` → capture `generationCount()` → `clickBackToEdit()` → add a column → `clickNextStep()` again → assert `generationCount()` incremented by 1 (not more), `sceneWallMeshCount()` and `sceneColumnMeshCount()` reflect the new combined state, `stepPreview` visible again.
- *"deleting all objects, going back, disables 下一步 but leaves the prior generation's data attributes intact"* (replaces old test 6's intent): navigate → draw a wall → `clickNextStep()` → `clickBackToEdit()` → select-tool click on the wall → `pressDelete()` → assert `wallCount()`/`columnCount()` are 0 and `nextStepButton` is disabled → assert `sceneGenerated()` (on the always-mounted `plan-editor` wrapper) is still `true` and `generationCount()` is unchanged (the earlier generation isn't retroactively cleared just because the button is now disabled — it simply can't be re-viewed without re-enabling and clicking again).
- *"toggling back and forth without edits still regenerates on next-step"*: navigate → draw a wall → `clickNextStep()` → capture `generationCount()` → `clickBackToEdit()` → `clickNextStep()` again immediately with no edits → assert `generationCount()` incremented (confirms the confirmed edge case: regeneration is not conditioned on the plan having changed).
- *"OrbitControls marker present when Step 2 is active"*: navigate → draw a wall → `clickNextStep()` → assert `await editor.scene.getAttribute("data-orbit-controls")` is `"true"`.

### `playwright-tests/pages/PlanEditorPage.ts` updates
- Rename `generateButton` locator → `nextStepButton`, selector `'[data-testid="next-step-button"]'`.
- Add `backToEditButton` locator, selector `'[data-testid="back-to-edit-button"]'`.
- Add `stepEdit` locator, selector `'[data-testid="step-edit"]'`.
- Add `stepPreview` locator, selector `'[data-testid="step-preview"]'`.
- Rename `clickGenerate3D()` → `clickNextStep()` (clicks `nextStepButton`).
- Add `clickBackToEdit()` (clicks `backToEditButton`).
- Add `orbitControlsPresent(): Promise<boolean>` reading `data-orbit-controls` off `this.scene`, same pattern as `sceneGenerated()`.
- Add `currentStep(): Promise<"edit" | "preview">` reading `data-step` off `this.editor`, same pattern as `mode()`.
- Update the file's header comment (lines 28-46) to mention the new `step-edit`/`step-preview` containers and that the canvas/toolbar are now conditionally present depending on step — the existing `containerBox()` helper (anchored on `this.canvas`) still works since exactly one `<canvas>` exists whenever `step-edit` is mounted, but callers must ensure they're in `step === "edit"` before calling any meter/canvas-based helper (`meterToScreen`, `dragVertexTo`, `drawWall`, etc.) — the canvas won't exist in `step === "preview"`.

### Edge cases to test (from orchestrator-output.md)
- Rapid double-click no longer races on the same element (see "Tests to remove" #7 above — covered by the new atomic single-click assertion instead).
- Going back and clicking 下一步 again without edits still regenerates (new test above).
- Deleting all objects is only possible from Step 1, and disabling naturally only matters there (covered by the reworked test 6 replacement).
- Browser refresh mid-Step-2 resets to Step 1 with default plan — no explicit new test needed (this falls out of the existing "no persistence" default-state test 1/9 already covering fresh-load behavior; no code adds persistence, so there's nothing new to assert).
- WebGL unavailable in Step 2 — not practically simulable in Playwright (real Chromium has WebGL); this stays manual-only, covered in the manual checklist below.

## Architecture Notes

- **Naming**: `next-step-button`/`back-to-edit-button`/`step-edit`/`step-preview` follow the orchestrator's proposed defaults, which are consistent with this file's existing `data-testid` convention (kebab-case, action- or region-descriptive: `tool-select`, `tool-wall`, `generate-3d-button` before rename). No deviation needed.
- **No new abstraction layer introduced**: `step` state stays colocated in `PlanEditor.tsx` next to `sceneSnapshot`/`generation`, matching AGENTS.md's "infer from existing code, do not invent premature patterns" — a separate wizard/step-machine hook would be over-engineering for a 2-value toggle.
- **Confirmed regeneration behavior**: going back to Step 1 and clicking 下一步 again *always* regenerates and increments `generation`, even with zero edits — this is explicitly confirmed in orchestrator-output.md's Edge Cases (not conditioned on the plan having changed), so no dirty-checking/memoization should be added.
- **Risk area — WebGL teardown/remount cost**: unlike Task 4 (where the 3D canvas, once mounted, stayed mounted), the wizard now mounts/unmounts the entire R3F `<Canvas>` (WebGL context created/destroyed) every time the user toggles steps. This is a heavier remount than Task 4's `key={generation}` remount-on-regenerate alone. Acceptable per scope (no perf requirement stated, `dynamic(..., {ssr:false})` loading state already handles the async mount), but flagging as a "known cost" rather than silently assuming it's free — if repeated toggling ever proves janky, memoizing/keeping the canvas mounted-but-hidden would be a future optimization, explicitly out of scope now.
- **`OrbitControls.target` prop**: drei's `OrbitControls` keeps its internal `target` synced to the `target` prop reactively on every render (not just at mount), so passing the constant `[VENUE_SIZE_M/2, 0, VENUE_SIZE_M/2]` array literal inline is fine here — it doesn't need to be memoized since `VenueScene` re-mounts wholesale on every `generation` change anyway (`key={generation}` on `VenueSceneLoader`), so there's no stale-closure or unnecessary-re-render concern to guard against.

## Security Checklist

- [x] No hardcoded secrets or credentials — N/A, no secrets involved in this task.
- [x] Input validation implemented at system boundaries — N/A, no new user-supplied external input (OrbitControls consumes only mouse/wheel events internally; `step` is a closed 2-value enum with no external input path).
- [x] Auth/permission checks in place (if applicable) — N/A, no auth-adjacent code touched (confirmed against AGENTS.md's "flag any auth-adjacent code changes immediately" — none apply here).
- [x] No sensitive data logged — N/A, no logging added.
- [x] No `DATABASE_URL`/Supabase client changes — confirmed out of scope for this task (pure client-side view state).

## Definition of Done

- [ ] All implementation steps (1-13) complete in `VenueScene.tsx` and `PlanEditor.tsx`.
- [ ] `playwright-tests/venue-3d-scene.spec.ts` updated per the full breakdown above (5 tests changed, 2 removed-and-replaced, 5 new tests added) — no regression coverage silently dropped without a documented reason.
- [ ] `playwright-tests/pages/PlanEditorPage.ts` updated with renamed/new locators and helper methods.
- [ ] `manual-tests/venue-plan-editor.md` has a new `## Task 5 — 3D 檢視器整合` section (camera drag-rotate, scroll-zoom, pan, polar-angle clamp at floor, min/max zoom distance clamp — all manual-only per the confirmed testability split).
- [ ] All Playwright tests in `venue-3d-scene.spec.ts` (and the untouched `venue-plan-editor.spec.ts` regression suite from earlier tasks) pass against a live dev server.
- [ ] No TODOs, commented-out code, or debug logs.
- [ ] Code follows all rules in AGENTS.md (path alias, ESLint, no inline Supabase clients — N/A here, no server code touched).
- [ ] Security checklist passed.
- [ ] `eslint` run clean on both modified components.
- [ ] This is the LAST task of the story `場地白模產生器 (階段一)` — per orchestrator-output.md's flag, when the playwright stage completes and approves this task, it must also mark the parent story's Notion row `已完成` (not an architect/developer action — noted here for downstream visibility only).
