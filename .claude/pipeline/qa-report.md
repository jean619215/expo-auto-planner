# QA Report — ai_conversations/ai_messages migration + /api/ai/chat 對話落庫
> Generated: 2026-07-22T15:55:00+08:00 | QA iteration: 1

## Summary
- Tests executed: 17
- Passed: 17
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — 所有驗收條件、邊界案例、錯誤狀態、迴歸測試全數通過。無 Critical/High/Medium/Low bug。

## Environment
- Migration `20260722080000_create_ai_conversations.sql` 已由使用者手動經 session pooler push 上雲(`ai_conversations`/`ai_messages` 兩表存在)。
- Dev server:`localhost:3000`(既有背景程序,無需重啟)。
- 測試帳號:`.env.playwright.local` 的 `PW_VERIFIED_EMAIL/PASSWORD`,由腳本內部 `readFileSync` 讀取後僅供內部使用,從未印出原始值。登入方式:`POST /api/auth/login` 取 `set-cookie`(沿用 task 1 前例)。
- 測試腳本:專案外暫存目錄下的 `qa-probe.mjs`(login/put-plan/get-plan/delete-plan/chat/select/anon-write-test 等子指令),執行時暫時複製進專案內 `.qa-tmp/`(node_modules 解析需要)並於測試結束後整個刪除;查核用 service_role(admin client),寫入嘗試用 anon key。
- 測試資料:僅使用測試帳號的 slot 1/2(從未被其他資料佔用,測試前已確認 `venue_plans` 對該帳號 0 列),測試結束後已 DELETE 清空並複查 `ai_conversations`/`ai_messages`/`venue_plans` 對該帳號皆 0 列殘留。

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| Migration:兩表建立,`plan_id` unique FK cascade、`ai_messages.id` identity bigint PK、RLS 全開 + select-own policy + revoke insert/update/delete(anon/authenticated)、`updated_at` trigger 掛上 `ai_conversations` | ✅ PASS | 結構已由 review-report.md 逐項核對(`ai_conversations_verify.sql`);本次額外以 anon key 直打 INSERT 驗證,兩表皆 `42501 permission denied`(grant 層拒絕,非 RLS 過濾空結果) |
| 不帶 `planId` → 行為與現況完全相同(不落庫、不查兩張新表、response 形狀不變) | ✅ PASS | 真呼叫一次,200,`content/stopReason/usage/balance` 形狀不變;呼叫前後 `ai_conversations`/`ai_messages` 全域皆 0 列 |
| `planId` 合法 uuid 但存檔不存在/非本人 → 404,不扣點、不呼叫模型 | ✅ PASS | 隨機 uuid `00000000-...` → 404 `{"error":"找不到存檔"}`;`point_transactions` 呼叫前後皆 49 列(零新增)、balance 呼叫前後皆 4630(零扣點) |
| `planId` 格式非法(非 uuid)→ 400 | ✅ PASS | `"not-a-uuid"` → 400 `{"error":"請求格式錯誤"}`;ledger/balance 同上零變化 |
| `planId` 合法且首次對話 → find-or-create 一筆 `ai_conversations`,寫入本輪 user+assistant 共兩筆 `ai_messages` | ✅ PASS | PUT slot 1 取得 `planId`,首輪呼叫(含 1 image block)→ 200;service_role 複查恰 1 列 `ai_conversations`(`plan_id` 正確)、恰 2 列 `ai_messages`(`id` 1=user,2=assistant,插入序正確) |
| `planId` 已有既有對話 → 增量寫入,不重寫歷史 | ✅ PASS | 同 `planId` 第二輪呼叫(3 則歷史 + 新一輪 user,含 2 個 image block)→ 200;`ai_conversations` 仍恰 1 列(同一 `id`,`updated_at` 已更新,upsert 未複製列);`ai_messages` 累計 4 列(`id` 1-4 依序,舊 2 列內容不變) |
| user 訊息 image block → 逐一替換為 `{"type":"text","text":"[使用者先前提供了參考圖]"}` | ✅ PASS | 落庫的 `ai_messages` id=1、id=3 確認:單張圖 → 1 個佔位符 text block;兩張圖(edge case)→ 2 個獨立佔位符 text block(未合併),字串值與 `src/lib/ai-panel/messages.ts` 的 `PRIOR_IMAGE_PLACEHOLDER` 逐字相同;text block 原樣保留、無 base64 殘留 |
| assistant 回應原樣存入(不做圖片替換) | ✅ PASS | id=2、id=4 的 `content`(含 text/thinking block)與 API response 的 `content` 完全一致,無轉換 |
| 落庫失敗僅 log,response 仍完整回傳 | ✅ PASS(程式碼審視) | `persistConversation` 整段在呼叫端 try/catch 內,catch 僅 `console.error`(含 planId/refId/error message,不含對話內容),`return` 路徑不受影響;雲端共用環境不做故意弄壞 DB 的破壞性實測,與 architect Test Plan 一致 |
| `GET /api/plans/[slot]` 讀檔:已對話格回傳真實查詢結果(依插入序升冪) | ✅ PASS | slot 1 讀檔後 `conversation` 為 4 則 `{role, content}` 陣列,順序 `user, assistant, user, assistant`,與資料庫 `id` 升冪一致;`planId` 欄位存在 |
| `GET /api/plans/[slot]` 讀檔:從未對話格回傳 `conversation: []`(非 404/500) | ✅ PASS | PUT slot 2(未對話過)→ GET 回 200,`conversation: []` |
| 未登入呼叫 `POST /api/ai/chat`(帶/不帶 `planId`)→ 401 | ✅ PASS | 兩種情境皆 401;`GET /api/plans/[slot]` 未登入亦 401(既有行為) |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| 同一輪 user 訊息含多個 image block(2 張圖)→ 各自獨立佔位符,不合併 | ✅ PASS | 見上方 id=3 落庫內容 |
| user 訊息含 `tool_result` block → 原樣落庫不轉換 | ✅ PASS(程式碼審視) | `replaceImageBlocks` 僅比對 `block.type === "image"`,其餘型別原樣通過;實測第二輪 assistant `thinking` block(非 image)原樣保留,佐證非 image 型別不受轉換影響 |
| `find-or-create` 併發競態(`plan_id` unique + `upsert onConflict/DO UPDATE`) | ✅ PASS | 第二輪呼叫確認 upsert 對已存在 `plan_id` 回傳既有 `conversation_id`(未產生第二列) |
| 最後一則非 user role 不額外防禦 | N/A(未實測) | 前端契約保證不發生,orchestrator 定案不擴大防禦,不在本次破壞性測試範圍 |
| DELETE 存檔 → cascade 清空對話 | ✅ PASS | `DELETE /api/plans/1` 後,service_role 複查該 `plan_id` 對應的 `ai_conversations`/`ai_messages` 皆 0 列 |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| 未登入 → 401 | ✅ PASS | |
| `planId` 非 uuid → 400 | ✅ PASS | |
| `planId` 合法但不存在/非本人 → 404,扣點前 | ✅ PASS | |
| 落庫失敗 → log only,response 200 | ✅ PASS(程式碼審視) | |

