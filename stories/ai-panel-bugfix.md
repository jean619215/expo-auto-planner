# Story: AI 助理面板 bug 修復與 UI 改版

## 說明
身為場地規劃器的使用者,我回報了 AI 助理面板的多個問題(Notion bug 卡「[BUG] AI助理功能」):點數資訊沒有顯示、面板版面不符期待、曾出現 AI 服務無法回應。希望修復並把面板改成右側可收合側欄,用起來更順手。

## 驗收條件
- 在場地規劃頁,AI 助理面板以**右側側邊欄**呈現,可展開/收合;收合時不遮擋編輯區,展開時與 2D/3D 編輯畫面並存。
- 面板開啟時即顯示**目前點數餘額**與**每次對話將扣除的點數**(`AI_CHAT_COST`,值來自後端,不在前端硬編);每次呼叫後餘額即時更新。
- 對話訊息(描述)區塊**不加外框**,視覺與整頁一致。
- 輸入需求的**輸入框加大**(多行 textarea,適合描述場地配置)。
- **圖片上傳改為按鈕**樣式(非原生 file input 外觀),點擊開檔案選擇器,行為不變(base64、3MB 上限、預覽、可移除)。
- 既有功能不退化:多輪對話、tool call 套用到編輯器、402 點數不足與錯誤顯示、scope guard — 既有 `ai-panel.spec.ts` 全數通過(page object 需隨 UI 改版同步更新)。
- `@paid` 真模型煙霧測試斷言強化:必須等到**助理回應的文字**出現才通過(不能只靠 optimistic user message 讓 `messages not empty` 成立),否則後端壞掉測試也會過(2026-07-21 已實際發生:測試綠但 server log 無任何 `/api/ai/chat` 請求)。

## 任務清單
- [x] [FRONTEND] AI 助理面板改版:右側可收合側欄、描述區去外框、輸入框改大 textarea、圖片上傳改按鈕、點數餘額+每次扣點顯示(扣點值由後端提供,方式由 architect 決定:併入既有 API 回應或新增輕量 config 端點)、`@paid` 煙霧測試斷言強化;Playwright 驗收(更新 AiPanelPage page object)

<!--
背景(2026-07-21 診斷):
- bug 卡第 6 點「AI 服務暫時無法回應(502)」已無法重現:probe 直打 Anthropic API 成功、
  登入後端到端打 /api/ai/chat 回 200 + 真實回應。根因研判為設定 ANTHROPIC_API_KEY 後
  dev server 未重啟(舊 process 無 key)。不需程式修改,但煙霧測試斷言弱到抓不到此類問題,
  故納入驗收條件強化。
- 點數扣點值 AI_CHAT_COST 是 server env;前端顯示需後端提供,嚴禁 NEXT_PUBLIC_ 重複定義造成漂移。
- 對應 Notion bug 卡:https://app.notion.com/p/3a44eb6d721a80b199a5c7cb4064057b
- 執行:/ship stories/ai-panel-bugfix.md
-->
