# Orchestrator Output — 送出 payload 瘦身
> Story: AI 助理對話成本與品質優化 | Generated: 2026-07-22T00:45:00+08:00

## Task Type
FRONTEND

## Refined Requirement
`src/components/venue/AiPanel.tsx` 的 `handleSend()` 目前把 `nextTurns`(含全部歷史 + 剛組出的最新 user 訊息)整包序列化後送給 `POST /api/ai/chat`。每一則 user 訊息的文字都內嵌了 `[目前配置]` JSON 附錄(`${trimmed}\n\n[目前配置]\n${configJson}`),且歷史中所有圖片 block 每輪都原樣重送 — 對話越長,input token 越浪費。

本任務只改「組請求 payload」這一段邏輯,不改本地狀態(`turns`)、不改畫面顯示、不改 `/api/ai/chat` 後端、不改 tool call 套用流程。具體規則:

1. **舊輪定義**:`nextTurns`(= `[...turns, userTurn]`)中,除了陣列最後一個元素(剛組出、即將送出的最新 user 訊息)以外,其餘所有元素都是「舊輪」— 不論 role 是 user 還是 assistant。
2. **配置 JSON 附錄瘦身**:只有最新一則 user 訊息的 content 保留 `[目前配置]` JSON 附錄。舊輪中,任何 user 訊息裡原本內嵌配置 JSON 的 text block,送出時要還原成「不含附錄的原始文字」— 等同該輪已存的 `displayText` 欄位內容(`displayText` 本來就是 trimmed input,不含附錄,現有欄位可直接複用,不需要用正則從已烘焙的字串裡剝離 JSON)。
3. **圖片瘦身**:舊輪 user 訊息 content 中的 `image` block,送出時整個替換成固定文字的 placeholder text block:「[使用者先前提供了參考圖]」。本地 `turns` state 與畫面渲染的縮圖(`previewUrl` 相關邏輯)不受影響,只有送出的 payload 做替換。
4. **tool_result 不動**:舊輪 content 中的 `tool_result` block(role 為 user,因為 `pendingToolResults` 併入下一則 user 訊息送出後會存進該輪)要逐一保留原樣(`tool_use_id`、`content`、`is_error` 全部不變),不得省略、合併或改寫。
5. **assistant 舊輪不受影響**:assistant 訊息的 content 只會是 `text` / `tool_use` block,現有邏輯本來就不含配置 JSON 或圖片,維持原樣送出,不需要額外處理。
6. **最新一則 user 訊息維持現況**:content 順序與內容(`pendingToolResults` + 可能的 image block + 帶配置附錄的 text block)完全不變,和現在的行為一致。
7. 這個轉換只發生在組 `fetch("/api/ai/chat")` 的 request body 那一步;`turns` state 本身(存入 React state、供畫面渲染與下一輪組請求的來源)維持現有完整內容不做任何裁切。

## Clarified Acceptance Criteria
- [ ] Given 對話已有 ≥1 則歷史 user 訊息(每則都內嵌 `[目前配置]` JSON), when 使用者送出第 2 輪(或之後)訊息, then 送給 `/api/ai/chat` 的 request body 中,除了陣列最後一則 user 訊息外,所有舊輪 user 訊息的 text block 都不含 `[目前配置]` 字樣與場地配置 JSON。
- [ ] Given 同上情境, when 檢查 request body, then 陣列最後一則 user 訊息(本輪剛送出的)text block 仍完整內嵌 `[目前配置]` JSON 附錄,與現行行為一致。
- [ ] Given 某一則歷史 user 訊息當初上傳過圖片, when 之後任一輪再次送出請求, then 該歷史訊息在 request body 中的 content 不含 `image` type block,取而代之是一個 `text` type block、內容固定為「[使用者先前提供了參考圖]」。
- [ ] Given 同上情境, when 檢查畫面(`ai-messages` 內對應歷史訊息的渲染), then 使用者上傳的原始圖片縮圖顯示不變(本任務不裁切本地 state 與畫面)。
- [ ] Given 對話中曾發生過 tool call(如 `generate_plan`)且其 `tool_result` 已併入某一則歷史 user 訊息, when 之後再送出新訊息, then 該歷史訊息在 request body 中的 `tool_result` block(`tool_use_id`/`content`/`is_error`)與原始值逐一比對完全一致,不受同輪其他 block(text/image)瘦身影響。
- [ ] Given 某一則歷史 user 訊息只有圖片、沒有輸入文字(trimmed 為空字串,`displayText` 為 UI 用的 `"(圖片)"` 佔位字串), when 該輪被瘦身送出, then content 中只有一個圖片替換後的 placeholder text block,不會額外出現一個內容是 `"(圖片)"` 或空字串的 text block。
- [ ] Given 只有一則 user 訊息(對話第一輪、沒有任何歷史), when 送出, then 沒有「舊輪」需要瘦身,payload 與現行行為完全一致(含配置附錄與圖片 block 原樣送出)。
- [ ] Given 既有 `ai-panel.spec.ts` 全部測試(AC1 面板 UI、AC2 對話流程/loading/圖片超限、AC3 tool call 執行、AC4 402/500 錯誤處理), when 重跑, then 全數維持通過 — 本任務不得造成任何既有案例退化。
- [ ] Given 上述所有瘦身規則, when 檢視 `/api/ai/chat` 後端與 `src/lib/ai/` 模組, then 兩者程式碼零改動(本任務純前端 payload 組裝邏輯)。

