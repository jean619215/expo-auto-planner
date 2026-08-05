# 接續執行備忘 — story `stories/venue-refined-3d.md`(精密 3D 場景 步驟 03)

> 最後更新:2026-08-04。這份是「隔一陣子回來要怎麼接下去」的入口,
> 逐階段細節仍在 `.claude/pipeline/task-log.md`。

## 進度總覽(7 個 task)

| # | task | 狀態 |
|---|---|---|
| 1 | 步驟 03 骨架 + 唯讀 `RefinedScene` | ✅ 完成 `c7c06c5` |
| 2 | 打光與陰影(VSM soft shadow) | ✅ 完成 `571330f` |
| 3 | 程序化 PBR 材質(地板/牆/柱) | ✅ 完成 `127ce70`,全迴歸 172 passed / 1 skipped |
| 4 | 家具模型 asset pipeline | ✅ 完成 `76937e9` + `c54166b` |
| 5 | 匯入 6 種真實家具模型 | 🔴 **進行中,有 2 個紅燈** — 見下方 |
| 6 | 3 種展場家具程序化幾何(counter / bannerStand / podium) | ⬜ 未開始 |
| 7 | 效能與驗收 | ⬜ 未開始 |

## Task 4 已完成的部分

- `scripts/build-venue-models.mjs` — 從 Poly Haven 下載 6 個 CC0 模型的 1k
  glTF,經 `dedup → prune → webp(q85) → draco` 轉成單檔 GLB。
  只在換模型/調參數時手動跑,build/CI 不執行。
- `public/models/venue/{table,chair,cabinet,sofa,plant,display}.glb`
  — 11.3MB 原始檔壓到 **2.78MB**。
- `public/models/venue/ATTRIBUTION.md` — CC0 授權與來源記錄(腳本自動產生)。
- devDependency 新增 `@gltf-transform/cli@4`、`sharp`;`.gitignore` 排除
  `/.cache`(原始下載快取)。

### 模型挑選結果

先用語意過濾(家具/植栽類別),再比對模型原生長寬高與 `FURNITURE_DEFAULTS`
目標尺寸的**比例殘差**(三軸 log 比例對最佳等比縮放的 RMS 殘差,0 = 形狀
完全同比例)—— 因為家具只能等比縮放,比例差越遠、縮進目標框後空隙越大。

| kind | Poly Haven slug | 比例殘差 | Y 旋轉 | 三角面 | GLB |
|---|---|---|---|---|---|
| `table` | `wooden_table_02` | 0.049 | 0° | 196 | 0.27MB |
| `chair` | `painted_wooden_chair_02` | 0.020 | 0° | 1,246 | 0.52MB |
| `cabinet` | `drawer_cabinet` | 0.103 | **90°** | 26,406 | 0.25MB |
| `sofa` | `sofa_02` | 0.063 | 0° | 2,728 | 0.20MB |
| `plant` | `potted_plant_01` | 0.051 | 0° | 96,030 | 1.32MB |
| `display` | `wooden_display_shelves_01` | 0.157 | 0° | 3,174 | 0.21MB |

`cabinet` 的 90° 與 story 原文一致 —— 模型原生 1.141 × 0.488(長邊在 X),
平面圖目標 0.6 × 1.2(長邊在 Y),必須轉 90° 才對得上。

### 兩個要留意的判斷

1. **KTX2 被拿掉了,改用 WebP。** story 原文寫「GLB + Draco + KTX2」,但
   KTX2 需要 (a) 打包期原生編碼器 `toktx`/`basisu` —— 本機與 CI 皆未安裝,
   (b) 執行期把 basis transcoder 的 wasm/js 自架到 `/public` 並接 `KTX2Loader`。
   步驟 03 有「零外部下載」硬規定,(b) 是實打實的成本。而 KTX2 的真正好處是
   GPU 記憶體常駐壓縮,在 6 個模型 / 1k 貼圖的量級下 GPU 記憶體不是瓶頸。
   判斷:先 WebP,日後模型數或貼圖解析度上升到 GPU 記憶體吃緊再補 KTX2。
   理由已寫在腳本檔頭。
2. **`plant` 是最重的一個**(1.32MB,原生 96k 面,其中單一 mesh 就 106,900
   三角面)。story 要求植栽單獨 lazy load —— 這個數字就是理由,task 5 不要
   把它跟其他 5 個併在同一個載入批次。

