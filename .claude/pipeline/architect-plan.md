# Architect Plan — 步驟 03 骨架 + 唯讀 RefinedScene

> Story: 精密 3D 場景 (步驟 03) | Task type: FRONTEND | Generated: 2026-07-26T01:10+08:00

## Overview

`WizardStep` 由兩步擴為三步(`"edit" | "preview" | "refined"`),步驟 03 掛載一個**唯讀**的 `RefinedScene`(經 `RefinedSceneLoader` 的 `ssr:false` 包裝),幾何資料**直接讀 `PlanEditor` 頂層 state**(與步驟 02 完全同一份 props)。步驟 03 不新增任何 state、不回寫任何幾何;`AiPanel` 以 CSS(`hidden` / `display:contents` 包裝層)隱藏而非卸載,維持 commit `97d548c` 的常駐掛載成果。

## Task Type Confirmed

FRONTEND — 純前端步驟結構 + 新元件,無 API / schema / auth 變更。與 orchestrator-output.md 一致,無矛盾。

## Escalation Check

- 外部 API contract 變更:無(不動 `/api/plans/*`、`/api/ai/*`)。
- DB schema / 既有資料:無(`PlanSnapshot` 不變,03 不產生需持久化資料)。
- Auth / security model:無。
- 複雜度:2 個新檔 + 1 支既有檔改動 + 測試,在 task 範圍內。
- 資訊充分性:足夠,惟需修正 orchestrator 的一項過時前提(見 D0)。
- **結論:不需 escalation。** D0 是事實澄清而非範圍變更,不阻擋實作。

---

## 架構決策

### D0 —(先修正前提)orchestrator 描述的「三層 state」在目前 codebase 已不存在

orchestrator-output.md 第 24 行描述的三層資料流是**上一個 task 動工前的狀態**。上一個 task(commit `97d548c` 及其前置 commit)已依 architect-plan D1 完成收斂,實際現況經逐行查核:

- `PlanEditor.tsx:208` — `sceneSnapshot` 幾何複本**已刪除**,只剩 `const [sceneGenerated, setSceneGenerated] = useState(false)` 純 boolean gate(註解見 `PlanEditor.tsx:205-207`)。
- `VenueScene.tsx` — **已無** `localWalls/localColumns/localFurniture`。`VenueScene` 是 fully controlled:mesh 一律讀 props(`VenueScene.tsx:340/370/389`),`data-*-mesh-count` 讀 props(`:217-219`),`commitTransform`(`:144-180`)與 `handleFloorClick`(`:182-196`)只計算 next 陣列並呼叫 `onSceneChange`,不寫 local state。
- `PlanEditor.tsx:456-467` `handleSceneChange` 直接 `setWalls/setColumns/setFurniture` 並 eager 同步 `wallsRef/columnsRef/furnitureRef`。
- `PlanEditor.tsx:1551-1560` `VenueSceneLoader` 的幾何 props 已改傳頂層 state,不再是 snapshot。

**結論:目前只有一層幾何資料源** = `PlanEditor` 頂層 `polygon / walls / columns / furniture`(+ 對應 `*Ref` 供 `applyActions` 跨 await 讀取)。orchestrator 擔心的「03 吃 (a) 會遺失 3D 手動調整」在現況下**不成立** —— 3D 手動調整正是寫進 (a)。實作者**不得**依 orchestrator 的舊描述去找 `sceneSnapshot` 或 `localWalls`,那些識別字已不存在。

### D1 — 資料來源定案(本任務最重要的決策)

**步驟 03 讀取 `PlanEditor` 頂層 state,與步驟 02 傳給 `VenueSceneLoader` 的是同一組值(`polygon / walls / columns / furniture`),一字不差。**

為何這樣就能滿足全部驗收:

| 需求 | 為何自動成立 |
| --- | --- |
| 03 內容 == 使用者剛在 02 看到的 | 02 的 `VenueScene` 本身就是 controlled、直接畫頂層 state;03 讀同一份 ⇒ 兩者渲染的是同一組數值 |
| 含 02 內手動拖曳/旋轉/放置的結果 | 手動操作 → `onSceneChange` → `handleSceneChange` → 頂層 state(`PlanEditor.tsx:461-463`) |
| 02→03→02 多次往返不倒退 | 沒有第二份副本可倒退;每次進 03 都是讀當下最新 state |
| AI 在 02 送出後切到 03,回應才到 | `applyActions` 讀 `*Ref` → 寫頂層 state → 03 正在讀該 state,畫面即時更新;回 02 亦已套用 |

