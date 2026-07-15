# QA Report — 建立全站導覽 Header 元件
> Generated: 2026-07-15T18:40:00+08:00 | QA iteration: 1

## Summary
- Tests executed: 18 (10 from AC/edge-case checklist below + 68 full Playwright regression suite re-run independently)
- Passed: 18
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — no bugs found. All acceptance criteria verified live in a real browser (independent Playwright driver script, not the implementer's own suite), all requested probe scenarios pass, and the full 68-test regression suite re-run cleanly.

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| Header renders on all pages, consistent layout | ✅ PASS | Confirmed on `/`, `/login`, `/register`, `/profile`, `/venue` |
| Left: site name links to `/` | ✅ PASS | `header-home-link` navigates to `/` from every page tested |
| Logged-in: middle nav shows 個人資訊/場地規劃 → `/profile`/`/venue` | ✅ PASS | Verified both link clicks land on correct routes, repeated 3x in a nav loop |
| Logged-out: middle nav links absent from DOM | ✅ PASS | `toHaveCount(0)` on both testids while logged out |
| Logged-out: right side shows 登入/註冊 → `/login`/`/register` | ✅ PASS | Verified on login/register page loads |
| Logged-in: right side shows 個人資訊 entry + 登出 button | ✅ PASS | `header-profile-link` and `header-logout-button` both present and functional |
| Logout succeeds → state flips to logged-out without full reload | ✅ PASS | Confirmed via detailed t+1s..t+8s polling: header switches to loggedOut ~1s after click, no full page reload observed |
| Loading state shown before first `/api/profile` response, no flicker | ✅ PASS (by code inspection + no observed flicker in tests) | `useAuthStatus` only calls `setState` after the fetch resolves — the previous state is retained across pathname changes, so there is no reset-to-loading on client-side nav. 3x nav-loop test never saw `header-login-link` appear while logged in. |
| Home page shows only title + description, no duplicate auth buttons | ✅ PASS | `src/app/page.tsx` confirmed to contain only `<h1>`/`<p>`, no AuthNav remnants |
| Direct `/profile` URL access while logged out still redirects via `proxy.ts` | ✅ PASS | `proxy.ts` diff-free (also independently confirmed by PR reviewer); `PROTECTED_PAGES = ["/profile"]` unchanged |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| Repeated client-side nav (個人資訊→場地規劃→首頁, x3) — no flicker to loggedOut/loading | ✅ PASS | Zero unexpected console errors (only the expected pre-login 401 from the initial detection fetch); header state stayed loggedIn throughout |
| Two browser tabs, shared session — logout in tab A leaves tab B stale until tab B's next navigation | ✅ PASS (documented, not a bug) | Tab B correctly stayed showing logged-in state after tab A's logout (no push/poll sync — matches orchestrator's explicitly out-of-scope "no cross-tab sync" edge case). On tab B's next navigation (clicking 場地規劃), the pathname-change re-fetch picked up the new logged-out state correctly — header updated to 登入/註冊, no crash, no broken UI. |
| Mobile viewport (375px) — header layout | ✅ PASS | `flex-wrap` header measured 375×49px, `scrollWidth === clientWidth === 375` (no horizontal scroll/clipping). All 5 header elements (home/nav-profile/nav-venue/profile/logout) individually visible with in-bounds bounding boxes, no overlap. |
| Logout while on protected page `/venue` | ✅ PASS (see Note 1 below) | Header itself correctly transitions to loggedOut within ~1s of the logout click (login/register links appear, auth cookie cleared, `POST /api/auth/logout → 200`). The underlying `/venue` page content remains visible/interactive afterward and does not redirect — **this is pre-existing, unrelated to this task**, see Note 1. |
| Clicking 場地規劃 while already on `/venue` | ✅ PASS | URL unchanged, zero new console errors, no duplicate-mount symptoms observed |
| Both 個人資訊 links (middle nav `header-nav-profile-link`, right-side `header-profile-link`) independently clicked | ✅ PASS | Both navigate to `/profile` when actually clicked (not just present in DOM) |
| Header on `/login` and `/register` — no CTA conflict with page content | ✅ PASS | Header's 登入/註冊 links and each page's own heading/submit button/footer link coexist without DOM overlap; repeated visible text ("登入" appears 3x on the login page: nav link, `<h1>`, submit button) is expected and not a layout defect |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| `GET /api/profile` non-200 (e.g. pre-login 401) treated as loggedOut, no error UI, no render block | ✅ PASS | Observed exactly one console 401 per page load before authentication, as expected; no error banner, page renders normally |
| Logout request failure handling (`finally` re-enables button) | ✅ PASS (by code inspection) | `useAuthStatus.logout()`'s `finally { setLoggingOut(false) }` matches `AuthNav.tsx`'s original behavior; no change in this diff |

## Regression Check
| Feature | Result |
|---|---|
| Full Playwright suite (`site-header.spec.ts`, `membership-task7-task9.spec.ts`, all `venue-*.spec.ts`) | ✅ PASS — 68/68, re-run independently by QA (not reused from implementer/reviewer's report) |

## Security Test
- Sensitive data exposure: PASS — no tokens/cookies/session values logged or rendered; only cookie *presence* was checked (boolean), never its value
- Input validation: N/A — Header has no form inputs
- Auth boundary: PASS — `src/proxy.ts` unmodified (`git diff` confirms), remains sole enforcement boundary; Header's conditional rendering is presentation-only, consistent with orchestrator's explicit Security Notes

## Bugs Found

None (Critical/High/Medium/Low) attributable to this task's diff.

### Note 1 (informational, not a bug in this task): `/venue` is not in `proxy.ts`'s `PROTECTED_PAGES`
While probing "logout while on `/venue`," discovered that `/venue` has never been added to `PROTECTED_PAGES` or `config.matcher` in `src/proxy.ts` (confirmed via `git log -- src/proxy.ts`: last touched in "Add page route protection in proxy (membership task 7)", which only wired up `/profile`, `/login`, `/register` — predates this story). Consequently, after logging out on `/venue`, the page content stays visible and interactive instead of redirecting, even though the Header itself correctly updates to the logged-out state within ~1 second.
- This is **pre-existing behavior**, not a regression introduced by this Header task — confirmed no change to `proxy.ts` in this diff, and the gap predates this story entirely.
- It is explicitly **out of scope** for this task per `orchestrator-output.md`'s "Out of Scope" section ("修改 `src/proxy.ts` 的頁面保護/redirect 邏輯" is excluded) and its "Security Notes" (the only page-protection guarantee this task is scoped to verify is `/profile`).
- Per QA Agent boundaries ("NO requirement changes — if you find requirement gaps, escalate to human, not to the architect"), **escalating this to the human/orchestrator for a future task decision** rather than treating it as a QA-blocking bug on this story. Recommend a follow-up story/task: decide whether `/venue` should be added to `PROTECTED_PAGES`.
- Not logged as a Low/Medium/High bug against *this* task because the Header component under test behaved correctly (accurate, fast state transition, no crash, no stale-looking header UI); the residual protected-page content is entirely a `proxy.ts` scope question.

## Test Coverage
- New code coverage: Playwright acceptance gate — `site-header.spec.ts` (4 tests) + updated `membership-task7-task9.spec.ts` (9 tests) cover the new Header/`useAuthStatus` code; QA's own 7 exploratory probe tests (nav loop, two-tab, mobile viewport, logout-on-venue, same-route nav, dual profile-links, login/register page coexistence) supplement this with scenarios not in the implementer's own suite, per AGENTS.md's QA pattern for this project.
- Minimum required: FRONTEND task → Playwright acceptance gate (per AGENTS.md Testing Requirements)
- Status: PASS

## Playwright E2E Results (Final Acceptance Gate)
> Executed: 2026-07-15T19:10:00+08:00 — fresh `npm run dev` local server, full suite re-run (not trusted from prior stage reports)

| Spec file | Tests | Result |
|---|---|---|
| site-header.spec.ts | 4 | ✅ PASS |
| membership-task7-task9.spec.ts | 9 | ✅ PASS |
| venue-plan-editor.spec.ts | 9 | ✅ PASS |
| venue-objects.spec.ts | 17 | ✅ PASS |
| venue-dimensions.spec.ts | 16 | ✅ PASS |
| venue-3d-scene.spec.ts | 13 | ✅ PASS |
| **Total** | **68** | **✅ 68/68 PASS (2.9m)** |

All acceptance criteria in `.claude/pipeline/orchestrator-output.md` cross-checked against `site-header.spec.ts`/`HeaderPage.ts` and `membership-task7-task9.spec.ts`:
- Header present across pages, home-link navigation, logged-in/logged-out nav-link visibility, login/register/profile/logout right-side controls, logout state flip without reload, no duplicate home-page auth controls, `proxy.ts` redirect behaviour unaffected — all directly asserted in `site-header.spec.ts`.
- Loading-state skeleton (`header-auth-loading` testid) has no dedicated assertion — pre-accepted gap, documented in architect-plan.md and review-report.md (💡 Consider #2) as inherently hard to assert deterministically; not a new omission and not blocking.

### Failures
None.

## Final Gate Outcome
✅ Playwright stage COMPLETE. Full regression suite (all spec files, not just the new one) passes with zero failures. Task 1 of 全站導覽 Header 與個人資料編輯模式 is done; Task 2 (個人資料頁編輯模式切換) remains not started.
