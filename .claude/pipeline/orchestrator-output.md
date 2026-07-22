# Orchestrator Output — 存檔 UI + AiPanel 續聊/清空對話/軟上限/歷史圖片占位
> Story: 場地儲存檔與 AI 對話持久化 | Generated: 2026-07-22T02:43:00+08:00

## Task Type
FRONTEND
(內含一支必要的小型後端端點 `DELETE /api/plans/[slot]/conversation`,理由見「Refined Requirement」第 8 點 — 沒有它「清空對話」AC 無法達成,且風險/複雜度與既有 `[slot]/route.ts` 其他 handler 同級,不足以拆成獨立 BACKEND task。)

## Refined Requirement

### 1. 存檔面板(三格)
- 在 `PlanEditor.tsx` 的 `step === "edit"` 工具列(`PlanToolbar` 旁,與「場地尺寸」「下一步」同一列)新增一顆按鈕 `data-testid="plan-slots-button"`(文案:「我的存檔」),點擊開啟一個 Dialog(沿用既有 `@/components/ui/alert-dialog` 或一般 `Dialog`,由 architect 決定元件),`data-testid="plan-slots-dialog"`。
- Dialog 開啟時呼叫 `GET /api/plans`,渲染固定 3 列(slot 1–3),每列 `data-testid="plan-slot-row-{slot}"`,顯示:
  - 已占用:名稱(`plan-slot-name-{slot}`)、最後更新時間(`plan-slot-updated-{slot}`,格式由 architect 決定,人類可讀即可)、「讀取」「改名」「刪除」三個操作。
  - 空格:顯示「空格」占位文字(`plan-slot-empty-{slot}`),只有「存入此格」操作。
  - 已占用格也提供「存入此格」(= 覆蓋)。
- 「存入此格」統一走同一支函式:空格直接呼叫 `PUT /api/plans/[slot]`;已占用格先跳覆蓋確認彈窗(見下)。

### 2. 存檔(save)
- 存檔內容 = 目前編輯器 state 整包快照:`{ polygon, walls, columns, furniture, venueSizeM }`。
  **注意:比後端 `isValidPlanShape` 目前檢查的 4 個欄位多了 `venueSizeM`** — 後端該函式只檢查必要欄位存在且型別正確,額外欄位不影響驗證,不需改後端。但沒有 `venueSizeM`,讀檔後編輯器無法還原正確的公尺↔像素比例與尺寸邊界,因此**前端存檔 payload 必須包含 `venueSizeM`**,讀檔時也必須讀回並還原(見 §3)。這是本次釐清新增的必要欄位,architect 請據此規劃 plan snapshot 的 TS type。
- 名稱:輸入框預設空白 → 送出時若空白,後端已有 DB default「未命名場地」(PUT 不帶 `name` 時語意上「新建套 default、更新沿用舊值」),前端存檔對話框應讓使用者可選填自訂名稱(非必填)。
- 覆蓋確認彈窗(`data-testid="plan-overwrite-confirm-dialog"`):顯示目標格「現有名稱」與「現有最後更新時間」,文案例如「格 2『XX 場地』(更新於 ...)將被覆蓋,確定嗎?」。確認後才送出 `PUT`。取消則什麼都不做,Dialog 停留。
- 存檔成功後:更新面板列表(重新 GET 或用 PUT 回傳值局部更新)、記住 `currentSlot`/`currentPlanId`(見 §4),並將「未存變更」基準線(dirty baseline)重設為剛存入的內容。

### 3. 讀檔(load)
- 點「讀取」:
  1. 先做未存變更檢查(見 §5「未存變更判定」)。若 dirty,跳確認彈窗 `data-testid="plan-load-confirm-dialog"`(文案:「目前工作區有未儲存的變更,讀取將捨棄這些變更,確定要繼續嗎?」),取消則不讀。
  2. 呼叫 `GET /api/plans/[slot]`,取得 `{ planId, slot, name, plan, updatedAt, conversation }`。
  3. 用 `plan.polygon/walls/columns/furniture/venueSizeM` 覆蓋編輯器 state(等同現有 `applyVenueSize` 邏輯的「整批覆蓋」,但保留讀進來的 `venueSizeM` 而非重算預設地板)。
  4. 記住 `currentSlot = slot`、`currentPlanId = planId`(存在 `PlanEditor` 層級 state,往下傳給 `AiPanel`)。
  5. 把 `conversation`(訊息陣列)轉成 `AiPanel` 的 `turns` 初始值(見 §6),取代目前 `turns`,並清空 `pendingToolResults`。
  6. 重設 dirty baseline = 剛讀入的內容。
  7. 關閉 slots dialog。