## Edge Cases to Handle
- 舊輪 user 訊息只有圖片、無文字(trimmed 為空):瘦身後只送 1 個 placeholder text block,不夾帶空字串或 `"(圖片)"` UI 佔位字串進 payload(見 AC 6)。
- 同一舊輪同時有圖片 + tool_result + 文字(configJson 附錄):三種 block 各自套用對應規則(image→placeholder、text→去附錄、tool_result→不動),原本的 block 順序不需要刻意調整,只需保證每個 block 各自套對規則後仍是合法的 `ContentBlockParam[]`。
- 連續多輪都有上傳圖片:每一舊輪各自的 image block 都獨立換成同一固定 placeholder 文字,不需要編號或去重跨輪比較。
- 對話只有 1 輪(無歷史):不觸發任何瘦身邏輯,行為等同現況。
- `pendingToolResults` 存在但使用者這輪沒有輸入文字也沒有圖片:不影響瘦身邏輯,這是「最新一輪」的組裝,不在舊輪處理範圍內。

## Error States
本任務不新增或變更任何錯誤路徑;既有 402(點數不足)、401(未登入)、500(伺服器錯誤)與 fetch 失敗的處理邏輯不受影響,payload 瘦身只發生在請求成功送出「之前」的組裝階段。

## Out of Scope
- 不改 `turns` React state 的儲存內容或形狀(顯示與續聊來源不變)。
- 不改 `/api/ai/chat` 路由或 `src/lib/ai/` 任何檔案。
- 不做對話持久化(story A,延後)。
- 不新增「舊輪文字也做長度截斷/摘要」之類的額外瘦身(範圍僅限配置 JSON 附錄與圖片 block)。
- 不改 `pendingToolResults` 併入下一輪 user 訊息的既有機制。
- 不新增 UI 提示告知使用者「舊圖片已被瘦身」— 純送出 payload 內部行為,前端顯示不變。

## Assumptions Made
- **Assumption 1**:「還原不含附錄的原始文字」直接複用該輪已存的 `displayText` 欄位,不用正則從已烘焙的字串裡剝離 JSON(更穩定、不受 JSON 內容中意外出現分隔字串影響)。若未來 `displayText` 欄位語意改變,此假設需重新檢視。
- **Assumption 2**:圖片 placeholder 固定文字採用 story AC 原文給的範例:「[使用者先前提供了參考圖]」,不因圖片數量或原始檔名而變化。
- **Assumption 3**:「舊輪」判定以陣列位置(除最後一個 user 訊息外皆為舊輪)為準,不是以 role 或時間戳記另外判斷 — 因為 `nextTurns` 的最後一個元素必然就是本次組裝的最新 user 訊息。
- **Assumption 4**:Playwright 驗證用 `page.route` 攔截 `**/api/ai/chat`,在 `route.fulfill` 前先讀取 `route.request().postDataJSON()` 斷言 request body 形狀(舊輪無 image block / 無配置附錄 / tool_result 逐一比對;最新輪保留配置附錄),與現有 `mockAiChat` helper 的攔截機制相容,不需改動 helper 簽章,只需新增測試案例讀取 request body。
- **Assumption 5**:既有 `ai-panel.spec.ts` 測試都用 `mockAiChat` 直接 fulfill 固定 fixture,不檢查 request body,因此本任務新增的瘦身邏輯不會導致既有斷言失敗(既有測試維持不動即可通過)。

## Security Notes
- 無新增外部輸入面;瘦身邏輯純粹操作既有本地 state 衍生資料,不引入使用者可控字串插值風險。
- 需確認瘦身後送給模型的內容仍不包含完整原始圖片 base64(舊輪一律替換成固定文字),避免非必要的長期重複傳輸使用者上傳圖片內容 — 這正是本任務要解決的成本問題,也順帶降低圖片資料在每次請求中重複曝露的面積。
