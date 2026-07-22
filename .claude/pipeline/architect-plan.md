# Architect Plan — AiPanel 跨步驟常駐 + preview 可對話 + tool call 即時反映 3D

> Story: PlanEditor 操作體驗改善(zoom/pan + AI 面板常駐) | Task type: FRONTEND | Generated: 2026-07-22T23:50+08:00

## Overview

把 `AiPanel` 提升為 edit/preview 兩步驟共用 flex row 的常駐 sibling(React tree 位置不變 → 不 unmount),並把幾何 state 收斂為 PlanEditor 頂層唯一資料源:刪除 `sceneSnapshot` 幾何複本、把 `VenueScene` 改為 fully controlled(移除三份 state 中的第三份 local state),AI tool call、2D 手動編輯、3D 手動編輯全部讀寫同一份 state + ref,即時反映與往返不丟資料因此自動成立。

## Task Type Confirmed

FRONTEND — 純前端版面/state 生命週期重構,無後端、schema、auth 變更。與 orchestrator-output.md 一致,無矛盾。

## Escalation Check

- 外部 API contract 變更:無(不動 `/api/ai/*`、`/api/plans/*`)。
- DB schema / 既有資料:無。
- Auth / security model:無。
- 複雜度:在 story 範圍內(2 個元件檔 + 測試)。
- 資訊充分性:orchestrator spec 已把功能性約束鎖死,實作方案可完整定案。
- **結論:不需 escalation。**

## 架構決策(spec 指定 architect 定案項)

### D1 — 三份幾何 state 統一:頂層 state 為唯一資料源,VenueScene 改 controlled

現況三份:(a) PlanEditor 頂層 `polygon/walls/columns/furniture`(+ `*Ref`,`applyActions` 寫入);(b) `sceneSnapshot`(`handleNextStep` 複製、`onSceneChange` 回寫、`handleBackToEdit` 拷回);(c) `VenueScene` 的 `localWalls/localColumns/localFurniture`(`useState(props)` 初始化、無 resync)。

定案:**只留 (a)**。

- `sceneSnapshot` 幾何複本刪除,改為 `sceneGenerated: boolean`(僅承擔「是否已按過下一步」的 gate 與 `data-scene-generated` 屬性)。preview 渲染 guard 由 `step === "preview" && sceneSnapshot` 改為 `step === "preview" && sceneGenerated`,語意不變(AC9 維持)。
- `VenueScene` 移除三個 local useState,mesh 與 `data-*-mesh-count` 一律直接由 props 渲染;手動 3D 操作(`commitTransform` / `handleFloorClick` 放置家具)改為「由 props 計算 next 陣列 → 只呼叫 `onSceneChange`」— 單向資料流:props 下行、onSceneChange 上行。
- PlanEditor 的 `handleSceneChange` 改為直接寫回頂層 `setWalls/setColumns/setFurniture`,並 **eager 同步 `wallsRef/columnsRef/furnitureRef`**(比照 `applyActions` 尾段的 eager ref 寫法)— race 保護關鍵:AI 回應若在 setState 之後、下一次 render 的 useEffect ref 同步之前到達,`applyActions` 讀 ref 仍拿到含 3D 手動編輯的最新值。
- `handleBackToEdit` 簡化為 `setStep("edit")`(資料本來就在唯一資料源上,不再回拷)。
- `handleNextStep` 簡化為 `setSceneGenerated(true)` + `setGeneration(g => g + 1)` + `setStep("preview")` + 清選取(既有行為保留)。

為何不選其他方案:
- `VenueScene` 加 `useEffect` 隨 props resync local state:雙寫來源,onSceneChange → setState → props 變 → effect 再 setLocal 的回聲循環邊界難守,AI 變更與拖曳中的 local 值互踩風險高。
- `key`/seq 強制 remount:每次 AI 指令都會重置 OrbitControls 相機與選取,UX 不可接受;也無法解決 config JSON 過期問題。
- Controlled 化侵入範圍實際最小:`commitTransform` 本來就以 id map 計算 next 陣列,只是把 setLocal 換成純 callback;對外介面(props/onSceneChange/testid/data attribute)完全不變,既有 3D 手動編輯 Playwright 測試(拖曳 commit → 回 edit 同步)行為不變。

