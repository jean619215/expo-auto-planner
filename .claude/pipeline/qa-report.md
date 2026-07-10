# QA Report — 個人資料頁面 (/profile)
> Generated: 2026-07-10T13:00:00Z | QA iteration: 1
> Story: 會員系統 | Task 6 of 9 | Type: FRONTEND
> Method: 靜態驗收（逐行比對程式碼與驗收條件）。瀏覽器實測由下一階段 playwright 負責。

## Summary
- Tests executed (static checklist items): 13
- Passed: 13
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — 靜態驗收全數通過，交付 playwright 階段做瀏覽器實測。

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| 已登入造訪 `/profile` → 顯示暱稱、role、建立時間 | ✅ PASS | `page.tsx:120-142` 三欄位皆渲染；`id` 未出現於 JSX 任何位置（grep 確認） |
| 修改暱稱送出 → 200 後畫面更新為新暱稱 + 成功訊息 | ✅ PASS | `page.tsx:70-74` 成功時 `setProfile`/`setNickname`/`setSaveSuccess("暱稱已更新")` |
| 暱稱輸入 >50 字 → client 端擋下或後端 400，錯誤訊息顯示 | ✅ PASS | `page.tsx:63-66` 呼叫 `isValidNickname`（`validation.ts:16-18`，Unicode code point 計數，與後端一致），擋下不送出並顯示錯誤 |
| 清空暱稱送出 → 允許（後端正規化 null），畫面顯示空 | ✅ PASS | 空字串通過 `isValidNickname`（長度 0 ≤ 50），送出後 `nickname ?? ""` 顯示空 |
| 未登入造訪 `/profile` → 顯示「請先登入」與登入頁連結，不崩潰 | ✅ PASS | `page.tsx:44-45,100-110` 401 → `unauthenticated` 狀態，含 `/login` Link，無 throw |
| 送出期間按鈕 disabled，不可重複送出 | ✅ PASS | `page.tsx:58` `if (saving) return`；`127,157` input/button `disabled={saving}` |
| 首頁已登入時有 `/profile` 入口 | ✅ PASS | `AuthNav.tsx:51-59` loggedIn 分支含 `/profile` Link；首頁 `page.tsx` 已掛載 `<AuthNav />` |
| 全程不直接呼叫 Supabase client，不出現 service_role key | ✅ PASS | grep 4 個交付檔案（page.tsx / profile-client.ts / validation.ts / AuthNav.tsx）無 `supabase`/`service_role` 字樣 |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| nickname 為 null → 輸入框顯示空字串，不顯示 "null" | ✅ PASS | `page.tsx:42,73` 皆用 `profile.nickname ?? ""` |
| role 欄位唯讀，無 UI 可改 role | ✅ PASS | `page.tsx:132-135` 純 `<p>` 顯示，非 input，且 PATCH body 只送 `{nickname}`（`profile-client.ts:55`） |
| 不 log token/session | ✅ PASS | 4 個檔案 grep `console\.` 無結果 |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| 網路錯誤 / 非預期 status → 通用錯誤訊息，不整頁崩潰 | ✅ PASS | `profile-client.ts:43-45,59-61` catch 回傳 `{ok:false,status:0,error:"連線失敗，請稍後再試"}`；`page.tsx:47-49` 渲染於 `error` 狀態，非 throw |
| PATCH 失敗（非 401）→ 顯示後端 error 訊息 | ✅ PASS | `page.tsx:76` `setSaveError(result.error ?? "儲存失敗，請稍後再試")` |
| PATCH 中途 401（session 失效）→ 轉未登入狀態 | ✅ PASS | `page.tsx:77-79` |

## Regression Check
| Feature | Result |
|---|---|
| AuthNav 未登入分支（登入/註冊連結） | ✅ PASS — 本次未改動該分支邏輯 |
| 首頁 `page.tsx`（登入前後其他區塊） | ✅ PASS — 本次未修改首頁檔案本身，僅沿用既有 `<AuthNav />` 掛載點 |
| `/api/profile` GET/PATCH 後端契約 | ✅ PASS — 前端呼叫與既有 route 契約（body 恰為 `{"nickname":...}`、401/400 語意）逐項比對一致，未改動後端 |

## Security Test
- Sensitive data exposure: PASS — 畫面不顯示 `id`/`updated_at`，僅顯示 nickname/role/created_at
- Input validation: PASS — client 端 `isValidNickname` 與後端規則（`route.ts:79`，經 review-report 確認）一致，且後端仍為最終防線
- Auth boundary: PASS — 全走同源相對路徑 fetch + `credentials: "same-origin"`（httpOnly cookie），401 一律顯示通用訊息不洩漏帳號存在性，無 role 竄改路徑