**硬性約束(reviewer 檢查點)**:
- `RefinedScene` **不得**有任何 `useState` 存放 `walls/columns/furniture/polygon` 或其衍生複本(不可重演 `VenueScene` 舊版 `useState(props)` 無 resync 的坑)。允許的 local state 僅限純視覺/UI(本任務其實一個都不需要)。
- `RefinedScene` **不得**有 `onSceneChange` 之類的回寫 prop。props 介面為唯讀:`{ polygon, walls, columns, furniture, venueSizeM?, viewFitSizeM? }`。
- 幾何以 `useMemo` 快取、依賴陣列為對應 props;非 R3F 自動管理的 geometry 需在卸載時 `dispose()`(AGENTS.md Developer 規則)。

**被否決的替代方案**:

1. **在進入 03 時 snapshot 一份 `refinedSnapshot` state**(第四份 state)—— 否決。這正是上一個 task 花整支 plan 刪掉的反模式:多資料源 + 需要 resync 機制,02→03→02→03 往返必然出現「第二次進 03 看到第一次的舊快照」(orchestrator edge case 1)。orchestrator 第 26 行也明文禁止新增第四份 state。
2. **從 `VenueScene` 內部拉取「目前 3D 狀態」**(ref / imperative handle)—— 否決。`VenueScene` 已無內部幾何狀態可拉;硬做等於重新引入雙向耦合,且 02 卸載後 ref 失效。
3. **共用同一個 `<Canvas>`,以 mode prop 在 02/03 間切換**(合併步驟)—— 否決。story「說明」段已定調 02/03 分開,理由為互動延遲與資源載入策略不同;後續 task 3 的貼圖 lazy load 需要「02 完全不載入」的乾淨邊界。
4. **把 03 的資料源改成 `getSnapshot()`/`PlanSnapshot`** —— 否決。`getSnapshot` 是存檔序列化路徑,經過型別窄化與存檔語意,拿它當渲染資料源會讓 03 與 02 的資料形狀分岔,且未存檔的變更語意不明。

### D2 — 02 ↔ 03 的掛載/卸載策略:互斥掛載,一次只有一個 WebGL context

`step === "preview"` 與 `step === "refined"` 為互斥的條件渲染區塊(比照現有 `step === "edit"` / `"preview"` 的寫法,`PlanEditor.tsx:958/1540`)。進入 03 時 `VenueScene` 卸載、`RefinedScene` 掛載;返回 02 反之。

理由:
- 瀏覽器 WebGL context 數量有上限,兩個 `<Canvas>` 同時掛載(即使一個 `display:none`)會多佔一個 context 且持續 rAF 迴圈,違背 AGENTS.md「明確界定在哪個步驟載入/釋放」,也與 task 3 的貼圖記憶體策略衝突。
- 卸載即釋放,天然滿足 edge case「資源釋放」。

**已知取捨(必須讓 QA 知悉)**:返回 02 時 `VenueScene` 重新掛載,`OrbitControls` 相機視角與 3D 內的選取狀態會**重置為預設**。驗收條件只要求「步驟 02 的 3D 場景**內容**與離開前一致(未被重置為更早的版本)」—— 內容(幾何)來自頂層 state,完全一致;相機/選取屬於視圖狀態,不在驗收範圍。此取捨換得 GPU 資源乾淨釋放,列入 Risks 與 PR 說明。

注意:`VenueSceneLoader` 帶 `key={generation}`(`PlanEditor.tsx:1552`)。**不要**在 `handleBackToPreview` 內遞增 `generation` —— 遞增與否都會重新掛載(條件渲染),但遞增會讓 `data-generation` 語意(= 按過幾次「下一步」)失真並可能影響既有測試。`RefinedScene` **不加 key**。