附帶 guard(controlled 化後的新邊界):AI 在 preview 刪除了「目前 3D 內被選取」的物件時,`selectedId` 指向已不存在的 id — `TransformControls` 渲染條件從 `selectedId && ...` 收緊為「selectedId 且該 id 仍存在於對應 props 陣列」(派生變數 `selectionExists`),避免 stale `selectedMeshRef` 指向已 unmount 的 mesh。`commitTransform` 以 id map,id 不存在自然 no-op,無需額外分支。

### D2 — AiPanel 掛載提升位置與 preview 版面

`PlanEditor` return JSX 重構為兩步驟共用一個外層 flex row,`AiPanel` 為常駐第二個子節點:

```
<div data-testid="plan-editor" ...>
  <StepProgress current={step} />
  <div className="flex items-start gap-4">
    <div className="min-w-0 flex-1">                {/* 共用左欄 */}
      {step === "edit" && (
        <div data-testid="step-edit" tabIndex={0} onKeyDown={handleKeyDown} ...>
          {/* 既有 toolbar + zoom 群組 + 我的存檔 + 下一步 + <Stage>(內容不動) */}
        </div>
      )}
      {step === "preview" && sceneGenerated && (
        <div data-testid="step-preview">
          {/* 既有 上一步 按鈕 + <VenueSceneLoader key={generation} ...> */}
        </div>
      )}
    </div>
    <AiPanel plan={{ polygon, walls, columns, furniture }} applyActions={applyActions}
             planId={currentPlanId} slot={currentSlot} conversationSeed={conversationSeed} />
  </div>
  <PlanSlotsDialog ... />
</div>
```

- `AiPanel` 在兩個 step 下位於**同一父層、同一相對位置**,step 切換只換掉左欄內容 → React 不 unmount,`turns/input/imageDraft/open/pendingToolResults` 全數保留(AC1–AC4)。收合/展開沿用 AiPanel 既有 `open` state(A1),不另包顯示層。
- 鍵盤 `onKeyDown`(Delete/Backspace)**維持綁在 step-edit 內層 div**,不上移 — 既有 QA 迴歸測試(preview 下按 Delete 不得誤刪 2D 物件)依賴此邊界。
- `editorColumnRef` 維持掛在 step-edit 內層 wrapper(effect 已有 `step !== "edit"` early return,行為不變);preview 左欄靠 `min-w-0 flex-1` 讓 3D canvas(`w-full`,R3F 自動 resize)在 AiPanel 展開(w-80/xl:w-96)時收縮,不水平溢出(edge case 4)。
- `VenueSceneLoader` 保留 `key={generation}`:「下一步」仍整場重建(replace not append、相機重置),既有測試不變;preview 期間 AI 變更走 props 更新,不動 key、不 remount、相機與選取不重置。
- `VenueSceneLoader` 的幾何 props 改傳頂層 state(不再傳 `sceneSnapshot.*`);`venueSizeM={PLAN_AREA_SIZE_M}`/`viewFitSizeM={VENUE_SIZE_M}` 不變。

### D3 — [目前配置] JSON 在 preview 的正確性

`AiPanel` 的 `plan` prop 維持 `{ polygon, walls, columns, furniture }`(頂層 state)。D1 統一後,3D 手動編輯經 `onSceneChange` 直接寫入頂層 state → `plan` prop 隨每次 render 更新 → `handleSend` 組 config JSON 時天然反映 preview 畫面上的最新幾何,含剛做完的 3D 手動調整(AC7)。**`AiPanel.tsx` 本身零修改。**

### D4 — race / 資料一致性保護總表

