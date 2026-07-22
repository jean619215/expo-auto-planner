# Architect Plan — 2D 畫布 zoom/pan(移除場地尺寸編輯,固定 200x200)

> Story: PlanEditor 操作體驗改善(zoom/pan + AI 面板常駐) | Task type: FRONTEND | Generated: 2026-07-22T22:15:00+08:00

## Overview

在 Konva Stage 層加一組純顯示用 view transform(scale/x/y),所有指標互動改走 `getRelativePointerPosition()`;元件層的可變 `venueSizeM` state 整組換成固定常數 200,移除場地尺寸編輯 UI;AI system prompt 與 tools schema 的尺寸描述在同一 commit 批次改為 200。

## Task Type Confirmed

FRONTEND — 技術分析與 orchestrator 判定一致:核心在 `PlanEditor.tsx` 畫布互動;`system.ts`/`tools.ts` 僅字串常數變更,不動 API 契約與後端邏輯。

## Escalation Check(結論:不需升級)

- 外部 API 契約:`/api/plans/[slot]` PUT payload 的 `venueSizeM` 欄位型別/存在性不變,僅前端固定送 200 → 非契約變更。
- DB schema / 既有資料:明確不遷移(Out of Scope),讀檔相容由前端固定 clamp 承擔 → 不觸發。
- Auth / 安全模型:不涉及。
- 複雜度:與 story 預估相符(主要工作量 = 座標遷移 + 測試基建重做,orchestrator 已預期)。
- 資訊充分性:5 個 Assumption 均可依 AC 明文定案(Assumption 1「維持現行視覺、原點 (0,0) 不動」已是 spec 定案),無需人類先行裁決。

## 兩層座標系職責分界(關鍵設計,對應 Edge Case「AiPanel 側欄 ResizeObserver」)

```
公尺座標 (plan.ts domain, 0–200)
   │  × pxPerMeter = computePxPerMeter(stagePx, DEFAULT_VIEW_SIZE_M=50)   ← 第一層:世界像素
   ▼      (隨 stagePx/ResizeObserver 變;與 zoom 完全無關;即現行 data-px-per-meter)
世界像素(Layer 內部座標,node.x()/node.y() 所在座標系)
   │  Stage transform: scaleX/scaleY = view.scale, x/y = view.x/view.y    ← 第二層:純顯示
   ▼      (滾輪/按鈕/pan 只改這層;不落存檔、不進 plan.ts 任何運算)
螢幕像素(stage.getPointerPosition() 回傳的座標系)
```

- `pxPerMeter` 的公式從 `computePxPerMeter(stagePx, venueSizeM)` 改為 `computePxPerMeter(stagePx, DEFAULT_VIEW_SIZE_M)`,`DEFAULT_VIEW_SIZE_M = VENUE_SIZE_M`(50)。數值與現行預設完全相同 → `view = {scale:1, x:0, y:0}` 時畫面與現行逐像素一致,滿足「預設視覺不變」AC,原點 (0,0) 仍在畫布左上角。
- 側欄展開/收合 → stagePx 變 → 只動第一層;zoom → 只動第二層。兩層在 Stage props 相乘,無雙重換算、互不覆蓋。
- `getRelativePointerPosition()` 恰好把第二層還原回世界像素,既有 `pxToMeters(p, pxPerMeter)` 呼叫鏈完全不變。

## 定案的技術決策(Playwright 撰寫依據)