### D3 — AiPanel 在步驟 03:CSS 隱藏,掛載位置一字不動

`AiPanel`(`PlanEditor.tsx:1564-1570`)目前是 flex row 的第二個子節點。步驟 03 不可把它從 tree 移除或搬家,否則退化上一個 story。

定案做法:**永久**插入一層 wrapper(三個步驟下都存在、位置固定),只切換 wrapper 的 class:

```
<div
  data-testid="ai-panel-slot"
  data-hidden={step === "refined"}
  inert={step === "refined"}
  className={step === "refined" ? "hidden" : "contents"}
>
  <AiPanel ...props 完全不變... />
</div>
```

- `display: contents`(Tailwind `contents`)讓 wrapper 在 01/02 下不產生 box,`AiPanel` 仍是外層 flex row 的直接 flex item ⇒ **01/02 版面逐像素不變**,既有 `ai-panel.spec.ts` / `ai-panel-persistent.spec.ts` 不需改。
- `hidden`(`display: none`)在 03 隱藏整個面板(含收合態的 `ai-panel-toggle`,`AiPanel.tsx:326-330`)。Playwright `toBeVisible()` 即為 false,直接對應驗收條件。
- React 對「同一位置、同一元素型別、class 改變」不會 unmount ⇒ `turns / input / imageDraft / open / pendingToolResults` 全數保留。
- `inert`(React 19.2 原生支援 boolean 屬性)阻止 03 下鍵盤 focus 進入隱藏面板;若 lint/型別有阻礙,退回 `aria-hidden="true"` 並在 PR 註明。

**被否決**:`{step !== "refined" && <AiPanel/>}` —— 直接 unmount,對話全失,明文禁止。
**被否決**:把 `AiPanel` 移進各步驟區塊內 —— 改變掛載位置,同樣 unmount。

### D4 — 地板三角化一致性:抽共用 geometry builder

edge case「不規則凹多邊形地板…03 不得引入新的三角化行為差異」。最可靠的保證是**兩步驟用同一段程式產生 `ExtrudeGeometry`**,而非複製貼上。

`src/lib/venue/` 是純領域模組,**禁止 import Three**(AGENTS.md Modularity),因此共用點放在 component 層:新增 `src/components/venue/floorGeometry.ts`,匯出 `useFloorGeometry(polygon)`(`useMemo` 建 `THREE.Shape` + `ExtrudeGeometry`,並以 `useEffect` cleanup `dispose()`),以及常數 `FLOOR_THICKNESS_M`。`VenueScene` 的 `FloorMesh`(`VenueScene.tsx:83-106`)改用此 hook(行為等價,額外修掉一個既有的 geometry 未 dispose 洩漏),`RefinedScene` 亦用之。

牆/柱/家具的 box 幾何由 R3F 的 `<boxGeometry>` JSX 建立,R3F 會在卸載時自動 dispose,**不需**手動處理,也**不抽共用** —— 後續 task 2–4 會整批替換 03 的材質與家具幾何,現在抽共用只會在 task 4 被拆掉。此為刻意的重複,記於 Architecture Notes。

### D5 — 導覽與 testid 命名

- 步驟 02 新增「下一步」按鈕:`data-testid="to-refined-button"`。**不重用** `next-step-button` —— 該 id 目前唯一存在於 step-edit(`PlanEditor.tsx:1030`),`PlanEditorPage.nextStepButton` 直接以它定位,重用會在 preview 下造成語意混淆與潛在重複匹配。
- 步驟 03「上一步」:`data-testid="back-to-preview-button"`(既有 `back-to-edit-button` 留在 02 不動)。
- 步驟 03 沒有再下一步、沒有存檔入口(`plan-slots-button` 僅存在於 step-edit,天然滿足)。

