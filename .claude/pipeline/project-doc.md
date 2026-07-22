# Project Documentation
> Generated: 2026-07-08 | Mode: FULL | Last delta: 2026-07-17 (points system 補件 scan)
> ⚠️ 已知落差:2026-07-11 至今另有 site-navigation story(全站 Header + profile 編輯模式)、venue-whitebox-generator story(場地規劃器 + 3D)、shadcn/ui 導入等變更,尚未完整回寫本文件;本次 delta 僅涵蓋點數系統 commit(5c6c7d7)。

## Tech Stack
- Runtime: Node.js 22.21.1 (pinned in `.nvmrc`)
- Language: TypeScript (strict mode)
- Framework: Next.js 16.2.10 (App Router) — **non-standard version, breaking changes from training data. Consult `node_modules/next/dist/docs/` before writing framework-specific code.**
- Database: Postgres via Supabase (Auth + Postgres). Server-side access only, through our own Next.js API routes.
- Styling: Tailwind CSS v4 (`@tailwindcss/postcss`)
- State Management: none yet (no state library installed)

## Dependencies
- Core: next@16.2.10, react@19.2.4, react-dom@19.2.4, @supabase/supabase-js@^2.109.0, @supabase/ssr@^0.12.0
- Dev: typescript@5, eslint@9, eslint-config-next@16.2.10, tailwindcss@4, supabase@^2.109.1 (CLI), @playwright/test@^1.61.1, @types/node, @types/react, @types/react-dom

## Architecture Pattern
Next.js App Router with backend logic co-located in API route handlers. Supabase is infrastructure only (Auth + Postgres) — the frontend never calls the Supabase client directly; all access flows through our own `/api/*` routes, which use the Supabase server-side SDK. RLS is a second line of defense, not the sole guard.

## Folder Structure
```
src/app/           — App Router routes (layout.tsx, page.tsx, login/, register/, profile/)
src/app/api/       — API route handlers (auth/register|login|logout|confirm|resend, profile)
src/components/    — shared client components (AuthNav.tsx: infers logged-in state via GET /api/profile)
src/lib/supabase/  — Supabase client factories (server.ts, admin.ts) + proxy helper (middleware.ts)
src/lib/           — auth-client.ts (fetch wrapper), validation.ts, profile-client.ts, resend-cooldown.ts (localStorage helper)
src/lib/points/    — packages.ts (點數方案定價), provider.ts (PaymentProvider adapter 介面 + MockProvider + HMAC 簽章)
src/proxy.ts       — Next.js 16 root proxy (formerly middleware.ts): API auth gate + page route protection + session refresh
supabase/          — CLI project: migrations, config.toml, tests (manual checklists, insomnia collection)
playwright-tests/  — Playwright E2E suite (page-object pattern in playwright-tests/pages/), used as the FRONTEND acceptance gate
playwright.config.ts — Playwright config
public/            — static assets
specs/             — project spec docs (OVERVIEW.md: tech decisions, open questions)
stories/           — ship-mate pipeline story files
.claude/           — Claude Code config, agents, pipeline state
```

## Code Style Conventions
- Path alias `@/*` → `./src/*`
- ESLint via `eslint-config-next` (core-web-vitals + typescript)
- API route handlers return JSON with a `{ "error": "..." }` shape on failure; user-facing messages in Traditional Chinese
- Supabase clients constructed via factory functions in `src/lib/supabase/`, never inline

## Modularity Practices
- Supabase access centralized in `src/lib/supabase/`:
  - `server.ts` — user-context client bound to `cookies()` (RLS applies)
  - `admin.ts` — service_role client (privileged, no cookie binding) — server-only
  - `middleware.ts` — proxy-context client bound to `NextRequest`/`NextResponse` for session refresh
- Route handlers under `src/app/api/` keep validation + response logic inline (no service layer abstracted yet)

## Data Architecture
- Postgres via Supabase. Schema managed by SQL migrations under `supabase/migrations/`.
- `profiles` table: id → auth.users.id, nickname, role (default `user`), created_at, updated_at.
- RLS policies restrict each user to their own row; `updated_at` maintained by DB trigger.
- Profile auto-created on signup via `on_auth_user_created` trigger (SECURITY DEFINER, search_path locked, idempotent).
- 點數系統(migration `20260716080000_create_points.sql`):
  - `point_transactions` — append-only ledger,餘額 = SUM(delta),無可變 balance 欄位。`ref_id` unique 承擔冪等(`signup:{user_id}` / `order:{order_id}`)。RLS select-own;寫入僅 service_role — migration `20260717010000_revoke_points_writes.sql` 明確 revoke anon/authenticated 的 insert/update/delete(Supabase default privileges 原本有給,grant+RLS 雙層防禦)。
  - `point_orders` — 購買訂單,定價於建單時快照(amount_twd/points),status pending/paid/failed,provider mock/ecpay。RLS select-own。
  - `handle_new_user` trigger 擴充:註冊時發 50 點 signup_bonus(on conflict do nothing 冪等);migration 內含既有帳號一次性 backfill。
