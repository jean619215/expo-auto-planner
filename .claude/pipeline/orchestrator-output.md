# Orchestrator Output — AiPanel 跨步驟常駐
> Story: PlanEditor 操作體驗改善(zoom/pan + AI 面板常駐) | Generated: 2026-07-22T15:40+08:00

## Task Type
FRONTEND

## Refined Requirement

目前 `AiPanel` 掛在 `PlanEditor.tsx` 的 `step === "edit"` 區塊內(`src/components/venue/PlanEditor.tsx:1533-1539`),切到 `step === "preview"` 時該區塊整個不渲染,`AiPanel` 隨之 unmount,對話 state(`turns`/`pendingToolResults`/`input`/`imageDraft`/`open` 等,皆為 `AiPanel` 內部 `useState`)全部遺失。

本任務要求:

1. **常駐掛載**:重構 `PlanEditor` 的 JSX 結構,讓 `<AiPanel>` 節點在 `step === "edit"` 與 `step === "preview"` 兩種情況下,於 React tree 中位於**同一個父層、同一個相對位置**(例如把 edit/preview 各自的內容包成左欄,`AiPanel` 提升為與「左欄」並列的 flex sibling,兩個 step 共用同一份外層 `<div className="flex ...">`),使 React 不會因為 step 切換而 unmount/remount `AiPanel`。顯示與否純粹用 CSS/條件 class 控制左欄內容,`AiPanel` 本身節點恆在。
   - `AiPanel` 已有自己的收合邏輯(`open` state,收合時只渲染 toggle 按鈕,見 `AiPanel.tsx:324-338`),沿用即可,不需另外包一層顯示/隱藏邏輯。
2. **preview 步驟版面**:`step === "preview"` 時,`VenueSceneLoader`/`VenueScene` 與 `AiPanel` 並列(左：3D 場景含其既有 `venue-sidebar` 家具工具列 + Canvas;右：AiPanel)。3D 場景本身已是 `flex gap-3`(內部 aside + canvas),`AiPanel` 應以與 edit 步驟相同的模式(shrink-0 側欄)接在最外側,不嵌入 VenueScene 內部。
3. **關鍵資料流(本任務最大技術風險,architect 需在 architect-plan.md 明確定案,以下為功能性約束,非實作指定)**:
   - `PlanEditor` 目前有兩份幾何 state:(a) edit 步驟的權威 state(`polygon`/`walls`/`columns`/`furniture`,`applyActions` 寫入這裡);(b) `sceneSnapshot`(`handleNextStep` 從 (a) 複製產生,餵給 `VenueSceneLoader`,並透過 `onSceneChange` 接收使用者在 3D 內手動操作後的回寫)。`VenueScene.tsx` 自己還有第三份 local state(`localWalls`/`localColumns`/`localFurniture`,`useState(props)` 初始化、**沒有** `useEffect` 隨 props 變化重新同步 — 元件掛載後 props 再變,local state 不會自動跟)。
   - 使用者在 preview 步驟對 AI 下指令、AI 回傳 tool call 時,`applyActions` 執行結果必須讓 **當下畫面上的 3D 場景立即反映變更**(不需使用者離開再進入 preview 步驟、不需重新整理)。
   - AI 在 preview 步驟造成的變更,回到 edit 步驟(「上一步」)時,edit 步驟畫布必須顯示同一份最新結果 — 不能出現「AI 在 preview 改的東西,回 edit 步驟後消失/被舊 state 蓋回去」的資料遺失。
   - 使用者在 3D 內手動操作(拖曳/旋轉,經 `onSceneChange` 回寫)與 AI 在同一個 preview 步驟內交錯操作時,兩者的變更都必須保留,不得互相覆蓋踩掉對方(參考 edit 步驟既有的 `polygonRef`/`wallsRef`/`columnsRef`/`furnitureRef` 這種「用 ref 讀最新 committed state、避免 await 期間 stale closure 覆蓋手動編輯」的既有解法,preview 步驟需要類似等級的保護,但因為多了 `VenueScene` 自己的 local state 這一層,不能直接照搬 — architect 需決定 `VenueScene` local state 要如何被外部(preview 步驟下的 AI 變更)可靠地推入。)
   - `AiPanel` 送給 AI 的「目前配置 JSON」(`AiPanel.tsx:189-194`,依据 `plan` prop)在 preview 步驟必須反映**畫面上使用者看到的最新幾何**,包含使用者剛才手動在 3D 內做的調整(即 `sceneSnapshot`/`VenueScene` local state 而非 edit 步驟可能已經過時的 (a) state)。若 AI 在 preview 步驟根據過期配置做判斷(例如要求移動「第 2 件家具」卻是舊的家具列表順序),即為資料流未接上,視為不符合本任務要求。

