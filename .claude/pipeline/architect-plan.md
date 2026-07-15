# Architect Plan — 建立全站導覽 Header 元件

> Story: 全站導覽 Header 與個人資料編輯模式 | Task type: FRONTEND | Generated: 2026-07-15T15:45:00+08:00

## Overview

Extract the login-state detection/logout logic currently embedded in `AuthNav.tsx` into a shared client hook (`useAuthStatus`), build a new slim-bar `Header` component on top of that hook, mount it globally in `RootLayout`, strip the now-redundant `<AuthNav />` block from the home page, and delete `AuthNav.tsx` (fully superseded, no remaining callers). Update the Playwright page-object layer to reflect the new global header and add a dedicated spec for it.

## Task Type Confirmed

FRONTEND

## Files to Create

| File path | Purpose |
| --- | --- |
| `src/lib/useAuthStatus.ts` | Client hook extracted from `AuthNav.tsx`: owns `loading/loggedIn/loggedOut` state via `GET /api/profile`, and a `logout()` action wrapping `logoutRequest()` + `router.refresh()`. Single source of truth for auth-state detection so `Header.tsx` doesn't reimplement it. |
| `src/components/Header.tsx` | New global slim horizontal nav bar, `"use client"`, consumes `useAuthStatus()`. Three sections (site title / middle nav links / auth actions) per spec. |
| `playwright-tests/pages/HeaderPage.ts` | Page object for the header, usable from any spec regardless of which page is loaded (header is present everywhere). Wraps the `data-testid` locators defined below plus a `logout()` helper. |
| `playwright-tests/site-header.spec.ts` | New spec covering header presence across all five routes, conditional nav-link visibility by auth state, navigation correctness, and confirming home page no longer double-renders login/register/logout controls. |

## Files to Modify

| File path | What changes |
| --- | --- |
| `src/app/layout.tsx` | Import `Header` from `@/components/Header` and render `<Header />` as the first child inside `<body>`, immediately above `{children}`. |
| `src/app/page.tsx` | Remove `import AuthNav from "@/components/AuthNav"` and the `<AuthNav />` element. Home page keeps only the `<h1>展覽自動排程</h1>` + description `<p>`; drop the now-unnecessary `sm:items-start`/gap wrapper only if it was solely there to seat `AuthNav` (see Implementation Steps — keep layout minimal but do not over-refactor spacing that still applies to the remaining two elements). |
| `src/components/AuthNav.tsx` | **Delete.** After `page.tsx` is updated, this component has zero remaining imports anywhere in `src/` (confirmed: currently only referenced from `src/app/page.tsx`). Its behavior is fully absorbed into `useAuthStatus.ts` (detection) + `Header.tsx` (rendering). Leaving it in place would be dead code violating the Definition of Done. |
| `playwright-tests/pages/HomePage.ts` | Remove `loginLink`, `registerLink`, `profileLink`, `logoutButton`, and the `logout()` method — these no longer belong to the home page, they belong to the header (now covered by `HeaderPage.ts`). `HomePage` keeps only `navigate()` plus any home-specific content locators (headline/description) if a spec needs them. |
| `playwright-tests/membership-task7-task9.spec.ts` | Replace `homePage.logout()` call (AC4/AC5/AC6/AC7 test, currently around line 59-80) with `headerPage.logout()`, importing and instantiating `HeaderPage`. This is the only existing spec that exercises logout via `HomePage`; grep confirms no other spec references `HomePage.loginLink/registerLink/profileLink/logoutButton`. |

## Implementation Steps

1. **Create `src/lib/useAuthStatus.ts`.** Move the `AuthState` type, the `useState`/`useEffect` block (fetch `/api/profile`, `credentials: "same-origin"`, `.then`/`.catch` mapping to `loggedIn`/`loggedOut`, the `active` cleanup-flag guard), and the `handleLogout` async function (guarded by `loggingOut`, calls `logoutRequest()`, sets `loggedOut`, calls `router.refresh()`, `finally` resets `loggingOut`) verbatim out of `AuthNav.tsx` into this new file. Mark the file `"use client"`. Export a `useAuthStatus()` hook returning `{ state: AuthState, loggingOut: boolean, logout: () => Promise<void> }`. Do not alter the detection/logout semantics — this is a pure extraction, not a rewrite (per orchestrator constraint: "不得重寫偵測邏輯").

