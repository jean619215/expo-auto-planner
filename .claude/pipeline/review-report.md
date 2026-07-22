# Code Review Report — AiPanel 跨步驟常駐 + preview 可對話 + tool call 即時反映 3D

> Generated: 2026-07-23T01:05+08:00 | Review iteration: 1

## Overall Assessment

APPROVED WITH MINOR FIXES(1 項 🟡 測試穩定性問題,reviewer 依 pipeline 慣例已自行修正並重跑相關測試,全綠)

## Summary

實作完全符合 architect-plan.md D1–D4:三份幾何 state 收斂為 PlanEditor 頂層唯一資料源(`sceneSnapshot` 幾何複本刪除、`VenueScene` 完全 controlled 化),AiPanel 提升為兩步驟共用 flex row 的常駐 sibling。受控化為行為等價重構(對外介面、testid、data attribute 全數保留),race 保護(eager ref 同步)與 `selectionExists` guard 均正確落地。程式碼品質高、註解記錄決策理由,無 🔴 問題。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)

無。

## 🟡 Should Fix (Auto-resolved by Reviewer)

### Issue 1

- **File**: `playwright-tests/ai-panel-persistent.spec.ts:259`(AC7/AC6 案)
- **Issue**: `expect(lastChatBody).not.toBeNull()` 在 `sendMessage()`(click)返回後同步斷言。`page.route` 攔截經 CDP 非同步觸發,click resolve 當下 route handler 可能尚未執行、`lastChatBody` 仍為 null — 潛在 flaky test。
- **Fix applied**: 改為 `await expect.poll(() => lastChatBody).not.toBeNull()` 並加註解。純測試碼修改,產品碼零變動。已重跑 `ai-panel-persistent.spec.ts` + `venue-3d-scene.spec.ts` + `ai-panel.spec.ts`:31 passed / 1 skipped(@paid)/ 0 failed。

## 💡 Suggestions (Consider — No Action Required)

1. `VenueScene.tsx` — `selectedId` 在對應物件被 AI 刪除後仍殘留(guard 讓 TransformControls 不渲染,無實害)。未來若加「選取高亮清單」等衍生 UI,可考慮在 selectionExists 為 false 時順手 `setSelectedId(null)` 收斂 state。現階段不需要。
2. `ai-panel-persistent.spec.ts` — `clickFloor()` 以固定 `waitForTimeout(100/50)` 等 OrbitControls 首幀穩定。已有清楚註解說明理由,屬 3D canvas 測試的合理權衡(canvas 對 Playwright 不透明,無事件可等);若日後 flake 可改為輪詢重試點擊。
3. `ai-panel-persistent.spec.ts:261` — `lastChatBody as unknown as {...}` 雙重 cast 可用型別化的 route handler 收斂,可讀性微幅提升,非必要。

## 審查重點逐項核對(依 review 指派清單)

| 檢核項 | 結果 |
| --- | --- |
| 受控化正確性:VenueScene 無殘留 local state,讀寫全走 props + onSceneChange | PASS — grep 確認 `localWalls/localColumns/localFurniture` 零殘留;mesh map、`data-*-mesh-count`、`selectedFurniture`、commitTransform、handleFloorClick 全部直讀 props,單向資料流成立 |
| `selectionExists` guard | PASS — wall/column/furniture 三型皆以 props 陣列 `some(id)` 派生,TransformControls 渲染條件由 `selectedId &&` 收緊為 `selectionExists &&`;commitTransform id-map 天然 no-op,無需額外分支 |
| eager ref 同步(handleSceneChange) | PASS — `setWalls/setColumns/setFurniture` 後立即 `wallsRef/columnsRef/furnitureRef.current = next.*`,與 `applyActions` 尾段既有模式一致,附註解說明 race 理由;AI await 期間 3D 手動編輯不被舊 ref 快照覆蓋(edge case 測試案實證) |
| sceneSnapshot → sceneGenerated boolean | PASS — 純 gate 語意,`data-scene-generated` 行為等價;`handleNextStep` 保留 generation+1 與清選取,`handleBackToEdit` 簡化為 `setStep("edit")`(資料在唯一資料源,回拷不再需要);grep 確認 `sceneSnapshot` 零殘留;AC9 gate 語意不變 |
| AiPanel 常駐同 parent 同位置 | PASS — 兩步驟共用單一 `flex items-start gap-4` row,左欄 `min-w-0 flex-1` 內條件切換 step-edit/step-preview,AiPanel 恆為第二 sibling → React reconcile 不 unmount;`git diff` 確認 `AiPanel.tsx`、`VenueSceneLoader.tsx` 零修改;Delete/Backspace onKeyDown 維持綁在 step-edit 內層(preview 誤刪防護迴歸測試過);`editorColumnRef` 量測目標仍填滿左欄,effect 的 `step !== "edit"` early return 不變 |
| 測試斷言真的驗 | PASS — AC5 斷言 `data-furniture-mesh-count` 0→1 且 stepPreview 仍可見(不離開 preview);AC7 攔截 `postDataJSON` 解析 `[目前配置]` JSON 斷言含手動放置的 table(即時性),再驗 AI 套用後 2 件互不清掉;AC6 回 edit 驗 `data-furniture-count` 與 `data-furniture` 內容(chair+table);pending 切步驟案驗牆與椅子皆保留;失敗訊息案驗 `ai-action-summary` |
| clickFloor pause 偏離合理性 | 合理 — 僅測試碼,檔頭與函式註解說明 OrbitControls 首幀 lookAt 未穩定會 miss raycast;不影響產品碼,記 💡 2 |

## Security Assessment

- Secrets scan: PASS(diff 無任何 key/token/credential;測試全走 mock route,無真實帳密)
- Input validation: N/A(無新系統邊界;未新增/修改任何 API 呼叫)
- Auth/authz: N/A(不觸及 auth、session、`/api/*` 路由;`src/proxy.ts` 未動)
- CORS/CSP: 未修改
- Out of Scope 遵守: PASS(`src/lib/ai/*`、`AiPanel.tsx`、`/api/ai/*` 零變動;client 端無 `admin.ts`/service_role import)
- Test coverage: 新 spec 8 案覆蓋全部 9 條 AC(AC6+AC7 併一案)+ 2 edge cases;迴歸 spec 抽驗全綠

## Plan Compliance

- [x] All architect plan steps implemented(Implementation Steps 1–11 逐項對應到 diff 與測試)
- [x] Implementation matches plan intent(D1 唯一資料源、D2 版面結構、D3 AiPanel 零修改、D4 race 表全數落地)
- [x] No unauthorised scope additions(diff 僅涉計畫列出的 3 檔 + 新 spec + pipeline 檔)

## Verification Runs

- `npx tsc --noEmit`: PASS
- `npm run lint`: PASS
- `npx playwright test ai-panel-persistent.spec.ts venue-3d-scene.spec.ts ai-panel.spec.ts`(live dev server): 31 passed / 1 skipped(@paid)/ 0 failed
- 開發者回報的全套迴歸(122 案 121 passed / 1 skipped)記錄於 task-log,本次抽驗與其一致

## Conversation Log

| Issue | Developer Response | Resolution |
| --- | --- | --- |
| 🟡 Issue 1(spec 同步斷言 race) | —(依 pipeline 慣例由 reviewer 直接修正測試碼) | `expect.poll` 修正,相關 3 spec 重跑全綠 |
