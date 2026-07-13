# Code Review Report — 物件系統:牆壁線段工具與柱子矩形工具(選取/移動/刪除)
> Generated: 2026-07-13T01:15:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
Task 2 extends the Task 1 Konva floor-plan editor with an additive wall/column object system (toolbar, pure geometry in `plan.ts`, select/move/delete). Implementation matches architect-plan.md step-by-step; both bugs the developer reported fixing during implementation were independently re-derived and confirmed correct. All 24 Playwright tests (9 Task 1 regression + 15 new) pass against a live dev server, and `lint`/`tsc --noEmit`/`build` all pass clean when re-run. No auth/proxy/API/DB surface touched.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None.

## 🟡 Should Fix (Auto-resolved by Developer)
None. (One pre-existing pattern noted below under Consider — not new to this task, not blocking.)

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1 — duplicate handler invocation on drag (pre-existing pattern, carried forward)
- **File**: `src/components/venue/PlanEditor.tsx:471-472, 503-504, 539-543, 555-560`
- **Issue**: `onDragMove` and `onDragEnd` both call the same handler (`handleWallBodyDrag`, `handleColumnBodyDrag`, `handleWallEndpointDrag`), so the final drag-move event's state update is recomputed a second time on drag-end. Harmless (idempotent — same node position, same pure-function output) but slightly redundant.
- **Note**: This mirrors the same pattern already present in Task 1's vertex drag handlers (`handleVertexDragMove`/`handleVertexDragEnd`), which the Task 1 review already flagged as a 💡 and left unresolved by design. Consistent with existing precedent — logged only, no action needed.

## Security Assessment
- Secrets scan: PASS (no secrets/credentials introduced)
- Input validation: PASS — all pointer-derived meter coordinates pass through `snapPoint`/`clampColumnCenter`/`safeNumber` before entering state; `createWall`/`moveWallEndpoint` reject zero-length results
- Auth/authz: N/A — `/venue` is a public, client-side-only page; `git diff` confirms zero changes to `src/proxy.ts`, any `/api/*` route, or `src/lib/supabase/**`
- Test coverage: Playwright covers all 13 clarified acceptance criteria + all listed edge cases (short-drag reject, column extent clamp, endpoint-onto-endpoint revert, Delete precedence via the mutual-exclusivity design, multiplicity, bounds clamp). No JS unit framework installed (per AGENTS.md), consistent with project convention — pure-geometry correctness is verified indirectly via the browser (`data-objects` attribute) and directly by this review's manual re-derivation below.

## Verification Performed (this review, not just re-reading developer's notes)

**Bug fix 1 — coordinate anchor (`PlanEditorPage.ts`)**: Confirmed the wrapper div now contains the toolbar above the `<canvas>`, so wrapper-top-left ≠ Stage origin. `containerBox()` (line 84-88) now reads `this.canvas.boundingBox()` instead of the wrapper, and `meterToScreen` builds on that box — correct fix, independently confirmed by re-running the full suite (see below).

**Bug fix 2 — `clampColumnCenter` re-snap corruption (`plan.ts:198-205`)**: Verified `clampColumnCenter` now only clamps (`Math.min`/`Math.max` against `[0.25, 49.75]`), with no `snapToGrid` call. Traced both call sites: `createColumn` (line 208) explicitly snaps first (`clampColumnCenter(snapPoint(rawCenter))`), and `translateColumn` (line 245-253) applies a grid-snapped *delta* to an already-clamped center rather than re-snapping the *center* itself — since a center on the `{0.25, 0.75, 1.25, ...}` half-grid lattice plus a 0.5m-grid-aligned delta stays on that same lattice, repeated `translateColumn` calls during a multi-step drag can no longer drift a boundary-clamped center (e.g. 0.25) back onto the full grid (0.5). Confirmed sound.

**Regression + new coverage — ran for real**:
- `npx playwright test playwright-tests/venue-plan-editor.spec.ts playwright-tests/venue-objects.spec.ts` against a local dev server: **24/24 passed** (9 Task 1 + 15 Task 2), no console/page errors.
- `npm run lint`: clean, no output/errors.
- `npx tsc --noEmit`: clean.
- `npm run build`: succeeded, `/venue` still prerenders as static content, no SSR errors.

