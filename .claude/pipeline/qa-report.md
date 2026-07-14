# QA Report — 3D 檢視器整合:orbit controls 旋轉/縮放,2D 編輯與 3D 預覽切換流程
> Generated: 2026-07-14T21:00:00+08:00 | QA iteration: 2 (FINAL allowed iteration per AGENTS.md 2-max anti-loop guard)

## Summary
- Tests executed: 3 targeted independent live-browser re-verification probes (Method A, Method B, Step-1 Delete regression) + 1 full live-browser regression suite re-run (64 tests)
- Passed: 3/3 probes, 64/64 suite
- Failed: 0
- Blocked: 0

## Recommendation
**APPROVED** — Bug 1 (High, iteration 1) is confirmed fixed via independent re-verification. QA sign-off granted. Handing off to `playwright` stage (final acceptance gate).

## Method
This is a re-verification pass focused specifically on QA iteration 1's Bug 1 and its fix, not a full re-run of the entire test checklist (all other ACs/edge cases were already independently verified PASS in iteration 1 and are untouched by this fix — `VenueScene.tsx` was not modified in this iteration per review-report.md's Plan Compliance section).

Read `qa-report.md` (own iteration-1 report), `review-report.md`'s Iteration 2 section (reviewer's independent verification, APPROVED), and the current source (`PlanEditor.tsx` lines 184-213, 387-436; `playwright-tests/pages/PlanEditorPage.ts`). Confirmed structurally by reading the JSX myself (not just trusting the reviewer's transcript) that:
- The outer `plan-editor` wrapper (line 388-408) no longer carries `tabIndex`/`onKeyDown` — only `data-step={step}` remains.
- `step-edit` (line 410-415) is a real focusable `<div data-testid="step-edit" tabIndex={0} onKeyDown={handleKeyDown}>`, rendered only when `step === "edit"`.
- `handleNextStep` (line 200-209) now calls `setSelectedObject(null)` and `setSelectedVertex(null)` in addition to its original snapshot/generation/step logic.

Started `npm run dev` against a live local dev server, navigated to `/venue`, and reproduced my own original iteration-1 repro steps exactly via a disposable Playwright spec (`playwright-tests/qa-probe-bug1-reverify.spec.ts`, reused the real `PlanEditorPage` page object, run, then deleted — not committed):
1. Draw+select a wall in Step 1 → click 下一步.
2. **Method A**: click the 3D canvas (`venue-scene` bounding box center, simulating an orbit-drag start) → press Delete → click 返回編輯 → assert `wallCount()` unchanged.
3. **Method B**: instead of clicking the canvas, `.focus()` the 返回編輯 button directly (no click) → press Delete → click 返回編輯 → assert `wallCount()` unchanged.
4. **Step 1 regression spot-check**: draw+select a wall in Step 1 (never advancing to Step 2), call `pressDelete()` (focuses `step-edit`, per the updated page object) → assert the wall **is** deleted, confirming the fix did not collaterally break the legitimate 2D Delete functionality from Task 1/2.

All three probes passed. Ran them against the actual current codebase state (not the implementer's or reviewer's reported numbers).

Then ran the full regression suite live: `npx playwright test playwright-tests/venue-plan-editor.spec.ts playwright-tests/venue-objects.spec.ts playwright-tests/venue-dimensions.spec.ts playwright-tests/venue-3d-scene.spec.ts playwright-tests/membership-task7-task9.spec.ts` — **64/64 passed** (9 + 17 + 16 + 13 venue + 9 unrelated membership-story regression), including `venue-objects.spec.ts:210` ("Delete/Backspace key removes the selected object and clears selection") and the two new permanent regression tests in `venue-3d-scene.spec.ts` covering Method A and Method B. Also ran `npx eslint` on the changed files (`PlanEditor.tsx`, `PlanEditorPage.ts`, `venue-3d-scene.spec.ts`) — clean, no output.

## Bug 1 Re-verification Results
| Repro Method | Result | Notes |
|---|---|---|
| Method A: click 3D canvas (orbit start) → Delete → 返回編輯 | ✅ PASS (fixed) | Wall count remains 1 after returning to Step 1. Previously dropped to 0. |
| Method B: focus 返回編輯 button (no click) → Delete → 返回編輯 | ✅ PASS (fixed) | Wall count remains 1 after returning to Step 1. Previously dropped to 0. |
| Control/regression: Step 1, select wall, press Delete (no Step 2 detour) | ✅ PASS | Wall count drops to 0 as expected — legitimate 2D Delete functionality (Task 1/2) is intact, not collaterally broken by the fix. |

## Root Cause Fix Verification
Confirmed both of QA's suggested fix directions were applied together (defense-in-depth), matching what implement/review reported:
1. `handleNextStep` now clears `selectedObject`/`selectedVertex` to `null` on every Step 1 → Step 2 transition — belt.
2. `tabIndex`/`onKeyDown` relocated from the outer `plan-editor` wrapper to the inner `step-edit` container, which only mounts in Step 1 — suspenders. This makes the bug structurally impossible regardless of stale selection state, since there is no keydown listener reachable anywhere in the DOM tree while Step 2 is mounted.

Either fix alone would have closed my exact two repro paths; both together close the whole class of bug (any future code path that might leave a stale `selectedObject`/`selectedVertex` around is still protected by fix #2 even if fix #1 were ever reverted).

## Regression Check
| Feature | Result |
|---|---|
| venue-plan-editor.spec.ts (Task 1, 9 tests) | ✅ PASS |
| venue-objects.spec.ts (Task 2, 17 tests, incl. Delete-key tests at lines 210, 226) | ✅ PASS |
| venue-dimensions.spec.ts (Task 3, 16 tests) | ✅ PASS |
| venue-3d-scene.spec.ts (Task 5, 13 tests, incl. 2 new Bug-1 regression tests) | ✅ PASS |
| membership-task7-task9.spec.ts (unrelated story, 9 tests) | ✅ PASS |

Full suite: **64/64 green**, no regressions. Independently re-run rather than trusting the implementer's/reviewer's reported numbers.

## Security Test
- Sensitive data exposure: PASS — no new data surface, pure client view-state (unchanged from iteration 1's assessment; `VenueScene.tsx` untouched this iteration).
- Input validation: N/A — no external/user-supplied input surface introduced.
- Auth boundary: N/A — no auth-adjacent code touched.

## Bugs Found
None (this iteration). Bug 1 from iteration 1 confirmed fixed and closed.

## Test Coverage
- Bug 1's exact repro (both methods) now has permanent, committed Playwright regression coverage in `venue-3d-scene.spec.ts`, not just this pass's disposable probe script (which was deleted after use, per standard QA practice of not committing scratch scripts).
- Minimum required (AGENTS.md): Playwright is the FRONTEND acceptance gate — satisfied; full 64-test suite green.
- Status: PASS.

## Notes for Next Stage
This is the **last task** of `stories/venue-whitebox-generator.md`. The `playwright` stage (next) is the final acceptance gate for this task, and per the project's Notion sync workflow, since this is the last task of the story, the `playwright` stage must also flip the parent story's own row in the Stories database to `已完成` in addition to this task's card — that is the `playwright` stage's responsibility, not QA's; noted here only as a handoff reminder per the orchestrator-output.md Assumptions section.
