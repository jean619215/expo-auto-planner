# Story: 會員點數系統與商店頁

## 說明
身為註冊會員,我想要擁有點數帳戶並能在商店頁購買點數,以便未來用點數兌換平台上的付費功能。

## 驗收條件
- 在新帳號註冊完成時,當 auth trigger 觸發,則自動發放 50 點註冊禮(既有帳號需一次性 backfill)。
- 在已登入狀態下,當使用者查看 Header 或商店頁,則能看到目前點數餘額。
- 在商店頁,當使用者選擇三種點數方案之一並結帳,則透過 PaymentProvider adapter 走 mock 金流結帳頁,完成後點數入帳。
- 在金流 webhook 收到通知時,當簽章(HMAC)驗證通過且 ref_id 未重複,則寫入點數;簽章錯誤拒絕、ref_id 重複具冪等性(不重複入點)。
- 在未登入狀態下,當呼叫 points API(webhook 除外),則被 proxy.ts 擋下;webhook 為 public 路由,僅以簽章驗證把關。
- 點數異動採 append-only ledger,RLS 僅允許讀自己的紀錄,寫入僅限 service_role。

## 任務清單
- [x] [BACKEND] 點數資料層:points ledger(append-only)+ orders 資料表 migration,RLS read-own、寫入僅 service_role,auth trigger 發 50 點註冊禮 + 既有帳號 backfill
- [x] [BACKEND] 點數 API:GET /api/points/balance、POST /api/points/checkout(PaymentProvider adapter,phase 1 mock provider)、POST /api/points/webhook/mock(HMAC 簽章驗證 + ref_id 冪等,加入 proxy.ts PUBLIC_API_PATHS,mock provider 在 production 無明確 secret 時拒絕啟動)
- [ ] [FRONTEND] 商店頁 /shop(三種點數方案 + 結帳流程)+ mock 金流結帳頁 /shop/mock-checkout + Header 顯示點數餘額,Playwright 驗收(points-shop.spec.ts,page object ShopPage.ts)

<!--
備註:此 story 為補件 — 實作已存在(commit 5c6c7d7,branch feat/points-system,
migration 已推雲端 Supabase,Playwright points-shop.spec.ts 已有 9 測試)。
pipeline 各階段應以「驗證既有實作是否符合本 story 驗收條件」為目標,
發現缺口才修改,不要重新實作。
-->