**Spec conformance checked directly in code**:
- Toolbar (`PlanToolbar.tsx`): 選取/牆壁/柱子 buttons with `data-testid="tool-select|tool-wall|tool-column"`, `aria-pressed={mode===value}`, `刪除` with `disabled={!canDelete}`; `mode` defaults to `"select"` in `PlanEditor.tsx:78`. Confirmed.
- Wall creation: click-drag via Stage `onMouseDown`/`onMouseMove`/`onMouseUp` (`PlanEditor.tsx:189-248`); rendered as a rotated filled `<Rect>` strip (`WALL_THICKNESS_M * pxPerMeter` height, not a stroked `Line`) — confirmed thickness renders as a quad, not a hairline; both endpoints pass through `snapPoint` (grid snap + bounds clamp) in `createWall`; zero-length (post-snap coincidence) returns `null` and is discarded, test asserts wall count stays 0 and mode stays `"wall"` (not auto-returned) — matches spec's silent-reject behavior; on success, auto-`setMode("select")` + auto-select the new wall.
- Column creation: single click via `onMouseUp` in column mode; fixed 0.5×0.5m; `clampColumnCenter` keeps the full extent inside `[0.25, 49.75]`; auto-return + auto-select confirmed.
- Select mode: click selects (blue `#3b82f6` outline via `stroke`), click on non-`"object"`-named target deselects (`targetName(e) !== "object"` check in `handleStageMouseDown`), body drag translates via the snap/clamp pure helpers, Delete/`刪除` removes, two endpoint `<Circle>` handles rendered only when a wall is selected (styled identically to Task 1 floor vertices: white/blue fill, blue stroke, `hitStrokeWidth 16`), rendered after (on top of) the wall strip in z-order so they win hit-testing, endpoint drag is independent per-endpoint and reverts to the unchanged wall on a zero-length reject (verified both by reading `moveWallEndpoint`'s early-return-original-wall behavior and by the passing "onto the other endpoint" test).
- Mutual exclusivity: floor-vertex `onClick`/`onTap` clears `selectedObject`; wall/column `onClick`/`onTap` clears `selectedVertex` (`PlanEditor.tsx:424-431` vs `463-469`/`495-501`) — bidirectional, confirmed. `handleKeyDown` gives `selectedObject` precedence and `return`s before touching the vertex-delete branch (`PlanEditor.tsx:172-175`) — confirmed matches the spec's "avoid handling the same Delete keypress for two selection concerns simultaneously" requirement.
- `plan.ts` stays React/Konva-free — confirmed, no such imports anywhere in the file; only pure functions/interfaces/constants.
- `src/proxy.ts` and all `/api/*`/Supabase files: zero diff (`git status` / `git diff --stat` confirm only the files listed in the task, none touch auth/API surfaces).

## Plan Compliance
- [x] All architect plan steps (A through I, items 1-33) implemented
- [x] Implementation matches plan intent (field names `start`/`end`/`center`, constants, file list, all match architect-plan.md exactly)
- [x] No unauthorised scope additions — `playwright.config.ts` viewport bump and the two bug fixes are within-scope corrections needed to make the plan's own acceptance criteria testable/correct, not scope creep

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| N/A | N/A | No critical or should-fix issues required developer follow-up this iteration |

---

# Iteration 2 — QA Bugfix Re-review
> Generated: 2026-07-13T04:15:00+08:00 | Review iteration: 2 | Trigger: QA REJECTED iteration 1 (qa-report.md), 2 reproducible bugs

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
Developer fixed both QA-reported bugs in `src/components/venue/PlanEditor.tsx` only, as instructed. Bug 1 (stale-selection hijack on mode re-entry) is fixed structurally and doubly: `handleModeChange` clears `selectedObject` on any transition away from `"select"`, AND the walls/columns `<Layer>` is now gated `listening={mode === "select"}` (mirroring the pre-existing floor-layer pattern), AND each shape's `draggable` is independently gated `isSelected && mode === "select"`. Bug 2 (trailing click re-selecting the old overlapping object) is fixed via a `suppressObjectClickRef` guard with a `setTimeout(0)` safety net. Independently reproduced QA's exact two repro sequences in a throwaway Playwright spec against a live dev server — both now pass. Full 24-test suite, lint, tsc, and build all re-confirmed clean. One test-coverage gap remains: neither bug scenario was added as a permanent regression test.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None.

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — No permanent regression coverage for either bugfix
- **File**: `playwright-tests/venue-objects.spec.ts`
- **Issue**: The developer's notes (state.json) confirm both exact QA repro sequences were verified via a *throwaway* Playwright spec written, run, and then deleted — not part of the permanent suite. `venue-objects.spec.ts` still only contains the original 15 scenarios; none re-enter a create mode while a prior object stays selected (Bug 1's exact trigger), and none place/draw two objects of the same type at the same coordinates (Bug 2's exact trigger). This is precisely the coverage gap QA's report called out as the root enabler of both bugs shipping past implement+review the first time.
- **Suggested fix**: Add two permanent tests to `venue-objects.spec.ts` mirroring the reviewer's/developer's throwaway repro: (a) draw wall 1, re-enter 牆壁 mode without deselecting, draw wall 2 starting on wall 1's body — assert wall 1's geometry is unchanged and wall 2 matches the new gesture; (b) place column A, deselect, re-place column B at the same point — assert count is 2 and the selected id is B's, not A's. Without these, a future refactor (e.g. touching the layer `listening` gating or the suppress-click ref) has no automated signal if it reintroduces either regression.

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1 — `suppressObjectClickRef` mechanism may now be redundant given the layer-gating fix
- **File**: `src/components/venue/PlanEditor.tsx:185-194, 421, 483-486, 491-494, 523-526, 531-534`
- **Note**: Tracing the event order, the walls/columns `<Layer>` is non-listening for the entire duration of a wall/column-mode creation gesture (mode only flips to `"select"` via `setState`, which commits after the synchronous native-event dispatch that Konva uses to decide mousedown/mouseup-target-match for its own click simulation). That means the old overlapping object's `onClick` structurally can't fire during the creation gesture even without the suppress-ref — Bug 1's fix likely already prevents Bug 2's exact mechanism as a side effect. The added suppression logic is harmless defense-in-depth (verified: cannot leak into a later legitimate click, cannot get stuck if creation is aborted since `markObjectClickSuppressed()` is only called on the "wall was actually created" branch and unconditionally for columns which always succeed) — logged only, no action required, keeping it is reasonable given the subtlety of reasoning about Konva's internal event timing.

## Security Assessment
- Secrets scan: PASS (no secrets/credentials touched)
- Input validation: N/A — no new input surface added by the bugfix; existing `snapPoint`/`clampColumnCenter` paths unchanged
- Auth/authz: N/A — `git diff HEAD --stat` confirms this bugfix round touched only `src/components/venue/PlanEditor.tsx`; `src/proxy.ts` and all `/api/*`/`src/lib/supabase/**` remain untouched. Not auth-adjacent; standard scrutiny applied per task type.
- Test coverage: 24/24 existing Playwright tests re-run and pass; both QA bug scenarios independently re-derived and confirmed fixed via a temporary spec (deleted after verification, not committed); permanent regression coverage for the two specific bugs is still missing — see Should Fix Issue 1.

## Verification Performed (this iteration, not just re-reading developer's notes)

**Bug 1 fix — re-traced against QA's exact repro:**
1. `handleModeChange(next)` (`PlanEditor.tsx:196-204`): unconditionally clears `draftWall`, and clears `selectedObject` whenever `next !== "select"`. Confirmed this covers QA's step 2 (re-entering 牆壁 mode after wall 1 auto-selected) — `selectedObject` is now `null` before the user's next gesture begins.
2. Walls/columns `<Layer>` (`PlanEditor.tsx:458`): `listening={mode === "select"}`. While in `"wall"`/`"column"` mode this layer (and everything inside it, including wall/column `<Rect>`s and endpoint `<Circle>`s) does not participate in hit-testing at all, so a draw gesture starting on top of an old object's screen position is guaranteed to reach the Stage, not the old shape.
3. Each `<Rect>`'s `draggable={isSelected && mode === "select"}` (lines 481, 521) is a second, independent guard — even if `selectedObject` had somehow remained set to the stale id, the shape would not be draggable outside select mode.
4. Reproduced QA's exact steps live: drew wall 1 (5,5)-(10,5), re-entered 牆壁 mode (no explicit deselect), drew wall 2 from (7.5,5) [a point on wall 1's body] to (7.5,15). Result: wall 1 unchanged at (5,5)-(10,5), wall 2 correctly created at (7.5,5)-(7.5,15), wall count 2. Matches expected behavior, QA's corruption/garbage-wall symptom is gone.

