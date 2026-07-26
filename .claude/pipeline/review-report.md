# Code Review Report — [FRONTEND] 打光與陰影(步驟 03)
> Generated: 2026-07-26T09:40+08:00 | Review iteration: 1
> Story: `stories/venue-refined-3d.md` task 2 | Plan: `.claude/pipeline/architect-plan.md`

## Overall Assessment

**APPROVED WITH MINOR FIXES** — 4 個 🟡 已於本階段修正(見 Conversation Log),0 個 🔴。

## Summary

實作忠實對應 architect-plan.md 的 D1–D8,包含計畫點名為「最可能真實缺陷」的
`shadow.camera.updateProjectionMatrix()`(已確認存在且綁在正確的依賴上)。範圍紀律良好:
無任何貼圖 / GLB / 程序化家具幾何,`FURNITURE_DEFAULTS` 與 `VenueScene.tsx` 未被觸碰。
主要問題集中在**驗收證據的強度**而非產品邏輯:探針有一項診斷是原始碼字面量而非場景實際值,
另有兩個測試斷言在任何實作下都必然通過。四項皆已修正,`tsc --noEmit` / `eslint` 重跑全綠。

---

## 🔴 Critical Issues (Must Fix — Pipeline Paused)

無。

**特別查核(計畫 Risks 表列出的高風險項,逐項確認通過):**

| 風險項 | 結果 |
| --- | --- |
| 忘記 `shadow.camera.updateProjectionMatrix()` | ✅ `refinedLighting.tsx:129`,位於 `useLayoutEffect(deps=[bounds])` 內。`bounds` 是 `useMemo([polygon, walls, columns, furniture])`,AI `resize_floor` 會換 `polygon` 陣列識別 → 視錐必然重算。 |
| 忘記把 `light.target` 掛進場景 | ✅ `<primitive object={target} position={[centerX, 0, centerY]} />`(`refinedLighting.tsx:162`),三盞方向光共用。 |
| `shadow-mapSize-*` 巢狀 prop 未生效 | ✅ 走 JSX prop 路徑,於首次 layout effect 前完成,不需 S9 的退回方案。 |
| 誤改 `FURNITURE_DEFAULTS` / `VenueScene.tsx` | ✅ D7 的「絕對不得修改」清單 12 個路徑在 `git status` 中全部不存在。 |

**陰影視錐邊界數學(逐案驗算,無截斷)：**

`R = radiusM + 4`、`D = max(radiusM*2, 20)`、`near = max(0.5, D-R-5)`、`far = D+R+2`。
`KEY_DIR` 正規化後 y 分量 = 0.8165(仰角 54.7°)。

- **空場景 / 預設 10m 地板**(`createDefaultFloor(50)` → 20–30 帶,`radiusM = 7.07`):`R = 11.07`、`D = 20`、`near = 3.93`、`far = 33.07`。span = 22m → 約 1.1cm/texel。
- **極小場地**(`radiusM` 被 `MIN_SHADOW_RADIUS_M = 2` 夾住):`R = 6`、`D = 20`、`near = 9`、`far = 26`。無 0 寬視錐、無 NaN。
- **200m 滿版場地**(`radiusM = 141.4`):`R = 145.4`、`D = 282.8`、`near = 132.4`、`far = 430.2`。內容沿光軸的最大位移僅 `0.408*(100+100) = 81.6m`,加最高物件 `3 * 0.816 = 2.45m`,遠小於 `R` 提供的 145.4m 餘裕 → **不截斷**。橫向同理(AABB 內任一點離中心 ≤ 半對角線 141.4 < R)。
- **高瘦物件**(bannerStand 2.0m / cabinet 1.8m):`MAX_OBJECT_HEIGHT_M = 3` 已涵蓋且 near 尚有數十公尺餘裕。
- `near` 的 `Math.max(0.5, ...)` clamp 在實務參數域內**不可能觸發**(因 `D ≥ 20` 而 `R = radiusM + 4`),故 `far - near` 恆為 `span + 7`。

`planBoundsM` 正確納入地板 + 牆(端點外擴 `WALL_THICKNESS_M/2`)+ 柱 + 家具(外接圓
`hypot(w,h)/2`,涵蓋任意 `rotationDeg`),符合 D2「物件可合法站在地板多邊形之外
(`clampColumnCenter` 只 clamp 到 `venueSizeM`)」的理由。`Number.isFinite` 過濾與全空退化路徑皆到位。

