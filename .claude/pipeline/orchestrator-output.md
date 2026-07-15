# Orchestrator Output — 個人資料頁改為檢視/編輯模式切換
> Story: 全站導覽 Header 與個人資料編輯模式 | Task 2 of 2 (LAST task) | Generated: 2026-07-15T19:45:00+08:00

## Task Type
FRONTEND

## Refined Requirement
Rework `src/app/profile/page.tsx` so the nickname section of the profile page is a two-state view/edit UI instead of the current always-editable form. This is the LAST task of the story.

Default state (view/read-only), entered on page load and after a successful or cancelled edit:
- Nickname is displayed as plain read-only text (not an input), `data-testid="profile-nickname-display"`.
- If `profile.nickname` is `null`/empty, display a muted placeholder `(未設定暱稱)` instead of blank text.
- A single 編輯 button is shown, `data-testid="profile-edit-button"`. No 儲存/取消 button is visible in this state.
- Role and 建立時間 fields remain read-only display as they are today (unaffected by this task).

Edit state, entered when the user clicks 編輯:
- Nickname becomes an editable text input, pre-filled with the current saved nickname, `data-testid="profile-nickname-input"`.
- 編輯 button is replaced by two buttons: 儲存 (`data-testid="profile-save-button"`) and 取消 (`data-testid="profile-cancel-button"`).
- 取消: reverts the input value to the last-saved nickname (discards any unsaved typed changes) and returns to read-only state. No API call is made. Any prior inline message is cleared as part of this action.
- 儲存: validates via `isValidNickname` (existing client-side helper) before submitting.
  - Client-side validation failure → stay in edit state, show inline error message, no API call.
  - Submits via existing `updateNicknameRequest(nickname)`. While the request is in flight, `saving` is true.
  - Success (`result.ok`) → update local `profile`/`nickname` state from the response, return to read-only state, show inline success message near the nickname.
  - Failure (non-OK response or network error) → remain in edit state (input stays editable, showing whatever the user typed), show inline error message. Do NOT silently revert to read-only. If `result.status === 401`, transition the whole page to the existing `unauthenticated` page state (matches current behavior).

Loading/saving UI:
- While `saving` is true: 儲存 button label changes to "儲存中…" and is disabled; 取消 button is also disabled (cannot cancel out from under an in-flight request); the nickname input remains as-is (not force-disabled beyond the existing `disabled={saving}` pattern already in the code).

Messages:
- Single inline message region near the nickname field/display.
- Error: `role="alert"`, `data-testid="profile-save-error"`.
- Success: `role="status"`, `data-testid="profile-save-success"`.
- Persistence: message stays visible until the next state-changing action — i.e., clicking 編輯 (start new edit), clicking 取消, or starting a new 儲存 attempt clears/replaces the previous message. No auto-dismiss timer.

