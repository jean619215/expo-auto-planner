# Orchestrator Output — 3D 檢視器整合

> Story: 場地白模產生器 (階段一) | Task 5 of 5 (LAST task of story) | Generated: 2026-07-14T15:00:00+08:00

## Task Type
FRONTEND

## Refined Requirement
Two changes to `src/components/venue/VenueScene.tsx` and `src/components/venue/PlanEditor.tsx`:

**1. OrbitControls.** Add `@react-three/drei`'s `<OrbitControls>` inside the `<Canvas>` in `VenueScene.tsx` (drei is already installed, currently unused) so the user can rotate/zoom/pan the generated whitebox with the mouse. Configuration (not default unrestricted behavior):
- `enableRotate`, `enableZoom`, `enablePan` all `true`.
- `maxPolarAngle = Math.PI / 2 - 0.05` (camera cannot dip below the floor plane).
- `minDistance` ≈ 5, `maxDistance` ≈ 150 (relative to `VENUE_SIZE_M` = 50, so the user can neither zoom into nothing nor scroll away to a vanishing whitebox).
- `target` set to the scene's approximate center, `[VENUE_SIZE_M / 2, 0, VENUE_SIZE_M / 2]` (i.e. `[25, 0, 25]`), not world origin, so orbit pivots around the whitebox rather than a corner.
- Expose a `data-orbit-controls="true"` attribute on the 3D canvas container (alongside the existing `data-testid="venue-scene"` and `data-generated`/`data-*-mesh-count` attributes) confirming `OrbitControls` is mounted when the 3D view is active — this is the DOM-observable proxy Playwright uses since actual camera drag/rotate behavior is opaque WebGL and cannot be asserted through the DOM.

**2. Step-based (wizard) 2D/3D switching flow — replaces Task 4's "both stacked, always visible" placeholder.** This is a 2-step flow, NOT a tab bar (a tab-bar design was initially proposed by the orchestrator and explicitly rejected by the user in favor of a linear wizard):

- **Step 1 "編輯平面圖"** (default view on load): the existing 2D Konva editor — `<Stage>`, `PlanToolbar`, all current wall/column/vertex editing tools — exactly as it works today. Rendered inside a container with `data-testid="step-edit"`.
- **"下一步" button** (`data-testid="next-step-button"`): **merges and replaces** the current standalone "產生 3D 模型" button (`data-testid="generate-3d-button"` retired/renamed). One click both (a) generates the 3D scene from current live `polygon`/`walls`/`columns` state — same snapshot-on-click, full-replace semantics as Task 4 (`setSceneSnapshot({ polygon, walls, columns })` + `setGeneration((g) => g + 1)`, unchanged) — and (b) advances the view to Step 2. Enablement rule is unchanged from Task 4: disabled when `walls.length === 0 && columns.length === 0` (floor-only state keeps it disabled).
- **Step 2 "3D 預覽"**: shows only the 3D canvas (`VenueSceneLoader` → `VenueScene`, with `OrbitControls` per point 1) inside a container with `data-testid="step-preview"`. Step 1's 2D `<Stage>` is not rendered/visible in this step. Because "下一步" IS the generate-and-advance action, Step 2 can never be reached without a generated scene already existing — there is no empty/prompt state to design for in Step 2 (unlike a tab-bar design where free navigation to an ungenerated 3D tab was possible).
- **"返回編輯" button** (`data-testid="back-to-edit-button"`), shown in Step 2: returns to Step 1. Going back does NOT discard or reset the 2D plan state (`polygon`/`walls`/`columns`) — it is purely a view/step switch; all 2D editor state (selection, mode, etc.) remains exactly as it was.
- **Regeneration loop**: user can go back to Step 1, edit the plan freely, click "下一步" again — this regenerates the 3D scene from scratch (stale meshes from the prior generation fully replaced via the existing `key={generation}` remount pattern from Task 4, not incrementally appended) and advances to Step 2 showing the fresh scene. This loop is unlimited/repeatable.
- Only one of Step 1 / Step 2 is ever mounted-and-visible at a time — this is the core "切換流程" (switching flow) requirement from the story text that Task 4 deliberately left as a stacked-both-visible placeholder.

## Clarified Acceptance Criteria
- [ ] Given the venue editor page has just loaded, when the user views the page, then Step 1 "編輯平面圖" (2D Konva editor) is shown by default and Step 2's 3D canvas is not mounted.
- [ ] Given the venue editor page has loaded with only the default floor polygon and no walls/columns, when the user views Step 1, then "下一步" is visible but disabled.
- [ ] Given the user has added at least one wall OR one column, when the user views Step 1, then "下一步" becomes enabled.
- [ ] Given "下一步" is enabled, when the user clicks it, then (a) the 3D scene is generated from the current 2D state exactly as Task 4's generation logic already does (floor slab + wall boxes + column boxes, snapshot-on-click), and (b) the view advances to Step 2, where the 2D `<Stage>` is no longer rendered and the 3D canvas with mounted `OrbitControls` is shown.
- [ ] Given Step 2 is showing a generated 3D scene, when the user clicks and drags on the 3D canvas, then the camera orbits around the whitebox (manual-only verification — see Testability notes).
- [ ] Given Step 2 is active, when the user clicks "返回編輯", then the view returns to Step 1 showing the 2D editor with the polygon/walls/columns state fully intact (unchanged from before advancing to Step 2), and the 3D canvas is no longer mounted/visible.
- [ ] Given the user returns to Step 1, edits the plan (adds/moves/removes a wall, column, or floor vertex), and clicks "下一步" again, then the 3D scene fully regenerates to reflect the new 2D state (no stale meshes from the prior generation persist) and the view advances to Step 2 again.
- [ ] Given OrbitControls is active in Step 2, when the user attempts to orbit the camera below the floor plane, then the camera is prevented from going below `maxPolarAngle` (manual-only verification).
- [ ] Given OrbitControls is active in Step 2, when the user scrolls to zoom, then zoom is clamped within `minDistance`/`maxDistance` bounds (manual-only verification).
- [ ] Given the 3D canvas is mounted in Step 2, when inspected via the DOM, then it exposes `data-orbit-controls="true"` in addition to the existing `data-testid="venue-scene"`, `data-generated`, `data-wall-mesh-count`, `data-column-mesh-count`, `data-floor-vertex-count` attributes from Task 4.

