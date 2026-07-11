# Architect Plan — 登入頁「重寄驗證信」按鈕 + 60 秒冷卻

> Story: 會員系統 | Task 9 of 9 | Task type: FRONTEND | Generated: 2026-07-11T16:45:00+08:00

## Overview

在既有 `src/app/login/page.tsx` 的 403 `email_not_confirmed` 分支上疊加一個「重新寄送驗證信」按鈕，呼叫既有的 `/api/auth/resend`（Task 8 已完成，本任務不改動後端）。新增一個小型純函式 helper 模組 `src/lib/resend-cooldown.ts` 封裝 localStorage 讀寫（對齊 `auth-client.ts`/`validation.ts` 已建立的「共用 helper 抽到 `src/lib/`」慣例），倒數以「目前時間 vs. localStorage 到期時間戳」的差值即時運算，不用遞減計數器，避免分頁背景節流造成漂移。

## Task Type Confirmed

FRONTEND — 與 orchestrator-output.md 一致，無需 escalate。技術分析未發現與 task_type 衝突之處（純前端 state/localStorage，不涉及資料庫 schema、外部 API 契約變更、或 auth 模型變更；`/api/auth/resend` 契約已在 Task 8 定案不動）。

## Escalation Check

- 不涉及外部 API 契約修改（沿用 Task 8 已完成的 `/api/auth/resend` 契約，body/status/message 皆不變）。
- 不涉及資料庫 schema。
- 不涉及登入/session 機制本身的變更（僅在既有 403 分支上疊加 UI），但仍屬 auth-adjacent 變更 → PR Reviewer 依 AGENTS.md 規則自動列 🔴，已在下方 Security Checklist / Architecture Notes 註明。
- 規格明確、無需求缺口，orchestrator-output.md 的 Assumptions 已收斂 key 命名/計算方式等實作細節留給本計畫定案。
- 複雜度未超出原始 story 範圍。
- 結論：不 escalate，繼續產出計畫。

## Files to Create

| File path | Purpose |
| --- | --- |
| `src/lib/resend-cooldown.ts` | 純函式 helper：讀/寫/清除 localStorage 中的冷卻到期時間戳（try/catch 包裹，不可用時不 throw），並匯出冷卻時長常數。不含任何 React 依賴，供 `login/page.tsx` 呼叫。 |

## Files to Modify

| File path | What changes |
| --- | --- |
| `src/lib/auth-client.ts` | 新增 `resendVerificationRequest(email: string): Promise<AuthResult>`（沿用既有 `postJson` 呼叫 `/api/auth/resend`，與 `registerRequest`/`loginRequest`/`logoutRequest` 同一模式）；新增匯出常數 `EMAIL_NOT_CONFIRMED_ERROR = "請先至信箱完成驗證再登入"`，對齊 `src/app/api/auth/login/route.ts` 第 38 行的固定字串，供 `login/page.tsx` 判斷分支而不必自行硬編字串。 |
| `src/app/login/page.tsx` | 新增 resend 按鈕相關 state 與 handler（詳見下方 Implementation Steps），在既有紅色 `errorMsg` 區塊之外疊加一個獨立區塊：按鈕 + 中性/成功訊息 + resend 專屬錯誤訊息。登入表單既有欄位/按鈕不變、不被取代。 |
| `supabase/tests/auth_routes_manual.md` | 新增第 10 節手動 checklist，涵蓋本任務 7 項驗收條件 + 6 項 edge case + 2 項 error state 的靜態/程式碼審視斷言（因無 JS test framework，QA 走靜態比對；互動情境留給 playwright）。同時把第 9.3 節「延後至 Task 9 合併跑」的 playwright 清單指標更新為指向本次新增的第 10 節。 |

## Implementation Steps