## Clarified Acceptance Criteria

- [ ] Given 使用者在 edit 步驟已與 AI 對話過(至少一輪 user+assistant),when 點擊「下一步」進入 preview 步驟,then AiPanel 內對話歷史(所有 turns)完整可見、未消失。
- [ ] Given 承上,in preview 步驟,when 點擊「上一步」回到 edit 步驟,then 對話歷史依然完整保留(往返多次皆成立)。
- [ ] Given 使用者在 edit 步驟輸入框打了字但未送出,when 切到 preview 再切回 edit,then 輸入框內容原樣保留。
- [ ] Given preview 步驟,when AiPanel 尚未展開(收合狀態),then 畫面上只顯示 toggle 按鈕(不佔用/不遮擋 3D 場景),點擊後展開側欄。
- [ ] Given preview 步驟且 AiPanel 已展開,when 使用者送出一則會觸發 tool call(如 `add_furniture`/`move_item`/`remove_item`)的指令,then `/api/ai/chat` 回應套用後,3D 場景畫面上的物件數/位置立即反映變更(以 `venue-scene` 的 `data-*-mesh-count` 或等效 data attribute 驗證),不需離開/重進 preview 步驟。
- [ ] Given preview 步驟,when AI tool call 修改了幾何(例如新增家具),then 回到 edit 步驟後,2D 畫布(`plan-editor` 的 `data-furniture-count` 等)顯示同一份包含 AI 新增結果的最新配置。
- [ ] Given preview 步驟,when 使用者先手動在 3D 內拖曳移動一件家具(未回 edit 步驟),再對 AI 下一則會參照「目前配置」的指令,then AI 收到的配置 JSON 反映該手動移動後的最新位置(而非切換到 preview 當下的舊快照)。
- [ ] Given 使用者已讀取某個存檔格(`planId`/`slot` 非 null,`conversationSeed` 已還原對話),when 在 edit/preview 之間切換,then `planId`/`slot` 不變、「清空對話」按鈕行為(僅 `planId !== null` 顯示、DELETE `/api/plans/{slot}/conversation` 成功後清空 turns)在兩步驟下皆正常。
- [ ] Given 尚未進入 preview 步驟(`sceneSnapshot === null`,即從未點過下一步),then 不需渲染 3D 場景或 preview 版面(維持現況:`step === "preview" && sceneSnapshot` 才渲染,見 `PlanEditor.tsx:1542`)。AiPanel 提升為常駐不改變這個既有的「需先產生 scene 才能看 3D」邏輯。

## Edge Cases to Handle

- 使用者在 preview 步驟送出 AI 指令的請求還在等待中(`pending`)時,點擊「上一步」切回 edit:比照既有 edit 步驟的 ref-based 保護精神,等待中的回應到達後 `applyActions` 仍必須套用到正確(當下最新)的幾何 state,不因為使用者已切換步驟而遺失或套用到錯誤目標。
- AI 在 preview 步驟回傳的 tool call 因索引越界等原因被 `applyActions` 判定失敗(`ok: false`,現有邏輯已處理,見 `PlanEditor.tsx:644-858`)—— 此行為不因常駐掛載而改變,preview 步驟下失敗訊息一樣要顯示在 `ai-action-summary`。
- `sceneSnapshot === null`(從未按過下一步)時,`step` 不可能是 `"preview"` 且同時渲染 preview 版面(見既有 `step === "preview" && sceneSnapshot` guard)—— 此時 AiPanel 仍應正常掛載於 edit 步驟版面,不受影響。
- 面板在 preview 步驟展開時的寬度(`w-80`/`xl:w-96`,`AiPanel.tsx:343`)與 3D Canvas 固定寬高(`VenueScene.tsx:324`,`h-[480px] w-full`)並列 — 需確認整體版面不因為新增一個常駐右側欄而在較窄視窗下造成水平溢出(比照 edit 步驟現有 `editorColumnRef` 量測 wrapper 寬度、非最外層容器的既有作法,見 `PlanEditor.tsx:158-161` 註解)。