2. **Create `src/components/Header.tsx`.** `"use client"` component:
   - Root element: `<header data-testid="site-header" className="...">` — slim horizontal bar. Use `border-b border-black/12 dark:border-white/18` for the bottom rule (existing token), `bg-background` or transparent (match existing `background`/`foreground` CSS vars used elsewhere), padding `px-4 py-3` or similar, `flex items-center justify-between` with a middle `flex-1` section for nav links, wrapping to a second line on narrow viewports via `flex-wrap gap-y-2` (no hamburger menu, per Out of Scope).
   - **Left section:** `<Link href="/" data-testid="header-home-link" className="font-semibold text-black dark:text-zinc-50">展覽自動排程</Link>` (site title text sourced from `metadata.title`, per Assumptions).
   - **Middle section:** rendered only when `state === "loggedIn"` (nothing rendered — not disabled, not hidden via CSS — while `loading` or `loggedOut`, per the edge case about avoiding UI flicker):
     - `<Link href="/profile" data-testid="header-nav-profile-link">個人資訊</Link>`
     - `<Link href="/venue" data-testid="header-nav-venue-link">場地規劃</Link>` — **use "場地規劃"**, not "場地產生器": `src/app/venue/page.tsx`'s own `<h1>` reads "場地規劃", and the orchestrator's Assumptions section explicitly instructs deferring to the existing page's title wording for site-wide naming consistency in this exact scenario. Flagging this here since it's a literal-text deviation from the orchestrator's own prose ("場地產生器") — it is deliberate and spec-sanctioned, not an oversight.
     - Style as plain text links: `text-sm font-medium text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50` (no pill/border, per confirmed slim-bar direction).
   - **Right section**, driven by `useAuthStatus()`:
     - `state === "loading"`: `<div data-testid="header-auth-loading" className="h-8 w-24 animate-pulse rounded bg-black/6 dark:bg-white/8" />` — small skeleton sized for a text-link bar (not the `h-11 w-40` rounded-full skeleton from `AuthNav`, which was sized for pill buttons).
     - `state === "loggedIn"`: `<Link href="/profile" data-testid="header-profile-link" className="text-sm font-medium ...">個人資訊</Link>` followed by `<button type="button" data-testid="header-logout-button" onClick={logout} disabled={loggingOut} className="text-sm font-medium ... disabled:cursor-not-allowed disabled:opacity-60">{loggingOut ? "登出中…" : "登出"}</button>`. Per orchestrator AC this right-side "個人資訊" entry is required verbatim alongside the middle-nav one; keep both (Assumptions explicitly permits two entry points) but give them **distinct testids** (`header-nav-profile-link` vs `header-profile-link`) since both render the same accessible name "個人資訊" — a bare `getByRole("link", { name: "個人資訊" })` would be ambiguous (Playwright strict-mode violation), which is itself the concrete reason this task's Playwright hooks must use `data-testid` rather than the role/text selectors `LoginPage.ts` used historically (that file's rationale — "no data-testid anywhere yet" — no longer holds once this header ships two same-named links).
     - `state === "loggedOut"`: `<Link href="/login" data-testid="header-login-link">登入</Link>` + `<Link href="/register" data-testid="header-register-link">註冊</Link>`, plain text-link styling (not `AuthNav`'s `bg-foreground` filled-pill primary CTA).
   - Import `useAuthStatus` from `@/lib/useAuthStatus`; do not call `fetch`/`useState`/`useEffect` directly in this file for auth detection — that would be exactly the parallel-logic duplication the spec forbids.

3. **Mount in `src/app/layout.tsx`.** Add `import Header from "@/components/Header";` and change:
   ```tsx
   <body className="min-h-full flex flex-col">
     <Header />
     {children}
   </body>
   ```
   No other changes to `layout.tsx`. `RootLayout` stays a Server Component; `Header` itself is a client boundary (like `AuthNav` was), which is allowed to be rendered from a server component per existing project pattern (`page.tsx` already did this with `AuthNav`).

4. **Update `src/app/page.tsx`.** Remove the `AuthNav` import and its `<AuthNav />` element. Resulting body:
   ```tsx
   export default function Home() {
     return (
       <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
         <main className="flex w-full max-w-xl flex-col items-center gap-8 text-center sm:items-start sm:text-left">
           <div className="flex flex-col gap-4">
             <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
               展覽自動排程
             </h1>
             <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
               登入後即可管理個人資料並使用個人化的排程功能。
             </p>
           </div>
         </main>
       </div>
     );
   }
   ```
   Keep the outer `gap-8`/`items-center` wrapper as-is even though only one child (`<div>`) remains inside `<main>` — collapsing it is a cosmetic micro-refactor outside this task's scope and risks an unrelated visual regression; only remove the `<AuthNav />` line itself and its import.

5. **Delete `src/components/AuthNav.tsx`.** Confirm via `grep -rn "AuthNav" src/ playwright-tests/` immediately before deleting that step 4 removed the only remaining import. (project-doc.md's Modularity/Cross-Cutting notes about `AuthNav.tsx` "client-side login-state detection" become stale once this lands — that's expected to be picked up by the next AGENTS.md delta scan, not manually edited here.)

6. **Add `playwright-tests/pages/HeaderPage.ts`:**
   ```ts
   import type { Page, Locator } from "@playwright/test";

   export class HeaderPage {
     readonly page: Page;
     readonly homeLink: Locator;
     readonly navProfileLink: Locator;
     readonly navVenueLink: Locator;
     readonly authLoading: Locator;
     readonly profileLink: Locator;
     readonly logoutButton: Locator;
     readonly loginLink: Locator;
     readonly registerLink: Locator;

     constructor(page: Page) {
       this.page = page;
       this.homeLink = page.getByTestId("header-home-link");
       this.navProfileLink = page.getByTestId("header-nav-profile-link");
       this.navVenueLink = page.getByTestId("header-nav-venue-link");
       this.authLoading = page.getByTestId("header-auth-loading");
       this.profileLink = page.getByTestId("header-profile-link");
       this.logoutButton = page.getByTestId("header-logout-button");
       this.loginLink = page.getByTestId("header-login-link");
       this.registerLink = page.getByTestId("header-register-link");
     }

     async logout() {
       await this.logoutButton.click();
       await this.loginLink.waitFor({ state: "visible" });
     }
   }
   ```

7. **Update `playwright-tests/pages/HomePage.ts`:** remove `loginLink`, `registerLink`, `profileLink`, `logoutButton`, and `logout()` (moved to `HeaderPage`). Keep `navigate()`. If nothing else references this class's removed members, it becomes a thin `navigate()`-only wrapper — that's fine, don't delete the file since `membership-task7-task9.spec.ts` still imports `HomePage` for `navigate()`-adjacent assertions.

8. **Update `playwright-tests/membership-task7-task9.spec.ts`:** in the AC4/AC5/AC6/AC7 test, add `import { HeaderPage } from "./pages/HeaderPage";`, instantiate `const headerPage = new HeaderPage(page);`, and replace the `homePage.logout()` call with `headerPage.logout()`. Leave all other assertions in that spec untouched — grep confirms this is the only spot referencing the removed `HomePage` members.

9. **Add `playwright-tests/site-header.spec.ts`.** Structure (no new page objects beyond `HeaderPage`, reuse existing `LoginPage`/`ProfilePage`/`HomePage`):
   - `test.describe("Header: presence and layout")`:
     - Logged-out: visit `/`, `/login`, `/register` in turn, assert `headerPage.homeLink` visible on each (covers "consistent across pages" AC for the unauthenticated-reachable routes).
   - `test.describe("Header: logged-out state")`:
     - On `/`, assert `headerPage.loginLink` and `headerPage.registerLink` visible, `headerPage.navProfileLink`/`navVenueLink` **not present in DOM** (`toHaveCount(0)`, not just hidden), `headerPage.logoutButton` count 0.
     - Click `headerPage.loginLink` → assert URL `/login`. Click `headerPage.homeLink` from `/login` → assert URL `/`. Similarly `registerLink` → `/register`.
   - `test.describe("Header: logged-in state")` (uses `PW_VERIFIED_EMAIL`/`PW_VERIFIED_PASSWORD` from `.env.playwright.local`, same credentials pattern as `membership-task7-task9.spec.ts`):
     - Log in via `LoginPage`, then assert on `/`: `headerPage.navProfileLink`, `headerPage.navVenueLink`, `headerPage.profileLink`, `headerPage.logoutButton` all visible; `headerPage.loginLink`/`registerLink` count 0.
     - Click `headerPage.navVenueLink` → assert URL `/venue` and header still visible (`homeLink` visible) on the venue page.
     - Click `headerPage.navProfileLink` (or `headerPage.profileLink`) → assert URL `/profile`.
     - `headerPage.logout()` → assert back to logged-out header state (`loginLink` visible, `navProfileLink` count 0) — covers the no-full-reload AC since this happens within the same Playwright page context.
   - `test.describe("Home page: no duplicate auth controls")`:
     - Logged-out visit to `/`: assert there is exactly one `登入`-labelled control (`headerPage.loginLink`) and exactly one `註冊`-labelled control on the page (`page.getByRole("link", { name: "登入" })` count === 1), proving the old in-page `<AuthNav />` block is gone and the header isn't double-rendering.
   - Reuse the `waitForLoadState("networkidle")` convention seen in `LoginPage.navigate()`/`ProfilePage.navigate()` for any raw `page.goto()` calls in this spec.

## Data Flow

`Header` (client component, mounted once per page load inside `RootLayout`'s `<body>`) → `useAuthStatus()` hook → on mount, `fetch("/api/profile")` (same-origin, cookie-based session) → `src/proxy.ts` gate passes the request through to the route handler (already authenticated via `@supabase/ssr` cookie) → route handler responds 200 (profile payload, only status code consumed by the hook) or 401 → hook sets `loggedIn`/`loggedOut` → `Header` conditionally renders middle nav links + right-side auth controls. Logout: `Header`'s button → `useAuthStatus().logout()` → `logoutRequest()` (existing `src/lib/auth-client.ts` wrapper) → `POST /api/auth/logout` → cookie cleared server-side → hook sets `loggedOut` + `router.refresh()` (re-runs Server Component tree, e.g. re-evaluates any server-rendered auth-dependent content, though currently none besides `proxy.ts` redirects on next navigation). No new API routes, no new Supabase calls, no change to `src/proxy.ts`'s own access-control decisions — the header's link visibility is presentation-only, `proxy.ts` remains the actual enforcement boundary (per orchestrator Security Notes).

## Test Plan

- **Playwright (acceptance gate for this FRONTEND task):**
  - New `playwright-tests/site-header.spec.ts` (Step 9 above) — covers all Clarified Acceptance Criteria: header presence on every page, left/middle/right sections, middle-nav hidden-not-disabled when logged out, right-side loading skeleton not flashing wrong state, right-side loggedIn/loggedOut rendering, logout flips state without full reload, home page has no duplicate auth controls.
  - Updated `playwright-tests/membership-task7-task9.spec.ts` (Step 8) must still pass unmodified in outcome (only the locator source for `logout()` changes) — this is the regression check that `src/proxy.ts` page-protection behavior (Task 7) and the resend-cooldown flow (Task 9) are unaffected by the header refactor.
  - Run the full existing suite (`venue-*.spec.ts`, `membership-task7-task9.spec.ts`) after the change, not just the new spec — the header now appears on `/venue` too, so `PlanEditorPage`-based specs must be re-verified to confirm the new `<header>` element doesn't shift any coordinate-dependent or viewport-dependent assertions (e.g. canvas click coordinates in `venue-plan-editor.spec.ts`/`venue-objects.spec.ts`). Flagging this explicitly as a risk area — see Architecture Notes.
- **No manual checklist needed.** This task has no WebGL/canvas/opacity-timing concern (that was specific to the venue 3D scene's `venue-plan-editor.md` manual section) and no backend/API surface change requiring the Insomnia/SQL manual verification track — it is plain DOM/React/routing, fully Playwright-testable. Confirming explicitly per the task brief's requirement not to silently omit this decision.
- **Edge cases to test (from orchestrator-output.md), mapped to spec:**
  - Middle-nav flicker prevention while `loading` → covered by asserting `navProfileLink`/`navVenueLink` have count 0 immediately after `goto()` before `waitForLoadState("networkidle")` settles, if the timing is reliably observable; otherwise this remains a design guarantee validated indirectly via the loggedOut-state assertions (loading and loggedOut both render zero middle-nav links, so any flicker would only be visible mid-transition, which is inherently hard to assert deterministically in Playwright — acceptable, matches how `AuthNav`'s original loading state was never separately Playwright-tested either).
  - Mobile-width layout (no hamburger required) → not a hard Playwright assertion per Out of Scope ("不要求做出收合互動"); optional smoke check via `page.setViewportSize` asserting `headerPage.homeLink` still visible/clickable at e.g. 375px width, no forced overlap assertion.
  - `GET /api/profile` failure → same as existing `AuthNav` `.catch()` behavior, not independently re-tested (behavior is inherited unchanged from the extracted hook).

## Architecture Notes

- **Hook extraction, not duplication.** `useAuthStatus.ts` is the single implementation of login-state detection + logout; `Header.tsx` is the only consumer after `AuthNav.tsx` is deleted. If a future task needs the same state elsewhere, it imports the hook — no second copy.
- **"場地規劃" vs "場地產生器" naming** — see Step 2. Using the venue page's actual `<h1>` text for consistency, per the orchestrator's own explicit instruction to defer to it. Flagged so this isn't mistaken for an unauthorized spec deviation during review.
- **Two "個人資訊" links on one page when logged in** (middle nav + right side) — both point to `/profile`, distinguished only by `data-testid`, not by visually distinct copy. This is deliberate (Assumptions section permits it) but is a minor UX redundancy worth a 💡-level review note; not a defect.
- **Risk area: viewport/coordinate regressions in venue specs.** The new persistent `<header>` reduces the vertical space available to `/venue`'s content compared to today's zero-header layout. `venue-plan-editor.spec.ts`/`venue-objects.spec.ts`/`venue-dimensions.spec.ts`/`venue-3d-scene.spec.ts` interact with a Konva `<Stage>` and Three.js canvas using pixel-relative or bounding-box-relative coordinates (via `PlanEditorPage.ts`), not fixed viewport offsets, so they should be unaffected — but this must be verified by actually running the full suite (Test Plan above), not assumed.
- **No performance concerns** — `useAuthStatus` fires exactly one `fetch` per full page load, identical cost to today's `AuthNav`, just triggered from a layout-level mount instead of a page-level one (RootLayout persists across client-side navigations under App Router, so this remains one fetch per hard navigation/reload, not one per route change — consistent with existing "detect once on mount" behavior, no polling introduced).

## Security Checklist

- [x] No hardcoded secrets or credentials — no new env-dependent code introduced.
- [x] Input validation implemented at system boundaries — N/A, no new inputs/forms; Header only renders links/button, no data entry.
- [x] Auth/permission checks in place (if applicable) — enforcement stays entirely in `src/proxy.ts` (unmodified); Header's conditional rendering is presentation-only and must not be mistaken for access control (explicitly noted in orchestrator Security Notes and repeated in Architecture Notes above).
- [x] No sensitive data logged — no new logging added; `useAuthStatus` never logs the `/api/profile` response body, cookies, or tokens.
- [x] No direct Supabase client usage introduced — `Header`/`useAuthStatus` only call `fetch("/api/profile")` and the existing `logoutRequest()` wrapper (which itself calls `/api/auth/logout`), never `@supabase/supabase-js` directly, per AGENTS.md Developer guardrail.

## Definition of Done

- [ ] All implementation steps complete (`useAuthStatus.ts`, `Header.tsx` created; `layout.tsx`, `page.tsx` modified; `AuthNav.tsx` deleted; Playwright page objects and specs updated/added).
- [ ] All tests from the Test Plan written and passing — `site-header.spec.ts` plus a full regression run of every existing `playwright-tests/*.spec.ts` file (not just a subset).
- [ ] No TODOs, commented-out code, or debug logs.
- [ ] Code follows all rules in AGENTS.md (path alias `@/*`, `eslint-config-next` clean, Supabase access only via existing factories/API routes, `data-testid` convention followed for new interactive/state elements).
- [ ] Security checklist passed.
- [ ] `grep -rn "AuthNav"` across `src/` and `playwright-tests/` returns zero hits before considering this task complete (confirms clean removal, no dangling references).
