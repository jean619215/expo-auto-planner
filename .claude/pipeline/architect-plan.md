# Architect Plan — 送出 payload 瘦身

> Story: AI 助理對話成本與品質優化 | Task type: FRONTEND | Generated: 2026-07-22T01:10:00+08:00

## Overview

在 `AiPanel.handleSend()` 組 `POST /api/ai/chat` request body 的那一步,插入一個純函式轉換:舊輪 user 訊息的 text block 以既有 `displayText` 還原(去除 `[目前配置]` JSON 附錄)、image block 換成固定 placeholder text block、tool_result block 原樣保留;最新一則 user 訊息與所有 assistant 訊息完全不動。`turns` React state 與畫面渲染零改動。

## Task Type Confirmed

FRONTEND — 與 orchestrator-output.md 一致,無矛盾。後端 `/api/ai/chat` 與 `src/lib/ai/` 零改動。

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/lib/ai-panel/messages.ts` | 純函式 `toApiMessages()`:把面板的 turns(含最新一則)轉成送給 `/api/ai/chat` 的 messages 陣列,內含舊輪瘦身規則。client 端模組(與 `actions.ts` 同層,勿加 `server-only`)。 |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/components/venue/AiPanel.tsx` | `handleSend()` 中 `body: JSON.stringify({ messages: nextTurns.map(...) })` 改為 `body: JSON.stringify({ messages: toApiMessages(nextTurns) })`;其餘(state、渲染、錯誤處理)不動。 |
| `playwright-tests/ai-panel.spec.ts` | 新增 `test.describe("AI 助理面板 - payload 瘦身")` 區塊(3 個案例,見 Test Plan);既有案例與 `mockAiChat`/`mockAiConfig` helper 簽章不動。 |

不新增 page object 方法 — `AiPanelPage` 既有 `sendMessage` / `uploadImage` 已足夠;payload 斷言發生在 `page.route` 攔截層,不屬於 page object 職責。

## Implementation Steps

1. **建立 `src/lib/ai-panel/messages.ts`**,內容:
   - `export const PRIOR_IMAGE_PLACEHOLDER = "[使用者先前提供了參考圖]";`(固定字串,不編號、不含檔名)。
   - `export const CONFIG_APPENDIX_HEADER = "[目前配置]";`(供 AiPanel 組最新訊息共用,消除魔法字串重複 — 見 step 3)。
   - 定義最小輸入型別(結構相容於 AiPanel 的 `ChatTurn`,避免從元件檔反向 import 型別):
     ```ts
     import type Anthropic from "@anthropic-ai/sdk";
     export interface PanelTurn {
       role: "user" | "assistant";
       content: Anthropic.ContentBlockParam[];
       displayText?: string;
     }
     ```
   - `export function toApiMessages(turns: PanelTurn[]): { role: "user" | "assistant"; content: Anthropic.ContentBlockParam[] }[]` — 純函式,不 mutate 傳入的 turns 或其 content blocks(需改寫的 block 一律建新物件)。
2. **`toApiMessages` 轉換規則**(舊輪 = 陣列中除最後一個元素外的所有元素,依 orchestrator Assumption 3 以位置判定,不看 role):
   - 最後一個元素:`{ role, content }` 原樣送出(不需 clone)。
   - 舊輪 assistant:`{ role, content }` 原樣送出(content 只會是 text / tool_use,規則 5)。
   - 舊輪 user:逐 block 映射:
     - `tool_result` → 原 block 直接保留(同一物件參照即可,`tool_use_id`/`content`/`is_error` 不變)。
     - `image` → 換成 `{ type: "text", text: PRIOR_IMAGE_PLACEHOLDER }`。
     - `text` → 換成 `{ type: "text", text: turn.displayText }`(既有欄位即 trimmed 原始輸入,不做正則剝離)。**例外(AC6)**:若 `turn.displayText === "(圖片)"` 且該輪 content 中含 `image` block(即「純圖片、無文字」輪),則此 text block 直接丟棄,不產生 `"(圖片)"` 或空字串 block — 該輪瘦身後只剩 image 換出的單一 placeholder text block(+ 可能的 tool_result)。
     - 其他 type(理論上不存在)→ 原樣保留(防禦性 fallthrough,不丟資料)。
   - block 順序維持原 content 順序,不重排。
