# Auth Routes 手動測試 Checklist

本專案沒有 Docker、也未安裝 JS 測試框架，因此本 task 的驗收採**手動測試**（延續
`supabase/tests/profiles_verify.sql` 已核可的做法），不是自動化 pgTAP / JS 測試。

## 前置準備

1. 啟動本機 Supabase：`supabase start`
2. 確認 `.env.local` 三個 Supabase key 已對齊本機專案（`supabase start` 印出的
   `API URL` / `anon key` / `service_role key`，或沿用遠端專案設定，視你目前串接
   的是本機還是遠端專案而定）。
3. 確認 `supabase/config.toml` 的 `[auth.email] enable_confirmations = true`
   （本 task 已改好）。
4. 啟動 dev server：`npm run dev`（預設 http://localhost:3000）。
5. 打開本機信箱測試介面 Inbucket：http://127.0.0.1:54324 （`local_smtp`，port
   見 `config.toml` `[local_smtp] port = 54324`）— 用來收註冊/驗證信。
6. 若要驗證 profile 是否自動建立，於 Supabase Studio SQL Editor
   （http://127.0.0.1:54323）另開一個分頁，隨時可查 `public.profiles`。

> 以下 curl 範例使用 `-i` 印出 header（檢查 `Set-Cookie`），並用 `-c cookies.txt`
> / `-b cookies.txt` 在 login → logout 之間保留 cookie。**執行前記得把
> `you@example.com` 換成每次測試用的全新 email**（重複 email 會走「重複註冊」案例）。

---

## 1. 註冊 (`POST /api/auth/register`)

### 1.1 合法 email + 密碼 → 應成功、不建立 session

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"password123"}'
```

- 預期 status：`200`
- 預期 body：`{"message":"註冊成功，請至信箱點擊驗證連結完成驗證"}`
- 預期 header：**不應出現 `Set-Cookie`**（未建立 session）。
- 於 Studio 查 `public.profiles`：應已存在對應該 email 的 auth.users id 的 row，
  `role = 'user'`（由 DB trigger `on_auth_user_created` 自動建立，即使尚未驗證）。

### 1.2 缺 email 或 password → 400

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

- 預期 status：`400`
- 預期 body 含 `error` 訊息（缺欄位）。

同理測試只帶 `password` 不帶 `email`，以及完全空 body `{}`，皆應 `400`。

### 1.3 無效 email 格式 → 400（非 500）

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email","password":"password123"}'
```

- 預期 status：`400`，body 含 email 格式錯誤訊息。

### 1.4 密碼過短 → 400（非 500）

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you2@example.com","password":"123"}'
```

- 預期 status：`400`，body 含密碼長度不足訊息（`minimum_password_length = 6`）。

### 1.5 重複 email 註冊 → 不洩漏帳號存在與否

用 1.1 已註冊過的 email 再送一次相同請求：

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"password123"}'
```

- 預期 status：`200`
- ⚠️ **關鍵防枚舉斷言**：此 status code 必須與 1.1 成功時**完全相同**（皆為 `200`）。
  若兩者不同（例如 1.1 回 201、這裡回 200），即使 body 訊息一樣,客戶端仍可用 HTTP status
  區分該 email 是否已註冊 → 視為 fail。
- 預期 body：與 1.1 成功時**相同**的通用訊息（`註冊成功，請至信箱點擊驗證連結完成驗證`），
  不得出現「此 email 已存在」等揭露性文字。
- 不應建立第二筆 `profiles` row（`on conflict (id) do nothing` 已保證冪等；但因
  email 重複，Supabase 本就不會建立新 auth.users row）。

### 1.6 不 log 敏感資訊

- 檢查 dev server 終端機輸出：整個測試過程中，終端機不應出現完整密碼明文、
  token、token_hash、或 session 內容。

---

## 2. Email 驗證 (`GET /api/auth/confirm`)

> 前置：需先把驗證信模板的連結導向 `/api/auth/confirm?token_hash=...&type=...`
> （見下方「設定備忘」）。若尚未調整模板，可改用 Inbucket 信件中連結手動解析出
> `token_hash` 參數後自行組出本機測試網址。

### 2.1 合法 token_hash → 驗證成功、建立 session

1. 到 Inbucket（http://127.0.0.1:54324）打開 1.1 註冊信件的驗證連結（或依信件內
   `token_hash` 手動組出以下網址）：

```bash
curl -i -c cookies.txt "http://localhost:3000/api/auth/confirm?token_hash=<信件中的token_hash>&type=email"
```

