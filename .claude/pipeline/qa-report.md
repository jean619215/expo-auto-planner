# QA Report — 場地白模產生器 (階段一) Task 2: 物件系統 (牆壁 + 柱子)
> Generated: 2026-07-13T02:00:00+08:00 | QA iteration: 1

## Summary
- Tests executed: 13 AC checks + 11 edge-case checks + 4 independent probe scenarios (live browser) + regression suite (24/24 existing Playwright tests) + static code review of `plan.ts`/`PlanEditor.tsx`/`PlanToolbar.tsx` + spot-check of `venue-objects.spec.ts` assertions
- Passed: 13/13 ACs as literally worded; 9/11 edge cases
- Failed: 2 (both edge cases not covered by the existing 24-test suite — found via independent probing, not part of the implement agent's own tests)
- Blocked: 0

## Recommendation
REJECTED — two reproducible functional bugs found via independent interaction sequences that the existing Playwright suite (written by the same agent that implemented the feature) does not exercise. Both stem from the same root cause: wall/column click/select/drag handlers in `PlanEditor.tsx` are not gated by `mode`, and switching toolbar mode does not clear `selectedObject`. Loop back to implement.

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| Default mode is 選取 | ✅ PASS | `data-mode="select"` on load, confirmed in venue-objects.spec.ts:20 and manually. |
| 牆壁模式 click-drag creates wall (snap+clamp), mode→選取, new wall selected | ✅ PASS | Confirmed for isolated draws. **Fails under a specific precondition — see Bug 1.** |
| Click-drag start==end after snap → no wall created | ✅ PASS | `createWall` returns `null` correctly; mode stays 牆壁. |
| 柱子模式 click creates column (snap+clamp), mode→選取, new column selected | ✅ PASS | Confirmed for isolated placements. **Fails under a specific precondition — see Bug 2.** |
| 選取模式 click selects wall/column, blue outline | ✅ PASS | `stroke="#3b82f6"`, `strokeWidth=3` applied on selected object; verified via `data-selected-id`/`data-selected-type`. |
| 選取模式 click empty space deselects | ✅ PASS | Stage `onMouseDown` clears `selectedObject` when `target.name() !== "object"`. |
| Selected object body-drag → translate whole object, snap+clamp | ✅ PASS | `translateWall`/`translateColumn` snap delta and clamp correctly; verified with venue-objects.spec.ts:125,145 and boundary probe. |
| Selected wall endpoint-drag → independent move, snap+clamp | ✅ PASS | `moveWallEndpoint` correctly updates only the targeted endpoint. |
| Endpoint drag onto other endpoint → reject + revert | ✅ PASS | `moveWallEndpoint` returns the unchanged wall object on coincidence; handle node position resets. Re-verified with an additional single-jump (`steps:1`) case identical to the existing test — holds. |
| Delete/Backspace or 刪除 removes selected object, clears selection | ✅ PASS | `deleteSelectedObject` + keydown precedence logic verified. |
| Delete/Backspace/刪除 no-op when nothing selected | ✅ PASS | `刪除` button is `disabled` (not merely inert) when `selectedObject === null`; keydown handler falls through harmlessly. |
| Multiple objects independently selectable/movable/deletable | ✅ PASS | Confirmed with 2 walls + 2 columns; moving/deleting one leaves others' geometry untouched. |
| Bounds clamp on placement/drag (full object stays in 50×50m) | ✅ PASS | Column center clamps to `[0.25, 49.75]`; wall endpoints clamp to `[0, 50]` independently. Re-verified `clampColumnCenter`/`translateWall` math against additional boundary deltas (e.g. dragging a column to (-20,-20) → clamps to (0.25, 0.25); dragging a wall whose `minX=0` further negative → delta clamped to 0). |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| Very short wall drag (< 0.5m snap) | ✅ PASS | No wall created, mode stays 牆壁. |
| Column dragged/placed near edge → center clamps to `[0.25,49.75]` | ✅ PASS | Confirmed both on placement and on drag-to-edge. |
| Wall endpoint clamps to `[0,50]` independently per axis | ✅ PASS | `snapPoint` reused, confirmed via `moveWallEndpoint`. |
| Endpoint dragged onto other endpoint → rejected, reverts | ✅ PASS | See AC row above. |
| Mode-switch mid-drag → no crash | ✅ PASS (no crash) | ❌ **but see Bug 1**: no crash occurs, but mode-switch *while an object remains selected from a prior action* silently corrupts existing geometry and spawns a garbage object — this is a functional bug beyond the "no crash" bar the spec explicitly limited this edge case to, and is exactly the mechanism the spec's phrase "mid-interaction" was meant to bound, so it is in-scope to flag even though it isn't literally "mid-drag." |
| Object selection vs. floor-vertex selection independence, Delete precedence to objects | ✅ PASS | Selecting a floor vertex clears `selectedObject` and vice versa; Delete/Backspace checks `selectedObject` first. |
| **New: click-on-existing-object while placing a new object of the same type** (not explicitly listed in orchestrator-output.md, but implied by "the new column/wall is selected" AC + "each independently selectable... without affecting the others") | ❌ **FAIL — Bug 2** | See below. |
| **New: drawing a new wall whose start point lands on a still-selected wall from a prior action** | ❌ **FAIL — Bug 1** | See below. |

## Error States
- N/A — no network/API error states apply to this pure client-side task, confirmed no error-state UI was added (none required). PASS.

## Regression Check
| Feature | Result |
|---|---|
| Task 1 floor-polygon vertex drag/snap/clamp | ✅ PASS (9/9 existing tests green) |
| Task 1 edge double-click insert vertex | ✅ PASS |
| Task 1 vertex right-click delete (incl. 3-vertex floor) | ✅ PASS |
| Task 1 concave-polygon rendering | ✅ PASS |
| Task 1 old grid-cell editor absence (AC9) | ✅ PASS |
| Full local run: `venue-plan-editor.spec.ts` (9) + `venue-objects.spec.ts` (15) | ✅ 24/24 passed against local dev server (re-ran independently, matches implement/review claim) |

## Security Test
- Sensitive data exposure: PASS — no new data flows, no logging added, `data-objects` only exposes in-memory meter coordinates (no PII/secrets).
- Input validation: PASS — all pointer coordinates pass through `snapPoint`/`clampColumnCenter`/`snapToGrid` (NaN-safe via `safeNumber`) before entering state.
- Auth boundary: N/A — confirmed via `git diff --stat` that `src/proxy.ts` and all `/api/*` routes are untouched by this change; `/venue` remains a public, unauthenticated page.

## Bugs Found

### Bug 1: Switching to 牆壁/柱子 mode without deselecting leaves the previously-selected object draggable, so a new draw gesture starting on its body silently moves/corrupts it instead of drawing a new object
- **Severity**: High
- **Acceptance Criterion affected**: "click-drag from point A to point B creates a wall between A and B" (the actual effect is corruption of a *different, pre-existing* wall, not creation of the intended one) — also breaks the multi-object independence guarantee ("each is independently selectable, movable, and deletable **without affecting the others**").
- **Steps to Reproduce**:
  1. In 牆壁模式, draw wall 1 from (5,5) to (10,5). It auto-selects and mode returns to 選取 (this is normal/expected — `selectedObject` is still set to wall 1).
  2. Click `牆壁` toolbar button again to re-enter 牆壁模式 (a completely normal way to draw a second, connected wall — `handleModeChange` only clears `draftWall`, it does **not** clear `selectedObject`, so wall 1 remains selected and therefore still `draggable`).
  3. Click-drag from (7.5, 5) — a point on wall 1's body — to (7.5, 15), intending to draw a new wall there.
- **Expected**: A new wall is created from (7.5,5) to (7.5,15); wall 1 is untouched.
- **Actual**: Reproduced live via Playwright against the running dev server. Wall 1 is silently translated to (5,15)-(10,15) (Konva intercepts the gesture as a native drag of the still-`draggable` selected Rect instead of a Stage-level wall-draw gesture), **and** a second, garbage short wall is created from (7.5,5) to (7.5,6.5) (a truncated fragment of the intended drag, captured by the Stage's `draftWall` tracking before Konva's drag took over and stopped further event bubbling). Final state: 2 walls, neither matching user intent, and the original wall's position is destroyed. Confirmed the bug disappears entirely when the user explicitly clicks empty space to deselect before switching tool (control test) — isolates the root cause precisely to "mode switch doesn't clear selection" + "object layer isn't `listening`/`draggable`-gated by mode" (the floor layer *does* have this gating per architect-plan.md step 19; the object layer in steps 20-24 was never given the equivalent gating).
- **Impact**: A very plausible real workflow — drawing a second wall connected to or near a just-drawn (and therefore still-selected) first wall, e.g. building the walls of a room corner-by-corner — silently destroys previously placed work with no error, no undo (out of scope), and no visual indication until the user notices the corrupted layout. This is a data-loss-equivalent bug for a client-side-only editing tool.

### Bug 2: Placing a new column/wall on top of an existing object of the same type ends up with the *old* object selected instead of the newly created one
- **Severity**: Medium
- **Acceptance Criterion affected**: "the user clicks a point, then a 0.5x0.5m column is placed... and the new column is selected" (also applies symmetrically to walls, by the same mechanism).
- **Steps to Reproduce**:
  1. In 柱子模式, click (10,10) to place column A. It auto-selects (`selectedType=column`, `selectedId=A`), mode returns to 選取.
  2. Click empty space (40,40) to explicitly deselect.
  3. Re-enter 柱子模式, click (10,10) again to place column B at the exact same point.
- **Expected**: Column B is created and selected (`selectedId` = B's new id); column A is untouched and no longer selected.
- **Actual**: Reproduced live via Playwright. Column count correctly becomes 2 (both A and B exist with center (10,10)), but `data-selected-id` ends up equal to **column A's id**, not B's. Root cause: the Stage-level `onMouseUp` handler for 柱子模式 creates column B and calls `setSelectedObject({id: B})`, but because column A's Konva `<Rect>` sits at the same screen point and its own (mode-unaware) `onClick` handler also fires for the same click, it runs afterward and overwrites the selection back to `{id: A}`.
- **Impact**: A subsequent action the user takes assuming "the object I just placed is selected" (e.g. immediately drag-adjusting it, or pressing Delete to undo a misplaced object) silently acts on the wrong, pre-existing object instead. Narrower blast radius than Bug 1 (no geometry corruption, only wrong-selection), but still a direct, deterministic violation of an explicit acceptance criterion.

## Test Coverage
- New code coverage: Playwright — 15/15 new `venue-objects.spec.ts` scenarios pass, but they only ever exercise draw/select/move/delete gestures against a *clean* (nothing-selected, non-overlapping) canvas state; none re-enter a create mode while a prior object remains selected, and none place/draw two objects at the exact same coordinates. Both gaps directly correspond to Bug 1 and Bug 2.
- Minimum required: AGENTS.md requires Playwright coverage of new logic for FRONTEND tasks — met in breadth (all 13 literal ACs covered) but not in the two interaction sequences above.
- Status: FAIL (coverage gap directly enabled both bugs to ship past the implement+review stages)

---

# QA Report — 場地白模產生器 (階段一) Task 2: 物件系統 (牆壁 + 柱子) — Iteration 2 (Final, cap=2)
> Generated: 2026-07-13T05:30:00+08:00 | QA iteration: 2 (final — anti-loop cap reached)

## Summary
- Tests executed: 2 live-browser reproductions of the original bug repro steps (against a running `npm run dev`) + 2 new permanent Playwright regression tests added and run + full regression suite (26/26, was 24, +2 new) + spot-check pass over all 13 ACs (code re-read + existing/new test mapping) + lint/tsc/build
- Passed: 13/13 ACs (spot-check), 26/26 Playwright tests, lint clean, tsc clean, build clean
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — both previously-reported bugs (Bug 1: High, stale-selection hijack on mode re-entry; Bug 2: Medium, trailing-click reselects old overlapping object) are verified fixed via live reproduction of the exact original repro steps, not just by trusting review-report.md's claims. The review's 🟡 Should-Fix (missing permanent regression coverage) has been closed: two permanent tests were added to `playwright-tests/venue-objects.spec.ts`. This is QA iteration 2/2 (cap reached) — no further QA loop is available; sign-off is granted because no blocking bug survived.

## Bug 1 Re-verification (stale selection hijacks new draw gesture)
- **Method**: Reproduced live in a real browser (not a unit/static check) via a Playwright test driving the actual running dev server at `/venue`, using the identical steps from this report's Iteration 1: draw wall 1 (5,5)→(10,5) [auto-selects], re-enter 牆壁 mode without deselecting, draw wall 2 starting at (7.5,5) — a point on wall 1's body — to (7.5,15).
- **Result**: PASS. Wall count is 2; wall 1's geometry is byte-identical to before (start (5,5), end (10,5)); wall 2 is created exactly as drawn ((7.5,5)→(7.5,15)). No corruption, no garbage fragment. Matches the code-level fix traced in `src/components/venue/PlanEditor.tsx`: `handleModeChange` (lines 196-204) clears `selectedObject` on any transition away from `"select"`; the walls/columns `<Layer>` (line 458) is `listening={mode === "select"}`, so during `"wall"`/`"column"` mode the old shape cannot intercept hit-testing at all; each `<Rect>`'s `draggable={isSelected && mode === "select"}` (lines 481, 521) is a second independent guard.
- This exact sequence is now a permanent test: `playwright-tests/venue-objects.spec.ts` — "regression (QA bug 1): re-entering 牆壁 mode with a stale selection does not hijack a new draw gesture into dragging the old wall".

## Bug 2 Re-verification (trailing click reselects old overlapping object)
- **Method**: Reproduced live via Playwright against the running dev server: place column A at (10,10) [auto-selects], click empty space (40,40) to explicitly deselect, re-enter 柱子 mode, place column B at (10,10) again (exact same point).
- **Result**: PASS. Column count is 2; `data-selected-id` equals column B's id, not column A's. Matches the code-level fix: `suppressObjectClickRef` set synchronously in `markObjectClickSuppressed()` (called from `handleStageMouseUp` only on the object-actually-created path), consumed by the shape's `onClick`/`onTap` (lines 483-486, 523-526), with a `setTimeout(0)` safety net. Also confirmed (per review's Suggestion 1, re-checked here) that the Bug-1 layer-gating fix independently prevents the old shape's `onClick` from firing during the creation gesture in the first place — the suppress-ref is defense-in-depth, not the sole mechanism, which is a reasonable design choice, not a risk.
- This exact sequence is now a permanent test: `playwright-tests/venue-objects.spec.ts` — "regression (QA bug 2): placing a new column on top of an existing one of the same type selects the new column, not the old one".

## Permanent Regression Coverage Added (closes review's 🟡 Should Fix)
- Added to `playwright-tests/venue-objects.spec.ts` (now 17 tests, up from 15):
  1. `regression (QA bug 1): ...` — draws wall 1, re-enters 牆壁 mode without deselecting, draws wall 2 starting on wall 1's body; asserts wall 1 unchanged and wall 2 matches the new gesture.
  2. `regression (QA bug 2): ...` — places column A, deselects, places column B at the same point; asserts count is 2 and the selected id is B's, not A's.
- Both follow the existing file's conventions: `PlanEditorPage` page-object methods only (`wallTool`/`columnTool`/`drawWall`/`placeColumn`/`clickAt`/`objects`/`selectedId`/`selectedType`/`wallCount`/`columnCount`), no direct canvas/DOM queries, comments in the same style as neighboring tests explaining the "before the fix" failure mode.

## Full Acceptance Criteria Spot-Check (all 13, re-confirmed)
All 13 ACs from Iteration 1's table re-confirmed at code + test level (no regressions since iteration 1's full pass): default mode 選取; wall click-drag creates snapped wall + auto-select + mode reset; sub-snap-unit drag creates no wall; column click creates snapped/clamped column + auto-select + mode reset; select-mode click selects wall/column with blue outline; click empty space deselects; body-drag translates whole object snapped/clamped; endpoint-drag moves independently snapped/clamped; endpoint-onto-endpoint rejected+reverts; Delete/Backspace/刪除 removes selected + clears selection; Delete/Backspace/刪除 no-op when nothing selected; multiple objects independently selectable/movable/deletable; bounds clamp on placement/drag. All map 1:1 to passing tests in `venue-objects.spec.ts` (17/17) plus `venue-plan-editor.spec.ts` (9/9) for Task 1 regression — 26/26 total, re-run against a live local dev server this iteration, not just re-read from prior reports.