| 情境 | 保護機制 |
| --- | --- |
| AI await 期間使用者 2D 手動編輯 | 既有:`applyActions` 讀 `*Ref`(不變) |
| AI await 期間使用者 3D 手動編輯 | 新:`handleSceneChange` eager 更新 `*Ref`(D1) |
| 同輪回應內連續多個 tool_use | 既有:`applyActions` 尾段 eager 寫回 ref(不變) |
| preview 送出後切回 edit,回應才到(edge case 1) | `applyActions` 讀 ref = 唯一資料源,套用目標永遠正確;edit 畫布因 state 更新自動反映 |
| AI 刪除 3D 內選取中的物件 | 新:`selectionExists` guard(D1) |
| AI 變更恰落在使用者 3D 拖曳 mouse-down~up 之間 | 已知極窄視窗:commit 為 id-based last-write-wins,被刪 id 則 no-op;不加鎖(複雜度不成比例),記錄於 Architecture Notes 供 QA 知悉 |

## Files to Create

| File path | Purpose |
| --------- | ------- |
| `playwright-tests/ai-panel-persistent.spec.ts` | 本任務驗收:跨步驟對話保留、preview 下指令即時反映 3D、手動/AI 互不覆蓋、回 edit 同步(mock `/api/ai/chat`,沿用 ai-panel.spec.ts 的 page.route fixture 慣例,不花錢) |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/components/venue/PlanEditor.tsx` | JSX 重構為共用 flex row + 常駐 AiPanel;`sceneSnapshot` → `sceneGenerated: boolean`;`handleNextStep`/`handleBackToEdit`/`handleSceneChange` 依 D1 改寫(含 eager ref 同步);`data-scene-generated` 改讀 boolean |
| `src/components/venue/VenueScene.tsx` | 移除 `localWalls/localColumns/localFurniture` useState,mesh/data attribute 改讀 props;`commitTransform`/`handleFloorClick` 改純 `onSceneChange` 上報;TransformControls 加 `selectionExists` guard |
| `playwright-tests/pages/AiPanelPage.ts` | 更新頂部註解(不再是 step "edit" only);如需,補少量 helper(無新 testid) |

不修改:`AiPanel.tsx`、`VenueSceneLoader.tsx`、任何 `/api/*` route、`src/lib/ai/*`(Out of Scope 遵守)。

## Implementation Steps

1. `src/components/venue/VenueScene.tsx`:刪除三個 local useState;`localWalls/localColumns/localFurniture` 的所有讀取點(mesh map、`data-*-mesh-count`、`selectedFurniture`、commit 計算)改為直接用 props `walls/columns/furniture`。
2. 同檔 `commitTransform`:rotate 與 translate 分支的 next 陣列改由 props 計算,移除 `setLocalX` 呼叫,僅呼叫 `onSceneChange(next)`。`handleFloorClick` 放置家具同理(`[...furniture, item]` → `onSceneChange`,保留 `selectObject` 與 `setPlacingKind(null)`)。
3. 同檔:以派生變數 `selectionExists`(selectedId 對應 id 存在於 props 陣列)收緊 `TransformControls` 渲染條件。
4. `src/components/venue/PlanEditor.tsx`:`sceneSnapshot` state 換成 `const [sceneGenerated, setSceneGenerated] = useState(false)`;`handleNextStep` 改為 `setSceneGenerated(true); setGeneration(g => g + 1); setStep("preview"); setSelectedObject(null); setSelectedVertex(null);`。
5. 同檔 `handleSceneChange`:改寫為直接 `setWalls/setColumns/setFurniture(next.*)` 並同步 `wallsRef.current = next.walls`(columns/furniture 同理)— eager,比照 `applyActions` 尾段註解的理由,並加註解說明。
6. 同檔 `handleBackToEdit`:簡化為 `setStep("edit")`。
7. 同檔 JSX:依 D2 結構重排 — `StepProgress` 之後包 `<div className="flex items-start gap-4">`,左欄 `<div className="min-w-0 flex-1">` 內放既有 step-edit 區塊(含 tabIndex/onKeyDown/editorColumnRef,原內容不動)與 step-preview 區塊(guard 改 `sceneGenerated`,`VenueSceneLoader` props 改傳頂層 state);`<AiPanel>` 移出成為 flex row 第二個子節點,props 不變;wrapper `data-scene-generated={sceneGenerated}`。step-edit 原本自帶的 `flex items-start gap-4` 佈局职责移轉到新外層 flex row,step-edit 內層調整 class 避免雙重 flex 造成版面偏移。
8. `npx tsc --noEmit` 與 `npm run lint` 通過;手動 smoke:edit 對話 → 下一步 → 對話仍在 → preview 下 AI 指令 → 3D 立即變 → 上一步 → 2D 同步。
9. `playwright-tests/pages/AiPanelPage.ts`:更新註解;確認既有 locator 在 preview 步驟同樣可用(testid 未變、單實例)。
10. 新增 `playwright-tests/ai-panel-persistent.spec.ts`(mock `/api/ai/chat` + `/api/ai/config`,沿用既有 fixture/route 慣例),案例見 Test Plan。
11. 跑迴歸:`ai-panel.spec.ts`、`venue-3d-scene.spec.ts`、`venue-objects.spec.ts`、`venue-zoom-pan.spec.ts`、`venue-plan-editor.spec.ts`、`plan-slots.spec.ts` 全綠(live dev server + `.env.playwright.local` 測試帳號)。

## Data Flow

```
                 ┌────────────────────────────────────────────┐
                 │ PlanEditor 頂層 state(唯一資料源)          │
                 │ polygon/walls/columns/furniture + *Ref      │
                 └──────┬───────────────┬───────────────┬──────┘
        props 下行      │               │               │ plan prop(每 render 最新)
   ┌────────────────────▼──┐   ┌────────▼─────────┐   ┌─▼──────────────┐
   │ 2D Stage(edit)        │   │ VenueScene        │   │ AiPanel(常駐)  │
   │ 既有 handler 直接 set │   │ (controlled,無    │   │ handleSend 組   │
   └───────────────────────┘   │  local state)     │   │ config JSON     │
                               └────────┬──────────┘   └─┬──────────────┘
                     onSceneChange 上行 │                │ tool call
                 (handleSceneChange:    │                │ applyActions(讀 *Ref,
                  setState + eager ref) ▼                ▼  寫 state + eager ref)
                 ┌────────────────────────────────────────────┐
                 │ 同一份 state → 2D/3D/AI config 永遠一致      │
                 └────────────────────────────────────────────┘
```

## Test Plan

無 unit test framework(AGENTS.md);驗收 = Playwright(mock AI 路由)+ 迴歸。

新 spec `ai-panel-persistent.spec.ts`(mock `/api/ai/chat`,fixture 回 `add_furniture`/`move_item` tool_use):

1. **跨步驟對話保留**(AC1/AC2):edit 開面板 → mock 對話一輪(assistant 文字可見)→ 下一步 → `ai-assistant-text` 仍在 → 上一步 → 仍在(往返兩次)。
2. **輸入草稿保留**(AC3):edit 輸入框打字未送出 → 下一步 → 上一步 → `ai-input` value 原樣。
3. **preview 收合狀態**(AC4):進 preview,面板未展開時僅 `ai-panel-toggle` 可見、`ai-panel` count 0;點擊展開。
4. **preview 下指令即時反映 3D**(AC5):畫牆 → 下一步 → 展開面板 → 送出觸發 `add_furniture` 的 mock 回應 → `data-furniture-mesh-count` 由 0 變 1(不離開 preview)、`ai-action-summary` 顯示。
5. **手動 3D + AI 互不覆蓋 & config JSON 最新**(AC7):preview 以 `furniture-place-table` + 點擊 3D canvas 放一件家具(mesh-count=1)→ 送出 AI 指令(route 攔截 `postDataJSON`,斷言最新 user 訊息的 `[目前配置]` JSON furniture 含剛放置那件)→ mock 回 `add_furniture` → mesh-count=2(手動那件仍在)。
6. **回 edit 同步**(AC6):承 4/5,上一步 → `data-furniture-count` 等於 preview 最終數量、`data-furniture` 內容含 AI 新增與手動放置項。
7. **preview pending 中切回 edit**(edge case 1):route 延遲回應 → preview 送出 → 立即上一步 → 回應到達後 `data-furniture-count` 正確 +1,期間 edit 手動改動不被覆蓋。
8. **tool call 失敗訊息**(edge case 2):mock 回 index 越界 `move_item` → preview 下 `ai-action-summary` 顯示失敗訊息。
9. **讀檔狀態不受切換影響**(AC8):讀取存檔格後往返 edit/preview,`data-current-slot`/`data-current-plan-id` 不變、清空對話按鈕兩步驟皆可見可用(可併入 plan-slots.spec.ts 或本檔,擇一)。

迴歸(既有測試,必須全綠、原則上不改寫):`ai-panel.spec.ts`(payload 瘦身/續聊/清空對話)、`venue-3d-scene.spec.ts`(wizard/mesh counts/Delete 防護)、`venue-objects.spec.ts`、`venue-zoom-pan.spec.ts`、`venue-plan-editor.spec.ts`、`plan-slots.spec.ts`。若任何既有測試需因新版面調整,必須在 PR 說明逐條列出理由(預期:不需要 — testid 與 data attribute 全數保留)。

## Architecture Notes

- 本任務把「三份幾何 state」以**刪掉兩份**解決,而非加同步機制 — effect resync / key remount 都是在多資料源上疊補丁,正是本次 bug 的根因型態。
- `VenueScene` 由半自治改 controlled 是行為等價重構:對外介面完全不變;呼叫端只有 `VenueSceneLoader` ← `PlanEditor` 一條鏈。
- 已知未防護窄窗:AI 變更恰落在 3D 拖曳 mouse-down~up 之間(見 D4 表末列)。
- 效能:preview 下每次 AI/手動變更觸發 PlanEditor re-render,但 edit 左欄(Konva Stage)該時未掛載,實際只重繪 3D 與面板,量級與既有 edit 步驟相同,無新增疑慮。
- Next.js 16 breaking-changes 對本任務無新框架 API 需求(純 client component 重構);developer 動工前仍依 AGENTS.md 查閱 `node_modules/next/dist/docs/` 相關章節確認。

## Security Checklist

- [ ] 無硬編碼 secrets/credentials(Playwright 測試帳號一律走 `.env.playwright.local`)
- [ ] 無新增系統邊界輸入(不新增/修改任何 API 呼叫;mock 僅存在於測試)
- [ ] Auth/permission:不觸及(`/api/ai/*`、`/api/plans/*` 呼叫端邏輯零修改)
- [ ] 不 log 任何 token/session/敏感資料
- [ ] 不動 `src/lib/ai/` server-only 邊界、凍結系統提示、`AI_MODEL`/`AI_CHAT_COST` env(Out of Scope 遵守)
- [ ] client 端不 import `admin.ts`/service_role(不適用,列入 reviewer 檢查)

## Definition of Done

- [ ] 全部 Implementation Steps 完成
- [ ] 新 spec `ai-panel-persistent.spec.ts` 全綠;上列迴歸 spec 全綠
- [ ] orchestrator-output.md 的 9 條 Clarified Acceptance Criteria 逐條可對應到通過的測試或手動驗證
- [ ] 無 TODO、註解掉的程式碼、debug log
- [ ] `npm run lint` + `npx tsc --noEmit` 通過
- [ ] 符合 AGENTS.md 全部規則(含 Out of Scope:不動 `/api/ai/*`、`src/lib/ai/`)
- [ ] Security Checklist 通過
