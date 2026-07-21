# Code Review Report — 送出 payload 瘦身
> Generated: 2026-07-22T01:35:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
`src/lib/ai-panel/messages.ts` 的 `toApiMessages()` 純函式實作完全符合 architect plan 與 orchestrator 規格:僅瘦身舊輪(以陣列位置判定)、assistant 與最新 user 輪原樣、tool_result 原參照保留(tool_use_id 鏈不斷)、image 換固定 placeholder、text 以既有 `displayText` 還原(非正則剝離)、AC6 純圖片舊輪例外正確丟棄 "(圖片)" 佔位 text block。AiPanel 僅改 payload 組裝一行 + `CONFIG_APPENDIX_HEADER` 常數抽取,state/渲染零改動。三個新 Playwright 案例以 `postDataJSON()` 直接斷言 request body 形狀(非只驗 UI),reviewer 獨立重跑:ai-panel.spec.ts 10/10 綠、全套件 90 passed / 1 skipped(@paid)、eslint 乾淨。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)
無。

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1
- **File**: src/lib/ai-panel/messages.ts:49
- **Note**: 若某舊輪 user content 出現多個 text block,每個都會被換成同一份 `displayText`(重複)。現行 AiPanel 組裝保證每輪恰一個 text block,故僅為理論情境;如未來組裝邏輯改變需留意。

### Suggestion 2
- **File**: playwright-tests/ai-panel.spec.ts:274
- **Note**: 案例 1 route handler 內 `[GENERATE_PLAN_FIXTURE, TEXT_REPLY_FIXTURE][Math.min(idx, 1)]` 重複了 `mockAiChat` 的排隊邏輯;未來可讓 `mockAiChat` 增加回傳 captured bodies 的選項收斂。本次依 orchestrator Assumption 4(不改 helper 簽章)屬正確取捨。

### Suggestion 3
- **File**: src/lib/ai-panel/messages.ts:49
- **Note**: `turn.displayText ?? ""` 在 displayText 缺漏時會送出空字串 text block;現行 user 輪必定設 displayText(`trimmed || "(圖片)"`),屬防禦性寫法,可接受。

## Security Assessment
- Secrets scan: PASS(無金鑰/憑證;測試圖片為 in-memory PNG magic bytes,無真實帳密)
- Input validation: N/A(僅操作既有本地 state 衍生資料,無新外部輸入面)
- Auth/authz: N/A(未觸及 auth、session、proxy.ts、CORS/CSP)
- server-only 邊界: PASS — `src/lib/ai-panel/messages.ts` 僅 `import type Anthropic`(type-only),未 import `src/lib/ai/` 或 `src/lib/supabase/admin.ts`;payload 仍僅含 `messages` 欄位,無 client 端 `system` 繞道
- 後端零改動: PASS — git diff 未觸及 `src/app/api/`、`src/lib/ai/`(AC 最後一條)
- Test coverage: 新增 3 案例覆蓋多輪瘦身/純圖片舊輪/首輪一致性;既有 AC1–AC4 + 全套件迴歸綠(90 passed / 1 skipped @paid)

## Plan Compliance
- [x] All architect plan steps implemented(steps 1–6,含 AC6 例外與已知極端邊界註解記錄於 messages.ts)
- [x] Implementation matches plan intent(純函式、不 mutate、block 順序不重排、tool_result 原參照)
- [x] No unauthorised scope additions

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| — | — | 無 🔴/🟡 發現,無需開發者往返 |
