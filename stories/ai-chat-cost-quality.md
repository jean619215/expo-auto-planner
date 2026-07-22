# Story: AI 助理對話成本與品質優化

## 說明
身為營運方,我希望 AI 助理每輪呼叫的 input token 不隨對話變長而失控(目前每輪 user 訊息都附一份場地配置 JSON、歷史中的圖片每輪重送),並希望助理的對話行為更精準(產生前先確認需求摘要、操作失敗要說明原因),以便控制成本並提升體驗。

## 驗收條件
- 送出請求時,`[目前配置]` JSON 附錄**只出現在最新一則 user 訊息**;歷史中舊 user 訊息的配置附錄在組請求時移除(前端顯示不變,只瘦身送出的 payload)。
- 歷史中的**圖片 block 只在其原始輪送出一次**;之後各輪組請求時,舊圖片 block 替換為文字佔位符(如「[使用者先前提供了參考圖]」)。前端訊息列表仍顯示原縮圖(本地 state 保留原圖,僅送出時替換)。
- 上述瘦身不影響功能:多輪對話、tool call 套用、402/錯誤處理等既有 `ai-panel.spec.ts` 全數通過;mock 測試可攔截請求 payload 驗證瘦身(舊輪無 image block、無配置附錄,最新輪有配置附錄)。
- 系統提示強化(`src/lib/ai/system.ts`,一次批次修改 — 每次改動 prompt cache 全失效,不得分次上線):
  - 引導問答收齊規格後,先以一句話摘要需求並請使用者確認,確認後才呼叫 `generate_plan`。
  - tool 操作若收到失敗的 `tool_result`,回應需說明失敗原因並提出替代方案,不得沉默略過。
  - 回應開頭不加寒暄/客套,直接進重點。
- 系統提示仍為凍結字串(無任何插值);scope guard 與既有領域規則段落保留,行為不退化。
- token usage 結構化 log 維持既有欄位;phase 1 不新增計量表。

## 任務清單
- [x] [BACKEND] 系統提示強化:`src/lib/ai/system.ts` 批次更新(確認摘要流程/失敗回饋/去寒暄),維持凍結字串與 cache 斷點;以 script 或 @paid 煙霧驗證 scope guard 未退化
- [x] [FRONTEND] 送出 payload 瘦身:組請求時舊輪移除配置 JSON 附錄與圖片 block(換佔位符),本地顯示不變;Playwright 以 route 攔截驗證 payload 形狀 + 既有套件迴歸

<!--
背景(2026-07-21 討論定案,story A 對話持久化延後):
- 現況成本問題:每輪 user 訊息附完整 [目前配置] JSON;圖片 base64(~最多 3MB→約 4k+ token/張)
  隨歷史每輪重送。對話越長浪費越大。
- 瘦身作用點在「組送出 payload」時,不動本地 state(顯示與續聊邏輯不變)— 之後做持久化(story A)
  時,落庫的是本地 state 形狀,兩者不衝突。
- 系統提示改動會使 prompt cache 失效一輪,批次改完一次上線。
- 執行:/ship stories/ai-chat-cost-quality.md
-->