| 項目 | 定案 |
| --- | --- |
| 可規劃範圍 | `PLAN_AREA_SIZE_M = 200`(新常數,加在 `plan.ts`;取代元件內 `MAX_VENUE_SIZE_M`/`MIN_VENUE_SIZE_M` 的角色) |
| 倍率範圍 | `MIN_SCALE = 0.25`(= 50/200,zoom out 到底恰好完整容納 200x200,呼應 Edge Case)、`MAX_SCALE = 4` |
| 滾輪步進 | `WHEEL_SCALE_FACTOR = 1.06`(每 wheel event 乘/除一次,deltaY > 0 縮小) |
| 按鈕步進 | `BUTTON_SCALE_FACTOR = 1.25`,錨點 = 畫布中心 `(stagePx/2, stagePx/2)` |
| 重置視圖 | `{scale: 1, x: 0, y: 0}`(即預設 fit 50x50 視圖) |
| 倍率顯示 | `Math.round(view.scale * 100) + "%"`,`data-testid="zoom-level"` |
| pan 區隔機制 | **Stage draggable(限 select 模式)+ mousedown 命中判斷**:`handleStageMouseDown` 記錄 `panBlockedRef.current = (e.target !== stage)`;Stage `onDragStart` 中若 `e.target === stage && panBlockedRef.current` 則 `stage.stopDrag()`。效果:真正空白處(mousedown 命中 Stage 本身)拖曳 = pan;地板面、物件、頂點、把手上拖曳 = 走各自既有邏輯、絕不 pan。wall/column 模式 `draggable={false}`,繪製手勢不受影響 |
| 新 data attributes | wrapper 增加 `data-stage-scale` / `data-stage-x` / `data-stage-y`(比照現行 `data-px-per-meter` 模式,供 Playwright 換算 — Assumption 4 的測試 hook) |
| 新 testids | `zoom-in-button` / `zoom-out-button` / `zoom-reset-button` / `zoom-level` |

選 Stage draggable + 命中判斷而非空白鍵 modifier / 獨立平移工具:不新增模式、不佔鍵盤、用 Konva 原生 drag 最穩,且命中判斷可精確滿足 AC「物件上拖曳不觸發平移」的強語意(含未選取物件)。

## Files to Create

| File path | Purpose |
| --- | --- |
| `playwright-tests/venue-zoom-pan.spec.ts` | zoom/pan 新功能驗收 + 縮放/平移狀態下互動座標正確性 + 移除項不存在 + 固定 200 存讀檔行為 |

## Files to Modify

| File path | What changes |
| --- | --- |
| `src/lib/venue/plan.ts` | 新增 `export const PLAN_AREA_SIZE_M = 200`;`EMPTY_PLAN_BASELINE` 的 `venueSizeM` 改用 `PLAN_AREA_SIZE_M`(其餘欄位不動)。**其他一律不動**(`VENUE_SIZE_M`=50 保留,語意變為「預設地板生成/預設視圖 fit 尺寸」— Assumption 2) |
| `src/components/venue/PlanEditor.tsx` | 主要改動:view state + 滾輪/按鈕/pan、4 處指標座標遷移、venue-size UI/state/handler 整組移除、`venueSizeM` state → `PLAN_AREA_SIZE_M` 常數 |
| `src/components/venue/VenueSceneLoader.tsx` | 透傳新的可選 prop `viewFitSizeM` |
| `src/components/venue/VenueScene.tsx` | 新增可選 prop `viewFitSizeM`(預設 = `venueSizeM`):相機 position/target 與移動 gizmo 尺寸/步進改用它;ground plane 與 translate clamp 維持用 `venueSizeM` |
| `src/lib/ai/system.ts` | 尺寸描述批次更新(Step 10),僅字串,同一 commit |
| `src/lib/ai/tools.ts` | schema description 尺寸批次更新(Step 10),同一 commit |
| `playwright-tests/pages/PlanEditorPage.ts` | `meterToScreen()` 納入 stage transform;新增 scale/pos 讀取與 zoom/pan 操作 helper |

## Implementation Steps

### A. domain 常數(plan.ts)

1. `src/lib/venue/plan.ts`:新增 `export const PLAN_AREA_SIZE_M = 200;`(註解:可規劃範圍上限,前端 clamp 唯一來源;`VENUE_SIZE_M` 註解補充其新語意 = 預設地板生成與預設視圖 fit 尺寸)。`EMPTY_PLAN_BASELINE` 的 `venueSizeM: VENUE_SIZE_M` → `venueSizeM: PLAN_AREA_SIZE_M`(polygon 仍為 `createDefaultFloor(VENUE_SIZE_M)`)。⚠️ 此行不改的話,新的 `getSnapshot()`(送 200)對上舊 baseline(50)會讓全新畫布永遠判 dirty。`createDefaultFloor` / `DEFAULT_FLOOR` / 所有幾何函式簽名不動。

### B. PlanEditor.tsx — 固定 200 與移除場地尺寸編輯

