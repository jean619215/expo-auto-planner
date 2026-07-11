# QA Report — 路由保護邏輯 (會員系統 Task 7)
> Generated: 2026-07-11T02:10:00Z | QA iteration: 1
> Story: 會員系統 | Task 7 of 9 | Type: FRONTEND
> Method: 靜態驗收 (逐行比對 `src/proxy.ts` 與 `supabase/tests/auth_routes_manual.md` 第 9 節)。瀏覽器實測依 orchestrator 決議延後至 Task 9 完成後合併跑 playwright。

## Summary
- Tests executed: 15 (静態比對項目,對應下方各表)
- Passed: 15
- Failed: 0
- Blocked: 0 (playwright 情境非本次範圍,已於 checklist 9.3 記錄延後清單,非 blocked)

## Recommendation
APPROVED — 靜態驗收全數通過,無 Critical/High/Medium bug。playwright 欠帳已依決議記錄,不影響本 task 簽核。

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| 未登入直接開 `/profile` → 導向 `/login`,不顯示 profile 內容 | ✅ PASS | `!user && matchesPage(pathname, PROTECTED_PAGES)` → `NextResponse.redirect(new URL(LOGIN_PATH, ...))`;API 分支獨立,不會渲染頁面內容。checklist 9.1-1 已列。 |
| 已登入開 `/login` → 導向 `/` | ✅ PASS | `user && matchesPage(pathname, AUTH_PAGES)` 命中 `/login` → redirect `/`。checklist 9.1-6。 |
| 已登入開 `/register` → 導向 `/` | ✅ PASS | 同上邏輯,`AUTH_PAGES` 含 `/register`。checklist 9.1-7。 |
| 未登入開 `/login`、`/register`、`/` → 正常顯示 | ✅ PASS | 未登入時 `user && ...` 條件為 false,不進入 redirect,falls through 回傳原 `response`;`/` 不在 matcher,proxy 不執行。checklist 9.1-2/3/4。 |
| 已登入開 `/profile` → 正常顯示 | ✅ PASS | `!user` 為 false,且 `/profile` 不在 `AUTH_PAGES`,falls through 正常回應。checklist 9.1-5。 |
| API 行為不變: 未登入打 `/api/profile` 仍 401 JSON | ✅ PASS | `isApiRequest` 分支與頁面分支互斥(`if (!isApiRequest) {...; return response;}` 先行 return),401 JSON 分支程式碼與 Task 4 一致,未被觸及。checklist 9.1-8。 |
| 靜態資源 (_next、favicon、圖片) 不受影響 | ✅ PASS | `config.matcher` 為靜態陣列 `["/api/:path*","/profile","/login","/register"]`,不含 `_next`/`favicon`/`public` 路徑,故不經 proxy。checklist 9.2-10。 |
| redirect 不進入無限迴圈 | ✅ PASS | 見下方「無 redirect 迴圈」真值表分析。 |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| 登出後停在 `/profile` 再重新整理 → 導向 `/login` | ✅ PASS | 登出清除 session 後 `user` 為 null,下一次請求命中 `!user && matchesPage(PROTECTED)` → redirect。checklist 9.1-9 已列為驗收步驟。 |
| redirect 用 server 端 3xx,不用 window.location 硬跳 | ✅ PASS | 兩處皆為 `NextResponse.redirect(new URL(...))`,產生標準 307,無 client-side `window.location` 使用。 |
| 不 log token/session | ✅ PASS | `grep -n "console\." src/proxy.ts` 無結果;整檔無任何 log 語句。checklist 9.2-12。 |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| API 未登入 (無 session cookie) 打受保護路徑 | ✅ PASS | 回 401 JSON `{"error":"請先登入"}`,非 redirect,與 Task 4 契約一致。 |
| PUBLIC_API_PATHS 白名單放行 (未登入) | ✅ PASS | 本 task 未變更第 7 節既有邏輯,`PUBLIC_API_PATHS.has(pathname)` 分支維持在頁面分流之後、401 判斷之前,順序未動。 |

## 真值表逐格核對 (無 redirect 迴圈)
| pathname | 登入狀態 | 結果 |
|---|---|---|
| `/profile` | 未登入 | → 307 `/login` |
| `/profile` | 已登入 | → 正常顯示 (fall through) |
| `/login` | 未登入 | → 正常顯示 (fall through) |
| `/login` | 已登入 | → 307 `/` |
| `/register` | 未登入 | → 正常顯示 (fall through) |
| `/register` | 已登入 | → 307 `/` |
| `/` | 任一 | → 不在 matcher,proxy 不執行,正常顯示 |
| `/profile/xxx` (子路徑) | 未登入 | → 307 `/login` (matchesPage 前綴比對 + matcher anchoring 涵蓋,已用 `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:130` 「`/about` matches `/about` and `/about/team`」核實此版本 anchoring 語義) |
| `/profilexyz` (非子路徑,誤判風險) | 未登入 | → 不匹配 (`matchesPage` 要求 `===` 或以 `p+"/"` 開頭,`/profilexyz` 兩者皆不成立) → 正常放行,無誤擋 |

