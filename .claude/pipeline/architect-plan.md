# Architect Plan — 存檔 UI 三格面板 + AiPanel 續聊/清空對話/軟上限/歷史圖片占位

> Story: 場地儲存檔與 AI 對話持久化 | Task type: FRONTEND(含一支已核可的小型後端端點) | Generated: 2026-07-22T10:30:00+08:00

## Overview

在 `PlanEditor` 的 edit 工具列新增「我的存檔」入口,開啟三格存檔 Dialog(存/讀/改名/刪除/覆蓋確認);讀檔把 plan 快照套回編輯器 state、把落庫 conversation 還原成 AiPanel turns 並續聊帶 `planId`;AiPanel 加清空對話(走新端點 `DELETE /api/plans/[slot]/conversation`)、100 輪軟上限提示與歷史圖片占位 UI。Playwright 全程 `page.route()` mock 驗收。

## Task Type Confirmed

FRONTEND — 與 orchestrator-output.md 一致。內含的 `DELETE /api/plans/[slot]/conversation` 已由 orchestrator 明列為本任務唯一允許的後端新增(§8),複雜度與 `[slot]/route.ts` 既有 handler 同級,不需拆 task,不構成 escalation。

## Escalation Check(結論:不升級)

- 無外部 API 契約變更(新端點為內部 `/api/*`,受 `src/proxy.ts` fail-closed 保護,免改 allowlist)。
- 無 DB schema 變更(task 1/2 的表與 cascade FK 原樣沿用)。
- 無 auth/安全模型變更(沿用 `requireUser()` + admin client `.eq("user_id")` 既有慣例)。
- 複雜度在 story 範圍內;spec 資訊充分。

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/components/venue/PlanSlotsDialog.tsx` | 三格存檔面板(Dialog)+ 覆蓋/讀檔/刪除確認彈窗 + 改名小 Dialog。所有 slot API 呼叫與列表 state 都在此元件內;透過 props 與 PlanEditor 溝通 |
| `src/app/api/plans/[slot]/conversation/route.ts` | 新端點 `DELETE`:清空該格對話(刪整列 `ai_conversations`,cascade 帶走 `ai_messages`) |
| `playwright-tests/pages/PlanSlotsPage.ts` | 存檔面板 page object(獨立檔案,不塞進 PlanEditorPage/AiPanelPage) |
| `playwright-tests/plan-slots.spec.ts` | 本任務 Playwright 驗收 spec(存/讀/改名/刪除/dirty 確認/續聊/清空對話/軟上限/圖片占位) |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/components/venue/PlanEditor.tsx` | 新增「我的存檔」按鈕 + 掛載 `PlanSlotsDialog`;新增 `currentSlot`/`currentPlanId`/`savedBaseline`/`conversationSeed` state;讀檔套用函式 `applyLoadedPlan`;dirty 判定;把 `planId`/`slot`/`conversationSeed` 傳給 `AiPanel` |
| `src/components/venue/AiPanel.tsx` | 新 props(`planId`、`slot`、`conversationSeed`);chat body 帶 `planId`;清空對話按鈕 + 確認彈窗 + DELETE 呼叫;100 輪軟上限提示;歷史圖片占位「📷 參考圖」渲染 |
| `src/lib/ai-panel/messages.ts` | 新增純函式 `fromStoredConversation()`(落庫訊息 → 面板 turns 的反向還原:displayText 去附錄、標記歷史圖片占位)。維持 isomorphic,不引入 server-only/瀏覽器 API |
| `src/lib/venue/plan.ts` | 新增 `PlanSnapshot` 型別 + `serializePlanSnapshot()` + 初始空場地 baseline 常數 |
| `playwright-tests/pages/AiPanelPage.ts` | 補 locators:`clearButton`、`clearConfirmDialog`、`turnLimitHint`、`historyImagePlaceholder` |
| `supabase/tests/`(既有 plans 手動清單檔;若無則新增 `plans_conversation_manual.md`) | 新端點手動驗證項目:401 / 400 / 404(跨使用者)/ 200 冪等 |

## Key Design Decisions

