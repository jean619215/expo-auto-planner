# QA Report — [FRONTEND] 匯入 6 種真實家具模型 / venue-refined-3d.md task 5
> Generated: 2026-08-04T23:45+08:00 | QA iteration: 1

## Summary

- Tests executed: 8 new automated(`venue-furniture-models.spec.ts` M1–M8）+ 143 既有回歸（免登入的 13 支 spec）
- Passed: **151 / 151**
- Failed: 0
- Blocked: **5 支 spec 無法執行**（見下方 Blocked 段）+ 1 個 asset pipeline 驗證項目

## Recommendation

**APPROVED** — 驗收條件全數有可斷言的證據支撐,回歸零失敗,lint 與 tsc 乾淨。

review 階段抓到的 🔴（`<Instances>` 靜默截斷）已修並補上 M8 回歸;本輪 QA 在修
完之後重跑整套,151 全綠。

---

## Acceptance Criteria Results

| # | Criterion（story task 5） | Result | Evidence |
| --- | --- | --- | --- |
| AC1 | 等比縮放至 `FURNITURE_DEFAULTS` 的 `w / h / height3d` | ✅ PASS | M1。三段互補的證據:(a) 對外契約的 `scale` 是**單一純量** —— 非等比縮放在型別上就表達不出來;(b) 三軸皆 `fittedM / targetM ≤ 1`(1e-3 容差),沒有任何一軸溢出目標框;(c) 至少一軸 `≥ 1 - 1e-3`,擋掉「等比但縮得莫名其妙小」。六種 kind 逐一驗過 |
| AC2 | 不得非等比拉伸變形 | ✅ PASS | 同 AC1(a) —— 這是結構性保證,不是抽樣。`uniformFitScale()` 取三軸比值的**最小值**,回傳型別為 `number` |
| AC3 | `drawer_cabinet` 需轉 90° | ✅ PASS | M2。`fittedM` 的長邊落在 Z(1.092m > X 的 0.467m),且貼齊的那一軸就是長邊(`z / targetZ = 0.91 > 0.85`)。模型原生 1.141 × 0.488 長邊在 X,若 `rotationY: 90` 掉了,長邊會落回 X,兩條斷言都會紅 |
| AC4 | 重複家具用 drei `<Instances>` | ✅ PASS | M7(3 張椅子只產生 **1 份** model report,即共用同一組 geometry/material)+ M8(容量成長路徑正確,300 件全部繪製) |
| AC5 | 植栽單獨 lazy load | ✅ PASS | M4。斷言的是 **request/response 時序**而非單純的先後順序:`req:plant.glb` 的索引必須大於 `res:table.glb` —— 也就是 plant 的請求發生在 eager 那批**收完之後**,而不是只在它後面排隊。這正是「不綁在同一個 Suspense」的可觀測定義 |
| AC6 | 步驟 01/02 不得載入步驟 03 專用資源 | ✅ PASS | C1–C3,且**已用反證確認三條都真的能紅**（見下方 Test Effectiveness） |
| AC7 | 往返 02↔03 不累積 GPU 資源 | ✅ PASS | M6。三趟往返後 `gl.info.memory` 的 geometries 與 textures 與首次完全相同。這條同時證明 clone 出來的 geometry 有被 dispose、而 GLB 的 material 沒有被誤 dispose(誤 dispose 會讓後續往返貼圖數下降或報錯) |
| AC8 | 沒有模型的三種家具維持白模、不得被畫兩次 | ✅ PASS | M3。三件家具 → `data-furniture-mesh-count = 3`、model reports 為空陣列、投影家具件數為 3。若 box 分支與模型分支同時命中,件數會翻倍 |

## Edge Case Results

| Edge Case | Result | Notes |
| --- | --- | --- |
| 件數超過 `<Instances>` 初始緩衝區容量 | ✅ PASS（**修復後**） | M8。修復前實測:300 張椅子只畫得出 256 張,無錯誤、無警告,元件自報的 `instanceCount` 還是 300。這是 review 階段抓到的 🔴,現已修復並有回歸 |
| 只擺一種家具 | ✅ PASS | M5。只請求 `table.glb`,其餘五個 GLB 一個都沒拉 |
| 場上完全沒有有模型的家具 | ✅ PASS | M3（只有 counter/bannerStand/podium）—— eager Suspense 立即 commit,`data-furniture-models-loaded` 為 true,零 GLB 請求 |
| 家具數為 0 的空場景 | ✅ PASS | `venue-refined-lighting` 案例11(既有回歸,零 pageerror) |
| 慢速載入 / 探針過期 | ✅ PASS | 修復前 `PROBE_ACTIVE_FRAMES` 停止後家具永遠不被計入;`probeResetKey` 改為複合鍵後,模型載入完成會重新武裝探針 |

## Test Effectiveness（這輪 QA 額外做的事）

一般 QA 只確認測試綠。這次額外**反證**了三條否定斷言,因為「零請求」型的斷言
天生有「讀太快就恆綠」的風險:

| 反證 | 結果 |
| --- | --- |
| 在 `VenueScene.tsx`(步驟 02)模組層呼叫 preload | 加安定窗口**之前**:只有 C3 紅,C1/C2 仍綠（← 證明它們原本量不到東西）。加之後:C2 / C3 皆紅 ✅ |
| 在 `PlanEditor.tsx`(步驟 01)模組層呼叫 preload | C1 紅 ✅ |

結論:C1–C3 從 task 4 時的「必然綠」變成真的有鑑別力。反證用的改動已全部還原。

## Blocked / 未涵蓋

| 項目 | 原因 | 建議 |
| --- | --- | --- |
| `ai-panel` / `membership-task7-task9` / `points-shop` / `profile-edit-mode` / `site-header` 5 支 spec | 本執行環境缺 `.env.playwright.local` 的 `PW_VERIFIED_EMAIL` / `PW_VERIFIED_PASSWORD`,這些 spec 在**檔案載入期**就 throw | 在有測試帳號的機器補跑。本 task 未觸及 auth / API / 付費路徑,風險低 |
| 重跑 `scripts/build-venue-models.mjs` 的下載階段 | `api.polyhaven.com` 被本環境的 egress policy 擋(CONNECT 403),依代理規範不得繞路 | 在有對外網路的機器補跑。**已驗證**:`copyDracoDecoder()` 正常完成並正確認出 `three@0.185.1` —— 那正是先前被修過、風險最高的一段 |
| 「數十件家具下仍可流暢旋轉」的實際 FPS | 與 task 2 相同,非互動式環境無法量測,且軟體渲染下的數字不具代表性 | task 7（效能與驗收）處理。M8 已證明 300 件的**正確性**,效能另計 |

## 既有問題（非本 task 造成,不阻擋)

| 項目 | 說明 |
| --- | --- |
| `venue-refined-materials` T14 逾時 | 純截圖、不斷言的案例,在 `ae0bb60`（本 task 動手前）上重現過 —— 軟體渲染下光是後半段相機操作就超過預設 30 秒。已加 `test.slow()`,未刪改任何步驟 |
| `src/app/api/plans/[slot]/conversation/route.ts` 的 tsc 錯誤 | TS2344 / TS2339,在乾淨的 `571339f` 上就存在,與本 story 無關 |
| task 3 review 的 🟡 Issue 6 | `venue-refined-materials.spec.ts` T3 的牆面 UV 守衛複製了實作的對照表 —— 仍未修 |

## 執行紀錄

```
venue-furniture-models.spec.ts                8 passed
免登入全套（13 支 spec）                    151 passed / 0 failed（12.9 分鐘）
npm run lint                                  clean
npx tsc --noEmit                              clean（排除上述既有錯誤）
```
