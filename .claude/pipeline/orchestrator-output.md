# Orchestrator Output — 2D 畫布 zoom/pan(移除場地尺寸編輯,固定 200x200)
> Story: PlanEditor 操作體驗改善(zoom/pan + AI 面板常駐) | Generated: 2026-07-22T14:08:18Z

## Task Type
FRONTEND

## Refined Requirement
`src/components/venue/PlanEditor.tsx` 的 2D 平面圖畫布改為支援縮放(zoom)與平移(pan),取代現行「場地尺寸」編輯功能:

1. **Zoom/Pan(Konva Stage 層)**:Stage 增加 `scaleX`/`scaleY`(等比)與 `x`/`y` position 狀態。滑鼠滾輪以游標為錨點縮放;工具列提供 `+`/`−` 按鈕與「重置視圖」按鈕;顯示目前倍率(如「100%」)。平移透過拖曳空白處達成,與既有「拖曳物件/頂點/把手」操作互斥(由 architect 定案区隔機制,見下方選項)。
2. **座標换算全面遷移**:所有互動使用 Konva 事件的 `getRelativePointerPosition()`(將 Stage 的 scale/position 已還原到 Stage 內部座標系),取代現行 `stage.getPointerPosition()`(回傳未還原的螢幕像素座標,zoom/pan 後會失準)。物件的公尺座標系統(`pxToMeters`/`metersToPx`/`computePxPerMeter`)完全不受 zoom/pan 影響 — zoom/pan 純屬 Stage 顯示層 transform,不進入 `src/lib/venue/plan.ts` 的任何運算。
3. **移除場地尺寸編輯 UI**:`venue-size-button`/`venue-size-editor`(含 `venue-size-input`/`venue-size-confirm-button`/`venue-size-cancel-button`)與 `sizeConfirmOpen` AlertDialog(`venue-size-confirm-dialog`/`venue-size-confirm-cancel`/`venue-size-confirm-accept`)整組移除,含對應 state(`sizeEditorOpen`/`sizeInput`/`pendingSizeM`/`sizeConfirmOpen`)與 handler(`openSizeEditor`/`applyVenueSize`/`handleSizeConfirm`/`handleSizeConfirmAccept`)。
4. **可規劃範圍固定 200x200 公尺**:`venueSizeM` 不再是可變 state,前端一律以固定常數 `200`(`MAX_VENUE_SIZE_M` 現值,可直接沿用/更名)驅動所有 clamp/snap/create 函式呼叫(`clampToBounds`/`snapPoint`/`createWall`/`createColumn`/`translateWall`/`translateColumn`/`resizeColumnCorner`/`moveVertex`/`insertVertexOnEdge`/`moveWallEndpoint` 等既有 `sizeM` 參數)。
5. **預設視圖 fit 中央 50x50**:見下方 Assumption 1 — 座標原點與 `DEFAULT_FLOOR` 常數維持不變(左上角 (0,0)、地板仍在 20,20–30,30),Stage 初始 scale/position 使畫面呈現與現行完全一致的視覺(等同 fit `[0,50]x[0,50]` 這個子區域);`zoom out` 後可看到並編輯延伸到 200x200 的完整範圍。
6. **AI 系統提示與工具 schema 尺寸描述批次更新**:`src/lib/ai/system.ts`(`SYSTEM_PROMPT`,frozen string)與 `src/lib/ai/tools.ts`(schema `description` 中的座標範圍描述)兩處所有「50」「0-50」相關描述一次性改為對應 200 的敘述,一次 commit 內完成(prompt cache 這輪必失效,不得分批改動造成 system.ts 與 tools.ts 描述不一致的過渡態)。僅文字/數值變更,不動 `src/lib/ai/` 的邏輯結構、不新增插值。

## Task Type Confirmation
FRONTEND — 核心變更在 `PlanEditor.tsx`(UI/畫布互動)。`system.ts`/`tools.ts` 的純文字數值更新是本任務的必要配套(座標範圍改變必須讓 AI 端同步認知),但不涉及後端邏輯/API 契約變更,不足以讓本任務整體判定為 BACKEND。