1. **建立 `src/lib/resend-cooldown.ts`**：
   - 匯出常數 `RESEND_COOLDOWN_STORAGE_KEY = "auth:resend_cooldown_ends_at"`（全域單一 key，不含 email，符合 orchestrator-output.md Security Notes）。
   - 匯出常數 `RESEND_COOLDOWN_MS = 60_000`。
   - 匯出 `readCooldownEndsAt(): number | null` — 以 `try { ... } catch { return null; }` 包裹 `window.localStorage.getItem(...)`；用 `Number(raw)` 轉型，若 `!Number.isFinite(value) || value <= 0` 視為異常/竄改資料，回傳 `null`（對應 edge case：格式異常/被竄改 → fallback 已到期）。
   - 匯出 `writeCooldownEndsAt(endsAt: number): void` — try/catch 包裹 `window.localStorage.setItem(...)`，catch 內不做任何事（靜默降級為僅本頁面內生效，不 throw）。
   - 匯出 `clearCooldownEndsAt(): void` — try/catch 包裹 `window.localStorage.removeItem(...)`。
   - 檔案開頭加註解說明：只存數字時間戳、不存 email/token，理由對齊 AGENTS.md 防枚舉與最小化持久化資料的安全規則。

2. **`src/lib/auth-client.ts` 新增匯出**：
   - `export const EMAIL_NOT_CONFIRMED_ERROR = "請先至信箱完成驗證再登入";`（頂部常數區，鄰近 `NETWORK_ERROR`）。
   - `export function resendVerificationRequest(email: string): Promise<AuthResult> { return postJson("/api/auth/resend", { email }); }`（放在 `logoutRequest` 之後）。

3. **`src/app/login/page.tsx` 新增 import**：
   ```ts
   import { resendVerificationRequest, EMAIL_NOT_CONFIRMED_ERROR } from "@/lib/auth-client";
   import {
     RESEND_COOLDOWN_MS,
     readCooldownEndsAt,
     writeCooldownEndsAt,
     clearCooldownEndsAt,
   } from "@/lib/resend-cooldown";
   import { useEffect } from "react";
   ```

4. **新增 state（`LoginPage` 元件內，`errorMsg` 之後）**：
   ```ts
   const [showResend, setShowResend] = useState(false);
   const [resendLoading, setResendLoading] = useState(false);
   const [resendMessage, setResendMessage] = useState("");
   const [resendError, setResendError] = useState("");
   const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
   const [now, setNow] = useState<number | null>(null);
   ```
   - `cooldownEndsAt`/`now` 初始為 `null`，**不要**在 `useState` 初始化時讀 `localStorage`（避免 SSR/hydration mismatch — Next.js client component 首次 render 在 server 端跑一次，`window` 不存在）。改用第 5 步的 `useEffect` 於掛載後（僅 client 端）讀取。

5. **掛載時讀取 localStorage 的 `useEffect`**（只跑一次，`[]` 依賴）：
   ```ts
   useEffect(() => {
     const storedEndsAt = readCooldownEndsAt();
     if (storedEndsAt && storedEndsAt > Date.now()) {
       setCooldownEndsAt(storedEndsAt);
     } else if (storedEndsAt) {
       clearCooldownEndsAt(); // 已到期的殘留值，主動清掉
     }
   }, []);
   ```

6. **倒數計時 `useEffect`**（依賴 `[cooldownEndsAt]`）：
   ```ts
   useEffect(() => {
     if (!cooldownEndsAt) {
       setNow(null);
       return;
     }
     setNow(Date.now());
     const intervalId = setInterval(() => setNow(Date.now()), 1000);
     return () => clearInterval(intervalId);
   }, [cooldownEndsAt]);
   ```
   - 用「目前時間 - 到期時間戳」重算剩餘秒數而非遞減計數器，滿足 edge case（分頁節流不造成秒數漂移）。

7. **倒數歸零時自動清除的 `useEffect`**（依賴 `[now, cooldownEndsAt]`）：
   ```ts
   useEffect(() => {
     if (cooldownEndsAt && now !== null && now >= cooldownEndsAt) {
       setCooldownEndsAt(null);
       clearCooldownEndsAt();
     }
   }, [now, cooldownEndsAt]);
   ```

8. **衍生值（render 內，不用 state）**：
   ```ts
   const remainingSeconds =
     cooldownEndsAt && now !== null
       ? Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000))
       : 0;
   const inCooldown = remainingSeconds > 0;
   ```

