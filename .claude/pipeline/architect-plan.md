# Architect Plan — AI 助理面板改版(右側可收合側欄 + 輸入元件改版 + 扣點顯示 + @paid 斷言強化)

> Story: AI 助理面板 bug 修復與 UI 改版 | Task type: FRONTEND | Generated: 2026-07-21T12:05:00+08:00

## Overview

將 `AiPanel` 從浮動卡片改為與 2D 編輯畫布並排的右側可收合側欄(純 flex 排版、不用 absolute/z-index,天然不遮擋),輸入改多行 textarea(Enter 送出 / Shift+Enter 換行、IME 組字防護),圖片上傳改隱藏 file input + 按鈕觸發(沿用既有 `fileInputRef` 與同一段 `handleImageChange` 驗證)。扣點值採 **新增受保護輕量端點 `GET /api/ai/config`**(回 `{ chatCost, balance }`),面板展開即抓取,一次滿足「開啟即見扣點值 + 初始餘額」;`@paid` 煙霧測試改為等待「最後一則 assistant 文字」與 `/api/ai/chat` 200 回應。

## Task Type Confirmed

FRONTEND — `GET /api/ai/config` 為 15 行內的唯讀支撐端點,不改任何既有 API 行為,不影響分類。

## 關鍵技術決策(architect decisions)

### D1 — 扣點值取得方式:新增 `GET /api/ai/config`(受保護,不進 allowlist)
- 選項比較:
  - (a) 併入 `/api/ai/chat` 200 回應 → 不滿足「面板展開、未送訊息就要看到扣點值」的 AC5,淘汰。
  - (b) 併入 `/api/points/balance` 回應 → points 路由 import `src/lib/ai/` 常數,跨模組邊界混淆職責,淘汰。
  - (c) **新增 `GET /api/ai/config`** → 一次回 `{ chatCost: AI_CHAT_COST, balance }`,面板展開單一 fetch 同時解決「扣點值」與「初始餘額」兩個 AC5 需求。✅ 採用。
- proxy 決策(對應 spec Security Notes):端點**維持受保護**(不加入 `src/proxy.ts` `PUBLIC_API_PATHS`)。理由:回應含使用者餘額(個人資料),必須登入;fail-closed 預設已涵蓋,`/api/:path*` matcher 已存在 → **`src/proxy.ts` 完全不需改動**。未登入時前端收 401,扣點/餘額顯示各自降級為 `-`,面板仍可操作(送出後自然收到既有 401 錯誤卡,行為與現況一致)。
- 嚴禁 `NEXT_PUBLIC_AI_CHAT_COST` 或前端硬編 — 值只從 `src/lib/ai/client.ts` 的 `AI_CHAT_COST`(server env)經此端點流向前端。

### D2 — Enter 送出 vs 換行(spec Assumption 1,採納並補強)
採 **Enter 送出、Shift+Enter 換行**。額外規則(architect 補):`e.nativeEvent.isComposing === true`(中文 IME 組字中按 Enter 選字)時**不送出、不 preventDefault** — 本產品主要使用者用注音/拼音輸入,漏掉此防護會把選字 Enter 誤判為送出。此為對 AC3 的必要補充,不改變其驗收語義。

### D3 — 側欄佈局:flex 並排、AiPanel 常駐掛載
- `step-edit` 內容改為 `flex` row:左欄(toolbar + Stage)`min-w-0 flex-1`,右側 `AiPanel` 為 `shrink-0` flex sibling。無 absolute/overlay/z-index → AC1「不遮擋、不搶事件」由排版機制天然保證。
- `AiPanel` 元件**維持常駐掛載**(state 在元件內,現況即是只條件渲染內層 Card):收合=只渲染 toggle 按鈕(窄),展開=渲染 `w-80 xl:w-96` 側欄。`turns`/`input`/`imageDraft` 等 state 不因收合重置(對應 edge case「快速連續切換」)。
- **Stage 量測修正(已知風險點)**:`PlanEditor` 的 `ResizeObserver` 目前量最外層 `containerRef`(常駐 div)。側欄改為 flex sibling 後,若仍量外層,側欄展開時 Stage 不會縮,造成水平溢出。必須把量測目標改到**左欄 wrapper**;左欄只在 `step === "edit"` 存在,故 effect 需在 step 切回 edit 時重新 observe(依賴陣列加 `step` + null guard,或改 callback ref)。此為本任務最容易踩雷的一步。

