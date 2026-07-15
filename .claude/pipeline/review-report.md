# Code Review Report — 個人資料頁改為檢視/編輯模式切換
> Generated: 2026-07-15T22:45:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
The implementation matches the architect plan almost verbatim: `mode`/`lastSavedNickname` state, `handleEdit`/`handleCancel`/`handleSubmit` semantics, all 7 `data-testid`s, and JSX structure are all present and correct. Independent code tracing and a live re-run of the full Playwright suite (70/70, not just trusting the implementer's reported number) confirm every acceptance criterion and edge case in `orchestrator-output.md` is satisfied with no critical or should-fix issues.

## AGENTS.md Auth-Critical Rule — Explicit Applicability Determination
AGENTS.md's PR Reviewer instruction states: "Any change touching auth, session, or `DATABASE_URL` handling is automatically 🔴 Critical."

**Determination: does NOT apply to this diff.** Reasoning:
- `git diff` for `src/app/profile/page.tsx` shows the 401-handling line (`if (result.status === 401) { setPageState("unauthenticated"); }`) is byte-for-byte unchanged from the pre-existing code — it sits inside `handleSubmit`'s failure branch, untouched by this task's edits (confirmed by reading the diff hunk: it appears only as unmodified context, not an added/removed line).
- `getProfileRequest`/`updateNicknameRequest` (the actual network calls, defined in `src/lib/profile-client.ts`) are imported and called exactly as before — zero changes to that file, confirmed via `git diff --stat` (not listed among changed files).
- No changes to `src/proxy.ts`, `src/lib/supabase/*`, cookies, session tokens, or `DATABASE_URL` anywhere in this diff.
- The entire diff is a client-side state-machine restructure (`mode: "view" | "edit"`, `lastSavedNickname`) around a UI that already called these same auth-adjacent endpoints before this task. No new auth decision logic, no new auth-adjacent code path, no behavioral change to what triggers unauthenticated state or how it's handled.
- Conclusion: this is UI restructuring that happens to *sit near* a pre-existing, unmodified 401 branch — not a change that "touches" auth/session handling in the sense the rule is guarding against (altering how auth state is determined, stored, or enforced). No 🔴 Critical finding triggered by this rule.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None.

## 🟡 Should Fix (Auto-resolved by Developer)
None.

## 💡 Suggestions (Consider — No Action Required)
### Suggestion 1
- **File**: `src/app/profile/page.tsx:142-171` and `210-220`
- **Issue**: The 身分/建立時間 read-only blocks are duplicated verbatim across the view and edit branches.
- **Note**: Not actioned — this is a pre-approved, documented tradeoff in `architect-plan.md`'s Architecture Notes (avoids an awkward shared `<form>`/non-form sibling structure), not an oversight. Logged only.

## Security Assessment
- Secrets scan: PASS (no hardcoded secrets/tokens; Playwright spec reuses existing `.env.playwright.local` vars via `process.env.PW_VERIFIED_EMAIL`/`PW_VERIFIED_PASSWORD`, no new credentials introduced)
- Input validation: PASS (client-side `isValidNickname`/`NICKNAME_MAX_LENGTH` reused unchanged; server-side validation in `/api/profile` untouched, confirmed out of scope and not modified)
- Auth/authz: PASS / N/A — see explicit determination above; 401 branch preserved byte-for-byte
- XSS: PASS — nickname rendered only as JSX text interpolation (`{lastSavedNickname}` / `{nickname}` via controlled `value=`), no `dangerouslySetInnerHTML` anywhere in the diff (confirmed via full-file read)
- CORS/CSP: not touched
- SQL injection: N/A, no query code in this diff
- Test coverage: new logic fully covered by `playwright-tests/profile-edit-mode.spec.ts` (details below)

## Independent Verification Performed
- Traced `handleEdit`/`handleCancel`/`handleSubmit` line-by-line against the plan:
  - `handleEdit`: resets `nickname` to `lastSavedNickname`, clears `saveError`/`saveSuccess`, sets `mode="edit"` — matches plan exactly.
  - `handleCancel`: `if (saving) return;` guard, resets `nickname`, clears messages, sets `mode="view"` — **confirmed literally zero fetch/request/await calls in this function's body** (read full function, 6 lines, no async, no network primitives).
  - `handleSubmit` success path: `setProfile`, `setNickname`, `setLastSavedNickname`, `setMode("view")`, `setSaveSuccess("暱稱已更新")` — matches plan.
  - `handleSubmit` client-validation-failure path (`!isValidNickname(nickname)`): sets `saveError` and `return`s before `setSaving(true)` is ever called — `mode` is never referenced in this branch, so it necessarily stays `"edit"` (traced: no `setMode` call reachable from this branch).
  - `handleSubmit` API-error path (non-OK result): `setSaveError(...)`, conditionally `setPageState("unauthenticated")` on 401 — again no `setMode` call in this branch, confirmed `mode` stays `"edit"`.
- All 7 `data-testid`s present and correctly placed: `profile-nickname-display` (both view sub-branches — populated and placeholder), `profile-nickname-input`, `profile-edit-button`, `profile-save-button`, `profile-cancel-button`, `profile-save-success` (`role="status"`), `profile-save-error` (`role="alert"`) — confirmed via full file read.
- Empty-nickname placeholder: `{lastSavedNickname ? <p data-testid="profile-nickname-display">{lastSavedNickname}</p> : <p data-testid="profile-nickname-display">(未設定暱稱)</p>}` — correct falsy-check (`lastSavedNickname` is `""` when unset per `?? ""` in both fetch and save-success handlers).
- `pageState` loading/unauthenticated/error branches (lines 113-136): diff shows **zero changes** to these blocks — confirmed both by reading the diff hunk (no `+`/`-` lines touch them) and by reading the full current file.
- `membership-task7-task9.spec.ts`: `grep -n "nickname\|getByLabel"` returned **zero matches**; `git diff --stat` confirms the file is absent from the changed-files list. Implementer's claim verified independently, not trusted.
- `playwright-tests/profile-edit-mode.spec.ts` `page.route` usage reviewed line-by-line (first use of `page.route` in this codebase, per architect's own flag):
  - API-failure test (lines 117-135): routes `**/api/profile`, checks `route.request().method() === "PATCH"` before fulfilling a 500 (falls through to `route.continue()` for GET), correctly targets only the PATCH call; asserts error message + input retains typed value; `page.unroute` cleans up afterward. Correct.
  - Saving-state test (lines 139-152): same method-gated route pattern, injects a 1s delay before `route.continue()` on PATCH only, asserts `儲存中…` text + both buttons disabled during the window, then asserts eventual success. Correct — does not starve GET requests; delay is scoped to the save-triggering PATCH only.
  - Cancel/validation no-PATCH assertions use `page.on("request")` listeners gated on `req.url().includes("/api/profile") && req.method() === "PATCH"` — correctly targets the specific endpoint+method, not just any `/api/profile` traffic (which would also fire on the initial GET), avoiding a false-positive "PATCH sent" flag. Listeners are added/removed (`page.off`) around each assertion window, not left dangling.
- `ProfilePage.ts`: old `nicknameInput = page.getByLabel("暱稱")` locator confirmed fully removed (not superseded-but-left-behind) — diff shows a clean `-` removal, no orphaned reference remains in the file.
- `npx eslint` on all three changed/new files: clean, no output/errors.
- Full Playwright suite re-run personally (not trusting the implementer's "70/70" figure): started a clean `npm run dev`, ran `npx playwright test` against the real cloud Supabase project. **Result: 70/70 passed in 3.1 minutes**, spanning `profile-edit-mode.spec.ts` (2 tests), `membership-task7-task9.spec.ts` (9), `site-header.spec.ts` (4), and all four `venue-*.spec.ts` files (55 combined). Zero regressions.
- No `TODO`/`FIXME`/`console.log`/`: any` found via grep across all three changed files.
- Nickname rendered as JSX text-only interpolation throughout — no `dangerouslySetInnerHTML` anywhere in the file.

## Plan Compliance
- [x] All architect plan steps implemented
- [x] Implementation matches plan intent
- [x] No unauthorised scope additions

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| (none — no critical or should-fix findings required developer follow-up) | — | — |
