# Code Review Report — 場地規劃 AI 助理 / Task 3 [FRONTEND] AI 助理面板

> Generated: 2026-07-17T20:05:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
實作品質良好:server/client 邊界乾淨(client 端 `src/lib/ai-panel/` 與 server-only `src/lib/ai/` 確實分離,無任何 client 路徑觸及 server-only 模組或 env)、對話 state 為 Anthropic 原生 MessageParam 格式(升級落 DB 免改)、tool_result carry-over 符合 Anthropic 慣例(置於下一則 user 訊息開頭、對應 tool_use_id、失敗以 is_error 標記)、PlanEditor diff 限於 applyActions + 掛面板(未碰既有編輯邏輯)。Playwright mock fixtures 與真實 route 回應 shape(content/stopReason/usage/balance;402 body)逐欄一致。實測:tsc exit 0、lint exit 0、ai-panel spec 7/7 綠(reviewer 複核 tsc/lint 均通過)。無 Critical;2 項 Should Fix、4 項 Consider。

## 裁決事項

### 1. `import type Anthropic from "@anthropic-ai/sdk"`(AiPanel.tsx:4)— **可接受**
- `import type` 為 type-only 語法,TypeScript 編譯期保證抹除,SDK 不會進 client bundle,無 runtime 依賴、無 env/秘密洩漏路徑(API key 只在 server-only 的 `src/lib/ai/client.ts` 讀取,未受影響)。
- SDK 套件本身無 `server-only` 標記,type-only import 不觸發邊界違規。tsc/lint 實測通過。
- 相較自定義型別,直接共用 wire-format 型別與 route 回傳(route 原樣回傳 `response.content`)可防型別漂移 — 反而是較安全的選擇。
- 附帶條件:必須維持 type-only(見 💡 C-4)。

### 2. `/venue` 不在 PROTECTED_PAGES(membership task 7 遺留缺口)— **本 task 不修,維持記錄**
- 對本 task 的實際影響有限:`/api/ai/chat` 由 proxy fail-closed 保護(未登入 401),AiPanel 已實作防禦性 401 處理(顯示「請先登入」)。未登入者只能看到面板 UI,無法消耗點數或觸及資料。
- 不在本 task 修的理由:(a) 屬 auth 頁面保護變更,per AGENTS.md 為自動 Critical 級改動,超出本 task「AI 面板」核准範圍;(b) 既有全部 venue 系列 Playwright spec(venue-plan-editor / venue-objects / venue-dimensions / venue-3d-scene)與本次 ai-panel spec 均以未登入狀態跑 /venue,加保護會全面破壞測試策略,需同步引入登入 setup(storageState)— 應為獨立 task。
- 處置:記錄為 known gap,建議開後續 task「/venue 加入 PROTECTED_PAGES + config.matcher + Playwright 登入 setup 遷移」。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — API 等待期間的跨 render stale closure,會覆蓋使用者手動編輯
- **File**: src/components/venue/AiPanel.tsx:156(呼叫端)/ src/components/venue/PlanEditor.tsx applyActions
- **Issue**: `handleSend` 在點擊當下 capture `applyActions` prop;`applyActions` 本身 close over 該次 render 的 polygon/walls/columns/furniture。AI 呼叫需時數秒,期間輸入框雖 disabled 但 2D 畫布仍可操作 — 使用者若在等待中拖動/新增/刪除物件,回應到達後 applyActions 從「送出前快照」起算並整批 setState,使用者等待期間的編輯被靜默覆蓋。批次局部變數只解了同批 actions 內的 stale 問題,未解跨 await 的 render staleness。
- **Suggested fix**: PlanEditor 內 applyActions 改為 functional updater(`setFurniture(prev => ...)` 等,起點取 prev 而非 closure 變數);move/remove 的 index 檢查一併在 updater 內做。或以 ref 持有最新 state(latest-ref pattern)供 applyActions 讀取。