### D4 — assistant 文字 testid(spec Assumption 5,具名決定)
每一則 assistant 回合的文字 `<p>` 加 `data-testid="ai-assistant-text"`(僅 assistant 回合,user 回合絕不掛)。Page object 以 `.last()` 暴露 `lastAssistantText`。@paid 斷言鎖此 locator + `waitForResponse` 驗證 `/api/ai/chat` 真的發出且 200 — optimistic user 訊息無法讓測試綠燈,可重現並封死 2026-07-21 的假綠問題。

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/app/api/ai/config/route.ts` | GET:route 內自行 `getUser()`(defense in depth,同 chat route)→ 失敗 401;成功回 `{ chatCost: AI_CHAT_COST, balance }`,`balance` 用 safeBalance 模式降級 null(ledger 失敗仍回 200 + chatCost) |
| `src/components/ui/textarea.tsx` | shadcn 標準 Textarea 元件(專案尚無,依既有 `input.tsx` 同風格建立) |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/components/venue/AiPanel.tsx` | 側欄容器改版、`ai-messages` 去 `border border-input`、`Input`→`Textarea`(同 testid)、file input 改 `hidden` + 觸發按鈕、新增 config fetch(open 時)、扣點顯示 `data-testid="ai-chat-cost"`、assistant 文字加 `data-testid="ai-assistant-text"`、keydown 改 D2 規則 |
| `src/components/venue/PlanEditor.tsx` | `step-edit` 改 flex 並排、AiPanel 掛載點移入右欄、ResizeObserver 量測目標移到左欄(見 D3) |
| `playwright-tests/pages/AiPanelPage.ts` | 新增 `lastAssistantText`(`ai-assistant-text` `.last()`)、`chatCost`(`ai-chat-cost`)、`imageButton`(`ai-image-button`)locators |
| `playwright-tests/ai-panel.spec.ts` | 新增 `mockAiConfig` helper 套用到各 mock 測試;AC1 測試補「開啟即見扣點值/餘額」斷言;@paid 斷言強化(見 Step 11) |

## Implementation Steps

1. **`src/components/ui/textarea.tsx`**:建立 shadcn Textarea(風格對齊既有 `src/components/ui/input.tsx` 的 `cn()` 等慣例)。
2. **`src/app/api/ai/config/route.ts`**:`export async function GET()` — `createSupabaseServerClient()` → `getUser()` 失敗回 `{ error: "請先登入" }` 401;成功 `Response.json({ chatCost: AI_CHAT_COST, balance }, { status: 200 })`,balance 由 `getBalance(userId)` try/catch 降級 null(比照 chat route 的 `safeBalance`)。import 自 `@/lib/ai/client` 與 `@/lib/points/ledger`。**不動 `src/proxy.ts`**(受保護路由,`/api/:path*` matcher 已涵蓋)。
3. **`PlanEditor.tsx` 佈局**:`step-edit` 內改為 `<div className="flex items-start gap-4">`;左欄 `<div className="min-w-0 flex-1">` 包住現有 toolbar row + `<Stage>`;右欄放 `<AiPanel plan={...} applyActions={applyActions} />`(移除現在 Stage 上方的 `mb-2 flex justify-end` 掛載列)。props 完全不變,`applyActions` / latest-ref 機制不動。
4. **`PlanEditor.tsx` 量測**:量測 ref 改綁左欄 wrapper,`ResizeObserver` effect 依賴 `step`(`step !== "edit"` 或 ref null 時 return);確保側欄展開/收合時 `stagePx` 隨左欄實際寬度重算(`MIN_STAGE_PX`/`MAX_STAGE_PX` clamp 不變)。
5. **`AiPanel.tsx` 側欄容器**:根節點改 `shrink-0`;收合時只渲染 toggle 按鈕(`data-testid="ai-panel-toggle"`、`aria-expanded` 沿用);展開時渲染 `data-testid="ai-panel"` 側欄(`w-80 xl:w-96`,可加 CSS transition,不得阻塞輸入 focus)。toggle 按鈕展開時置於側欄 header,同一顆按鈕負責收合。內層所有既有 testid/邏輯保留。
6. **`AiPanel.tsx` 訊息區/輸入區**:
   - `ai-messages` 容器移除 `rounded-md border border-input`,保留 `overflow-y-auto`、gap、padding;高度配合側欄(如 `max-h-[55vh]`,developer 依實際視覺微調)。
   - assistant 回合文字 `<p>` 加 `data-testid="ai-assistant-text"`(僅 `turn.role === "assistant"` 分支)。
   - `Input` 換 `Textarea`(`data-testid="ai-input"` 不變,`rows={3}` 起),`handleInputKeyDown` 型別改 `KeyboardEvent<HTMLTextAreaElement>`,邏輯:`if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return; e.preventDefault(); void handleSend();`。
