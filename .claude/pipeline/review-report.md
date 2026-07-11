# Code Review Report — 登入頁「重新寄送驗證信」按鈕 + 60 秒冷卻
> Generated: 2026-07-11T10:15:00+08:00 | Review iteration: 1 | Reviewer: PR Reviewer agent
> Story: 會員系統 | Task 9 of 9 | Type: FRONTEND

## Overall Assessment
APPROVED

## Summary
`src/lib/resend-cooldown.ts`、`auth-client.ts` 新增匯出、`login/page.tsx` 的 state/effect/handler/UI 皆與 architect-plan 逐步吻合;倒數以時間戳差值運算（非遞減計數器）、mount 時續倒數、歸零自動清除、全域單一 localStorage key（不含 email）、成功訊息逐字顯示、400/網路錯誤不進冷卻並立即恢復 idle、email 即時讀取（非 403 快照）等全部驗收條件均正確實作。本 task 為 auth-adjacent（登入頁分支邏輯 + 呼叫驗證信重寄），已依 AGENTS.md 規則以 🔴 最嚴標準逐項複核 — **未發現任何安全漏洞或邏輯違規**。`npm run lint`、`npx tsc --noEmit`、`npm run build` 三者皆重跑並確認通過。僅 3 項可選建議，無 Critical、無 Should Fix。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

### Auth-adjacent 強制審視結果（AGENTS.md 自動 🔴 標準，逐項通過）
1. **防枚舉**：`resendMessage` 直接顯示 `result.message`（後端固定字串「若該信箱已註冊且尚未驗證，驗證信已重新寄出」），前端無任何依 timing/內容做差異化分支，逐字顯示不加工。**PASS**
2. **localStorage 是全域的，不分 email**：`resend-cooldown.ts` 的 `RESEND_COOLDOWN_STORAGE_KEY = "auth:resend_cooldown_ends_at"` 為單一固定 key，不含 email 或任何識別資訊；換 email 不重置冷卻（`handleSubmit` 的 403 分支只重置 `resendMessage`/`resendError`/`showResend`，刻意不動 `cooldownEndsAt`）。**PASS**
3. **localStorage 讀寫容錯（try/catch，永不 throw）**：`readCooldownEndsAt`/`writeCooldownEndsAt`/`clearCooldownEndsAt` 三者皆 try/catch 包裹，catch 分支不做任何事、絕不 throw；`readCooldownEndsAt` 對非數字字串（`Number(raw)` → `NaN`）與過去/竄改時間戳（`!Number.isFinite(value) || value <= 0` → `null`）正確視為「已到期」，配合呼叫端 `storedEndsAt > Date.now()` 判斷，fallback idle，不會讓頁面 crash。**PASS**
4. **倒數以時間戳差值計算，非遞減計數器**：`remainingSeconds = Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000))`，每次 `setInterval` tick 用 `Date.now()` 對照 `cooldownEndsAt` 重算，避免背景分頁 `setInterval` 被節流造成秒數漂移；倒數歸零（`now >= cooldownEndsAt`）時自動 `setCooldownEndsAt(null)` + `clearCooldownEndsAt()`，恢復 idle 且清除 localStorage。**PASS**
5. **重整頁面續倒數（非重新給滿 60 秒）**：mount 時的 `useEffect` 讀 `readCooldownEndsAt()`，若 `storedEndsAt > Date.now()` 直接以剩餘秒數繼續倒數；`cooldownEndsAt` 初始值為 `null` 且延後到 `useEffect` 才讀 `localStorage`，避免 SSR/hydration mismatch。**PASS**
6. **email 使用登入表單既有 state，即時讀取非快照**：`handleResendClick` 內 `resendVerificationRequest(email)` 讀的是呼叫當下的 `email` state（函式重新執行時取得最新閉包值），符合「使用者點擊前修改 email 應送出新值」的要求；未另外提供 email 輸入欄位。**PASS**
7. **成功/失敗訊息分離顯示**：`resendMessage`（中性 zinc 樣式）與既有登入 `errorMsg`（紅色）為獨立區塊，並存不互相覆蓋；`resendError`（amber）與 `resendMessage` 亦互斥顯示，視覺上可清楚分辨「重寄失敗」非「登入失敗」。**PASS**
8. **400/網路錯誤不進冷卻，按鈕立即恢復 idle**：`postJson` 已把 fetch reject（網路層）與 4xx JSON 錯誤統一收斂成 `{ ok: false, error }`；`handleResendClick` 的 `else` 分支只 `setResendError(...)`，不觸碰 `cooldownEndsAt`/`writeCooldownEndsAt`，`finally` 保證 `resendLoading` 恢復 `false`，按鈕立即恢復可點擊、不進冷卻。**PASS**
9. **登入表單維持可見可操作（非取代畫面）**：`showResend` 區塊是在既有 `errorMsg` 之後、`<button type="submit">` 之前疊加的獨立 `<div>`，email/password 輸入框與登入按鈕的 JSX 完全未變動、未被任何取代畫面覆蓋。**PASS**
10. **Auth/permission**：`/api/auth/resend` 為 `PUBLIC_API_PATHS` 白名單既有項目（`src/proxy.ts:12`，本次未修改），未登入可呼叫本屬設計；本次無新增授權路徑，`src/proxy.ts` 本身零改動。**PASS**
11. **敏感資料/log**：`resend-cooldown.ts` 僅存數字時間戳，不存 email/token；新增程式碼零 `console.*` 呼叫。**PASS**
12. **前端不得直連 Supabase**：本次無任何 `@supabase/*` import，全走 `resendVerificationRequest` → `postJson("/api/auth/resend")`，符合 AGENTS.md 架構規則。**PASS**
13. **hardcode 密鑰**：無。**PASS**