### D1. 元件與彈窗選型(沿用 shadcn 慣例)
- 存檔面板本體:`@/components/ui/dialog` 的 `Dialog`(`data-testid="plan-slots-dialog"`),modal(shadcn 預設鎖背景互動)→ orchestrator edge case「開面板同時編輯畫布」自動消失,無需額外處理。
- 四個確認彈窗(覆蓋 `plan-overwrite-confirm-dialog`、讀檔 dirty `plan-load-confirm-dialog`、刪除 `plan-delete-confirm-dialog`、清空對話 `ai-clear-conversation-confirm-dialog`)一律用 `AlertDialog`,比照既有 `venue-size-confirm-dialog` 的結構與 testid 慣例(`*-cancel` / `*-accept` 命名)。
- 改名:小 `Dialog`(`plan-rename-dialog`)含 `Input` + 確認/取消;空字串前端擋(disable 確認鈕,不送 API)。
- 前三個確認彈窗屬存檔面板職責,放在 `PlanSlotsDialog` 內;清空對話彈窗屬 AiPanel 職責,放在 `AiPanel` 內。

### D2. state 歸屬與 planId 傳遞
- `PlanEditor` 持有:`slotsDialogOpen`、`currentSlot: 1|2|3|null`、`currentPlanId: string|null`、`savedBaseline: string|null`、`conversationSeed: { seq: number; turns: ChatTurn[] } | null`。
- `PlanSlotsDialog` props(單一職責:面板 UI + slot API;不直接碰編輯器 state):
  - `open` / `onOpenChange`
  - `getSnapshot(): PlanSnapshot` — 存檔時取目前整包快照
  - `isDirty(): boolean` — 讀檔前檢查
  - `currentSlot: number | null`
  - `onLoaded(data: LoadedPlan): void` — 讀檔成功回拋(PlanEditor 套用)
  - `onSaved(slot: Slot, planId: string): void` / `onDeleted(slot: Slot): void`
- `AiPanel` props 擴充:`planId: string | null`、`slot: number | null`、`conversationSeed`。**不用 `key` remount**(remount 會重置 `open` 收合狀態與 config fetch);改用受控 seed:AiPanel 內 `useEffect` 監看 `conversationSeed?.seq`,變化時 `setTurns(seed.turns)`、`setPendingToolResults([])`、`setError(null)`。`seq` 為遞增計數器,連續讀同一格兩次也會觸發。

### D3. Plan 快照 TS type(含 venueSizeM)
於 `src/lib/venue/plan.ts` 定義並 export(spec/page object 也可 import):
```ts
export interface PlanSnapshot {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  venueSizeM: number;
}
```
(注意 `FurnitureItem` 在 `@/lib/venue/furniture` — 若 import 造成循環依賴,改放 `src/components/venue/` 層級的小型 types 檔或 PlanEditor 內 export,developer 視實際 import 圖擇一,不得複製型別定義。)
存檔 PUT body = `{ plan: PlanSnapshot, name?: string }`。後端 `isValidPlanShape` 只驗 4 欄位、放行多餘欄位 — 不改後端。

### D4. 讀檔資料流(`applyLoadedPlan`)
`GET /api/plans/[slot]` 200 後,在 PlanEditor 依序:
1. `const sizeM = typeof plan.venueSizeM === "number" ? clamp(plan.venueSizeM, MIN_VENUE_SIZE_M..MAX_VENUE_SIZE_M) : VENUE_SIZE_M`(舊測試資料缺欄位 fallback,edge case 明列)。
2. `setVenueSizeM(sizeM)`、`setSizeInput(String(sizeM))`、`setPolygon(plan.polygon)`、`setWalls(plan.walls)`、`setColumns(plan.columns)`、`setFurniture(plan.furniture)`(整批覆蓋,同 `applyVenueSize` 精神但保留讀入內容、不重算預設地板)、`setSelectedObject(null)`、`setSelectedVertex(null)`。ref 同步交給既有 render-後 useEffect,毋須 eager 更新(applyActions 只會在之後的 chat 回應才讀 ref)。
3. `setCurrentSlot(slot)`、`setCurrentPlanId(planId)`。
4. `setConversationSeed({ seq: prev+1, turns: fromStoredConversation(conversation) })`。
5. `setSavedBaseline(serializePlanSnapshot(讀入內容))`。
6. 關閉 slots dialog。
讀檔失敗(非 200):錯誤訊息顯示在面板內,**不執行以上任何一步**(原地狀態不丟)。

