# Orchestrator Output — 場地規劃 AI 助理 / Task 2

> Story: stories/ai-planner-assistant.md
> Task 2 of 3: [BACKEND] `POST /api/ai/chat`
> Task type: **BACKEND**
> 性質:新實作。前端(task 3)之後才接,本 task 以 API 層驗收。

## 任務描述
AI 對話 API:接收前端帶來的完整對話歷史 + 可選圖片,後端注入系統提示與 tool 定義,先扣點後呼叫 Claude,回傳助理回應(含 tool calls)與 usage。

## API Contract

`POST /api/ai/chat`(受 proxy 保護,登入必須)

Request body:
```json
{
  "messages": [ /* Anthropic 原生 MessageParam[],由前端維護;user/assistant 交錯 */ ]
}
```
- 圖片:內嵌於 messages 的 content blocks(`{type:"image", source:{type:"base64", media_type, data}}`),不另設欄位。
- **系統提示絕不接受 client 傳入** — body 出現 `system` 欄位直接忽略(不報錯,防探測)。

Response 200:
```json
{
  "content": [ /* 助理回應 content blocks(text 與 tool_use)原樣轉發 */ ],
  "stopReason": "end_turn | tool_use | ...",
  "usage": { "inputTokens": n, "outputTokens": n, "cacheReadTokens": n },
  "balance": n  /* 扣點後餘額,前端顯示用 */
}
```

錯誤:
- 401 未登入(proxy + route 雙層)
- 400 body 非 JSON / messages 缺失或非陣列 / 超過大小上限
- **402 點數不足** `{ "error": "點數不足", "balance": n }` — 不呼叫模型
- 502 模型呼叫失敗(上游錯誤,含 refusal 之外的 API error)— **扣點已發生,phase 1 不退點,記 log**(取捨,見 Assumptions)

## Clarified Acceptance Criteria

### AC1 — 認證與輸入驗證
- 未登入 401;非 JSON 400;messages 非法 400。
- 請求大小上限(含 base64 圖):5MB,超過 400。

### AC2 — 扣點(先扣後呼叫)
- 每次呼叫固定扣 `AI_CHAT_COST` 點(env var,預設 10)。
- 用 task 1 `deductPoints`,`refId = ai:{server端uuid}`。
- `insufficient_balance` → 402 + 目前餘額;`duplicate` 理論不發生(uuid),發生視同 500。

### AC3 — Claude 呼叫
- `@anthropic-ai/sdk`,model 由 `AI_MODEL` env var(預設 `claude-sonnet-5`),API key `ANTHROPIC_API_KEY` env var。
- 系統提示(後端常數,凍結以吃 cache,`cache_control` 斷點置於系統提示尾):
  - 角色:展場場地規劃助理。
  - scope guard:僅回應場地規劃相關;離題禮貌拒絕並引導回主題。
  - plan schema 摘要:50x50m 場地、0.5m snap、floor polygon ≥3 頂點、牆/柱/家具(table/chair/cabinet)。
- Tool 定義(對齊 `src/lib/venue/plan.ts` / `furniture.ts` 型別;模型只回 tool call,執行在前端):
  - `generate_plan` — 完整配置(floor polygon + walls + columns + furniture),用於圖生成/引導問答收齊後
  - `add_furniture`、`move_item`、`remove_item`、`resize_floor` — 增量修改
  - 全部 `strict: true`(structured outputs 保證合法參數)
- 回傳 content blocks 原樣轉發(前端負責執行 tool call;本 API 單回合,不在後端跑 tool loop)。

### AC4 — scope guard 行為
- 離題輸入(如「幫我寫作文」)→ 模型拒絕並引導回主題(prompt 層,實測驗證)。
- 場地規劃輸入 → 正常回應或 tool call。

### AC5 — usage 記錄
- 每次呼叫後端結構化 log 一行:`{userId, refId, model, inputTokens, outputTokens, cacheReadTokens}`。不 log 對話內容、不 log 任何 key。

### AC6 — 安全
- `ANTHROPIC_API_KEY` 僅 env var;route 為 server 端;`.env.example` 補新變數(AI_MODEL/AI_CHAT_COST/ANTHROPIC_API_KEY 佔位)。
- proxy.ts:`/api/ai/chat` 屬保護路由 — 免改(fail-closed 預設),驗證確認即可。

## 驗證方式(BACKEND)
- dev server + fetch 腳本實測:401/400/402/200 各分支、扣點與餘額變化、重複請求不同 refId、scope guard 離題拒絕(真呼叫模型)、tool call 回傳格式、usage log 出現。
- 測試扣點事後 service_role 補回(insert 正 delta 沖銷或直接刪測試列)。
- tsc/lint + 全套 Playwright 迴歸。
- 真模型呼叫花錢 — 驗證用最小輸入,次數控制在個位數。

## Out of Scope
- 前端 UI 與 tool call 執行(task 3)、streaming、退點機制、對話落 DB、跨供應商 adapter。

## Assumptions
1. 502 不退點:phase 1 取捨(退點邏輯 + 冪等複雜化);log 足以人工補償。記錄於 route 註解。
2. 每次呼叫固定扣點(不按 token 計價)— 定價簡單,phase 1 夠用。
3. 單回合設計:tool call 由前端執行後,結果隨下一輪 messages 帶回(`tool_result` block),本 API 天然支援。