9. **修改 `handleSubmit`**：在既有 `setErrorMsg(result.error ?? "登入失敗，請稍後再試");` 那行之後（403 分支處理處）加入：
   ```ts
   setShowResend(result.error === EMAIL_NOT_CONFIRMED_ERROR);
   setResendMessage("");
   setResendError("");
   ```
   - 放在 `setErrorMsg` 之後、`finally` 之前。每次重新提交登入表單都重置 resend 專屬訊息（避免舊訊息殘留），但**不**重置 `cooldownEndsAt`（冷卻是全域的，不因重新登入而重置 — 對齊 edge case「換 email 不重置冷卻」）。
   - 若 `result.ok`（登入成功導頁），維持不變，不需特別處理 `showResend`（頁面即將導航離開）。

10. **新增 `handleResendClick` handler**（`handleSubmit` 之後）：
    ```ts
    async function handleResendClick() {
      if (resendLoading || inCooldown) return; // 防重複點擊
      setResendLoading(true);
      setResendError("");
      setResendMessage("");
      try {
        const result = await resendVerificationRequest(email); // 讀取「當下」email state，非快照
        if (result.ok) {
          setResendMessage(result.message ?? "");
          const endsAt = Date.now() + RESEND_COOLDOWN_MS;
          setCooldownEndsAt(endsAt);
          writeCooldownEndsAt(endsAt);
        } else {
          setResendError(result.error ?? "連線失敗，請稍後再試");
        }
      } finally {
        setResendLoading(false);
      }
    }
    ```
    - `resendVerificationRequest` 內部的 `postJson` 已經把 fetch 失敗（網路層）與 4xx JSON 錯誤統一成 `{ ok: false, error }`（`fetch` reject 情況回傳 `NETWORK_ERROR` 常數），故 400 與網路失敗兩種 error state 走同一個 `else` 分支，天然滿足「按鈕不進入冷卻、恢復 idle」的要求 — **不需要**額外 try/catch 包 `resendVerificationRequest` 本身（它已經是「永不 throw」的 wrapper）。
    - 不 setShowResend(false) — 即使 resend 本身失敗，仍應維持顯示按鈕（使用者可能還沒登入成功，仍在 email_not_confirmed 分支）。

11. **UI：在 `errorMsg` 的 `{errorMsg && (...)}` 區塊之後、`<button type="submit">` 之前，新增條件區塊**：
    ```tsx
    {showResend && (
      <div className="flex flex-col gap-2 rounded-lg border border-black/8 bg-zinc-50 p-3 dark:border-white/[.145] dark:bg-zinc-900">
        <button
          type="button"
          onClick={handleResendClick}
          disabled={resendLoading || inCooldown}
          className="h-10 rounded-full border border-black/12 px-4 text-sm font-medium transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/18 dark:hover:bg-white/5"
        >
          {resendLoading
            ? "寄送中…"
            : inCooldown
              ? `重新寄送驗證信 (${remainingSeconds} 秒後可重試)`
              : "重新寄送驗證信"}
        </button>

        {resendMessage && (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{resendMessage}</p>
        )}

        {resendError && (
          <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
            {resendError}
          </p>
        )}
      </div>
    )}
    ```
    - 按鈕型別為 `type="button"`（避免誤觸發表單 `onSubmit`）。
    - `resendMessage` 用中性色（`zinc`），`resendError` 用 `amber`（琥珀色）與登入的 `red` 錯誤文字視覺區分，滿足「需清楚是重寄動作失敗而非登入失敗」。
    - `resendMessage` 直接逐字顯示 `result.message`（後端固定訊息），前端不加工/不改寫，符合防枚舉規則。

12. **不修改**：`src/app/api/auth/resend/route.ts`（Task 8 已完成，契約不變）、`src/proxy.ts`（`/api/auth/resend` 已在白名單）、`src/lib/validation.ts`（email 驗證邏輯沿用不動，out of scope）。

## Data Flow

