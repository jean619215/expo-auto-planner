# Orchestrator Output — 場地規劃 AI 助理 / Task 1

> Story: stories/ai-planner-assistant.md
> Task 1 of 3: [BACKEND] 點數 ledger 支援 AI 扣點
> Task type: **BACKEND**
> 性質:新實作。為 task 2 的 AI API 鋪路 — 本 task 只做資料層 + helper,不碰 AI 呼叫。

## 任務描述
1. Migration:放寬 `point_transactions.reason` check constraint,允許值加入 `ai_usage`(現為 `signup_bonus`/`purchase`)。
2. 扣點 helper:餘額檢查 + 扣點寫入,抽成 `src/lib/points/` 內可重用函式,供 task 2(及未來任何扣點功能)使用。

## Clarified Acceptance Criteria

### AC1 — reason constraint migration
- 新 migration(不改舊檔):drop 舊 check、加新 check `reason in ('signup_bonus','purchase','ai_usage')`。
- 既有資料不受影響(舊值仍合法)。
- 推上雲端 Supabase。

### AC2 — 扣點 helper(`src/lib/points/ledger.ts` 或同等)
- 介面(server-only,內部用 admin client;絕不可被 client component import):
  - `getBalance(userId): Promise<number>` — SUM(delta),與 `/api/points/balance` 算法一致。
  - `deductPoints({userId, amount, reason, refId}): Promise<{ok: true} | {ok: false, error: 'insufficient_balance' | 'duplicate'}>`
- 行為:
  - `amount` 正整數;寫入 ledger 為 `delta = -amount`。
  - 餘額不足 → 不寫入,回 `insufficient_balance`。
  - `refId` 撞 unique(23505)→ 回 `duplicate`(冪等,不重扣)。
  - 其他 DB 錯誤 → throw(呼叫端回 500)。
- 已知取捨(記錄,不解):餘額檢查與寫入非同一 transaction — 併發下可能短暫透支。phase 1 接受(單人使用情境),註解註明;真要嚴格需 DB function/RPC,留待未來。

### AC3 — 不破壞既有行為
- signup_bonus trigger、購買 webhook 發點、balance API 全部不受影響。
- 全套 Playwright(points-shop 10 測試含在內)不迴歸。

### AC4 — 規範符合
- Supabase 走 factory(admin.ts);不 log 秘密;helper 不含 API route 邏輯(薄薄資料層)。

## 驗證方式(BACKEND)
- Migration:推雲端後 service_role 探測 — 插 `reason='ai_usage'` 成功、插非法 reason 被 check 擋。
- Helper:node 腳本實測 getBalance 正確、扣點成功遞減、餘額不足拒絕、重複 refId 冪等、測試資料清理。
- 手動 checklist 更新(`supabase/tests/` 新增或併入 points checklist)。
- `npx tsc --noEmit` + lint + 全套 Playwright 迴歸。

## Out of Scope
- AI API route(task 2)、前端(task 3)、退點機制、DB transaction 級嚴格扣點。

## Assumptions
1. helper 放 `src/lib/points/ledger.ts`;architect 可調整檔名。
2. 扣點量由呼叫端決定(task 2 再定每次呼叫扣多少),helper 不寫死。
