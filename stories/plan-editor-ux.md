# Story: PlanEditor 操作體驗改善(zoom/pan + AI 面板常駐)

## 說明
身為場地規劃器的使用者,我希望 2D 平面圖可以用滾輪/按鈕直覺地縮放與平移(取代舊的「場地尺寸」編輯 — 那會清空整張圖,不直覺),並且切換到 3D 預覽步驟再回來時,AI 助理的對話不會消失、在預覽步驟也能繼續使用 AI 助理。

## 驗收條件
- 2D 畫布支援**縮放檢視**:滑鼠滾輪(以游標為錨點)與 +/− 按鈕;倍率夾在合理範圍(如 0.25x–4x);顯示目前倍率並提供重置(fit 預設視圖)。
- 2D 畫布支援**平移**:縮放後可拖曳畫布移動視圖(與既有「拖曳物件」操作不衝突 — 空白處拖曳=平移,物件上拖曳=移動物件,或以空白鍵/工具模式區隔,由 architect 定案)。
- 縮放/平移為**純視覺層**:物件公尺座標、儲存資料、AI 工具運算完全不受影響;所有既有互動(畫地板頂點、牆、柱、家具拖曳/旋轉、snap、雙擊加頂點)在任意縮放/平移狀態下座標正確(`getRelativePointerPosition` 遷移)。
- **移除「場地尺寸」按鈕、內嵌編輯器與其確認彈窗**(`venue-size-button`/`venue-size-editor` 及 sizeConfirm dialog);相關 Playwright 測試同步移除/改寫。
- **可規劃範圍固定為 200x200 公尺**(原 MAX 上限):預設視圖 fit 中央 50x50 區域(與現行預設視覺一致),zoom out 即可使用更大空間;既有存檔(venueSizeM ≤ 200)讀檔後正常顯示與編輯,不需資料遷移。
- AI 系統提示中場地尺寸描述同步更新(50x50 → 200x200,批次一次修改 — prompt cache 失效一輪,不得分次)。
- **AiPanel 跨步驟常駐**:編輯 ↔ 3D 預覽切換,對話 state 完整保留(不 unmount);**3D 預覽步驟也顯示 AI 側欄且可對話**,AI 的 tool call 修改在預覽步驟同樣套用並即時反映到 3D。
- 既有功能不退化:存檔/讀檔、payload 瘦身、續聊還原等全套 Playwright 迴歸通過。

## 任務清單
- [x] [FRONTEND] 2D 畫布 zoom/pan:Konva Stage scale/position + 滾輪/按鈕/重置 UI、指標座標全面遷移 `getRelativePointerPosition`、移除場地尺寸編輯器與確認彈窗、可規劃範圍固定 200x200(預設視圖 fit 中央 50x50)、AI 系統提示尺寸描述批次更新;Playwright 驗收(縮放狀態下互動座標正確 + 迴歸)
- [ ] [FRONTEND] AiPanel 跨步驟常駐:掛載點提升至步驟切換之外(CSS 控制顯示),3D 預覽步驟顯示側欄並可對話、tool call 套用即時反映 3D;Playwright 驗收(切步驟對話保留、預覽步驟下指令)

<!--
背景(2026-07-22 討論定案):
- 使用者回報:跳到 3D 預覽再回來,AI 對話消失 — 根因:AiPanel 掛在編輯步驟版面內,步驟切換 unmount。
  選項 (b):預覽步驟也顯示側欄可對話。
- zoom 技術基礎:Konva 原生 Stage scaleX/scaleY + draggable;滾輪縮放至游標為官方食譜。
  主要工作量在既有 getPointerPosition → getRelativePointerPosition 的座標換算遷移與逐互動驗證。
- 移除場地尺寸編輯是使用者明確要求;取捨:可規劃範圍固定 200x200(原上限),
  zoom 取代「改尺寸」心智模型,並消除「改尺寸清空整張圖」的破壞性操作。
  venueSizeM 欄位保留於存檔資料(相容舊檔),新存檔一律 200。
- AI 系統提示 50x50 描述需同步改 200x200(system.ts 批次一次,cache 失效一輪)。
- 執行:/ship stories/plan-editor-ux.md,任務由上到下逐一跑完整 pipeline。
-->
