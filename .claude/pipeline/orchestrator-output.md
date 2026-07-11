# Orchestrator Output — Task 7

> Story: 會員系統 | Task 7 of 9 | Type: FRONTEND

## Task
[FRONTEND] 建立路由保護邏輯:未登入時導向登入頁,已登入時登入/註冊頁導向首頁。

## Confirmed Decisions (from user)
1. 未登入造訪受保護頁面 (`/profile`,及未來新增的受保護頁) → 自動 redirect 到 `/login`。
2. 已登入造訪 `/login` 或 `/register` → 自動 redirect 到首頁 `/`。
3. 首頁 `/` 維持公開 (登入與否都可看)。
4. **驗收方式**: 使用者選擇 Task 7/8/9 完成後一次手動驗收;playwright 瀏覽器驗收延後到 Task 9 完成後合併跑 (一次涵蓋 7+9 的前端情境)。本 task QA 後 stage 直接標 complete,playwright 欠帳記在 task-log。

## 實作位置 (architect 評估)
兩個選項,architect 擇一並說明:
- **選項 A**: 擴充 `src/proxy.ts` — matcher 加頁面路徑,對頁面請求做 redirect (API 維持 401 JSON)。優點: 集中一處、server 端擋、無閃爍;缺點: matcher 變複雜,要小心不誤擋靜態資源。
- **選項 B**: 頁面層處理 — `/profile` 已有 401 顯示邏輯改成 router.replace("/login");login/register 頁載入時查登入狀態導回首頁。優點: proxy 不動;缺點: client 端判斷有載入閃爍、每頁自己處理易漏。
> 傾向 A (集中、fail-closed 精神一致),但由 architect 依 Next.js 16 proxy 文件確認頁面 redirect 的正確做法後定案。

## Backend/既有契約
- proxy 已對 `/api/*` 做 401 (Task 4),頁面路徑目前不在 matcher 內。
- `updateSession(request)` 回 `{response, user}`,可直接判斷登入狀態。
- 受保護頁面清單目前僅 `/profile`;設計需讓未來新增頁面容易 (常數清單)。

## Acceptance Criteria
- 未登入瀏覽器直接開 `/profile` → 被導向 `/login` (URL 變為 /login),不顯示 profile 內容。
- 已登入開 `/login` → 導向 `/`;已登入開 `/register` → 導向 `/`。
- 未登入開 `/login`、`/register`、`/` → 正常顯示,不受影響。
- 已登入開 `/profile` → 正常顯示。
- API 行為不變: 未登入打 `/api/profile` 仍回 401 JSON (不是 redirect)。
- 靜態資源 (_next、favicon、圖片) 不受影響。
- redirect 不進入無限迴圈 (login→/→login 之類)。

## Edge Cases / Notes for QA
- 登出後停在 `/profile` 再重新整理 → 導向 `/login`。
- redirect 用 3xx (server 端) 或 router.replace (client 端),不可用 window.location 硬跳造成歷史紀錄污染 (依所選方案)。
- 不 log token/session。

## Out of Scope
- 登入後導回原本想去的頁面 (returnTo/redirect query) — 之後有需要再加。
- Task 8/9 (resend API 與按鈕)。
