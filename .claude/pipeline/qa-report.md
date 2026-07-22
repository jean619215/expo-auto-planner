# QA Report — 存檔 UI 三格面板 + AiPanel 續聊/清空對話/軟上限/歷史圖片占位
> Generated: 2026-07-22T00:55:00Z | QA iteration: 1

## Summary
- Tests executed: 24 (Playwright automated) + 10 (real E2E flow steps) + code review of new endpoint/messages.ts
- Passed: 34
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — 全部 16 條驗收條件（AC1–AC16）通過，無 Critical/High/Medium bug。

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| AC1 開面板固定 3 列，占用/空格顯示正確 | ✅ PASS | `plan-slots.spec.ts:152` 綠 |
| AC2 空格存入直接 PUT，payload 含 venueSizeM+4 欄位 | ✅ PASS | `plan-slots.spec.ts:176` 綠；真流程 PUT slot 3 亦驗證 venueSizeM=12 正確落地並讀回 |
| AC3 占用格存入先跳覆蓋確認，取消不送出 | ✅ PASS | `plan-slots.spec.ts:223` 綠 |
| AC4 dirty 讀檔先跳確認，取消不發 GET | ✅ PASS | `plan-slots.spec.ts:276` 綠 |
| AC5 not-dirty 讀檔直接讀，不跳彈窗 | ✅ PASS | `plan-slots.spec.ts:319` 綠 |
| AC6 讀檔套用 polygon/walls/columns/furniture/venueSizeM，對話取代，之後 chat 帶 planId | ✅ PASS | `plan-slots.spec.ts:356` 綠；真流程：讀檔回傳 planId、chat 帶 planId 200、對話正確落庫 2 列（user+assistant） |
| AC7 歷史圖片訊息顯示「📷 參考圖」占位，不顯示原始 placeholder 字串 | ✅ PASS | `plan-slots.spec.ts:466` 綠（含續聊 payload 迴歸，placeholder 原樣保留不產生空 text block） |
| AC8 歷史 user 回合還原可讀 displayText，不含 `[目前配置]` JSON 附錄 | ✅ PASS | 同上（`plan-slots.spec.ts:466`），`extractDisplayText` 邏輯核對正確 |
| AC9 改名：空字串不送出，合法名稱 PATCH 後更新 | ✅ PASS | `plan-slots.spec.ts:547` 綠 |
| AC10 刪除：確認彈窗文案含對話一併刪除；刪除 currentSlot 後畫面/turns 不變、chat 不帶 planId | ✅ PASS | `plan-slots.spec.ts:588` 綠 |
| AC11 已讀檔可清空對話，場地配置不受影響 | ✅ PASS | `plan-slots.spec.ts:659` 綠；真流程 DELETE conversation 200 → 重讀 conversation.length=0 |
| AC12 未讀檔（currentPlanId=null）不顯示清空對話按鈕 | ✅ PASS | `plan-slots.spec.ts:659` 同案例覆蓋 |
| AC13 100 輪達軟上限顯示提示，不阻擋送出 | ✅ PASS | `plan-slots.spec.ts:713` 綠 |
| AC14 未登入呼叫任一存檔 API（含新 DELETE .../conversation）回 401 | ✅ PASS | 真流程：清 cookie 後 `GET /api/plans`→401、`DELETE /api/plans/3/conversation`→401 |
| AC15 跨使用者/不存在資源回 404，不洩漏存在性 | ✅ PASS | 真流程：plan 刪除後再 `GET /api/plans/3`→404、再次 `DELETE .../conversation`→404（同字串「找不到存檔」、同狀態碼），程式碼核對 `.eq("user_id", userId)` 全端點一致 |
| AC16 既有 AiPanel mock 套件與全套 Playwright 迴歸通過，無退化 | ✅ PASS | `ai-panel.spec.ts` 10 passed / 1 skipped(@paid，本次改用真模型 E2E 覆蓋)；review 階段已跑過 venue-*.spec.ts 55/55，本次未重跑（未改動相關檔案） |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| 空 conversation 讀檔（格有存檔但從未聊天） | ✅ PASS | 真流程：PUT 後立刻 GET，conversation.length=0，前端有既有空狀態（程式碼核對 seed turns=[] 走既有渲染分支） |
| 連續快速點擊存入/讀取的重複送出防護 | ✅ PASS | 程式碼核對：PlanSlotsDialog mutation 呼叫期間 disable 對應按鈕；Playwright 案例間接覆蓋 loading 狀態 |
| 刪除讀檔中的格後再存回同格 = 新 planId 新存檔 | ✅ PASS（設計行為） | 程式碼核對 upsert 邏輯符合預期，非 bug，orchestrator 已明列 |
| PRIOR_IMAGE_PLACEHOLDER 精確全等比對，避免使用者打出同字串誤判 | ✅ PASS | `messages.ts` `countPriorImagePlaceholders`/`extractDisplayText` 皆 import 同一常數比對，非各自複製字串 |
| 缺 venueSizeM 舊測試資料 fallback 不崩潰 | ✅ PASS | `plan-slots.spec.ts:427` 綠 |
| 續聊時歷史圖片輪 slim 邏輯（review Issue 1 修正驗證） | ✅ PASS | `plan-slots.spec.ts:466` 含續聊迴歸斷言；程式碼核對 `slimOldUserContent` 已正確保留 placeholder block、不產生空 text block |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| `GET /api/plans` 失敗顯示錯誤+可重試 | ✅ PASS | `plan-slots.spec.ts:763` 綠 |
| `PUT/PATCH/DELETE /api/plans/[slot]` 失敗，彈窗內顯示錯誤不關閉 | ✅ PASS | 程式碼核對 D9 錯誤處理邏輯；面板/彈窗錯誤路徑於 spec 覆蓋存入/改名/刪除案例 |
| `GET /api/plans/[slot]` 讀檔失敗，不清空/不覆蓋現有狀態 | ✅ PASS | `plan-slots.spec.ts:774` 綠 |
| `DELETE /api/plans/[slot]/conversation` 失敗，turns 保持原狀（不 optimistic） | ✅ PASS | 程式碼核對 AiPanel 清空邏輯：僅 200 才 `setTurns([])`，非 200 走既有 ChatError 呈現 |
| 401 呈現既有 `error.kind==="auth"` 慣例 | ✅ PASS | 真流程驗證新端點 401 行為與既有端點一致 |
| 404 統一「找不到存檔」文案，不區分不存在/非本人 | ✅ PASS | 真流程驗證：狀態碼與訊息字串在「已刪除」情境下與既有端點一致 |

