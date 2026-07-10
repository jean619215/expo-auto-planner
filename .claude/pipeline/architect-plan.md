# Architect Plan — 個人資料頁面 (/profile)

> Story: 會員系統 | Task 6 of 9 | Task type: FRONTEND | Generated: 2026-07-10T11:45:12Z

## Overview

新增 client component 頁面 `src/app/profile/page.tsx`，載入時 `GET /api/profile` 顯示暱稱/role/建立時間，暱稱 inline 編輯經 `PATCH /api/profile` 儲存；並在首頁已登入狀態 (由 `AuthNav` 控制) 加上「個人資料」入口。全程走自家 `/api/*`，不觸碰 Supabase client。

## Task Type Confirmed

FRONTEND — 與 orchestrator-output.md 一致，無矛盾。QA 通過後進 playwright 階段。

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `src/app/profile/page.tsx` | `/profile` 頁面 (client component)：讀取與編輯個人資料 |
| `src/lib/profile-client.ts` | 瀏覽器端 `/api/profile` fetch wrapper (`getProfileRequest` / `updateNicknameRequest`)，模式對齊 `src/lib/auth-client.ts` |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/components/AuthNav.tsx` | `loggedIn` 分支目前只有登出按鈕；改為登出按鈕旁加一個 `<Link href="/profile">個人資料</Link>`（沿用現有 pill 樣式）。**注意**：首頁的登入判斷不在 `src/app/page.tsx` 本身——`page.tsx` 是 server component，登入狀態由 `AuthNav` 以 `GET /api/profile` 200/401 推斷。因此「首頁已登入加入口」的正確落點是 `AuthNav.tsx`，`src/app/page.tsx` 本檔預期**不需要改動** |
| `src/lib/validation.ts` | 追加 `NICKNAME_MAX_LENGTH = 50` 與 `isValidNickname()`（code point 計數，對齊後端） |
| `supabase/tests/auth_routes_manual.md` | 追加 `/profile` 頁面的手動驗證 checklist 區塊（見 Test Plan） |

## Implementation Steps

1. **`src/lib/validation.ts`**：追加 `export const NICKNAME_MAX_LENGTH = 50;` 與 `export function isValidNickname(value: string): boolean { return [...value].length <= NICKNAME_MAX_LENGTH; }`——以 Unicode code point 計數（spread），**與後端 `src/app/api/profile/route.ts` 第 79 行 `[...rawNickname].length > NICKNAME_MAX_LENGTH` 一致**。
2. **建立 `src/lib/profile-client.ts`**，比照 `src/lib/auth-client.ts` 的結構與註解慣例：
   - `export type Profile = { id: string; nickname: string | null; role: string; created_at: string; updated_at: string }`
   - `export type ProfileResult = { ok: boolean; status: number; profile?: Profile; error?: string }`
   - `getProfileRequest(): Promise<ProfileResult>` — `fetch("/api/profile", { credentials: "same-origin" })`（相對路徑、同源自動帶 httpOnly cookie）
   - `updateNicknameRequest(nickname: string | null): Promise<ProfileResult>` — `fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname }), credentials: "same-origin" })`。body **恰為** `{"nickname": ...}` 單一鍵，多帶欄位後端回 400。
   - 兩者皆：`res.json()` 包 try/catch（空/非 JSON body 容錯）；成功時 `profile: data`，失敗時 `error: data.error`；網路例外回 `{ ok: false, status: 0, error: "連線失敗，請稍後再試" }`（沿用 auth-client 的 `NETWORK_ERROR` 文案）。
3. **建立 `src/app/profile/page.tsx`**（`"use client"`），版型比照 login/register 頁（`<main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">` + `max-w-sm`/`max-w-md` 卡片），文案繁體中文。State 設計：
   - `pageState: "loading" | "ready" | "unauthenticated" | "error"` — 初始 `"loading"`
   - `profile: Profile | null` — GET 成功後的資料
   - `pageError: string` — 載入失敗（非 401）的訊息
   - `nickname: string` — 輸入框受控值；載入成功後 `setNickname(profile.nickname ?? "")`（null → 空字串，**絕不顯示 "null"**）
   - `saving: boolean` — PATCH 送出中，防重複
   - `saveError: string` / `saveSuccess: string` — inline 儲存結果訊息（`role="alert"` 紅字 / `role="status"` 綠字，樣式同 register 頁）
