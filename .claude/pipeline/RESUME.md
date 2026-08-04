# 接續執行備忘 — story `stories/venue-refined-3d.md`(精密 3D 場景 步驟 03)

> 最後更新:2026-08-04。這份是「隔一陣子回來要怎麼接下去」的入口,
> 逐階段細節仍在 `.claude/pipeline/task-log.md`。

## 進度總覽(7 個 task)

| # | task | 狀態 |
|---|---|---|
| 1 | 步驟 03 骨架 + 唯讀 `RefinedScene` | ✅ 完成 `c7c06c5` |
| 2 | 打光與陰影(VSM soft shadow) | ✅ 完成 `571330f` |
| 3 | 程序化 PBR 材質(地板/牆/柱) | ✅ 完成 `127ce70`,全迴歸 172 passed / 1 skipped |
| 4 | 家具模型 asset pipeline | 🟡 **進行中** — 產出物已完成,尚未接進場景 |
| 5 | 匯入 6 種真實家具模型 | ⬜ 未開始 |
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

## Task 4 尚未做的部分(接下去的第一件事)

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