## ⚠️ Task 5 目前狀態 — 有 2 個測試是紅的(接手第一件事就是修這個)

程式碼已 commit,**但不是綠的狀態**。`venue-refined-lighting.spec.ts` 兩個
既有案例退化:

```
案例4  AC2: 投影/受影對象正確   expect(refinedShadowCasterMeshCount()).toBe(4)
                                Expected: 4   Received: 2   (spec:148)
案例10 edge case 高瘦物件        expect(refinedShadowCasterMeshCount()).toBe(2)
                                Expected: 2   Received: 1   (spec:281)
```

兩個都是「投影 mesh 少了家具那幾個」。差值剛好等於場上家具數,牆與柱的計數
都還在,所以問題侷限在新的家具模型繪製路徑。

**最可能的原因(尚未證實,接手請先驗這條)**:`RefinedSceneProbe.tsx:53` 有
`PROBE_ACTIVE_FRAMES = 120` 的探針停止上限(task 2 review 為了避免探針每幀
traverse 而加的)。GLB 走 `useGLTF` + Draco WASM worker 解碼是非同步的,在
CI/SwiftShader 上很可能超過 120 frame(約 2 秒)才 mount 完 —— 探針早就停了,
於是 `<Instances>` 產生的 `InstancedMesh` 從來沒被數到。

要區分是「時序」還是「castShadow 真的沒套上」,最快的做法是把
`PROBE_ACTIVE_FRAMES` 暫時調大重跑:
- 調大就綠 → 時序問題。正解不是永久調大(那會把 task 2 的效能修正倒回去),
  而是讓探針在家具模型載入完成後**重新武裝一次**(現有機制是 `resetKey`,
  可以把 `data-furniture-models-loaded` 的那個 `eagerLoaded` 狀態接進去)。
- 調大還是紅 → `castShadow` 沒有真的套到 drei `<Instances>` 產生的
  `InstancedMesh` 上,要改在 `furnitureModels.tsx` 直接處理。

另外注意:`InstancedMesh` 繼承 `Mesh`,`isMesh` 為 true,所以探針
(`RefinedSceneProbe.tsx:596`)的判斷式本身沒問題,不用往那邊查。

**其餘 38 個 refined 案例是綠的**,`npm run lint` 與 `tsc` 乾淨(排除既有的
`app/api/plans/[slot]/conversation/route.ts` 與 `.next/dev/types` 雜訊)。
**完整迴歸(17 支 spec)在這次改動後還沒跑過。**

### Task 5 已經做完的部分

- `public/draco/`(`draco_wasm_wrapper.js` + `draco_decoder.wasm`,自 three
  0.185.1 複製)。**必須自架** —— drei 的 `useGLTF` 預設把 decoder path 指向
  `gstatic.com`,違反步驟 03 的零外部下載規定。複製動作已寫進
  `scripts/build-venue-models.mjs` 的 `copyDracoDecoder()`,升級 three 後重跑
  該腳本即可。`eslint.config.mjs` 已把 `public/draco/**` 排除(vendored 壓縮檔)。
- `src/components/venue/furnitureModels.tsx` — 載入、正規化、instancing。
  - `normalizeModel()` 把 GLB 節點的世界矩陣、模型方位修正(`rotationY`)、
    等比縮放與置中**全部烘進 geometry 頂點**。這樣做的原因:drei `<Instances>`
    只吃單一 geometry + material,GLB 自身的節點階層變換會整個被丟掉。烘完
    之後每個 `<Instance>` 只需要負責「擺哪裡、轉幾度」。
  - 座標約定沿用既有 box 版本:底面貼 y=0、水平以原點為中心。
  - clone 出來的 geometry 在卸載時 `dispose()`;material **沒有** clone
    (沿用 GLB 的),其生命週期歸 `useGLTF` 快取管,不要去 dispose 它。
- `RefinedScene.tsx` 接線:六種有模型的家具走 GLB,另外三種
  (counter / bannerStand / podium)維持 box 並掛上 `REFINED_FURNITURE_BOX_NAME`,
  等 task 6 接手。兩者互斥,同一件家具不會被畫兩次。
- 植栽獨立一個 `<Suspense>`,而且要等 eager 那批 commit 後才掛
  (`LoadedSignal` 元件偵測 boundary 真的解完)。