## Clarified Acceptance Criteria
- [ ] Given the profile page has just loaded and the user is authenticated, when the page renders, then the nickname is shown read-only with an 編輯 button (no form/input visible).
- [ ] Given the loaded profile has no nickname set, when viewed in read-only state, then the placeholder `(未設定暱稱)` is shown in muted styling instead of blank text.
- [ ] Given the read-only state, when the user clicks 編輯, then the nickname becomes an editable input pre-filled with the current value, and 編輯 is replaced by 儲存 + 取消.
- [ ] Given the edit state with unsaved changes, when the user clicks 取消, then the input reverts to the last-saved nickname, the page returns to read-only state, no API call is made, and any prior inline message is cleared.
- [ ] Given the edit state, when the user clicks 儲存 with a valid nickname and the API call succeeds, then the page returns to read-only state showing the updated nickname and an inline success message (`role="status"`).
- [ ] Given the edit state, when the user clicks 儲存 and client-side validation fails (nickname too long), then the page stays in edit state and shows an inline error message (`role="alert"`), no API call is made.
- [ ] Given the edit state, when the user clicks 儲存 and the API call fails (validation error from server, network error, or other non-2xx), then the page stays in edit state (input remains editable, retains the user's typed value) and shows an inline error message — it does NOT silently revert to read-only.
- [ ] Given the edit state, when the API responds 401, then the page transitions to the existing `unauthenticated` page state (login prompt), consistent with current behavior.
- [ ] Given a 儲存 request is in flight, when the user looks at the buttons, then 儲存 shows "儲存中…" and is disabled, and 取消 is also disabled.
- [ ] Given the relevant elements, when inspected in the DOM, then they carry the agreed `data-testid`s: `profile-nickname-display`, `profile-nickname-input`, `profile-edit-button`, `profile-save-button`, `profile-cancel-button`, `profile-save-success`, `profile-save-error`.

## Edge Cases to Handle
- Nickname is `null`/empty string in both read-only display (placeholder) and edit input (empty editable input, not the placeholder text itself).
- Rapid double-click on 儲存: existing `if (saving) return;` guard pattern must be preserved/reused to prevent duplicate submits.
- User clicks 取消 while a previous save's success/error message is still showing — message must be cleared as part of the cancel action.
- Successful save where the server-returned nickname differs from what was typed (e.g. server-side trimming) — read-only display and input pre-fill on next edit must reflect the server's returned value (`result.profile.nickname`), not the locally-typed value, consistent with existing code's current behavior (`setNickname(result.profile.nickname ?? "")`).
- Nickname exactly at `NICKNAME_MAX_LENGTH` (50 chars, using `[...value].length` per existing `isValidNickname`, i.e. code-point aware) is valid; 51+ is invalid.

## Error States
- Client-side validation failure (nickname > 50 chars) → stay in edit mode, inline error `role="alert"`, message: `暱稱長度不可超過 ${NICKNAME_MAX_LENGTH} 字` (reuse existing message text).
- API/network failure on save → stay in edit mode, inline error `role="alert"`, message from `result.error` or fallback `儲存失敗，請稍後再試` (reuse existing fallback).
- 401 on save → transition to existing `unauthenticated` page-level state (not an inline edit-mode error).
- Page-level load errors (`pageState === "error"` / `"unauthenticated"`) are unchanged by this task — out of scope.

## Out of Scope
- Any change to the `/api/profile` route handler, request/response contracts, or backend validation — this task is purely the frontend view/edit state machine.
- Role and 建立時間 fields remain read-only display only; no edit affordance for them.
- Editing any field other than nickname.
- Changes to the global Header (Task 1, already complete/committed).
- Auto-dismissing messages on a timer, or toast/snackbar-style notifications — inline message region only, per confirmed answer.
- Optimistic UI updates before the API responds — the UI waits for the response before leaving edit state.

## Assumptions Made
- 取消 button included; reverts to last-saved value, returns to read-only, no API call, clears any prior message (confirmed).
- Inline message region (not toast), `role="alert"`/`role="status"`, persists until next state-changing action, no auto-dismiss (confirmed).
- Empty/unset nickname read-only display shows `(未設定暱稱)` placeholder with muted/secondary styling (confirmed).
- 儲存 shows "儲存中…" and is disabled while saving; 取消 also disabled while saving (confirmed).
- `data-testid`s locked as: `profile-nickname-display`, `profile-nickname-input`, `profile-edit-button`, `profile-save-button`, `profile-cancel-button`, `profile-save-success`, `profile-save-error` (confirmed).
- Task type is FRONTEND (confirmed) — no new API route needed; reuses existing `getProfileRequest`/`updateNicknameRequest` from `src/lib/profile-client.ts` and `isValidNickname`/`NICKNAME_MAX_LENGTH` from `src/lib/validation.ts`.
- **This is the LAST task of the story "全站導覽 Header 與個人資料編輯模式".** Per AGENTS.md's Notion workflow, when the playwright stage completes this task, it must also flip the parent story's row in the Stories database to `已完成`, in addition to marking this task card `已完成`. Flagging here for the architect/implement/review/QA/playwright stages downstream — not acted on at this stage.

## Security Notes
- No new auth-adjacent behavior introduced. The existing 401-handling path (redirect to unauthenticated page state) is preserved as-is.
- No secrets, tokens, or credentials involved in this UI-only change.
- Nickname is user-supplied free text rendered as React text content (not `dangerouslySetInnerHTML`), so no new XSS surface is introduced by this task.