---

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/components/venue/RefinedScene.tsx` | 唯讀 3D 場景:`<Canvas>` + `OrbitControls` + 現有 box 幾何/打光。無 `TransformControls`、無 onClick 選取、無側欄、無回寫 callback |
| `src/components/venue/RefinedSceneLoader.tsx` | `next/dynamic` `ssr:false` 包裝(比照 `VenueSceneLoader.tsx:7-14`,含 `loading` 佔位),Three 不進 server bundle |
| `src/components/venue/floorGeometry.ts` | 共用 `useFloorGeometry(polygon)` + `FLOOR_THICKNESS_M`,保證 02/03 地板三角化完全一致(D4) |
| `playwright-tests/venue-refined-3d.spec.ts` | 本任務驗收 spec |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/components/venue/PlanEditor.tsx` | `WizardStep`(`:76`)加 `"refined"`;`WIZARD_STEPS`(`:107-110`)加第三筆;step-preview 區塊(`:1540-1562`)加「下一步」按鈕;新增 step-refined 區塊;`AiPanel`(`:1564-1570`)包 wrapper;新增 `handleToRefined` / `handleBackToPreview` |
| `src/components/venue/VenueScene.tsx` | 僅 `FloorMesh`(`:83-106`)改用 `useFloorGeometry`,並移除本地 `FLOOR_THICKNESS_M`(`:49`)改由共用模組匯入。其餘零改動 |
| `playwright-tests/pages/PlanEditorPage.ts` | 新增 step-03 locators 與 helper(`stepRefined` / `refinedScene` / `toRefinedButton` / `backToPreviewButton` / mesh count getters / `aiPanelSlot`),更新檔頭註解(wizard 已是三步) |

**不修改**:`AiPanel.tsx`、`VenueSceneLoader.tsx`、`src/lib/venue/*`(`plan.ts` / `furniture.ts` 型別與常數一律不動)、任何 `src/app/api/*`、`src/proxy.ts`(未新增 page 路由)、`PlanSlotsDialog.tsx`。

---

## Implementation Steps

1. **建立 `src/components/venue/floorGeometry.ts`**
   匯出 `export const FLOOR_THICKNESS_M = 0.1;` 與 `export function useFloorGeometry(polygon: FloorPolygon): THREE.ExtrudeGeometry`。內容照搬 `VenueScene.tsx:90-99` 的 `useMemo` 邏輯(`THREE.Shape` → `moveTo/lineTo/closePath` → `ExtrudeGeometry({ depth: FLOOR_THICKNESS_M, bevelEnabled: false })`),**演算法一字不改**;額外加 `useEffect(() => () => geometry.dispose(), [geometry])`。此檔屬 component 層(可 import Three),不放 `src/lib/venue/`。

2. **改 `src/components/venue/VenueScene.tsx`**
   刪除 `:49` 的 `const FLOOR_THICKNESS_M = 0.1;`,改 `import { useFloorGeometry, FLOOR_THICKNESS_M } from "./floorGeometry";`(若檔內其他處未用到常數則不匯入常數)。`FloorMesh`(`:83-106`)的 `useMemo` 區塊改為 `const geometry = useFloorGeometry(polygon);`,`return` 的 JSX 完全不動。**其餘全檔不得有任何其他改動** —— 這步是行為等價重構,任何 mesh/data attribute/互動變更都算越界。

