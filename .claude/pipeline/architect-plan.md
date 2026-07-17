# Architect Plan — 會員點數系統與商店頁 / Task 3(補件驗證,最後 task)

> Task: [FRONTEND] 商店頁 /shop + mock 結帳頁 + Header 連結 + Playwright
> 性質:驗證既有實作與測試(commit 5c6c7d7)。缺口才修。

## 驗證步驟

### Step 1 — 靜態核對(AC1/AC2/AC3 對照原始碼)
- `src/app/shop/page.tsx`、`src/app/shop/mock-checkout/page.tsx`、`src/components/Header.tsx`、`src/proxy.ts`(已於 orchestrate 讀過:/shop 在 PROTECTED_PAGES + matcher 雙處,Header 登入時顯示點數商店連結)。
- 規範:shadcn 元件、`@/*` alias、frontend 只打 `/api/*`(無直呼 Supabase)、testid 覆蓋 AC 所需斷言點。

### Step 2 — spec 覆蓋度核對(AC5 對 AC1-AC4)
逐條映射 points-shop.spec.ts 9 測試 → AC:
- AC1:access control 3 測試(/shop redirect、balance 401、checkout 401)✓
- AC2:balance+packages 測試(餘額數字、三卡、註冊禮出現在交易記錄)✓;**缺口候選**:載入骨架/錯誤狀態/unauthenticated 頁面狀態無測試(骨架與 error 屬 UI 細節,可接受 — QA 判定)
- AC3:end-to-end 購買、取消不扣款 ✓;**缺口候選**:購買中按鈕 disabled 文案無測試(可接受 — 手動)
- AC4:重送冪等、竄改簽章 ✓
- checkout 未知方案 400 ✓

### Step 3 — review(獨立)
UI 程式碼 + spec 品質(等待邏輯、flaky 風險、憑證不硬編)。

### Step 4 — QA(獨立)
AC 逐條 + edge case 判定(Step 2 缺口候選是否需補測試)。

### Step 5 — playwright 驗收關卡(最後把關)
- 乾淨 dev server(重啟背景 npm run dev)跑 `points-shop.spec.ts` 全 9 測試。
- Story 收尾:跑全套 spec(8 支檔案,含既有 70 測試 + points-shop 9)確認無迴歸。
- 全綠 → task [x]、story 3/3 完成、Notion task 卡 + story 列標已完成。

## 產出物
- 驗收結果記入 qa-report / task-log
- (若 QA 判定需補測試)points-shop.spec.ts 增測 — 屬缺口修補,非重新實作

## Escalation 檢查
- 無 API contract / schema / auth 變更。無 escalation。
