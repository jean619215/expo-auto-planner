# Code Review Report — ai_conversations/ai_messages migration + /api/ai/chat 對話落庫
> Generated: 2026-07-22T15:40:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
實作與 architect-plan.md 逐步一致(migration 全文一字不差、chat route 順序正確、plans GET 真查詢 additive)。安全關鍵點全部落實:所有權 404 在扣點之前、admin client 查詢必帶 `.eq("user_id")`、migration revoke 含 sequence、RLS select-own join 路徑正確。lint 與 tsc 乾淨。無 Critical、無 Should Fix。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)
無。

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1
- **File**: src/app/api/ai/chat/route.ts:74
- **Issue**: `createSupabaseAdminClient()` 在不帶 `planId` 的路徑也會被建構(未使用)。client 建構為 lazy、無網路呼叫,且 service_role key 本就是該 route 的必要環境(deductPoints 亦依賴),故無行為差異——僅為整潔度,可移入 `planId` 存在時再建構。
- **不列 🟡 理由**: 「零行為變化」AC 實測不受影響(零新增查詢成立);改動須在兩個 `if (planId)` 區塊間傳遞 client,可讀性未必更好。

### Suggestion 2
- **File**: src/app/api/ai/chat/route.ts:236-239
- **Issue**: 最後一則 user 訊息若無 `content` 欄位,`userContent` 為 `null`,insert 會撞 `content jsonb not null` → 落入 log-only 分支。理論上不發生(前端 `toApiMessages` 契約),且 orchestrator 已定案「不擴大防禦」,失敗路徑安全(response 不受影響)。僅供未來除錯時知悉此 log 來源之一。

## Security Assessment
- Secrets scan: PASS(無硬編 key/connection string;migration 無憑證;測試文件引用 `.env.playwright.local`)
- Input validation: PASS(`planId` UUID 白名單 regex 於邊界驗證後才進 DB;body 5MB 上限沿用;client `system` 欄位持續被忽略)
- Auth/authz: PASS(proxy fail-closed 未動;`getUser()` 401;所有權驗證 `.eq("user_id", userId)` 於扣點前;404 訊息與 plans route `NOT_FOUND_ERROR` 字面一致「找不到存檔」,不存在/非本人同狀態碼同訊息不可區分,無存在性洩漏;GET 對話查詢以已過濾的 `data.id` 錨定)
- Sensitive data in logs: PASS(落庫失敗 log 僅 planId/refId/error message,無對話內容;查詢失敗 log 僅 code/message)
- CORS/CSP: 未觸及
- SQL injection: N/A(supabase-js query builder,參數化)
- Test coverage: 手動 checklist(`ai_chat_manual.md` planId 落庫段落、`venue_plans_api_manual.md` conversation/planId 斷言)+ `ai_conversations_verify.sql` 17 節完整覆蓋新邏輯(專案無 JS 測試框架,BACKEND 慣例)

## Migration 核對(已 push 上雲,重點複核)
- [x] `plan_id uuid not null unique` FK → `venue_plans(id) on delete cascade`
- [x] `ai_messages.id bigint generated always as identity` PK;`(conversation_id, id)` 複合索引
- [x] 兩表 RLS enabled;select-own policy 經 join 回 `venue_plans.user_id = (select auth.uid())`(兩表皆不存 user_id,與 orchestrator Security Notes 一致)
- [x] `revoke insert, update, delete from anon, authenticated` 兩表 + `revoke usage, select, update on sequence ai_messages_id_seq`(防前端偽造 assistant 訊息的技術屏障落實)
- [x] `updated_at` trigger 重用 `public.set_updated_at()`
- [x] 與 architect-plan.md「Migration SQL 全文」逐字一致

## Chat Route 順序核對(AC 關鍵)
auth 401 → body 大小/JSON 400 → messages 驗證 400 → **planId 格式 400** → **所有權 404(admin + `.eq("user_id")`,在 deductPoints 之前 — 404/400 情境零扣點、零 ledger 列)** → 扣點 → 模型 → usage log → **落庫(整段 try/catch,catch 僅 console.error,response 不受影響)** → safeBalance → 200。
不帶 planId:零新增 DB 查詢,response 形狀不變(零行為變化)。

## 落庫形狀核對
- upsert `onConflict: "plan_id", ignoreDuplicates: false` → DO UPDATE 回傳既有列,race 消解(決策 3)
- image block 逐一換 `PRIOR_IMAGE_PLACEHOLDER` text block(不合併);text/tool_result/未知型別原樣;非陣列 content 原樣
- import 方向合法:server route import `@/lib/ai-panel/messages`(純 isomorphic,僅 `import type Anthropic`,無 server-only、無瀏覽器 API、無反向依賴);檔頭防退化註解已補
- 單一 insert 兩列(user 先於 assistant,identity 保序);assistant content 原樣

## Plans GET 核對
- select 補 `id`;conversation 真查詢:`ai_conversations` by `plan_id` maybeSingle → 無列回 `[]`(200,合法狀態);有列 → `ai_messages` select `role, content` order by `id` 升冪(`{role, content}` 形狀,不帶 bigint id,無精度問題)
- `planId` 欄位 additive(architect Architecture Notes 第 1 點刻意補洞,review 認可:task 3 前端需要 planId 才能觸達落庫功能;chat 端每次重驗所有權,曝露 uuid 無風險)
- PUT/PATCH/DELETE 未動;`src/proxy.ts`、`src/lib/ai/`、既有 migrations 皆未觸及

## Plan Compliance
- [x] All architect plan steps implemented(steps 1–9 全數對應)
- [x] Implementation matches plan intent
- [x] No unauthorised scope additions(唯一超出 orchestrator 明文者為 GET `planId` 欄位,architect 已標記並說理)

## 靜態驗證
- `npm run lint`:PASS
- `npx tsc --noEmit`:PASS

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| (無 🟡/🔴,無往返) | — | — |