3. **`src/components/venue/AiPanel.tsx`**:
   - import `toApiMessages`(及 `CONFIG_APPENDIX_HEADER`,把 `handleSend` 內 `` `${trimmed}\n\n[目前配置]\n${configJson}` `` 的字面 `[目前配置]` 改用該常數,行為不變)。
   - `fetch("/api/ai/chat")` 的 body 改為 `JSON.stringify({ messages: toApiMessages(nextTurns) })`。
   - 不改 `userTurn` / `nextTurns` / `setTurns` / `pendingToolResults` 任何邏輯 — 最新一則 user 訊息的 content 組裝順序(tool_results → image → text 附錄)維持現況(規則 6/7)。
4. **`playwright-tests/ai-panel.spec.ts` 新增 `payload 瘦身` describe**:案例內用自建 `page.route("**/api/ai/chat", ...)`(攔截時先 `route.request().postDataJSON()` push 進本地 `captured: unknown[]` 陣列,再 fulfill 對應 fixture — 不改 `mockAiChat` 簽章,orchestrator Assumption 4),三個測試見 Test Plan。
5. **回歸驗證**:`npx playwright test playwright-tests/ai-panel.spec.ts`(全部既有 + 新增案例)、再跑整個 `playwright-tests/` 套件確認無跨檔退化;專案 lint 通過。
6. **確認零後端改動**:`git diff` 不得出現 `src/app/api/` 或 `src/lib/ai/` 檔案(AC 最後一條)。

## Data Flow

```
input / imageDraft / pendingToolResults
        │ handleSend()
        ▼
userTurn(最新,含 [目前配置] 附錄 + image + tool_results)
        ▼
nextTurns = [...turns, userTurn] ──────────► setTurns / 畫面渲染(完整內容,不裁切)
        │
        ▼ toApiMessages(nextTurns)   ← 純函式,只在這裡瘦身
舊輪 user: text→displayText、image→placeholder、tool_result→原樣
舊輪 assistant / 最新 user: 原樣
        ▼
fetch POST /api/ai/chat { messages }
```

## Test Plan

無 JS 單元測試框架(AGENTS.md)— 驗收全靠 Playwright route 攔截斷言 request body 形狀 + 既有套件迴歸:

- **新案例 1「多輪:舊輪去附錄與圖片、tool_result 原樣、最新輪保留附錄」**:
  - 第 1 輪:`uploadImage`(小型 in-memory PNG buffer)+ 文字送出,mock 回 `GENERATE_PLAN_FIXTURE`(產生 `toolu_generate_1` 的 pendingToolResults);第 2 輪:純文字送出。
  - 斷言 `captured[1]`(第 2 次請求 body):
    - `messages.length === 3`(user / assistant / user)。
    - `messages[0]`(舊 user 輪):無任何 `type === "image"` block;含一個 text block 恰為 `"[使用者先前提供了參考圖]"`;另一 text block 恰等於第 1 輪輸入原文;整個 `messages[0]` 序列化後不含 `"[目前配置]"`。
    - `messages[1]`(assistant)content 與 fixture 的 content 深度相等(原樣)。
    - `messages[2]`(最新 user 輪):含 `tool_result` block 且 `tool_use_id === "toolu_generate_1"`、`content`/`is_error` 與第 1 輪套用結果逐一相等;text block 含 `"[目前配置]"` 與第 2 輪輸入原文。
  - 同測試內順帶斷言畫面:`ai-messages` 中第 1 輪 user 訊息的 `displayText` 渲染不變(本地顯示不受瘦身影響)。
