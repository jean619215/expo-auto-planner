# Story: 會員系統

## 說明
身為使用者,我想要註冊/登入/管理個人資料,以便使用個人化的排程功能。

架構定調 (與使用者討論後確認):
- Supabase 只當基礎設施 (Auth + Postgres + Storage),前端**不直接呼叫** Supabase client。
- 所有存取一律透過自己的 Next.js API routes,由 API 內部用 Supabase server-side SDK 操作 Auth/資料庫。
- RLS 當第二道防線,不是唯一防守 — 主要驗證邏輯在自己的 API route 裡。
- `profiles` 表需帶 `role` 欄位 (預設 `user`),為未來多角色 (如策展單位) 預留擴充空間。
- 檔案上傳 (Supabase Storage) 是之後的延伸功能,本 story 不包含,但 `profiles`/使用者資料設計需保留擴充空間 (之後檔案路徑會用 `user_id` 命名慣例掛鉤 RLS)。

## 驗收條件
- 在未登入狀態下,當使用者提交註冊表單 (email + 密碼),則建立帳號 (未驗證) 並提示前往收信驗證 (email 驗證已啟用,不自動登入)。
- 在收到驗證信後,當使用者點擊驗證連結,則帳號標記為已驗證,可進行登入。
- 在已註冊狀態下,當使用者輸入正確帳密登入,則取得 session,可存取受保護頁面。
- 在已登入狀態下,當使用者呼叫個人資料 API,則只能取得/更新自己的 profile,不能存取他人資料。
- 在未登入狀態下,當使用者嘗試存取受保護頁面或 API,則導向登入頁 / 回傳 401。
- 在已登入狀態下,當使用者登出,則 session 清除,受保護頁面無法再存取。

## 任務清單
- [x] [BACKEND] 建立 Supabase 專案,建立 `profiles` 資料表 (id 對應 auth.users.id、暱稱、role 預設 user、建立時間),設定 RLS policy (使用者只能存取自己的 row)
- [x] [BACKEND] 建立 `/api/auth/register`、`/api/auth/login`、`/api/auth/logout` API routes,包裝 Supabase server-side SDK,處理註冊時自動建立對應 profile
- [ ] [BACKEND] 建立 `/api/profile` API (GET/PATCH),驗證 token 後只能讀寫呼叫者自己的 profile
- [ ] [BACKEND] 建立 middleware,驗證 session/token,保護所有需要登入的 API route,未通過回傳 401
- [ ] [FRONTEND] 建立註冊/登入頁面表單,呼叫自己的 `/api/auth/*`,不直接呼叫 Supabase client
- [ ] [FRONTEND] 建立個人資料頁面 (顯示/編輯暱稱等欄位),呼叫 `/api/profile`
- [ ] [FRONTEND] 建立路由保護邏輯:未登入時導向登入頁,已登入時登入/註冊頁導向首頁

<!--
給 STORY 撰寫者的備註:
- 每個任務會獨立跑完整條 pipeline (orchestrate → architect → implement → review → QA → playwright)
- 任務由上到下依序處理,一次一個
- orchestrator 會在 architect 規劃前,針對每個任務問澄清問題
- 執行: /ship stories/membership-system.md 啟動 pipeline
-->