- Connection via env vars only — never hardcode. Pooled connection string for serverless.

## Cross-Cutting Concerns
- Auth: Supabase Auth, wrapped by our own API routes. Email confirmation enabled (no auto-login on register). Session in httpOnly cookies via `@supabase/ssr`.
- Auth gate: `src/proxy.ts` protects all `/api/*` by default (fail-closed), with an explicit public allowlist (`/api/auth/register|login|confirm|logout|resend`); unauthenticated non-allowlisted requests return 401 JSON. Route handlers also keep their own `getUser()` check (defense in depth).
- Page route protection (also `src/proxy.ts`): unauthenticated visits to protected pages (`/profile`) redirect to `/login`; logged-in visits to auth pages (`/login`, `/register`) redirect home. Redirect targets are fixed constants (no open redirect). `config.matcher` is a static literal array (Next.js analyzes it at build time — variables are silently ignored) kept in sync by comment with the `PROTECTED_PAGES`/`AUTH_PAGES` runtime constants; new protected/auth pages need both updated, new API routes only need the whitelist (the `/api/:path*` matcher already covers them).
- Anti-enumeration: register/login/resend all return identical status codes and generic messages regardless of whether an account exists, is verified, or is rate-limited — status code parity is checked explicitly (not just message text), since a prior bug (task 2) leaked account existence via a differing status code alone.
- Error handling: API routes return explicit 400/401/403/404/500 with generic messages; avoid leaking account existence (anti-enumeration).
- Logging: never log tokens/session/cookies/passwords.