4. **載入流程**：`useEffect(() => { ... }, [])`，比照 `AuthNav.tsx` 的 `active` flag 防 unmount 後 setState：
   - `getProfileRequest()` → `ok` → `setProfile`、`setNickname(nickname ?? "")`、`pageState = "ready"`
   - `status === 401` → `pageState = "unauthenticated"`
   - 其他（404/500/0）→ `pageState = "error"`、`pageError = error ?? "載入失敗，請稍後再試"`
5. **各 pageState 渲染**：
   - `loading`：卡片內「載入中…」或仿 `AuthNav` 的 `animate-pulse` skeleton
   - `unauthenticated`：顯示「請先登入」+ `<Link href="/login">前往登入</Link>`（樣式同 login 頁底部連結）。**不做自動 redirect**（Task 7 範圍）。
   - `error`：顯示 `pageError`，不崩潰
   - `ready`：標題「個人資料」；欄位——
     - 暱稱：`<input type="text">`（受控，樣式同 login 輸入框）+ 儲存按鈕
     - 身分（role）：**純文字唯讀顯示**（`<p>`/展示列，非 input），無任何可改 role 的 UI
     - 建立時間：`created_at` 格式化顯示（見步驟 7）
     - 不顯示 `id`、`updated_at`
6. **儲存流程** `handleSubmit`（`<form onSubmit>` + `event.preventDefault()`，比照 login 頁）：
   - `if (saving) return;` 開頭清空 `saveError`/`saveSuccess`
   - client 驗證：`!isValidNickname(nickname)` → `setSaveError("暱稱長度不可超過 50 字")`、return（後端 400 仍為最終防線）
   - **空字串送出策略：照原值送 `""`**。後端第 84 行 `rawNickname === "" ? null : rawNickname` 會正規化為 null——正規化邏輯單一事實來源留在後端，前端不重複實作；畫面依回傳 profile（`nickname: null`）更新即可。前端亦不 trim（後端未 trim，保持一致）。
   - `setSaving(true)` → `updateNicknameRequest(nickname)`：
     - `ok`：`setProfile(result.profile)`、`setNickname(result.profile.nickname ?? "")`、`setSaveSuccess("暱稱已更新")`
     - 失敗：`setSaveError(result.error ?? "儲存失敗，請稍後再試")`；若 `status === 401`（session 中途失效）一併 `setPageState("unauthenticated")`
   - `finally { setSaving(false); }`；`saving` 期間 input 與按鈕 `disabled`（`disabled:opacity-60`，同 login），按鈕文字「儲存中…/儲存」
7. **`created_at` 格式化**：不引入 date 套件。模組層 `const createdAtFormatter = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" })`，渲染 `createdAtFormatter.format(new Date(profile.created_at))`。純 client 頁、資料來自 useEffect 後的 state（首屏為 loading 狀態），**無 SSR hydration mismatch 風險**。加 `Number.isNaN(date.getTime())` 防呆（非法字串顯示 `-`）。
8. **修改 `src/components/AuthNav.tsx`**：`loggedIn` 分支改為 `flex flex-col gap-3 sm:flex-row` 容器（同 loggedOut 分支），內含 (a) `<Link href="/profile">個人資料</Link>`——沿用 loggedOut「註冊」pill 的 className，(b) 既有登出按鈕原樣保留。
9. **收尾**：`npm run lint` 通過；無 TODO/console.log/debug 殘留；追加手動 checklist（見 Test Plan）。

## Data Flow

```
/profile (client)                              server
  page mount ──GET /api/profile──▶ proxy.ts (auth gate) ─▶ route.ts GET ─▶ Supabase (RLS)
      ◀── 200 {id,nickname,role,created_at,updated_at} / 401 {"error":"請先登入"}
  pageState: loading → ready | unauthenticated | error

  儲存 ──PATCH /api/profile {"nickname": string}──▶ route.ts PATCH（"" → null 正規化）
      ◀── 200 更新後 profile → setProfile + 成功訊息
      ◀── 400/401/500 → saveError 顯示後端 error

首頁 / (server) ─▶ AuthNav (client) ──GET /api/profile──▶ 200 → [個人資料連結 + 登出]
                                                          401 → [登入 / 註冊]
```

httpOnly cookie 由同源相對路徑 fetch（`credentials: "same-origin"`）自動攜帶；瀏覽器 bundle 內 0 個 Supabase import。

## Test Plan

無 JS 測試框架（專案慣例）——驗證為手動 checklist + FRONTEND task 的 playwright 驗收階段。