### D5. Dirty 判定(取捨:序列化比對,不做逐操作 dirty flag)
- dirty = `serializePlanSnapshot(目前) !== (savedBaseline ?? EMPTY_PLAN_BASELINE)`;`EMPTY_PLAN_BASELINE` = 初始空場地 `{ polygon: createDefaultFloor(VENUE_SIZE_M), walls: [], columns: [], furniture: [], venueSizeM: VENUE_SIZE_M }` 的序列化字串,module-level 算一次。
- 取捨:逐操作 dirty flag 需在十多個 mutation handler(頂點/牆/柱/家具/AI actions/尺寸)各插一筆,侵入面大且易漏;序列化比對只在「點讀取」瞬間執行一次,物件量級小(百件內)成本可忽略,且天然涵蓋「改了又改回去 = not dirty」語意。僅讀檔前檢查,存檔不檢查(spec §5);既有尺寸彈窗/上一步下一步流程零改動。
- 存檔成功、讀檔成功後各自重設 `savedBaseline`。

### D6. conversation → ChatTurn 還原(`fromStoredConversation`)
放 `src/lib/ai-panel/messages.ts`(與 `PRIOR_IMAGE_PLACEHOLDER`/`CONFIG_APPENDIX_HEADER` 同檔,單一事實來源;維持 isomorphic)。簽名:
```ts
export interface RestoredTurn {
  role: "user" | "assistant";
  content: Anthropic.ContentBlockParam[];
  displayText?: string;        // user 輪:去掉 CONFIG_APPENDIX_HEADER 附錄後的可讀文字
  priorImageCount?: number;    // user 輪:content 中 text === PRIOR_IMAGE_PLACEHOLDER 的 block 數
}
export function fromStoredConversation(rows: { role: string; content: unknown }[]): RestoredTurn[]
```
規則:
- 逐列轉 turn;`content` 非陣列或 role 非 user/assistant 的列防禦性跳過(不 throw)。
- user 輪 `displayText`:取第一個**非** placeholder 的 text block,若含 `CONFIG_APPENDIX_HEADER` 則截斷附錄(先找 `"\n\n" + CONFIG_APPENDIX_HEADER`,找不到退 `CONFIG_APPENDIX_HEADER`),trim。
- `priorImageCount`:精確 `block.text === PRIOR_IMAGE_PLACEHOLDER` 全等比對(import 常數,不複製字串字面值)。
- assistant 輪原樣(渲染沿用 `extractText`);`tool_result` block 原樣保留在 content(續聊送出時 `toApiMessages` 既有邏輯已正確處理舊輪,tool_use_id 鏈不斷)。
- 歷史 turns 不重建 `actionSummary`(落庫沒有 tool 執行結果;assistant 文字本身已描述動作)— 明確接受,非 AC 要求。
- AiPanel 的 `ChatTurn` 介面加 `priorImageCount?: number`(`RestoredTurn` 結構相容,seed 直接塞入)。