7. **`AiPanel.tsx` 圖片上傳按鈕**:file input 保留於 DOM(`data-testid="ai-image-input"`、`ref={fileInputRef}`、同一個 `onChange={handleImageChange}` — **不得複製驗證邏輯**),className 改 `hidden`;新增 `<Button type="button" variant="outline" data-testid="ai-image-button" disabled={pending} onClick={() => fileInputRef.current?.click()}>上傳圖片</Button>`。預覽/「移除圖片」區塊不變。
8. **`AiPanel.tsx` config fetch(AC5)**:新增 state `chatCost: number | null`;`useEffect` 於 `open` 變 true 時 `fetch("/api/ai/config")` — 200 時 `setChatCost(data.chatCost)`、`setBalance(typeof data.balance === "number" ? data.balance : null)`;非 200 或 throw 時維持 null(各自獨立降級,不 set error、不擋面板)。header 顯示:餘額 `data-testid="ai-balance"`(`balance ?? "-"` 沿用)+ 扣點 `<span data-testid="ai-chat-cost">{chatCost ?? "-"}</span>`(文案如「每次呼叫扣 N 點」)。chat 成功/402 後的 `setBalance` 既有邏輯不動;`chatCost` 不因單次失敗改變。
9. **`AiPanelPage.ts`**:constructor 加 `this.lastAssistantText = page.getByTestId("ai-assistant-text").last();`、`this.chatCost = page.getByTestId("ai-chat-cost");`、`this.imageButton = page.getByTestId("ai-image-button");`。
10. **`ai-panel.spec.ts` mock 測試調整**:
    - 新增 `mockAiConfig(page, { chatCost = 10, balance = 100 } = {})` helper(`page.route("**/api/ai/config", ...)`),各 mock 測試開頭呼叫(config 401 不干擾、測試決定性)。
    - AC1 測試補:`await expect(ai.chatCost).toHaveText("10")`、`await expect(ai.balance).toHaveText("100")`(覆蓋 AC5「開啟即見」)。
    - 既有斷言全數保留;AC2 餘額測試(初始 100 → chat 後 90)驗證「即時更新不倒退」。
11. **`ai-panel.spec.ts` @paid 強化(AC6)**:
    ```ts
    const respPromise = page.waitForResponse(
      (r) => r.url().includes("/api/ai/chat") && r.request().method() === "POST",
      { timeout: 90_000 },
    );
    await ai.sendMessage("你好");
    expect((await respPromise).status()).toBe(200);
    await expect(ai.lastAssistantText).toBeVisible({ timeout: 90_000 });
    await expect(ai.lastAssistantText).not.toHaveText("");
    await expect(ai.error).toBeHidden();
    ```
    請求未發出 → `waitForResponse` timeout 失敗;502/非 200 → status 斷言失敗;只有 optimistic user 訊息 → `ai-assistant-text` 不存在而失敗。三個假綠路徑全封死。
