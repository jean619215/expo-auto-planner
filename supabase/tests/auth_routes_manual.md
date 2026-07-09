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

## 6. Profile API (`GET/PATCH /api/profile`)

> 沿用 3.2 產生的 `cookies.txt`（已登入 session）。所有請求皆用
> `-b cookies.txt` 帶上 session cookie。

### 6.1 未登入 GET → 401

```bash
curl -i http://localhost:3000/api/profile
```

- 預期 status：`401`
- 預期 body：`{"error":"請先登入"}`

### 6.2 未登入 PATCH → 401

```bash
curl -i -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"nickname":"新名字"}'
```

- 預期 status：`401`
- 預期 body：`{"error":"請先登入"}`

### 6.3 已登入 GET → 200，回自己 profile 五欄位

```bash
curl -i -b cookies.txt http://localhost:3000/api/profile
```

- 預期 status：`200`
- 預期 body 恰含 `id`/`nickname`/`role`/`created_at`/`updated_at` 五欄位，
  `role` 為 `"user"`。

### 6.4 PATCH 合法 nickname → 200，`updated_at` 由 trigger 自動更新

```bash
curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"nickname":"新名字"}'
```

- 預期 status：`200`
- 預期 body：更新後的 profile（`nickname` 為 `"新名字"`）。
- 於 Studio 查 `public.profiles`：該 row 的 `updated_at` 應大於 `created_at`
  （由 `profiles_set_updated_at` trigger 自動寫入，route 未手動塞值）。

### 6.5 PATCH 清空 nickname（`""` 與 `null`）→ 200，回傳 `nickname: null`

```bash
curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"nickname":""}'

curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"nickname":null}'
```

- 兩者皆預期 status `200`，body `nickname` 皆為 `null`（`""` 已正規化為
  `null` 再寫入 DB）。

### 6.6 PATCH nickname 超過 50 字 → 400

```bash
curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"nickname":"一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一"}'
```

（上方字串為 51 個中文字，超過上限 50。）

- 預期 status：`400`
- 預期 body：`{"error":"nickname 須為字串且長度不可超過 50 字"}`

### 6.7 PATCH 帶非法欄位 → 400，且不更新任何東西

```bash
curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"nickname":"x","role":"admin"}'

curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
```

- 兩者皆預期 status `400`，body `{"error":"僅允許更新 nickname"}`。
- 於 Studio 查 `public.profiles`：確認 `role`、`nickname` 皆未被改動
  （整包拒絕，不部分套用）。

### 6.8 PATCH 空物件 / 非 JSON / 型別錯誤 → 400

```bash
curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{}'

curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d 'not-json'

curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"nickname":123}'
```

- 三者皆預期 status `400`。

### 6.9 安全斷言：無法讀/改他人 profile

```bash
curl -i -b cookies.txt "http://localhost:3000/api/profile?id=<使用者A的uuid>"

curl -i -b cookies.txt -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"id":"<使用者A的uuid>","nickname":"x"}'
```

- 第一個請求：`?id=` query string 應被完全忽略，仍回**目前登入者自己**的
  profile（`200`），不會回傳/更改成 query string 指定的對象。
- 第二個請求：body 帶 `id` 屬於白名單外欄位 → `400`（同 6.7），不更新任何東西。
- 用另一組使用者（B）的 `cookies.txt` 重複 6.3/6.4，確認 B 只能讀到/改到自己的
  row，看不到 A 的 `nickname`/`role` 內容。

---

## 7. Middleware / Proxy 保護 (`src/proxy.ts`)

> Next.js 16 root proxy（舊稱 middleware）在 route handler 之前攔截所有
> `/api/*` 請求，用 `@supabase/ssr` 刷新 session 並判斷是否放行。
> 白名單外、未登入一律 401（fail-closed）。route handler 自己的 `getUser()`
> 檢查（見第 6 節）仍保留，形成 defense in depth —— 本節驗證的是「proxy 這一
> 層」本身是否正確擋下 / 放行，即使假設性地拿掉 route handler 檢查也一樣。

### 7.1 未登入打受保護 `/api/profile`（GET 與 PATCH）→ 401

```bash
curl -i http://localhost:3000/api/profile

curl -i -X PATCH http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"nickname":"新名字"}'
```

- 兩者皆預期 status `401`，body `{"error":"請先登入"}`。
- 現象與 6.1/6.2 相同，但此處是 **proxy** 先擋下、根本沒進 route handler：
  即使日後把 profile route 的 `getUser()` 檢查拿掉，proxy 仍應擋住。

### 7.2 白名單放行（未登入，不帶 cookie）

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

curl -i "http://localhost:3000/api/auth/confirm?token_hash=invalid&type=email"

curl -i -X POST http://localhost:3000/api/auth/logout
```

- 四者皆**不得**被 proxy 回 401——應走各自 route 的正常回應（register 依帳號狀態、
  login 依帳密、confirm 依 token 有效性回應、logout 200）。

### 7.3 已登入放行

```bash
curl -i -b cookies.txt http://localhost:3000/api/profile
```

- 沿用 3.2 產生的 `cookies.txt`。預期 status `200`，回自己 profile 五欄位
  （與 6.3 相同結果），確認 proxy 未誤擋已登入者。

### 7.4 Session 刷新 cookie 回寫（best-effort）

```bash
curl -i -c cookies.txt -b cookies.txt http://localhost:3000/api/profile
```

- 正常情況（token 未接近過期）：`cookies.txt` 內容應維持有效、後續請求仍為已登入，
  proxy 不應破壞既有 session cookie。
- 若回應 header 出現 `Set-Cookie`（token 接近過期觸發刷新時），其屬性應含
  `HttpOnly`，且 `cookies.txt` 應被更新為新值。本機不易人為造出「即將過期」的
  token，此項可標記為 best-effort，僅需確認正常路徑不掉登入。

### 7.5 非 `/api` 不受影響

```bash
curl -i http://localhost:3000/
```

- 預期正常回應（首頁），不被 401、不被導向、無異常延遲，證明
  `config.matcher = "/api/:path*"` 只攔 `/api`，靜態資源與頁面不受影響。

### 7.6 路徑正規化不繞過白名單

```bash
curl -i "http://localhost:3000/api/auth/../profile"
```

- 未登入時，該路徑會被 Next.js 正規化為 `/api/profile`，預期 status `401`
  （不得因字面上包含 `/api/auth/` 而被白名單誤放行）。

### 7.7 不 log 敏感資訊

- 執行 7.1–7.6 全程觀察 `npm run dev` 終端輸出：不得印出 token、session、
  cookie 內容或使用者物件。

## 設定備忘（非本 checklist 的測試步驟，但驗證流程需要）

- 若要讓真實驗證信的連結直接可用（而非手動從信件內容組 URL），需將 Supabase
  confirmation email 模板的連結改為指向
  `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=email`，
  可透過 `supabase/config.toml` 的 `[auth.email.template.confirmation]`
  （`content_path` 指向自訂 HTML 模板）或 Supabase Dashboard → Authentication →
  Email Templates 設定。本 task 未附上自訂模板檔案，需人工於本機/雲端專案設定一次。