### D7. AiPanel 渲染/行為變更
- **歷史圖片占位**:user 輪渲染時,若 `priorImageCount` ≥ 1,在 displayText 旁渲染 N 個 chip「📷 參考圖」(`data-testid="ai-history-image-placeholder"`)。本 session 剛送出的訊息(handleSend 建立)不帶 `priorImageCount`,原圖預覽行為完全不變 — 採「還原時標記」而非「渲染時字串比對」,天然滿足「規則只套用讀回的歷史訊息」,並免去使用者剛好打出同字串的渲染誤判(比對本身仍引用同一常數)。
- **chat 帶 planId**:`handleSend` fetch body 改 `{ messages: toApiMessages(nextTurns), ...(planId ? { planId } : {}) }`。`planId === null` 完全不帶欄位(後端 undefined 走零查詢路徑;既有 payload 瘦身斷言不受影響)。
- **100 輪軟上限**:`Math.floor(turns.length / 2) >= 100` 時顯示 `data-testid="ai-turn-limit-hint"`(文案:「對話已達 100 輪,建議清空對話後重新開始,以確保 AI 回應品質」),不 disable 送出;清空/重整後自然消失。planId 有無皆同一邏輯(spec §7)。
- **清空對話**:`planId !== null` 時才渲染 `data-testid="ai-clear-conversation-button"`(對話空也可見,spec 假設 3)。點擊開 `AlertDialog`(`ai-clear-conversation-confirm-dialog`,文案照 spec §6);確認 → `DELETE /api/plans/${slot}/conversation`;200 → `setTurns([])`、`setPendingToolResults([])`;非 200 → 以既有 `ChatError` 呈現(401 auth / 404 通用「找不到存檔」/ 其餘 generic),turns 原封不動(不 optimistic)。呼叫期間 disable 確認鈕防連點。
- **刪除目前讀檔中的格**(PlanEditor 端):`onDeleted(slot)` 時若 `slot === currentSlot` → `setCurrentSlot(null)`、`setCurrentPlanId(null)`,**不動** turns/畫布/`conversationSeed`;AiPanel 因 `planId` 變 null 自動隱藏清空鈕、chat 不再帶 planId。刪除確認彈窗文案含「連同該格的 AI 對話一併刪除」,並補一句「若刪除的是目前讀取中的格,畫面內容保留但不再對應任何存檔」。

### D8. 新端點 `DELETE /api/plans/[slot]/conversation`
`src/app/api/plans/[slot]/conversation/route.ts`,只 export `DELETE`:
1. `parseSlot`(嚴格白名單字串比對 "1"/"2"/"3")→ 400 `存檔格位不正確`。
2. `requireUser()` → 401 `請先登入`。
3. admin client 查 `venue_plans.select("id").eq("user_id", userId).eq("slot", slot).maybeSingle()` — `.eq("user_id")` 為安全關鍵(admin 無 RLS);查詢錯誤 500,無列 404 `找不到存檔`(與既有端點同字串同狀態碼,跨使用者/不存在不可區分)。
4. `admin.from("ai_conversations").delete().eq("plan_id", planId)` — 採 orchestrator 建議「刪整列」,DB cascade 帶走 `ai_messages`,邏輯最簡;無對話列時 delete 影響 0 列仍回 200(冪等)。
5. 回 `{ slot, cleared: true }` 200;錯誤字串沿用既有常數值。
`parseSlot`/`requireUser` 為 module-local 小函式,在新檔內**複製**(~25 行)而非抽共用模組 — 對齊 AGENTS.md「route 內 validation inline、尚未抽 service layer」慣例(取捨見 Architecture Notes)。

### D9. 存檔面板細節(PlanSlotsDialog)
- 開啟時 `GET /api/plans`,loading 期間顯示載入中;失敗顯示錯誤 + 重試鈕,不擋關閉。
- 固定渲染 3 列(後端保證回 3 元素):`plan-slot-row-{slot}`;占用列:`plan-slot-name-{slot}`、`plan-slot-updated-{slot}`(格式 `new Date(updatedAt).toLocaleString("zh-TW", { hour12: false })`,人類可讀即可)+「讀取」(`plan-load-button-{slot}`)「改名」(`plan-rename-button-{slot}`)「刪除」(`plan-delete-button-{slot}`)「存入此格」(`plan-save-button-{slot}`);空列:`plan-slot-empty-{slot}` +「存入此格」。
- 名稱輸入:面板內一個共用選填 `Input`(`plan-save-name-input`),存入時帶上;空白不帶(後端 default「未命名場地」/更新沿用舊值)。
- 存入此格統一函式:占用格先開覆蓋確認(文案帶該列現有 name/updatedAt);空格直送。PUT 成功 → 用回傳值局部更新該列 + 呼叫 `onSaved`。**PUT 不回 planId**(既有契約,本任務不改既有 5 支 API)→ 存檔成功後 `PlanSlotsDialog` 補一次 `GET /api/plans/[slot]` 取 `planId` 再呼叫 `onSaved(slot, planId)`;**該次 GET 的 `conversation` 一律丟棄,不餵入 seed**(存檔語意不改對話)。PlanEditor 在 `onSaved` 中設 `currentSlot`/`currentPlanId` 並重設 baseline。
- 所有 mutation 呼叫期間 disable 對應按鈕(edge case:連點防重複送出;不做 optimistic-lock)。
- 錯誤:PUT/PATCH/DELETE 失敗 → 在對應彈窗內顯示錯誤、不關閉、可重試/取消;讀檔失敗 → 面板內錯誤,狀態不丟。
- 改名成功且 `slot === currentSlot`:無常駐徽章(Out of Scope 第 7 條),更新面板列即滿足 AC。

