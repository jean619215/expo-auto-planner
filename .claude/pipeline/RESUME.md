# 接續執行備忘 — story `stories/venue-refined-3d.md`(精密 3D 場景 步驟 03)

> 最後更新:2026-08-04。這份是「隔一陣子回來要怎麼接下去」的入口,
> 逐階段細節仍在 `.claude/pipeline/task-log.md`。

## 進度總覽(7 個 task)

| # | task | 狀態 |
|---|---|---|
| 1 | 步驟 03 骨架 + 唯讀 `RefinedScene` | ✅ 完成 `c7c06c5` |
| 2 | 打光與陰影(VSM soft shadow) | ✅ 完成 `571339f` |
| 3 | 程序化 PBR 材質(地板/牆/柱) | ✅ 完成 `127ce70` |
| 4 | 家具模型 asset pipeline | ✅ 完成 `76937e9` + `c54166b` |
| 5 | 匯入 6 種真實家具模型 | ✅ **實作完成、全綠**,待 review / QA |
| 6 | 3 種展場家具程序化幾何(counter / bannerStand / podium) | ⬜ 未開始 |
| 7 | 效能與驗收 | ⬜ 未開始 |

## Task 5 已完成(接手可直接進 review)

實作 commit:`2ae97aa`(wip)→ `4cd5cb7`(修紅燈)→ `3077017`(驗收 spec)
→ `<本次最後一個 commit>`(T14 慢速標記)。

### 那兩個紅燈的真正原因(與原本的猜測不同)

原備忘猜是「探針 `PROBE_ACTIVE_FRAMES=120` 太早停」。把它調到 10 萬幀重跑,
**還是紅的** —— 所以那不是主因。實際上是三件事疊在一起:

1. **測試讀太早。** 兩條案例在 `data-lighting-ready` 之後就斷言,而那是探針
   第 2 幀就會設的;GLB 的 fetch + Draco worker 解碼要幾秒。它們讀到的是一個
   「還沒有家具」的場景。已加 `waitForFurnitureModels()` 閘門 + poll。
2. **探針確實會過期**(只是不是這次紅燈的主因)。120 幀之後不再重測,慢機器
   上模型掛載完就再也不會被算到。`resetKey` 已改成
   `revision | 已載入模型的簽章` 的複合鍵,載完會重新武裝。
3. **`shadowCasterMeshCount` 在匯入模型後失去意義。** 同 kind 的 N 件共用一個
   `InstancedMesh`(N 件算 1),而多 mesh 的 GLB 會拆成 partCount 個
   `InstancedMesh`(1 件算 partCount)—— **cabinet 是 5 個 part**,所以「2 件
   家具」在 mesh 數上是 6。AC2 要斷言的是件數,已新增按類別的
   `shadowCasterWallCount` / `ColumnCount` / `FurnitureCount`,家具那項照 kind
   分組、每組讀一次 `InstancedMesh.count` 還原真實件數。`<Instances>` 因此
   改名為 `refined-furniture-model:{kind}:{part}`。

### 新增的驗收 spec:`venue-furniture-models.spec.ts`(M1–M7,7/7 綠)

M1 等比縮放(六種 kind)/ M2 cabinet 方位修正 / M3 三種白模家具不重複繪製 /
M4 植栽延後(用 request/response 時序證明,不是只看順序)/ M5 只載場上有的
kind / M6 往返不累積 GPU 資源 / M7 同 kind 共用一個 `<Instances>`。

### C1–C3 從「必然綠」變成真的有效

用「把 preload 提前到步驟 02 的模組層」反證:**C3 立刻紅,但 C1/C2 仍是綠的**
—— 因為「零請求」是否定斷言,讀太快就一定綠。加了安定窗口
(`settleForStrayRequests`)之後,同一個反證讓 C2 也紅,另一個放在步驟 01 的
反證讓 C1 紅。三條線現在都證明過可以紅。

### 順手清掉的死碼

`preloadEagerFurnitureModels` / `preloadDeferredFurnitureModels` 與
`EAGER_MODEL_URLS` / `DEFERRED_MODEL_URLS` 全數移除 —— 沒有任何地方呼叫,而
它們的使用限制(只能在步驟 03 呼叫)正是 C1–C3 在防的事。Suspense 邊界本來
就已經正確地做到「進 03 才載、植栽延後」。task 7 若真的需要預載,再刻意加回。

## Task 5 唯一沒做完的項目

