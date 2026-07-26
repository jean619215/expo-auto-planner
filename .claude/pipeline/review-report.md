# Code Review Report — 步驟 03 骨架 + 唯讀 RefinedScene
> Generated: 2026-07-26T02:05+08:00 | Review iteration: 1 | Story: 精密 3D 場景 (步驟 03) — task 1

## Overall Assessment

**APPROVED WITH MINOR FIXES**

## Summary

實作忠實對應 architect-plan 的 15 個 Implementation Steps,四項硬性架構約束(D1 單一資料源、D2 互斥掛載、D3 AiPanel 常駐、D4 共用地板 geometry)全部成立且經逐行查核。`npx tsc --noEmit` 與 `npm run lint` 皆通過。無 🔴 Critical。兩項 🟡 集中在 Playwright 測試的**斷言強度**而非產品程式碼 —— 其中「凹多邊形」fixture 我已直接修正,另一項(AC3 拖曳路徑)留給 developer/QA 判斷。

---

## 🔴 Critical Issues (Must Fix — Pipeline Paused)

無。

---

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — 「凹多邊形」edge case fixture 其實不是凹多邊形 ✅ 已由 reviewer 修正

- **File**: `playwright-tests/venue-refined-3d.spec.ts:323`
- **Issue**: 沿用 `venue-3d-scene.spec.ts:139` 的 `dragVertexTo(1, { x: 24, y: 24 })`。`DEFAULT_FLOOR` 為 `(20,20)(30,20)(30,30)(20,30)`,把 vertex 1 拖到 (24,24) 得 `(20,20)(24,24)(30,30)(20,30)` —— 前三點全部落在 `y = x` 上(cross product = 0),是**退化的凸多邊形**,四個轉角的 cross product 皆 ≥ 0。因此完全沒有觸發 `ExtrudeGeometry` 對凹多邊形的 earcut 三角化路徑,orchestrator edge case 4 實質未被覆蓋。
- **Suggested fix**: 改拖 vertex 2 → `(20,20)(30,20)(24,24)(20,30)`,在 C 點為 reflex angle,是真正的凹多邊形。
- **Resolution**: 已套用(含說明註解),`tsc` + `lint` 重跑通過。此改動只影響 fixture 形狀,原有斷言(`vertexCount() === 4`、02/03 vertex count 相等、無 pageerror)語意不變。

### Issue 2 — AC3 的「手動**拖曳**移動家具」路徑未被測到

- **File**: `playwright-tests/venue-refined-3d.spec.ts:110-134`
- **Issue**: AC3 明文是「在步驟 02 手動**拖曳移動**了一件家具」。測試改以「側欄放置家具」(`placeFurnitureOnStep2`)替代,spec 檔頭已誠實說明理由(TransformControls gizmo 拖曳在本專案無既有測試先例)。但這兩條在 `VenueScene` 內是**不同的 handler**:放置走 `handleFloorClick`(`VenueScene.tsx:182-196`),拖曳走 `commitTransform`(`:144-180`)。兩者最終都呼叫 `onSceneChange`,所以 D1 的保證仍成立,但 `commitTransform` → 頂層 state → 步驟 03 這條線沒有任何自動化覆蓋。
- **Suggested fix**: 二擇一 —(a) 補一個以 `page.mouse` 拖曳 TransformControls gizmo 的案例(需先在 02 點選家具使 gizmo 出現);或(b) 由 QA 階段以手動檢查表補上這一條並在 qa-report.md 記錄。若採 (b),請在 spec 檔頭註解明確標註「AC3 的拖曳變體由 QA 手動驗證」,避免日後誤以為已自動化。

---

## 💡 Suggestions (Consider — No Action Required)

1. **`floorGeometry.ts` 未加 `"use client"`** (`src/components/venue/floorGeometry.ts:1`)。目前只被兩支 `"use client"` 元件 import,所以 `three` 不會漏進 server bundle。但這是全專案唯一一個 import Three 卻沒有 client 邊界標記的檔案;加上 `"use client"` 可讓 AGENTS.md「瀏覽器限定函式庫不可被 server component import」的守則變成編譯期保證,而非仰賴呼叫端自律。