## Clarified Acceptance Criteria
- [ ] Given 2D 編輯畫布,when 滑鼠滾輪在畫布上滾動,then Stage 以游標所在點為錨點縮放(游標下的公尺座標點縮放前後視覺位置不變)。
- [ ] Given 2D 編輯畫布,when 點擊 `+`/`−` 縮放按鈕,then 以畫布中心為錨點縮放一個固定步進。
- [ ] Given 已縮放/平移的畫布,when 點擊「重置視圖」按鈕,then Stage scale/position 回到預設值(fit 中央 50x50,即與初始掛載時完全一致)。
- [ ] Given 任意縮放倍率,then 工具列顯示目前倍率百分比,並即時隨縮放更新。
- [ ] Given 縮放倍率已達上限/下限,when 繼續嘗試放大/縮小(滾輪或按鈕),then 倍率夾在範圍內不再變化(architect 決定具體 min/max,建議 0.25x–4x 落在合理帶,實際數值由 architect 定案並記錄於 architect-plan.md)。
- [ ] Given `mode === "select"` 且畫布空白處(無命中任何頂點/物件/把手)按下滑鼠,when 拖曳,then 畫布平移(pan),不觸發選取框選或物件移動。
- [ ] Given 任意物件/頂點/把手上按下滑鼠,when 拖曳,then 觸發既有的物件移動/頂點移動/把手縮放邏輯,不觸發畫布平移(即使當前已縮放/平移)。
- [ ] Given 任意縮放/平移狀態,when 畫地板頂點(拖曳/雙擊加頂點/右鍵刪頂點)、畫牆(wall 工具拖曳起訖)、放柱子(column 工具點擊)、拖曳家具/柱子/牆體移動、拖曳牆端點、拖曳柱子縮放把手,then 產生的公尺座標與縮放/平移為 1x/(0,0) 時完全一致(誤差在既有 `toBeCloseTo(_, 5)` 級別內)。
- [ ] Given 頁面首次載入編輯步驟,then 畫面呈現與現行(修改前)預設視覺完全一致(地板方塊位置、視覺比例不變)——見 Assumption 1。
- [ ] Given 讀取一份 `venueSizeM` 為 40(或其他 ≤200 舊值)的存檔,when 套用至編輯器,then 正常顯示與編輯,不觸發任何範圍/資料遷移邏輯,不論存檔中的 `venueSizeM` 為何值,前端一律以固定 200 作為 clamp 上限。
- [ ] Given 讀取一份缺少 `venueSizeM` 欄位的舊存檔,then fallback 不崩潰(沿用現行 `rawPlan.venueSizeM` 型別檢查與 fallback 邏輯,fallback 值為固定 200 而非現行的 `VENUE_SIZE_M`=50 常數,因為場地已無「預設 50」概念)。
- [ ] Given 使用者存檔(PUT `/api/plans/[slot]`),then payload 的 `venueSizeM` 欄位固定送出 `200`(不再受任何前端可變 state 影響)。
- [ ] Given 「場地尺寸」按鈕/編輯器/確認彈窗已移除,then 頁面上不存在 `venue-size-button`/`venue-size-editor`/`venue-size-confirm-dialog` 等 DOM(`data-testid`),對應舊 Playwright 測試(若存在)同步移除。
- [ ] Given AI 對話生成/修改配置(`generate_plan`/`resize_floor`/`add_furniture`/`move_item` 等 tool call),then 產生座標的合法範圍為 0–200(不再是 0–50),前端 clamp 行為與工具 schema 描述一致。
- [ ] Given 既有 Playwright 迴歸套件(`venue-plan-editor.spec.ts`/`venue-dimensions.spec.ts`/`venue-objects.spec.ts`/`venue-3d-scene.spec.ts`/`plan-slots.spec.ts`/`ai-panel.spec.ts`),when 在預設(未縮放/平移)視圖下執行,then 全數維持通過,不需改動既有斷言的期望值(視覺/座標不變)。

## Edge Cases to Handle
- 滾輪錨點縮放發生在畫布邊緣/角落,游標接近或超出 Stage 可視區域時不得產生 NaN/Infinity position。
- 連續快速滾輪事件(高頻 wheel event)不應造成 scale 抖動或超出 min/max 後又跳回。
- 平移拖到極端位置(地板/物件完全移出可視範圍)UI 不崩潰,重置視圖按鈕仍可一鍵復原。
- 縮放至最小倍率時,200x200 整個範圍應可完整容納於可視區域內(min zoom 需與 200/50 的比例關係一併驗證,不能出現「zoom out 到底仍看不到邊界」)。
- 雙擊加頂點、右鍵刪頂點等非拖曳互動在縮放/平移狀態下的命中判定(hit test)須用 `getRelativePointerPosition()` 換算後的座標,不能用螢幕像素直接命中。
- 舊存檔 `venueSizeM` 大於 200 的異常資料(理論上不該出現,因為現行 `MAX_VENUE_SIZE_M` 本來就是 200)—— 沿用現行 `Math.min/Math.max` 防呆讀入邏輯即可,不需新增例外處理。
- AiPanel 側欄展開/收合造成 Stage 寬度(`stagePx`)透過 ResizeObserver 改變時,現行 `pxPerMeter` 會跟著變 —— 需確認這與新的 zoom scale 是疊加關係(`pxPerMeter` 走公尺→畫布內部像素、zoom scale 是畫布內部像素→螢幕像素的第二層 transform),兩者不可互相覆蓋或雙重換算,architect 需在方案中明確畫出兩層座標系的職責分界。

## Error States
- 縮放倍率計算異常(除以 0、NaN 輸入)→ 靜默 clamp 回目前有效值,不拋錯、不重置整個 Stage。
- `getRelativePointerPosition()` 回傳 `null`(理論上僅在事件不含 Stage 情境下發生)→ 沿用現行 `if (!pointer) return;` 防呆模式(既有程式碼已大量使用此 pattern,遷移時保留)。

