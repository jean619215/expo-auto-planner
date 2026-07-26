# Orchestrator Output — 步驟 03 骨架
> Story: 精密 3D 場景 (步驟 03) | Generated: 2026-07-26T00:20+08:00

## Task Type
FRONTEND

## Refined Requirement

目前場地 wizard 只有兩步(`WizardStep = "edit" | "preview"`,`src/components/venue/PlanEditor.tsx:76`;`WIZARD_STEPS` 陣列 `PlanEditor.tsx:107-110`)。本任務新增第三步「03 精密 3D」的**結構骨架**,建立一個唯讀的 `RefinedScene` 元件位置,**本任務先沿用現有 box 幾何與現有打光**(材質、陰影、參數化家具幾何分別是 story 後續 task 2–4 的範圍,本任務不做)。

本任務要求:

1. **步驟型別與進度列**:`WizardStep` 加入第三個值,`WIZARD_STEPS` 加入「03 精密 3D」項目。兩者必須同步更新(見 AGENTS.md Modularity 規則)。進度列在三步驟下皆正確標示目前位置。

2. **導覽**:步驟 02 的「下一步」直接進入步驟 03(使用者已定案:**不另設「產生精密 3D」按鈕**);步驟 03 提供「上一步」回到 02。步驟 03 沒有再下一步。

3. **唯讀 `RefinedScene` 元件**:新建元件(含 `next/dynamic` `ssr:false` loader 包裝,比照 `VenueSceneLoader.tsx`)渲染 3D 場景,但**唯讀**:
   - 不掛 `TransformControls`、不做點擊選取、不提供家具工具列側欄、不觸發任何 `onSceneChange` 類回寫。
   - 保留 `OrbitControls`(旋轉/縮放/平移視角)。
   - 本任務的幾何/材質/打光可直接沿用 `VenueScene.tsx` 現有作法(多邊形 `ExtrudeGeometry` 地板 + box 牆/柱/家具 + `ambientLight` + `directionalLight`),視覺升級留給後續 task。

4. **資料來源(本任務主要技術約束)**:
   - 步驟 03 顯示的內容必須與**使用者剛才在步驟 02 看到的**完全一致,包含使用者在 3D 內手動拖曳/旋轉後的結果。
   - **修正(2026-07-26,architect 階段查證)**:本節原先描述的「三層 state」問題**已不存在**,該描述來自過期的探查結果。現況為:`sceneSnapshot` 已簡化為 `sceneGenerated: boolean` 純 gate(`PlanEditor.tsx:208`);`VenueScene` 已完全受控,不再持有 `localWalls/localColumns/localFurniture`(僅剩 `selectedId`/`transformMode`/`placingKind`/`sidebarOpen` 等 UI state),手動編輯經 `onSceneChange` 直接寫回 `PlanEditor` 頂層 state(`PlanEditor.tsx:456-467`,含 ref 同步)。
   - 因此步驟 03 直接讀取與步驟 02 相同的頂層 props(`polygon`/`walls`/`columns`/`furniture`)即為最新資料,02→03→02 往返的正確性由「單一資料來源」保證,不需額外同步機制。
   - 步驟 03 為唯讀:**不得持有任何幾何 useState**,不得反向寫回任何幾何 state。

5. **AI 面板**:使用者已定案步驟 03 **不顯示** AI 側欄。但 `AiPanel` 是上一個 story 剛完成的「跨步驟常駐掛載」架構(commit `97d548c`,節點恆在 React tree 同一位置以避免 unmount 丟失對話)。因此步驟 03 必須以 **CSS/樣式隱藏**,**不可**把 `AiPanel` 從 tree 移除或改變其掛載位置 —— 否則會退化上一個 story 的成果(進 03 再回 02,對話與草稿輸入會消失)。

6. **存檔**:步驟 03 不提供存檔入口(使用者已定案)。步驟 03 不產生任何需要持久化的新資料 —— 材質與幾何都由 plan 推導而來,`PlanSnapshot` 結構與 `/api/plans/*` 一律不動。