---

## 🟡 Should Fix(本階段已由 reviewer 修正)

### Issue 1 — `data-floor-receives-shadow` 是原始碼字面量,對應的測試無法失敗

- **File**: `src/components/venue/RefinedScene.tsx:136`(修正前)、`playwright-tests/venue-refined-lighting.spec.ts` 案例 4
- **Issue**: 該屬性以 `data-floor-receives-shadow="true"` 硬寫在根 div 上,不是探針回報值。
  案例 4 的 `expect(await editor.refinedFloorReceivesShadow()).toBe(true)` 因此是恆真斷言 ——
  就算有人刪掉 `FloorMesh` 的 `receiveShadow`,測試依然全綠。這同時牴觸 architect-plan D8 的
  硬性設計原則(「回報的一律是 renderer/scene 的實際值,不是原始碼裡的字面量」)、
  spec 檔頭註解、以及 `PlanEditorPage.ts` 新增區塊的註解 —— 兩處註解都宣稱**所有**診斷值取自實際場景狀態。
- **Fix applied**: 匯出 `REFINED_FLOOR_NAME`,`FloorMesh` 以 `name` 標記自己;探針在 traverse 時
  以 name 找到地板 mesh,回報**真實的** `receiveShadow` 與 `castShadow`。新增
  `data-floor-casts-shadow` + `refinedFloorCastsShadow()` getter,案例 4 加上
  `expect(await editor.refinedFloorCastsShadow()).toBe(false)` —— 這條同時把 D5
  「地板絕不投影(DoubleSide 是本場景唯一真正的 acne 來源)」變成機器可驗證的守門條件,原本只有註解在守。

### Issue 2 — 案例 10(高瘦物件不被 near/far 截斷)是恆真斷言

- **File**: `playwright-tests/venue-refined-lighting.spec.ts` 案例 10
- **Issue**: `expect(near).toBeGreaterThanOrEqual(0)` 由 `Math.max(0.5, ...)` 保證,
  `expect(far).toBeGreaterThan(near)` 由 `far = D+R+2` 的構造保證。**任何** near/far 公式都會通過,
  包含把 `MAX_OBJECT_HEIGHT_M` 改成 0 或把 `SHADOW_MARGIN_M` 砍成 0 的退化版本 ——
  也就是說,這條 edge case 目前沒有任何自動化保護。
- **Fix applied**: 補上真正的不變式 `expect(far - near).toBeGreaterThanOrEqual(span + 3)`。
  現行實作恆為 `span + 7`(見上方驗算),餘裕充足;而移除高度餘裕的退化實作會落到 `span` 附近而失敗。

### Issue 3 — 案例 6 的「零下載」把關比計畫弱,且常數命名誤導

- **File**: `playwright-tests/venue-refined-lighting.spec.ts:17`
- **Issue**: 常數名為 `FURNITURE_KINDS_URL_ALLOWLIST_HOST`,但它既與 furniture kinds 無關、
  也不是 allowlist —— 它是唯一被禁止的 host。且 `externalRequests` 收集了所有非 localhost 請求,
  卻只拿來比對 `githack.com` 一個字串;若日後有人改用自托管或別的 CDN 取 `.hdr`,測試不會發現。
- **Fix applied**: 改名為 `FORBIDDEN_ENV_ASSET_PATTERNS`,涵蓋 `githack.com` / `polyhaven` /
  `.hdr` / `.exr`,並改為 `expect(forbidden).toEqual([])` —— 失敗時直接列出被抓到的 URL,而非一個裸 `false`。

### Issue 4 — 探針每一幀都 traverse 全場景並 `JSON.stringify`,永不停止

- **File**: `src/components/venue/RefinedSceneProbe.tsx:77-136`(修正前)
- **Issue**: `useFrame` 內的 traverse + `JSON.stringify` 在第 2 幀後**無限期**每幀執行。單次成本雖低,
  但它落在本任務唯一無法自動化驗收的 AC(「數十件家具下仍可流暢旋轉」)的熱迴圈裡 —— 純診斷程式碼
  不該常駐在那裡。更實質的是連鎖成本:每次 `onReport` → `setDiagnostics` → `RefinedScene` re-render
  → `<HallEnvironment>` 的 children 取得新識別 → drei `EnvironmentPortal` 的
  `useLayoutEffect`(依賴陣列含 `children`,已核對 `node_modules/@react-three/drei/core/Environment.js:134`)
  重跑一次 128px cube 渲染。計畫 D4 已把這條連鎖列為已知瑕疵,不該再讓探針成為額外的觸發源。
