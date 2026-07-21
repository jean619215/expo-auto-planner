# Code Review Report — AI 助理面板改版(右側可收合側欄 + textarea + 扣點顯示 + @paid 斷言強化)
> Generated: 2026-07-21T13:20:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
實作與 architect-plan.md 12 步完全一致,無偏離、無範圍外擴。安全面(proxy 保護、server-only 邊界、無 NEXT_PUBLIC 漂移、單一驗證路徑)全數通過;@paid 三重斷言確實封死假綠三路徑。唯一 🟡(ResizeObserver 遷移後遺留的 dead `containerRef`)已由 developer 修復並重跑驗證,lint/tsc/ai-panel mock 測試(7/7)全綠。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — dead code:`containerRef` 遷移後未移除
- **File**: `src/components/venue/PlanEditor.tsx:156` / `:839`
- **Issue**: ResizeObserver 量測目標改為 `editorColumnRef` 後,原 `containerRef` 仍宣告並掛在最外層 div 上,但再無任何讀取 — dead code,違反 DoD「No TODOs, commented-out code」精神,且註解仍引用該 ref 造成誤導。
- **Suggested fix**: 移除宣告與 `ref={containerRef}` 屬性,改寫註解中的過時引用。
- **Resolution**: ✅ 已修復(見 Conversation Log),lint/tsc/ai-panel 7/7 重跑通過。

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1 — config fetch 與 chat 回應的餘額競態(理論性)
- **File**: `src/components/venue/AiPanel.tsx`(config useEffect)
- 若 `/api/ai/config` 回應極慢,而使用者在其抵達前已完成一次 chat 200(setBalance 為新值),遲到的 config 回應會以較舊餘額覆寫(AC5「不倒退」的極端 edge)。實務上 config 為輕量 SUM、chat 需數秒模型呼叫,時序上幾乎不可能;且 `cancelled` flag 已涵蓋收合/unmount。若未來要封死:chat 回應後以 flag 忽略未決 config 的 `setBalance`。

### Suggestion 2 — `@paid` 純 tool_use 回應的理論空文字
- `你好` 問候語必回文字,現行斷言足夠;若未來 @paid 換成會觸發 tool call 的 prompt,`ai-assistant-text` 可能為空字串,屆時需改斷言 `ai-action-summary`。僅為未來維護提示。

### Suggestion 3 — AiPanel 於 step 切換(edit↔preview)時 unmount,對話 state 遺失
- 既有行為(改版前掛載點同樣在 `step-edit` 條件塊內),非本次退化;phase 1 對話不持久化為明示 out of scope。僅記錄。

## Security Assessment
- Secrets scan: PASS(無硬編 secret;`AI_CHAT_COST` 唯一來源為 server env 經 `/api/ai/config`;全 repo 無 `NEXT_PUBLIC_AI_CHAT_COST`)
- Input validation: PASS(config route 為無參數 GET;圖片 3MB 驗證仍走同一 `handleImageChange`,hidden input 由按鈕觸發,無平行複製)
- Auth/authz: PASS(`src/proxy.ts` 零改動,`/api/ai/config` 不在 `PUBLIC_API_PATHS`,fail-closed 保護 + route 內 `getUser()` 雙檢;401 訊息「請先登入」與既有一致;error log 僅 `err.message`,無 token/cookie)
- Server-only 邊界: PASS(client 端無任何 `src/lib/ai/` import;config route 為 server route)
- CORS/CSP: 未觸碰
- Test coverage: ai-panel.spec.ts 7 mock + 1 @paid;AC1 補扣點/餘額斷言;@paid 三重斷言(waitForResponse POST /api/ai/chat → status 200 → lastAssistantText 非空)封死「請求未發出 / 非 200 / 只有 optimistic user 訊息」三條假綠路徑

## Plan Compliance
- [x] All architect plan steps implemented(Steps 1–12 逐一比對通過)
- [x] Implementation matches plan intent(D1 config 端點受保護、D2 含 `isComposing` IME 防護、D3 flex sibling + 常駐掛載 + ResizeObserver 遷移含 `step` guard、D4 testid 僅掛 assistant 回合)
- [x] No unauthorised scope additions

## Reviewer Independent Verification
- `npm run lint`:乾淨
- `npx tsc --noEmit`:乾淨
- `npx playwright test ai-panel.spec.ts`:7 passed, 1 skipped(@paid 依設計 skip;developer 已於 implement 階段以 PW_PAID_AI=1 實跑 1/1 PASS)
- 🟡 修復後三項全數重跑,結果不變

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| 🟡-1 dead `containerRef` | 移除宣告與 ref 屬性、改寫註解(3 處,`containerRef` 全 repo 歸零) | 已驗證:lint/tsc/ai-panel 7/7 綠 |