## Service Communication
Next.js API routes (backend logic co-located with frontend). Implemented: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/confirm`, `/api/auth/resend`, `/api/profile` (GET/PATCH), `/api/points/balance` (GET), `/api/points/checkout` (POST), `/api/points/webhook/mock` (POST, public — HMAC 簽章為唯一守門). Protected by `src/proxy.ts`.

### AI 助理 (場地規劃)
- `GET /api/ai/config`(受保護):回 `{ chatCost: AI_CHAT_COST, balance }`,面板展開時抓取;balance 查詢失敗降級 null。扣點值唯一來源(嚴禁 NEXT_PUBLIC_ 重複定義)。
- 面板為右側可收合側欄(flex 並排非 overlay,收合不重置對話 state);PlanEditor ResizeObserver 量測左欄 wrapper(非外層 container),側欄展開時畫布自動縮放。輸入為多行 Textarea(Enter 送出/Shift+Enter 換行/isComposing IME 防護);圖片上傳為按鈕觸發隱藏 file input。
- `POST /api/ai/chat`(受保護):前端帶完整對話歷史,後端注入凍結系統提示(scope guard+plan schema,cache 斷點在 system block)與 5 支 strict tools,先扣 `AI_CHAT_COST` 點(`src/lib/points/ledger.ts` 的 `deductPoints`)後呼叫 Claude(`AI_MODEL` env var,預設 claude-sonnet-5)。上游失敗 502 不退點(usage log 為補償軌跡)。
- `src/lib/ai/`(server-only:client/system/tools)vs `src/lib/ai-panel/`(client 端 action 型別+parseToolUse)— 邊界勿混。
- 前端:`src/components/venue/AiPanel.tsx`(PlanEditor 子元件,`applyActions` props 套用 tool call,latest-ref 防 stale closure)。對話歷史前端 state(API 原生格式),不落 DB(phase 1)。
- Payload 瘦身(`src/lib/ai-panel/messages.ts` `toApiMessages()` 純函式):送出時舊輪(最新 user 訊息以外)移除 `[目前配置]` JSON 附錄(還原 displayText)、image block 換固定佔位符「[使用者先前提供了參考圖]」;assistant 輪與 tool_result 原樣(tool_use_id 不斷鏈)。本地 turns state 不動,僅組 fetch body 時瘦身。
- 系統提示行為規則(6a8d32e):generate_plan 前先摘要需求取得確認(增量修改不設閘門);失敗 tool_result 須說明原因+替代方案;回應去寒暄。
- Playwright:`ai-panel.spec.ts` mock `/api/ai/chat`(page.route fixtures,不花錢),含 payload 攔截斷言(postDataJSON 驗證瘦身形狀);真模型煙霧 `@paid` 預設 skip(`PW_PAID_AI` 開啟),斷言鎖 waitForResponse 200 + ai-assistant-text。

### 場地儲存檔 (Save Slots)
- `venue_plans` 表:每人 3 格(slot 1–3,`check` + `unique(user_id,slot)` DB 硬上限),plan 為 jsonb 整包快照。RLS select-own;寫入僅 service_role(明確 revoke)。
- API:`GET /api/plans`(固定 3 格概況)、`/api/plans/[slot]` GET(含 conversation+planId)/PUT(upsert,name 省略=保留原名)/PATCH(改名)/DELETE、`DELETE /api/plans/[slot]/conversation`(清空對話)。全受保護;admin client 查詢一律帶 user_id 過濾;跨用戶 404 不洩漏。Next.js 16 動態段 `ctx.params` 為 Promise 需 await。
- 對話持久化:`ai_conversations`(plan_id unique FK cascade,1:1)+ `ai_messages`(identity bigint 保序,content 存 API 原生 blocks)。RLS 經 join venue_plans;chat API 增收 planId(所有權 404 先於扣點),回應後增量落庫(圖片換佔位符),落庫失敗僅 log 不影響回應。
- 前端:`PlanSlotsDialog`(三格存/讀/改名/刪,AlertDialog 確認,serialize 比對 dirty);AiPanel `conversationSeed` props 續聊載入(不 key 重掛)、清空對話、100 輪軟上限;`messages.ts` `fromStoredConversation()` 還原 ChatTurn(佔位符保留,防續聊瘦身二次破壞)。

### 金流 (Payments)
- `PaymentProvider` adapter (`src/lib/points/provider.ts`):`createCheckout` 回 redirectUrl、`verifyWebhook` 驗簽。Phase 1 僅 MockProvider(HMAC-SHA256 + timingSafeEqual);之後換綠界只需新增 EcpayProvider,購買/發點流程不動。
- Webhook `/api/points/webhook/mock` 在 proxy.ts PUBLIC_API_PATHS 上;冪等由 `ref_id = order:{order_id}` unique constraint 承擔。
- 安全守門:`getPaymentProvider()` 在 production 且未明確設定 `MOCK_PAYMENT_SECRET` 時直接 throw,防止預設密鑰上線被偽造 webhook 加點。

## Test Coverage
- Overall coverage: manual + Playwright E2E only (no unit/integration test framework or Docker installed).
- Backend testing approach: manual verification via checklists (`supabase/tests/auth_routes_manual.md`) + Insomnia collection (`supabase/tests/insomnia_auth.json`) + SQL verify scripts.
- Frontend testing approach: Playwright (`playwright-tests/`, page-object pattern) is the acceptance gate for FRONTEND tasks — runs against a live dev server + the real cloud Supabase project (test accounts in `.env.playwright.local`, gitignored).
- Key untested areas (automated unit/integration level): all API routes and proxy — covered only by manual checklists; Playwright covers only user-facing browser flows, not isolated unit behavior.
- Frontend: fully implemented (register/login/profile pages, route protection, resend-verification flow with cooldown) — membership-system story complete (9/9 tasks).

## Entry Points
- `src/app/layout.tsx` — root layout
- `src/app/page.tsx` — home page
- `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/profile/page.tsx` — auth/profile pages
- `src/proxy.ts` — root proxy (API auth gate + page route protection + session refresh)
- `next.config.ts` — Next.js config
- `playwright.config.ts` — Playwright E2E config
- `supabase/config.toml` — Supabase CLI config (email confirmations enabled, resend `max_frequency` 60s locally — cloud project's rate limit is set separately in the Supabase Dashboard, not by this file)
- `.env.local` — local env (gitignored) / `.env.example` — env var template
- Vercel deployment: env vars must be set per-environment in the Vercel dashboard (Production/Preview/Development are separate scopes — Development has no deployed domain, it's only for `vercel dev`); changing them requires a manual Redeploy.

## Changed Files (last delta — points system, commit 5c6c7d7)
- supabase/migrations/20260716080000_create_points.sql (new — ledger + orders + trigger + backfill)
- src/lib/points/packages.ts, src/lib/points/provider.ts (new)
- src/app/api/points/balance/route.ts, src/app/api/points/checkout/route.ts, src/app/api/points/webhook/mock/route.ts (new)
- src/app/shop/page.tsx, src/app/shop/mock-checkout/page.tsx (new)
- src/components/Header.tsx (點數餘額顯示)
- src/proxy.ts (webhook 加入 PUBLIC_API_PATHS)
- playwright-tests/points-shop.spec.ts, playwright-tests/pages/ShopPage.ts (new)

## Last Scanned
2026-07-22T21:32:00+08:00(delta:6029fff/b709620/497373b 場地儲存檔 story 全套)
