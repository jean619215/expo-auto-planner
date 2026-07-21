# Code Review Report — venue_plans migration + 儲存檔 API 五支
> Generated: 2026-07-22T05:10:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
實作與 architect-plan.md 逐 step 一致(migration SQL 除時間戳外逐字對齊 Step 1 全文,計畫明文允許時間戳調整)。五支 route 的安全關鍵點——admin client 逐 query `user_id` 過濾、slot 白名單、404 不洩漏存在性——全數落實,`next typegen` + `npm run lint` + `tsc --noEmit` 皆乾淨。無 Critical、無 Should Fix。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)
無。

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1
- **File**: `src/app/api/plans/[slot]/route.ts:167-170`
- **Issue**: PATCH 收到非合法 JSON body 時回 400 `名稱不可為空`(EMPTY_NAME_ERROR),語意上是「body 壞掉」而非「名稱空白」。
- **Note**: spec 只要求 400,訊息未指定,行為正確;若未來想區分可另加訊息。不需行動。

### Suggestion 2
- **File**: `src/app/api/plans/[slot]/route.ts:67`
- **Issue**: `readJsonBody` 回傳型別 `Promise<unknown | null>` 中 `unknown | null` 塌縮為 `unknown`,null 標註僅為文件性質。無實際影響。

## Security Assessment
- Secrets scan: PASS(零硬編碼 secret;admin/server client 皆走 `src/lib/supabase/` factory)
- Input validation: PASS(slot 嚴格字串白名單不經 `Number()`;plan 形狀檢查含 `Number.isFinite`;name trim;body JSON try/catch — 全在 DB 之前)
- Auth/authz: PASS(proxy fail-closed + 五支 route 內 `getUser()` 雙重;`service_role` 僅 server route import)
- **admin client user_id 過濾(本 task 最關鍵)**: PASS — 逐 query 核對 5/5:
  1. `GET /api/plans` list → `.eq("user_id", userId)`(route.ts:21)
  2. `GET /api/plans/[slot]` → `.eq("user_id", userId)`([slot]/route.ts:90)
  3. `PUT` upsert → `user_id: userId` 在 payload + `onConflict: "user_id,slot"`(:134-144,寫入僅能落在本人列)
  4. `PATCH` update → `.eq("user_id", userId)`(:178)
  5. `DELETE` → `.eq("user_id", userId)`(:211)
- 404 不區分「沒存過」vs「他人的」: PASS(GET/PATCH/DELETE 一律 `找不到存檔`)
- Migration 雙層防禦: PASS(RLS select-own with `(select auth.uid())` + 明確 `revoke insert, update, delete from anon, authenticated`;重用既有 `set_updated_at()`,無 security definer,trigger 僅改 NEW record)
- 錯誤 log: PASS(僅 `error.code`/`error.message`,無 token/cookie/session)
- CORS/CSP: 未觸及。`src/proxy.ts` 零修改(`/api/:path*` matcher 已涵蓋新路由,fail-closed)
- Test coverage: 無 JS 測試框架(AGENTS.md 規範)— 手動 checklist 15 條 AC 全覆蓋 + SQL 驗證腳本 13 節(含 grant/RLS/cascade);401/400 不碰 DB 路徑已於 pipeline 內實測,其餘標記待 migration push 後驗(QA 階段)

## Plan Compliance
- [x] All architect plan steps implemented(Step 1–10 逐項核對)
- [x] Implementation matches plan intent(PUT name 保留採 upsert payload 欄位省略語意,程式碼註解已記錄此 PostgREST 依賴;`conversation: []` 佔位與 DELETE 不清對話均有 task 2 接手註解;`MIN_FLOOR_VERTICES` 自 `@/lib/venue/plan` import,經查該 module 無 React/`use client`,server 安全;`ctx.params` 正確 await + `RouteContext` 型別)
- [x] No unauthorised scope additions(git status 僅 5 個計畫內新檔 + story 檔 + pipeline 狀態檔;零觸及 `src/proxy.ts`、`src/lib/ai/`、既有 migrations)
- 備註:migration 檔名時間戳 `20260722030000`(計畫寫 `020000`)— 計畫明文「僅時間戳依實際建檔時間調整」,合規;測試資產內引用一致。

## Conversation Log
無(零 Should Fix,無需 developer 往返)。
