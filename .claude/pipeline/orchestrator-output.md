# Orchestrator Output — 登入頁「重寄驗證信」按鈕 + 60 秒冷卻

> Story: 會員系統 | Task 9 of 9 | Generated: 2026-07-11

## Task Type
FRONTEND

## Refined Requirement

在 `src/app/login/page.tsx` 的登入表單中,當 `POST /api/auth/login` 回傳 403 且錯誤訊息為「請先至信箱完成驗證再登入」(即 `email_not_confirmed` 分支) 時,在既有的紅色錯誤文字下方/旁邊,額外顯示一個「重新寄送驗證信」按鈕。

- 該按鈕使用登入表單目前 `email` state 中已輸入的 email 呼叫 `POST /api/auth/resend`,**不**另外提供 email 輸入欄位。
- 登入表單本身 (email/password 輸入框、登入按鈕) 在此分支下維持可見、可操作 — 這個分支不會取代/蓋掉整張卡片,只是在既有 UI 之上疊加提示與按鈕。
- 點擊後呼叫後端一律回通用 200 訊息 (防枚舉),前端不對成功情境做任何「猜測」式的差異化提示。
- 60 秒冷卻狀態透過 localStorage 持久化,重整頁面後倒數從剩餘秒數繼續,不會被重整繞過。冷卻是**全域**的 (單一 key,不分 email)。

## Backend 契約 (Task 8 已完成,前端對齊用)

`POST /api/auth/resend`,body `{ "email": string }`:
- 缺 email / 格式錯 → `400 { "error": "..." }`
- 其他所有情況 (email 不存在、已驗證、被 rate limit、寄送成功) → 一律 `200 { "message": "若該信箱已註冊且尚未驗證，驗證信已重新寄出" }` (固定同一句,防枚舉)
- 此 route 已在 `src/proxy.ts` 的 `PUBLIC_API_PATHS` 白名單內,未登入可直接呼叫,不需額外授權處理。

## Clarified Acceptance Criteria

- [ ] Given 使用者在登入頁輸入正確帳密但帳號未驗證,when 提交登入表單收到 403 (`error_code`/訊息對應 `email_not_confirmed`),then 除了顯示既有紅色錯誤文字外,額外顯示「重新寄送驗證信」按鈕 (idle 狀態,可點擊)。
- [ ] Given 「重新寄送驗證信」按鈕為 idle 狀態,when 使用者點擊,then 立即呼叫 `POST /api/auth/resend`,body 使用登入表單目前 `email` state 的值,按鈕進入 loading/disabled 狀態直到回應返回。
- [ ] Given `/api/auth/resend` 回傳 200,then 在按鈕下方 (或紅色錯誤文字之外的獨立區塊) 以中性/成功樣式 (非紅色) 顯示後端回傳的原文訊息「若該信箱已註冊且尚未驗證，驗證信已重新寄出」逐字顯示,不做任何改寫或加工;同時啟動 60 秒冷卻倒數,按鈕文字變為「重新寄送驗證信 (N 秒後可重試)」且視覺上呈現 disabled/灰階,直到倒數為 0 才恢復為「重新寄送驗證信」且可再次點擊。
- [ ] Given `/api/auth/resend` 回傳 400 (缺 email/格式錯) 或網路層級錯誤 (fetch 失敗/timeout),then 顯示對應錯誤訊息 (中性或錯誤樣式,與既有紅色 401/403 錯誤文字視覺上可區分或並存皆可,但需清楚是「重寄」這個動作失敗,而非登入失敗),按鈕**不**進入冷卻,立即恢復為 idle 可點擊狀態。
- [ ] Given 使用者觸發過一次成功的重寄 (冷卻開始) 並重新整理頁面 (無論是否仍在「請先驗證」分支),when 頁面重新載入,then 從 localStorage 讀取上次冷卻的到期時間戳,若尚未到期,按鈕直接以「剩餘秒數繼續倒數」的狀態渲染 (不重新給滿 60 秒),文字顯示「重新寄送驗證信 (剩餘秒數 秒後可重試)」且 disabled;若已到期,按鈕以 idle 狀態渲染。
- [ ] Given 冷卻倒數中,when 秒數歸零,then 按鈕自動 (不需使用者互動) 轉為 idle 可點擊狀態,並清除/更新 localStorage 中的到期時間。
- [ ] Given 冷卻是全域性的 (不分 email),when 使用者在同一瀏覽器中改用不同 email 觸發「請先驗證」分支,then 若冷卻尚未到期,按鈕依然顯示剩餘秒數的 disabled 狀態 (不因換了 email 而重置)。

## Edge Cases to Handle