## 🟡 Should Fix (Auto-resolved by Developer)
無。

## 💡 Suggestions (Consider — No Action Required)

### Suggestion 1
- **File**: `src/app/login/page.tsx:29-41, 44-52, 55-62`
- **Issue**: 三個 `useEffect` 內的 setState 呼叫改包在 `queueMicrotask(...)` 中，偏離 architect-plan 原始虛擬碼（plan 寫的是直接同步 `setState`）。程式碼註解與 task-log 皆已誠實記錄原因：以 `eslint --print-config` 確認專案實際啟用 `react-hooks/set-state-in-effect`（error 等級），直接在 effect body 同步呼叫 setState 會被擋下，此為 lint 強制要求下的合理調整，行為等效（`queueMicrotask` 於下一個 microtask、繪製前執行，無使用者可感知延遲），`npm run lint` 已重跑確認通過。
- **Suggested fix**: 無強制要求。若要更精確，註解可以不用「與 profile/page.tsx 既有慣例一致」來類比 —— `profile/page.tsx` 是包在真正的非同步 I/O（`.then()`）內，而本次是人為用 `queueMicrotask` 延後純同步邏輯以滿足 lint 規則，兩者手法相似但性質不同，註解可講得更精確一些。純文字精確度，不影響功能。

### Suggestion 2
- **File**: `src/app/login/page.tsx:102-103`
- **Issue**: `handleResendClick` 的防重複點擊靠 `if (resendLoading || inCooldown) return;` 搭配 `disabled` 屬性。理論上若使用者在同一個 tick 內觸發兩次 click（在 React 完成重新渲染、`disabled` 屬性反映到 DOM 之前），存在極小機率的競態窗口讓兩個請求都送出。這與既有 `handleSubmit`/`submitting` 的防重複點擊模式同構（非本次新增的模式類別），且後端 resend 本身冪等（一律回相同 200 通用訊息），實際影響可忽略。
- **Suggested fix**: 無需修改，記錄供未來若要引入 `useTransition`/ref-based lock 時一併考慮。

### Suggestion 3（延續 Task 8 審核已提過的項目）
- **File**: repo root `Design.pdf`（untracked，1MB PDF）
- **Issue**: Task 8 review 已提醒此檔與該次改動無關、建議 developer 確認是否應移除或加入 `.gitignore`；本次 `git status` 顯示它仍是 untracked 狀態，尚未處理。與 Task 9 本身無關，不影響本次核准，但累積下來有被誤 `git add -A` 帶入某次 commit 的風險。
- **Suggested fix**: 確認此檔用途；若非專案所需，刪除或加入 `.gitignore`。

## Security Assessment
- Secrets scan: **PASS**（無 hardcoded 密鑰/連線字串；審核檔案內 grep 無 secrets）
- Input validation: **PASS**（沿用既有 `isValidEmail`；`/api/auth/resend` 後端驗證為最終防線，Task 8 已審核）
- Auth/authz: **PASS**（`/api/auth/resend` 為既有公開白名單 route，未新增授權路徑）
- Sensitive logging: **PASS**（新增程式碼零 `console.*`；localStorage 僅存數字時間戳）
- CORS/CSP/proxy: **PASS**（`src/proxy.ts` 本次未觸動）
- Test coverage: 手動 checklist `supabase/tests/auth_routes_manual.md` 第 10 節（10.1–10.8，共 18 項）完整涵蓋 7 項驗收條件 + 6 項 edge case + 2 項 error state + 敏感 log 檢查；playwright 驗收情境已在 architect plan Test Plan 中列出（含 Task 7 欠帳一併補跑），交付 playwright 階段執行
- Lint / typecheck / build: **PASS**（`npm run lint`、`npx tsc --noEmit`、`npm run build` 三者皆重跑並確認通過，`/api/auth/resend`、`/login` 路由正常產生）

## Plan Compliance
- [x] All architect plan steps implemented（12 步全數：helper 模組、auth-client 新增匯出、6 個 state、3 個 useEffect、衍生值、`handleSubmit` 分支處理、`handleResendClick`、UI 區塊、manual checklist 第 10 節）
- [x] Implementation matches plan intent（時間戳差值倒數、mount 續倒數、歸零自動清除、全域 key、email 即時讀取、400/網路錯誤不進冷卻均與 Data Flow 章節一致；`queueMicrotask` 調整已如實記錄且行為等效，見 Suggestion 1）
- [x] No unauthorised scope additions（未修改 `/api/auth/resend/route.ts`、`src/proxy.ts`、`validation.ts`，符合 plan「不修改」清單）

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| （無 🟡 項目，無需開發者回應） | — | — |