## Implementation Steps

1. **`src/lib/ai-panel/messages.ts`**:新增 `RestoredTurn` 介面與 `fromStoredConversation()`(D6),export;不動既有 `toApiMessages`。
2. **`src/lib/venue/plan.ts`**(或 D3 註記的替代位置):新增 export `PlanSnapshot`、`serializePlanSnapshot(s): string`(固定欄位順序 stringify)、`EMPTY_PLAN_BASELINE` 常數。
3. **`src/app/api/plans/[slot]/conversation/route.ts`**:實作 `DELETE`(D8)。
4. **`src/components/venue/PlanSlotsDialog.tsx`**:新元件(D1/D9),含列表 fetch、三個 AlertDialog(覆蓋/讀檔 dirty/刪除)、改名 Dialog、名稱輸入,全部 testid 照 spec。讀取流程:`isDirty()` → 需要時先開 `plan-load-confirm-dialog` → 確認後 `GET /api/plans/[slot]` → 成功 `onLoaded(data)`。
5. **`src/components/venue/PlanEditor.tsx`**:
   a. 工具列「場地尺寸」旁新增 `plan-slots-button`(「我的存檔」,`variant="outline"`、`h-[34px]` 對齊既有按鈕)。
   b. 新 state(D2)+ `applyLoadedPlan`(D4)+ `isDirty`/`getSnapshot` 回呼 + `onSaved`/`onDeleted` 處理(D7/D9)。
   c. 掛載 `<PlanSlotsDialog …/>`(root div 內,與 size AlertDialog 同層);`<AiPanel plan={…} applyActions={…} planId={currentPlanId} slot={currentSlot} conversationSeed={conversationSeed} />`。
   d. 供 Playwright 斷言:root div 加 `data-current-slot` / `data-current-plan-id`(比照既有 data-* 慣例)。
6. **`src/components/venue/AiPanel.tsx`**:props 擴充 + seed useEffect + chat body 帶 planId + 清空對話(按鈕/AlertDialog/DELETE)+ 軟上限提示 + `priorImageCount` 占位 chip 渲染(D7)。`ChatTurn` 加 `priorImageCount?: number` 並 export type(供 seed 型別)。
7. **`playwright-tests/pages/PlanSlotsPage.ts`**:locators(button、dialog、rows、name/updated/empty、各操作鈕、四個彈窗與 cancel/accept、rename input、save name input)+ 動作方法(`open()`、`saveToSlot(n)`、`loadSlot(n)`、`renameSlot(n, name)`、`deleteSlot(n)`)。
8. **`playwright-tests/pages/AiPanelPage.ts`**:補 `clearButton`、`clearConfirmDialog`、`turnLimitHint`、`historyImagePlaceholder` locators。
9. **`playwright-tests/plan-slots.spec.ts`**:mock 策略與案例見 Test Plan。
10. **手動清單**:`supabase/tests/` 補新端點 4 情境(401 / 400 / 404 跨使用者 / 200 冪等重複呼叫)。
11. `npm run lint` + 全套 Playwright(新 spec + `ai-panel.spec.ts` + `venue-*.spec.ts` 迴歸)綠燈。