7. **既有行為不得退化**:步驟 01 的 2D 編輯(含 zoom/pan)、步驟 02 的白模預覽與 3D 內手動編輯、AI 面板常駐與 tool call 套用,全部維持現況。

## Clarified Acceptance Criteria

- [ ] Given 使用者在步驟 02(已產生 3D 場景),when 點擊「下一步」,then 進入步驟 03,畫面顯示 3D 場景且進度列標示第三步為目前步驟。
- [ ] Given 使用者在步驟 03,when 點擊「上一步」,then 回到步驟 02,且步驟 02 的 3D 場景內容與離開前一致(未被重置為更早的版本)。
- [ ] Given 使用者在步驟 02 手動拖曳移動了一件家具,when 進入步驟 03,then 步驟 03 顯示的該家具位置為手動調整後的位置(非進入 02 當下的原始位置)。
- [ ] Given 步驟 03,when 使用者點擊場景中的任一物件,then 不會出現選取高亮、不會出現 TransformControls 拖曳把手,物件不可被移動或旋轉。
- [ ] Given 步驟 03,when 使用者以滑鼠拖曳/滾輪操作視角,then 可正常旋轉、縮放、平移相機。
- [ ] Given 步驟 03,then 畫面上不顯示 AI 側欄(含收合狀態的 toggle 按鈕)。
- [ ] Given 使用者在步驟 02 與 AI 對話過(至少一輪),when 進入步驟 03 再返回步驟 02,then AI 面板對話歷史與未送出的輸入框內容完整保留(驗證常駐掛載未被破壞)。
- [ ] Given 步驟 03,then 不顯示存檔/讀取入口。
- [ ] Given 尚未產生 3D 場景(`sceneSnapshot === null`,從未進入過步驟 02),then 無法直接抵達步驟 03(維持既有「需先產生 scene」的 gate 精神)。
- [ ] Given 步驟 01 與 02,then 既有行為(2D 編輯 zoom/pan、白模預覽、3D 手動編輯、AI tool call 套用即時反映)全部不變。

## Edge Cases to Handle

- **往返資料倒退**:02 → 03 → 02 → 03 多次往返,且每次在 02 都手動調整過物件 —— 每次進入 03 都要顯示當下最新結果,不可出現「第二次進 03 看到第一次的舊快照」。`VenueScene` local state 無 props 重新同步機制(`VenueScene.tsx`),同樣的坑不可在 03 重演。
- **AI 在步驟 02 送出指令後立刻切到 03**:回應到達時 `applyActions` 仍套用到正確的最新幾何 state;03 為唯讀不參與寫入,但若使用者接著返回 02,必須看到該 AI 變更已套用。
- **空場景**:場地只有地板多邊形、沒有任何牆/柱/家具時,步驟 03 仍應正常渲染(只有地板),不可 crash 或空白。
- **不規則凹多邊形地板**:`ExtrudeGeometry` 對凹多邊形的處理沿用 02 現有作法,03 不得引入新的三角化行為差異導致兩步驟地板形狀不一致。
- **版面寬度**:步驟 03 隱藏 AI 側欄後,3D Canvas 可用寬度與 02 不同 —— 需確認 canvas 尺寸/相機 aspect 正確,不出現變形或水平溢出。
- **資源釋放**:步驟 03 卸載時(返回 02)需釋放自身建立的 Three.js 資源,避免往返累積 GPU 洩漏(AGENTS.md Developer 規則)。本任務沿用既有 box 幾何,量體不大,但慣例要從骨架就建立。

## Error States

- 本任務不新增任何 API 呼叫,無網路錯誤狀態需處理。
- 若 `sceneSnapshot` 為 null 而步驟狀態意外被設為第三步,應比照既有 `step === "preview" && sceneSnapshot` guard 的防禦精神,不渲染 3D 而非拋錯白畫面。