2. 常數與 state/JSX 清理(移除清單):
   - 刪除元件檔內 `MIN_VENUE_SIZE_M` / `MAX_VENUE_SIZE_M`,改 import `PLAN_AREA_SIZE_M`;新增 `const DEFAULT_VIEW_SIZE_M = VENUE_SIZE_M;`。
   - 刪除 state:`venueSizeM`、`sizeEditorOpen`、`sizeInput`、`pendingSizeM`、`sizeConfirmOpen`。
   - 刪除 handler:`openSizeEditor`、`applyVenueSize`、`handleSizeConfirm`、`handleSizeConfirmAccept`。
   - 刪除 JSX:`venue-size-editor` / `venue-size-button` 條件塊(含 `venue-size-input`/`venue-size-confirm-button`/`venue-size-cancel-button`)、`sizeConfirmOpen` 的整個 `<AlertDialog>`(`venue-size-confirm-dialog`/`venue-size-confirm-cancel`/`venue-size-confirm-accept`)。
   - 清理不再使用的 import:`Ruler`、`Input`、`Label`、全部 `AlertDialog*`(此檔僅 size confirm 在用);`VENUE_SIZE_M` 保留(供 `DEFAULT_VIEW_SIZE_M` 與 `viewFitSizeM`)。
   - 舊 Playwright 測試移除:全 repo grep 確認 `playwright-tests/` 無任何 `venue-size` UI 引用(`venue-dimensions.spec.ts` 是尺寸標籤測試,無關)→ 實際需移除的舊測試為零檔案,開發者以 grep 再驗證一次即可。
3. `venueSizeM` 引用全數改 `PLAN_AREA_SIZE_M`(逐處):`handleVertexDragMove`/`handleVertexDragEnd`(`moveVertex`)、`handleEdgeDblClick`(`insertVertexOnEdge`)、`handleStageMouseDown`/`handleStageMouseMove`(`snapPoint`)、`handleStageMouseUp`(`createWall`/`createColumn`)、`handleWallBodyDrag`(`translateWall`)、`handleColumnBodyDrag`(`translateColumn`)、`handleWallEndpointDrag`(`moveWallEndpoint`)、`handleColumnCornerDrag`(`resizeColumnCorner`)、`applyActions` 內全部(`snapPoint`×4、`createWall`、`clampColumnCenter`×2、`translateWall`、`translateColumn`、`translateFurniture`)、grid 的 `buildGridLines(pxPerMeter, PLAN_AREA_SIZE_M)`、兩組座標標籤 `Array.from({length: PLAN_AREA_SIZE_M / GRID_MAJOR_M + 1}, …)`、背景 `<Rect>` 的 `width`/`height` 改為 `PLAN_AREA_SIZE_M * pxPerMeter`(原 `stagePx`,否則 zoom out 後背景只蓋 50m)。
4. `const pxPerMeter = computePxPerMeter(stagePx, DEFAULT_VIEW_SIZE_M);`(數值同現行預設 — 預設視覺不變的關鍵)。
5. 存讀檔配套:
   - `getSnapshot()`:`venueSizeM: PLAN_AREA_SIZE_M`(PUT 固定送 200 的 AC)。
   - `applyLoadedPlan()`:刪除 `sizeM` 計算與 `setVenueSizeM`/`setSizeInput`;`savedBaseline` 的 `serializePlanSnapshot({...})` 改帶 `venueSizeM: PLAN_AREA_SIZE_M`(必須與 `getSnapshot()` 一致,否則讀檔後立即 false-dirty)。舊檔 `rawPlan.venueSizeM` 不論 40/50/>200/缺欄位一律忽略 → 天然滿足「≤200 舊檔相容、缺欄位 fallback 不崩潰」AC(無 fallback 分支殘留)。
   - `VenueSceneLoader` 呼叫處:`venueSizeM={PLAN_AREA_SIZE_M}`、`viewFitSizeM={VENUE_SIZE_M}`。

### C. PlanEditor.tsx — zoom/pan