2. **StrictMode 下 `useFloorGeometry` 的 dispose 會早一步觸發** (`floorGeometry.ts:25-27`)。dev 的 StrictMode double-invoke 會 mount → cleanup(`geometry.dispose()`)→ mount,但 `useMemo` 不重跑,於是 mesh 仍持有已 dispose 的 geometry。實務上無害:`BufferGeometry.dispose()` 只釋放 GPU buffer,attribute 資料仍在 JS 端,下一幀 `WebGLGeometries.get()` 會重新上傳。僅 dev、且自我修復,不需改。若日後想根絕,可改成把 geometry 收進 `useRef` 並在 cleanup 內同時清 ref。

3. **`data-readonly="true"` / `data-orbit-controls="true"` 是寫死字面值** (`RefinedScene.tsx:55-56`),所以 `venue-refined-3d.spec.ts:174/210` 的斷言即使 `<OrbitControls>` 被整段刪掉也會通過。這沿用了 `VenueScene.tsx:206` 的既有慣例,不算退化;真正的行為驗證來自同一測試裡「拖曳後 `data-furniture` 不變 + 無 pageerror」。留作日後測試強化的方向。

4. **02/03 `data-floor-vertex-count` 相等是恆真式**(兩邊都是同一個 `polygon.length`),無法偵測三角化差異。D4 的共用 `useFloorGeometry` 才是真正的保證,這點 architect-plan 已言明;測試只是佐證不是證明。可接受。

5. **02 與 03 的 canvas aspect ratio 不同**(03 少了 `venue-sidebar` 與 AI 面板,高度同為 480px)。`fov: 50` 是垂直 FOV,所以 03 只是水平看到更多,無變形。符合 edge case「不變形、不水平溢出」。

---

## 逐項架構驗證(reviewer 檢查點)

### D1 — 單一資料源 ✅

- `RefinedScene.tsx` 全檔 **零 `useState` / `useReducer` / `useRef`**,無任何幾何複本。props 介面為唯讀 `{ polygon, walls, columns, furniture, venueSizeM?, viewFitSizeM? }`,**無 `onSceneChange`**。
- `PlanEditor.tsx:1581-1600` 傳給 `RefinedSceneLoader` 的 6 個 prop 與 `:1550-1578` 傳給 `VenueSceneLoader` 的**逐字相同**(`polygon` / `walls` / `columns` / `furniture` / `venueSizeM={PLAN_AREA_SIZE_M}` / `viewFitSizeM={VENUE_SIZE_M}`),差別僅在 03 少了 `onSceneChange` 與 `key={generation}` —— 正是 D1/D2 要求的。
- `RefinedSceneLoader.tsx` 純透傳,無中間層轉換。
- 未出現任何 `refinedSnapshot` / 第四份 state。

### D2 — 互斥掛載 ✅

- `PlanEditor.tsx:968 / 1550 / 1581` 三個 `step === "..."` 區塊互斥,同一時間只有一個 `<Canvas>`。
- `handleToRefined` / `handleBackToPreview`(`:475-481`)只做 `setStep`,**未動** `generation`、`sceneGenerated` 或任何幾何 state。
- `RefinedSceneLoader` 未加 `key`,`VenueSceneLoader` 的 `key={generation}` 未動。
- 全檔 `step` 分支盤點(`:226 / 968 / 1550 / 1581 / 1605-1607`)無遺漏:`:226` 的 stage 量測 effect 已是 `step !== "edit"` early-return,新增第三步不影響。

### D3 — AiPanel 常駐掛載 ✅(重點查核)

