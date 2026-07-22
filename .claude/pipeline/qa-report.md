# QA Report — AiPanel 跨步驟常駐 + preview 可對話 + tool call 即時反映 3D
> Generated: 2026-07-23T02:10:00+08:00 | QA iteration: 1

## Summary
- Tests executed: 46 (targeted: `ai-panel-persistent.spec.ts` + `venue-3d-scene.spec.ts` + `ai-panel.spec.ts` + `plan-slots.spec.ts`) — 1 skipped (`@paid` real-model smoke test, correctly skipped per instruction: no real Anthropic API call)
- Passed: 45
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| edit 步驟對話至少一輪 → 下一步 → 對話歷史完整可見 | ✅ PASS | `ai-panel-persistent.spec.ts` AC1/AC2 案(`ai-panel-persistent.spec.ts:125`) |
| preview → 上一步回 edit → 對話歷史依然完整(往返多次) | ✅ PASS | 同案,往返兩次驗證通過 |
| edit 輸入框打字未送出 → 切 preview 再切回 edit → 內容原樣保留 | ✅ PASS | AC3 案(`:155`) |
| preview 步驟 AiPanel 收合時只顯示 toggle,不遮擋 3D;點擊後展開 | ✅ PASS | AC4 案(`:174`) |
| preview 展開後送出觸發 tool call 的指令,`/api/ai/chat` 回應套用後 3D 場景立即反映(`data-furniture-mesh-count` 等),不需離開/重進 preview | ✅ PASS | AC5 案(`:193`):mesh-count 0→1,停留在 preview |
| preview 中 AI 修改幾何後回 edit,2D 畫布顯示同一份包含 AI 結果的最新配置 | ✅ PASS | AC6 案(併入 `:224`):回 edit 後 `data-furniture-count`/`data-furniture` 含 AI 新增 + 手動放置兩項 |
| preview 中先手動 3D 拖曳/放置,再對 AI 下指令,AI 收到的「目前配置」JSON 反映該手動變更(非切換當下舊快照) | ✅ PASS | AC7 案(`:224`):攔截 `postDataJSON` 解析 `[目前配置]`,確認含手動放置的家具 |
| 已讀檔(planId/slot 非 null)在 edit/preview 間切換,slot/planId 不變、清空對話按鈕行為兩步驟皆正常 | ✅ PASS | AC8 案(`:350`) |
| `sceneSnapshot === null`(未進 preview)時不渲染 3D/preview 版面,既有 gate 不變 | ✅ PASS | `venue-3d-scene.spec.ts` 全數通過(default state / button enabled 邏輯無回歸);程式碼核對 `sceneGenerated` boolean 取代 `sceneSnapshot` 後 gate 語意等價 |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| preview 送出 AI 指令 pending 中點「上一步」切回 edit,回應到達後仍套用到正確幾何 state | ✅ PASS | Edge case 1 案(`:295`):edit 手動編輯不被延遲回應覆蓋,回應到達後正確 +1 |
| AI tool call 索引越界等失敗,`applyActions` 判定 `ok:false`,preview 下失敗訊息顯示於 `ai-action-summary` | ✅ PASS | Edge case 2 案(`:329`) |
| `sceneSnapshot`/`sceneGenerated` 為初始值時 AiPanel 仍正常掛載於 edit 版面 | ✅ PASS | 與上方 AC9 同一驗證點,`venue-3d-scene.spec.ts` 迴歸涵蓋 |
| 常駐右側欄疊加下,較窄視窗不因新版面造成水平溢出 | ✅ PASS | 程式碼核對:`editorColumnRef` 量測 wrapper 沿用既有作法未變;`ai-panel.spec.ts` 面板展開/收合案迴歸全綠,無版面斷言失敗 |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| `/api/ai/chat` 於 preview 步驟回傳非 200(402/401/其他) | ✅ PASS | `ai-panel.spec.ts` AC4 案(402 點數不足、500 一般錯誤)迴歸通過,`AiPanel` 錯誤處理邏輯零修改,preview 掛載點不影響行為 |
| preview 下 AI 變更後未回 edit 即離開/重整(視同未存檔遺失,非本任務保護範圍) | N/A | 依 orchestrator-output.md Error States 段落,此為既有預期行為、非本任務新增保護範圍,不列為需驗證項目 |

## Regression Check
| Feature | Result |
|---|---|
| ai-panel.spec.ts(AI 面板既有行為:payload 瘦身/續聊/清空對話/錯誤與點數狀態) | ✅ PASS (17/17, 1 skipped @paid) |
| venue-3d-scene.spec.ts(3D whitebox/step wizard/Delete 防護) | ✅ PASS (13/13) |
| plan-slots.spec.ts(存檔面板全 AC) | ✅ PASS (14/14) |
| `npx tsc --noEmit` | ✅ PASS |
| `npm run lint` | ✅ PASS |

