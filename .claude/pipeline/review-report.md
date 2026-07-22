# Code Review Report — 2D 畫布 zoom/pan(固定 200x200,移除場地尺寸編輯器)

> Generated: 2026-07-22T23:55:00+08:00 | Review iteration: 1

## Overall Assessment

APPROVED

## Summary

實作與 architect-plan.md 高度一致:兩層座標系(pxPerMeter × Stage transform)分界正確、4 處 `getPointerPosition` 遷移完整且僅 `handleWheel` 依計畫保留螢幕座標(附註解)、pan 命中判斷(`panBlockedRef` + `stopDrag`)不搶物件拖曳、場地尺寸編輯器移除乾淨無殘留、`EMPTY_PLAN_BASELINE`/`getSnapshot()`/`applyLoadedPlan()` baseline 三處同步為 200(dirty 判定一致)。`npm run lint` 與 `npx tsc --noEmit` 皆乾淨。唯一顯著發現:working tree 混入一組**不屬於本任務計畫**的家具種類擴充(6 種新家具,詳見 🟡 Issue 1),為 pipeline 啟動前即存在的未 commit 變更,內部一致且不違反安全規則,但超出本任務「AI 提示僅改尺寸字串」的計畫敘述,需人類在 commit 時知悉處置。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)

無。

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — 計畫外變更混入 working tree:家具種類由 3 種擴充為 9 種

- **File**: `src/lib/venue/furniture.ts`、`src/lib/ai-panel/actions.ts`、`src/lib/ai/system.ts`(場地領域規則家具清單行)、`src/lib/ai/tools.ts`(`generate_plan`/`add_furniture` 的 kind enum 與 description)、`src/components/venue/VenueScene.tsx`(FURNITURE_ICONS 6 個新 icon)
- **Issue**: 新增 counter/bannerStand/sofa/podium/plant/display 六種家具。architect-plan.md Step 10 與 orchestrator Out of Scope 明文「AI 提示/tools schema 僅尺寸描述文字變更,不動 schema 結構」,此變更改了 tools.ts 的 enum(結構性)並改了 system.ts 家具清單行(非尺寸字串)。查證:這 5 個檔案在本 pipeline 任務啟動前即已是 modified 狀態(前次 git status 快照僅列這 5 檔),developer 的 implement 記錄(task-log 2026-07-22T15:14:39Z)亦完全未提及 → 判定為使用者既有的 in-flight 工作(68ba48e 家具系統的延伸),非 developer agent 越界。
- **內部一致性已核**: `FurnitureKind` 型別(furniture.ts/actions.ts)、`FURNITURE_DEFAULTS` 9 鍵齊全(applyActions/2D/3D 渲染均查此表,無 crash 路徑)、tools.ts 兩處 enum 同步、system.ts 描述與 defaults 尺寸吻合、lucide icon(Store/Flag/Sofa/Presentation/Flower2/Package)皆存在、lint/tsc 乾淨。凍結字串規則未破壞(零插值)、scope guard/工作模式規則逐字未動、`import "server-only"` 不變。
- **Suggested fix**: 程式碼本身無需修改。處置 = commit 衛生:建議將家具擴充與本任務分成兩個 commit(注意 system.ts/tools.ts 的「尺寸 200」與「家具九種」若分拆,每個 commit 內 system/tools 需各自認知一致);或由人類確認一併納入。prompt cache 本輪必失效一次,一起 commit 反而少失效一輪 — 由人類定奪。

## 💡 Suggestions (Consider — No Action Required)

1. **VenueScene `maxDistance={150}`**:venueSizeM=200 後,3D 相機最遠 150 拉不到能盡覽 200x200 地面的距離(對角 ~283m)。計畫明訂 3D 最小變更,僅記錄供後續任務。
2. **`zoomTo` 讀 render 閉包的 `view`**:同一 frame 內若連續多發 wheel event,第二發用到舊 view 可能有極輕微錨點抖動(clamp 保證不發散)。計畫原文即此寫法(Konva 官方食譜同),僅記錄。
3. **`venue-objects.spec.ts` 邊界測試新增了 zoom-out 前置操作**(30 次 wheelZoomAt 錨定 (0,0) + stageScale 斷言),超出「僅改數值與標題」的字面範圍 — 但為必要配套(199.9 在預設 50m 視圖點不到),clamp-to-boundary 斷言意圖不變,認可並已在該測試留有理由註解。

## Security Assessment

- Secrets scan: PASS(全 diff 無 secrets/tokens/credentials;`venue-zoom-pan.spec.ts` 全程 page.route mock,無登入、無硬編帳密)
- Input validation: PASS(座標一律經 `snapPoint`/`clampToBounds`(0–200)既有防呆;`zoomTo` 有 `Number.isFinite` + clamp、`getRelativePointerPosition` null 走既有 `if (!pointer) return;`;無新增使用者輸入面)
- Auth/authz: N/A(未觸及 auth/session/`DATABASE_URL`/proxy.ts/API 保護 — 無自動 🔴 觸發)
- `src/lib/ai/` 專項: PASS(`import "server-only"` 不動、SYSTEM_PROMPT 維持凍結 template literal 零插值、cache 斷點結構不動、client 端無 `src/lib/ai/*` import、system.ts 與 tools.ts 同一 working tree 將同 commit)
- CORS/CSP: 未修改
- Test coverage: 新功能由 `venue-zoom-pan.spec.ts` 9 案完整覆蓋(對齊 AC 逐條),3 支既有 spec 邊界常數 50→200 配套,`PlanEditorPage.meterToScreen` transform 感知後既有呼叫端零改動;developer 已回報全套迴歸 113 passed(playwright stage 將再驗)

## Plan Compliance

- [x] All architect plan steps implemented(Steps 1–14 逐項核對:PLAN_AREA_SIZE_M/baseline、view state/zoomTo/wheel/pan、4 處遷移 + 2 類「明確不遷移」遵守、UI 移除清單全數(state/handler/JSX/import 無殘留,grep 驗證)、getSnapshot/applyLoadedPlan/VenueSceneLoader 配套、viewFitSizeM(預設回退 venueSizeM,既有呼叫端不變;ground plane/clamp 仍用 venueSizeM)、AI 尺寸字串 3+4 處(grep 無 `0-50`/`50x50`/`50 公尺` 殘留)、page object、9 案新 spec)
- [x] Implementation matches plan intent(pan 區隔機制、MIN_SCALE=0.25/MAX_SCALE=4、步進 1.06/1.25、按鈕錨點畫布中心、背景 Rect 200*ppm、data-stage-* hooks、zoom UI 復用 segmentClassName,皆與定案一致)
- [ ] No unauthorised scope additions — **家具九種擴充混入(🟡 Issue 1,判定為使用者既有工作,非 agent 越界;commit 時人類處置)**

## Conversation Log

| Issue | Developer Response | Resolution |
|---|---|---|
| 🟡 Issue 1(計畫外家具擴充) | 非 developer agent 產出(pipeline 啟動前即存在的使用者 working tree 變更),無程式碼修正需求 | 內部一致性/安全規則已由 reviewer 核畢;處置(同 commit 或分拆)留待人類 commit 時決定,已記錄 |
