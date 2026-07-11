# QA Report — /api/auth/resend (Task 8, 會員系統)
> Generated: 2026-07-11T07:51:00Z | QA iteration: 1

## Summary
- Tests executed: 17
- Passed: 17
- Failed: 0
- Blocked: 0

## Test Method Note
No local Docker/Supabase CLI stack was available in this environment (`supabase` CLI not installed, `docker ps` fails — daemon not running), so the manual checklist's Inbucket-based email-content assertions could not be exercised. `.env.local` points at a real (cloud) Supabase project, and `npm run dev` was runnable against it, so **live HTTP requests were used wherever they were safe to run** (structural validation, and a disposable real test account using a `+qa<timestamp>` alias of the developer's own inbox to get one genuine "registered but unverified" account without spamming a third party). Everything below is marked **[LIVE]** (actual `curl` against the running dev server + real cloud Supabase) or **[CODE]** (static code inspection) per check.

## Recommendation
APPROVED — All acceptance criteria, edge cases, and error states pass, including live verification of the critical anti-enumeration behavior (the exact bug class QA caught in Task 2). No Critical/High/Medium bugs found. One Low/informational note logged below (does not block sign-off, mirrors an already-accepted pattern from Task 2).

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| 合法 email (已註冊未驗證) POST → 200 通用訊息,實際重寄驗證信 | ✅ PASS | [LIVE] Registered `jean619215+qa<ts>@gmail.com` via `/api/auth/register` (real 200, account created), then POSTed resend → `200 {"message":"若該信箱已註冊且尚未驗證，驗證信已重新寄出"}`. Server log confirmed Supabase's GoTrue was actually invoked (the *second* resend call hit the real `over_email_send_rate_limit` path, proving the flow reaches Supabase for real). |
| 不存在的 email POST → 同樣 200 同一句訊息 (防枚舉) | ✅ PASS | [LIVE] `qa-nonexistent-probe-zzz@example.com` and a second nonexistent address both returned `HTTP/1.1 200 OK` + byte-identical body `{"message":"若該信箱已註冊且尚未驗證，驗證信已重新寄出"}` as the real-account case. Diffed status line + body across 3 runs (real-unverified ×2, nonexistent ×1) — identical. |
| 已驗證的 email POST → 同樣 200 通用訊息 | ✅ PASS (verified by code inspection) | [CODE] No Inbucket access to click a real confirmation link in this environment, so this exact scenario wasn't driven end-to-end live. Verified in `src/app/api/auth/resend/route.ts:44-49`: **every** `error` returned by `supabase.auth.resend()` (which is exactly how GoTrue reports "already confirmed" — no separate success/failure code path exists) is funneled into the same `console.error` + `200 {message: GENERIC_RESEND_MESSAGE}` branch as the success path. There is no conditional on error type/code before the generic response, so "already verified" cannot structurally produce a different response than any other case. |
| 被 rate limit (max_frequency 內重複) → 對外仍 200,server log 記錯誤碼 | ✅ PASS | [LIVE] Real 429 reproduced: second resend call against the just-registered account produced server log `[auth/resend] resend error: status=429 code=over_email_send_rate_limit message=For security purposes, you can only request this after 43 seconds.` while the HTTP response was still `200` with the exact same generic body. Confirmed log line contains **no email address**. |
| 缺 email / 格式錯 → 400 | ✅ PASS | [LIVE] `{}` → `400 {"error":"缺少 email"}`; `{"email":123}` → `400 {"error":"缺少 email"}`; `{"email":""}` → `400 {"error":"缺少 email"}`; `{"email":"not-an-email"}` → `400 {"error":"email 格式錯誤"}`. |
| 未登入可呼叫 (在 proxy 白名單內) | ✅ PASS | [LIVE] All curl calls above were sent with no cookies at all and never received `401`. [CODE] Confirmed `"/api/auth/resend"` is present in `PUBLIC_API_PATHS` in `src/proxy.ts:12`, and `config.matcher` (`src/proxy.ts:78`) already covers `/api/:path*` so no matcher change was needed — matches architect plan exactly. |
| 不 log email/token/session 於錯誤訊息外洩層級 | ✅ PASS | [LIVE] Inspected full `npm run dev` log for the whole test session: only line present is `[auth/resend] resend error: status=429 code=over_email_send_rate_limit message=...`. No email, token, cookie value, or session data logged. `console.error` call in `route.ts:45-47` only interpolates `error.status`/`error.code`/`error.message`, never `email`. |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| 非 JSON body → 400 不 500 | ✅ PASS | [LIVE] `-d 'not-json'` → `400 {"error":"請求格式錯誤"}` (caught by the `try/catch` around `request.json()` in `route.ts:9-14`). |
| proxy 白名單漏加 → 未登入呼叫會 401 | ✅ PASS (not reproduced — whitelist confirmed present) | [CODE + LIVE] Whitelist entry confirmed present (see AC row above); live calls without cookies never hit 401, so this bug class does not manifest. |
| manual checklist + Insomnia 檔各加 resend 請求 | ✅ PASS | [CODE] `supabase/tests/auth_routes_manual.md` §4B (lines 226-327) covers all 8 sub-scenarios including the explicit "compare status+body byte-for-byte" instruction. `supabase/tests/insomnia_auth.json` has request `req_resend` (lines 117-130) with correct URL/body/description. |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| Supabase returns any error (incl. 429) | ✅ PASS | See rate-limit row above — real 429 observed and correctly masked. |
| Malformed/non-object body | ✅ PASS | `null`, non-object, and missing-key cases all return 400 (see edge cases). |

