# Code Review Report — 會員系統 Task 8: `/api/auth/resend`
> Generated: 2026-07-11T10:30:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
The implementation faithfully mirrors the architect plan and the `register` route's anti-enumeration pattern. All four outcome branches (success / nonexistent email / already-verified / rate-limited) return an identical `200` status and identical body, the error log omits the email, `proxy.ts` gains exactly the one whitelisted path with the matcher untouched, `config.toml`'s `max_frequency` is `60s`, and the route uses the user-context `server.ts` client (not `admin.ts`) as the plan specified. Lint and `tsc --noEmit` both pass clean.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None. Given this is an auth-adjacent change (AGENTS.md automatic-critical-scrutiny rule), it received the strictest review of the anti-enumeration behavior specifically, and no status/body divergence was found.

## 🟡 Should Fix (Auto-resolved by Developer)
None.

## 💡 Suggestions (Consider — No Action Required)
### Suggestion 1
- **File**: `src/app/api/auth/resend/route.ts:16`
- **Note**: `!("email" in body)` on a non-null object also passes for arrays (`typeof [] === "object"`), e.g. `[1,2]` would fail the later `typeof email !== "string"` check anyway and still correctly 400, so behavior is unaffected — purely a style note, same pattern already exists in `register/route.ts`, no need to diverge here.

### Suggestion 2
- There is an untracked `Design.pdf` (~1MB) sitting at the repo root, unrelated to this task's diff. Not blocking this review since it's outside the reviewed changeset, but worth the developer confirming it isn't meant to be committed/ignored.

## Security Assessment
- Secrets scan: PASS (no hardcoded secrets; `NEXT_PUBLIC_SITE_URL` read from env only, same as `register`)
- Input validation: PASS (JSON-parse try/catch → 400 non-JSON; missing/non-object/non-string/empty email → 400; regex format check → 400 — all boundary cases from the plan covered)
- Auth/authz: PASS — route added to `PUBLIC_API_PATHS` (intentionally public per spec, unauthenticated users must be able to request resend); `config.matcher` left untouched as required
- **Anti-enumeration (primary audit target, Task 2's bug class)**: PASS — verified both the success path (`return Response.json({ message: GENERIC_RESEND_MESSAGE }, { status: 200 })`) and the error path (`if (error) { console.error(...); return Response.json({ message: GENERIC_RESEND_MESSAGE }, { status: 200 }); }`) emit byte-identical status (200) and body across success / nonexistent-email / already-verified / rate-limited (429) cases — Supabase never distinguishes these to the route, so all four collapse into the single `error` vs. no-`error` branch, and both branches converge on the same response. No status code or body field carries distinguishing information.
- Logging: PASS — `console.error` line interpolates only `error.status`, `error.code`, `error.message`; email/token/session/cookie never appear in the log line
- Client factory: PASS — uses `createSupabaseServerClient()` from `src/lib/supabase/server.ts` (anon/user-context), not `admin.ts`; matches the plan's least-privilege rationale (public GoTrue `/resend` endpoint doesn't need service_role)
- `proxy.ts`: PASS — exactly one line added (`"/api/auth/resend",`) to `PUBLIC_API_PATHS`; `config.matcher` (`"/api/:path*"`, `/profile`, `/login`, `/register`) unchanged; fail-closed default preserved for all other routes
- `supabase/config.toml`: PASS — `[auth.email] max_frequency` changed from `"1s"` to `"60s"` exactly as specified; no unrelated fields touched
- Test coverage: manual checklist (`supabase/tests/auth_routes_manual.md` §4B, 8 sub-cases including an explicit byte-for-byte comparison instruction for the anti-enumeration assertion) + Insomnia request added — acceptable per AGENTS.md (no JS test framework installed)
- Vulnerable dependencies: PASS — no dependency changes in this diff

## Plan Compliance
- [x] All architect plan steps implemented (route handler, proxy whitelist, config.toml, manual checklist, Insomnia entry)
- [x] Implementation matches plan intent (structure copied from `register/route.ts`, generic message text verbatim, `emailRedirectTo` identical to register's)
- [x] No unauthorised scope additions (no frontend button/countdown — correctly deferred to Task 9 per Out of Scope)

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| (none — no findings required developer action) | — | — |