- **Fix applied**: 新增 `PROBE_ACTIVE_FRAMES = 120`,超過即 early-return。`frameRef` 已由
  `resetKey`(revision)重置,所以場景一變就重新武裝、重新回報 120 幀。保留 120 幀(約 2 秒)而非
  「回報一次就停」是刻意的:`shadow.map` 配置、環境 cube 渲染與 `gl.info.memory` 需要幾幀才穩定,
  太早停會讓 `shadowMapAllocatedWidth` 永遠停在 `null`。

**附帶修正(型別整潔,無行為變更)**:探針原本因 TS 對 callback 內賦值的 CFA 限制,
把 `keyLight` 窄化成 `never`,導致每個讀取點都要 `as THREE.DirectionalLight`。改用 holder object
(`found.key` / `found.floor`)後 5 處 cast 全部移除。

---

## 💡 Suggestions（Consider — 不需處理,登記備查）

1. **`HallLighting` 的 `revision` prop 已冗餘**。`bounds` 是對同樣四個 props 的 `useMemo`,
   任何幾何編輯都會換掉 `bounds` 的識別,所以 `useLayoutEffect(deps=[gl, bounds, revision])`
   裡的 `revision` 不會帶來任何 `bounds` 沒帶來的重烘焙。真正需要 `revision` 的只有探針的 `resetKey`。
   維持現狀無害(只是多一個 no-op 依賴),但若日後 `bounds` 改成值比較(而非識別比較)的快取,
   這個 prop 就會從冗餘變成必要 —— 屆時請保留註解說明。
2. **`MAX_OBJECT_HEIGHT_M = 3` 是手動維護的重複常數**,同時鏡射 `RefinedScene.tsx` 的
   `WALL_HEIGHT_M = 3` 與 `max(FURNITURE_DEFAULTS[*].height3d) = 2.0`。註解有寫明,但若 task 4–6
   引入更高的模型(或把牆加高),near plane 的餘裕會靜默失效。可考慮改為
   `Math.max(WALL_HEIGHT_M, ...Object.values(FURNITURE_DEFAULTS).map((d) => d.height3d))`。
   本任務不改 —— 會把 `refinedLighting.tsx` 對 `furniture.ts` 的依賴從零變成一。
3. **`REFINED_GL` / `REFINED_SURFACE` 是可變的匯出物件**。兩者的契約(「模組層級單例,絕不在
   render 內重建、絕不 mutate」)目前只靠註解。`as const` + `Object.freeze` 可讓契約由型別系統執行。
4. **案例 9(極大場地)靠 30 次 zoom-out 後在 x=195 畫牆**,是本 spec 中對畫布座標最敏感的一條。
   Playwright 階段若出現 flake,優先懷疑此處而非產品程式碼(task 1 的 playwright 階段已修過兩次同類的
   測試撰寫 bug,見 task-log)。
5. **`gridHelper` 在新打光下的違和感**已由計畫 Architecture Notes 列為 task 3 候選,本任務正確地未動它。

---

## Security Assessment

