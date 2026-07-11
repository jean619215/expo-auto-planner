# QA Report — 登入頁「重新寄送驗證信」按鈕 + 60 秒冷卻
> Generated: 2026-07-11T11:00:00+08:00 | QA iteration: 1
> Story: 會員系統 | Task 9 of 9 | Type: FRONTEND

## Summary
- Tests executed: 18 (static/code-level, per manual checklist section 10) + 6 regression checks
- Passed: 24
- Failed: 0
- Blocked: 0 (real-browser Playwright run intentionally deferred — see note below)

## Important note on scope of this QA stage
Per the user's explicit standing decision recorded in this pipeline (task-log.md 2026-07-10 / 2026-07-11 entries for Task 7 and Task 9), the actual browser/Playwright acceptance run for the login-page resend button + cooldown (this task) is **deferred and will be executed together with the still-outstanding Task 7 playwright backlog** (`supabase/tests/auth_routes_manual.md` §9.3) in a single combined playwright pass, rather than run separately at this QA stage. This QA pass is therefore **static/code-level verification only** — reading the actual implementation against every acceptance criterion, edge case, and error state, plus the manual checklist (§10) that was authored for this task. This is consistent with AGENTS.md ("No JS test framework — verification is manual: checklists... For FRONTEND tasks, Playwright is the acceptance gate (pipeline `playwright` stage)").

No interactive/browser-driven claim is made in this report beyond what static code inspection can support.

## Recommendation
**APPROVED** — proceed to `playwright` stage (combined run covering Task 7 backlog + Task 9 scenarios).

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| 403 email_not_confirmed → 按鈕額外顯示 (idle) | ✅ PASS | `login/page.tsx:94` `setShowResend(result.error === EMAIL_NOT_CONFIRMED_ERROR)`; `EMAIL_NOT_CONFIRMED_ERROR` in `auth-client.ts:17` matches `login/route.ts:38` string exactly (byte-for-byte compared) |
| 點擊 idle 按鈕 → 立即呼叫 resend,body 用當下 email,進入 loading/disabled | ✅ PASS | `handleResendClick` (`login/page.tsx:102-120`) reads `email` from the enclosing render's state (live, not a stale snapshot); `resendLoading` set true immediately, button `disabled={resendLoading || inCooldown}` |
| 200 → 逐字顯示後端訊息 + 啟動 60 秒冷卻 + 按鈕文字含剩餘秒數 + disabled 直到歸零 | ✅ PASS | `setResendMessage(result.message ?? "")` — no string concatenation/rewriting; backend `GENERIC_RESEND_MESSAGE` in `resend/route.ts:5-6` is `"若該信箱已註冊且尚未驗證，驗證信已重新寄出"`, identical to the string frontend renders raw |
| 400 / 網路錯誤 → 顯示重寄專屬錯誤,不進冷卻,立即恢復 idle | ✅ PASS | `postJson` (`auth-client.ts:19-47`) collapses both 4xx JSON errors and fetch-reject/network failure into `{ ok:false, error }`; `handleResendClick`'s `else` branch only calls `setResendError(...)`, never touches `cooldownEndsAt`/`writeCooldownEndsAt`; `finally` unconditionally resets `resendLoading` to false |
| 重整頁面 → 從 localStorage 到期時間戳算剩餘秒數繼續倒數 (非重給滿 60 秒) | ✅ PASS | mount `useEffect` (`login/page.tsx:32-41`) calls `readCooldownEndsAt()` and sets `cooldownEndsAt` to the **stored absolute timestamp**, not `Date.now() + 60000`; render then derives `remainingSeconds` from that real value, so a reload mid-cooldown shows the actual remaining time |
| 倒數歸零 → 自動轉 idle + 清除 localStorage | ✅ PASS | third `useEffect` (`login/page.tsx:55-62`) fires when `now >= cooldownEndsAt`, calls `setCooldownEndsAt(null)` and `clearCooldownEndsAt()` with no user interaction required |
| 冷卻全域 (不分 email),換 email 仍顯示剩餘秒數 disabled | ✅ PASS | `RESEND_COOLDOWN_STORAGE_KEY` is a single fixed key (no email in it); `handleSubmit`'s 403 branch resets `resendMessage`/`resendError`/`showResend` but deliberately never touches `cooldownEndsAt` |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| Loading 中重複點擊防重複送出 | ✅ PASS | `if (resendLoading || inCooldown) return;` guard at top of `handleResendClick`, plus `disabled` attribute on the button |
| localStorage 值格式異常/被竄改 (非數字、極舊時間) → 視為已到期,不 crash | ✅ PASS | `readCooldownEndsAt` (`resend-cooldown.ts:10-20`): `Number(raw)` on a non-numeric string yields `NaN`; `!Number.isFinite(value) || value <= 0` catches both `NaN` and any non-positive/past value → returns `null`, which the caller treats as expired/idle |
| localStorage 不可用 (無痕限制) → try/catch,不 throw,in-memory 倒數仍可用 | ✅ PASS | All three exported functions (`readCooldownEndsAt`/`writeCooldownEndsAt`/`clearCooldownEndsAt`) wrap the `window.localStorage.*` call in `try { } catch { }` with an empty/`null`-returning catch body — a thrown `DOMException` from a disabled storage API cannot propagate; in-memory `cooldownEndsAt`/`now` state still updates normally within the page lifetime |
| 背景分頁節流 → 倒數用「目前時間 vs 到期時間戳」重算,非遞減計數器 | ✅ PASS | `remainingSeconds = Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000))` recomputed from `Date.now()` on every tick (`login/page.tsx:64-67`); no `count - 1` style decrement anywhere in the file — confirmed by full-file review, not just a code comment claiming it |
| Email 欄位在按鈕出現後被修改 → 送出的是當下值,非 403 快照 | ✅ PASS | `handleResendClick` is a plain function defined in the component body, re-created each render, closing over the current `email` state variable — there is no `useCallback`/ref snapshot capturing an earlier value, so it always reads the latest `email` at click time |
| 非 email_not_confirmed 的 403/401 (帳密錯誤) → 不顯示重寄按鈕 | ✅ PASS | `setShowResend(result.error === EMAIL_NOT_CONFIRMED_ERROR)` is a strict equality check — any other error string (e.g. generic 401 "帳號或密碼錯誤") evaluates to `false`; existing red-error-only behavior preserved |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| `/api/auth/resend` 400 (缺 email/格式錯) | ✅ PASS | Falls into `postJson`'s `res.ok === false` path → `{ ok:false, status, error }`; `handleResendClick` displays `result.error`, no cooldown started |
| 網路層失敗 (fetch reject/timeout) | ✅ PASS | `postJson`'s outer `try/catch` returns `{ ok:false, status:0, error: NETWORK_ERROR }` (`"連線失敗，請稍後再試"`) on fetch rejection — same non-cooldown code path as the 400 case |

