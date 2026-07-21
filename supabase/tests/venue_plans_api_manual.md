# 場地儲存檔 API 手動驗證 Checklist

> 對象:`GET /api/plans`、`GET|PUT|PATCH|DELETE /api/plans/[slot]`
> 驗證方式:fetch/curl 腳本對 local dev server(`npm run dev`,接真雲端 Supabase)實測;查核用 service_role;登入用 Playwright 測試帳號(`.env.playwright.local`)或既有手動流程(瀏覽器登入後取 cookie)。
> **前置條件(必須先完成,pipeline 內不執行)**:使用者手動跑 `supabase db push` 套用
> `supabase/migrations/20260722030000_create_venue_plans.sql`,再跑
> `supabase/tests/venue_plans_verify.sql` 全項通過。在 migration push 之前,以下所有
> 打到 DB 的路徑都會回 500(`42P01` 表不存在)——本次交付只驗證了不碰 DB 的 401/400
> 路徑(見下方「本次已驗證」段落),其餘標記「待 migration push 後驗」。

## 準備

```bash
# 登入取得 cookie(沿用既有手動流程:瀏覽器登入後複製 cookie,或用測試帳號跑 /api/auth/login)
COOKIE="<登入後取得的 cookie 字串>"
BASE="http://localhost:3000"

VALID_PLAN='{"polygon":[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1}],"walls":[],"columns":[],"furniture":[]}'
```

## 1. 未登入 → 401(對應 AC 1)

- [ ] `curl -i $BASE/api/plans` → 401 `{"error":"請先登入"}`
- [ ] `curl -i $BASE/api/plans/1` → 401
- [ ] `curl -i -X PUT $BASE/api/plans/1 -H 'Content-Type: application/json' -d "{\"plan\":$VALID_PLAN}"` → 401
- [ ] `curl -i -X PATCH $BASE/api/plans/1 -H 'Content-Type: application/json' -d '{"name":"x"}'` → 401
- [ ] `curl -i -X DELETE $BASE/api/plans/1` → 401

## 2. slot 參數驗證(對應 AC 6,不查 DB,不需 migration)

- [ ] `curl -i -b "$COOKIE" $BASE/api/plans/0` → 400 `{"error":"存檔格位不正確"}`
- [ ] `curl -i -b "$COOKIE" $BASE/api/plans/4` → 400
- [ ] `curl -i -b "$COOKIE" $BASE/api/plans/abc` → 400
- [ ] `curl -i -b "$COOKIE" -X PUT $BASE/api/plans/1.0 -d "{\"plan\":$VALID_PLAN}"` → 400(`"1.0"` 不在白名單)
- [ ] `curl -i -b "$COOKIE" -X PATCH $BASE/api/plans/abc -d '{"name":"x"}'` → 400
- [ ] `curl -i -b "$COOKIE" -X DELETE $BASE/api/plans/abc` → 400

## 3. `PUT /api/plans/[slot]` 存檔(待 migration push 後驗;對應 AC 2/3/4)

- [ ] 空格,不帶 `name`,帶合法 `plan` → 200,`name` = `未命名場地`
  ```bash
  curl -i -b "$COOKIE" -X PUT $BASE/api/plans/1 -H 'Content-Type: application/json' \
    -d "{\"plan\":$VALID_PLAN}"
  ```
- [ ] 同一格再次 PUT,不帶 `name`,帶不同 `plan` → 200,`plan` 全量覆蓋、`name` 保留原值不變
- [ ] 同一格再次 PUT,帶 `name":"羽球場配置"` → 200,`plan` 與 `name` 皆更新
- [ ] `plan` 缺少 `polygon`/`walls`/`columns`/`furniture` 任一 key → 400 `{"error":"存檔格式錯誤"}`
- [ ] `plan.polygon` 長度 < 3 → 400
- [ ] `plan.polygon` 元素缺 `x`/`y` 或非 number → 400
- [ ] body 不是合法 JSON(如 `-d 'not json'`)→ 400
- [ ] Response 不含整包 `plan`(只回 `slot`/`name`/`updatedAt`)

## 4. `GET /api/plans/[slot]` 讀檔(待 migration push 後驗;對應 AC 7/8)

- [ ] 對自己未使用過的格(如 slot 3)→ 404 `{"error":"找不到存檔"}`
- [ ] 對已存檔的格 → 200,含完整 `plan` 快照、`name`、`updatedAt`、`conversation: []`

## 5. `GET /api/plans` 列表(待 migration push 後驗;對應 AC 9)

- [ ] 全新帳號(尚未存過任何格)→ 200,`slots` 為固定 3 元素,皆 `occupied: false, name: null, updatedAt: null`
- [ ] 存過 slot 1 之後 → 200,`slots[0].occupied === true` 且含正確 `name`/`updatedAt`,`slots[1]`/`slots[2]` 仍為空
- [ ] Response 不含 `plan` 欄位

## 6. `PATCH /api/plans/[slot]` 改名(待 migration push 後驗;對應 AC 10/11/12)

- [ ] 已占用格,帶合法 `name` → 200,`name` 更新、`plan` 不受影響(用 GET 複查 plan 內容未變)
  ```bash
  curl -i -b "$COOKIE" -X PATCH $BASE/api/plans/1 -H 'Content-Type: application/json' -d '{"name":"新名稱"}'
  ```
- [ ] `name` 為空字串 `""` → 400 `{"error":"名稱不可為空"}`
- [ ] `name` 為全空白 `"   "` → 400
- [ ] 目標格未占用(如 slot 3)→ 404
- [ ] body 非合法 JSON → 400

## 7. `DELETE /api/plans/[slot]`(待 migration push 後驗;對應 AC 12/13)

- [ ] 已占用格 → 200 `{"slot":1,"deleted":true}`
  ```bash
  curl -i -b "$COOKIE" -X DELETE $BASE/api/plans/1
  ```
- [ ] 刪除後再次 `GET /api/plans/1` → 404(確認真的清掉)
- [ ] 對未占用格(已刪除或從未存過)再次 DELETE → 404(非冪等成功,見 orchestrator-output.md 語意)

## 8. 跨使用者隔離(待 migration push 後驗;對應 AC 15)

需要兩個測試帳號 A、B。

- [ ] A 帳號對 slot 1 執行 PUT 存檔成功
- [ ] 切換為 B 帳號登入(取得 B 的 cookie)
- [ ] B 呼叫 `GET /api/plans/1` → 404(驗證 admin client 查詢有 `.eq("user_id", B.id)` 過濾,B 查的是自己的 slot 1,不會看到 A 的資料)
- [ ] B 呼叫 `GET /api/plans` → `slots[0].occupied === false`(B 自己完全沒存檔)

## 9. SQL 層:grant/revoke 擋寫入(對應 AC 14)

見 `supabase/tests/venue_plans_verify.sql` 第 11 節(`set role authenticated` 模擬 insert/update/delete,預期皆 permission denied)。此項為 SQL 層驗證,非 API 測試。

## 本次已驗證(pipeline 內,無需真實 DB)

- [x] 401 路徑(第 1 節)— proxy fail-closed + route 內 `getUser()` 皆生效,未登入呼叫任一路由皆回 401,不查 DB。
- [x] slot 白名單驗證(第 2 節)— `parseSlot` 對 `0`/`4`/`abc`/`"1.0"` 一律回 400,函式邏輯以程式碼審視確認不呼叫 DB。
- [x] `next typegen` + `npm run lint` 乾淨(見交付訊息)。

其餘章節(3–8)因 sandbox 無法執行 `supabase db push`,需使用者手動套用 migration 後,依本 checklist 逐條實測並勾選。