## Data Flow

```
存: PlanSlotsDialog --getSnapshot()--> PlanEditor 快照(含 venueSizeM)
     --PUT /api/plans/[slot] {plan,name?}--> upsert --200--> 更新列
     --GET /api/plans/[slot](取 planId,丟棄 conversation)--> onSaved(slot, planId)
     --> PlanEditor: currentSlot/currentPlanId + savedBaseline 重設

讀: 讀取 click -> isDirty()? confirm -> GET /api/plans/[slot]
     --200 {planId,slot,name,plan,updatedAt,conversation}--> onLoaded
     --> PlanEditor.applyLoadedPlan:
         plan.* -> setVenueSizeM/setPolygon/setWalls/setColumns/setFurniture
         conversation -> fromStoredConversation() -> conversationSeed{seq++, turns}
         planId/slot -> currentPlanId/currentSlot;baseline 重設;dialog 關閉
     --> AiPanel useEffect(seed.seq): setTurns(seed.turns), pendingToolResults=[]

聊: AiPanel.handleSend -> POST /api/ai/chat {messages, planId?}
     (後端:所有權驗證 -> 扣點 -> 模型 -> 該格落庫)

清: ai-clear-conversation-button -> AlertDialog 確認
     -> DELETE /api/plans/[slot]/conversation -> 200 -> turns=[], pendingToolResults=[]

刪: plan-delete-button -> AlertDialog -> DELETE /api/plans/[slot]
     -> onDeleted(slot): slot===currentSlot 時 currentSlot/PlanId=null(畫布/turns 不動)
```

## Test Plan

無 unit test framework(專案慣例);FRONTEND 驗收 = Playwright,後端新端點 = 手動清單。

**Playwright 策略(mock vs 真 API 取捨)**:全部 `page.route()` mock(assumption 5 + `ai-panel.spec.ts` 既有慣例)— 不打真 Supabase/Anthropic、不需登入、零 flakiness、可精準做 postDataJSON payload 斷言;新端點與 401/404 真實行為由手動清單把關(專案後端驗證慣例)。route 匹配注意 Playwright「後註冊者先匹配」:建議用 **regex 分流**(`/\/api\/plans$/`、`/\/api\/plans\/\d$/`、`/\/api\/plans\/\d\/conversation$/`),避免 `/conversation` 被 `[slot]` 的 glob 吃掉;fixtures 以 helper 函式集中管理(比照 `mockAiChat` 佇列式)。

`plan-slots.spec.ts` 案例(對應 Clarified AC):
1. 開面板:3 列固定渲染,占用列 name/updated、空列占位(AC1)。
2. 空格存入:直接 PUT;**postDataJSON 斷言 body.plan 含 `venueSizeM` + 4 欄位**(AC2)。
3. 占用格存入:先覆蓋確認(含現有名稱/時間文案);確認才 PUT、取消不發請求(AC3)。
4. dirty 讀檔:先動畫布(加一根柱子)再點讀取 → `plan-load-confirm-dialog`;取消不發 GET(AC4)。
5. not-dirty 讀檔:直接讀,不跳彈窗(AC5)。
6. 讀檔套用:mock GET 回含 venueSizeM 的 plan + conversation → 斷言 `data-vertices`/`data-furniture`/`data-current-plan-id` 等 data-*,AiPanel 顯示歷史對話;再送一則訊息,**攔截 chat 請求斷言 body.planId**(AC6)。加一條缺 venueSizeM 的 fixture 變體(fallback 不崩潰)。
7. 歷史圖片占位:conversation fixture 含 `PRIOR_IMAGE_PLACEHOLDER` text block → `ai-history-image-placeholder` 顯示「📷 參考圖」,原始 placeholder 字串不出現(AC7)。
8. displayText 還原:fixture user text 含 `[目前配置]` JSON 附錄 → 面板顯示不含附錄(AC8)。
9. 改名:空字串不發請求;合法名稱 PATCH 後列更新(AC9)。
10. 刪除:確認彈窗文案含「對話一併刪除」;確認後 DELETE、列變空格;刪除 currentSlot → `data-current-plan-id` 清空、turns 仍在、後續 chat 不帶 planId(AC10)。
11. 清空對話:讀檔後按鈕可見 → 確認 → DELETE conversation → turns 清空、`data-furniture` 等配置不變;未讀檔時按鈕不存在(AC11/AC12)。
12. 軟上限:seed 200 則訊息(100 輪)conversation fixture → `ai-turn-limit-hint` 顯示且送出鈕仍 enabled(AC13)。
13. 錯誤路徑:GET /api/plans 500 → 面板錯誤 + 重試;讀檔 500 → 原地狀態不丟(Error States)。