## Regression Check
| Feature | Result |
|---|---|
| Task 1 floor-polygon vertex drag/snap/clamp | ✅ PASS (9/9) |
| Task 1 edge double-click insert vertex | ✅ PASS |
| Task 1 vertex right-click delete (incl. 3-vertex floor) | ✅ PASS |
| Task 1 concave-polygon rendering | ✅ PASS |
| Task 1 old grid-cell editor absence (AC9) | ✅ PASS |
| Full local run: `venue-plan-editor.spec.ts` (9) + `venue-objects.spec.ts` (17, +2 new) | ✅ 26/26 passed against local dev server |

## Security Test
- Sensitive data exposure: PASS — no new data flows; `git diff` confirms the only source change since Iteration 1 review-approval is the bugfix in `PlanEditor.tsx` plus the two new tests added this iteration; no logging of tokens/session/cookies anywhere in this surface.
- Input validation: PASS — no new input surface introduced by the bugfix; existing `snapPoint`/`clampColumnCenter`/`safeNumber` paths unchanged.
- Auth boundary: N/A — `src/proxy.ts` and all `/api/*`/`src/lib/supabase/**` remain untouched (confirmed via `git diff --stat`); `/venue` remains a public, unauthenticated, client-side-only page.

## Build/Lint/Type Health (re-run this iteration)
- `npm run lint`: clean, no output/errors.
- `npx tsc --noEmit`: clean.
- `npm run build`: succeeded; `/venue` still prerenders as static content; `Proxy (Middleware)` still loaded; no other routes affected.
- `npx playwright test playwright-tests/venue-plan-editor.spec.ts playwright-tests/venue-objects.spec.ts`: **26/26 passed** against a local dev server (9 Task 1 + 17 Task 2, including the 2 new permanent regression tests).

## Bugs Found (Iteration 2)
None new. Both Iteration-1 bugs (Bug 1: High — stale-selection draw-gesture hijack; Bug 2: Medium — trailing-click reselects old object) are confirmed fixed by live reproduction of the original repro steps, and are now covered by permanent regression tests.

## Anti-Loop / Escalation Note
This is QA iteration 2 of the 2-iteration cap (`iteration.qa = 2`). Per AGENTS.md/ship-mate `qa` skill: since no new blocking bug was found and the prior review's only Should-Fix (missing regression coverage) has been closed, this iteration concludes with **sign-off**, not an escalation — the anti-loop guard is not triggered because there is nothing left to loop back to implement for. Had a new Critical/High/Medium bug been found at this iteration, this section would instead read as an explicit escalation-to-human per the cap, rather than a third auto-loop back to implement.

## Final QA Recommendation
✅ **QA sign-off granted.** Feature meets all 13 acceptance criteria; both previously-found bugs are verified fixed via live browser reproduction; permanent regression coverage added for both; full 26-test Playwright suite, lint, tsc, and build all pass clean. `checkpoints.qa = "completed"`, `flags.qa_bugs_pending = false`, `iteration.qa = 2`, `stage = "playwright"`.