## Regression Check
| Feature | Result | Notes |
|---|---|---|
| Login form fields/submit stay fully usable while resend block is shown | ✅ PASS | Diff confirms email/password inputs and `<button type="submit">` JSX are byte-identical to before Task 9; the new `showResend` block is inserted as an additional sibling `<div>` between the existing `errorMsg` block and the submit button — nothing is replaced or overlaid |
| `src/app/register/page.tsx` | ✅ PASS | Not touched by this task (confirmed via `git diff HEAD~1 --stat` — file absent from the changed list); read in full, logic/JSX unchanged from Task 5 baseline |
| `src/app/api/auth/logout` / `AuthNav.tsx` (logout flow) | ✅ PASS | Neither file appears in `git status`/diff for this task; no code path in `login/page.tsx` touches logout state |
| `src/proxy.ts` public allowlist for `/api/auth/resend` | ✅ PASS | Untouched by this task (added in Task 8, verified still present at line 12); this task makes zero changes to `proxy.ts` |
| `npm run lint` | ✅ PASS | Clean exit, no warnings/errors |
| `npx tsc --noEmit` | ✅ PASS | Clean exit, no type errors |

## Security Test
- Sensitive data exposure: **PASS** — `resend-cooldown.ts` persists only a numeric timestamp under a single global key (no email, no token); no new `console.*` calls introduced in this task's diff; `resendMessage`/`resendError` render the backend's literal strings verbatim with no client-side branching that could leak account-existence signal
- Input validation: **PASS** — no new user-facing input surface added (email reused from existing form field, validated server-side per Task 8); localStorage read path treats any malformed/out-of-range value as "expired" rather than trusting it
- Auth boundary: **N/A** — `/api/auth/resend` is an already-approved public allowlisted route (Task 8); this task adds no new authorization surface

## Test Coverage
- New code coverage: manual checklist `supabase/tests/auth_routes_manual.md` §10 (18 numbered steps, §10.1–§10.8) maps 1:1 onto all 7 acceptance criteria + 6 edge cases + 2 error states; Insomnia collection unaffected (this task has no new HTTP endpoint)
- Minimum required (per AGENTS.md): manual checklist counts as coverage for new logic — satisfied
- Status: **PASS**

## Bugs Found
None. 0 Critical / 0 High / 0 Medium / 0 Low.

## Outstanding (non-blocking, carried from review-report.md)
- `Design.pdf` remains untracked at repo root (flagged in Task 8 and Task 9 reviews) — unrelated to this task's scope, not a QA blocker.
- Review Suggestion 2 (theoretical same-tick double-click race window on `handleResendClick`) — same pattern as the existing `handleSubmit`/`submitting` guard, backend resend is idempotent, no user-facing impact. Logged, not blocking.
