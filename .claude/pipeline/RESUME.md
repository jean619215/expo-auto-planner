# 接續執行備忘 — story `stories/venue-refined-3d.md`(精密 3D 場景 步驟 03)

> 最後更新:2026-08-05。這份是「隔一陣子回來要怎麼接下去」的入口,
> 逐階段細節仍在 `.claude/pipeline/task-log.md`。

## 進度總覽(7 個 task)

| # | task | 狀態 |
|---|---|---|
| 1 | 步驟 03 骨架 + 唯讀 `RefinedScene` | ✅ 完成 `c7c06c5` |
| 2 | 打光與陰影(VSM soft shadow) | ✅ 完成 `571339f` |
| 3 | 程序化 PBR 材質(地板/牆/柱) | ✅ 完成 `127ce70` |
| 4 | 家具模型 asset pipeline | ✅ 完成 `76937e9` + `c54166b` |
| 5 | 匯入 6 種真實家具模型 | ✅ 完成(review 抓到並修掉 1 個 🔴) |
| 6 | 3 種展場家具程序化幾何 | ✅ 完成(review 抓到並修掉 1 個 🔴) |
| 7 | 效能與驗收 | ⬜ **下一個** |

九種家具至此全部有造型:六種匯入 Poly Haven CC0 模型,三種程序化。

## Task 7 接手前一定要知道的三件事

### 1. 兩條繪製路徑是同構的,不要再分岔

匯入模型(`furnitureModels.tsx`)與程序化(`proceduralFurniture.tsx`)共用:
同樣的座標約定(底面貼 y=0、水平置中)、同樣用 drei `<Instances>`、同樣的
場景圖命名 `refined-furniture-instance:{kind}:{part}`。探針因此只有一套計數
邏輯。要加第三種來源的話,照這個介面接上去,不要另立命名。

### 2. `<Instances>` 的容量必須進 `key`(踩過的地雷)

drei 的 `<Instances>` 在**第一次 render** 就把 `limit * 16` 的矩陣緩衝區配置
好,之後改 `limit` prop **不會重配**,而多出來的 instance 會寫在 typed array
界外被靜默丟棄。task 5 原本寫死 256,實測讀入 300 張椅子的存檔只畫得出 256
張。現在統一走 `instanceLimit.ts` 的 2 冪次桶,**呼叫端必須把桶編進 `key`**。
回歸:`venue-furniture-models.spec.ts` 的 M8。

### 3. `gl.info.memory` 看不到 material —— 別再用它證明「有釋放」

`gl.info.memory` 只統計 geometries 與 textures。task 6 的程序化 material 是
自己 `new` 的,漏放在那裡完全看不見。而且 React StrictMode(Next.js 預設開啟)
會把 render 跑兩次、只 commit 一次,所以「`useMemo` 建立 + `useEffect` 卸載時
dispose」這個看似正確的寫法,**被丟棄的那一份永遠沒人 dispose** —— 實測預期 9
組、實際 18 組。

現在程序化資源改成**依 kind 的模組層快取**(`proceduralFurnitureStats.ts`),
上限 3 種 x 3 零件 = 9 組,不隨使用增長,而且往返步驟 02/03 完全不重建。
任何「資源有沒有釋放」的斷言請讀
`data-procedural-furniture-stats`(three 自身 dispose 事件驅動),不要只看
`gl.info.memory`。

**匯入模型那條路仍是「useMemo 建立 + useEffect dispose」**,所以同樣有
StrictMode 的雙重建置(只是那份 clone 從未上傳 GPU,`gl.info.memory` 也看不
見)。task 7 若要處理效能,這是一個現成的題目:把 `normalizeModel()` 的結果
也改成依 kind 快取,順便消掉「每趟往返重新 clone 96k 面植栽」的成本。

## Task 6 做了什麼

- `src/lib/venue/proceduralFurniture.ts` — **純領域**零件規格(不 import
  React/three):每種家具由哪些盒子/圓柱組成、擺哪、什麼表面處理,尺寸全部是
  `FURNITURE_DEFAULTS` 的 w / height3d / h 的函數。另有
  `proceduralFurnitureSizeM()` 可在沒有 WebGL 的情況下驗算外廓。
- `src/components/venue/proceduralFurniture.tsx` — 把規格變成 geometry /
  material 與 instancing。
- 造型:櫃檯 = 內縮踢腳座 + 主體 + 外伸檯面;易拉寶 = 捲軸箱 + 後方支桿 +
  布面;講台 = 底座 + 收窄立柱 + **傾斜讀寫台面**。
- 傾斜檯面是唯一的幾何陷阱:傾斜的板子在高度與深度兩個方向佔的空間都比自身
  尺寸大,直接拿 `d = h` 再轉 10° 會同時撐破深度與高度。實作反解出「傾斜後
  剛好等於 h」的板深,再把中心壓到「傾斜後最高點剛好等於 height3d」。
  P1 實測三軸誤差 0。
- 保底路徑仍在:既沒有模型、也沒有程序化造型的 kind 會退回白模 box
  (`REFINED_FURNITURE_BOX_NAME`),日後往 `FURNITURE_DEFAULTS` 加新 kind 時
  至少畫得出來,也仍然被算進投影件數。

