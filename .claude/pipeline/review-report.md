# Code Review Report — 存檔 UI 三格面板 + AiPanel 續聊/清空對話/軟上限/歷史圖片占位
> Generated: 2026-07-22T18:05:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
實作忠實對應 architect-plan.md D1–D9 與 orchestrator 全部 16 條 AC:新端點、面板、dirty 判定、seed 還原、測試皆到位,慣例(admin `.eq("user_id")`、防列舉 404、testid 命名、isomorphic 邊界)全數遵守。發現 2 個 🟡(續聊 payload 對還原 placeholder 的 slim 誤處理、存檔後補 GET planId 的無聲失敗),已依 pipeline 指示於 review 階段直接修正並補迴歸測試;lint/tsc/相關 Playwright 重跑全綠。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved)

### Issue 1 — 還原歷史輪續聊時 slim 邏輯破壞 placeholder / 產生空 text block
- **File**: `src/lib/ai-panel/messages.ts:41`(`slimOldUserContent`)
- **Issue**: 讀檔還原的 user 輪,其圖片在落庫時已換成 `text === PRIOR_IMAGE_PLACEHOLDER` 的 text block(非 image block)。續聊時 `toApiMessages` 把「每一個」text block 都換成 `displayText`:(a) placeholder 語意遺失且 displayText 重複多份;(b) image-only 歷史輪 `displayText === ""` → 產生空 text block,Anthropic API 拒絕空 text → 模型呼叫失敗;而扣點在模型呼叫之前、phase 1 不退點,使用者白扣點。
- **Impact**: 破壞 orchestrator §6「讀檔後可直接續聊」行為(凡歷史含圖片輪即中獎)。未違反 Clarified AC 明文(AC6 僅要求 chat body 帶 planId),故列 🟡 而非 🔴。
- **Resolution**: `slimOldUserContent` 改為:`text === PRIOR_IMAGE_PLACEHOLDER` 的 block 原樣保留;displayText 僅推一次且空字串不推。fresh 輪行為不變(`ai-panel.spec.ts` 3 條 payload 瘦身測試維持綠)。並在 `plan-slots.spec.ts` AC7 測試補續聊迴歸斷言(placeholder 保留 + 全 payload 無空 text block)。

### Issue 2 — 存檔後補 GET planId 失敗被無聲吞掉
- **File**: `src/components/venue/PlanSlotsDialog.tsx:146`(`performSave`)
- **Issue**: PUT 成功後補 GET 取 planId(D9 契約取捨);GET 非 200 時 `onSaved` 不會呼叫且無任何提示 → `currentPlanId` 維持 null:後續 chat 不落庫、清空鈕不出現、baseline 未重設(之後讀檔誤跳 dirty 確認)。GET 網路 throw 甚至落入外層 catch 誤顯示「存檔失敗」(實際已成功)。
- **Resolution**: 補 GET 改獨立 try/catch;失敗時於面板顯示「存檔成功,但無法取得存檔識別碼,請點『讀取』重新載入此格以啟用對話存檔」,不再誤報存檔失敗。

## 💡 Suggestions (Consider — No Action Required)
- `AiPanel.tsx` 軟上限提示文案硬編「100 輪」而判斷用 `TURN_LIMIT` 常數 — 若未來調常數需同步文案(文案為 spec 指定,接受)。
- `plan-slots.spec.ts` `closeSlotsDialogViaClose` 用 `[data-slot="dialog-close"]`(shadcn 內部實作細節 selector),升版可能脆化;可改 Esc 或 aria label。
- AC11 清空對話測試可補 DELETE 呼叫次數斷言(目前以 turns 清空間接驗證成功路徑)。

## Security Assessment
- Secrets scan: PASS(零硬編 secrets/env 直讀;client 端無 `src/lib/ai/`、`supabase/admin` import;Playwright 全 mock 不含真憑證)
- Input validation: PASS(新端點 slot 嚴格白名單字串比對,與既有 route 逐字一致)
- Auth/authz: PASS(`requireUser()` 401;admin 查詢 `.eq("user_id", userId)`;跨使用者/不存在統一 404「找不到存檔」同字串**同狀態碼**,防列舉慣例維持;新端點受 proxy fail-closed 保護免改 allowlist;error log 僅 code/message,無對話內容)
- 前端一律走 `/api/*`;`src/lib/ai-panel/` 維持 isomorphic;chat body 無 client 可控 `system` 欄位
- Test coverage: 新端點 → 手動清單 `supabase/tests/plans_conversation_manual.md`(401/400/404 跨使用者/200 冪等);前端 → `plan-slots.spec.ts` 14 tests 全綠 + `ai-panel.spec.ts`、`venue-*.spec.ts` 迴歸全綠(24+55 passed, 1 skipped @paid)

## Plan Compliance
- [x] All architect plan steps implemented(Steps 1–11;D1–D9 決策逐項對應)
- [x] Implementation matches plan intent(不用 key remount、序列化 dirty、刪整列 conversation、PUT 後補 GET 皆照 plan)
- [x] No unauthorised scope additions(唯一後端新增即 orchestrator §8 核可的 DELETE conversation 端點;未觸及 src/proxy.ts 與既有 5 支 plans API)

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| Issue 1(slim 破壞還原 placeholder) | 依 pipeline 指示於 review 階段直接修正 | `messages.ts` slim 修正 + AC7 續聊迴歸斷言;plan-slots/ai-panel 全綠 |
| Issue 2(補 GET planId 無聲失敗) | 依 pipeline 指示於 review 階段直接修正 | `PlanSlotsDialog.tsx` 獨立 try/catch + 面板提示;lint/tsc 綠 |