- **新案例 2「純圖片舊輪 → 單一 placeholder block」**:第 1 輪只上傳圖片不輸入文字送出(mock 回 `TEXT_REPLY_FIXTURE`),第 2 輪文字送出;斷言 `captured[1].messages[0].content` 恰為 `[{ type: "text", text: "[使用者先前提供了參考圖]" }]` — 不得出現 `"(圖片)"` 或空字串 text block。
- **新案例 3「首輪無歷史 → payload 與現況一致」**:單輪(圖片+文字)送出;斷言 `captured[0].messages.length === 1`,content 依序含 image block(base64 原樣)與帶 `"[目前配置]"` 附錄的 text block。
- **迴歸**:既有 `ai-panel.spec.ts` AC1–AC4 全數案例 + 全套件 `playwright-tests/` 重跑通過(orchestrator Assumption 5:既有測試不檢查 request body,預期不需改動即綠)。

## Architecture Notes

- **放在 `src/lib/ai-panel/` 而非 AiPanel 元件內**:符合既有邊界(`src/lib/ai-panel/` = client 端 AI 面板邏輯,`src/lib/ai/` = server-only);純函式利於閱讀與未來導入單元測試;AiPanel.tsx 已 400+ 行,避免再膨脹。
- **組裝時分離、不做字串剝離**:複用 `displayText` 還原舊輪文字(orchestrator Assumption 1),不用正則從 `${text}\n\n[目前配置]\n${json}` 已烘焙字串裡剝 JSON — 避免 JSON 內容意外含分隔字串時剝錯。
- **已知極端邊界(接受)**:使用者「真的輸入字面文字 `(圖片)` 且同輪附圖」時,依 AC6 規則該 text block 會被丟棄(與純圖片輪無法區分 — `displayText = trimmed || "(圖片)"` 資訊已合流)。影響僅止於該舊輪送給模型的歷史少一句 `(圖片)`,畫面顯示不受影響;根治需改 `ChatTurn` state 形狀,已被 Out of Scope 明文排除,故接受並以註解記錄於 `messages.ts`。無圖片而字面輸入 `(圖片)` 的輪次不受影響(例外條件要求同輪含 image block)。
- **不 mutate state**:`toApiMessages` 對需改寫的 block 建新物件;`turns` 內的原 block(含 image base64)保持原參照,畫面縮圖(`previewUrl`)與續聊來源不受影響。
- **效能**:轉換為 O(blocks) 淺映射,每次送出執行一次;實際效益是 request body 少掉舊輪重複的配置 JSON 與圖片 base64(本任務目的)。
- **型別**:`PanelTurn` 以結構相容方式對齊 AiPanel 的 `ChatTurn`(不從元件檔 import 型別);`ContentBlockParam` 沿用 `@anthropic-ai/sdk` type-only import(與 AiPanel 現行做法一致)。

## Security Checklist

- [ ] No hardcoded secrets or credentials(本任務無任何金鑰接觸面)
- [ ] Input validation implemented at system boundaries(不新增外部輸入面;瘦身只操作既有本地 state 衍生資料)
- [ ] Auth/permission checks in place — 不適用:不動 `/api/ai/chat`、`src/proxy.ts`、任何 auth 路徑
- [ ] No sensitive data logged(不新增任何 log)
- [ ] `src/lib/ai-panel/messages.ts` 為 client 模組,不得 import `src/lib/ai/`(server-only,ANTHROPIC_API_KEY 邊界)或 `src/lib/supabase/admin.ts`
- [ ] 客戶端不新增 `system` 欄位或任何繞過後端凍結 prompt 的欄位(payload 仍只有 `messages`)
- [ ] 順帶收斂:舊輪圖片 base64 不再每輪重送,縮小使用者上傳內容的重複傳輸面(orchestrator Security Notes)
- [ ] Playwright 新案例不硬編真實帳密(全 mock,無需登入,沿用既有 spec 模式)

## Definition of Done

- [ ] All implementation steps complete(steps 1–6)
- [ ] 新增 3 個 payload 瘦身 Playwright 案例全綠;既有 `ai-panel.spec.ts` 與全套件迴歸全綠
- [ ] `git diff` 零觸及 `src/app/api/`、`src/lib/ai/`(orchestrator AC 最後一條)
- [ ] `turns` state 形狀與畫面渲染零改動(對照 AC:縮圖與 displayText 顯示不變)
- [ ] No TODOs, commented-out code, or debug logs
- [ ] Code follows all rules in AGENTS.md(`@/*` alias、eslint 通過)
- [ ] Security checklist passed
