# Code Review Report — 3D 檢視器整合:orbit controls 旋轉/縮放,2D 編輯與 3D 預覽切換流程
> Generated: 2026-07-14T17:15:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
The 2-step wizard restructuring in `PlanEditor.tsx` and the constrained `OrbitControls` addition in `VenueScene.tsx` match the architect plan and orchestrator spec closely, with correct mutually-exclusive rendering, synchronous state transitions, and no dead code left behind. Test coverage is thorough (11 Playwright tests, 5 changed in place + 1 rewritten in place covering the former "rapid double-click" intent + 3 new for wizard behavior + 1 new for OrbitControls marker), and the two removed tests' rationale independently checks out against the actual JSX. No critical or should-fix issues found.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None.

## 🟡 Should Fix (Auto-resolved by Developer)
None.

## 💡 Suggestions (Consider — No Action Required)
### Issue 1
- **File**: `.claude/pipeline/state.json:27` / task-log entry (documentation only, not code)
- **Issue**: The implementer's own summary (and the architect plan's "Tests to remove" section) frames the "rapid double-click" test as "removed and replaced with a new test elsewhere." Looking at the actual diff (`git diff HEAD -- playwright-tests/venue-3d-scene.spec.ts`), that test was not removed-and-re-added — it was edited **in place** (same location in the file, same `test(...)` block rewritten to assert atomic single-click behavior instead of double-click). Functionally equivalent coverage, but the "2 removed+replaced" framing in the log slightly overstates what happened mechanically (only 1 test — "editing after generation" — was truly deleted with no in-place remnant; the other was an in-place rewrite).
- **Suggested fix**: None required; purely a documentation-precision nit for future task-log entries. No code change needed.

## Security Assessment
- Secrets scan: PASS (no secrets/credentials touched)
- Input validation: N/A (pure client-side view state, no external input surface)
- Auth/authz: N/A (no auth-adjacent code touched; per AGENTS.md's auto-critical rule this doesn't apply — confirmed zero auth/API surface in this task)
- Test coverage: New logic (OrbitControls config, wizard step transitions) has Playwright coverage for everything DOM-observable, and manual-checklist coverage for everything WebGL-opaque (camera drag/zoom/pan/clamping) — no gap.

## Independent Verification (per review request)