迴歸:`ai-panel.spec.ts` 全綠(未讀檔情境 chat body 不含 planId,既有 payload 攔截斷言不變)、`venue-*.spec.ts` 全綠(AC16)。
AC14/AC15(401/跨使用者 404,含新端點):手動清單驗證 — Playwright mock 架構驗不到真後端,明確劃給手動。

Edge cases 對應(orchestrator 清單):Dialog modal 鎖背景(邊界自動消滅)、空 conversation 讀檔 seed turns=[] 顯示既有空狀態、連點 disable、刪後重存同格 = 新 planId 新存檔(預期行為,無需處理)、placeholder 全等比對 import 常數、缺 venueSizeM fallback(D4 步驟 1 + 案例 6 變體)。

## Architecture Notes

- **不用 key remount AiPanel**(spec §6 留給 architect 決定):remount 會丟 `open` 收合狀態並重跑 config fetch;受控 `conversationSeed.seq` useEffect 侵入最小、行為可測。
- **PUT 不回 planId** 是既有後端契約(本任務不改既有 5 支 API)→ 存檔成功後補一次 GET 取 planId。代價:每次存檔多一請求;收益:零契約變更。若 review 認為值得讓 PUT 回 planId,另開 task,本任務不做。
- **新 route 複製 parseSlot/requireUser** 而非抽共用:對齊「validation inline、無 service layer」既定慣例;第三處重複時再抽(留給未來 task)。
- **dirty 用序列化比對**:取捨見 D5;JSON key 順序風險不存在 — 快照物件由我們以固定字面量順序組裝。
- **歷史 turns 無 actionSummary**:落庫未存 tool 執行結果,不重建;tool_use/tool_result 鏈由原樣保留的 content 維持不斷。
- 效能:讀檔整批 setState 一次 render;serialize 僅在點「讀取」時執行一次,無熱路徑成本。

## Security Checklist

- [ ] 無硬編碼 secrets/credentials(新增程式碼零 env 直讀;admin client 走既有 factory)
- [ ] 新端點輸入驗證:slot 嚴格白名單字串比對(不用 Number())
- [ ] 新端點 `requireUser()` 401 + admin 查詢 `.eq("user_id", userId)`(admin 無 RLS,安全關鍵)
- [ ] 跨使用者/不存在統一 404 同字串**同狀態碼**(狀態碼相等性,防列舉慣例)
- [ ] 不 log tokens/session/對話內容(錯誤 log 只含 code/message)
- [ ] 前端一律走 `/api/*`,不直呼 Supabase client;`src/lib/ai-panel/` 不 import server-only 模組
- [ ] AiPanel fetch 不新增任何 client 可控 `system` 欄位;planId 僅 uuid 字串
- [ ] Playwright 不硬編碼真實憑證(本任務 mock 架構甚至不需帳號)

## Definition of Done

- [ ] Implementation Steps 1–11 全部完成,無 TODO/註解掉的程式碼/debug log
- [ ] orchestrator-output.md 全部 16 條 AC 可對應到實作與測試(AC14/15 → 手動清單)
- [ ] `npm run lint` 通過
- [ ] `plan-slots.spec.ts` 全綠 + `ai-panel.spec.ts`、`venue-*.spec.ts` 迴歸全綠
- [ ] Security Checklist 全數通過
- [ ] 符合 AGENTS.md 全部守則(`@/*` alias、shadcn 元件沿用、admin client 慣例、isomorphic 邊界)
