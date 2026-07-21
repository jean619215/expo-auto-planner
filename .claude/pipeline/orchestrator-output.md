# Orchestrator Output — AI 助理面板改版
> Story: AI 助理面板 bug 修復與 UI 改版 | Generated: 2026-07-21T11:20:00+08:00

## Task Type
FRONTEND

## Refined Requirement
改版 `src/components/venue/AiPanel.tsx`(掛載於 `src/components/venue/PlanEditor.tsx` 的 `step-edit` 區塊內),將其從目前「按鈕展開的浮動卡片」改為**右側可收合側欄(right-side collapsible sidebar)**,並同步調整內部視覺與輸入元件,同時強化 `@paid` 煙霧測試斷言。不涉及 `/api/ai/chat` 或任何後端功能性邏輯的修改(既有 502 bug 已判定不可重現、無需修 code),僅新增後端提供扣點值給前端顯示所需的最小資料介面(方式由 architect 決定:併入 `/api/ai/chat` 既有回應,或新增輕量 config 端點,例如回傳 `AI_CHAT_COST`)。

改版重點:
1. **右側可收合側欄**:面板從畫面右側滑出/收合,與 2D/3D 編輯畫面(`Stage`/`step-preview`)並存,不遮擋、不覆蓋編輯區。收合時編輯區占滿可用寬度(或至少側欄收合後不佔用畫面空間、不擋任何既有可互動元素)。
2. **描述區去外框**:對話訊息列表(現有 `data-testid="ai-messages"` 容器,目前有 `border border-input rounded-md`)移除外框樣式,與整頁視覺一致(可保留必要的 padding/scroll 容器,但不得有可見邊框)。
3. **輸入框加大**:現有單行 `Input`(`data-testid="ai-input"`)改為多行 `textarea`(適合輸入較長的場地描述),維持相同 `data-testid="ai-input"` 供既有 selector 沿用。
4. **圖片上傳改按鈕**:現有原生 `<input type="file">`(`data-testid="ai-image-input"`)外觀改為觸發式按鈕樣式(點擊後開啟系統檔案選擇器),底層仍是 `input[type=file]` 元素(維持 `data-testid="ai-image-input"` 讓 Playwright `setInputFiles` 沿用),只是視覺上不再是瀏覽器原生 file input 外觀(例如用 `Button` 觸發隱藏 input 的 `click()`,沿用 `AiPanel.tsx` 既有 `fileInputRef` pattern)。
5. **點數餘額 + 每次扣點顯示**:面板一開啟(不需送出任何訊息)就同時顯示「目前點數餘額」與「本次對話每次呼叫將扣除的點數」(即 `AI_CHAT_COST`,值必須來自後端,前端不得寫死或用 `NEXT_PUBLIC_` 環境變數重複定義造成漂移 — 對應 AGENTS.md AI 模組守則)。每次 `/api/ai/chat` 呼叫成功後,餘額顯示即時更新為最新值(沿用現有 `data.balance` 回傳)。
6. **`@paid` 煙霧測試斷言強化**:`playwright-tests/ai-panel.spec.ts` 中 `@paid` 真模型測試目前的斷言 `await expect(ai.messages).not.toBeEmpty()` 太弱 — optimistic 的 user 訊息一送出就會讓 `messages` 非空,即使後端從未真正呼叫 Anthropic API 或直接壞掉,測試依然會綠燈(2026-07-21 已實際發生:測試通過但 server log 完全沒有 `/api/ai/chat` 請求紀錄)。必須改為明確等待**助理回應的文字內容**出現後才視為通過。

## Task Type 確認
FRONTEND — 純前端元件改版(佈局、樣式、互動元件)+ 對應 Playwright page object/測試更新;唯一涉及後端的部分(暴露 `AI_CHAT_COST`)由 architect 決定併入既有回應或新增端點,屬小型必要支撐,不改變本任務的 FRONTEND 分類。

## Clarified Acceptance Criteria

