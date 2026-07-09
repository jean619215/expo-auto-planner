# QA Report — 會員系統 / Task 2（auth API routes + email 驗證 + profile trigger）
> Generated: 2026-07-09T06:15:00Z | QA iteration: 2（重驗，聚焦 Bug 1 複驗）

## Testing Method
延續 iteration 1 的方法：專案無 Docker、無 JS 測試框架、QA 環境無法啟動 dev server + 本機 Supabase 實際打 API，採**靜態驗收**——逐行比對程式碼實作、`supabase/tests/auth_routes_manual.md` 手動 checklist，與 `orchestrator-output.md` 驗收條件逐條核對。本輪為第 2 次迭代，聚焦：(1) Bug 1 修正複驗、(2) 修正未破壞其他既有 PASS 項目、(3) manual checklist 斷言是否已能攔截此類問題。

檔案清單（本輪重新讀取以複驗）：
- `src/app/api/auth/register/route.ts`（全文）
- `src/app/api/auth/login/route.ts`、`confirm/route.ts`、`logout/route.ts`（全文，確認未被連帶修改、無回歸）
- `supabase/tests/auth_routes_manual.md`（全文，確認 1.1 / 1.5 斷言更新）
- `.claude/pipeline/qa-report.md`（iteration 1，作為 Bug 1 原始記錄比對基準）
- `.claude/pipeline/orchestrator-output.md`（驗收條件重新核對）

## Summary
- Tests executed: 16 acceptance criteria + 7 edge cases + 1 targeted Bug-1 regression check = 24
- Passed: 24
- Failed: 0
- Blocked: 0

## Recommendation
**APPROVED — Bug 1 已確認修復，無新 bug，其餘既有驗收條件與 edge case 皆維持 PASS。QA 簽核通過。**

---

## Bug 1 複驗（Critical focus of this iteration）

`src/app/api/auth/register/route.ts:57-67`：

```ts
if (error) {
  console.error(
    `[auth/register] signUp error: status=${error.status ?? "?"} code=${error.code ?? "?"} message=${error.message}`
  );
  return Response.json({ message: GENERIC_REGISTER_MESSAGE }, { status: 200 });
}

// enable_confirmations = true，signUp 不會回傳 session；此 route 也不設任何 cookie。
// 帳號枚舉防護：成功與錯誤（含重複 email）分支必須回相同 status code，
// 否則客戶端可用 HTTP status 區分該 email 是否已註冊。兩者一律 200。
return Response.json({ message: GENERIC_REGISTER_MESSAGE }, { status: 200 });
```

- 成功分支（第 67 行）與錯誤分支（第 61 行，含重複 email）**status code 皆為 200**，body 皆為同一個 `GENERIC_REGISTER_MESSAGE`（`"註冊成功，請至信箱點擊驗證連結完成驗證"`）常數。✅ **兩分支在 status code 與 body 文字上完全不可區分** — Bug 1 的 side-channel（201 vs 200）已消除。
- Server 端 log（第 58-60 行）維持不變：僅記 `status`/`code`/`message`，不含 email/密碼/token，「失敗要留痕」的要求仍成立。✅
- 程式碼內附上清楚的中文註解說明「兩者一律 200」的防枚舉理由，避免未來維護者又不小心讓兩分支 status 漂移。✅ 屬良好實踐。
- **結論：Bug 1 確認修復，無殘留 side-channel。**

### Manual checklist 斷言複驗（`supabase/tests/auth_routes_manual.md`）
- 1.1 節（`供合法 email+密碼`）：預期 status 已從 `201` 改為 `200`，與程式碼實作一致。✅
- 1.5 節（重複 email）：新增「⚠️ **關鍵防枚舉斷言**：此 status code 必須與 1.1 成功時**完全相同**（皆為 `200`）。若兩者不同（例如 1.1 回 201、這裡回 200），即使 body 訊息一樣，客戶端仍可用 HTTP status 區分該 email 是否已註冊 → 視為 fail。」✅ 這條斷言明確要求跨案例比對 status，往後若 status 又意外分歧（例如未來重構動到其中一支分支），照此 checklist 手動測試即可攔截，補上了 iteration 1 發現的 checklist 缺口。

---

## Acceptance Criteria Results

