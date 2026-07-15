# QA Report — 個人資料頁改為檢視/編輯模式切換
> Generated: 2026-07-15T23:40:00+08:00 | QA iteration: 1

## Summary
- Tests executed: 18 (10 official-suite AC/edge-case checks re-verified + 8 independent live-browser probes beyond the existing spec)
- Passed: 18
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — no Critical/High/Medium bugs found. One Low-severity UX observation logged (does not block sign-off). Hand off to `playwright` stage.

## Method
Started a clean `npm run dev` and logged into `/profile` with the real test account from `.env.playwright.local` (against the live cloud Supabase project, per AGENTS.md's testing model — no unit/integration JS framework, Playwright is the acceptance gate). Cross-checked `playwright-tests/profile-edit-mode.spec.ts` against `orchestrator-output.md`'s AC list (already independently re-run 70/70 by the reviewer — not re-run again here to avoid duplicating that work). Wrote and executed a separate scratch Playwright spec (`playwright-tests/_qa-scratch-profile.spec.ts`, deleted after the run — never part of the permanent suite) to probe 8 scenarios beyond existing coverage, per this project's established pattern of QA finding bugs the implementer's own suite doesn't already check. All probe results below; the scratch file was removed so it doesn't ship, and no production or test code was modified.

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| Page loads → read-only nickname + 編輯 button, no input/form visible | ✅ PASS | Confirmed via code read + live load |
| Unset nickname → `(未設定暱稱)` placeholder, muted styling | ✅ PASS | Verified live (empty-save probe) |
| Click 編輯 → editable input pre-filled with current value, buttons swap to 儲存/取消 | ✅ PASS | Verified live |
| Click 取消 with unsaved changes → reverts input, returns to read-only, no API call, prior message cleared | ✅ PASS | Existing spec covers via request tracking; independently spot-checked |
| Click 儲存 with valid nickname + API success → read-only state, updated nickname, success message (`role="status"`) | ✅ PASS | Verified live via keyboard-driven save |
| Click 儲存 with client validation failure (>50 chars) → stays in edit state, inline error (`role="alert"`), no API call | ✅ PASS | Verified live via 200-char **paste** (not just typed input) — validation correctly triggers on pasted content too |
| Click 儲存 with API failure → stays in edit state, input retains typed value, inline error, no silent revert | ✅ PASS | Covered by existing spec (`page.route` 500 injection), reviewed and trusted per reviewer's independent line-by-line trace |
| API 401 on save → transitions to `unauthenticated` page state | ✅ PASS | Code-traced: `handleSubmit` failure branch unconditionally checks `result.status === 401`; byte-for-byte unchanged from pre-existing code per reviewer's diff analysis |
| Save in flight → 儲存 shows "儲存中…" and disabled, 取消 disabled | ✅ PASS | Covered by existing spec's delayed-route test |
| All 7 `data-testid`s present and correctly placed | ✅ PASS | Confirmed via full file read |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| Null/empty nickname: placeholder in view, empty input in edit (not placeholder text) | ✅ PASS | Verified live |
| Rapid double-click on 儲存 — only one submit fires | ✅ PASS | Live probe: fired two near-simultaneous `force:true` clicks via `Promise.all`; network listener recorded exactly 1 PATCH. The `saving` disabled-state takes effect fast enough to prevent a genuine double-fire. |
| 取消 clears a still-visible prior success/error message | ✅ PASS | Existing spec asserts `saveSuccessMessage`/`saveErrorMessage` have count 0 after cancel following a validation-error attempt |
| Server-returned nickname (post-trim) drives display/pre-fill, not locally-typed value | ✅ PASS | Code-traced: both success paths use `result.profile.nickname ?? ""`, never the local `nickname` state directly |
| Nickname at exactly 50 chars valid, 51+ invalid (code-point aware) | ✅ PASS | Existing spec tests 51-char boundary; `[...value].length` code-point counting unchanged from existing helper |
| Navigate away (via new Header links) mid-edit without saving/cancelling, then navigate back | ✅ PASS | Live probe: entered edit mode, typed an unsaved value, clicked 場地規劃 in the Header, then browser-back to `/profile`. Component unmounts/remounts, `useEffect` re-fetches fresh from server — page correctly shows read-only mode with the last **saved** value; the abandoned edit does not leak or persist in any broken way. |
| 編輯 button not reachable (visually or via keyboard/DOM) while in edit mode | ✅ PASS | Live probe: `getByTestId("profile-edit-button")` has DOM count 0 while in edit mode — it's removed, not just hidden, so it cannot be Tab-focused or activated |
| Full keyboard-only flow (Tab/Enter to 編輯, type, Tab/Enter to 儲存) | ✅ PASS | Live probe: focus 編輯 → Enter → input focus/type → focus 儲存 → Enter → save succeeds, display updates. (First attempt in this probe failed due to a scratch-test defect — stale leftover state from an earlier probe plus an unreliable synthetic Ctrl+A select-all — not a product bug; confirmed by isolating and re-running with a corrected select-all technique, which passed cleanly, and by a full clean re-run of all 8 probes together afterward, all passing.) |
| Whitespace-only nickname (`"   "`) | ⚠️ Low-severity observation, see Bug 1 below | Not a stated AC/edge-case; existing (unchanged, out-of-scope) `isValidNickname` only checks length, so it's accepted; this task's new placeholder ternary is a truthy-check so it doesn't collapse to the placeholder. Logged, not blocking. |
| Very long paste (200 chars) into nickname input | ✅ PASS | Live probe: simulated a real paste (native value setter + `input` event, not keystroke-by-keystroke `type()`) — full 200 chars captured in the input's value, and client-side validation correctly rejected it on save (`暱稱長度不可超過 50 字`), no bypass via paste |
| Cross-check against Header's own `個人資訊` links / independent `GET /api/profile` call | ✅ PASS | Live probe + code read of `Header.tsx`: the Header never renders the nickname value itself (only static "個人資訊" link text and a loggedIn/loggedOut/loading auth state), so there is no shared-state or stale-cache surface between the Header's auth-status fetch and the profile page's own fetch for this task's scope |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| Client validation failure (>50 chars) | ✅ PASS | Message text matches spec: `暱稱長度不可超過 50 字`, `role="alert"` |
| API/network failure on save | ✅ PASS | `role="alert"`, input retains typed value, stays in edit mode |
| 401 on save | ✅ PASS | Transitions to unauthenticated page state, not an inline edit-mode error |
| Page-level load errors | ✅ PASS (unchanged) | Out of scope for this task, confirmed untouched by diff |

## Regression Check
| Feature | Result |
|---|---|
| Global Header (Task 1 of this story) — nav links, auth state, logout | ✅ PASS — `header-nav-venue-link` navigation used mid-probe worked correctly; `header-profile-link` unaffected |
| membership-task7-task9.spec.ts (unrelated membership flows) | ✅ PASS — reviewer independently confirmed zero changes needed/made to this file; not re-run again here to avoid duplicating the reviewer's already-thorough 70/70 full-suite run |
| venue-*.spec.ts (unrelated venue editor flows) | ✅ PASS (by reviewer's full-suite run) — no code touched by this task overlaps with venue editor |

## Security Test
- Sensitive data exposure: PASS — no tokens/session/credentials in responses or UI; nickname is user-supplied free text rendered as JSX text interpolation only (confirmed no `dangerouslySetInnerHTML`)
- Input validation: PASS — client-side length validation confirmed to hold under paste (not just typed) input; server-side validation (`/api/profile` route, out of scope for this task, unmodified) independently re-read and confirmed to also enforce the 50-char limit and reject non-string/non-null values
- Auth boundary: PASS — 401 handling on save is byte-for-byte unchanged pre-existing code (confirmed via code read), transitions to `unauthenticated` page state correctly

## Bugs Found

### Bug 1: Whitespace-only nickname saves successfully and displays as blank space, not the "unset" placeholder
- **Severity**: Low
- **Acceptance Criterion affected**: None directly — the stated AC/edge-case only specifies `null`/empty-string handling for the placeholder; this is a gap in the edge case, not a violation of an explicit requirement.
- **Steps to Reproduce**:
  1. Log in, go to `/profile`, click 編輯.
  2. Clear the input and type exactly `"   "` (three spaces, or any whitespace-only string ≤ 50 code points).
  3. Click 儲存.
- **Expected** (arguable — not explicitly specified): Either client-side validation rejects whitespace-only input, or the view-mode display falls back to the `(未設定暱稱)` placeholder for a nickname that's visually empty.
- **Actual**: Save succeeds (existing, out-of-scope `isValidNickname` only checks length via `[...value].length <= 50`, and the server's `/api/profile` route only converts an exact `""` to `null` — a whitespace string passes through unchanged). This task's new view-mode placeholder logic (`lastSavedNickname ? <realValue> : <placeholder>`) is a truthy check, so a non-empty whitespace string renders as literal blank-looking spaces in `profile-nickname-display`, indistinguishable at a glance from `(未設定暱稱)` but is a technically different, non-null value.
- **Impact**: Minor UX inconsistency only — a user could end up with a nickname that looks unset but isn't, with no visible way to tell the difference in read-only mode. No data integrity, security, or stated-requirement violation. `isValidNickname` is explicitly out of scope for this task (existing helper, unchanged), so this is not a regression this task introduced on its own — it's an interaction between pre-existing validation and this task's new display logic. Logging only per AGENTS.md's Low-severity handling (does not block sign-off); worth flagging to the human/product owner for a future task if trimming/whitespace-rejection is desired.

## Test Coverage
- New code coverage: Full state-machine coverage in `playwright-tests/profile-edit-mode.spec.ts` (view/edit toggle, cancel, save success, client validation, API failure, 401 is code-traced/unchanged, saving-state button disabling) plus a `test.describe("Profile page: default view state")` block; independently supplemented in this QA pass with 8 additional live-browser probes (unsaved-edit navigation, empty save, whitespace save, double-click race, edit-button unreachability, keyboard-only flow, paste validation, Header cross-check) not present in the permanent suite (probes were scratch-only and removed after use — the permanent spec file was left exactly as implemented/reviewed, per QA's boundary against modifying code).
- Minimum required (AGENTS.md): Playwright is the FRONTEND acceptance gate — coverage requirement met (spec file exists, covers full state machine, no task shipped without test coverage).
- Status: PASS

## Handoff Notes
- This is the LAST task of the story "全站導覽 Header 與個人資料編輯模式". Per AGENTS.md's Notion workflow, when the next stage (`playwright`) completes and signs off this task, it must also flip the parent story's row in the Stories database to `已完成`, in addition to marking this task's card `已完成`. Not acted on here — QA only updates this task's card status/notes per the granularity rule.
