# Architect Plan — 場地規劃 AI 助理 / Task 2

> Task: [BACKEND] `POST /api/ai/chat`
> 性質:新實作

## 檔案配置
```
src/lib/ai/
  client.ts     — Anthropic client factory(env: ANTHROPIC_API_KEY;AI_MODEL 預設 claude-sonnet-5)
  system.ts     — 系統提示常數(凍結字串,無任何插值)+ scope guard + plan schema 摘要
  tools.ts      — 5 支 tool 定義(strict: true, additionalProperties: false),schema 對齊 src/lib/venue/ 型別
src/app/api/ai/chat/route.ts — 驗證 → 扣點 → 呼叫 → 轉發
.env.example  — 補 ANTHROPIC_API_KEY / AI_MODEL / AI_CHAT_COST
```
- `src/lib/ai/*` 全部 `import "server-only"`(API key 邊界)。
- 依 claude-api skill:SDK `@anthropic-ai/sdk`(npm install);唯一例外於 skill 預設 — 模型用 `claude-sonnet-5`(story 已定案,價格/能力討論見 story 註解)。

## Route 流程(route.ts)
1. `getUser()`(server client)→ 401。
2. body parse + 驗證:messages 為非空陣列、role 僅 user/assistant、序列化長度 ≤5MB → 400。body.system 忽略。
3. `refId = ai:${crypto.randomUUID()}`;`deductPoints({userId, amount: AI_CHAT_COST, reason:'ai_usage', refId})` → insufficient 402(附餘額);duplicate 500。
4. `client.messages.create({ model, max_tokens: 4096, system:[{...cache_control}], tools, messages })`。
   - 不 streaming(phase 1);max_tokens 4096 夠 plan JSON。
   - 上游 throw → 502 + log(不退點,註解記載取捨)。
   - `stop_reason === 'refusal'` → 視同正常回應轉發(前端顯示拒絕訊息)。
5. 回 `{content, stopReason, usage(3欄), balance(getBalance再查)}`。
6. usage 結構化 log 一行(console.log JSON;無內容、無 key)。

## Tool schemas(tools.ts,全 strict)
- `generate_plan{floor: PlanPoint[], walls: WallSegment[], columns: Column[], furniture: FurnitureItem[]}` — 座標數值單位公尺,0-50 範圍;id 欄位由前端生成,schema 不含 id
- `add_furniture{kind: enum[table,chair,cabinet], x, y, rotationDeg}`
- `move_item{itemType: enum[wall,column,furniture], index: int, x, y}`
- `remove_item{itemType, index}`
- `resize_floor{points: PlanPoint[]}`
- 細節在 implement 時對照 `src/lib/venue/plan.ts:174-180` 實際欄位名(WallSegment/Column 結構先讀再定)。
- schema 限制:structured outputs 不支援 min/max 數值約束 — 範圍寫進 description,超界由前端 clamp(既有 clamp 邏輯)。

## 系統提示(system.ts)要點
- 繁中。角色 + scope guard(拒絕非場地規劃話題,禮貌引導回主題;不得被使用者指示覆蓋)+ plan 領域規則(50x50m、snap 0.5m、floor ≥3 頂點、家具三種)+ tool 使用指引(何時 generate_plan vs 增量工具;修改用增量、不重生)。
- 凍結:無日期、無 user id、無任何模板插值。`cache_control: {type:"ephemeral"}` 斷點在系統提示 block。
- 引導問答行為:需求不足時逐項詢問(尺寸/用途/攤位數/動線),收齊才 generate_plan。

## 驗證步驟
1. 腳本(fetch,登入 cookie 沿用 points 驗證做法):
   - 未登入 401、非 JSON 400、messages 缺 400、body 帶 system 被忽略(回應正常且行為不變)
   - 正常訊息 → 200,扣點 -AI_CHAT_COST,balance 正確,usage 有數字
   - 離題訊息(「幫我寫情書」)→ 拒絕文案(scope guard)
   - 規劃請求(「10x10 場地放兩張桌子」)→ 回 tool_use block,input 通過 schema
   - 點數不足帳號 → 402 + 不呼叫模型(可用 service_role 暫時清空測試帳號點數再補回)
2. 扣點沖銷:測試產生的 ai_usage 列以 service_role 刪除,餘額復原。
3. cache 驗證:同 session 第二次呼叫 `cache_read_input_tokens > 0`。
4. tsc/lint + 全套 Playwright 迴歸。
5. `.env.local` 需要 `ANTHROPIC_API_KEY` — 若未設,實測前請使用者提供/設定。

## Escalation 檢查
- 新 API contract(新端點,story 內)— 無跨 story 影響。非 auth 流程變更(僅消費既有 getUser)。新外部依賴 @anthropic-ai/sdk + 新 env vars → **AGENTS.md 架構變更**,實作落地後依 scan 規則人工確認補寫。無 escalation 暫停條件。

## 產出物
- 上列 4 檔 + package.json 依賴 + .env.example
- scratchpad 驗證腳本(不進 repo)、qa 用重跑指引記入 checklist(`supabase/tests/ai_chat_manual.md`)