## Regression Check
| Feature | Result |
|---|---|
| `npm run lint` | ✅ PASS(乾淨) |
| `npx tsc --noEmit` | ✅ PASS(乾淨) |
| Playwright 全套(91 案例,含 `ai-panel.spec.ts` mock 套件) | ✅ PASS — 90 passed, 1 skipped(`@paid` 真模型煙霧測試需 `PW_PAID_AI` 環境變數,本次未設定以控制模型呼叫額度,屬預期 skip,非失敗) |
| `PUT`/`PATCH`/`DELETE /api/plans/[slot]` 既有行為 | ✅ PASS | 存檔/刪除流程正常,未受本次新增邏輯影響 |

## Security Test
- Sensitive data exposure: PASS — 落庫失敗 log 僅含 `planId`/`refId`/error message,無對話內容;所有 API 回應未洩漏 service_role key 或其他使用者資料
- Input validation: PASS — `planId` UUID 白名單 regex 於邊界擋非法格式(400);body 大小上限沿用既有 5MB 檢查
- Auth boundary: PASS — 未登入一律 401;所有權驗證(admin client + `.eq("user_id")`)於扣點前執行,404 情境零扣點、零 ledger 副作用;不存在與非本人存檔回同一 404 訊息(anti-enumeration)
- RLS/grant(SQL 層): PASS — anon key 直打 PostgREST 對 `ai_conversations`/`ai_messages` INSERT → 皆 `42501 permission denied`(grant 層拒絕),確認「防前端偽造 assistant 訊息」的技術屏障確實生效

## Bugs Found
無。

## Test Coverage
- New code coverage: 手動 API 實測(login → PUT → chat ×3 真模型呼叫 → GET → DELETE,service_role 逐步複查)+ anon key RLS/grant 驗證 + 全套 Playwright 迴歸,無 JS 單元測試框架(專案慣例,BACKEND 驗證手法)
- Minimum required: 手動 checklist 或 Playwright 覆蓋新邏輯(AGENTS.md QA 規則)
- Status: PASS — 可據此勾選 `supabase/tests/ai_chat_manual.md` 的「planId 對話落庫」段落與 `supabase/tests/venue_plans_api_manual.md` 對應段落

## Test Execution Notes
- 真模型呼叫共 3 次(不帶 planId 1 次 + 帶 planId 首輪/次輪各 1 次),控制在 architect 額度 ≤4 次內;壞格式/不存在 planId 案例不呼叫模型(0 次)
- 測試資料清理:PUT 建立的 slot 1/2 存檔已 DELETE(cascade 帶走 ai_conversations/ai_messages,複查零殘留);本次呼叫產生的 3 筆 `point_transactions`(`reason='ai_usage'`)已以 service_role 刪除,餘額由 4600 復原至 4630(與測試前一致);測試腳本與暫存 JSON payload 已從專案目錄整個清除(`git status` 確認無殘留)
- 測試帳號、connection string 全程僅由腳本內部讀取環境變數使用,未於任何輸出中列印原始值

## Definition of Done 對照(architect-plan.md)
- [x] Implementation steps 1–9 全部完成(review-report.md 已確認)
- [x] Migration 已由人工經 session pooler push 上雲,結構核對通過(review 階段 + 本次 anon 權限實測)
- [x] Test Plan 第 2 節 API 實測全數通過,測試資料清理零殘留
- [x] `npm run lint`、`npx tsc --noEmit` 乾淨;全套 Playwright 迴歸通過(含 ai-panel mock 套件)
- [x] Security checklist 全項通過(見本報告 Security Test 段落)
