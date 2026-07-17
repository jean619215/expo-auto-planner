# Architect Plan — 會員點數系統與商店頁 / Task 2(補件驗證)

> Task: [BACKEND] 點數 API — balance / checkout / webhook(mock)
> 性質:驗證既有實作(commit 5c6c7d7)。發現缺口才修改。

## 前提
- dev server:`npm run dev`(接真雲端 Supabase)。
- 登入態:fetch 腳本先打 `POST /api/auth/login`(Playwright 測試帳號),帶回 Set-Cookie 後續請求附上。
- webhook 簽章:`signMockPayload`(scratchpad 腳本直接 import `src/lib/points/provider.ts` 的等價 HMAC 邏輯 — 用相同 secret 預設值 `mock-payment-dev-secret` 重算即可,不改動原始碼)。
- 所有測試訂單/發點事後 service_role 清理(delete orders + ledger 測試列)。

## 驗證步驟

### Step 1 — 靜態核對(AC5)
三支 route + provider.ts + proxy.ts 對照 AGENTS.md 規範:factory 使用、錯誤 shape、無秘密 log、admin client 使用點、webhook 註解與 allowlist 一致。已於 orchestrate 階段初步讀過,無明顯違規;review 階段獨立複核。

### Step 2 — balance API(AC1)
1. 未登入 GET → 401 `請先登入`。
2. 登入 GET → 200,balance = 該帳號 ledger delta 總和(以 service_role 平行查核對),transactions ≤ 20 筆、降冪。

### Step 3 — checkout API(AC2)
1. 未登入 POST → 401。
2. 登入 + 非 JSON body → 400 `請求格式錯誤`。
3. 登入 + `{"packageId":123}` / `{"packageId":"nope"}` → 400 `無效的點數方案`。
4. 登入 + `{"packageId":"basic"}` → 200 `{ orderId, redirectUrl }`;service_role 查單:pending、amount_twd=100、points=100、provider=mock、user_id 正確(server 端快照,未信任 client)。

### Step 4 — webhook(AC3)
以 Step 3 的訂單走完整流程:
1. 壞簽章 POST → 400 `invalid webhook`,訂單仍 pending、無發點。
2. 正確簽章 POST → 200;查:ledger 有 `order:{id}` +100 點、訂單 paid + provider_txn_id + paid_at。
3. 重送同 payload → 200;ledger 仍只一筆(冪等)。
4. 簽章正確但 orderId 不存在(隨機 uuid,自簽)→ 400 同訊息。
5. 非 JSON body → 400。
6. 未帶 cookie 直打(模擬 server-to-server)成功 — 證明 public allowlist 生效;另打一支非 allowlist 的 `/api/points/balance` 無 cookie 應 401(對照組)。

### Step 5 — production 守門(AC4)
node 一次性探測:`NODE_ENV=production` 且無 `MOCK_PAYMENT_SECRET` 下呼叫 `getPaymentProvider()` 應 throw(以 tsx/ts-node 或抽出等價邏輯驗證;若工具鏈不便,退回程式碼靜態核對並註明)。

### Step 6 — checklist
新增 `supabase/tests/points_api_manual.md`:上述全部探測項與預期結果。

## 產出物
- scratchpad fetch 驗證腳本(不進 repo)
- `supabase/tests/points_api_manual.md`(進 repo)

## Escalation 檢查
- 無 API contract 變更(驗證既有 contract)。webhook 為 auth-adjacent(public 路由 + 簽章守門)→ review 自動 🔴 等級檢視。無 escalation 觸發。