### Playwright 驗收情境（playwright 階段 agent 執行；環境由該階段以 webapp-testing skill 或臨時安裝處理，本計畫僅定義「驗什麼」）

前置：本地 Supabase + `npm run dev`，備一組已通過 email 驗證的帳號。

1. **已登入顯示**：登入 → 造訪 `/profile` → 可見暱稱輸入框、role 文字、格式化後的建立時間；頁面不出現 uuid。
2. **修改暱稱成功**：改暱稱（含中文/emoji）→ 儲存 → 成功訊息出現、輸入框為新值；重新整理後仍為新值。
3. **>50 字擋下**：輸入 51 個 code point（含多位元組字元以驗證計數基準）→ 儲存 → 錯誤訊息顯示、值未更新。
4. **清空暱稱**：清空 → 儲存 → 成功，輸入框顯示空字串（非 "null"）；重整後仍為空。
5. **未登入造訪**：登出/無 cookie context → 造訪 `/profile` → 顯示「請先登入」與登入連結，點擊導向 `/login`；頁面無 crash、console 無未捕捉錯誤。
6. **防重複送出**：攔截/減速 PATCH → 送出期間按鈕 disabled、文字「儲存中…」。
7. **首頁入口**：已登入造訪 `/` → 有「個人資料」連結且點擊導向 `/profile`；未登入 `/` 無此連結。
8. **安全斷言**：全程 network 無瀏覽器對 `*.supabase.co` 的直連請求（僅同源 `/api/*`）。

### 手動 checklist（追加至 `supabase/tests/auth_routes_manual.md`）

- 上列 1-5、7 的人工版步驟，另加：nickname 為 null 的帳號首次載入輸入框為空；離線/網路中斷時顯示「連線失敗，請稍後再試」且不整頁崩潰。

## Architecture Notes

- **首頁改動落點修正**：orchestrator-output 寫「首頁 `src/app/page.tsx` 加連結」，但登入狀態判斷實際封裝在 `src/components/AuthNav.tsx`（`page.tsx` 是 server component，本身不知登入狀態）。連結加在 `AuthNav` 的 loggedIn 分支才符合現有架構，`page.tsx` 預期零改動。非 scope 偏離，是同一驗收條件的正確實作位置。
- **新增 `src/lib/profile-client.ts`** 而非頁面內裸寫 fetch：對齊 Task 5 的 `auth-client.ts` 模式（thin wrapper、相對路徑、`credentials: "same-origin"`、統一錯誤 shape）。
- **AuthNav 與 /profile 頁各自打一次 GET /api/profile**：兩者不同頁面、通常不同時掛載，接受偶發重複請求；專案尚無 state 管理 library，不為此提前抽象（AGENTS.md：勿發明過早模式）。
- **Next.js 16（破壞版本）**：僅使用 Task 5 已在本專案驗證可用的 API——`"use client"`、`next/link` 的 `Link`、`useState`/`useEffect`。本頁不需 `useRouter`。若需其他框架 API，先查 `node_modules/next/dist/docs/01-app/`。
- 風險：低。唯一契約敏感點是 PATCH body 必須恰為單一 `nickname` 鍵。

## Security Checklist

- [ ] 無硬編碼 secrets/credentials/連線字串
- [ ] client 端輸入驗證（≤50 code points）僅為 UX，邊界最終驗證在後端（已存在，400）
- [ ] 瀏覽器端不 import 任何 `@supabase/*` 或 `src/lib/supabase/*`；`service_role` 絕不進 client bundle
- [ ] 不 log token/session/cookie/密碼；新增程式碼零 console.log
- [ ] `role` 純唯讀顯示，無任何 UI/請求可修改 role（後端 PATCH 亦僅允許 nickname 鍵）
- [ ] 401 顯示通用「請先登入」，不洩漏帳號存在性
- [ ] 所有 fetch 走同源相對路徑 + `credentials: "same-origin"`（httpOnly cookie 機制不變）

## Definition of Done

- [ ] 上述 9 個實作步驟完成
- [ ] `supabase/tests/auth_routes_manual.md` checklist 已追加並人工走過
- [ ] Playwright 驗收情境清單（本檔）可交付 playwright 階段
- [ ] 無 TODO、註解掉的程式碼、debug log
- [ ] `npm run lint` 通過；遵循 AGENTS.md 全部規則
- [ ] Security checklist 全數通過