| 項目 | 結果 | 說明 |
| --- | --- | --- |
| Secrets / credentials scan | **PASS** | 本 diff 不含任何憑證、token、連線字串。Playwright spec 未硬寫帳密(沿用既有 `editor.navigate()`)。 |
| Input validation at boundaries | **N/A** | 未新增/修改任何 API route、系統邊界輸入或使用者輸入解析。`planBoundsM` 對所有座標做 `Number.isFinite` 過濾,已是防禦性的。 |
| Auth / authz | **N/A** | 未觸及 `src/proxy.ts`、`src/lib/supabase/**`、任何 page 路由或 session 處理。 |
| 敏感資料入 log | **PASS** | 探針只讀 renderer 狀態,不 `console.*`。 |
| 新增外部網路請求 | **PASS** | D4 的程序化 `<Environment>` + `<Lightformer>` 零下載;案例 6 以 network 監聽把關(本次已強化)。 |
| 新增依賴 | **PASS** | `package.json` 未變動;`Environment` / `Lightformer` 皆來自既有的 `@react-three/drei`。 |
| CORS / CSP | **PASS** | 未修改。 |
| SQL injection / XSS | **N/A** | 無 DB 存取。所有 `data-*` 值皆為 `String(number)` 或封閉列舉字串(`TONE_MAPPING_LABELS` / `SHADOW_MAP_TYPE_LABELS` 的 `?? "unknown"` 兜底),由 React 輸出,無 `dangerouslySetInnerHTML`。 |
| `service_role` / server-only 邊界 | **PASS** | 未 import `admin.ts`;`src/lib/ai/**` 未觸及。 |
| 分層規則 | **PASS** | `src/lib/venue/bounds.ts` 只 import `./plan` 與 `./furniture` 的型別/常數,零 React / DOM / Three。新增的 Three 程式碼全在 `src/components/venue/` 且在既有 `RefinedSceneLoader` 的 `ssr:false` 邊界內。 |

測試覆蓋:14 個 Playwright 案例對應 orchestrator-output.md 的 10 條 AC 與 7 個 edge case
(案例 14 為截圖產物,不斷言)。無 JS unit framework(AGENTS.md),符合專案慣例。

---

## Plan Compliance

- [x] 14 個 Implementation Steps 全數實作(S1–S14)
- [x] 實作符合計畫意圖(D1 固定 4 盞光 / D2 動態視錐 / D3 顯式 ACES + 僅覆寫地板色 / D4 零下載 IBL / D5 normalBias + 地板不投影 / D6 自寫重烘焙 / D7 檔案切分 / D8 場景探針)
- [x] 無未授權的範圍擴張
  - 材質:只有 `roughness` / `metalness` **純量**(本任務授權範圍),**零** `map` / `normalMap` / `roughnessMap` / `aoMap`
  - **零** GLB / 模型 import(task 4–6),**零**程序化家具幾何 —— 家具仍是 `boxGeometry args={[item.w, defaults.height3d, item.h]}`
  - `FURNITURE_DEFAULTS[*].color` 完全未動(`src/lib/venue/furniture.ts` 不在 diff 中);顏色覆寫僅地板 `#f5f5f4 → #e7e5e4` 一處,牆 `#78350f` / 柱 `#78716c` / 家具 `defaults.color` 原樣保留
- [x] D7「絕對不得修改」清單 12 個路徑在 diff 中全部缺席(含 `VenueScene.tsx`、`floorGeometry.ts`、`plan.ts`、`furniture.ts`、`PlanEditor.tsx`、`AiPanel.tsx`、`src/proxy.ts`、`src/lib/ai/**`、`src/lib/supabase/**`)
- [x] 計畫的兩處刻意偏離 drei(不用 `<SoftShadows>` / 自寫 bake 而非 `<BakeShadows>`)皆已在程式碼註解寫明理由,符合 Architecture Notes 的要求

**唯讀不變式(逐項核對,AGENTS.md + orchestrator requirement 7):**

| 不變式 | 結果 |
| --- | --- |
| 不持有幾何 state | ✅ `bounds` 是 `useMemo` 衍生值。兩個 `useState` 分別是 `revision: number`(計數器)與 `diagnostics`(純視覺/測試回報,單向由場景流向 DOM 屬性,不回寫任何幾何),皆非幾何快照。 |
| 無 `TransformControls` | ✅ 未出現。 |
| 不回寫 `onSceneChange` | ✅ `RefinedScene` 未接收也未呼叫。 |
| `AiPanel` 維持 CSS 隱藏、掛載位置不變 | ✅ `AiPanel.tsx` 與 `PlanEditor.tsx` 皆不在 diff 中。 |
| 02/03 互斥掛載 | ✅ `PlanEditor.tsx` 未動;案例 12 以 `canvas` 元素數 === 1 守門。 |
| 家具尺寸唯一來源仍是 `FURNITURE_DEFAULTS` | ✅ `boxGeometry` / `position` / `rotation` 一字未改。 |

**資源釋放(orchestrator requirement 6):**