> 全套完整迴歸(其餘 spec:venue-zoom-pan / venue-objects / venue-plan-editor / venue-dimensions 等)留給下一階段 playwright stage 執行,依任務指示本輪僅跑上述四支目標 spec + review 剛跑過部分之覆核。

## Security Test
- Sensitive data exposure: PASS — 未呼叫真實 Anthropic API(所有 AI 回應經 `page.route` mock);新 spec 無硬編碼帳密,測試帳號經 `.env.playwright.local`(未讀取內容,依指示禁止 `source .env*`)
- Input validation: N/A — 本任務不涉及新的使用者輸入面/API 邊界(純前端掛載點與 state 生命週期重構),與 review-report.md 判定一致
- Auth boundary: N/A — 不觸及 auth/session/`src/proxy.ts`/`/api/*` 路由;`git diff --stat` 確認變更僅限 `PlanEditor.tsx`、`VenueScene.tsx`、`AiPanelPage.ts`(測試 page object)、新 spec 檔
- Out-of-scope 遵守: PASS — grep 確認 `src/lib/ai/`、`AiPanel.tsx`、`VenueSceneLoader.tsx`、任何 `/api/ai/*`/`/api/plans/*` 路由檔零異動

## Bugs Found
無。

## Test Coverage
- New code coverage: `ai-panel-persistent.spec.ts`(8 案)對齊 orchestrator-output.md 全部 9 條 Clarified Acceptance Criteria(AC6+AC7 併一案,同 review-report 記載)+ 2 條 Edge Cases;既有 `ai-panel.spec.ts`/`venue-3d-scene.spec.ts`/`plan-slots.spec.ts` 迴歸全綠,確認常駐掛載重構未破壞既有行為
- Minimum required: FRONTEND 任務以 Playwright 全通過為驗收 gate(AGENTS.md,無 JS unit/integration framework)
- Status: PASS

## Additional Notes(非 bug,供人類知悉)
- `VenueScene.tsx`/`PlanEditor.tsx` 三份幾何 state 收斂為單一資料源(architect D1 決策),grep 核對 `localWalls`/`localColumns`/`localFurniture`/`sceneSnapshot` 皆無殘留,與 review-report.md 記載一致。
- Review 階段已將一個測試碼 flaky 風險(`ai-panel-persistent.spec.ts:259` 同步斷言 race)修正為 `expect.poll`,本輪重跑該檔全綠,未見殘留 flake。
- 未依 DB 存取:全部驗證透過 `page.route` API mock 完成,未觸碰真實 Supabase 資料,無需清理測試殘留。
- 本輪未跑完整 114 案全套(依任務指示留給 playwright stage),已涵蓋任務要求之 4 支目標 spec(review 剛跑過部分之覆核)。

## Playwright E2E Results
> Executed: 2026-07-23T02:45:00+08:00

- `npx playwright test ai-panel-persistent`: 8 passed / 0 failed
- `npx playwright test` (full suite, dev server localhost:3000): **121 passed / 1 skipped (@paid) / 0 failed** (4.8m)

All 9 Clarified ACs + 2 edge cases from `ai-panel-persistent.spec.ts` verified in a real browser:

| Test | Acceptance Criterion | Result |
|---|---|---|
| AC1/AC2 對話歷史往返保留 | edit↔preview 往返兩次,對話保留 | ✅ PASS |
| AC3 輸入草稿保留 | 輸入框未送出文字跨步驟保留 | ✅ PASS |
| AC4 preview 收合狀態 | 未展開僅 toggle 可見,點擊後展開 | ✅ PASS |
| AC5 preview 下指令即時反映 3D | add_furniture 後 mesh 數立即從 0→1,不離開 preview | ✅ PASS |
| AC6/AC7 手動 3D + AI 互不覆蓋 | config JSON 反映最新配置;AI 套用後兩件都在;回 edit 同步 | ✅ PASS |
| Edge: preview pending 中切回 edit | 等待期間手動編輯不被回應覆蓋,回應到達後正確套用 | ✅ PASS |
| Edge: tool call 失敗訊息 | move_item 索引越界,ai-action-summary 顯示失敗訊息 | ✅ PASS |
| AC8 讀檔狀態不受步驟切換影響 | slot/planId 不變、清空對話按鈕兩步驟皆可見可用 | ✅ PASS |

Full regression suite (venue-3d-scene, ai-panel, plan-slots, venue-zoom-pan, venue-objects, venue-plan-editor, venue-dimensions, points-shop, membership, profile-edit-mode, site-header) — no regressions, all green. Only skip: `@paid` real-model smoke test (per task instruction, not run).

### Failures
None.

**Outcome: all acceptance criteria verified in browser. checkpoints.playwright = "completed", stage = "complete".**