## 測試現況

- `venue-procedural-furniture` 8/8(P1–P8)、`venue-furniture-models` 8/8、
  `venue-refined-lighting` 14/14、`venue-refined-materials` 14/14、
  `venue-furniture-assets` 6/6。
- 免登入的 14 支 spec 全套:見 `qa-report.md` 的執行紀錄。
- 需要帳密的 5 支(`ai-panel` / `membership-task7-task9` / `points-shop` /
  `profile-edit-mode` / `site-header`)在本環境**沒有跑** —— 它們在檔案載入期
  就會因為缺 `.env.playwright.local` 的 `PW_VERIFIED_EMAIL` /
  `PW_VERIFIED_PASSWORD` 而 throw。有憑證的機器要補跑。
- `npm run lint` 與 `npx tsc --noEmit` 乾淨(排除既有的
  `app/api/plans/[slot]/conversation/route.ts` 與 `.next/dev/types` 雜訊)。
- 人工判讀用截圖:`playwright-report/procedural-furniture.png`(P8 產出,
  不斷言)、`refined-lighting.png`、`refined-materials-*.png`。

## 仍未完成的事項

- [ ] **task 7:效能與驗收**(未開始)。
- [ ] **重跑 `node scripts/build-venue-models.mjs` 的下載階段**。本環境跑不了:
      `api.polyhaven.com` 被 egress policy 擋(CONNECT 403),依代理規範不得
      繞路。**已驗證**:`copyDracoDecoder()` 正常跑完並正確印出
      `three@0.185.1` —— 那正是原本被修過、風險最高的一段。下載/轉檔那段自
      上次成功執行後未曾改動,在有對外網路的機器補跑一次即可。
- [ ] 需帳密的 5 支 spec 補跑。

## Task 7 的既有約束(來自 AGENTS.md,實作前必讀)

- 家具尺寸**不可**由使用者調整,只能移動與旋轉;尺寸唯一來源是
  `FURNITURE_DEFAULTS` 的 `w` / `h` / `height3d`。匯入模型一律**等比**縮放到
  該尺寸,不得非等比拉伸變形;不加縮放把手、AI tool schema 不加 w/h 參數。
- `RefinedScene` 是唯讀場景:不持有幾何 `useState`、不掛 `TransformControls`、
  不回寫 `onSceneChange`;與步驟 02 互斥掛載(一次只有一個 WebGL context)。
- 不在 render 期間新建 geometry/material/texture,用 `useMemo` 快取並在卸載時
  `dispose()`。(程序化那條路改用模組層快取,理由見上方第 3 點。)
- 重複家具用 drei `<Instances>`。
- `src/lib/venue/` 純領域;瀏覽器限定函式庫透過 `*Loader.tsx`(`ssr:false`)包一層。

## 已知技術債(不阻擋)

- task 3 review 的 🟡 Issue 6 未修:`venue-refined-materials.spec.ts` 的 T3
  牆面 UV 守衛複製了實作的「面 → 跨距」對照表,若 `BoxGeometry` 的 group
  順序改變,實作與測試會一起壞、測不出來。
- 匯入模型那條路的 StrictMode 雙重建置(見上方第 3 點),task 7 可順手處理。
- 同一件程序化家具內相同表面處理會各自持有一個 material(櫃檯的踢腳座與檯面
  都是 accent)。量級是每個 kind 至多 3 個,對 draw call 無影響,不值得為它
  加一層 finish→material 的間接性。

## 環境備忘

- 本次是在容器裡跑的(Node v22.22.2,`npm install` 需自己先跑一次;沒有
  `.env.local` 的話 `cp .env.example .env.local` 即可讓 dev server 起來 ——
  `/venue` 不是受保護頁面,不需要真的 Supabase)。原本備忘裡的 macOS nvm PATH
  只適用於開發機。
- Playwright 瀏覽器:容器內只有 chromium-1194,而專案的 playwright 要 1228。
  用 `PLAYWRIGHT_BROWSERS_PATH` 指到一個放了 `chromium-1228` /
  `chromium_headless_shell-1228` 符號連結的目錄即可,不需要改
  `playwright.config.ts`。
- 步驟 02 放家具的可點擊地板很小(預設 10m x 10m,螢幕上是畫布中心附近一塊
  菱形):水平約 ±60px、垂直約 ±15px 之外就點空了。兩支家具 spec 的
  `placeFurnitureOnStep2()` 每次都會驗證真的放上去了,新測試沿用它,不要自己
  寫一個不驗證的版本。
- 要在步驟 03 拍到看得清輪廓的截圖:先左鍵上拖把相機壓低到接近視平線,再滾
  **60 格左右**的滾輪 —— OrbitControls 每格只縮一小段,而預設相機距離 target
  約 47m、家具只有 1~2m 高,滾十幾格是完全不夠的(P8 的寫法可直接抄)。
- `src/app/api/plans/[slot]/conversation/route.ts` 有 **既存的** tsc 錯誤
  (TS2344/TS2339),在乾淨的 `571339f` 上就存在,與本 story 無關 —— 不要動它,
  也不要把它當成自己改壞的。
