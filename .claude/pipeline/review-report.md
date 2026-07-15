# Code Review Report — 建立全站導覽 Header 元件
> Generated: 2026-07-15T17:15:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
Clean extraction of `AuthNav.tsx`'s login-state detection/logout logic into a shared `useAuthStatus` hook, consumed by a new global `Header.tsx` mounted in `RootLayout`. The one self-reported deviation from the architect plan (adding a `usePathname()` dependency to the detection effect) is a real, correctly-fixed bug, and — contrary to the concern raised in the review brief — it already has adequate automated regression coverage in `site-header.spec.ts`. `AuthNav.tsx` is fully removed with zero dangling references. Full Playwright suite (68 tests) passes with zero regressions.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None.

**Explicit determination on AGENTS.md's "auth/session/DATABASE_URL → automatic Critical" rule:** This diff does not trigger it. Reasoning, checked directly against the code rather than assumed:
- `src/proxy.ts` — confirmed zero diff (`git diff -- src/proxy.ts` empty). The actual enforcement boundary is untouched.
- No API route handlers, no `src/lib/supabase/*` factories, no cookie/token/credential handling touched anywhere in this diff.
- `useAuthStatus.ts` is a verbatim extraction of `AuthNav.tsx`'s existing detection (`GET /api/profile`, 200/401 → loggedIn/loggedOut) and logout (`logoutRequest()` + `router.refresh()`) logic — the semantics of *what makes someone authenticated* are unchanged.
- The one real behavioral change — adding `usePathname()` to the effect's dependency array — only changes *when* the client re-polls an already-existing, already-public status endpoint for UI-display purposes. It does not alter what the endpoint returns, does not change cookie/session establishment, and does not introduce any new trust decision. It is a re-fetch-cadence fix for a display component, not a change to authentication or session-establishment logic.
- The rule's intent (cross-referenced against AGENTS.md's Security Rules section and this task's own orchestrator Security Notes) is to catch changes to auth *decision-making* — bypasses, weakened checks, exposed secrets, differing status codes on account-existence-adjacent endpoints, etc. None of that is present here.
- Conclusion: this is auth-*adjacent* UI relocation, not auth-logic modification. Not automatic Critical. (Flagging this reasoning explicitly per instructions, rather than silently applying or silently waiving the rule.)

## 🟡 Should Fix (Auto-resolved by Developer)
None found.

## 💡 Suggestions (Consider — No Action Required)
1. **Two "個人資訊" links with distinct testids** (`header-nav-profile-link` in the middle nav, `header-profile-link` on the right, both `href="/profile"`) — verified this is implemented exactly as the architect plan specifies (deliberate redundancy, explicitly sanctioned in orchestrator Assumptions). Confirmed both actually resolve to `/profile` (no accidental mis-wiring). No action needed, logging per architect's own note.
2. `HeaderPage.authLoading` locator exists but is never asserted against in `site-header.spec.ts` (the loading-skeleton state has no dedicated test). This matches the architect plan's own explicit call — loading-state timing is inherently hard to assert deterministically in Playwright and was already accepted as an acceptable gap in the Test Plan, not a new omission introduced by the developer. No action required.