## Error States

- `/api/ai/chat` 於 preview 步驟回傳非 200(402 點數不足 / 401 未登入 / 其他 generic 錯誤):現有 `AiPanel` 錯誤處理(`error` state,`ai-error` testid)邏輯不變,preview 步驟下同樣顯示,不因掛載點改變而需要新增分支。
- preview 步驟下 AI 回傳的 tool call 更新幾何後,若使用者尚未回到 edit 步驟即重新整理頁面/離開:比照現況(無 preview 步驟自動存檔機制),AI 在 preview 造成的變更視同任何未存檔的手動編輯,遺失屬既有預期行為,非本任務需新增的保護範圍(存檔仍是 Task 3 既有「我的存檔」手動存檔流程)。

## Out of Scope

- 不新增/修改任何 `/api/ai/*` 後端路由或 `src/lib/ai/` 系統提示、工具 schema(`src/lib/ai/system.ts`、`src/lib/ai/tools.ts` 目前的未提交變更屬於另案範圍,與本任務無關,不在本任務改動範圍內)。
- 不改變「需先點下一步產生 `sceneSnapshot` 才能看到 3D 預覽」的既有流程門檻。
- 不新增 preview 步驟下的存檔/自動存檔機制 — 沿用既有「我的存檔」手動存檔按鈕(僅存在於 edit 步驟版面)。
- 不改變 `AiPanel` 既有的清空對話 / 100 輪提示 / 圖片上傳 / 點數餘額顯示等既有行為的規格,僅要求這些行為在常駐掛載後於兩個步驟下都繼續正常運作。
- 不處理 `VenueScene.tsx` 內與本任務資料流無關的既有已知限制(例如場景內部沒有自己的 undo/redo)。

## Assumptions Made

- **A1**:AiPanel 提升掛載點時,沿用其現有的內部收合邏輯(`open` state 控制渲染 toggle 按鈕 vs 完整側欄),不另外設計新的顯示/隱藏機制。
- **A2**:preview 步驟版面採「3D 場景(含自身 sidebar+canvas)在左、AiPanel 在右」,與 edit 步驟「2D 畫布在左、AiPanel 在右」視覺上一致,維持使用者心智模型連貫,而非把 AiPanel 疊加在 3D 場景上方或改成其他版位。
- **A3**:「即時反映 3D」的驗收標準以 `venue-scene` 上既有的 `data-wall-mesh-count`/`data-column-mesh-count`/`data-furniture-mesh-count` 等 data attribute 變化來驗證(既有 Playwright 慣例,3D `<canvas>` 對 Playwright 不透明,見 `venue-3d-scene.spec.ts` 開頭註解),不要求逐 pixel 或 WebGL 內容驗證。
- **A4**:資料流的具體修法(例如是否讓 `VenueScene` local state 隨 props 用 `useEffect` 同步、或改用 `key` 強制 remount、或把幾何 state 進一步上提、或讓 preview 步驟改為純 controlled component 不再自己持有 local state)屬架構決策,留給 architect 定案;本文件僅鎖定功能性行為(AI 改動需立即可見、與使用者手動 3D 編輯不互相覆蓋、離開 preview 後資料不遺失)。
- **A5**:`conversationSeed`/`planId`/`slot` 的既有語意(見 `PlanEditor.tsx:219-222`, `330-345`)不變,本任務不修改讀檔續聊的資料結構,只確保其在新版面下依然正確運作。

## Security Notes

- 本任務純前端版面/state 生命週期重構,不涉及新的資料輸入、權限或後端呼叫,無新增安全性疑慮。
- 需留意:preview 步驟下如果幾何資料流修法不慎導致 `applyActions` 被重複呼叫或套用到錯誤的目標 state,可能造成資料一致性問題(不是資訊安全問題,但屬於資料正確性風險),已在「Edge Cases」與「關鍵資料流」段落標出,architect 需明確定案避免 race condition。