6. view state 與 zoom 核心:
   - `const [view, setView] = useState({ scale: 1, x: 0, y: 0 });`、`const panBlockedRef = useRef(false);`、常數 `MIN_SCALE = DEFAULT_VIEW_SIZE_M / PLAN_AREA_SIZE_M`(0.25)、`MAX_SCALE = 4`、`WHEEL_SCALE_FACTOR = 1.06`、`BUTTON_SCALE_FACTOR = 1.25`。
   - `function zoomTo(rawScale: number, anchor: { x: number; y: number })`(Konva 官方滾輪錨點食譜):
     ```ts
     const oldScale = view.scale;
     const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
     if (!Number.isFinite(newScale) || newScale === oldScale) return; // NaN/超界靜默收斂,不拋錯不重置
     const worldPoint = { x: (anchor.x - view.x) / oldScale, y: (anchor.y - view.y) / oldScale };
     setView({ scale: newScale, x: anchor.x - worldPoint.x * newScale, y: anchor.y - worldPoint.y * newScale });
     ```
   - `handleWheel(e: Konva.KonvaEventObject<WheelEvent>)`:`e.evt.preventDefault()`;`const pointer = stage.getPointerPosition(); if (!pointer) return;`(⚠️ 此處**刻意**用螢幕座標版 `getPointerPosition` — 錨點公式在螢幕座標系運算,是全檔唯一保留處,附 code comment);`zoomTo(e.evt.deltaY > 0 ? view.scale / WHEEL_SCALE_FACTOR : view.scale * WHEEL_SCALE_FACTOR, pointer)`。連續高頻 wheel:每 event 獨立 clamp,無抖動/超界回跳。
   - `const resetView = () => setView({ scale: 1, x: 0, y: 0 });`(pan 到極端位置的一鍵復原)。
7. Stage props 與 pan:
   - `<Stage scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y} draggable={mode === "select"} onWheel={handleWheel} onDragStart={handleStageDragStart} onDragEnd={handleStageDragEnd} …既有 handler 不動>`。
   - `handleStageMouseDown` 開頭(取得 stage 後)加:`panBlockedRef.current = e.target !== stage;`(mousedown 的 `e.target` 即命中節點:空白=Stage、地板=Line、物件/把手=該 shape;背景 Rect/grid 在 `listening={false}` layer 不會攔截)。
   - `handleStageDragStart(e)`:`if (e.target === e.target.getStage() && panBlockedRef.current) e.target.getStage()!.stopDrag();` — 攔掉「按在地板/物件上卻拖動 Stage」;子節點自身 drag(頂點/選取物件/把手,`e.target !== stage`)直接不處理。
   - `handleStageDragEnd(e)`:`if (e.target !== e.target.getStage()) return;` 之後 `setView(v => ({ ...v, x: e.target.x(), y: e.target.y() }))`(受控 props 與 Konva 內部位置回同步)。
   - 既有 `handleStageMouseDown` select 分支的取消選取邏輯(`targetName(e) !== "object"`)保持不變。
8. 指標座標遷移 — **完整清單(全檔實際僅 4 處 `getPointerPosition`,逐處列出)**,一律改 `stage.getRelativePointerPosition()`,保留既有 `if (!pointer) return;` 防呆(Error State AC):
   1. `handleEdgeDblClick`(雙擊插入頂點的命中判定)
   2. `handleStageMouseDown`(wall 起點 / select 空白判定用座標)
   3. `handleStageMouseMove`(wall 拖曳終點)
   4. `handleStageMouseUp`(column 放置點)
   - **明確不遷移**(開發者勿多改):(a) Step 6 的 `handleWheel` 用螢幕座標;(b) 全部 drag handler(`handleVertexDragMove/End`、`handleWallBodyDrag`、`handleColumnBodyDrag`、`handleWallEndpointDrag`、`handleColumnCornerDrag`)讀的是 `node.x()/node.y()` = Layer(父層)座標 = 世界像素,Konva drag 已自動把 Stage transform 換算掉,任意縮放/平移下數值語意不變 — 這是 story 備註「~10 處」實際收斂為 4 處的原因,需在 code comment 記錄以防未來誤改。