- 四盞光全部以 JSX 宣告 → R3F 卸載時自動 `light.dispose()`,`DirectionalLight.dispose()` 連帶
  `shadow.dispose()` → `shadow.map.dispose()`。**未**使用 `useMemo` + `<primitive>` 建光源(那樣不會自動 dispose)。
- 共用 `target` 是 `THREE.Object3D`,無 GPU 資源、無 `dispose` 方法,以 `<primitive>` 掛載正確且註解已說明,避免後續 reviewer 誤判為漏 dispose。
- `<Environment frames={1}>` 由 drei 的 `EnvironmentPortal` 自行 `fbo.dispose()` 並還原 `scene.environment`。
- `gl.shadowMap.autoUpdate` 於 cleanup 還原為 `true`(在互斥掛載下屬冗餘保險,但正確)。

**AGENTS.md 變動說明**:`git status` 顯示 `AGENTS.md` 有 4 行新增(步驟 03 唯讀 / 02-03 互斥掛載 /
`AiPanel` 不可 unmount / 家具不可縮放)。經核對 `.claude/pipeline/task-log.md`,這是 **2026-07-26T02:40
的 scan 階段**(delta scan `c7c06c5`,經人工確認)寫入的,**不是**本次 implement 的範圍外改動。
唯一小瑕疵:檔頭的 `Last updated` delta 註記未同步更新,建議下次 scan 補上(不阻擋)。

---

## Conversation Log

| Issue | Developer Response | Resolution |
| --- | --- | --- |
| 🟡 1 `data-floor-receives-shadow` 為字面量,案例 4 恆真 | — (reviewer 直接處理,`RefinedSceneProbe.tsx` / `RefinedScene.tsx` / `PlanEditorPage.ts` / spec 案例 4) | **Fixed** — 探針以 `REFINED_FLOOR_NAME` 找到地板 mesh 回報真實 `receiveShadow`,並新增 `data-floor-casts-shadow` 把 D5 的「地板不投影」也納入斷言 |
| 🟡 2 案例 10 恆真,edge case 無實質保護 | — (reviewer 直接處理,spec 案例 10) | **Fixed** — 補 `far - near >= span + 3` |
| 🟡 3 案例 6 零下載把關過窄、常數命名誤導 | — (reviewer 直接處理,spec) | **Fixed** — `FORBIDDEN_ENV_ASSET_PATTERNS` 涵蓋 4 種樣式,失敗時列出 URL |
| 🟡 4 探針每幀 traverse + stringify 永不停止 | — (reviewer 直接處理,`RefinedSceneProbe.tsx`) | **Fixed** — `PROBE_ACTIVE_FRAMES = 120`,由 `resetKey` 重新武裝 |
| 💡 1–5 | — | **Logged only**,不動作 |

**修正後靜態檢查**:`npx tsc --noEmit` → 0 error;`npm run lint` → 0 error / 0 warning。

---

## Handoff to QA

1. 本次 reviewer 修正動到了 `RefinedSceneProbe.tsx` / `RefinedScene.tsx` / `PlanEditorPage.ts` /
   `venue-refined-lighting.spec.ts` 四個檔案,**QA 與 playwright 階段請以修正後的版本為準**。
   新增的 `data-floor-casts-shadow` 屬性需在 playwright 階段實跑驗證(預期 `"false"`)。
2. **手動視覺檢查表 8 項尚未執行**(計畫 Test Plan「手動」段)—— 這是本任務唯一能驗收
   「展場實景感」與陰影柔邊的途徑,請務必逐項確認並記入 `qa-report.md`,附上案例 14 產出的
   `playwright-report/refined-lighting.png`。
3. 手動檢查表**第 8 項最關鍵**:在 03 停留期間用 AI 面板移動一件家具,確認**陰影跟著移動**。
   這是 D6(`autoUpdate=false` + revision 重烘焙)與 D2(`updateProjectionMatrix`)唯一的端到端驗證 ——
   自動化測試只覆蓋了「進入 03 當下」的狀態,涵蓋不到「停留期間場景變動」。
4. 必須記入 QA 報告的已知取捨(計畫 D2 要求):固定 2048 解析度下,預設 10m 地板約
   **1.1cm/texel**,200m 滿版場地約 **14cm/texel** —— 極大場地的陰影邊緣偏鈍是設計取捨,非 bug。
5. 步驟 13 所列 9 支既有 spec 需在 playwright 階段全綠且零改動。
</content>