結論: 兩個 redirect 目標分別為 `/login`(僅未登入放行,已登入時走的是別條分支不受影響)與 `/`(不在 matcher,不會再次觸發 proxy 判斷)。不存在「redirect 目標又被同一 proxy 邏輯導回原頁」的組合,無迴圈。

## Redirect 安全 / Cookie 核對
| 項目 | Result | Notes |
|---|---|---|
| redirect 目標無 open redirect | ✅ PASS | `LOGIN_PATH`/`HOME_PATH` 為模組內固定常數字串;`new URL(LOGIN_PATH, request.url)` 中 `request.url` 僅提供 origin,不含使用者可控 query/header 影響路徑。 |
| 帶 session 刷新 cookie | ✅ PASS | 兩個 redirect 分支皆經 `withCookiesFrom(response, NextResponse.redirect(...))`,把 `updateSession` 產生的 `response` 上的 cookie(含刷新後的 session)逐一複製到最終回應,不遺失 `Set-Cookie`。 |

## matcher / 子路徑核對
| 項目 | Result | Notes |
|---|---|---|
| matcher 靜態陣列與 PROTECTED_PAGES/AUTH_PAGES 常數同步 | ✅ PASS | `PROTECTED_PAGES=["/profile"]`、`AUTH_PAGES=["/login","/register"]`,`config.matcher=["/api/:path*","/profile","/login","/register"]`,三者項目一致,且程式碼中兩處均有「新增頁面需同步」註解提醒。 |
| 子路徑 fail-closed | ✅ PASS | 見上方真值表 `/profile/xxx` 一列;matcher 與 `matchesPage` 的 anchoring 語義經官方文件核實一致,不會漏保護子路徑。 |

## Checklist 涵蓋度 (`supabase/tests/auth_routes_manual.md` 第 9 節)
| 項目 | Result | Notes |
|---|---|---|
| 9.1 (9 項) 涵蓋全部真值表格子 + 登出後重新整理 + API 401 不變 | ✅ PASS | 逐項比對 orchestrator 驗收條件,一一對應,無遺漏。 |
| 9.2 (3 項) 迴圈防護 / 靜態資源 / Set-Cookie / 不 log | ✅ PASS | 涵蓋 DevTools Network 迴圈檢查、`_next/static`+favicon 200、cookie 比對、log 稽核。 |
| 9.3 playwright 延後清單已定義 | ✅ PASS | 明列 6 項情境對應 Task 9 合併驗收,並註明與 Task 9 resend 按鈕情境一併執行。 |

## Regression Check
| Feature | Result |
|---|---|
| Task 4 API 401 auth gate (`/api/*`) | ✅ PASS — 分支邏輯與程式碼位置未變,仍為原本 allowlist → 401 → 放行三段 |
| Task 5 login/register 頁面渲染 (client 邏輯) | ✅ PASS — page 檔案本身零改動 (git diff 僅觸及 `src/proxy.ts` 與 checklist) |
| Task 6 `/profile` 頁面 (nickname 編輯) | ✅ PASS — page 檔案零改動;未登入情境行為由「顯示登入提示」升級為「導向 /login」,屬本 task 預期行為變更,非回歸 |

## Security Test
- Sensitive data exposure: PASS — 無新增 log、redirect response body 為空,無敏感資料
- Input validation: PASS — pathname 由 Next.js normalize,`matchesPage` 僅用等值/前綴比對常數,無使用者輸入影響分支邏輯
- Auth boundary: PASS — fail-closed 維持;子路徑、未知路徑均不會意外放行受保護頁面;無 open redirect

## Bugs Found
無。

## Test Coverage
- New code coverage: 手動 checklist 第 9 節 12 項 (9.1×9 + 9.2×3),逐項對應全部驗收條件、edge case 與安全項目
- Minimum required: 依 AGENTS.md — 無 JS test framework,手動 checklist 視為合格覆蓋
- Status: PASS

## Playwright 欠帳 (依決議,非本次 blocker)
- 已於 checklist 9.3 明確列出 6 項延後情境,將於 Task 9 完成後與 Task 9 情境合併跑一輪 playwright。
- 已於 task-log.md 記錄本 task stage 直接標記 complete、playwright 欠帳待 Task 9。