12. **回歸驗證**:`npx playwright test ai-panel.spec.ts`(mock 全綠)→ 跑整個 `playwright-tests/` 套件(尤其 plan-editor / venue 相關 spec,確認佈局改動未破壞 Stage 量測與既有互動)→ `npm run lint`。

## Data Flow

```
面板展開(open=true)
  └─ GET /api/ai/config(受 proxy 保護)
       ├─ 200 { chatCost, balance } → setChatCost / setBalance → header 顯示
       └─ 401/失敗 → chatCost=null, balance=null → 顯示 "-",面板功能不受影響
送出訊息(既有流程,不變)
  └─ POST /api/ai/chat → 200: turns+balance 更新 / 402: balance 更新+錯誤卡 / 401、其他: 錯誤卡
tool call → applyActions(PlanEditor ref-based,不變)→ 2D 畫布更新
```

## Test Plan

- Playwright(FRONTEND acceptance gate):
  - 既有 `ai-panel.spec.ts` mock 測試全數通過(selector 沿用,僅加 config mock 與 AC1 扣點/餘額斷言)。
  - `@paid` 依 Step 11 強化,以 `PW_PAID_AI=1` + `.env.playwright.local` 測試帳號實跑一次確認通過。
  - 全套 `playwright-tests/` 回歸(佈局改動影響面)。
- 手動檢核(無 unit framework):側欄收合/展開下 Stage 可繪製/選取/刪除;textarea Enter / Shift+Enter / IME 選字;圖片按鈕上傳與 3MB 拒絕訊息;未登入開面板扣點/餘額顯示 `-`。
- Edge cases(from spec):快速連續切換 toggle 不重置 state;貼上含換行長文字;pending 時上傳按鈕 disabled;config 失敗獨立降級。

## Architecture Notes

- **偏離既有模式**:無。新端點沿用 route-handler-inline + factory client 慣例;`src/lib/ai/` server-only 邊界不變(config route 只在 server 端 import `AI_CHAT_COST`)。
- **D2 IME 防護**是對 spec Assumption 1 的補充(非偏離),請 reviewer 留意。
- **風險最高點**:Step 4 的 ResizeObserver 遷移(step 切換時 ref 生命週期);其次是側欄展開後訊息區 `max-h` 在小視窗的視覺,允許 developer 微調 className,不影響驗收。
- 效能:config fetch 每次展開一次(輕量 SQL SUM),無輪詢;無新增依賴套件。
- Next.js 16 提醒:動 route handler 前先比對 `node_modules/next/dist/docs/` route handler 章節與既有 `/api/points/balance` 寫法(以既有 code 為準)。

## Security Checklist

- [ ] No hardcoded secrets or credentials
- [ ] Input validation implemented at system boundaries(config route 為無參數 GET;chat route 不動)
- [ ] Auth/permission checks in place:`/api/ai/config` 受 proxy fail-closed 保護 + route 內 `getUser()` 雙重檢查;**不進 PUBLIC_API_PATHS**
- [ ] No sensitive data logged(config route 失敗 log 不含 token/cookie)
- [ ] **嚴禁 `NEXT_PUBLIC_AI_CHAT_COST`** 或任何前端硬編扣點值 — 唯一來源為後端 `AI_CHAT_COST` 經 `/api/ai/config`
- [ ] 圖片 3MB 驗證仍走同一個 `handleImageChange`,無平行複製邏輯
- [ ] client 端不 import `src/lib/ai/`(server-only 邊界);`src/lib/ai-panel/` client 模組不變

## Definition of Done

- [ ] All implementation steps (1–12) complete
- [ ] `ai-panel.spec.ts` mock 測試全綠;全套 Playwright 回歸通過
- [ ] `@paid` 強化斷言已落地(`PW_PAID_AI=1` 實跑一次通過)
- [ ] AC1–AC7 全數滿足;spec Assumption 1 依 D2 落實(含 IME 防護)
- [ ] No TODOs, commented-out code, or debug logs
- [ ] `npm run lint` 通過;Code follows AGENTS.md
- [ ] Security checklist passed