- 讀檔後,`AiPanel` 之後每次 `POST /api/ai/chat` 都要帶上 `planId`(等於 `currentPlanId`)。

### 4. 改名 / 刪除
- 改名:`data-testid="plan-rename-button-{slot}"` → 開一個小輸入(inline 或小 Dialog,`data-testid="plan-rename-dialog"`),送出呼叫 `PATCH /api/plans/[slot]`。空字串前端擋(對齊後端 `EMPTY_NAME_ERROR`),不送出請求。成功後更新該列名稱。若改名的正是 `currentSlot`,一併更新任何顯示中的名稱。
- 刪除:`data-testid="plan-delete-button-{slot}"` → 確認彈窗 `data-testid="plan-delete-confirm-dialog"`(文案需明確提及「連同該格的 AI 對話一併刪除」,對齊 story AC「刪除存檔 cascade 帶走對話」)。確認後呼叫 `DELETE /api/plans/[slot]`。
  - 若刪除的格正是 `currentSlot`:清空 `currentSlot`/`currentPlanId`(變回未讀檔工作區狀態),但**不清空編輯器畫面內容或 AiPanel 的 turns**——使用者仍在編輯剛才的東西,只是它不再對應任何存檔;之後的 chat 呼叫改回不帶 `planId`(行為同未讀檔工作區,不落庫)。這點請在確認彈窗文案中一併說明或至少不誤導使用者。

### 5. 未存變更判定(dirty check)
- 維護一個 `savedBaseline`(最近一次成功存檔或讀檔時的 plan 快照序列化字串,初始為 `null`,代表「從未存讀過,以初始空場地為基準」)。
- 判斷 dirty:目前 `{ polygon, walls, columns, furniture, venueSizeM }` 序列化後 !== `savedBaseline`(`savedBaseline` 為 `null` 時,以「初始空場地快照」字串比較)。
- 僅在「讀檔」操作前做此檢查;存檔本身不需要 dirty 檢查(存檔就是要把目前狀態寫入)。
- 場地尺寸變更彈窗(既有 `venue-size-confirm-dialog`)、下一步/上一步、Konva 操作等既有流程一律不受影響、不因此新增額外攔截。

### 6. AiPanel 續聊 / 清空對話 / 軟上限 / 歷史圖片占位
- **Props 擴充**:`AiPanel` 需新增 `planId: string | null` 與 `initialConversation`(由 `PlanEditor` 在讀檔完成時以某種方式送入,例如 `key` 讓 `AiPanel` 依 `currentSlot` remount 並吃 `initialTurns` prop;或改用受控 `turns`。實作細節留給 architect,但**行為要求**是:讀檔後面板顯示的對話 = 該格歷史對話,且可直接續聊)。
- **續聊時的 displayText 還原**:後端落庫的 user 訊息 content 是**當時送給模型的原始 content blocks**(即含 `[目前配置]` JSON 附錄的 text block,圖片已於落庫時換成 `PRIOR_IMAGE_PLACEHOLDER` 純文字 block —— 見 `src/lib/ai-panel/messages.ts` / `src/app/api/ai/chat/route.ts` 的 `replaceImageBlocks`)。讀檔還原歷史對話時,面板要能正常渲染每個歷史 user 回合的「使用者看得懂的那句話」,而不是連 `[目前配置]\n{...}` 那坨 JSON 一起顯示。需要一個新的還原函式(比照 `src/lib/ai-panel/messages.ts` 既有瘦身邏輯反向操作):從 text block 內容中去掉 `CONFIG_APPENDIX_HEADER` 起算的附錄部分,取得可讀的 `displayText`。
- **歷史圖片占位 UI(本任務新增 AC 的核心)**:任何 content block 內容等於 `PRIOR_IMAGE_PLACEHOLDER`(`src/lib/ai-panel/messages.ts` 匯出的常數 `"[使用者先前提供了參考圖]"`)的純文字 block,渲染時**不要**照字面顯示該字串,而要顯示成 story 指定的占位 UI:「📷 參考圖」(`data-testid="ai-history-image-placeholder"`)。本次 session 內剛送出、尚未整頁重整/尚未讀檔覆蓋的圖片訊息,仍照現況顯示原圖預覽,不受此規則影響(此規則只套用在「從 `GET /api/plans/[slot]` 讀回的歷史訊息」)。
- **100 輪軟上限提示**:「輪」定義為一組 user+assistant 配對(對齊 `ai_messages` 每輪寫入 2 列的既有慣例)。當目前 `turns.length / 2 >= 100` 時,面板顯示提示(`data-testid="ai-turn-limit-hint"`,文案例如「對話已達 100 輪,建議清空對話後重新開始,以確保 AI 回應品質」),**不阻擋送出**,持續顯示直到清空。
- **清空對話**:
  - 按鈕 `data-testid="ai-clear-conversation-button"`,**只在 `currentPlanId` 不為 `null`(已讀檔/已存檔的格)時顯示/可用**;未讀檔的工作區沒有持久化對話可清,不顯示此按鈕(對齊 story:「僅清該格對話」)。
  - 點擊跳確認彈窗 `data-testid="ai-clear-conversation-confirm-dialog"`(文案:「確定要清空這個存檔格的對話紀錄嗎?此動作無法復原,場地配置不受影響。」)。
  - 確認後呼叫 **新端點 `DELETE /api/plans/[slot]/conversation`**(見下方「新增後端端點」),成功後清空前端 `turns` 與 `pendingToolResults`,配置(polygon/walls/columns/furniture)完全不動。