9. 工具列 zoom UI(放在原場地尺寸按鈕位置,樣式復用 `PlanToolbar.tsx` 已 export 的 `segmentClassName` 與其外框 `inline-flex overflow-hidden rounded-md border-[1.5px] border-blueprint bg-card` 容器樣式):
   - `zoom-out-button`(−,`zoomTo(view.scale / BUTTON_SCALE_FACTOR, {x: stagePx/2, y: stagePx/2})`)、`zoom-level`(倍率文字,非按鈕)、`zoom-in-button`(+)、`zoom-reset-button`(重置視圖,呼叫 `resetView`)。lucide icon 建議 `ZoomOut`/`ZoomIn`/`Maximize`。
   - wrapper div 增加 `data-stage-scale={view.scale}`、`data-stage-x={view.x}`、`data-stage-y={view.y}`。
   - 畫布內「5 公尺」比例尺與座標數字標籤維持在既有 layer(隨內容縮放/平移 — 物理上一致;預設視圖下與現行逐像素相同)。

### D. AI 提示批次(同一 commit,凍結字串規則)

10. `src/lib/ai/system.ts` + `src/lib/ai/tools.ts` **必須與本任務其餘改動同一個 commit**(不得分批;prompt cache 前綴比對本輪必失效一次,分批會多失效一輪且產生 system/tools 認知不一致過渡態):
    - `system.ts`(3 處,僅字串;禁止任何插值,`import "server-only"` 與凍結字串註解不動):
      1. 「協助使用者在 50x50 公尺的場地編輯器中」→「200x200 公尺」
      2. 「場地最大 50x50 公尺,座標原點在左上角…」→「場地最大 200x200 公尺,…」(原點/軸向/0.5 網格描述不變)
      3. 「預設 10x10 正方形置中」→「預設 10x10 正方形位於 (20,20)–(30,30)」(200 範圍下「置中」已不成立,改為與 `DEFAULT_FLOOR` 一致的明確座標)
    - `tools.ts`(4 處,僅 description 字串;schema 結構/strict 不動):
      1. `POINT_SCHEMA.x.description`:「公尺,0-50」→「公尺,0-200」
      2. `POINT_SCHEMA.y.description`:同上
      3. `generate_plan` 的 `floor.description`:「座標 0-50 公尺、0.5 對齊」→「座標 0-200 公尺、0.5 對齊」
      4. `resize_floor` 的 `points.description`:同上
    - 完成後全檔 grep `0-50` / `50x50` / `50 公尺` 確認無遺漏。

### E. 3D 配套(最小變更)

11. `VenueScene.tsx`:props 增加 `viewFitSizeM?: number`,`const fit = viewFitSizeM ?? venueSizeM;` — 相機 `position={[fit*0.7, fit*0.9, fit*0.7]}`、`target={[fit/2, 0, fit/2]}`、gizmo `size={Math.max(1, fit * 0.04)}` 改用 fit;ground plane `args`/`position` 與 `translateWall/Column/Furniture` 的 clamp 維持 `venueSizeM`(=200)。`VenueSceneLoader.tsx` 增加同名可選 prop 透傳。效果:3D 預設取景與現行完全一致(fit=50),但拖曳 clamp 與地面涵蓋 200(2D 擴大範圍後的物件在 3D 不會被 50 卡住)。

### F. 測試基建與新測試

12. `playwright-tests/pages/PlanEditorPage.ts`:
    - 新增讀取:`stageScale()`(`data-stage-scale`)、`stagePosition()`(`data-stage-x`/`data-stage-y`)。
    - `meterToScreen()` 重做(把 stage transform 納入換算,Assumption 4):
      ```ts
      const [box, ppm, scale, pos] = await Promise.all([this.containerBox(), this.pxPerMeter(), this.stageScale(), this.stagePosition()]);
      return { x: box.x + pos.x + meter.x * ppm * scale, y: box.y + pos.y + meter.y * ppm * scale };
      ```
      預設視圖(scale=1, pos=(0,0))下退化為現行公式 → 既有呼叫端(`dragVertexTo`/`drawWall`/`clickAt`/`dragObjectBody`/`dragWallEndpoint`/`dragColumnCorner`/`doubleClickAt`/`rightClickVertex`)全部自動獲得 transform 感知,零改動。
    - 新增操作:`clickZoomIn()`/`clickZoomOut()`/`clickZoomReset()`、`zoomLevel()`(讀 `zoom-level` 文字)、`wheelZoomAt(meter, deltaY)`(`mouse.move` 到 `meterToScreen(meter)` 後 `page.mouse.wheel(0, deltaY)`)、`panByDrag(fromMeter, toMeter)`(空白公尺點間 mouse down-move-up)。
    - 檔頭註解更新(現行註解明文假設「Stage 無 offset、meter(0,0) 對映 canvas 左上」— 改述兩層座標系)。