```
使用者提交登入表單
  → loginRequest(email, password) → POST /api/auth/login
  → result.error === EMAIL_NOT_CONFIRMED_ERROR ?
        是 → setShowResend(true)，同時顯示既有紅色 errorMsg（並存，不取代）
        否 → setShowResend(false)（維持現有行為，僅紅色錯誤文字）

使用者點擊「重新寄送驗證信」(idle 且非 loading/cooldown)
  → handleResendClick 讀取「當下」email state
  → resendVerificationRequest(email) → POST /api/auth/resend
        200 → 顯示 result.message（逐字）+ 啟動冷卻:
                cooldownEndsAt = Date.now() + 60000
                → setState + localStorage 寫入(try/catch)
        400 / 網路錯誤 → 顯示 resendError，按鈕恢復 idle，不動 cooldownEndsAt

冷卻倒數:
  cooldownEndsAt (state, 來源: localStorage 或剛觸發的寫入)
    → useEffect 啟動 setInterval 每秒更新 now
    → remainingSeconds = ceil((cooldownEndsAt - now) / 1000)  ← 以時間戳差值計算,非遞減
    → remainingSeconds <= 0 時 → 清除 state + localStorage → 按鈕恢復 idle

頁面重整:
  → useEffect(mount) 讀 localStorage → 若未到期則以剩餘秒數繼續倒數（不重給滿 60 秒）
  → 若已到期/資料異常 → 視為 idle
```

## Test Plan

無 JS test framework/Docker（依 AGENTS.md），驗證方式：

- **靜態驗收（QA agent，程式碼審視 + checklist）**：
  - `resend-cooldown.ts` 三個函式的邊界情況：正常時間戳、缺值(`null`)、非數字字串(`Number(raw)` → `NaN`)、過去時間戳(`<= Date.now()` 判斷)、`localStorage` 拋例外（模擬無痕模式限制）時不 throw。
  - `login/page.tsx`：`showResend` 只在 `result.error === EMAIL_NOT_CONFIRMED_ERROR` 時為真（非該 403/401 分支不顯示，程式碼比對 `handleSubmit` 邏輯）。
  - `handleResendClick` 防重複點擊（`resendLoading || inCooldown` 提前 return）程式碼審視。
  - `resendMessage`/`resendError` 逐字顯示、不加工（無字串串接/條件文案分歧）。
  - 追加 `supabase/tests/auth_routes_manual.md` 第 10 節，逐條列出上述斷言 + 7 項 AC + 6 項 edge case + 2 項 error state 對應的檢查步驟。

- **Playwright（本 story 的驗收閘門，FRONTEND task 必跑）**：
  - 需要一個真實「已註冊未驗證」帳號才能觸發 403 email_not_confirmed 分支（可比照 Task 8 QA 作法，用 `+alias` gmail 建立一次性測試帳號，或若已有既存測試帳號則重用）。
  - 情境涵蓋 orchestrator-output.md 全部 7 項 Acceptance Criteria：按鈕出現條件、點擊呼叫 resend 並 loading/disabled、200 成功訊息逐字顯示 + 啟動 60 秒冷卻、400/網路錯誤不進入冷卻、reload 後剩餘秒數續倒數（可用 `page.evaluate` 直接寫入 localStorage 過去/未來時間戳來加速測試而不用真的等 60 秒）、倒數歸零自動恢復 idle、換 email 不重置冷卻。
  - **本次一併補跑 Task 7 延後的 playwright 清單**（見 `supabase/tests/auth_routes_manual.md` 第 9.3 節）：未登入 `/profile` 導 `/login`、已登入 `/login`/`/register` 導 `/`、登入後 `/profile` 可見、未登入首頁/login/register 正常渲染無誤導、未登入打 `/api/profile` 回 401 JSON、登出後 reload `/profile` 導回 `/login`。這是欠帳，需在本次 playwright 執行時一次補齊，不可再延後。
  - 建議用 `page.evaluate(() => localStorage.setItem(...))` / `page.clock`（若 Playwright 版本支援）模擬冷卻到期與竄改資料情境，避免真的等待 60 秒拖慢測試。