- 新增對外量測屬性:`data-furniture-models-loaded`、
  `data-furniture-model-reports`(每個 kind 的 `scale` / `fittedM` / `targetM` /
  `partCount` / `instanceCount`)。**`scale` 是單一數字,這正是「等比縮放、
  沒有非等比拉伸」的可斷言證據**,task 5 的驗收 spec 應該從這裡下手。

### Task 5 還沒做的部分

- [ ] 修上面那 2 個紅燈。
- [ ] 重跑一次 `node scripts/build-venue-models.mjs` 確認整支腳本(含 6 個 GLB
      的重新轉檔)在修正後仍然跑得完。`copyDracoDecoder()` 本身已驗證可用
      —— `public/draco/README.md` 正確寫出 `three@0.185.1`。修正內容:原本用
      `require.resolve("three/package.json")` 會拋
      ERR_PACKAGE_PATH_NOT_EXPORTED(three 的 exports 沒列 package.json),
      已改成直接讀 `node_modules/three/package.json`。
- [ ] 寫 task 5 自己的驗收 spec(目前一條都還沒有):六種 kind 各自的
      `scale` 三軸一致、`fittedM` 不超過 `targetM`、`cabinet` 的
      `rotationY=90` 確實讓長邊對上、植栽延後載入、往返步驟 02/03 不累積
      GPU 資源。
- [ ] 跑完整迴歸(17 支 spec)。
- [ ] 把 `venue-furniture-assets.spec.ts` 的 C1–C3 從「必然綠」變成真的有效
      —— 現在有程式碼會載 GLB 了,那三條線終於有意義,值得確認它們真的能紅
      (蓄意破壞:把載入提前到步驟 02)。

## Task 4 已完成 — 尚未做的部分(已全數補完,保留供追溯)

- [ ] `src/lib/venue/models.ts` — 純領域 manifest:`kind → { file, rotationY }`。
      **不得 import three/React**(AGENTS.md:`src/lib/venue/` 是純領域模組)。
      腳本裡的 `MODELS` 表是打包期用的,執行期要另有一份給場景讀。
- [ ] 決定 GLB 的載入邊界:`RefinedScene` 是唯讀場景且與步驟 02 互斥掛載,
      模型只能在進入步驟 03 時載入、離開時釋放。
- [ ] Playwright 驗收:至少要守住「步驟 01/02 完全不請求 `/models/venue/*.glb`」
      —— 這是 task 4 的核心驗收線,沿用 task 2/3 既有的網路請求攔截寫法
      (`venue-refined-materials.spec.ts` 的 T10)。

## Task 5–7 的既有約束(來自 AGENTS.md,實作前必讀)

- 家具尺寸**不可**由使用者調整,只能移動與旋轉;尺寸唯一來源是
  `FURNITURE_DEFAULTS` 的 `w` / `h` / `height3d`。匯入模型一律**等比**縮放到
  該尺寸,不得非等比拉伸變形;不加縮放把手、AI tool schema 不加 w/h 參數。
- `RefinedScene` 是唯讀場景:不持有幾何 `useState`、不掛 `TransformControls`、
  不回寫 `onSceneChange`;與步驟 02 互斥掛載(一次只有一個 WebGL context)。
- 不在 render 期間新建 geometry/material/texture,用 `useMemo` 快取並在卸載時
  `dispose()`。
- 重複家具用 drei `<Instances>`。
- `src/lib/venue/` 純領域;瀏覽器限定函式庫透過 `*Loader.tsx`(`ssr:false`)包一層。

## 已知技術債(不阻擋)

- task 3 review 的 🟡 Issue 6 未修:`venue-refined-materials.spec.ts` 的 T3
  牆面 UV 守衛複製了實作的「面 → 跨距」對照表,若 `BoxGeometry` 的 group
  順序改變,實作與測試會一起壞、測不出來。

## 環境備忘

- 所有 `npm`/`npx`/`node` 呼叫都要先接上 Node 22:
  `PATH="/Users/jeanchung/.nvm/versions/node/v22.21.1/bin:$PATH"`
  (系統預設是 v10,直接跑會失敗)。
- `src/app/api/plans/[slot]/conversation/route.ts` 有 **既存的** tsc 錯誤
  (TS2344/TS2339),在乾淨的 `571339f` 上就存在,與本 story 無關 —— 不要動它,
  也不要把它當成自己改壞的。
- 分支 `feat/ai-planner` **沒有 upstream**,所有 commit 都只在本地。