### 7. 未存檔工作區(沒有讀檔過)行為
- 完全比照現況:`currentSlot`/`currentPlanId` 皆為 `null`,`POST /api/ai/chat` 不帶 `planId`,對話不落庫,無「清空對話」按鈕、無 100 輪提示的「格別」意義變化(輪數仍以本地 `turns` 計算,提示邏輯一致,只是清空只能靠瀏覽器重整/沒有專屬按鈕)。

### 8. 新增後端端點(本任務範圍內的小後端)
`DELETE /api/plans/[slot]/conversation`
- 沿用 `[slot]/route.ts` 現有 `requireUser()` + `parseSlot()` 慣例;受 `src/proxy.ts` fail-closed 保護,免改 allowlist。
- 流程:驗證 slot 格式 → 驗證登入 → 用 admin client 以 `.eq("user_id", userId).eq("slot", slot)` 查出該格 `venue_plans.id`(不存在回 404,對齊「跨使用者/不存在」統一回 404 慣例)→ 找該 plan 的 `ai_conversations` 列(不存在則視為已清空,直接回 200,冪等)→ 刪除該 conversation 底下所有 `ai_messages`(用 `conversation_id` 過濾;是否連同刪除 `ai_conversations` 該列本身,或只清空訊息保留空對話列,兩者皆可 — 因為下次 chat 走 `upsert(..., onConflict:"plan_id")` find-or-create,兩種實作都不影響後續行為;architect/developer 擇一,建議直接刪 conversation 列,cascade 帶走 messages,邏輯最簡單)。
- 回應:`{ slot, cleared: true }`,狀態碼 200。錯誤沿用既有錯誤字串慣例(未登入 401、格位不正確 400、找不到存檔 404、伺服器錯誤 500)。
- 這是本任務唯一被允許新增的後端程式碼;其餘一律沿用 task 1/2 已完成的 5 支存檔 API 與既有 `/api/ai/chat`。

