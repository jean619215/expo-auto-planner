# Story: 場地儲存檔與 AI 對話持久化

## 說明
身為場地規劃器的會員,我想要三個儲存檔(save slot),每格保存一份場地配置與其專屬的 AI 對話,以便關掉瀏覽器或換裝置後能讀檔繼續規劃、並延續與 AI 助理的討論脈絡 — 現在配置與對話重新整理就全部消失。

## 驗收條件
- 每位使用者有 **3 個儲存格(slot 1–3)**;上限由 DB 硬保證(`unique(user_id, slot)` + `check slot between 1 and 3`),非應用程式計數。
- 在場地規劃頁,當使用者點「存檔」,則可選擇存入哪一格:空格直接存;**已占用格跳確認彈窗**(顯示該格名稱與最後更新時間),確認後才覆蓋。存檔內容為配置整包快照(polygon/walls/columns/furniture)+ 可自訂名稱(預設「未命名場地」)。
- 當使用者「讀檔」某格,則配置載入編輯器**且該格對話載入 AI 面板**,可直接續聊;讀檔會捨棄目前未存檔的工作區內容(有未存變更時先確認)。
- 對話與存檔為 **1:1**:`ai_conversations.plan_id` unique FK 掛在存檔上;刪除存檔 cascade 帶走對話。AI 面板提供「清空對話」(僅清該格對話,配置不動,需確認)。
- **對話落庫由後端寫入**:`POST /api/ai/chat` 增收可選 `planId`;有值時驗證該存檔屬於該使用者(否則 404),模型回應後把最後一則 user 訊息與 assistant 回應增量寫入該格對話(**不開放前端直寫訊息表**,防偽造 assistant 訊息)。無 `planId`(未讀檔的工作區)行為同現況:對話僅前端暫存,不落庫。
- 模型已回應但落庫失敗時,回應仍完整回傳前端(已付費不可丟),僅 log error;不做補償(phase 1 取捨)。
- **落庫的圖片 block 以固定文字佔位符取代**(不存 base64;沿用 task「payload 瘦身」的佔位符字串);前端本次 session 內仍顯示原圖,讀檔還原的歷史圖片訊息顯示「📷 參考圖」占位 UI。
- 儲存檔 API:存檔(upsert 指定格)、讀檔(單格,含對話)、列表(三格概況:名稱/更新時間/是否占用)、改名、刪除;全部受 proxy 保護(fail-closed,免改 allowlist),route 內另做 `getUser()` 雙重檢查;RLS select-own,寫入僅 service_role(遵循既有 revoke 慣例:migration 明確 revoke anon/authenticated 寫入權)。
- 單格對話達軟上限(100 輪)時,AI 面板顯示提示建議清空重開;不強制擋。
- 未登入呼叫任一儲存檔 API 回 401;跨使用者存取他人 planId 回 404。
- 既有功能不退化:AI 面板 mock 套件與全套 Playwright 迴歸通過。

## 任務清單
- [x] [BACKEND] `venue_plans` migration(slot 1–3 check + unique、RLS select-own、寫入 service_role + revoke)+ 儲存檔 API 五支:upsert 存檔/讀檔(含對話)/列表/改名/刪除
- [x] [BACKEND] `ai_conversations`(plan_id unique FK)+ `ai_messages` migration(RLS/revoke 同慣例);`/api/ai/chat` 增收 `planId`(所有權驗證、回應後增量落庫、圖片佔位符、落庫失敗不影響回應)
- [ ] [FRONTEND] 存檔 UI(三格面板:存/讀/改名/刪除/覆蓋與讀檔確認)+ AiPanel 續聊載入、清空對話、100 輪軟上限提示、歷史圖片占位 UI;Playwright 驗收(page object 模式)

<!--
背景決策(2026-07-22 討論定案):
- 儲存檔為聚合根:一格 = 一份配置快照(jsonb 整包)+ 一段對話。三格上限 DB 層硬保證,
  未來「點數解鎖更多格」只需放寬 check + 扣點,基礎已備。
- 對話與存檔 1:1(plan_id unique FK):語境永遠對著所屬配置;之後要多對話只需拔 unique
  constraint 改 1:N,不動表結構。對話獨立列表(ChatGPT 式)被否決:語境斷裂、雙套管理 UI、儲存無界。
- 存檔時機:手動存 + 未存變更離開/讀檔確認。自動存被否決(會把實驗性亂改蓋掉存檔)。
- 「另存到別格」不帶對話(新格 = 新對話),語意乾淨。
- 未讀檔工作區:對話不落庫,行為同現況 — 第一次存入某格起才開始持久化。
- ai_messages.id 用 identity bigint(插入序即顯示序);content 存 API 原生 content blocks(jsonb),
  讀出直接塞回前端 state 續聊,零轉換。
- 圖片不存 base64(表肥):落庫即換佔位符,接受「讀檔後 AI 看不到原圖」— 配置快照本身在檔內,
  AI 靠 [目前配置] 附錄即有完整語境。Supabase Storage 方案延後。
- 執行:/ship stories/venue-save-slots.md,任務由上到下逐一跑完整 pipeline。
-->