## Out of Scope
- AiPanel 跨步驟常駐、3D 預覽步驟 AI 對話(story 的第二個 task,不在本任務範圍)。
- 場地尺寸的伺服器端/資料庫 schema 變更 —— `venueSizeM` 欄位本身、`/api/plans/[slot]` route 不變,僅前端固定送出的數值改變。
- 既有存檔資料遷移/批次更新資料庫中舊 `venueSizeM` 值 —— 明確不做,舊存檔原樣保留,讀檔時前端固定以 200 為運算上限。
- 觸控手勢(pinch-to-zoom、雙指平移)—— 本任務僅要求滑鼠滾輪/按鈕/拖曳,行動裝置觸控手勢不在範圍內(除非既有 Playwright/需求另有規定,目前未見)。
- AI 系統提示或 tools schema 的任何邏輯/規則變更 —— 僅座標範圍數值/描述文字的批次更新,不新增/修改工作模式規則或 scope guard。

## Assumptions Made
1. **「預設視圖 fit 中央 50x50」的語意**:優先滿足 AC 明文的「與現行預設視覺一致」— 因此座標原點與 `DEFAULT_FLOOR` 常數不變(仍在左上角 0,0 為基準、地板仍在 20,20–30,30),初始 Stage transform 呈現的畫面等同「fit 顯示 `[0,50]x[0,50]` 這個(原點角落而非幾何正中心)子區域」。之所以稱為「中央 50x50」,取其相對於使用者「起始關注區」的直覺說法,而非要求以 200x200 空間的幾何正中心 (75,75)–(125,125) 作為預設視窗 —— 後者會讓地板初始視覺位置整個改變,與 AC 明文的「一致」互斥。如果人類事後確認需要幾何正中心語意,屬於範圍變更,需重新走 orchestrate。
2. **`VENUE_SIZE_M`(`src/lib/venue/plan.ts` 常數,現為 50)不在本任務變更範圍** —— 它驅動 `createDefaultFloor` 的預設參數與 `EMPTY_PLAN_BASELINE`,這兩者的現行行為(10x10 置中地板、dirty 判定基準)依 AC「與現行預設視覺一致」應保持不變。「固定 200x200」指的是 `PlanEditor.tsx` 元件層面驅動 clamp 的 `venueSizeM`(現行 `MAX_VENUE_SIZE_M`),兩個常數在本任務後語意分裂(`VENUE_SIZE_M`=預設地板生成用、200=可規劃範圍上限),architect 可視情況重新命名以消除混淆,但不得讓 `createDefaultFloor()` 的預設行為隨之改變。
3. `src/lib/ai/tools.ts` 的 schema `description` 字串(如 `"公尺,0-50"`)雖非 AC 明文點名的「系統提示」,但屬於同一份 AI 對場地尺寸的認知來源,不同步會讓 AI 生成超出新範圍(50-200 之間)的座標時被前端 clamp,體驗劣化 — 判定為本任務隱含範圍,與 `system.ts` 一併批次修改。
4. Playwright 既有 `PlanEditorPage.meterToScreen()`(`playwright-tests/pages/PlanEditorPage.ts`)目前假設 Stage 沒有 scale/position transform,直接用 `pxPerMeter` 換算螢幕座標。此任務引入 Stage transform 後,該 helper 必須改為同時納入目前 scale/position 才能在「縮放/平移狀態下」正確點擊 —— 這是既有測試基礎設施的必要配套修改,不算需求範圍外,architect 需規劃對應的測試 hook(例如比照現行 `data-px-per-meter` 屬性,新增可讀取當前 stage scale/x/y 的 data attribute 或等效 API)。
5. 「+/− 按鈕與滾輪的縮放步進」「min/max 倍率」「pan 與物件拖曳的區隔機制(空白鍵 modifier vs. 純粹以命中測試判斷 vs. 獨立平移工具模式)」為技術實作細節,已在 AC 中列出選項與方向、留給 architect 定案,惟 architect 定案後的具體數值/機制需記錄在 architect-plan.md 供 Playwright 撰寫測試依據。

## Security Notes
- `src/lib/ai/system.ts`、`src/lib/ai/tools.ts` 均在 `src/lib/ai/` 模組下,已 `import "server-only"`,本任務僅改動字串常數,不改變 import 邊界,無新增 client-side 洩漏風險。
- 無新增使用者輸入面(zoom/pan 為純前端顯示狀態,不落地存檔、不影響 API payload 除了 `venueSizeM` 固定值),無新增安全性/隱私疑慮。
- 座標範圍放寬至 200 對 `resizeColumnCorner`/`clampColumnCenter` 等既有邊界防呆函式無結構性風險 —— 皆已透過 `sizeM` 參數化,非硬編碼 50。