## Regression Check
| Feature | Result |
|---|---|
| AiPanel 既有對話流程（AC1-4：面板開關、送訊息、圖片上傳、tool call、402/500 錯誤） | ✅ PASS（`ai-panel.spec.ts` 10/10） |
| AiPanel payload 瘦身（多輪/純圖片舊輪/首輪） | ✅ PASS（`ai-panel.spec.ts` 3/3，含本次修正的迴歸覆蓋） |
| 既有 5 支 `/api/plans` 端點（GET list / GET slot / PUT / PATCH / DELETE） | ✅ PASS | 真流程逐一呼叫，行為與程式碼比對 review-report 一致，無改動既有 handler 本體 |
| `venue-*.spec.ts`（場地編輯器核心流程） | ✅ PASS（承接 review 階段 55/55，本次未改動相關檔案，未重跑符合任務指示） |

## Security Test
- Sensitive data exposure: PASS — 錯誤 log 僅 code/message，無 token/session/對話內容；回應 body 未見多餘欄位
- Input validation: PASS — 新端點 slot 嚴格白名單字串比對（"1"/"2"/"3"），與既有 route 邏輯一致
- Auth boundary: PASS — 真流程驗證：未登入呼叫 `GET /api/plans` 與 `DELETE /api/plans/[slot]/conversation` 均回 401；不存在資源回 404 且訊息/狀態碼與既有端點一致（防列舉慣例維持）；程式碼核對所有新/既有端點的 admin client 查詢均帶 `.eq("user_id", userId)`

## Bugs Found
無。

