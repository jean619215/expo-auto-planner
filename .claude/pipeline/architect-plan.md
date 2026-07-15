# Architect Plan — 個人資料頁改為檢視/編輯模式切換

> Story: 全站導覽 Header 與個人資料編輯模式 | Task type: FRONTEND | Generated: 2026-07-15T20:10:00+08:00

## Overview

Restructure the nickname section of `src/app/profile/page.tsx` from an always-editable form into a two-state (view/edit) UI, driven by a new `mode` state variable, while reusing the existing `nickname`/`saving`/`saveError`/`saveSuccess` state and `updateNicknameRequest`/`isValidNickname` logic. Add a `lastSavedNickname` value as the read-only display source and 取消's revert target. Update the Playwright page object and add a new spec file covering the full view/edit state machine; no existing spec needs rework since none currently exercises nickname editing.

## Task Type Confirmed

FRONTEND — confirmed against orchestrator-output.md. No new API route; reuses `src/lib/profile-client.ts` and `src/lib/validation.ts` as-is. No backend/DB/auth-model changes.

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `playwright-tests/profile-edit-mode.spec.ts` | New Playwright spec covering the view/edit toggle state machine (all acceptance criteria + edge cases from orchestrator-output.md) |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/app/profile/page.tsx` | Add `mode: "view" \| "edit"` and `lastSavedNickname` state; split the current always-rendered form into a conditional read-only block vs. edit-mode form; wire 編輯/儲存/取消 button handlers; add the 7 confirmed `data-testid`s; keep `pageState` loading/unauthenticated/error branches untouched |
| `playwright-tests/pages/ProfilePage.ts` | Replace/extend the single `nicknameInput` locator (currently `page.getByLabel("暱稱")`, which will break once the input is no longer always rendered) with testid-based locators for both view and edit mode, plus helper methods for the edit/save/cancel flow |

## Implementation Steps

1. In `src/app/profile/page.tsx`, add two new state variables alongside the existing ones (do not remove `nickname`/`saving`/`saveError`/`saveSuccess`):
   - `const [mode, setMode] = useState<"view" | "edit">("view");`
   - `const [lastSavedNickname, setLastSavedNickname] = useState("");`

2. In the `getProfileRequest().then(...)` success branch (currently lines 40-43), after `setProfile(result.profile)`, set both `setNickname(result.profile.nickname ?? "")` (existing line, keep as the edit-input's initial value) and `setLastSavedNickname(result.profile.nickname ?? "")` (new — this becomes the single source of truth for the read-only display and the 取消 revert target). `mode` stays at its default `"view"`.

3. Add a new handler `function handleEdit()`:
   - `setNickname(lastSavedNickname);` (pre-fill the input with the current saved value, in case a previous edit was cancelled mid-typing and never reset — defensive, matches spec's "pre-filled with the current saved nickname")
   - `setSaveError(""); setSaveSuccess("");` (clear any prior inline message per spec's message-persistence rule: "clicking 編輯... clears/replaces the previous message")
   - `setMode("edit");`

4. Add a new handler `function handleCancel()`:
   - Guard: `if (saving) return;` (defense in depth — the 取消 button will also be `disabled` while saving, but keep the guard consistent with the existing `handleSubmit` pattern)
   - `setNickname(lastSavedNickname);` (revert unsaved typed changes)
   - `setSaveError(""); setSaveSuccess("");` (clear any prior message per spec)
   - `setMode("view");`
   - No API call — do not touch `saving`.

5. Modify `handleSubmit` (currently the form's `onSubmit`, lines 56-84):
   - Keep the `if (saving) return;` guard and the `setSaveError(""); setSaveSuccess("");` reset at the top (already clears prior message when a new 儲存 attempt starts, per spec).
   - Keep the `isValidNickname` validation branch as-is — on failure, `setSaveError(...)` and `return` (this naturally stays in `mode === "edit"` since `mode` is untouched — no change needed here beyond leaving `mode` alone).
   - On success (`result.ok && result.profile`): after `setProfile(result.profile)` and `setNickname(result.profile.nickname ?? "")`, add `setLastSavedNickname(result.profile.nickname ?? "")` and `setMode("view")`, then `setSaveSuccess("暱稱已更新")`.
   - On failure (non-OK): keep existing `setSaveError(result.error ?? "儲存失敗，請稍後再試")` and the `result.status === 401` → `setPageState("unauthenticated")` branch, unchanged. Do NOT set `mode` — it stays `"edit"` automatically since nothing changes it, satisfying "remain in edit state... does NOT silently revert to read-only."
   - The `finally { setSaving(false); }` stays as-is.
   - Note: `handleSubmit` currently takes `event: React.FormEvent<HTMLFormElement>` and calls `event.preventDefault()`. Keep the edit-mode block as a `<form onSubmit={handleSubmit}>` so Enter-to-submit inside the input keeps working — only the read-only block is plain JSX (no form).

6. Restructure the JSX inside the `pageState === "ready" && profile` block (lines 118-163). Keep the outer condition and the 身分/建立時間 read-only blocks exactly as they are (spec: "unaffected by this task"). Replace only the nickname `<label>` block and the message/button block with a conditional:

   ```
   {pageState === "ready" && profile && (
     <div className="mt-6 flex flex-col gap-4">
       {mode === "view" && (
         <>
           <div className="flex flex-col gap-1 text-sm">
             <span className="font-medium text-zinc-800 dark:text-zinc-200">暱稱</span>
             {lastSavedNickname ? (
               <p data-testid="profile-nickname-display" className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                 {lastSavedNickname}
               </p>
             ) : (
               <p data-testid="profile-nickname-display" className="px-3 py-2 text-zinc-400 dark:text-zinc-500">
                 (未設定暱稱)
               </p>
             )}
           </div>

           {/* 身分 / 建立時間 blocks unchanged, stay here */}

           {saveError && <p role="alert" data-testid="profile-save-error" className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
           {saveSuccess && <p role="status" data-testid="profile-save-success" className="text-sm text-green-600 dark:text-green-400">{saveSuccess}</p>}

           <button type="button" data-testid="profile-edit-button" onClick={handleEdit}
             className="mt-2 h-11 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]">
             編輯
           </button>
         </>
       )}

       {mode === "edit" && (
         <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
           <label className="flex flex-col gap-1 text-sm">
             <span className="font-medium text-zinc-800 dark:text-zinc-200">暱稱</span>
             <input type="text" name="nickname" data-testid="profile-nickname-input" value={nickname}
               onChange={(e) => setNickname(e.target.value)} disabled={saving}
               className="rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-white/18" />
           </label>

           {/* 身分 / 建立時間 blocks unchanged, stay here too */}

           {saveError && <p role="alert" data-testid="profile-save-error" className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
           {saveSuccess && <p role="status" data-testid="profile-save-success" className="text-sm text-green-600 dark:text-green-400">{saveSuccess}</p>}

           <div className="mt-2 flex gap-3">
             <button type="submit" data-testid="profile-save-button" disabled={saving}
               className="h-11 flex-1 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]">
               {saving ? "儲存中…" : "儲存"}
             </button>
             <button type="button" data-testid="profile-cancel-button" onClick={handleCancel} disabled={saving}
               className="h-11 flex-1 rounded-full border border-black/12 px-5 font-medium text-zinc-800 transition-colors hover:bg-black/4 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/18 dark:text-zinc-200 dark:hover:bg-white/6">
               取消
             </button>
           </div>
         </form>
       )}
     </div>
   )}
   ```

   Notes on this restructure:
   - The 身分/建立時間 `<div>` blocks (existing lines 132-142) are duplicated into both branches verbatim (they render identically in both modes per spec — "remain read-only display as they are today, unaffected"). Do not attempt to hoist them outside the conditional in a way that changes their DOM position relative to the form — duplication is simpler and avoids a shared-element key/animation concern; flag as a minor duplication tradeoff (see Architecture Notes).
   - Both `profile-save-error`/`profile-save-success` blocks appear in both branches, but only one is ever mounted at a time (mode is exclusive), so there is no duplicate-testid-in-DOM risk.
   - The 編輯 button is `type="button"` (no form wrapping it needed) with an explicit `onClick`.
   - The 儲存/取消 buttons sit inside the edit-mode `<form>`; 儲存 is `type="submit"` (keeps existing Enter-to-submit and `handleSubmit`'s `event.preventDefault()` behavior), 取消 is `type="button"` with `onClick={handleCancel}` and must NOT trigger form submission.

7. Double-check `pageState` branches for `"loading"`, `"unauthenticated"`, `"error"` (lines 93-116) are untouched — `mode`/`lastSavedNickname` are only read/written inside the `"ready"` branch and its handlers, so no interference.

8. Update `playwright-tests/pages/ProfilePage.ts`:
   - Remove the old `nicknameInput = page.getByLabel("暱稱")` locator (will silently fail once the input isn't always present) and replace with testid-based locators:
     - `nicknameDisplay = page.getByTestId("profile-nickname-display")`
     - `nicknameInput = page.getByTestId("profile-nickname-input")`
     - `editButton = page.getByTestId("profile-edit-button")`
     - `saveButton = page.getByTestId("profile-save-button")`
     - `cancelButton = page.getByTestId("profile-cancel-button")`
     - `saveSuccessMessage = page.getByTestId("profile-save-success")`
     - `saveErrorMessage = page.getByTestId("profile-save-error")`
   - Add convenience methods consistent with the existing class style (plain async methods, no over-abstraction): `async startEdit()` (click `editButton`), `async fillNickname(value: string)` (fill `nicknameInput`), `async save()` (click `saveButton`), `async cancel()` (click `cancelButton`).
   - Keep `heading` and `loginPrompt` as-is (used by `membership-task7-task9.spec.ts` and unaffected by this task).

9. Confirm `playwright-tests/membership-task7-task9.spec.ts` needs NO changes: it only uses `profilePage.navigate()` and `profilePage.heading` (AC4 check), never touches nickname editing or the old `nicknameInput` locator. Verified via repo grep — no rework needed here (contrast with Task 1, which did require editing this file for the header logout relocation). State this explicitly in the QA/PR-reviewer handoff so it isn't second-guessed as a missed update.

10. Write `playwright-tests/profile-edit-mode.spec.ts` (new file), following the existing page-object + `.env.playwright.local` credential pattern from `membership-task7-task9.spec.ts` (reuse `PW_VERIFIED_EMAIL`/`PW_VERIFIED_PASSWORD`, log in via `LoginPage` first in each test or a `beforeEach`). Cover:
    - Default view: after login and navigating to `/profile`, `profile-nickname-display` is visible and `profile-edit-button` is visible; `profile-nickname-input`/`profile-save-button`/`profile-cancel-button` are not present.
    - Empty-nickname placeholder: if the test account's nickname is unset (or reset it via 儲存 with an empty string first), `profile-nickname-display` shows exactly `(未設定暱稱)`.
    - Enter edit mode: click 編輯 → `profile-nickname-input` becomes visible, pre-filled with the current saved value; `profile-edit-button` is gone; `profile-save-button`/`profile-cancel-button` are visible.
    - 取消 flow: enter edit mode, type a different value into the input, click 取消 → back to view mode, `profile-nickname-display` shows the original (unchanged) value, no `profile-save-success`/`profile-save-error` visible, and assert no PATCH request was sent (use `page.route`/`page.on("request")` to assert `/api/profile` PATCH was never called during this sequence, or simply assert the displayed nickname is unchanged as an indirect check — prefer the request-assertion for a stronger guarantee).
    - Successful save: enter edit mode, type a new valid nickname, click 儲存 → view mode returns, `profile-nickname-display` shows the new value, `profile-save-success` is visible with `role="status"`. Then reload the page and confirm the new value persists (server round-trip sanity check). Restore the original nickname at the end of the test (or in an `afterEach`) so the test is idempotent across reruns, mirroring good hygiene even though no other spec currently depends on this account's nickname value.
    - Client-side validation failure: enter edit mode, type a 51+ character string, click 儲存 → stays in edit mode (`profile-nickname-input` still visible), `profile-save-error` visible with `role="alert"` and text `暱稱長度不可超過 50 字`, and assert (via `page.route` intercept counting requests, or via `page.on("request")`) that no PATCH request was sent.
    - API failure on save: use `page.route("**/api/profile", ...)` to intercept the PATCH call for this test only and `route.fulfill()` a 500 with `{ error: "..." }` (or `route.abort()` for a network failure), then attempt 儲存 with a valid nickname → stays in edit mode, `profile-save-error` visible with `role="alert"`, input retains the typed value.
    - Saving-state button disabling: use `page.route` to delay the PATCH response (e.g. `await route.continue()` after a short artificial delay, or hold the route open before fulfilling) so the in-flight window is observable; assert `profile-save-button` shows text "儲存中…" and is disabled, and `profile-cancel-button` is disabled, during that window.

## Data Flow

1. Page mount → `getProfileRequest()` → on success, `profile`/`nickname`/`lastSavedNickname` all set from server response, `mode` stays `"view"`.
2. User clicks 編輯 → `handleEdit()` resets `nickname` to `lastSavedNickname`, clears messages, `mode → "edit"`. No network call.
3. User edits `nickname` locally (controlled input, no network call per keystroke).
4. User clicks 取消 → `handleCancel()` resets `nickname` to `lastSavedNickname`, clears messages, `mode → "view"`. No network call.
5. User clicks 儲存 → `handleSubmit()` → client validation (`isValidNickname`); on failure, inline error, stay in `"edit"`, no network call. On pass → `saving = true` → `updateNicknameRequest(nickname)` (PATCH `/api/profile`) → on success: `profile`/`nickname`/`lastSavedNickname` updated from `result.profile`, `mode → "view"`, success message shown. On failure: error message shown, `mode` stays `"edit"` (untouched), and on `401` additionally `pageState → "unauthenticated"` (page-level, supersedes the edit UI entirely).

## Test Plan

- No unit tests (no JS unit framework installed per AGENTS.md).
- Playwright (`playwright-tests/profile-edit-mode.spec.ts`) is the acceptance gate covering all items in Implementation Step 10 above, which maps 1:1 to every acceptance criterion and edge case in `orchestrator-output.md`.
- `playwright-tests/pages/ProfilePage.ts` updated so both the new spec and any future spec touching this page can rely on stable testid-based locators.
- `playwright-tests/membership-task7-task9.spec.ts` verified to require no changes (see Step 9) — confirm this again at implementation/review time by re-running it, not just by re-reading it.
- Edge cases explicitly covered: empty/null nickname (placeholder in view, empty editable input in edit), rapid double-submit guard (`if (saving) return;` preserved, no new Playwright assertion needed for this — it's a pre-existing guard, not new logic), message clearing on 取消 when a prior message was showing, server-trimmed nickname on save (handled by trusting `result.profile.nickname` for both `nickname` and `lastSavedNickname`, not the locally-typed value — already correct in Step 5), exactly-50-char boundary (valid) vs. 51-char (invalid) for client validation.

## Architecture Notes

- **New pattern**: this is the first use of `data-testid` attributes anywhere in the codebase (prior Playwright specs used semantic/label-based selectors, per the comment in `LoginPage.ts`: "no `data-testid` attributes anywhere yet"). This is an explicit, locked decision from orchestrator-output.md for this task, not an architect deviation — flagging it here so PR Reviewer doesn't treat it as an unexplained convention break. Future tasks touching this page should continue using testids for consistency once introduced.
- **JSX duplication of 身分/建立時間 blocks**: rather than hoisting the always-identical 身分/建立時間 display blocks outside the `mode` conditional (which would require restructuring the DOM tree in a way that mixes a `<form>` and non-form siblings awkwardly, or wrapping everything in one `<form>` even in view mode, which is semantically wrong when there's nothing to submit), this plan duplicates those two blocks into both the view and edit branches. This is a deliberate, minor tradeoff for JSX clarity and correctness (no stray `<form>` in view mode) over strict DRY-ness. Alternative considered and rejected: extracting a small local component/fragment for just those two blocks — deferred as unnecessary complexity for two `<div>`s; flag to developer as optional if it reads cleaner in practice, but not required.
- **`page.route` usage in Playwright**: no existing spec uses `page.route` for request interception/mocking. This plan introduces it only for the two failure/timing-dependent test cases (API failure, saving-state visibility) where there's no other way to reliably trigger a server-side failure or observe a narrow in-flight window against the real cloud Supabase backend. Standard, well-supported Playwright API — not a deviation from AGENTS.md (which only mandates Playwright as the frontend gate, not a specific interception style).
- **No performance concerns** — this is a small client-side state machine on an already-small page, no new data fetching patterns introduced.

## Security Checklist

- [ ] No hardcoded secrets or credentials (new Playwright spec reuses `.env.playwright.local` vars exactly as `membership-task7-task9.spec.ts` does — no new credentials introduced)
- [ ] Input validation implemented at system boundaries (client-side `isValidNickname` reused unchanged; server-side validation in `/api/profile` untouched — out of scope per orchestrator-output.md)
- [ ] Auth/permission checks in place (401 handling path preserved unchanged — transitions to `pageState === "unauthenticated"` exactly as before)
- [ ] No sensitive data logged (no new logging introduced anywhere in this task)
- [ ] Nickname remains rendered as React text content only (`{lastSavedNickname}` / `{nickname}` via JSX interpolation), never `dangerouslySetInnerHTML` — no new XSS surface

## Definition of Done

- [ ] All implementation steps complete
- [ ] `playwright-tests/profile-edit-mode.spec.ts` written and passing against the real cloud Supabase project (per AGENTS.md frontend gate)
- [ ] `playwright-tests/pages/ProfilePage.ts` updated with testid-based locators; old `getByLabel("暱稱")` locator removed
- [ ] `playwright-tests/membership-task7-task9.spec.ts` re-run and confirmed still passing unchanged (no edits needed, per Step 9)
- [ ] No TODOs, commented-out code, or debug logs
- [ ] Code follows all rules in AGENTS.md (`@/*` alias, `eslint-config-next` lint clean, no inline Supabase client, frontend calls only `/api/*` via `profile-client.ts`)
- [ ] Security checklist passed
- [ ] **This is the LAST task of the story "全站導覽 Header 與個人資料編輯模式".** When the `playwright` pipeline stage passes for this task, per AGENTS.md's Notion workflow it must, in addition to marking this task's card `已完成`, also update the parent story's own row in the Stories database to `狀態 = 已完成`. Flag this explicitly to the playwright-stage agent — do not let it fall through as "just another task."