**Bug 2 fix — re-traced and re-derived:**
1. `markObjectClickSuppressed()` (`PlanEditor.tsx:185-194`) sets `suppressObjectClickRef.current = true` synchronously inside `handleStageMouseUp`, called only on the "object actually created" paths (inside `if (wall)` for walls; unconditionally for columns, which always succeed) — confirmed no path exists where the ref is set without a corresponding creation, and no path where creation is silently aborted after the ref is set.
2. Each wall/column shape's `onClick`/`onTap` checks and resets the ref in one step (`if (suppressObjectClickRef.current) { suppressObjectClickRef.current = false; return; }`), consuming exactly one click. The `setTimeout(0)` in `markObjectClickSuppressed` is a safety net for the case where the creation gesture never produces a trailing click (e.g., a genuine drag) — confirmed it cannot leak forward because it fires within the same macrotask cycle, far shorter than any physically possible human double-action.
3. As noted in Suggestion 1 above, the layer-gating fix for Bug 1 independently prevents the exact mechanism QA described for Bug 2 (old shape's `onClick` firing during a same-type creation gesture), making the suppress-ref a secondary safety net rather than the sole fix — this is a strength, not a weakness (defense in depth), and doesn't introduce risk.
4. Reproduced QA's exact steps live: placed column A at (10,10), explicitly deselected via empty-space click, re-entered 柱子 mode, placed column B at (10,10) again. Result: column count 2, selected id is column B's (not A's). Matches expected behavior.

**Regression + build health — ran for real, this iteration:**
- `npx playwright test playwright-tests/venue-plan-editor.spec.ts playwright-tests/venue-objects.spec.ts`: **24/24 passed**, no console/page errors.
- `npm run lint`: clean.
- `npx tsc --noEmit`: clean.
- `npm run build`: succeeded; `/venue` still static, all other routes unaffected; `Proxy (Middleware)` still loaded.
- Independently wrote a temporary Playwright spec reproducing QA's exact Bug 1 and Bug 2 steps (not the developer's own repro — written fresh from qa-report.md's steps), ran it against a live dev server: **2/2 passed**, then deleted the temp file (not committed, not part of the permanent suite — see Should Fix Issue 1 above for why this gap should close).

**Scope discipline:**
- `git diff HEAD --stat` for this working tree confirms the entire Task 2 feature (including this bugfix round) has not yet been committed; the bugfix-specific changes described in state.json's developer notes (mode-change selection clearing, layer/draggable gating, suppress-click ref) are all self-contained within `src/components/venue/PlanEditor.tsx` — no changes to `plan.ts` (pure geometry, unchanged by this bugfix), `PlanToolbar.tsx`, `PlanEditorPage.ts`, or any test file were needed or made as part of the bugfix itself. Confirmed no auth/proxy/API/DB files touched.

## Plan Compliance
- [x] Both QA-reported bugs addressed per architect-plan.md's original design intent (mode-gated selection, mutual exclusivity between draw modes and select mode)
- [x] Implementation matches the fix approach described in state.json developer notes
- [ ] No unauthorised scope additions — confirmed clean, but flagging the missing permanent regression tests as a should-fix carry-forward into QA re-verification

## Conversation Log (Iteration 2)
| Issue | Developer Response | Resolution |
|---|---|---|
| Should Fix 1: missing permanent regression tests for both bug scenarios | Not yet actioned — flagged this iteration | Auto-resolve: developer agent to add the two tests described above to `venue-objects.spec.ts` before QA re-verification, or QA may accept the risk explicitly if re-verifying live-browser interaction directly (per AGENTS.md's manual-checklist allowance for this project) |