- 預期 status：`303`（redirect）。
- 預期 header：含 `Set-Cookie`，且 cookie 屬性含 `HttpOnly`。
- `cookies.txt` 應寫入 session 相關 cookie（供下方登入測試沿用）。
- 於 Studio 再查一次 `public.profiles`：驗證完成後，該使用者的 row 仍存在（本來
  就已由 trigger 建立），`role` 仍為 `user`。

### 2.2 竄改 / 過期 token_hash → 明確錯誤（非 500）

```bash
curl -i "http://localhost:3000/api/auth/confirm?token_hash=this-is-not-valid&type=email"
```

- 預期 status：`400`
- 預期 body：`{"error":"驗證連結無效或已過期，請重新註冊或重寄驗證信"}`
- **不應**是 `500`。

### 2.3 缺 `token_hash` 或 `type` → 400

```bash
curl -i "http://localhost:3000/api/auth/confirm?type=email"
curl -i "http://localhost:3000/api/auth/confirm?token_hash=abc"
curl -i "http://localhost:3000/api/auth/confirm?token_hash=abc&type=not-a-real-type"
```

- 三者皆預期 `400`。

---

## 3. 登入 (`POST /api/auth/login`)

### 3.1 未驗證帳號登入 → 403 + 明確錯誤

用 1.1 註冊但**尚未**完成 2.1 驗證步驟的另一個帳號測試（若已把 1.1 帳號驗證過，
先用 1.5 或新註冊一個未驗證帳號）：

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"unverified@example.com","password":"password123"}'
```

- 預期 status：`403`
- 預期 body：`{"error":"請先至信箱完成驗證再登入"}`
- **不應**出現 `Set-Cookie`。

### 3.2 已驗證帳號、正確帳密 → 200 + httpOnly session cookie

用已完成 2.1 驗證的帳號：

```bash
curl -i -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"password123"}'
```

- 預期 status：`200`
- 預期 body：`{"message":"登入成功","userId":"<uuid>"}`
- 預期 header：`Set-Cookie` 存在，且屬性含 `HttpOnly`、`SameSite`（本機 http 環境
  下 `Secure` 可能不會出現；正式環境走 https 時應含 `Secure`）。

### 3.3 密碼錯誤 → 401 通用訊息

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"wrong-password"}'
```

- 預期 status：`401`
- 預期 body：`{"error":"帳號或密碼錯誤"}`
- 用**不存在的 email** 再試一次，預期同樣 `401` + 同一句通用訊息（帳號枚舉防護：
  兩種情況回應必須一致，不可分辨是帳號不存在還是密碼錯）。

### 3.4 缺欄位 → 400

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

- 預期 status：`400`。

---

## 4. 登出 (`POST /api/auth/logout`)

### 4.1 帶 session → 200 且 cookie 被清除

延續 3.2 產生的 `cookies.txt`：

```bash
curl -i -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/logout
```

- 預期 status：`200`
- 預期 body：`{"message":"已登出"}`
- 預期 header：`Set-Cookie` 出現且該 cookie 已過期（`Max-Age=0` 或
  `Expires` 為過去時間）— 檢查 `cookies.txt` 內容確認 session cookie 已被清除。

### 4.2 無 session 也能登出（冪等）

```bash
curl -i -X POST http://localhost:3000/api/auth/logout
```

- 預期 status：`200`（即使當前沒有任何 session cookie，仍回成功）。

---

## 5. Profile 自動建立驗證 (DB trigger)

於 Supabase Studio SQL Editor 執行：

```sql
select p.id, p.role, u.email, u.email_confirmed_at
from public.profiles p
join auth.users u on u.id = p.id
order by u.created_at desc
limit 20;
```

- 預期：每一筆本次測試建立的 auth.users row，都能在 `public.profiles` 找到對應
  的 row，且 `role = 'user'`（不論該帳號是否已完成 email 驗證，因 trigger 在
  `auth.users` insert 當下即建立 — 見 architect-plan「選項 A 的時序」註記）。

---

## 設定備忘（非本 checklist 的測試步驟，但驗證流程需要）

- 若要讓真實驗證信的連結直接可用（而非手動從信件內容組 URL），需將 Supabase
  confirmation email 模板的連結改為指向
  `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=email`，
  可透過 `supabase/config.toml` 的 `[auth.email.template.confirmation]`
  （`content_path` 指向自訂 HTML 模板）或 Supabase Dashboard → Authentication →
  Email Templates 設定。本 task 未附上自訂模板檔案，需人工於本機/雲端專案設定一次。