3. **建立 `src/components/venue/RefinedScene.tsx`**(`"use client"`)
   - Props 介面:`{ polygon: FloorPolygon; walls: WallSegment[]; columns: Column[]; furniture: FurnitureItem[]; venueSizeM?: number; viewFitSizeM?: number }`。**無** `onSceneChange`。
   - 根節點 `<div data-testid="refined-scene" data-readonly="true" data-orbit-controls="true" data-wall-mesh-count={walls.length} data-column-mesh-count={columns.length} data-furniture-mesh-count={furniture.length} data-floor-vertex-count={polygon.length} className="mt-4 w-full">`,內含 `<div className="h-[480px] w-full overflow-hidden rounded border border-stone-300 bg-stone-100">` 包 `<Canvas>`(尺寸與 02 一致,`VenueScene.tsx:315`)。
   - `<Canvas camera={{ position: [fit*0.7, fit*0.9, fit*0.7], fov: 50 }}>`,`const fit = viewFitSizeM ?? venueSizeM ?? VENUE_SIZE_M`(比照 `VenueScene.tsx:117`)。
   - 打光沿用現況:`<ambientLight intensity={0.6} />` + `<directionalLight position={[25,40,25]} intensity={0.8} />`(`VenueScene.tsx:322-323`)。**本任務不加 shadow / 額外光源 / tone mapping** —— 那是 task 2。
   - `<OrbitControls makeDefault enableRotate enableZoom enablePan maxPolarAngle={Math.PI/2 - 0.05} minDistance={5} maxDistance={150} target={[fit/2, 0, fit/2]} />`(照 `VenueScene.tsx:324-334`)。不需要 `orbitRef`(03 無重設視角按鈕)。
   - `<gridHelper args={[venueSizeM, venueSizeM]} position={[venueSizeM/2, 0.01, venueSizeM/2]} />`,與 02 一致。
   - 地板:`<mesh geometry={useFloorGeometry(polygon) 的結果} rotation={[Math.PI/2,0,0]}>` + `<meshStandardMaterial color="#f5f5f4" side={THREE.DoubleSide} />`,**不掛 `onClick`**。建議沿用一個 local `FloorMesh` 小元件包裝以符合 hook 規則。
   - 牆/柱/家具:照 `VenueScene.tsx:340-416` 的 position / rotation / boxGeometry args / 顏色計算,但**逐一移除**:`ref={(node)=>...}`、`onClick`、`isSelected` 判斷與選取色 —— 顏色一律用非選取值(牆 `#78350f`、柱 `#78716c`、家具 `FURNITURE_DEFAULTS[kind].color`)。
   - **不得**出現 `TransformControls`、`selectedId`、`placingKind`、`sidebarOpen`、`aside` 側欄、`furniture-place-*` 按鈕。
   - 空場景(walls/columns/furniture 皆為 `[]`)時 `.map` 自然產出空陣列,只渲染地板 + grid,不需額外分支(edge case「空場景」)。

4. **建立 `src/components/venue/RefinedSceneLoader.tsx`**(`"use client"`)
   照 `VenueSceneLoader.tsx` 逐行對應:`dynamic(() => import("./RefinedScene"), { ssr: false, loading: () => <div className="mt-4 flex h-[480px] w-full items-center justify-center rounded border border-stone-200 bg-stone-50 text-sm text-stone-500">載入中…</div> })`,props 型別鏡射 RefinedScene(**不含** `onSceneChange`),直接透傳。

5. **`PlanEditor.tsx:76` 擴充步驟型別**
   `type WizardStep = "edit" | "preview" | "refined";`

6. **`PlanEditor.tsx:107-110` 擴充步驟陣列**
   加入 `{ step: "refined", no: "03", label: "精密 3D" }`。`StepProgress`(`:114-145`)為陣列驅動,無需改動即正確標示三步目前位置。確認 `max-w-md`(`:118`)容納三項不換行,必要時放寬為 `max-w-xl`(純樣式)。

7. **`PlanEditor.tsx` 新增兩個 handler**(置於 `handleBackToEdit`,`:469-471` 附近)
   ```
   function handleToRefined() { setStep("refined"); }
   function handleBackToPreview() { setStep("preview"); }
   ```
   **不**遞增 `generation`、**不**碰 `sceneGenerated`、**不**改任何幾何 state(D2)。

8. **`PlanEditor.tsx:1540-1562` step-preview 區塊加「下一步」**
   在既有 `back-to-edit-button` 同一列後方加:
   ```
   <Button type="button" data-testid="to-refined-button" onClick={handleToRefined} className="mb-2 ml-2">下一步</Button>
   ```
   `VenueSceneLoader` 的 props(含 `key={generation}`、`onSceneChange`)完全不動。

9. **`PlanEditor.tsx` 新增 step-refined 區塊**(緊接 step-preview 區塊之後,同一個 `min-w-0 flex-1` 左欄內)
   ```
   {step === "refined" && sceneGenerated && (
     <div data-testid="step-refined">
       <Button type="button" variant="outline" data-testid="back-to-preview-button" onClick={handleBackToPreview} className="mb-2">上一步</Button>
       <RefinedSceneLoader
         polygon={polygon} walls={walls} columns={columns} furniture={furniture}
         venueSizeM={PLAN_AREA_SIZE_M} viewFitSizeM={VENUE_SIZE_M}
       />
     </div>
   )}
   ```
   `sceneGenerated` guard 比照 `:1540`(Error States:snapshot/gate 未成立時不渲染 3D,不拋錯白畫面)。幾何 props 與 `:1553-1558` **完全相同** —— 這就是 D1。

