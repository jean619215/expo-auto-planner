# 接續執行備忘 — story `stories/venue-catalog-and-quote-draft.md`(第三輪:家具目錄與報價)

> 最後更新:2026-08-24(T1 完成,T2 待開工)。
> 這份是「隔一陣子回來、或換一個 agent 接手要怎麼繼續」的入口。
> 逐階段細節在 `.claude/pipeline/task-log.md`,決策與驗收條件在 story 檔本身。

---

## 一分鐘現況

| 項目 | 狀態 |
|---|---|
| 第一輪(白模產生器)、第二輪(使用者回饋)| ✅ 已合併進 `master`(PR #12 / #13) |
| 第三輪 T1(可編輯範圍)| ✅ 完成,已推上 `claude/work-status-review-wg0mmu` |
| 第三輪 T2–T9 | ⬜ 待開工,決策與驗收條件都已寫定 |
| 免登入 26 支 spec | ✅ 241 通過、0 失敗 |
| `npm run lint` / `npx tsc --noEmit` | ✅ 乾淨 |

**分支關係**:`claude/work-status-review-wg0mmu` 的基底是 `origin/docs/venue-catalog-and-quote`
(第三輪的規劃文件在那支上,且它已 merge 了完整的 master)。開 PR 時
**base 要選 `docs/venue-catalog-and-quote`**,選 master 會把規劃那 6 個 commit 一起帶進來。

---

## T1 做了什麼(以及接手 T2 前一定要知道的三件事)

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

## 動座標系時會踩到的地雷(T2/T3 高機率遇到)

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
`venue-column-offsets`、`venue-refined-lighting`。T2/T3 的 `kind → code` 影響面更大,
排時間時把這塊算進去。

---

## 下一步:T2

> 建 `src/lib/venue/catalog.ts` 資料層,9 個 kind 遷移成 9 個品項。純資料與型別,不動 UI。

驗收條件在 story 第五節。開工前必讀 story 的 D1（為什麼 `FurnitureItem` 只存 `code`）
與 D5（欄位形狀照廠商資料設計）。

T2 之後的 T3 會把 `kind` 換成快取鍵與探針分組鍵,那才是真正會讓一批測試轉紅的一步。

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
- 上傳材質的持久化未做(第二輪決議如此,另立 story)。

---

## 更早幾輪的細節去哪找

- 第二輪(使用者回饋)的決議、驗收、踩雷紀錄:`stories/venue-feedback-round2-draft.md`
- 第一輪(精密 3D 場景)的七個 task:`stories/venue-refined-3d.md`
- 跨輪都適用的硬規則:`AGENTS.md`(特別是「場地規劃器:第二輪定案的約束」那一節)