13. 新增 `playwright-tests/venue-zoom-pan.spec.ts`(對齊 AC 逐條):
    1. **預設視覺迴歸**:載入後 `data-stage-scale=1`、`data-stage-x/y=0`、`zoom-level` 顯示 `100%`、`data-px-per-meter === stagePx/50`、vertices === DEFAULT_FLOOR(20,20–30,30)。
    2. **移除驗證**:`venue-size-button`/`venue-size-editor`/`venue-size-confirm-dialog` `count() === 0`。
    3. **滾輪錨點縮放**:記下公尺點 (25,25) 縮放前 `meterToScreen`,`wheelZoomAt` 該點放大 → scale 上升、該點縮放後螢幕座標與縮放前差 < 1px、`zoom-level` 即時更新。
    4. **按鈕縮放與夾值**:`clickZoomIn` ×1 → scale ≈ 1.25;連點至上限停在 400%;`clickZoomOut` 連點至下限停在 25%(並驗證 `200 * ppm * 0.25 === stagePx`,整個 200x200 恰好可視)。
    5. **重置**:縮放+平移後 `clickZoomReset` → scale=1、x=0、y=0。
    6. **pan 區隔**:select 模式空白處(如 (45,5),地板外)`panByDrag` → `data-stage-x/y` 改變且 vertices/objects 不變;地板內部點拖曳 → stage x/y 不變;選取物件後在物件上拖曳 → 物件公尺座標改變且 stage x/y 不變。
    7. **縮放/平移狀態下互動正確性**(核心,先 wheel 縮放 + pan 到非預設狀態再逐項):`dragVertexTo`、`doubleClickAt` 邊上插頂點、`rightClickVertex` 刪頂點、wall 工具 `drawWall`、column 工具 `placeColumn`、`dragObjectBody`、`dragWallEndpoint`、`dragColumnCorner` — 斷言產出公尺座標與 1x/(0,0) 期望值一致(`toBeCloseTo(_, 5)`;期望值直接沿用既有 spec 同型測試)。
    8. **擴大範圍**:zoom out 至 25% 後於 (150,150) `placeColumn` → `data-objects` 中心 = (150,150)(50–200 區間可編輯、clamp 200 生效)。
    9. **存檔固定 200 + 舊檔相容**:mock `PUT /api/plans/[slot]` 攔截 body → `plan.venueSizeM === 200`;mock GET 回 `venueSizeM: 40` 舊檔 → 讀入正常顯示可編輯、隨後 PUT 仍送 200。
14. 全套迴歸(不改既有斷言)+ `npm run lint`:`venue-plan-editor.spec.ts`、`venue-dimensions.spec.ts`、`venue-objects.spec.ts`、`venue-3d-scene.spec.ts`、`plan-slots.spec.ts`、`ai-panel.spec.ts`。已核對 `plan-slots.spec.ts` 現有斷言(vertexCount / furniture 數 / `typeof plan.venueSizeM === "number"`)皆與固定 200 相容;`venue-3d-scene.spec.ts` 斷言均為 data attribute(mesh 數/orbit flag),不受 viewFitSizeM 影響。

## Data Flow

- 編輯互動:螢幕 pointer → `getRelativePointerPosition()`(還原第二層)→ `pxToMeters(·, pxPerMeter)`(還原第一層)→ `plan.ts` 幾何函式(`sizeM = PLAN_AREA_SIZE_M`)→ setState → render `metersToPx` → Stage transform 上屏。
- zoom/pan:wheel/按鈕/Stage drag → `view` state → 僅 Stage props;不落 snapshot、不進 API payload、不進 AI plan JSON。
- 存檔:`getSnapshot()` 固定 `venueSizeM: 200` → PUT;讀檔:忽略存檔內 `venueSizeM` → baseline 以 200 序列化。
- AI:tool call 座標(0–200)→ `applyActions` 既有 clamp(`PLAN_AREA_SIZE_M`)→ 畫布;prompt/schema 描述與前端 clamp 範圍一致。