## Regression Check
| Feature | Result |
|---|---|
| `/api/auth/register` (unaffected by this task) | ✅ PASS — [LIVE] still returns 200 generic message; test account creation succeeded (verified indirectly via successful subsequent resend/rate-limit behavior). |
| `/api/auth/login` (proxy passthrough for auth-page routing) | ✅ PASS — [LIVE] wrong password against the real test account correctly returned `401 {"error":"帳號或密碼錯誤"}` — not affected by the new proxy whitelist entry. |
| `/api/auth/logout` | ✅ PASS — [LIVE] returns `200`, no errors. |
| `src/proxy.ts` matcher/whitelist change scope | ✅ PASS — [CODE] diff is the single added line noted in the architect plan; no other logic touched. |

## Security Test
- Sensitive data exposure: **PASS** — response body across all 200s is exactly `{"message": "..."}`; no session/token/user-existence data ever exposed. `console.error` never includes email (verified live).
- Input validation: **PASS** — JSON parse, type, empty-string, and regex checks all enforced at the boundary before any Supabase call (`route.ts:9-28`).
- Auth boundary: **PASS** — route is intentionally public (unauthenticated resend is the feature); confirmed reachable without cookies and not blocked by proxy.
- Anti-enumeration (project's specific focus per AGENTS.md / Task 2 lesson): **PASS** — status code and body are byte-identical across: (a) real registered-but-unverified account, (b) nonexistent account, (c) rate-limited real account. This is the exact bug class QA caught in Task 2 (differing status codes leaking account existence), and it does not recur here.

## Test Coverage
- New code coverage: manual checklist (8 sub-cases in `auth_routes_manual.md` §4B) + Insomnia request — matches AGENTS.md's "no JS framework, manual checklist counts" bar.
- Minimum required: manual checklist/Insomnia entry present for new logic (per AGENTS.md Testing Requirements).
- Status: **PASS**

## Bugs Found
None — Critical/High/Medium: 0.

One **informational (non-blocking) observation**, logged for awareness only, not filed as a bug:
- `src/app/api/auth/resend/route.ts` has no `try/catch` around the `supabase.auth.resend(...)` call itself (only the `request.json()` parse is wrapped). If the SDK call were to *throw* rather than return `{ error }` (e.g. a genuine network-level failure to reach the Supabase project), the route would surface an unhandled exception → framework default 500, which would be a status-code difference from the 200 given to every other case, technically breaking the anti-enumeration invariant for that one failure mode. In practice `supabase-js`'s `resend()` wraps network/HTTP-level failures into a returned `AuthError` rather than throwing, so this was not reproducible live. This exact pattern (no try/catch around the SDK call) already exists in `register/route.ts` and was accepted in Task 2's QA pass — so this is a **pre-existing, previously-accepted risk shape**, not a regression introduced by Task 8. Not blocking sign-off; flagging for the human/architect's awareness only, in case a follow-up hardening pass across all auth routes is ever scheduled.

## Cloud Dashboard Reminder (per architect Definition of Done)
Per the architect plan, the `max_frequency = "60s"` change in `supabase/config.toml` **only affects the local Docker stack**. This environment doesn't have a local stack, and the config.toml change cannot govern the cloud project used above. **A human must still manually set the email rate-limit interval to 60s in the cloud project's Dashboard → Authentication → Rate Limits.** (Observed default cloud rate limit during live testing was already ~43-60s, per the real `over_email_send_rate_limit` message, but this should not be relied upon in place of the explicit Dashboard setting.)