- **Edge cases to test**（對應 orchestrator-output.md）：
  - loading 期間重複點擊不重複送出。
  - localStorage 值異常/竄改 → fallback idle，不崩潰。
  - localStorage 不可用（模擬拋例外）→ 頁面內仍可倒數，但不 throw、不影響其他功能。
  - 背景分頁節流 → 用時間戳差值而非計數器，重新聚焦後秒數正確（不用真的切分頁測試，程式碼審視 + 手動用瀏覽器 devtools 節流模擬即可）。
  - email 欄位在按鈕出現後被修改 → 點擊時送出的是修改後的新值（不是 403 當下快照）。
  - 非 `email_not_confirmed` 的 403/401（帳密錯誤）→ 不顯示按鈕。

## Architecture Notes

- **Next.js 16 檢查**：本任務只用到純 React client-side API（`useState`/`useEffect`/`setInterval`/`localStorage`），未新增任何 Next.js 框架層 API（無 server actions、無 route handler 變更、無 `fetch` cache 選項）。`login/page.tsx` 已是 `"use client"` 且已用 `useRouter` from `next/navigation`（Task 5 已確認的既有模式），本次不需要額外查閱 `node_modules/next/dist/docs/`。
- **為何獨立 helper 模組而非寫在 `page.tsx` 內**：`src/lib/` 目前已有 `auth-client.ts`（fetch wrapper）與 `validation.ts`（純驗證函式）兩個先例，都是「與元件邏輯解耦的純函式」。localStorage 讀寫同樣是可獨立測試、無 UI 依賴的邏輯，抽成 `resend-cooldown.ts` 符合既有慣例，不是新發明的模式。
- **為何用時間戳差值而非 `setInterval` 遞減計數器**：分頁背景時瀏覽器會節流 `setInterval`，若用遞減計數器會與實際到期時間漂移；改成「每次 tick 都用 `Date.now()` 對照 `cooldownEndsAt` 重算」，即使某幾次 tick 被跳過，UI 顯示的秒數仍然準確（下次 tick 觸發時會一次補正）。
- **SSR/hydration 注意**：`cooldownEndsAt` 初始值刻意設為 `null` 並在 `useEffect` 中才讀 `localStorage`，避免 server render（`window` 不存在）與 client render 不一致造成 hydration 警告/錯誤。
- **冷卻為全域單一 key**：刻意不以 email 作 key，一方面符合 orchestrator-output.md 的產品決策，另一方面避免「以 email 命名 localStorage key」間接洩漏曾經嘗試重寄的 email 列表（安全考量,非只是實作方便）。
- **风险/複雜度**：無已知風險，UI 狀態機單純（idle/loading/cooldown 三態），且沿用既有 fetch wrapper 模式，複雜度未超出原 story 範圍。
- **Task 7 playwright 欠帳**：需在本任務的 playwright 階段一併補跑（已在 Test Plan 中列出），不是本次架構決策的一部分，但屬於流程延續，architect 提醒 playwright agent 不要遺漏。

## Security Checklist

- [ ] No hardcoded secrets or credentials
- [ ] Input validation implemented at system boundaries（沿用既有 `isValidEmail`，未新增輸入路徑；resend 呼叫本身的 400 驗證已在後端 Task 8 完成）
- [ ] Auth/permission checks in place（n/a — `/api/auth/resend` 為公開白名單 route，未登入可呼叫，符合設計）
- [ ] No sensitive data logged（本次無新增 `console.*` 呼叫；localStorage 僅存數字時間戳，不存 email/token）
- [ ] 防枚舉：`resendMessage`/`resendError` 皆逐字顯示後端回應，前端不做任何「猜測」式差異化文案或依 timing 推斷帳號狀態
- [ ] localStorage key 不含 email 或任何可識別使用者的資訊（全域單一 key）
- [ ] auth-adjacent 變更 — 已依 AGENTS.md 規則提醒 PR Reviewer 本次自動列為 🔴 Critical 審查等級

## Definition of Done

- [ ] All implementation steps complete
- [ ] All tests from test plan written and passing（含 Task 7 補跑的 playwright 清單）
- [ ] No TODOs, commented-out code, or debug logs
- [ ] Code follows all rules in AGENTS.md
- [ ] Security checklist passed