## Bugs Found
無。

## Test Coverage
- New code coverage: 手動 checklist `supabase/tests/auth_routes_manual.md` §8（8.1–8.10）逐條對應本 task 全部驗收條件與 edge case，另涵蓋 8.6 防重複、8.8 null nickname、8.9 離線、8.10 敏感 log 檢查
- Minimum required（AGENTS.md）: 無 JS test framework，manual checklist 即符合最低要求；FRONTEND task 另有 playwright 階段做瀏覽器實測驗收
- Status: PASS

## Notes
- 本輪為靜態程式碼比對驗收，未啟動 dev server 做瀏覽器互動測試（依任務指示，瀏覽器實測交由下一 playwright 階段）。
- Review report 中的 3 項 💡 Suggestion（非阻塞）已知悉，不影響本次 QA 判定：
  1. `profile-client.ts:34` — 200 但非 JSON body 的防禦深度（後端保證不會發生）
  2. `page.tsx:126` — 儲存成功訊息在下次編輯時未即時清除的 UX 微調
  3. `AuthNav.tsx:20` — 可改用 `getProfileRequest()` wrapper 統一模式（非本 task 義務）

## Playwright 瀏覽器驗收
> Executed: 2026-07-10T20:15:00+08:00
> 環境：`npm run dev`（Turbopack，Next.js 16.2.10），瀏覽器用 `http://localhost:3000`（改用 localhost 而非 127.0.0.1——Next.js 16 dev server 預設對 `allowedDevOrigins` 外的 origin 擋掉 `/_next` HMR 資源，用 127.0.0.1 會導致 client bundle 無法正確 hydrate，頁面卡在 loading／表單以原生 GET 提交；換成 localhost 後行為正常，未修改任何專案設定檔）。工具：Node.js Playwright（`npx playwright install chromium`，臨時裝在 scratchpad，未動 `package.json`）。測試帳號：`jean619215@gmail.com`。

| # | 情境 | 對應驗收條件 | 結果 | 證據 |
|---|---|---|---|---|
| AC1 | 未登入造訪 `/profile` | 顯示「請先登入」+ `/login` 連結，不崩潰 | ✅ PASS | `screens/1-unauthenticated.png`；console 無未捕捉錯誤 |
| AC2 | 登入（測試帳號）| 導向首頁，AuthNav 顯示已登入狀態 + 個人資料連結 | ✅ PASS | `screens/2-after-login.png`；`url === /`，`a[href="/profile"]` count=1 |
| AC3 | 點「個人資料」→ `/profile` | 顯示暱稱輸入框、role(user)、格式化建立時間 | ✅ PASS | `screens/3-profile-page.png`；role 文字為 `user`，建立時間顯示為「2026年7月9日 下午2:34」格式，無 uuid |
| AC4 | 修改暱稱「測試暱稱」送出 | 成功訊息出現、輸入框更新；重整後仍為新值（確認存 DB） | ✅ PASS | `screens/4a-after-save.png`, `4b-after-reload.png`；成功訊息「暱稱已更新」，reload 後輸入框仍為「測試暱稱」 |
| AC5 | 輸入 51 個字（中文字元）送出 | client 端擋下、不打 PATCH API、頁面不崩潰 | ✅ PASS | `screens/5-51chars.png`；PATCH 請求數送出前後不變（6→6），錯誤訊息「暱稱長度不可超過 50 字」 |
| AC6 | 清空暱稱送出 | 成功，輸入框顯示空（不顯示 "null"）；重整後仍空 | ✅ PASS | `screens/6-cleared.png`；輸入框值為空字串，畫面卡片內文無 "null" 字樣 |
| AC7 | 送出過程按鈕 disabled | 減速 PATCH（route intercept +1.5s）觀察送出中狀態 | ✅ PASS | `screens/7-disabled.png`；`disabled=true`，按鈕文字「儲存中…」 |
| AC8 | 全程 network 監聽 | 不得出現對 `*.supabase.co` 的瀏覽器直連請求 | ✅ PASS | 全程攔截所有 request URL，`*.supabase.co` 命中數 = 0，所有請求均為同源 `/api/*` |

### 結果
8/8 全部通過。測試結束後已將暱稱改回空字串（原值），並執行登出；dev server 已關閉。

### Recommendation
✅ APPROVED — 全部驗收條件於真實瀏覽器中驗證通過，可交付完成。
