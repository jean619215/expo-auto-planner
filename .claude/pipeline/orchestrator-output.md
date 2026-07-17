# Orchestrator Output — 場地規劃 AI 助理 / Task 3(最後 task)

> Story: stories/ai-planner-assistant.md
> Task 3 of 3: [FRONTEND] 場地規劃頁 AI 助理面板
> Task type: **FRONTEND**
> 性質:新實作。API 已就緒(`POST /api/ai/chat`,contract 見 route.ts / task 2 紀錄)。

## 任務描述
場地規劃頁加 AI 助理面板:對話 UI、前端 state 持有歷史、圖片上傳、tool call 執行層(套用到 PlanEditor 的 plan state 並同步 2D/3D)、點數/錯誤狀態,Playwright 驗收。

## Clarified Acceptance Criteria

### AC1 — 面板 UI
- 場地規劃頁(/venue)有 AI 助理開關(`ai-panel-toggle`),開啟顯示側欄面板(`ai-panel`):訊息列表(`ai-messages`)、輸入框(`ai-input`)、送出鈕(`ai-send`)、圖片上傳(`ai-image-input`)。
- 送出中:輸入與按鈕 disabled、loading 指示(`ai-loading`)。
- 面板顯示目前點數餘額(取自回應 `balance`,`ai-balance`)與每次呼叫成本提示。

### AC2 — 對話流程
- 歷史存前端 state,格式 = Anthropic 原生 content blocks(升級落 DB 不需改邏輯)。
- 送出:歷史 + 新訊息 POST `/api/ai/chat`;回應 append 助理訊息;text blocks 渲染文字。
- 圖片:選圖後預覽,送出時轉 base64 image block 併入該則 user 訊息;限制單張 ≤3MB,超過顯示錯誤不送出。
- 重新整理歷史消失 = 預期行為(phase 1)。

### AC3 — tool call 執行
- 回應含 `tool_use` blocks 時逐一執行,套用到 PlanEditor state 並同步 2D/3D:
  - `generate_plan` → 覆蓋 floor/walls/columns/furniture(id 由前端 `createObjectId()` 生成;數值過 snap/clamp 既有邏輯)
  - `add_furniture` → append(預設尺寸查 FURNITURE_DEFAULTS)
  - `move_item` / `remove_item` → 依 itemType+index 操作;index 越界 → 該操作跳過並在對話顯示警告
  - `resize_floor` → setPolygon(≥3 點,否則跳過+警告)
- 執行後對話中顯示動作摘要(`ai-action-summary`,如「已產生配置:4 頂點地板、2 件家具」)。
- 執行完把 `tool_result` block(成功/跳過訊息)加入歷史 — 下輪模型看得到結果。
- 每輪 user 訊息自動附帶目前配置 JSON(供模型 index 參照;附在訊息文字後,格式後端 prompt 已約定)。

### AC4 — 錯誤與點數狀態
- 402 → 顯示「點數不足」+ 目前餘額 + 商店連結(/shop),輸入的訊息保留可重送。
- 400/500/502 → 對話顯示錯誤(`ai-error`,role=alert),歷史不留失敗輪。
- 未登入(401)→ 引導登入(場地頁本身受 proxy 保護,理論上不會發生;防禦性處理)。

### AC5 — Playwright 驗收(acceptance gate)
- 新 spec `ai-panel.spec.ts` + page object `AiPanelPage.ts`。
- **模型呼叫 mock**:Playwright `page.route()` 攔截 `/api/ai/chat` 回固定 fixture(文字回應/tool_use 回應/402)— 驗收不花真錢、不 flaky。真模型煙霧測試一條(`@paid` tag,預設 skip,手動跑)。
- 覆蓋:面板開關、送訊息顯示回應、generate_plan fixture 套用後 2D 出現對應物件、402 顯示、輸入驗證。
- 全套既有 spec 無迴歸。

### AC6 — 規範
- 走 `/api/ai/chat`,不直呼 Supabase/Anthropic;shadcn 元件;testid 覆蓋斷言點;無秘密進前端。

## Out of Scope
- 對話落 DB、streaming、多 tab 同步、行動版排版優化。

## Assumptions
1. 面板整合方式(PlanEditor 子元件 vs 兄弟元件+state 提升)由 architect 定,以最小侵入為準。
2. 目前配置 JSON 附帶格式:user 訊息文字後附 `\n\n[目前配置]\n{json}`;token 成本可接受(配置小)。
3. 真模型煙霧測試不進 CI 門檻。