## Security Assessment
- Secrets scan: PASS (no hardcoded secrets/tokens/credentials; grep clean)
- Input validation: N/A (no new inputs/forms; Header only renders links/button)
- Auth/authz: PASS — `src/proxy.ts` unmodified (verified via `git diff`), remains the sole real enforcement boundary; Header's conditional link rendering is confirmed presentation-only (see below)
- No direct Supabase client usage introduced — confirmed `Header.tsx`/`useAuthStatus.ts` only call `fetch("/api/profile")` and the existing `logoutRequest()` wrapper, never `@supabase/supabase-js`
- Test coverage: Playwright acceptance gate, 68/68 passing (4 new `site-header.spec.ts` tests + 9 `membership-task7-task9.spec.ts` + 55 existing `venue-*.spec.ts` regression tests, all independently re-run by this review, not taken from the implementer's report)

## Independent Verification Performed (not trusting the implementer's report)

1. **Bug-fix causality proof.** Read `src/lib/useAuthStatus.ts` and reasoned through why `RootLayout`-level mounting changes remount semantics vs. the old per-page `AuthNav`: `AuthNav` previously lived only on the home page, so navigating from `/login` to `/` via `router.push("/")` (confirmed at `src/app/login/page.tsx:90`, a client-side soft navigation) caused a fresh component mount and thus a fresh detection fetch. `Header` now mounts once in `RootLayout`, which persists across client-side navigation in the App Router, so without a re-trigger the effect would only ever fire once per hard navigation. To prove this wasn't just a plausible-sounding story, I temporarily reverted the fix (`}, [pathname]);` → `}, []);`) and reran `site-header.spec.ts -g "logged-in state"`: it failed exactly as predicted (`header-nav-profile-link` never appears after login). Restored the fix and reconfirmed the test passes. This is a real bug, correctly fixed, and the existing test (not a new one) already fails without the fix — i.e., it is inherently a regression test for this exact bug, contrary to the review brief's suggestion that coverage might be missing.
2. **`grep -rn "AuthNav"` across `src/` and `playwright-tests/`** — ran it myself, zero hits (exit code 1). Definition of Done requirement satisfied.
3. **"場地規劃" naming consistency** — read both `Header.tsx` (line 40, "場地規劃") and `src/app/venue/page.tsx` (line 7, `<h1>`, "場地規劃"). Identical text, confirmed.
4. **Two "個人資訊" links** — read `Header.tsx` lines 28–34 and 55–61: both `<Link href="/profile">`, distinct `data-testid`s. Not a defect.
5. **Middle-nav conditional rendering** — read the actual JSX: `{state === "loggedIn" && (...)}` (lines 26–43). This is a true conditional render (nothing returned to the tree, not CSS `hidden`/`display:none`) for both `loading` and `loggedOut` states. Confirmed via the passing `toHaveCount(0)` assertions in `site-header.spec.ts` for the logged-out case.
6. **`src/proxy.ts` untouched** — `git diff -- src/proxy.ts` and `git status --short src/proxy.ts` both empty.
7. **Full Playwright regression** — started a clean `npm run dev`, ran the entire suite (`site-header.spec.ts`, `membership-task7-task9.spec.ts`, `venue-plan-editor.spec.ts`, `venue-objects.spec.ts`, `venue-dimensions.spec.ts`, `venue-3d-scene.spec.ts`): 68/68 passed. Confirms the architect-flagged risk (persistent header shrinking vertical space, possibly affecting canvas pixel-coordinate assertions in venue specs) did not materialize.
8. **Code quality** — `npx eslint` and `npx tsc --noEmit` both clean on all changed files. `grep -n "TODO\|FIXME\|: any\|as any"` across new/changed files: zero hits.

## Plan Compliance
- [x] All architect plan steps implemented (`useAuthStatus.ts`, `Header.tsx` created; `layout.tsx`, `page.tsx` modified; `AuthNav.tsx` deleted; `HeaderPage.ts`, `site-header.spec.ts` added; `HomePage.ts`, `membership-task7-task9.spec.ts` updated)
- [x] Implementation matches plan intent
- [x] No unauthorised scope additions — the one deviation (pathname dependency) is a bug fix required for the plan's own stated behavior ("no full reload on logout/login") to actually work, not scope creep

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| Self-reported deviation: `usePathname()` dependency added to `useAuthStatus`'s detection effect | Reported as a bug found during implementation: Header's persistent RootLayout mount means the original mount-once effect never observes `router.push('/')` after login | Independently verified via revert-and-retest: confirmed the bug is real and the fix is correct and already covered by the existing `site-header.spec.ts` "logged-in state" test |