1. **Mutual exclusivity of `step-edit`/`step-preview`** — CONFIRMED. `PlanEditor.tsx` lines 406 and 801 use `{step === "edit" && (...)}` and `{step === "preview" && sceneSnapshot && (...)}` as two independent top-level conditional blocks inside the same wrapper — since `step` is a single `"edit" | "preview"` state value, these two conditions are mutually exclusive by construction; there is no code path where both render simultaneously (unlike Task 4's prior always-rendered-Stage + conditionally-rendered-VenueSceneLoader pattern). The old standalone button block and the old unconditional `<Stage>` render were fully removed — `grep` for `generate-3d-button` / `generateButton` / `clickGenerate3D` across `src/` and `playwright-tests/` returns zero hits, confirming no dead code or stale references remain.

2. **`handleNextStep`/`handleBackToEdit` semantics** — CONFIRMED. `handleNextStep` (lines 200-204) calls `setSceneSnapshot`, `setGeneration`, and `setStep` synchronously in one function body with no `await`/effect/timeout between them — a single click event handler invocation applies all three state updates in the same React batch, so there's no intermediate render where e.g. `generation` incremented but `step` hadn't flipped yet. `handleBackToEdit` (lines 206-208) is a one-line `setStep("edit")` — it does not touch `sceneSnapshot` or `generation`, exactly as spec'd; going back preserves the frozen snapshot until the next `handleNextStep` overwrites it.

3. **Removed tests' rationale** — both independently re-derived and confirmed:
   - *"Editing after generation doesn't change scene"*: genuinely structurally impossible now. Since `step-edit` (containing the only 2D editing tools — `PlanToolbar`, `<Stage>`) and `step-preview` (containing the 3D canvas) are mutually exclusive per finding #1, there is no render state where a user could edit the 2D plan while a previously-generated 3D scene is simultaneously visible on screen. Removing this test rather than reworking it is correct.
   - *"Rapid double-click"*: the reasoning holds up. `next-step-button` only exists inside the `step-edit` block; `handleNextStep`'s synchronous `setStep("preview")` call unmounts that entire block (button included) on the same render pass that processes the first click. A second `Locator.click()` call fired concurrently via `Promise.all` against the same locator would very likely hit a detached/non-existent element rather than a genuine race on the handler, so the old test's premise (two clicks landing on the same live button before either state update commits) is broken. The plan is honest that this is a mitigation, not formal proof — it doesn't overclaim. The replacement test (atomic single-click assertion) is a reasonable substitute for the intent (guard against split-brain state), even though it isn't identical. Also note: this test was rewritten in place rather than deleted-and-replaced-elsewhere (see 💡 Issue 1) — a documentation nit only, not a code defect.

4. **OrbitControls config** — CONFIRMED exact match to spec (`VenueScene.tsx` lines 63-71):
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
   `VENUE_SIZE_M` is the imported constant (line 8, from `@/lib/venue/plan`), not a hardcoded `25` — target correctly reads `[VENUE_SIZE_M / 2, 0, VENUE_SIZE_M / 2]`. `data-orbit-controls="true"` is present unconditionally on the `venue-scene` wrapper div (line 49), alongside the pre-existing `data-generated`/`data-*-mesh-count`/`data-floor-vertex-count` attributes.

5. **No regression in Tasks 1-4 suites** — CONFIRMED. `git diff --stat HEAD` shows zero changes to `venue-plan-editor.spec.ts`, `venue-objects.spec.ts`, or `venue-dimensions.spec.ts`. Renamed/removed identifiers (`generateButton`, `generate-3d-button`, `clickGenerate3D`) have zero remaining references anywhere in `src/` or `playwright-tests/`, so nothing in the untouched suites could have silently broken via a stale selector.

6. **Code quality** — CONFIRMED clean: `npx eslint` on both modified files produced no output (clean exit); no `TODO`/`FIXME`/`console.log` in either file; no `any` types introduced; old single-block JSX structure (former standalone button + always-rendered `<Stage>`) fully removed, not left alongside the new step-gated structure.

## Plan Compliance
- [x] All architect plan steps implemented (steps 1-13 all present and correct in the diff)
- [x] Implementation matches plan intent (wizard structure, OrbitControls config, handler semantics, test plan all match)
- [x] No unauthorised scope additions (no tab bar, no >2 steps, no persistence, no camera transition animation — all correctly out of scope per orchestrator-output.md)

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| (none — no critical/should-fix issues raised) | — | — |

---

# Iteration 2 (re-review of QA Bug 1 fix)
> Generated: 2026-07-14T20:10:00+08:00 | Review iteration: 2

## Overall Assessment
APPROVED

## Summary
QA's Bug 1 (Delete/Backspace in Step 2 silently deleting a stale Step-1 selection) is fixed correctly, and both of QA's suggested fix directions were applied together as defense-in-depth. Independently re-derived the JSX, re-ran the full 55-test Playwright suite (not just trusted the reported numbers), and confirmed eslint/tsc are clean. No critical or should-fix issues.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None.

## 🟡 Should Fix (Auto-resolved by Developer)
None.

## 💡 Suggestions (Consider — No Action Required)

### Issue 1
- **File**: `src/components/venue/PlanEditor.tsx` (`handleNextStep`, lines ~200-208)
- **Issue**: `handleNextStep` now clears `selectedObject`/`selectedVertex` to `null` on every transition into Step 2. Since these are also the values driving the blue selection highlight/stroke in the Step 1 Konva layers (`isSelected = selectedObject?.type === ... `, and the vertex circle's `fill`), this has a small user-visible side effect that didn't exist before this fix: a wall/column that was selected when 下一步 was clicked will **no longer show as selected** (no blue outline) after the user returns via 返回編輯, even though the underlying `walls`/`columns`/`polygon` model data is byte-for-byte unchanged. Before this bug and its fix, nothing ever reset selection across the (former single-view) generate action, so this is a genuine, if minor, behavior delta from the pre-bug baseline.
- **Impact**: Cosmetic only — no data loss, and arguably the more correct/expected UX (a "fresh" Step 1 view rather than a stale highlight referencing a selection the user made before a context switch to 3D). The relevant AC only speaks to "polygon/walls/columns state fully intact," not selection UI, so this doesn't violate the acceptance criteria QA was validating against, and it isn't covered by the new regression tests (which correctly assert `wallCount`/`columnCount`/`objects()` equality, not selection highlight state).
- **Suggested fix**: None required. If desired, could add one Playwright assertion or a manual-checklist line documenting this as intentional ("returning to Step 1 does not restore the pre-Step-2 selection highlight"), so a future reviewer doesn't mistake it for a regression. Optional, not blocking.

## Security Assessment
- Secrets scan: PASS (no secrets/credentials touched)
- Input validation: N/A (pure client-side view state, no external input surface)
- Auth/authz: N/A (no auth-adjacent code changed; AGENTS.md's auto-critical rule for auth/DB confirmed not applicable — this fix touches only `PlanEditor.tsx` component state, `VenueScene.tsx` is unchanged this iteration, and the two Playwright/page-object files)
- Test coverage: 2 new permanent Playwright regression tests added (`venue-3d-scene.spec.ts`), reproducing both of QA's exact repro methods; full 55-test suite re-run independently and passes.

## Independent Verification (per re-review request)

1. **Does relocating `onKeyDown`/`tabIndex` to `step-edit` actually work?** — CONFIRMED. Read the actual JSX (`PlanEditor.tsx` lines ~403-436 in the new diff): `step-edit` is a real `<div data-testid="step-edit" tabIndex={0} onKeyDown={handleKeyDown} className="outline-none">` — not a Fragment, not a non-focusable element. It wraps `PlanToolbar`, the `next-step-button`, and the Konva `<Stage>`, and only renders when `step === "edit"`. Since it carries `tabIndex={0}`, it is a valid focus target and DOM keydown listener host exactly as the old outer `plan-editor` wrapper was. The `step-preview` block (`<div data-testid="step-preview">`) has no `tabIndex`/`onKeyDown` at all, and the outer `plan-editor` wrapper's own `tabIndex`/`onKeyDown` were fully removed (replaced with `data-step={step}`) — so there is structurally no keydown listener reachable while Step 2 is mounted, regardless of what has focus.

2. **Does this regress Task 1/2's existing Delete-key Playwright tests?** — CONFIRMED NOT REGRESSED, verified by actually re-running the suite rather than trusting the report. `grep` confirms `venue-objects.spec.ts` calls `pressDelete()` (lines 220, 286) and never calls `clickNextStep()`, so those tests stay in `step === "edit"` for their whole lifetime, where `step-edit` is mounted and focusable. `PlanEditorPage.pressDelete()` was updated to `await this.stepEdit.focus()` (was `this.editor.focus()`) — confirmed by reading the diff. Ran `npx playwright test venue-plan-editor.spec.ts venue-objects.spec.ts venue-dimensions.spec.ts venue-3d-scene.spec.ts` against a live local dev server myself: **55/55 passed**, matching the implementer's/QA's reported count exactly, including `venue-objects.spec.ts:210` ("Delete/Backspace key removes the selected object and clears selection") and `:226` (delete button), both green.

3. **Is resetting `selectedObject`/`selectedVertex` in `handleNextStep` redundant-but-safe, or does it serve an independent purpose?** — It is redundant for *correctness* (the keydown listener relocation alone is sufficient to make Bug 1 structurally impossible — there's no listener left to reach the state), but it is **not fully redundant for visual behavior**: since `selectedObject`/`selectedVertex` also drive the Step-1 selection highlight (blue stroke on the selected wall/column, filled vertex circle), clearing them means a previously-selected object no longer displays as selected when the user returns to Step 1 via 返回編輯. See 💡 Issue 1 above — flagged as a minor, non-blocking, undocumented UX delta, not a defect.

4. **Are the new regression tests faithful reproductions of QA's exact repro, and do they assert the correct fix?** — CONFIRMED. Both Method A (click the 3D canvas via `page.mouse.click` on `scene.boundingBox()` center, mirroring QA's "click anywhere on the 3D canvas") and Method B (`backToEditButton.focus()` with no click, mirroring QA's "focus the 返回編輯 button directly") are present as full automated Playwright tests in `venue-3d-scene.spec.ts` (not just one automated + one manual note — both got real coverage, exceeding the minimum QA asked for). Both assert `wallCount()` and `objects()` are unchanged after the full repro sequence (select wall → 下一步 → trigger focus/click → Delete → 返回編輯), which is the correct assertion for "the wall must still be present," not merely "no crash occurred." Ran both tests live: both pass.

5. **Any other unintended interaction from moving the keyboard listener?** — Checked whether pressing Delete while inside `step-preview` now does literally nothing. Confirmed by reading the JSX: `step-preview`'s only children are `back-to-edit-button` and `VenueSceneLoader` — no keydown handler exists anywhere in that subtree, and the former wrapper-level handler is gone. This is the intended behavior per the story's framing that "Step 2 doesn't expose 2D editing tools" (also stated in the architect plan/orchestrator spec referenced in Iteration 1's review) — there was no 2D-editing affordance in Step 2 before this fix either (no delete button, no toolbar), so this doesn't introduce a *new* silent failure, it just closes the one accidental bubble-through path that let a Step-1-scoped shortcut affect Step-1-scoped state from Step 2.

6. **Code quality** — CONFIRMED clean. `npx eslint` on all four changed files (`PlanEditor.tsx`, `VenueScene.tsx`, `PlanEditorPage.ts`, `venue-3d-scene.spec.ts`) produced no output. `npx tsc --noEmit` on the whole project produced no output. No `TODO`/`FIXME`/`console.log` introduced. The Chinese-language comment added to `handleNextStep` (lines ~30-32 of the diff) accurately describes both parts of the fix and their defense-in-depth relationship — matches actual code behavior, not aspirational.

## Plan Compliance
- [x] Fix matches QA's suggested fix direction (both options 1 and 2 applied together, exactly as QA's report framed as "non-mutually-exclusive")
- [x] Implementation matches the state.json `notes` field's own description of the fix — verified against the actual diff line-by-line, no discrepancy found
- [x] No unauthorised scope additions — `VenueScene.tsx` is untouched this iteration (only `PlanEditor.tsx`, `PlanEditorPage.ts`, `venue-3d-scene.spec.ts`, and `manual-tests/venue-plan-editor.md` changed for the fix itself; the rest of the diff is the already-approved Iteration 1 implementation)

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| QA Bug 1 (Delete/Backspace in Step 2 deletes stale 2D selection) | Applied both of QA's suggested fix directions together: (1) `handleNextStep` clears `selectedObject`/`selectedVertex`, (2) `tabIndex`/`onKeyDown` relocated from `plan-editor` wrapper to `step-edit` | Verified fixed — both QA repro methods now have permanent regression coverage and pass; full 55-test suite green; no regression in Task 1/2's existing Delete-key tests |
| 💡 Selection highlight not restored on return to Step 1 (new in this fix) | — (informational, no action requested) | Logged as Consider-only; not an AC violation, no fix applied |