### AC1 — 右側可收合側欄
- [ ] Given 使用者在 `/venue` 的編輯步驟(`step-edit`),when 頁面載入完成,then AI 助理面板預設為收合狀態,且收合狀態下不佔用/不遮擋 2D 編輯畫面(`Stage`)任何可互動區域。
- [ ] Given 面板收合中,when 使用者點擊切換按鈕(沿用 `data-testid="ai-panel-toggle"`),then 面板從畫面右側展開為側欄,與編輯畫面並存(不是覆蓋在畫面上方的浮層/modal,不阻擋編輯區的滑鼠/觸控操作)。
- [ ] Given 面板已展開,when 使用者再次點擊切換按鈕,then 面板收合,回到 AC1 第一條的狀態。
- [ ] Given 面板展開,when 使用者於編輯畫面(`Stage`)進行既有的繪製/選取/刪除等操作,then 操作行為與面板改版前一致(不因側欄改版而被面板遮蔽或搶走事件)。

### AC2 — 描述區去外框
- [ ] Given 面板展開且尚無對話記錄,when 檢視訊息區塊(`data-testid="ai-messages"`),then 該容器不呈現可見邊框(border),其餘功能(顯示歷史訊息、`actionSummary`、卷軸)不變。

### AC3 — 輸入框加大
- [ ] Given 面板展開,when 檢視輸入區,then 輸入元件為多行 `textarea`(而非單行 input),仍以 `data-testid="ai-input"` 標記。
- [ ] Given 使用者在 textarea 中輸入內容並按下 Enter(不含 Shift/Cmd 修飾鍵),then 觸發送出(維持現有 Enter-to-send 行為;若技術上與「textarea 內按 Enter 換行」互斥,採 Enter 送出、Shift+Enter 換行 的慣例做法,見 Assumption 1)。
- [ ] Given 訊息送出成功,then 輸入框內容清空(沿用現有 `setInput("")` 行為)。

### AC4 — 圖片上傳改按鈕樣式
- [ ] Given 面板展開,when 檢視圖片上傳控制項,then 呈現為按鈕樣式(非瀏覽器原生 file input 外觀),點擊後開啟系統檔案選擇器。
- [ ] Given 使用者透過該按鈕選擇圖片,then 既有行為不變:base64 轉換、3MB 上限拒絕與錯誤訊息(含「3MB」文字)、預覽縮圖顯示、可移除(「移除圖片」按鈕)。
- [ ] Given 底層 file input 元素,then 仍可被 Playwright 以 `data-testid="ai-image-input"` + `setInputFiles` 操作(即使視覺上被按鈕觸發,元素本身需存在於 DOM 並可程式化賦值,通常做法:視覺隱藏但保留於 DOM 的原生 `input[type=file]`,由外層按鈕呼叫其 `.click()`)。

### AC5 — 點數餘額 + 每次扣點顯示
- [ ] Given 使用者展開面板(尚未送出任何訊息),when 檢視面板頭部,then 同時顯示「目前點數餘額」(沿用 `data-testid="ai-balance"`)與「本次對話每次呼叫扣除點數」兩個數值,且扣點數值不是前端寫死的常數,而是來自後端回傳(端點/欄位由 architect 決定)。
- [ ] Given 面板剛展開且尚未有任何 `/api/ai/chat` 回應,when 餘額尚未知,then 餘額顯示需有明確的載入中或預設狀態(不得顯示誤導性數字,例如硬編 0),沿用現況 `balance ?? "-"` 的降級模式即可,但初始餘額值需透過後端取得(見 Assumption 2)。
- [ ] Given 一次 `/api/ai/chat` 呼叫成功(200),then 餘額顯示即時更新為該次回應的 `data.balance`(沿用現有邏輯,不倒退)。
- [ ] Given 一次呼叫回傳 402(點數不足),then 餘額顯示同步更新為錯誤回應中的 `balance`(沿用現有 `setBalance(nextBalance)` 邏輯),扣點顯示的數值本身不變(扣點值是固定成本顯示,不因單次失敗而改變)。

