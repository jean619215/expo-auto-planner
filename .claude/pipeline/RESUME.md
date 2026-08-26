# 接續執行備忘 — story `stories/venue-catalog-and-quote-draft.md`(第三輪:家具目錄與報價)

> 最後更新:2026-08-25(T1–T6 完成,T7 待開工)。
> 這份是「隔一陣子回來、或換一個 agent 接手要怎麼繼續」的入口。
> 逐階段細節在 `.claude/pipeline/task-log.md`,決策與驗收條件在 story 檔本身。

---

## 一分鐘現況

| 項目 | 狀態 |
|---|---|
| 第一輪(白模產生器)、第二輪(使用者回饋)| ✅ 已合併進 `master`(PR #12 / #13) |
| 第三輪 T1–T6(可編輯範圍 / 目錄 / 繪製 / AI schema / 程序化幾何 / 目錄擴充)| ✅ 完成 |
| 第三輪 T7–T9 | ⬜ 待開工,決策與驗收條件都已寫定 |
| 免登入 32 支 spec | ✅ 277 通過、0 失敗 |
| `npm run lint` / `npx tsc --noEmit` | ✅ 乾淨 |

**分支關係**:第三輪的所有工作都落在 `docs/venue-catalog-and-quote` 上(它已 merge 了
完整的 master,T1 的 PR #14 也合進這裡)。開 PR 時 **base 選 `docs/venue-catalog-and-quote`**;
整輪做完再一次合回 `master`。

---

## T1 做了什麼(動到座標/夾制之前必讀的三件事)

把固定的 `PLAN_AREA_SIZE_M = 200`(200m 見方)換成「攤位 + 5m 邊距」的可編輯範圍。
攤位錨在 `BOOTH_ORIGIN = (20,20)`,所以預設 3×3 攤位的範圍是 `[15,28]²`。

### 1. 可編輯範圍是矩形,型別重用 `FloorBounds`

夾制函式的簽章從 `sizeM: number` 全面改成 `area: FloorBounds`。`FloorBounds` 本來就是
「軸對齊矩形」的型別,既有的 `clampRectCenterToBounds` / `isRectOutsideBounds` /
`clampWallToBounds` 因此直接吃得下。**不要為同一個概念再開一個新型別。**

入口是 `planAreaFor(boothW, boothH, origin)`,住在 `src/lib/venue/plan.ts`。

### 2. 範圍必須錨在「使用者選定的攤位尺寸」,不能由地板即時推導 ⚠️

這是 T1 過程中最貴的一課,也最容易被下一個人「順手改回去」。

由 `polygon` 即時推導是最直覺的寫法,而它會構成**回饋迴圈**:拖曳頂點讓地板變大 →
範圍跟著變大 → 更大的範圍允許把頂點拖得更遠。實測**一次 8 步的拖曳就把 3m 攤位的
地板拉到 63m 外**。

現在的做法:`PlanEditor.tsx` 有一份 `boothBounds` state,只在「真正重新定義攤位」時
更新 —— 換 preset / 自訂尺寸 / 讀檔 / AI 重畫地板,共四處。頂點的自由編輯則在那圈
邊距內活動。`planAreaFor` 的註解裡寫了這個陷阱,**改動前先讀那段**。

### 3. 邊距是暫存區,不是禁區

換攤位尺寸時,物件是夾進**可編輯範圍**而不是攤位本身(`applyBoothSize` /
`outsideCountFor` 都是)。夾進攤位會把刻意放在邊距的家具一起吸回去,那就沒有暫存區了。
`venue-booth-preset` 的三個案例因此要用 30 那一帶的座標 —— 25 在 3×3 的範圍裡面,
不算超出。

---

## 動座標系時會踩到的地雷

### 九支 spec 共用的牆會「安靜地不存在」

`drawWall({ x: 5, y: 5 }, { x: 10, y: 5 })` 這個樣式散在九支 spec 裡。範圍改成
`[15,28]` 之後,兩端都被夾到同一點,`createWall` 回傳 `null`,**牆根本不會被建立** ——
而多數案例不斷言牆數,於是安靜地在一個沒有牆的場景上繼續跑,測試照樣綠。

T1 已經全部改成 `(20,20) → (25,20)`。**下次再動座標系,先 grep 一次這類樣式**,
不要只看測試有沒有紅。

### 探針不能拿來當夾制斷言的基準

破壞驗證時抓到兩個空守衛:柱子拖曳與頂點拖曳原本拿 `data-plan-area` 回報的範圍當
比較基準,把實作改回固定 200m 之後**實作與斷言一起漂移**,兩支照樣全綠。

夾制類斷言一律**寫死由規格算出來的邊界**(`venue-plan-area.spec.ts` 的
`MIN_EDGE_M` / `MAX_EDGE_M` = 15 / 28)。這條也已經寫進 `AGENTS.md`。

### 既有測試的更新量會超出 story 第六節的預估

story 第六節只點名 `venue-objects` / `venue-zoom-pan`。T1 實際還動到
`venue-dimensions`、`venue-plan-editor`、`venue-booth-preset`、`venue-3d-scene`、
`venue-column-offsets`、`venue-refined-lighting`。T3 的 `kind → code` 又動了十餘支,
排時間時把這塊算進去。

---

## 下一步:T7

> 家具目錄頁 UI:大類 → 子類 → 品項的三層導覽 + 搜尋,UIUX 近似競品。

驗收條件在 story 第五節。**資料層已經備好,不要在 UI 裡重算**:

- `catalogStats()` 回傳三層統計(每個大類/子類的件數、孤兒品項、空子類),
  **就是為了 UI 與測試共用同一份**而存在的。
- `subCategoriesIn(category)` / `itemsInSubCategory(sub)` 給第二、三層列表。
- `catalogItem(code)` / `requireCatalogItem(code)` 單筆查詢。
- 目前 23 個品項 / 4 大類 / 10 子類,沒有空子類、沒有孤兒(有測試守著)。

### 目錄現況與「加一個品項」怎麼做

七種程序化造型:`table` / `cabinet` / `displayCase` / `platform` / `counter` /
`bannerStand` / `podium`;仍走 GLB 的只有椅子、沙發、植栽。

**加尺寸變體只要加一筆目錄資料**,不必碰 `proceduralFurniture.ts` —— builder 以
造型為鍵,尺寸是參數。需要新造型時才加 builder 並在 `ProceduralShape` 加名字,
而且**造型要有識別特徵**:白模下只有一個盒子的話,櫃子與展示櫃分不出來(所以
櫃子有把手橫料、展示櫃有層板、展台沒有腳)。

**注意**:幾何快取以 `code` 為鍵。兩個尺寸變體共用造型但不共用 mesh,快取若改
以造型為鍵,第二個變體會拿到第一個的幾何。

### AI 那條路徑目前的樣子(動它之前先看這裡)

- tool schema 的 `code` 是**自由字串**,沒有 enum —— 目錄會長大,enum 跟著改動
  會讓 prompt cache 前綴每次失效。
- 模型從**每輪的目前配置附錄**知道有哪些代碼。不要把目錄搬進 system prompt 或
  tool description —— 那兩者在快取前綴裡,搬過去等於把 enum 的問題原樣搬回來。
- **附錄成本已量測**:23 項 = 1,770 bytes(約 550 tokens/輪),還很便宜;
  233 項推估約 18KB(約 5,600 tokens/輪)。`venue-catalog-structure` 有一道 8KB
  的門檻檢查,超過就會紅並提示「該改成給模型一支查詢工具了」。**在那之前不要
  先做查詢工具。**
- 代碼合法性由套用端(`PlanEditor` 的 `applyActions`)查目錄,查不到就跳過該一件
  並回報,**不中斷同一批的其他 action**。

**改 schema 時,fixture 要一起改。** 三處在用:`ai-panel-persistent`、
`venue-refined-materials` T14、`ai-panel`(需帳密)。只改一邊的症狀是 handler
丟例外、`applyActions` 整個掛掉、面板不渲染,而測試只說「找不到 ai-action-summary」
—— 指不到真正的原因。T3 踩過一次,T4 改 schema 時又驗證了一次。

### `CatalogGeometry.rotationY`:目前沒人用,但有測試看著

原本只有 cabinet 用到,T5 把它改成程序化之後就空了。**欄位沒有刪**(模型本來就
可能以任意方位匯出),改成由 `venue-catalog-structure` 的一道檢查明說「目前沒有
任何 model 品項需要方位修正」。哪天有品項用上非零值,那裡會紅 —— 那是在提醒
**補一支驗方位的測試**,不是叫你把數字改回 0。

---

## 環境:怎麼把測試跑起來(實測可用)

```bash
npm install
cp .env.example .env.local     # /venue 不是受保護頁面,不需要真的 Supabase
npm run dev
```

**Playwright 瀏覽器**:專案要 chromium-1228,容器裡只有 1194。用
`PLAYWRIGHT_BROWSERS_PATH` 指到自建目錄即可,**但 1228 的 headless shell 換了路徑與
檔名** —— 整個目錄直接做符號連結會失敗,要建出:

```
$SP/pw-browsers/chromium-1228                -> /opt/pw-browsers/chromium-1194
$SP/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-linux64/
    chrome-headless-shell                    -> .../chromium_headless_shell-1194/chrome-linux/headless_shell
    (同目錄其餘檔案也要逐一連結,並在上層 touch INSTALLATION_COMPLETE)
```

跑測試要帶 `NO_PROXY=localhost,127.0.0.1`,否則連不到 dev server。

**全套約 33 分鐘,超過單一指令的 10 分鐘上限** —— 分兩批跑或丟背景,
**不要接 `| grep`**(會讓輸出緩衝到結束才寫出,也丟掉錯誤細節)。

### 這台機器沒有 GPU,3D 測試慢 3–4 倍

走 SwiftShader 軟體算圖。掛一次步驟 03 的場景要十幾秒,整批連跑更久。壓在預設
30s(或內層 10s poll)邊緣的測試會**偽裝成隨機 flake** —— 同一份程式換台機器就翻面。

已經編列過預算的:`venue-procedural-furniture` P6/P8、`venue-refined-lighting`
案例12/14、`venue-refined-materials` T7 與其材質 poll、`venue-wall-height` 的兩支
步驟 03 案例、`waitForLightingReady`(10s → 30s)。新寫的重量級 3D 測試比照辦理,
並在註解寫下實測耗時。

---

## 仍未完成(兩項都是環境限制,不是程式問題)

- **需帳密的 5 支 spec 未跑**(`ai-panel` / `membership-task7-task9` / `points-shop` /
  `profile-edit-mode` / `site-header`)。它們在檔案載入期就會因為缺
  `.env.playwright.local` 的 `PW_VERIFIED_EMAIL` / `PW_VERIFIED_PASSWORD` 而 throw。
- **`node scripts/build-venue-models.mjs` 的下載階段未重跑**。`api.polyhaven.com` 被
  egress policy 擋(CONNECT 403,已多次確認),依代理規範不得繞路。下載/轉檔那段自
  上次成功執行後未曾改動,在有對外網路的機器補跑一次即可。
- **三個不再使用的 GLB 未刪**(`table.glb` / `cabinet.glb` / `display.glb`)。
  T5 之後沒有品項會請求它們,但要刪得動該腳本的 `MODELS` 表並**重跑腳本重新產生
  `ATTRIBUTION.md`**(該檔開頭明寫「由腳本產生,請勿手改」)—— 與上一點是同一個
  被擋住的路徑。手改一份標明不可手改的產出物只會留下更難查的不一致,所以沒有做
  半套。連同下載階段一起在有對外網路的機器補跑。
- 上傳材質的持久化未做(第二輪決議如此,另立 story)。

---

## 更早幾輪的細節去哪找

- 第二輪(使用者回饋)的決議、驗收、踩雷紀錄:`stories/venue-feedback-round2-draft.md`
- 第一輪(精密 3D 場景)的七個 task:`stories/venue-refined-3d.md`
- 跨輪都適用的硬規則:`AGENTS.md`(特別是「場地規劃器:第二輪定案的約束」那一節)