- Wrapper `[data-testid="ai-panel-slot"]`(`PlanEditor.tsx:1603-1616`)在**三個步驟下都存在**,位置固定為 `<div className="flex items-start gap-4">`(`:966`)的第二個子節點 —— 與 commit `97d548c` 的位置一致,只是多了一層恆存在的包裝。React 對「同位置、同 element type、僅 className/attribute 改變」不會 unmount ⇒ `turns / input / imageDraft / open / pendingToolResults` 全數保留。
- **無** `{step !== "refined" && <AiPanel/>}` 之類的條件渲染;`AiPanel` 的 5 個 prop 一字未改;`AiPanel.tsx` 零修改(`git status` 佐證)。
- `contents` / `hidden` 切換正確:`AiPanel` 兩個 return 分支(`:325` 收合態 `<div className="shrink-0">`、`:340` 展開態 `<div data-testid="ai-panel" className="flex w-80 shrink-0 ...">`)都是**單一根 div**,`display: contents` 不產生 box ⇒ 該 div 仍是外層 flex row 的直接 flex item,`gap-4` 照常生效,01/02 版面逐像素不變。03 下 `hidden`(`display:none`)使收合態 toggle 也一併消失,對應 AC6。
- `inert={step === "refined"}`:React 19.2.4(`package.json:25`)原生支援 boolean `inert`,`false` 時屬性被省略而非渲染成 `inert="false"`。**這點很關鍵** —— 若是 React 18,`inert={false}` 會渲染 `inert="false"`(HTML 中為 truthy),整個 AI 面板會在 01/02 被停用。目前版本安全,但這是升降版時的隱藏地雷,值得記在 PR 說明裡。
- `AiPanel.tsx` 內無 `scrollHeight` / `getBoundingClientRect` / `scrollIntoView` / `focus()` 之類的版面量測(已 grep 確認),所以 `display:none` 期間不會算出 0 高度而錯位。

### D4 — 地板三角化一致 ✅

- `floorGeometry.ts:14-23` 的 `useMemo` 內容與被刪掉的 `VenueScene.tsx` 原版**逐字相同**(`THREE.Shape` → `moveTo` → `slice(1).forEach(lineTo)` → `closePath` → `ExtrudeGeometry({ depth: FLOOR_THICKNESS_M, bevelEnabled: false })`),依賴陣列同為 `[polygon]`。
- `VenueScene.tsx` 與 `RefinedScene.tsx` 的 `FloorMesh` **呼叫同一個 hook**,不是複製貼上 ⇒ 兩步驟不可能分岔。
- `FLOOR_THICKNESS_M` 已從 `VenueScene.tsx:49` 移除、改由共用模組匯出,無重複定義(`tsc` 通過即證明 `VenueScene` 內無其他遺留引用)。
- `VenueScene.tsx` 的改動僅 3 處:移除 `useMemo` import、移除本地常數、`FloorMesh` 換 hook。`onClick` / mesh JSX / 全部 `data-*` 屬性零改動 ⇒ 行為等價重構,符合 plan step 2 的「其餘全檔不得有任何其他改動」。

### Three.js 資源生命週期 ✅

- `useFloorGeometry` 以 `useMemo` 快取(不在 render 期間重複 new),並以 `useEffect` cleanup `dispose()` —— 符合 AGENTS.md Developer 規則。
- **額外修好一個既有洩漏**:`VenueScene` 原本的 `FloorMesh` geometry **從未 dispose**,重構後 02 也拿到了 dispose。這是本次的淨改善。
- dispose 時序正確:`polygon` identity 改變時,render 產生新 geometry → commit → 舊 effect cleanup dispose 舊 geometry(此時舊 geometry 已不被 mesh 引用)。
- 牆/柱/家具用 JSX `<boxGeometry>` / `<meshStandardMaterial>`,由 R3F 於卸載時自動 dispose,無需手動處理(與 plan D4 一致)。
- `<Canvas>` 於 03 卸載時由 R3F 釋放 renderer 與 WebGL context;因 D2 互斥掛載,任一時刻只有一個 context。

### 範圍紀律 ✅