10. **`PlanEditor.tsx:1564-1570` 包 AiPanel wrapper**
    依 D3 的程式碼片段插入 wrapper。`AiPanel` 的 5 個 props(`plan` / `applyActions` / `planId` / `slot` / `conversationSeed`)一字不改;`AiPanel.tsx` 本身零修改。

11. **靜態檢查**:`npx tsc --noEmit` 與 `npm run lint` 通過。

12. **手動 smoke**:畫牆+柱+放家具 → 下一步 → 02 內拖曳移動一件家具 → 下一步 → 03 顯示移動後位置、點物件無反應、拖曳可轉視角、無 AI 側欄 → 上一步 → 02 幾何完整 → 上一步 → 01 的 2D 內容一致。

13. **`playwright-tests/pages/PlanEditorPage.ts` 擴充**
    新增 locators:`stepRefined` (`[data-testid="step-refined"]`)、`refinedScene` (`[data-testid="refined-scene"]`)、`toRefinedButton`、`backToPreviewButton`、`aiPanelSlot` (`[data-testid="ai-panel-slot"]`);helper:`goToRefined()`、`backToPreview()`、`refinedWallMeshCount()` / `refinedColumnMeshCount()` / `refinedFurnitureMeshCount()` / `refinedFloorVertexCount()`。更新檔頭 `:55-65` 註解(三個互斥步驟容器)。既有 `scene` locator 仍指 `venue-scene`,**不得**讓 `refined-scene` 共用該 id。

14. **新增 `playwright-tests/venue-refined-3d.spec.ts`**,案例見 Test Plan。

15. **跑迴歸**:`venue-3d-scene.spec.ts`、`venue-objects.spec.ts`、`venue-zoom-pan.spec.ts`、`venue-plan-editor.spec.ts`、`venue-dimensions.spec.ts`、`ai-panel.spec.ts`、`ai-panel-persistent.spec.ts`、`plan-slots.spec.ts` 全綠(live dev server + `.env.playwright.local` 測試帳號)。預期零改動 —— 若任一支需改,必須在 PR 逐條說明理由。

---

## Data Flow

```
        ┌──────────────────────────────────────────────────────────┐
        │ PlanEditor 頂層 state(唯一幾何資料源)                     │
        │ polygon / walls / columns / furniture (+ *Ref)            │
        └───┬──────────────┬──────────────┬──────────────┬─────────┘
   props ↓  │              │ props ↓      │ props ↓      │ plan prop ↓
   ┌────────▼───────┐ ┌────▼──────────┐ ┌─▼───────────┐ ┌▼────────────────┐
   │ 2D Stage(01)  │ │ VenueScene(02)│ │ RefinedScene│ │ AiPanel(常駐)   │
   │ 直接 setState  │ │ controlled     │ │ (03)        │ │ 03 下 CSS 隱藏  │
   └────────┬───────┘ └────┬───────────┘ │ 唯讀,無回寫 │ └┬────────────────┘
            │              │ onSceneChange└─────────────┘  │ tool call
            │              ▼ (handleSceneChange:            ▼ applyActions
            └──────────► setState + eager ref) ──────► 同一份 state
```

步驟切換只改變「哪個消費者掛載」,不搬動資料。因此 02→03→02→03 任意往返,每次讀到的都是當下最新值,不存在快照倒退路徑。

---

## Test Plan

無 unit/integration test framework(AGENTS.md)。驗收 = Playwright(`playwright-tests/venue-refined-3d.spec.ts`)+ 上述迴歸。

新 spec 案例(對應 orchestrator 的 10 條驗收條件):