## Edge Cases to Handle
- Rapid double-click on "下一步" must not cause a double-advance/race between the state-snapshot update and the step-view change — both should land from a single click handler synchronously (same pattern as Task 4's `handleGenerate3D`, just extended to also flip a step/view state value).
- Going back to Step 1 and immediately clicking "下一步" again without any edits should still regenerate cleanly (identical snapshot content is fine — regeneration is not conditioned on the plan having changed).
- Removing all walls/columns is only possible from Step 1 (Step 2 doesn't expose 2D editing tools), so the "下一步 disabled" re-check naturally only matters when the user is back in Step 1 — no special handling needed for "disabling mid-Step-2."
- Browser back/forward or page refresh while in Step 2: since this story explicitly has no persistence (階段一 has no DB, no URL/route state requirement stated), refreshing resets to Step 1 with the default plan — this is consistent with the rest of the story's "no persistence" scope and does not need special handling.
- WebGL unavailable in Step 2: consistent with Task 4's existing error-state decision, this should not crash the page — the 3D canvas area may show a broken/empty render, but "返回編輯" must still work to get back to a functional 2D editor.

## Error States
- No network/API calls involved — pure client-side view-state and geometry generation, no server error states apply.
- If Three.js/R3F/OrbitControls fails to initialize in Step 2 (e.g. WebGL unavailable), the 2-step wizard chrome itself (the "返回編輯" button) must remain functional so the user is never stuck on a broken Step 2 — same baseline as Task 4 (console error acceptable, richer fallback UX is a nice-to-have, not mandated).

## Out of Scope
- Any tab-bar based switching UI — explicitly rejected by the user in favor of the 2-step wizard described above.
- Free navigation to Step 2 before ever generating (not reachable by design, since "下一步" is the only way to advance and it always generates).
- Auto-regeneration / live-sync between 2D edits and an already-shown Step 2 scene while remaining in Step 2 — regeneration only happens via the explicit Step 1 → "下一步" → Step 2 flow, consistent with Task 4's snapshot-on-click decision.
- More than 2 steps, breadcrumbs, progress indicators, or step-skipping UI — this is a strict linear 2-step flow.
- Persisting which step the user was on across page reloads (no persistence anywhere in this story per 階段一 scope).
- Doors/windows, per-instance heights, mesh merging/instancing, textures/shadows — all already out of scope per Task 4 and unchanged here.
- Camera framing/animation transitions between Step 1 and Step 2 (e.g. no crossfade/animation requirement — an instant view swap is sufficient).

## Assumptions Made
- Exact container/test-id names (`step-edit`, `step-preview`, `next-step-button`, `back-to-edit-button`) are the user's proposed defaults, explicitly left to the architect/developer to keep "consistent with existing `data-testid` conventions in this codebase" (per the user's own phrasing) — these are strong defaults, not rigid requirements, if the architect finds a more consistent naming convention already in use elsewhere in `PlanEditor.tsx`.
- The existing `data-testid="generate-3d-button"` is retired/renamed to `data-testid="next-step-button"` since the user explicitly said these two actions "merge" into one — there is no longer a separate always-visible "產生 3D 模型" button coexisting with a step flow.
- OrbitControls configuration (`maxPolarAngle`, `minDistance`/`maxDistance`, `target`) and the DOM-assertable vs. manual-only testability split were proposed with concrete numeric defaults in the Q&A round and went unobjected — treated as confirmed, not merely tentative.
- Testability split (confirmed, unobjected): Playwright CAN assert — step container mount/visibility toggling on "下一步"/"返回編輯" clicks, that Step 1's 2D `<Stage>` is unmounted while Step 2 is active and vice versa, and `data-orbit-controls="true"` presence on the 3D canvas when Step 2 is active. Manual-only (goes into `manual-tests/venue-plan-editor.md` as a checklist, per the user's request for a delivered manual verification checklist) — actual mouse-drag orbit/rotate/zoom/pan behavior, polar-angle clamping at the floor, and min/max zoom distance enforcement, since these require visually driving opaque WebGL content.
- Task type FRONTEND confirmed, unobjected.
- **Flag for downstream playwright stage**: this is the LAST task (5 of 5) of the story `場地白模產生器 (階段一)`. When this task's work is approved and the playwright stage completes, it must mark not only this task complete but also the parent story's own row in the Stories database as `已完成` (per AGENTS.md's Notion sync section — "last task of a story" trigger). Not acted on now; noted here for the playwright agent to pick up later.

## Security Notes
No new security-sensitive surface: this task is client-only view-state and geometry/orbit-control changes with no new API routes, no auth changes, no data persistence, and no new user-supplied external input. No secrets/credentials involved. Consistent with Task 4's assessment — standard Next.js client-component/SSR considerations only (unchanged, `dynamic(..., { ssr: false })` pattern retained).