- `RefinedScene.tsx` 打光僅 `ambientLight intensity={0.6}` + `directionalLight position={[25,40,25]} intensity={0.8}` —— 與 `VenueScene` 現況**完全相同**。
- **無** `castShadow` / `receiveShadow` / `shadows` prop / `toneMapping` / `<Environment>` / 貼圖 / `useTexture` / 參數化家具幾何。全部家具仍是 `<boxGeometry args={[item.w, defaults.height3d, item.h]} />` + `meshStandardMaterial color={defaults.color}`。
- **無** `TransformControls` / `selectedId` / `placingKind` / `sidebarOpen` / `<aside>` / `furniture-place-*` / `reset-view-button`。
- 唯一的樣式外溢:`StepProgress` 的 `max-w-md` → `max-w-xl`(`PlanEditor.tsx:120`)—— 由 plan step 6 明文授權(容納第三項不換行),純樣式,無邏輯影響。

---

## Security Assessment

- Secrets scan: **PASS** — 新增 4 檔零硬編碼憑證;spec 用 `page.route` mock `/api/ai/chat` 與 `/api/ai/config`,不打真實 API、不花點數,測試帳號仍走 `.env.playwright.local`。
- Input validation: **N/A** — 本任務未新增/修改任何 API 呼叫或系統邊界輸入。
- Auth/authz: **N/A** — 未新增 page route,`src/proxy.ts` 未動(`git status` 佐證)。與 auth / session / `DATABASE_URL` 零接觸,不觸發 AGENTS.md「PR Reviewer 自動 Critical」條款。
- Server-only 邊界: **PASS** — 未 import `admin.ts`;未觸及 `src/lib/ai/`;`src/lib/venue/*` 維持零 React/DOM/Konva/Three import(新 Three 程式碼全部落在 `src/components/venue/`)。
- 敏感資料 log: **PASS** — 新增程式碼無任何 `console.*`。
- Test coverage: 12 個 Playwright 案例,對應 10 條 AC + 5 個 edge case(AC3 的拖曳變體見 Issue 2)。

---

## Plan Compliance

- [x] 全部 15 個 Implementation Steps 均已實作(step 11 `tsc`/`lint` 已由 reviewer 重跑驗證;step 12 手動 smoke 與 step 15 迴歸屬 QA/Playwright 階段)
- [x] 實作與 plan 意圖一致(D0–D5 逐項成立,見上方查核)
- [x] 無未授權的範圍擴張 —— 修改檔案與 plan 的 Files to Create / Files to Modify 表**完全吻合**
- [x] plan 標示「不修改」的檔案確實未動:`AiPanel.tsx`、`VenueSceneLoader.tsx`、`src/lib/venue/*`、`src/app/api/*`、`src/proxy.ts`、`PlanSlotsDialog.tsx`
- [x] 既有 8 支迴歸 spec 零改動(`git status` 僅顯示 `PlanEditorPage.ts` 一支 page object 有變更,且為純新增 + `currentStep()` 回傳型別擴張,不影響既有呼叫端)
- [x] 無 TODO / 註解掉的程式碼 / debug log

**範圍外備註**(不計入本次 review 的 finding):working tree 另含 `AGENTS.md`、`.claude/pipeline/project-doc.md`、`stories/venue-refined-3d.md` 的改動,那些來自本 story 的 scan / orchestrate 階段,不屬 task 1 的實作 diff。`AGENTS.md` 的 delta 標註為 2026-07-26「場地規劃器補件」,依 AGENTS.md 自身規則需人工確認 —— 提醒在 commit 前確認該確認已完成。

---

## Conversation Log

| Issue | Developer Response | Resolution |
|---|---|---|
| Issue 1 — 凹多邊形 fixture 實為共線退化多邊形 | (reviewer 直接處理) | ✅ 已由 reviewer 修正為 `dragVertexTo(2, {x:24,y:24})` 並加註解;`tsc` + `lint` 重跑通過 |
| Issue 2 — AC3 拖曳路徑未自動化 | 待 developer / QA 決定 (a) 補 gizmo 拖曳測試 或 (b) QA 手動檢查表覆蓋 | 🟡 未阻擋,轉交 QA 階段 |
| 💡 1–5 | — | 僅記錄,不採取行動 |