| Criterion | Result | Notes |
|---|---|---|
| register 合法 email+密碼 → 成功、未驗證、提示收信、不建 session | ✅ PASS | `register/route.ts:67` 回 200（已從 201 調整）+ 通用訊息；使用 admin client（不綁 cookie），無 `Set-Cookie` 寫入路徑。 |
| register 重複 email → 明確錯誤但不洩漏帳號存在與否 | ✅ **PASS（Bug 1 已修復）** | 成功分支與錯誤分支 status 皆 200、body 皆同一常數，HTTP 層與文字層皆不可區分。 |
| login 未驗證帳號 → 「請先驗證信箱」錯誤，不給 session | ✅ PASS | 未受本次修正影響，程式碼與 iteration 1 相同，複核維持 PASS。 |
| login 已驗證帳號 + 正確帳密 → 設 httpOnly cookie、成功 | ✅ PASS | 同上，未變動。 |
| `GET /api/auth/confirm` 合法 token → 驗證完成、建立 profile、可導向 | ✅ PASS | 同上，未變動。 |
| `POST /api/auth/logout` → 清除 session cookie | ✅ PASS | 同上，未變動。 |
| profile: 驗證完成後 `profiles` 存在對應 row，role 預設 `user` | ✅ PASS | trigger migration 未變動。 |
| 密碼交給 Supabase Auth（bcrypt） | ✅ PASS | 未變動。 |
| httpOnly + Secure + SameSite cookie 設定正確 | ✅ PASS | 未變動。 |
| secret key 走 env，不 hardcode | ✅ PASS | 未變動。 |
| 輸入驗證在 API 邊界 | ✅ PASS | register 缺欄位/型別/格式/密碼長度檢查（32-41 行）未受本次修正影響，複核維持 PASS。 |
| trigger: on auth.users insert 自動建 profile | ✅ PASS | 未變動。 |
| trigger: SECURITY DEFINER + search_path 鎖定 | ✅ PASS | 未變動。 |
| trigger: 冪等 | ✅ PASS | 未變動。 |
| 全域: 不 log 密碼/token | ✅ PASS | register 錯誤分支 log 內容複核仍僅含 status/code/message。 |
| secret key 只在 server（不進前端 bundle） | ✅ PASS | 未變動。 |

## Edge Case Results

| Edge Case | Result | Notes |
|---|---|---|
| 無效 email 格式 → 400 非 500 | ✅ PASS | `register/route.ts:32-34` 未受修正影響。 |
| 弱密碼（過短）→ 400 非 500 | ✅ PASS | `register/route.ts:36-41` 未受修正影響。 |
| 缺欄位（無 email 或 password）→ 400 | ✅ PASS | 未受修正影響。 |
| 登入密碼錯誤 → 401，不透露帳號存在與否 | ✅ PASS | login route 未變動。 |
| 驗證 token 過期/無效 → 明確錯誤，非 500 | ✅ PASS | confirm route 未變動。 |
| 所有 route 不得 log 密碼/token/session | ✅ PASS | 複核 register 唯一新增 log 內容安全。 |
| secret key 只在 server 端使用 | ✅ PASS | 未變動。 |

## Error State Results

| Error State | Result | Notes |
|---|---|---|
| register：JSON 格式錯誤 | ✅ PASS | `route.ts:12-15` 回 400，未受本次修正影響。 |
| register：Supabase signUp 回錯（重複 email / 其他） | ✅ PASS | 修正後與成功分支 status/body 一致，Bug 1 消除。 |
| confirm：`token_hash`/`type` 缺漏或非白名單 type | ✅ PASS | 回 400，未變動。 |

## Regression Check

| Feature | Result | Notes |
|---|---|---|
| Task 1：`profiles` 表結構 / RLS | ✅ PASS | 本輪修正未觸及 migration，未受影響。 |
| Task 1：`profiles_verify.sql` 手動驗證流程 | ✅ PASS | 未受影響。 |
| login / logout / confirm 三條 route | ✅ PASS | 複核程式碼與 iteration 1 完全相同，本次僅修改 register，無連帶回歸。 |
| register 既有的缺欄位/格式/弱密碼 400 分支 | ✅ PASS | 複核第 17-41 行邏輯未被修正動到，維持正確。 |
| `.env.local` / `.env.example` 既有變數 | ✅ PASS | 未受影響。 |
| `npm run lint` | N/A | 本次 QA 環境仍未重跑（同 iteration 1 說明）；此修正僅調整 status code 數值與新增註解，語法風險極低。 |

## Security Test（mandatory）
- 敏感資料外洩（回應/UI）：**PASS** — register/login/confirm/logout 回應皆無密碼、token、token_hash、service_role key 洩漏。
- 輸入驗證（所有進入點）：**PASS** — register/login 邊界檢查缺欄位/型別/格式/長度；confirm 邊界檢查 `token_hash`/`type` 白名單，皆未受本次修正影響。
- Auth 邊界 / 帳號枚舉：**PASS（Bug 1 已修復）** — register 成功與重複 email 兩分支 status code（200/200）與 body 完全一致，side-channel 已消除；login 端維持 iteration 1 即已 PASS 的狀態（401 通用訊息覆蓋帳號不存在與密碼錯誤）。
- Secret key 隔離：**PASS** — 未受本次修正影響。

---

## Bugs Found

無。Bug 1（iteration 1 發現的 register 帳號枚舉 side-channel）已於本輪確認修復，本輪複驗過程未發現任何新 bug。

---

## Test Coverage
- New code coverage: 0%（無自動化測試框架，符合 Task 1 已核可的專案現況）
- Minimum required: 依 AGENTS.md「Current coverage: 0%. No test framework installed yet.」— 已於 iteration 1 標記旗標，本輪狀態不變，不構成阻擋項。
- Status: **FLAGGED（沿用已核可的手動 checklist 替代方案，非本次簽核阻擋原因）**