## Clarified Acceptance Criteria
- [ ] Given 使用者在場地規劃頁,when 點擊「我的存檔」,then 彈出面板固定顯示 3 格,已占用格顯示名稱與最後更新時間,空格顯示占位文字。
- [ ] Given 面板中某空格,when 點擊「存入此格」,then 直接呼叫 `PUT /api/plans/[slot]` 存入目前編輯器整包快照(含 `venueSizeM`),成功後面板該列更新。
- [ ] Given 面板中某已占用格,when 點擊「存入此格」,then 先跳覆蓋確認彈窗顯示該格現有名稱與最後更新時間;確認後才覆蓋,取消則不動作。
- [ ] Given 目前工作區與 `savedBaseline` 不同(dirty),when 點擊某已占用格的「讀取」,then 先跳未存變更確認彈窗;取消則不讀檔,確認後才繼續讀檔流程。
- [ ] Given 目前工作區與 `savedBaseline` 相同(not dirty),when 點擊「讀取」,then 直接讀檔,不跳確認彈窗。
- [ ] Given 讀檔成功,then 編輯器 polygon/walls/columns/furniture/venueSizeM 全部套用為讀入內容,AiPanel 的對話歷史被讀入的 `conversation` 取代,`currentPlanId` 更新,之後 `POST /api/ai/chat` 帶上該 `planId`。
- [ ] Given 讀檔還原的歷史對話含有先前上傳圖片的訊息(後端已存成 placeholder 文字),then 該則訊息顯示為「📷 參考圖」占位 UI,而非顯示原始 placeholder 字串或壞掉的圖片。
- [ ] Given 讀檔還原的歷史 user 回合含 `[目前配置]` JSON 附錄,then 面板顯示的是還原後的可讀文字(不含該 JSON 附錄)。
- [ ] Given 點擊「改名」,when 輸入空字串送出,then 前端擋下不送 API(對齊後端 `EMPTY_NAME_ERROR`);輸入合法名稱送出,then 呼叫 `PATCH /api/plans/[slot]` 成功後該列名稱更新。
- [ ] Given 點擊「刪除」,then 先跳確認彈窗(文案需說明會一併刪除該格對話);確認後呼叫 `DELETE /api/plans/[slot]`,該列變回空格。若刪除的是目前讀檔中的格,`currentSlot`/`currentPlanId` 清空,畫面內容與 AiPanel turns 不變,之後 chat 呼叫不帶 `planId`。
- [ ] Given 已讀檔(`currentPlanId` 不為 null)且對話非空,when 點擊「清空對話」,then 先跳確認彈窗;確認後呼叫 `DELETE /api/plans/[slot]/conversation`,成功後前端 `turns` 清空,場地配置不受影響。
- [ ] Given 未讀檔的工作區(`currentPlanId` 為 null),then 「清空對話」按鈕不顯示/不可用。
- [ ] Given 單一存檔格對話輪數(`turns.length / 2`)達到 100,then 面板顯示軟上限提示,且仍可繼續送出訊息(不阻擋)。
- [ ] Given 未登入使用者呼叫任一存檔 API(含新的 `DELETE .../conversation`),then 回 401。
- [ ] Given 跨使用者存取他人 `planId`/`slot` 對應的資源(含清空對話),then 回 404,不洩漏該格是否存在或屬於誰。
- [ ] 既有 AiPanel mock 套件與全套 Playwright 迴歸通過,無退化。

## Edge Cases to Handle
- 使用者在存檔對話框開著的同時繼續編輯畫布(對話框未鎖背景互動)—— 若架構上兩者互斥(Dialog 開啟時背景不可互動)則此邊界自動消失,由 architect 決定是否需要顯式鎖定。
- 讀檔的目標格,其 `conversation` 陣列為空(從未在這格聊過天但格子本身有存檔)—— 面板應顯示「尚無對話」的既有空狀態,而不是報錯。
- 使用者連續快速點擊「存入此格」/「讀取」造成的 race(例如尚未等到前一個 API 回應就再點一次)—— 至少要避免重複送出(disable 按鈕 loading 中);不要求完整 optimistic-lock。
- 「刪除」正在讀檔中的格之後,若使用者接著又點「存入此格」存回**同一格**,等同建立一份全新存檔(新 `plan_id`,因為原本的 row 已被刪除、`upsert` 會 insert 新列)——之前的舊對話已隨 cascade 消失,這是預期行為(對齊 story:一格 = 一份配置 + 一段對話的聚合根語意),UI 不需特別處理,只是提醒 architect/developer 這不是 bug。
- 圖片 placeholder 判斷需**精確比對** `PRIOR_IMAGE_PLACEHOLDER` 字面字串(從 `src/lib/ai-panel/messages.ts` import,不要各自複製字串常數),避免使用者剛好打出一模一樣文字時被誤判(機率低,但比對邏輯本身要引用同一常數以維持單一事實來源,這件事本身就能降低此風險)。
- `venueSizeM` 是本任務新增進 plan 快照的欄位;若之前(task 1/2 手動測試階段)DB 裡已經有不含 `venueSizeM` 的舊測試資料,讀檔時該欄位會是 `undefined`——前端讀檔套用邏輯需對缺欄位做 fallback(例如退回目前的 `VENUE_SIZE_M` 預設值),不可整段崩潰。

## Error States
- `GET /api/plans` 失敗(非 200)→ 面板顯示錯誤訊息 + 可重試,不阻擋關閉面板。
- `PUT/PATCH/DELETE /api/plans/[slot]` 失敗(非 200,含 404/500)→ 對應彈窗內顯示錯誤訊息,不關閉彈窗,允許使用者重試或取消。
- `GET /api/plans/[slot]` 讀檔失敗 → 顯示錯誤訊息,**不清空/不覆蓋**目前編輯器與 AiPanel 狀態(讀檔失敗要保證原地狀態不丟)。
- `DELETE /api/plans/[slot]/conversation` 失敗 → 顯示錯誤訊息,`turns` 保持原狀(不要 optimistic 清空後才發現失敗)。
- 401(未登入):比照既有 AiPanel `error.kind === "auth"` 的呈現慣例,提示需登入。
- 404(找不到存檔/跨使用者):以通用「找不到存檔」文案呈現,不特別區分是「真的不存在」還是「不是你的」(對齊既有防列舉慣例精神)。