## Test Plan

無 unit test framework(依 AGENTS.md,FRONTEND 驗收 gate = Playwright):

- Playwright 新增:`venue-zoom-pan.spec.ts`(Step 13 全 9 案)。
- Playwright 修改:`PlanEditorPage.ts`(Step 12)。
- Playwright 迴歸:Step 14 全套既有 spec 原樣通過。
- Edge cases 對照(orchestrator 清單):錨點縮放邊緣不產生 NaN(zoomTo 的 Number.isFinite 防呆 + 案3)、連續 wheel 夾值(案4)、極端 pan 一鍵復原(案5)、min zoom 完整容納 200(案4)、縮放態雙擊/右鍵 hit test(案7)、舊檔 venueSizeM 異常值(讀檔直接忽略欄位,天然涵蓋)、ResizeObserver 疊加(兩層設計章節;`ai-panel.spec.ts` 迴歸覆蓋側欄展開下畫布行為)。

## Architecture Notes

- **偏離點 1(記錄)**:`venueSizeM` 存檔欄位保留但語意退化為「固定 200 的相容欄位」— story 定案,非 schema 變更。
- **偏離點 2(記錄)**:3D `VenueScene` 增 `viewFitSizeM` prop — 維持 3D 預設取景不變、同時讓 clamp/地面用 200 的最小手術;ground plane 50→200 使背景邊緣略有視覺差異(spec 斷言皆 data attribute 不受影響),QA 目視確認。
- **效能**:grid 由 51×2 條線增為 201×2 條 + 41×2 個座標標籤,均在 `listening={false}` layer,Konva 可負擔;若 QA 發現卡頓,視域裁剪列後續任務(不在本任務)。
- **風險:受控 Stage 位置與 Konva drag 的同步** — pan 期間 Konva 直接動 stage 節點,dragEnd 才 setView;期間若 React re-render(如 AI 回應到達)會以舊 view 值覆蓋進行中的 pan。若實測觀察到跳動,把 `handleStageDragEnd` 的同步複製到 `onDragMove`(同樣加 `e.target === stage` guard)— 開發者可視情況直接加上,屬本計畫允許範圍。
- **明確不做**:觸控手勢、視域裁剪、`VENUE_SIZE_M` 更名、AiPanel 常駐(story task 2)、資料遷移。
- wheel 事件發生於子節點 drag 進行中的極端時序:不加 guard(Konva drag 以指標絕對座標計算,transform 改變後下一次 dragmove 自行收斂),QA 免測。

## Security Checklist

- [ ] 無硬編碼 secrets/credentials(本任務僅前端常數與字串)
- [ ] 輸入驗證:座標一律經 `snapPoint`/`clampToBounds`(0–200)既有邊界防呆,無新增使用者輸入面
- [ ] Auth/permission:不涉及(`/api/plans/*`、`/api/ai/*` 保護不變)
- [ ] 無敏感資料 log
- [ ] `src/lib/ai/` 專項:`import "server-only"` 邊界不動;`SYSTEM_PROMPT` 維持凍結字串、零插值;cache 斷點結構不動;client 端不得 import `src/lib/ai/*`
- [ ] Playwright 測試帳密僅 `.env.playwright.local`,spec 內不硬編碼

## Definition of Done

- [ ] Steps 1–12 實作完成;`PlanEditor.tsx` 內 `getPointerPosition` 僅剩 `handleWheel` 一處(附註解)
- [ ] `system.ts`/`tools.ts` 尺寸描述與其餘改動同一 commit,grep 無殘留 `0-50`/`50x50`
- [ ] `venue-zoom-pan.spec.ts` 9 案全過;既有 6 支相關 spec 不改斷言原樣通過;`npm run lint` 乾淨
- [ ] 預設載入視覺與現行逐像素一致(scale=1/x=0/y=0、pxPerMeter 公式值不變、DEFAULT_FLOOR 位置不變)
- [ ] 無 TODO / 註解掉的程式碼 / debug log
- [ ] Security checklist 全數通過
- [ ] 符合 AGENTS.md 全部規則(含 `@/*` alias、eslint-config-next)