1. **進入 03 + 進度列**(AC1):畫一面牆 → 下一步 → 下一步 → `stepRefined` 可見、`stepPreview` count 0、`data-step="refined"`;`step-progress` 內有 3 個 `li`,第三項含「03」與「精密 3D」且帶目前步驟樣式標記。
2. **返回 02 內容一致**(AC2):承 1 → `back-to-preview-button` → `stepPreview` 可見、`venue-scene` 的 `data-wall-mesh-count` 與進 03 前相同。
3. **手動拖曳後進 03 位置正確**(AC3):02 選取一件家具、以 `TransformControls` 拖曳 commit → 記下 `plan-editor` 的 `data-furniture`(JSON)→ 進 03 → 回 02 → `data-furniture` 不變;並斷言 03 的 `data-furniture-mesh-count` 等於 02。(mesh 世界座標無法直接讀,以「唯一資料源 + JSON 快照不變」佐證,對應 D1。)
4. **往返多次不倒退**(edge case 1):02 拖曳 → 03 → 02 再拖曳另一件 → 03 → 回 02,`data-furniture` 累積兩次調整皆在,無回復到任何中間版本。
5. **唯讀:無選取/無 gizmo**(AC4):03 下點擊 canvas 中央 → `refined-scene` 的 `data-readonly` 為 `"true"`;頁面上 `furniture-place-table` / `venue-sidebar` / `reset-view-button` count 皆為 0(側欄與工具列不存在 ⇒ 無選取入口);點擊前後 `data-furniture` JSON 完全不變(無位移)。
6. **OrbitControls 可用**(AC5):`data-orbit-controls="true"`;於 canvas 上做一次 mouse drag,不拋 console error 且 `data-furniture` 不變(視角操作不改資料)。
7. **AI 側欄隱藏但未卸載**(AC6 + AC7):02 下 mock `/api/ai/chat` 對話一輪(沿用 `ai-panel-persistent.spec.ts` 的 `page.route` fixture,不花錢)+ 在輸入框留未送出草稿 → 進 03 → `ai-panel` 與 `ai-panel-toggle` 皆 `not.toBeVisible()`、`ai-panel-slot` 的 `data-hidden="true"` → 回 02 → 對話 `ai-assistant-text` 仍在、`ai-input` 草稿原樣。
8. **無存檔入口**(AC8):03 下 `plan-slots-button` count 0。
9. **未產生場景不可達 03**(AC9):首頁載入(`data-scene-generated="false"`)→ 頁面上 `to-refined-button` count 0(僅存在於 step-preview),無法直達 03。
10. **空場景**(edge case 3):不畫任何牆/柱/家具直接 下一步 → 下一步 → `stepRefined` 可見、`data-wall-mesh-count="0"`、`data-floor-vertex-count="4"`,無 console error。
11. **凹多邊形地板一致**(edge case 4):以既有 `venue-3d-scene.spec.ts` 凹多邊形 fixture 建場 → 02 與 03 的 `data-floor-vertex-count` 相同,兩步驟皆無 error(三角化共用 `useFloorGeometry`,D4)。
12. **版面不水平溢出**(edge case 5):03 下斷言 `document.documentElement.scrollWidth <= clientWidth`,且 canvas 元素寬度 > 02 時的寬度(AI 側欄隱藏後左欄變寬)。

迴歸(必須全綠、原則上零改動):步驟 15 所列 8 支 spec。

---

## Architecture Notes

- **本任務最大的風險其實是「照著 orchestrator 的舊描述改」**。D0 已逐行核對現況;實作者若在檔案裡找不到 `sceneSnapshot` / `localWalls`,那是正確的,不要「補回來」。
- **刻意的重複**:`RefinedScene` 的牆/柱/家具 mesh 與 `VenueScene` 高度雷同。不抽共用元件是刻意決策 —— story task 2–4 會把 03 的材質、打光、家具幾何整批換掉,現在抽共用只是製造 task 4 必須拆除的耦合。唯一抽共用的是地板 geometry(D4),因為驗收明文要求兩步驟三角化一致。
- **PlanEditor 檔案長度**:AGENTS.md 提醒此檔已 1584 行、勿再堆邏輯。本任務新增邏輯僅 2 個 3 行 handler + 1 個 JSX 區塊(約 15 行),重量級部分(3D 場景)全部落在新檔;符合「優先拆成子元件並以 props/callback 串接」的精神。若 review 認為 step-refined 區塊應再抽出,可作為後續 refactor,不在本任務範圍。
- **效能**:03 掛載時 02 已卸載,同時間只有一個 WebGL context;本任務沿用 box 幾何,量體與 02 相同,無新增負擔。task 3 的貼圖 lazy load 將建立在此互斥掛載邊界上。
- **Next.js 16 breaking changes**:本任務為純 client component(`"use client"`)+ `next/dynamic ssr:false`,與現有 `VenueSceneLoader` 同模式。developer 動工前仍依 AGENTS.md 查閱 `node_modules/next/dist/docs/` 的 dynamic import 章節,確認 `ssr:false` 用法在 16.2.10 未變更。
- **`inert` 屬性**:React 19.2 原生支援。若型別或 lint 有阻礙,退回 `aria-hidden="true"`,並在 PR 註明(對驗收無影響,`display:none` 本身已使其不可 focus)。