## Out of Scope
- 「點數解鎖更多格」— 3 格上限是本任務假設的固定值,放寬邏輯不在本任務範圍。
- 自動存檔 — 已在 story 附註中明確否決,不做。
- 「另存到別格」帶著對話一起複製 — 已在 story 附註否決,新格永遠是新對話(空)。
- Supabase Storage 真正保存圖片以便讀檔後 AI 仍能看到原圖 — story 附註已延後,本任務只做占位 UI。
- AI 回應落庫失敗的補償/重試機制 — task 2 已定調 phase 1 不做補償,本任務不改動這個取捨。
- 「目前讀檔中是哪一格」的常駐視覺徽章/指示(如標題列顯示「目前:格 2」)— 非 AC 明確要求,不強制,architect 可視實作成本自由決定是否加(加了不算超出範圍,但沒加也不算沒達標)。
- 對話搜尋、匯出、多對話並存(ChatGPT 式列表)— story 附註已否決多對話模型。

## Assumptions Made
1. 存檔面板的觸發按鈕位置:PlanEditor 的 `step === "edit"` 工具列(與「場地尺寸」「下一步」同列)。story 未指定確切位置,由 orchestrator 依現有版面慣例假設;若 architect 認為獨立區塊更合適,可調整位置,但 `data-testid` 命名與互動流程需維持本文件定義,以免 Playwright 規格跟著全部重寫。
2. 存檔快照 payload 在既有 4 欄位(`polygon/walls/columns/furniture`)之外新增 `venueSizeM`,理由與後端相容性已在「Refined Requirement §2」說明——這不是後端契約變更,只是前端存入 payload 的欄位擴充(`isValidPlanShape` 不會拒絕多餘欄位)。
3. 「清空對話」判定「是否可用」的條件用 `currentPlanId !== null`,而非「對話是否非空」——即使對話目前是空的,只要格已讀檔/已存檔,按鈕仍可見(按下去等於 no-op 成功)。避免額外的「是否非空」前端判斷邏輯與後端狀態不同步的風險。
4. `DELETE /api/plans/[slot]/conversation` 選擇刪除整個 `ai_conversations` 列(而非只清空 `ai_messages` 保留空列)—— 兩者行為對前端與下次 chat 落庫皆等價(find-or-create upsert 兩種情況都會重新建立/找到),選刪除整列以求實作最簡單,architect 若有理由偏好另一種亦可調整,不影響本文件其餘任何一條 AC。
5. Playwright 驗收沿用 `ai-panel.spec.ts` 已建立的慣例:全部用 `page.route()` 攔截 `/api/plans*`、`/api/plans/*/conversation`、`/api/ai/chat`、`/api/ai/config`,不打真實 Supabase/Anthropic,也不需要登入流程(`/venue` 頁面本身非 auth-gated page,攔截發生在請求離開瀏覽器之前)。新增 page object 建議獨立檔案(例如 `playwright-tests/pages/PlanSlotsPage.ts`),不要塞進既有 `PlanEditorPage`/`AiPanelPage`,以保持單一職責與既有檔案好維護。

## Security Notes
- 新端點 `DELETE /api/plans/[slot]/conversation` 必須比照 `[slot]/route.ts` 既有 handler:admin client 查詢一律加 `.eq("user_id", userId)`,不可只靠 RLS(admin client 無 RLS,這是專案既有反覆強調的安全關鍵慣例)。
- 前端存檔面板/清空對話等新 UI 一律走既有 `/api/*` 路由,不直接呼叫 Supabase client(對齊 AGENTS.md「Frontend 必須透過 `/api/*`」的既定架構規則)。
- 未登入/跨使用者情境的回應規格(401/404)已在 AC 與 Error States 中明列,PR Reviewer 會依 AGENTS.md 針對 auth 相關改動自動列為 🔴 Critical 檢視項,實作時請確保新端點與既有端點行為一致,不要用不同狀態碼洩漏存在性差異。
- 落庫的歷史對話內容(含 `[目前配置]` JSON 附錄、placeholder 字串)本身可能包含使用者過去輸入的場地配置細節——前端渲染這些歷史內容時不需要額外遮罩處理(非機敏個資等級),但仍需確保只有本人能透過已定義的 401/404 規則讀到自己的資料,不做內容層級的額外脫敏。
