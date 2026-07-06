# expo-auto-planner 專案規格

> 這份文件記錄專案的需求與技術決策,會隨討論持續更新。

## 專案簡介

自動排展覽/行程的網站。使用者輸入偏好與條件,系統自動產生排程建議。

## 技術決策

| 項目 | 決定 | 原因 |
|------|------|------|
| 前後端架構 | Next.js 全端(前後端同一專案,API routes 處理後端邏輯) | 開發速度快、型別前後共用、部署單純 |
| 語言/執行環境 | Node.js,版本釘在 `.nvmrc`(目前 22.21.1) | 團隊開發環境一致 |
| 資料庫 | Postgres,直接用 Neon 或 Supabase(不用 Vercel 自家的 Postgres 產品) | Vercel Postgres 本質是 Neon 包了一層整合費,直接用原生服務較便宜;透過環境變數連線,跟部署平台脫鉤 |
| 連線方式 | Serverless function 需使用 connection pooling 版本的連線字串(`-pooler`) | 避免 serverless 併發時把資料庫連線數用光 |
| 部署平台 | Vercel | 對 Next.js 原生支援最好,git push 自動部署 + PR preview |
| 方案 | 開發階段用 Hobby(免費);正式上線/商業使用需升級 Pro($20/月起) | Hobby 禁止商業用途 |
| CI/CD | Vercel git 整合負責部署;GitHub Actions 跑 lint / type-check / test 擋 PR | 部署交給平台處理,測試品質關卡獨立把關 |

## 待確認需求

- [ ] 目標使用者是誰?(一般民眾自由行 / 特定展覽策展單位 / 其他)
- [ ] 排程演算法的複雜度(簡單時間段安排 vs. 需要 constraint solver / 最佳化)
- [ ] 資料來源(展覽資訊怎麼取得:手動輸入、爬蟲、第三方 API)
- [ ] 使用者規模預估(影響資料庫與 Vercel 方案選擇)
- [ ] 是否需要帳號系統/登入

## 變更紀錄

- 2026-07-06:建立文件,補上前期討論的技術決策