- 使用者在按鈕 loading 中重複點擊 → 必須防止重複送出 (按鈕 disabled 期間不可再觸發呼叫)。
- localStorage 中的到期時間戳格式異常/被竄改 (例如不是數字、是過去很久的時間) → 視為「已到期」,fallback 為 idle 狀態,不應讓應用崩潰或永久卡在 disabled。
- localStorage 不可用 (無痕模式限制、瀏覽器停用) → 呼叫需被 try/catch 包裹,讀寫失敗時 in-memory 倒數仍可運作 (本次頁面內冷卻正常),只是重整後會遺失冷卻狀態 — 不視為阻斷性 bug,但不能因此 throw 造成頁面錯誤。
- 使用者在冷卻倒數期間切換分頁背景又切回 (setInterval 可能被瀏覽器節流) → 倒數顯示以「目前時間 vs. localStorage 到期時間戳」重新計算剩餘秒數,而非單純遞減計數器,避免顯示秒數與實際到期時間漂移。
- 登入表單的 email 欄位在按鈕出現後被使用者修改 (例如發現打錯字重新輸入) → 點擊「重新寄送驗證信」時應使用**當下** email state 的最新值 (即時读取,不使用觸發 403 當下快照的舊值)。
- `/api/auth/login` 回傳其他非 `email_not_confirmed` 的 403/401 (例如帳密錯誤) → 不觸發「重新寄送驗證信」按鈕的顯示,維持現有行為 (僅顯示紅色錯誤文字)。

## Error States

- `/api/auth/resend` 回傳 400 → 顯示錯誤訊息 (可用後端回傳的 `error` 文字或前端固定文案),按鈕恢復 idle,不啟動冷卻。
- 網路層失敗 (fetch reject/timeout) → 顯示通用錯誤訊息 (例如「連線失敗，請稍後再試」,與 `src/lib/auth-client.ts` 既有的 `NETWORK_ERROR` 常數對齊/重用),按鈕恢復 idle,不啟動冷卻。
- `/api/auth/resend` 回傳 200 → 視為成功,永遠啟動冷卻,不論後端實際是否真的寄出信 (防枚舉設計本就無法區分)。

## Out of Scope

- 忘記密碼/重設密碼的重寄邏輯 (`/api/auth/resend` 目前僅處理 `type: "signup"`)。
- email 欄位驗證邏輯的變更 (沿用現有 `isValidEmail`)。
- 因對齊防枚舉設計,前端不會、也不能提示「此帳號不存在」或「已經驗證過了」等分支訊息 — 一律顯示後端的通用訊息。
- 每個 email 各自獨立的冷卻 (已確認為全域單一冷卻,不分 email)。
- 後端 `/api/auth/resend` 本身的任何修改 (Task 8 已完成並通過)。
- 手機號碼/簡訊驗證等其他驗證管道。

## Assumptions Made

- 「按鈕出現的觸發條件」定義為:登入 API 回應 status 403 且 `error` 訊息等於 `"請先至信箱完成驗證再登入"` (與 `src/app/api/auth/login/route.ts` 中 `email_not_confirmed` 分支的固定字串一致)。前端判斷建議以此字串或未來若後端補上機器可讀 error code 時改用 code — 此決定留給 architect/developer 依現有 `AuthResult` 型別 (`src/lib/auth-client.ts`) 的可行性定案,不影響本任務範圍。
- localStorage key 命名、冷卻剩餘時間計算方式 (時間戳 vs. 計數器) 屬於實作細節,已在 Edge Cases 中约定「以到期時間戳為準重新計算」的行為要求,但實際 key 命名/儲存格式由 architect 定案。
- 「按鈕視覺是否需要 loading spinner」等純視覺細節未特別要求,预设遵循站上既有登入按鈕的 disabled + 文字變化模式 (如 `登入中…`) 即可,不需額外規格。

## Security Notes

- 遵守 AGENTS.md 防枚舉規則:前端絕不可依 `/api/auth/resend` 的回應內容/時間差異等去推測 email 是否存在或已驗證 — 一律顯示同一句後端訊息,不加工、不分支顯示不同文案。
- localStorage 僅存冷卻到期時間戳 (數字),**不可**存放 email、token、或任何使用者可識別資訊 — 全域冷卻的設計本身也避免了以 email 作為 key 而間接洩漏「哪些 email 曾被拿來重寄」的痕跡。
- 前端仍需透過 `/api/auth/resend`,不得直接呼叫 Supabase client (per AGENTS.md 架構規則)。
- 此為 auth-adjacent 變更 (登入頁分支邏輯 + 呼叫驗證信重寄) — PR Reviewer 依 AGENTS.md 規則需將本次變更自動列為 🔴 Critical 審查等級。