## Test Coverage
- New code coverage: `plan-slots.spec.ts` 14 個案例覆蓋 AC1–13 + Error States；新端點 `DELETE /api/plans/[slot]/conversation` 另有真實 E2E（非 mock）驗證 200/404/401 三種狀態碼路徑，補足 Playwright mock 架構驗不到的真後端行為（AC14/15 手動清單 `supabase/tests/plans_conversation_manual.md` 亦已涵蓋 401/400/404/200 冪等，本次額外用真流程交叉驗證一致）
- Minimum required（AGENTS.md）: 前端 = Playwright 驗收；後端新端點 = 手動清單/checklist
- Status: PASS

## Test Execution Detail

### Playwright（mock，`page.route()`）
- `plan-slots.spec.ts`：14 passed
- `ai-panel.spec.ts`：10 passed / 1 skipped（`@paid` 真模型煙霧測試，本次改以下方真流程涵蓋更完整場景）

### 真流程 E2E（真 DB + 真 Anthropic 模型，1 次模型呼叫，符合 ≤2 次上限）
使用測試帳號（`.env.playwright.local` 之 `PW_VERIFIED_EMAIL`，未 source 該檔案，改以程式讀取環境變數，值未曾輸出於任何日誌）：
1. 登入確認 200
2. `GET /api/plans` 確認 slot 1–3 皆為空（存檔前已無殘留測試資料，安全存入 slot 3）
3. `PUT /api/plans/3` 存入含 `venueSizeM: 12` 快照 → 200
4. `GET /api/plans/3` 讀回，`venueSizeM` 正確為 12，`conversation` 為空陣列（新存檔尚無對話）
5. `POST /api/ai/chat` 帶 `planId`，一句簡短問候 → 200，回傳 `content/stopReason/usage/balance`
6. `GET /api/plans/3` 重讀，`conversation.length === 2`（user+assistant 落庫，符合「每輪寫 2 列」慣例）→ 驗證對話落庫與重讀還原成立
7. `DELETE /api/plans/3/conversation` → 200 `{slot:3, cleared:true}`；重讀 `conversation.length === 0`
8. `DELETE /api/plans/3` → 200 `{slot:3, deleted:true}`（cascade 清理測試資料）
9. 刪除後 `GET /api/plans/3` → 404；`DELETE /api/plans/3/conversation` → 404 `{error:"找不到存檔"}`（同既有端點防列舉字串/狀態碼慣例）
10. 清空 cookie 後 `GET /api/plans` → 401；`DELETE /api/plans/3/conversation` → 401
11. 收尾確認：`GET /api/plans` 顯示 slot 1–3 全部恢復為空，未殘留任何測試資料，未觸碰其他既有非測試資料

## Notes
- 依任務指示，本次僅重跑 `plan-slots.spec.ts` + `ai-panel.spec.ts`，未重跑 `venue-*.spec.ts` 全套（review 階段剛跑過 55/55 全綠，且本輪 QA 未發現任何需要改動相關檔案的理由）。
- 全程未執行 `source .env*`；憑證透過 Node `fs.readFileSync` 讀取後僅用於記憶體內 fetch 呼叫，未輸出於任何指令列或本報告。
- 未修改任何既有非測試 DB 資料；測試資料使用前已確認 slot 1–3 皆空，測試後已透過既有 API（cascade）完整清除。

## Playwright E2E Results
> Executed: 2026-07-22T09:00 (+08:00)

Target run (`plan-slots ai-panel`): 24 passed, 1 skipped (@paid) — all green.
Full regression (`npx playwright test`): 104 passed, 1 skipped (@paid), 0 failed.

| Suite | Result |
|---|---|
| ai-panel.spec.ts | ✅ PASS (9/9 non-@paid; 1 @paid skipped) |
| plan-slots.spec.ts | ✅ PASS (14/14) |
| membership-task7-task9.spec.ts | ✅ PASS (9/9) |
| points-shop.spec.ts | ✅ PASS (10/10) |
| profile-edit-mode.spec.ts | ✅ PASS (2/2) |
| site-header.spec.ts | ✅ PASS (4/4) |
| venue-3d-scene.spec.ts | ✅ PASS (13/13) |
| venue-dimensions.spec.ts | ✅ PASS (16/16) |
| venue-objects.spec.ts | ✅ PASS (17/17) |
| venue-plan-editor.spec.ts | ✅ PASS (9/9) |

### Failures
None.