- [ ] **重跑 `node scripts/build-venue-models.mjs` 的下載階段。**
      在本次的執行環境跑不了:`api.polyhaven.com` 被 egress policy 擋掉
      (CONNECT 403),依代理規範不得繞路。
      **已驗證的部分**:`copyDracoDecoder()` 正常跑完並正確印出
      `three@0.185.1` —— 那正是原本被修過、風險最高的一段
      (`require.resolve("three/package.json")` 會拋
      ERR_PACKAGE_PATH_NOT_EXPORTED,已改成直接讀
      `node_modules/three/package.json`)。下載/轉檔那段自上次成功執行後
      未曾改動。在有對外網路的機器上補跑一次即可。

## 測試現況

- `venue-furniture-models` 7/7、`venue-refined-lighting` 14/14、
  `venue-refined-materials` 14/14、`venue-furniture-assets` 6/6。
- 免登入的 13 支 spec 全套:**150 passed / 0 failed**。
- 需要帳密的 5 支(`ai-panel` / `membership-task7-task9` / `points-shop` /
  `profile-edit-mode` / `site-header`)在本環境**沒有跑** —— 它們在檔案載入期
  就會因為缺 `.env.playwright.local` 的 `PW_VERIFIED_EMAIL` /
  `PW_VERIFIED_PASSWORD` 而 throw。有憑證的機器要補跑。
- `npm run lint` 與 `npx tsc --noEmit` 乾淨(排除既有的
  `app/api/plans/[slot]/conversation/route.ts` 與 `.next/dev/types` 雜訊)。
- ⚠️ `venue-refined-materials` 的 T14(純截圖、不斷言)在**修改前就已經**會
  逾時 —— 在 `ae0bb60` 上重現過,與 task 5 無關,是軟體渲染太慢。已加
  `test.slow()`,沒有動它任何步驟。

## Task 6–7 的既有約束(來自 AGENTS.md,實作前必讀)

- 家具尺寸**不可**由使用者調整,只能移動與旋轉;尺寸唯一來源是
  `FURNITURE_DEFAULTS` 的 `w` / `h` / `height3d`。匯入模型一律**等比**縮放到
  該尺寸,不得非等比拉伸變形;不加縮放把手、AI tool schema 不加 w/h 參數。
- `RefinedScene` 是唯讀場景:不持有幾何 `useState`、不掛 `TransformControls`、
  不回寫 `onSceneChange`;與步驟 02 互斥掛載(一次只有一個 WebGL context)。
- 不在 render 期間新建 geometry/material/texture,用 `useMemo` 快取並在卸載時
  `dispose()`。
- 重複家具用 drei `<Instances>`。
- `src/lib/venue/` 純領域;瀏覽器限定函式庫透過 `*Loader.tsx`(`ssr:false`)包一層。

### task 6 接手時直接可用的東西

沒有模型的三種家具目前掛 `REFINED_FURNITURE_BOX_NAME`(常數已搬到
`RefinedSceneProbe.tsx`,與其他 `REFINED_*_NAME` 放在一起)。程序化幾何接上去
之後,`shadowCasterFurnitureCount` 的 box 分支要一併改成新的名稱,否則那三種
家具會從件數統計裡消失。`venue-furniture-models.spec.ts` 的 M3 就是守這條線。

## 已知技術債(不阻擋)

- task 3 review 的 🟡 Issue 6 未修:`venue-refined-materials.spec.ts` 的 T3
  牆面 UV 守衛複製了實作的「面 → 跨距」對照表,若 `BoxGeometry` 的 group
  順序改變,實作與測試會一起壞、測不出來。

## 環境備忘

- 本次是在容器裡跑的(Node v22.22.2,`npm install` 需自己先跑一次)。原本
  備忘裡的 macOS nvm PATH 只適用於開發機:
  `PATH="/Users/jeanchung/.nvm/versions/node/v22.21.1/bin:$PATH"`。
- Playwright 瀏覽器:容器內只有 chromium-1194,而專案的 playwright 要 1228。
  用 `PLAYWRIGHT_BROWSERS_PATH` 指到一個放了 `chromium-1228` /
  `chromium_headless_shell-1228` 符號連結的目錄即可,不需要改
  `playwright.config.ts`。
- 步驟 02 放家具的可點擊地板很小(預設 10m x 10m,螢幕上是畫布中心附近一塊
  菱形):水平約 ±60px、垂直約 ±15px 之外就點空了。
  `venue-furniture-models.spec.ts` 的 `placeFurnitureOnStep2()` 每次都會驗證
  真的放上去了,新測試沿用它,不要自己寫一個不驗證的版本。
- `src/app/api/plans/[slot]/conversation/route.ts` 有 **既存的** tsc 錯誤
  (TS2344/TS2339),在乾淨的 `571339f` 上就存在,與本 story 無關 —— 不要動它,
  也不要把它當成自己改壞的。
