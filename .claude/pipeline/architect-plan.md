# Architect Plan — 場地規劃 AI 助理 / Task 3(最後 task)

> Task: [FRONTEND] AI 助理面板
> 性質:新實作。PlanEditor(src/components/venue/PlanEditor.tsx,1137 行)state 全在元件內部(polygon/walls/columns/furniture useState)。

## 整合方式(最小侵入)
AI 面板做成 **PlanEditor 子元件** `AiPanel`,經 props 接收:
- `plan: {polygon, walls, columns, furniture, venueSizeM}`(附帶目前配置用)
- `applyActions(actions: AiAction[]): AiActionResult[]`(PlanEditor 提供,內部走既有 setters + snap/clamp + createObjectId;回傳每個 action 成功/跳過)
不提升 state、不動 3D 同步機制(state 變更本來就會觸發)。

## 檔案配置
```
src/lib/ai-panel/actions.ts       — AiAction 型別(5種tool的input型別)+ parseToolUse(content blocks → AiAction[])
src/components/venue/AiPanel.tsx  — 面板 UI + 對話 state + fetch + 圖片處理
src/components/venue/PlanEditor.tsx — 掛 AiPanel + applyActions 實作(唯一改動點)
playwright-tests/ai-panel.spec.ts + pages/AiPanelPage.ts
```
(`src/lib/ai-panel/` 為 client 端,不掛 server-only;與 server 端 `src/lib/ai/` 分開,避免誤 import。)

## AiPanel 內部
- state:`messages: MessageParam[]`(API 原生格式)、`pending`、`error`、`balance`、`imageDraft`。
- 送出流程:組 user 訊息(文字 + 可選 image block + `[目前配置]` JSON 附錄)→ POST → 回應:
  1. text blocks → 渲染
  2. tool_use blocks → `parseToolUse` → `applyActions` → 摘要顯示 + `tool_result` blocks 併入下一則 user 訊息開頭(Anthropic 慣例:tool_result 必須在 user 訊息且對應 tool_use_id)
  3. `balance` 更新顯示
- 402:錯誤卡 + /shop 連結,輸入保留;其他錯誤:`ai-error` role=alert。
- 圖片:input file → FileReader base64,>3MB 拒;預覽縮圖;送出後清除。
- 注意:tool_result 未回傳前(使用者未再發話),歷史暫存 pending tool_result — 送下一則時合併。

## Playwright(mock 策略)
- `page.route('**/api/ai/chat', ...)` 依請求序回 fixtures:文字回應、generate_plan(4頂點+2桌)、402。
- 測試:開關面板、送訊息見回應、套用 generate_plan 後 2D 出現 2 個家具(讀 PlanEditor 既有 testid/DOM)、402 顯示與 /shop 連結、>3MB 圖片拒絕(構造 dummy 大檔)、loading disabled 狀態。
- 真模型煙霧:`test.skip(!process.env.PW_PAID_AI)` 一條 — 打真 API 問候語,斷言 200 與文字回應。
- 全套迴歸最後跑。

## 驗證步驟
1. tsc/lint
2. `npx playwright test ai-panel`(mock,不花錢)
3. 手動煙霧:dev server 真打一次(圖片可略)
4. 全套 Playwright 迴歸
5. project-doc.md 補 AI 段落(story 收尾)

## Escalation 檢查
- 無 API/schema/auth 變更。PlanEditor 是既有核心元件 — 改動限「掛面板 + applyActions」,不碰編輯邏輯。無 escalation。