### AC6 — `@paid` 煙霧測試斷言強化
- [ ] Given `PW_PAID_AI=1` 且已用測試帳號登入,when 送出「你好」等問候語給真實模型,then 測試必須等待**助理訊息文字內容**實際出現在 `ai-messages` 中(例如透過新增/沿用一個可鎖定「最新一則 assistant 回合文字」的 locator,斷言其文字非空字串且不等於 optimistic user 訊息本身),而非僅斷言 `messages` 整體 `not.toBeEmpty()`。
- [ ] Given 後端因故未真正呼叫 `/api/ai/chat`(例如 502 但前端誤判成功,或請求根本沒發出),then 強化後的斷言必須會失敗(用以重現並防止 2026-07-21 發生過的「測試綠但 server log 無請求紀錄」問題)。
- [ ] `AiPanelPage` page object 需相應新增/調整 locator,能明確鎖定「最後一則 assistant 訊息的文字內容」,供 `@paid` 測試與(若適用)其他非 mock 測試重用。

### AC7 — 既有功能不退化(回歸範圍)
- [ ] 多輪對話(`turns` 累積、`pendingToolResults` 併入下一輪)行為不變。
- [ ] tool call 套用到編輯器(`generate_plan` 等 fixture 觸發 `applyActions`,`actionSummary` 顯示、2D 平面圖更新家具數量)行為不變。
- [ ] 402 點數不足錯誤顯示(含餘額與「前往商店購買點數」連結 `a[href='/shop']`)行為不變。
- [ ] 401 未登入錯誤顯示(「請先登入才能使用 AI 助理」)行為不變。
- [ ] 500/其他非 200/402/401 錯誤顯示 `data-testid="ai-error"` + `role="alert"`,且失敗輪不寫入對話歷史,行為不變。
- [ ] scope guard(系統提示相關,後端不變)不受影響。
- [ ] 既有 `playwright-tests/ai-panel.spec.ts` 全數(mock 部分,原 AC1-AC4)在 selector/斷言依改版調整後,全數通過。

## Edge Cases to Handle
- 面板從收合到展開的動畫/轉場(若有)不得阻塞或延遲使用者輸入 — 展開後應立即可操作(輸入框可 focus、按鈕可點擊)。
- 側欄展開寬度需考慮小螢幕/視窗縮小情境下是否仍可讀取編輯區(至少不得讓編輯區寬度變成 0 或負值);若螢幕過窄導致無法並存,允許側欄以覆蓋方式退化顯示,但此為 Out of Scope 的響應式細節,仍需確保不出現版面破版或元素重疊到不可點擊的程度。
- textarea 多行輸入時,使用者貼上包含換行的長文字(例如複製場地需求描述)— 應正常換行顯示、正常送出,不截斷。
- 圖片上傳按鈕在 `pending`(送出中)狀態下需維持 disabled(沿用現有 `disabled={pending}` on file input,按鈕本身也需同步 disabled)。
- 點數餘額/扣點值初次載入失敗(例如後端提供扣點值的來源回錯):不得讓整個面板崩潰,扣點顯示與餘額顯示各自獨立降級(參考現有 `balance ?? "-"` pattern)。
- 快速連續點擊「收合/展開」切換按鈕:不應造成訊息歷史遺失或重複渲染異常(現有 state 邏輯不變,僅是外層容器的顯示/隱藏機制改變,需確保沒有因改用不同顯示機制,如 `display:none` vs unmount,而意外重置 `turns`/`input`/`imageDraft` 等 state)。

## Error States
- 圖片超過 3MB:沿用現有 `data-testid="ai-error"`,文字含「3MB」,不送出請求。行為與呈現位置(是否仍在面板內同一錯誤區塊)不變。
- 402 點數不足:沿用現有錯誤卡片,含目前餘額與 `/shop` 連結;輸入內容保留供重送(見既有測試「輸入的訊息保留可重送」)。
- 401 未登入:沿用現有訊息「請先登入才能使用 AI 助理」。
- 500/502 等其他錯誤:沿用現有泛用錯誤訊息顯示、`role="alert"`、失敗輪不寫入歷史。
- 後端扣點值來源(若 architect 選擇新增端點)取得失敗:面板仍需可用(可送出訊息),扣點顯示以降級文字(例如「-」)呈現,不得整體阻斷面板功能。