## Risks

| 風險 | 影響 | 緩解 |
| --- | --- | --- |
| 返回 02 時相機視角/選取重置(D2 取捨) | 使用者體感「視角跳掉」 | 驗收條件只要求內容一致,已明確記錄;若日後要保留視角,做法是把相機參數提升為 PlanEditor state,屬後續 story |
| `display:contents` wrapper 影響 01/02 版面 | 既有版面/測試退化 | `contents` 不產生 box,`AiPanel` 仍是 flex item;步驟 15 迴歸 spec 為守門 |
| 誤把 `AiPanel` 條件渲染成 unmount | 退化上一個 story 成果 | Test case 7 直接驗證對話與草稿保留;reviewer 檢查點:`AiPanel` 前不得出現 `step !== ...&&` |
| 改 `VenueScene` 的 `FloorMesh` 造成 02 退化 | 既有 3D 預覽受影響 | 步驟 2 限定為行為等價重構(僅換 geometry 來源),`venue-3d-scene.spec.ts` 迴歸為守門 |
| `RefinedScene` 被實作成持有 local 幾何 state | 重演往返資料倒退坑 | D1 硬性約束 + test case 4;reviewer 檢查點:`RefinedScene` 內不得出現存放幾何的 `useState` |
| 新 testid 與既有 `venue-scene` 混淆 | 測試偽陽/偽陰 | 03 一律用 `refined-scene` 前綴;`PlanEditorPage.scene` 仍專指 02 |
| `to-refined-button` 誤用既有 `next-step-button` id | 既有 page object 定位錯亂 | D5 明定使用新 id |

## Security Checklist

- [ ] 無硬編碼 secrets/credentials(Playwright 測試帳號一律走 `.env.playwright.local`)
- [ ] 無新增系統邊界輸入(本任務不新增/修改任何 API 呼叫;AI 路由 mock 僅存在於測試)
- [ ] Auth/permission:不觸及(未新增 page 路由,`src/proxy.ts` 無需改動)
- [ ] 不 log 任何 token/session/敏感資料
- [ ] 不 import `admin.ts` / service_role 至 client component
- [ ] 不動 `src/lib/ai/` server-only 邊界與凍結系統提示
- [ ] `src/lib/venue/` 純領域模組維持零 React/DOM/Konva/Three import(新 Three 程式碼一律放 `src/components/venue/`)

## Definition of Done

- [ ] 全部 15 個 Implementation Steps 完成
- [ ] `playwright-tests/venue-refined-3d.spec.ts` 12 個案例全綠
- [ ] 步驟 15 所列 8 支既有 spec 全綠且零改動(有改動則逐條說明)
- [ ] orchestrator-output.md 的 10 條 Clarified Acceptance Criteria 逐條對應到通過的測試或手動驗證
- [ ] 無 TODO、註解掉的程式碼、debug log
- [ ] `npm run lint` + `npx tsc --noEmit` 通過
- [ ] 符合 AGENTS.md 全部規則(尤其:`src/lib/venue/` 不碰 Three、Three 元件走 `*Loader.tsx` ssr:false、geometry `useMemo` + `dispose()`、新步驟同步更新 `WizardStep` 與 `WIZARD_STEPS` 並給步驟容器 `data-testid`)
- [ ] 本任務不含材質/陰影/參數化家具幾何(task 2–4 範圍),未越界
- [ ] Security Checklist 通過