### Issue 2 — @paid 真模型煙霧測試無登入步驟,實跑必失敗
- **File**: playwright-tests/ai-panel.spec.ts:230-244
- **Issue**: 煙霧測試直接 navigate /venue 後送真請求,但 `/api/ai/chat` 受 proxy 保護 — 未登入必回 401 → 面板顯示 ai-error → `expect(ai.error).toBeHidden()` 必失敗。此測試在其唯一設計用途(手動設 PW_PAID_AI=1 執行)下 dead-on-arrival。預設 skip 故不影響 CI 門檻,但交付一條註定失敗的測試不符驗收品質。
- **Suggested fix**: 測試開頭加登入流程(重用既有 spec 的登入 helper / `.env.playwright.local` 測試帳號),或在無憑證時同時 skip(`test.skip(!process.env.PW_PAID_AI || !process.env.PW_TEST_EMAIL)`)並補登入。

## 💡 Suggestions (Consider — No Action Required)

### C-1 — parseToolUse 靜默忽略未知 tool 名稱,潛在不可恢復對話 + 重複扣點
- **File**: src/lib/ai-panel/actions.ts:118-120
- 未知 tool_use 被丟棄 → 該 tool_use_id 無對應 tool_result → 下一輪送出時上游必回 400,且 400 發生在扣點之後(route 取捨:不退點)— 使用者每次重試都燒點數,對話永久卡死。以現狀(前後端 tool 集同版共同部署)不可能觸發,故列 Consider;若日後後端加 tool,建議 default 分支改為產生 `is_error: true` 的 tool_result(「不支援的操作」)而非忽略。

### C-2 — plan prop 未含 venueSizeM(偏離 architect plan)
- **File**: src/components/venue/AiPanel.tsx:17-22 / PlanEditor.tsx 掛載處
- Architect plan 規格為 `plan: {polygon, walls, columns, furniture, venueSizeM}`;實作省略 venueSizeM,附帶配置 JSON 無場地邊界資訊。模型可從 floor polygon 推斷,實害小,但屬未聲明的 plan 偏差,記錄之。

### C-3 — 跳過警告訊息以 0-based index 顯示給使用者
- **File**: src/components/venue/PlanEditor.tsx(move_item/remove_item 分支)
- 「第 0 個牆壁不存在」對使用者不直觀(對模型無妨,tool_result 本就約定 0-based)。可考慮顯示層 +1 或改寫措辭。

### C-4 — 為 type-only SDK import 加防護
- **File**: src/components/venue/AiPanel.tsx:4
- SDK 無 server-only 標記,未來若改成 value import,SDK 會被靜默打包進 client(bundle 膨脹,雖無秘密洩漏)。建議加註解說明「必須維持 type-only」,或啟用 `@typescript-eslint/consistent-type-imports`。

## Security Assessment
- Secrets scan: PASS(無硬編碼秘密;API key 僅存在 server-only client.ts,本次未觸碰)
- Input validation: PASS(client 端 3MB 圖片上限;server 端既有 5MB body 上限 + roles 驗證,未變更)
- Auth/authz: PASS(/api/ai/chat 受 proxy fail-closed 保護;面板 401 防禦處理到位;/venue 頁面缺口為既有已知問題,裁決見上)
- CORS/CSP: 未變更 — PASS
- XSS: PASS(全部經 React text rendering,無 dangerouslySetInnerHTML;server error 字串以純文字渲染)
- 依賴: 無新增(SDK 為 task 2 既有依賴,本次僅 type-only 引用)
- Test coverage: ai-panel spec 7 條覆蓋 AC1-AC4(mock)+ 1 條 @paid 煙霧(預設 skip);fixtures 與真 route shape 一致

## Plan Compliance
- [x] All architect plan steps implemented(檔案配置、AiPanel 子元件整合、applyActions、mock 策略均照 plan)
- [x] Implementation matches plan intent(唯一偏差:venueSizeM 省略,見 C-2)
- [x] No unauthorised scope additions(PlanEditor diff 僅 applyActions + 掛面板 + 必要 imports)

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| type-only SDK import 裁決 | Developer 主動 flag | Reviewer 裁決可接受(理由見上),附帶 C-4 防護建議 |
| /venue 未受保護 | Developer 主動 flag(task 7 遺留) | Reviewer 裁決本 task 不修,記錄為 known gap,建議開後續 task |