## Out of Scope
- `/api/ai/chat` 既有的功能性邏輯(扣點時機、上游失敗不退點、system prompt、tools schema)—**不修改**,502 bug 已判定不可重現(dev server 未帶最新 env var 導致,非程式問題)。
- 對話歷史持久化(落 DB)— 現況仍為前端 state,phase 1 範圍不變。
- 完整響應式/行動裝置版面重排(僅需確保不破版,不要求針對手機版另做精緻設計)。
- 側欄展開/收合的動畫效果精緻度(有轉場即可,不要求特定動畫曲線或時長規格)。
- 新增或變更點數商店(`/shop`)相關功能。
- 除本任務明列的 selector/斷言調整外,不擴充 `ai-panel.spec.ts` 覆蓋範圍到本 story 未提及的新驗收項目(例如不需新增鍵盤可及性測試,除非 architect 判斷為必要的最小改動)。

## Assumptions Made
1. **Enter 送出 vs 換行衝突**:輸入框由單行 `Input` 改為多行 `textarea` 後,若維持「按 Enter 直接送出」的既有行為,使用者將無法在 textarea 內用 Enter 換行。假設採業界慣例:**Enter 送出、Shift+Enter(或 Cmd/Ctrl+Enter)換行**,原生 Enter-to-send 行為調整為僅在無修飾鍵時送出。此為 UX 慣例假設,architect 若有不同選擇需在 architect-plan.md 中明確記錄並更新此份 spec 的對應驗收條件。
2. **扣點值(`AI_CHAT_COST`)取得方式**:由 architect 決定技術實作(併入既有 `/api/ai/chat` 200 回應新增欄位、或新增獨立輕量 `GET` config 端點),但無論哪種方式都必須滿足:面板展開時不需先送出訊息就能看到扣點值(需要一個「面板開啟即觸發」的取得時機 — 例如與餘額查詢併同一個端點取得),不得是前端 hardcode 常數或 `NEXT_PUBLIC_*` 環境變數。
3. **側欄「不遮擋編輯區」的判定標準**:以「側欄展開時,`Stage`/2D 編輯畫面的既有互動熱區保持可點擊、不被面板容器在 DOM/z-index 上覆蓋」為準,不要求特定像素寬度或斷點規格,由 architect/developer 依現有 layout(`PlanEditor.tsx` 內 flex 排版)決定具體實作。
4. `ai-messages`「去外框」僅指移除 `border` 樣式,不影響滾動容器(`overflow-y-auto`)、圓角、內距等其他既有樣式,除非與新版面衝突需要調整。
5. `@paid` 煙霧測試斷言強化所需的新 locator(鎖定最新 assistant 文字)可透過既有 DOM 結構加上明確的 `data-testid` 達成(例如針對最後一則 assistant 訊息新增 `data-testid="ai-last-assistant-text"`),具體命名由 developer 在實作階段決定,只要求語意明確、穩定可測。

## Security Notes
- 扣點值(`AI_CHAT_COST`)一律讀自伺服器端 env var(`process.env.AI_CHAT_COST`,見 `src/lib/ai/client.ts`),前端只能透過後端回應取得,**嚴禁**新增 `NEXT_PUBLIC_AI_CHAT_COST` 或任何前端硬編值 — 一旦後端調整成本,前端顯示需自動同步,避免用戶端顯示與實際扣點金額漂移(對應 AGENTS.md「AI」章節守則)。
- 若 architect 選擇新增獨立端點取得扣點值,該端點若不需使用者身分即可回應(純靜態設定值),仍需評估是否要納入 `src/proxy.ts` 的公開 allowlist,並確認不會意外洩漏任何使用者相關或敏感資訊(該值本身是全站共用常數,非個資,風險低,但仍需明確走過 proxy 保護邏輯決策,不可繞過既有 fail-closed 機制)。
- 圖片上傳改為按鈕觸發後,底層檔案驗證邏輯(3MB 上限、base64 轉換)不得因視覺改版而被繞過或弱化 — 開發階段需確認新按鈕觸發路徑與原生 `onChange` 事件仍走同一段驗證程式碼,而非平行複製一份邏輯造成之後修改時漏改其中一處。
- 無新增的敏感資料顯示或 API 權限變更;既有 401/402 錯誤處理與身分驗證機制不變。
