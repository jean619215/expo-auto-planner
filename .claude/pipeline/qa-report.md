# QA Report — [FRONTEND] 3 種展場家具程序化幾何 / venue-refined-3d.md task 6
> Generated: 2026-08-05T01:05+08:00 | QA iteration: 1

## Summary

- Tests executed: 8 new automated(`venue-procedural-furniture.spec.ts` P1–P8)+ 151 既有回歸(免登入的 14 支 spec)
- Passed: **159 / 159**
- Failed: 0
- Blocked: 5 支需帳密的 spec + 1 個 asset pipeline 驗證項目(見下方)

## Recommendation

**APPROVED** — 驗收條件全數有可斷言的證據,回歸零失敗,lint 與 tsc 乾淨。

review 階段抓到的 🔴(StrictMode 雙重建置導致一半資源永不釋放)已修並補上
回歸;本輪 QA 在修完之後重跑整套。

---

## Acceptance Criteria Results

| # | Criterion(story task 6) | Result | Evidence |
| --- | --- | --- | --- |
| AC1 | counter / bannerStand / podium 為**可辨識的**程序化造型 | ✅ PASS | P2 斷言三者零件數皆 > 1(退回單一方塊立刻紅);「可辨識」本身無法自動斷言,由 P8 產出 `playwright-report/procedural-furniture.png` 供人工判讀 —— 已實際檢視:櫃檯有外伸檯面與內縮踢腳座、易拉寶有捲軸箱+支桿+布面、講台有傾斜讀寫台面與收窄立柱,三者輪廓互不混淆 |
| AC2 | 尺寸由 `FURNITURE_DEFAULTS` 驅動 | ✅ PASS | P1。三種家具的三軸外廓與標稱尺寸誤差 **0**(1mm 容差內)。刻意用「等於」而非「不超過」:程序化尺寸是自己算出來的,沒有匯入模型那種原生比例對不上的問題 |
| AC3 | 風格需與匯入模型協調 | ✅ PASS(結構性) | body/accent 直接沿用 `REFINED_SURFACE.furniture` 的粗糙度/金屬度基準 —— 與匯入模型共用同一組表面參數;顏色一律由該 kind 的 `FURNITURE_DEFAULTS.color` 推導(accent 壓深、panel 提亮),不引入獨立色票。只有易拉寶的鋁製捲軸箱與支桿給 metalness。P8 截圖中三件程序化家具與旁邊的匯入模型並置無違和 |
| AC4 | 不得與匯入模型重複繪製 | ✅ PASS | P3(一件程序化 + 一件匯入模型,投影件數為 2 而非 3);`RefinedScene` 的三條分支互斥(模型 → 程序化 → 白模保底);`venue-furniture-models` 的 M3 從另一側守同一條線 |
| AC5 | 往返 02↔03 不累積 GPU 資源 | ✅ PASS | P6。三趟往返後存活數仍是 9,**且 `totalBuilds` 一次都沒有再漲** —— 後者才是真正的證據:資源是被重用的,不是「每趟重建 + 每趟剛好釋放乾淨」 |
| AC6 | 步驟 03 的資源不得提早載入 | ✅ PASS | P5。只擺這三種家具時全程零 GLB 請求(含 1.5 秒安定窗口 —— 否定斷言讀太快會恆綠) |

## Edge Case Results

| Edge Case | Result | Notes |
| --- | --- | --- |
| 傾斜檯面的外廓佔用 | ✅ PASS | 講台的斜面是本 task 唯一的幾何陷阱:傾斜的板子在高度與深度兩個方向佔的空間都比自身尺寸大,直接 `d = h` 再轉 10° 會同時撐破深度與高度。實作反解出「傾斜後剛好等於 h」的板深、再把中心壓到「傾斜後最高點剛好等於 height3d」;`partExtentM()` 把傾斜投影算進外廓,P1 因此測得到 |
| 同 kind 多件 | ✅ PASS | P7(3 件講台只有 1 份報告、instanceCount 3、投影件數 3) |
| 程序化 + 匯入模型混場 | ✅ PASS | P3 |
| 既沒有模型也沒有程序化造型的 kind | ✅ PASS(結構性) | 白模 box 保底路徑保留,仍掛 `REFINED_FURNITURE_BOX_NAME`、仍被算進投影件數。目前九種家具都有造型,所以正常情況下不會產出這種 mesh —— 它是為日後往 `FURNITURE_DEFAULTS` 加新 kind 準備的 |

## Test Effectiveness（這輪額外做的事）

本 task 新增的 `data-procedural-furniture-stats`(three 自身 `dispose` 事件
驅動的存活計數)**第一次跑就抓到一個真缺陷**:預期 9 組、實際 18 組。

這件事值得記錄,因為它說明既有的資源檢查有盲區:

| 量測方式 | 看得到 StrictMode 的雙重建置嗎 |
| --- | --- |
| `gl.info.memory.geometries` | ❌ 被丟棄的 geometry 從未掛進場景圖、從未上傳 GPU,不計入 |
| `gl.info.memory.textures` | ❌ 這些 material 沒有貼圖 |
| `gl.info` 完全沒有 material 計數 | ❌ |
| three 自身 `dispose` 事件計數 | ✅ |

task 5 的 M6 與本 task 最初版本的 P6 都只讀 `gl.info.memory` —— 兩者都測不到。

## Blocked / 未涵蓋

| 項目 | 原因 | 建議 |
| --- | --- | --- |
| `ai-panel` / `membership-task7-task9` / `points-shop` / `profile-edit-mode` / `site-header` 5 支 spec | 本執行環境缺 `.env.playwright.local` 的 `PW_VERIFIED_EMAIL` / `PW_VERIFIED_PASSWORD`,這些 spec 在**檔案載入期**就 throw | 在有測試帳號的機器補跑。本 task 未觸及 auth / API / 付費路徑,風險低 |
| 重跑 `scripts/build-venue-models.mjs` 的下載階段 | `api.polyhaven.com` 被本環境的 egress policy 擋(CONNECT 403),依代理規範不得繞路 | 在有對外網路的機器補跑。task 6 完全沒有動這條路徑 |
| 「數十件家具下仍可流暢旋轉」的實際 FPS | 非互動式環境無法量測,軟體渲染下的數字不具代表性 | task 7(效能與驗收)處理 |

## 既有問題（非本 task 造成,不阻擋）

| 項目 | 說明 |
| --- | --- |
| 匯入模型那條路也有 StrictMode 雙重建置 | `furnitureModels.tsx` 仍是「`useMemo` 建立 + `useEffect` dispose」。被丟棄的那份 clone 從未上傳 GPU,所以沒有真正的 GPU 洩漏,但也確實從未被 dispose。task 7 可順手改成依 kind 快取,同時消掉「每趟往返重新 clone 96k 面植栽」的成本 |
| `venue-refined-materials` T14 | 純截圖、不斷言的案例,在改動前就會逾時(軟體渲染太慢),已於 task 5 加 `test.slow()` |
| `src/app/api/plans/[slot]/conversation/route.ts` 的 tsc 錯誤 | TS2344 / TS2339,在乾淨的 `571339f` 上就存在,與本 story 無關 |
| task 3 review 的 🟡 Issue 6 | `venue-refined-materials.spec.ts` T3 的牆面 UV 守衛複製了實作的對照表 —— 仍未修 |

## 執行紀錄

```
venue-procedural-furniture.spec.ts            8 passed
免登入全套（14 支 spec）                    159 passed / 0 failed（15.5 分鐘）
npm run lint                                  clean
npx tsc --noEmit                              clean（排除上述既有錯誤）
```
