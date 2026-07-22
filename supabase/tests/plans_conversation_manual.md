# `DELETE /api/plans/[slot]/conversation` 手動驗證 Checklist

> 對象:`DELETE /api/plans/[slot]/conversation`(Task 3:存檔 UI + AiPanel 清空對話)
> 驗證方式:fetch/curl 腳本對 local dev server(`npm run dev`,接真雲端 Supabase)實測;
> 登入用 Playwright 測試帳號(`.env.playwright.local`)或既有手動流程(瀏覽器登入後取 cookie)。
> 依賴 `venue_plans_api_manual.md` 相同前置條件(migration 已 push)。

## 準備

```bash
COOKIE="<登入後取得的 cookie 字串>"
BASE="http://localhost:3000"
VALID_PLAN='{"polygon":[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1}],"walls":[],"columns":[],"furniture":[],"venueSizeM":50}'
```

## 1. 未登入 → 401(對應 AC14)

- [ ] `curl -i -X DELETE $BASE/api/plans/1/conversation` → 401 `{"error":"請先登入"}`

## 2. slot 參數驗證 → 400(不查 DB)

- [ ] `curl -i -b "$COOKIE" -X DELETE $BASE/api/plans/0/conversation` → 400 `{"error":"存檔格位不正確"}`
- [ ] `curl -i -b "$COOKIE" -X DELETE $BASE/api/plans/abc/conversation` → 400
- [ ] `curl -i -b "$COOKIE" -X DELETE $BASE/api/plans/1.0/conversation` → 400(`"1.0"` 不在白名單)

## 3. 找不到存檔 → 404(對應 AC15,跨使用者/不存在統一 404 同字串同狀態碼)

- [ ] 對自己從未存過的格(如 slot 3)→ `curl -i -b "$COOKIE" -X DELETE $BASE/api/plans/3/conversation` → 404 `{"error":"找不到存檔"}`
- [ ] 兩帳號 A/B:A 對 slot 1 存檔;B 登入後對 `DELETE $BASE/api/plans/1/conversation` → 404
      (與「自己未存過」情境回應完全一致,不洩漏是否存在)

## 4. 成功清空 → 200 冪等(對應 AC11)

- [ ] 先用 `POST /api/ai/chat` 帶 `planId` 建立至少一輪對話(見 `ai_chat_manual.md`)
- [ ] `curl -i -b "$COOKIE" -X DELETE $BASE/api/plans/1/conversation` → 200 `{"slot":1,"cleared":true}`
- [ ] 用 `ai_conversations_verify.sql` 或直接查詢確認該 `plan_id` 對應的 `ai_conversations` 列已刪除(cascade 帶走 `ai_messages`)
- [ ] 緊接著再打一次同樣的 DELETE(無對話列的情況下)→ 仍是 200 `{"slot":1,"cleared":true}`(冪等,而非 404)
- [ ] `GET /api/plans/1` 複查 → `conversation: []`,但 `plan`(場地配置)完全未變

## 5. SQL 層(對應 AC14 精神,admin 無 RLS 慣例)

- 本端點僅用 admin client(`.eq("user_id", userId)` 為安全關鍵),無新增 grant/revoke 變更 —
  沿用 `venue_plans_verify.sql` / `ai_conversations_verify.sql` 既有 SQL 層驗證,本端點不需
  額外 SQL 腳本。
