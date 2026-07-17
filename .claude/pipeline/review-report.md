# Code Review Report — 場地規劃 AI 助理 / Task 1 [BACKEND] 點數 ledger 支援 AI 扣點
> Generated: 2026-07-17T16:05:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
實作乾淨、範圍克制,完全對齊 architect plan 三步驟:migration 只放寬一條 check constraint(實名已探測確認)、helper 是薄資料層(admin factory + 明確錯誤分支)、checklist 補齊。錯誤處理三分支(insufficient_balance / 23505 duplicate / 其他 throw)與 AC2 逐條吻合;併發透支取捨在檔頭註解與 checklist 誠實記錄,符合 AC 明訂的 phase 1 接受範圍。無 🔴;1 個 🟡(server-only 邊界只靠註解,而 `src/lib/points/` 已是 client/server 混用目錄)、3 個 💡。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — ledger.ts 的 server-only 邊界只有註解,無機械防線
- **File**: `src/lib/points/ledger.ts:1`
- **Issue**: 檔頭註解警告「絕不可被 client component import」,但 `src/lib/points/` 目錄已有 client 端消費者(`src/app/shop/page.tsx` import `@/lib/points/packages`)。同目錄混放 client-safe 與 service_role 模組,靠註解防呆的失效機率比 `src/lib/supabase/admin.ts`(整目錄皆 server 語意)高。誤 import 不會洩漏 key(`SUPABASE_SERVICE_ROLE_KEY` 非 `NEXT_PUBLIC_` 前綴,不會被 inline 進 client bundle),但會變成執行期才爆的 undefined-key client,錯誤訊息離根因很遠。
- **Suggested fix**: 加機械防線,擇一:(a) `npm i server-only` 後在 `ledger.ts`(理想上 `admin.ts` 也一併)檔頭 `import "server-only"` — Next 官方模式,client bundle 引用直接 build fail;此為 breaking-changes 版 Next,實作前先確認 `node_modules/next/dist/docs/` 中 server-only 慣例仍相同。(b) 不加依賴,module top-level `if (typeof window !== "undefined") throw new Error("ledger.ts is server-only")`。任一種都把「註解約定」升級成「編譯/載入期失敗」。

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1 — migration drop constraint 可加 `if exists`
- **File**: `supabase/migrations/20260717070000_allow_ai_usage_reason.sql:6`
- 實名已對雲端探測確認,且 Postgres 對 inline column check 的自動命名(`point_transactions_reason_check`)在全新環境依序重放 migrations 時也是決定性的,目前寫法可接受。`drop constraint if exists` 只是讓任何曾手動改過 constraint 的環境重放時不硬炸。migration 已推雲端,不值得為此重寫;記錄供未來 migration 參考。

### Suggestion 2 — `refId` 未驗非空字串
- **File**: `src/lib/points/ledger.ts:48`
- `ref_id text unique` 允許 NULL(TS 型別已擋 undefined),但空字串 `""` 會佔用 unique 鍵位。呼叫端(task 2)照 `ai:{request_id}` 慣例不會發生;若想與 amount 同等防呆,可加 `if (!refId) throw`。

### Suggestion 3 — getBalance 全取 rows 在 JS 加總
- **File**: `src/lib/points/ledger.ts:34`
- 與 balance route 同語意(刻意一致,plan 明訂不硬抽象),目前規模無虞。未來量大時兩處一起改 DB 端聚合(rpc/view);balance route 已有相同的未來改進註記。

## Security Assessment
- Secrets scan: PASS(無硬編 key/token;admin client 走 `src/lib/supabase/admin.ts` factory,env 取值)
- Input validation: PASS(amount 正整數驗證失敗即 throw;reason 由 TS union `"ai_usage"` 收斂,DB check constraint 為第二道防線)
- Auth/authz: N/A(helper 明文聲明身分驗證屬呼叫端 route 責任;`src/proxy.ts` fail-closed 預設保護新 API route,task 2 落地時再驗)
- Sensitive logging: PASS(error 訊息只含 Postgres error code/message,無 token/cookie/密碼)
- 點數 guardrails: PASS — append-only 尊重(helper 只 insert,無 update/delete);寫入走 service_role(authenticated 本就無 insert grant);冪等由 ref_id unique 承擔,與 signup trigger / purchase webhook 同一機制。職責劃分清楚:webhook 發點自管 insert、helper 只管扣點,`DeductReason` 收斂為 `"ai_usage"` 防止誤用於發放路徑
- CORS/CSP: 未觸碰
- 敏感度判定:觸及點數 ledger 但非 auth-adjacent(無 trigger/RLS/grant/session 變更),依 AGENTS.md 不觸發自動 🔴
- Test coverage: 手動驗證 10/10 PASS + checklist 8 項;tsc/lint 乾淨(review 階段重跑確認);Playwright 80/80 無迴歸(本專案無 JS unit test framework,手動 checklist 即 BACKEND 驗收形式,覆蓋充分)

## Plan Compliance
- [x] All architect plan steps implemented(migration / helper / 驗證+checklist)
- [x] Implementation matches plan intent(含「不硬抽象 balance route」的明確不作為)
- [x] No unauthorised scope additions(無 AI route、無前端、無退點機制)

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| 🟡 Issue 1(server-only 機械防線) | 待 developer 處理(不阻擋進 QA;可併入 task 2 developer 觸點) | pending |
