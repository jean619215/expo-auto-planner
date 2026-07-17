# Story: 場地規劃 AI 助理

## 說明
身為使用場地規劃器的會員,我想要一個懂場地規劃的 AI 助理,能看參考圖幫我產生 2D/3D 配置、用引導問答收集需求後自動規劃、聽指令直接修改現有配置,以便不用手動從零拉出整個場地。

## 驗收條件
- 在場地規劃頁,當使用者開啟 AI 助理面板並輸入需求,則助理以多輪對話回應;對話歷史存於前端 state(不落 DB,重新整理即消失 — phase 1 已知取捨)。
- 在對話中,當使用者上傳參考圖,則助理解析圖片並產生符合現有 plan schema(`plan.ts`/`furniture.ts` 型別)的場地配置,前端直接套用到編輯器。
- 在對話中,當使用者未提供完整需求,則助理以引導式問答收集規格(場地尺寸、攤位/家具需求、動線等),收齊後產生配置。
- 在已有配置的狀態下,當使用者下修改指令(如「把入口移到南側」「加三張桌子」),則助理透過 tool call 回傳結構化操作(add/move/remove/resize),前端執行並同步 2D/3D — 不整份重生 plan。
- 當使用者輸入與場地規劃無關的話題,則助理拒絕回應並引導回主題;系統提示僅由後端注入,前端無法覆寫(scope guard 不可繞過)。
- 每次 AI 呼叫前,當使用者點數足夠,則從點數 ledger 扣點(`reason='ai_usage'`,ref_id 冪等);點數不足回 402 與明確訊息,不呼叫模型。
- 未登入呼叫 AI API,則被 proxy 擋下(401)。
- AI API key 僅存於環境變數,絕不出現在前端 bundle 或 repo;模型以 env var 指定(`AI_MODEL`,預設 `claude-sonnet-5`),可不改程式碼切換同家模型。
- 每次呼叫的 token usage(input/output/cache_read)於後端記錄(結構化 log,phase 1 不建表),供成本對帳。

## 任務清單
- [x] [BACKEND] 點數 ledger 支援 AI 扣點:migration 放寬 `point_transactions.reason` check constraint 加入 `ai_usage`;扣點邏輯(餘額檢查 + service_role 寫入 + ref_id 冪等)抽成可重用 helper(`src/lib/points/` 內)
- [ ] [BACKEND] `POST /api/ai/chat`:接收前端帶來的完整對話歷史(API 原生 content blocks 格式)+ 可選圖片,後端注入系統提示(場地規劃 scope guard + plan schema 說明)與 tool 定義(plan 操作:add_object/move_object/remove_object/resize_venue/generate_plan),呼叫 Claude(`@anthropic-ai/sdk`,model 由 `AI_MODEL` env var 指定,prompt cache 斷點置於系統提示),先扣點後呼叫,回傳助理回應(含 tool calls)與 usage;usage 結構化 log
- [ ] [FRONTEND] 場地規劃頁 AI 助理面板:對話 UI(訊息列表/輸入框/圖片上傳/loading 狀態)、對話歷史前端 state(API content blocks 格式)、tool call 執行層(將助理回傳的結構化操作套用到 PlanEditor 的 plan state 並同步 2D/3D)、點數不足與錯誤狀態顯示,Playwright 驗收(page object 模式)

<!--
背景決策(2026-07-17 討論定案):
- 模型:Claude Sonnet 5(優惠價 $2/$10 per MTok 至 2026-08-31,之後 $3/$15)。CP 比較過 GPT-5.6/Gemini 3.x,
  以視覺+structured outputs+tool use 的組合與價格選定。跨供應商 adapter 暫不做,phase 1 僅 env var 切換同家模型。
- 對話不落 DB(phase 1 取捨):前端 state 持有歷史,後端無狀態。升級路徑:前端 state 形狀照 API 原生
  content blocks 格式,之後加 ai_conversations/ai_messages 兩表即可落庫,對話邏輯不動。
- 扣點冪等:後端每請求生成 ref_id;phase 1 重試會重扣,可接受。
- 系統提示凍結以吃 prompt cache(cache read 0.1x);動態內容(目前 plan 狀態、使用者輸入)放 messages 尾端,
  嚴禁在系統提示內插時間戳/user id 等 per-request 變數。
- 參考圖:前端傳 base64(限制大小),不經 Storage — phase 1 不留存圖片。
- 每個任務獨立跑完整 pipeline,由上到下依序處理。執行:/ship stories/ai-planner-assistant.md
-->
