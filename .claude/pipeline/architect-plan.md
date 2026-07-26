# Architect Plan — 步驟 03 打光與陰影

> Story: 精密 3D 場景 (步驟 03) | Task type: FRONTEND | Generated: 2026-07-26T08:05+08:00

## Overview

把步驟 03 的 `RefinedScene` 從「`ambientLight` + 單一 `directionalLight` + 無陰影」升級為固定 4 盞光的**展場天花板燈組**(1 hemisphere + 3 directional,其中**只有 1 盞投影**)、PCF soft shadow(2048)、顯式 ACESFilmic tone mapping + 曝光補償,以及**零下載的程序化 `<Environment>` IBL**(drei `Lightformer` 虛擬場景,非 HDRI)。陰影視錐**依實際場地 AABB 動態貼合**而非固定或依 200m plan area,以同時支撐極小與極大場地。步驟 02 的 `VenueScene.tsx` **一行都不改**。

---

## Task Type Confirmed

FRONTEND — 純前端渲染設定,無 API / DB schema / auth 變更。與 orchestrator-output.md 一致,技術分析無矛盾。

## Escalation Check

- 外部 API contract:無變更。
- DB schema / 既有資料:無(打光不進 `PlanSnapshot`,不持久化)。
- Auth / security model:未觸及。
- 新增外部資產下載:**經 D4 決策後為零**(不下載 HDRI、不打 CDN),因此不觸發「新增第三方資源」需人工核准的情境。
- 複雜度:2 個新元件檔 + 1 個新純函式檔 + 1 支既有元件改動 + 測試,與 story task 顆粒度相符。
- 資訊充分性:足夠。orchestrator 未定案的第 4 點(IBL 方案)明文授權「由 architect 定案並說明取捨」,見 D4。
- **結論:不需 escalation。**

---

## 事前查證(不得依記憶假設,以下皆為 node_modules 逐行核對)

| 事實 | 出處 | 對本計畫的影響 |
| --- | --- | --- |
| R3F v9 `Canvas` **預設就已** `gl.outputColorSpace = SRGBColorSpace`、`gl.toneMapping = ACESFilmicToneMapping` | `@react-three/fiber/dist/events-b389eeca.esm.js:15789-15792` | 步驟 02 其實已在 ACES 下;本任務的真正工作是**顯式化 + 調曝光 + 調材質明度**,不是「第一次開啟 tone mapping」。計畫不得宣稱「02 沒有 tone mapping」 |
| 該段包在 `if (!configured)`,只在 root 第一次 configure 時執行;`applyProps(gl, glConfig)` 在其**之後**執行 | 同檔 `:15790`、`:15806` | 傳 `gl={{ toneMapping, toneMappingExposure }}` **會生效且會覆蓋預設**,不需 `onCreated` hack |
| `Canvas shadows` 對應表:`true`/`'soft'` → `PCFSoftShadowMap`、`'percentage'` → `PCFShadowMap`、`'basic'` → `BasicShadowMap`、`'variance'` → `VSMShadowMap` | 同檔 `:15767-15781` | 用 `shadows="soft"` 拿到 orchestrator 指定的 PCF soft |
| drei `<Environment preset=...>` / `files=...` 走 `useEnvironment`,**HDRI 從 `https://raw.githack.com/pmndrs/drei-assets/<sha>/hdri/` 下載** | `@react-three/drei/core/useEnvironment.js:8` | preset 是**執行期第三方 CDN 依賴**,不是本地資產 → D4 否決 |
| drei `<Environment>` 帶 `children` 時走 `EnvironmentPortal`:建 `WebGLCubeRenderTarget(resolution)`、`frames===1` 時在 `useLayoutEffect` 內用 `cubeCamera.update()` 渲染**一次**;`useEffect` cleanup `fbo.dispose()`;`setEnvProps` 回傳的 cleanup 會**還原** `scene.environment` / `background` | `@react-three/drei/core/Environment.js`(`EnvironmentPortal`、`setEnvProps`) | 程序化 IBL 可行、單次成本、**自帶 dispose 與還原** → 符合 AGENTS.md 資源釋放規則 |
| `EnvironmentPortal` 的 `useLayoutEffect` 依賴含 `children`(JSX 每次 render 皆新識別) | 同檔 | 每次 RefinedScene re-render 會重跑一次 cube render → **resolution 必須壓低**(採 128),否則 AI 改動場景時會反覆付出成本 |
| drei `<SoftShadows>` 是 PCSS:**全域改寫 `THREE.ShaderChunk.shadowmap_pars_fragment`**,並在 mount/unmount 時 traverse 場景 `material.dispose()` + `gl.compile()` 重編譯 | `@react-three/drei/core/SoftShadows.js`(`pcss()` / `reset()`) | 全域副作用 + 重編譯 + 每 fragment `samples×2` 次貼圖取樣 → D1 否決 |
| drei `<AccumulativeShadows>` 需 `scale` 的**方形 plane** 與多幀累積(`RandomizedLight`) | `@react-three/drei/core/AccumulativeShadows.d.ts` | 只服務「單一物件放在原點地面」的攝影棚情境,無法吃任意凹多邊形 200m 地板 → D1 否決 |
| `three` r185:`LightShadow.updateMatrices()` **不會**呼叫 `shadowCamera.updateProjectionMatrix()`;`WebGLShadowMap` 只在 `shadow.map === null \|\| typeChanged` 時呼叫一次 | `three/src/lights/LightShadow.js`、`three/src/renderers/webgl/WebGLShadowMap.js:203,277` | **改了 `shadow.camera.left/right/top/bottom/near/far` 後必須自己呼叫 `updateProjectionMatrix()`**,否則場地尺寸變更(AI `resize_floor`)時陰影視錐不更新 → S4 明列 |
| `LightShadow.updateMatrices` 用 `light.target.matrixWorld` 決定方向;`DirectionalLight` 預設 target 是**未加入場景**的 Object3D(matrixWorld 恆為 identity → 原點) | `three/src/lights/LightShadow.js` | 地板通常落在 (20,20)–(30,30),原點是角落不是中心 → **必須自建 target 並掛進場景**,否則光向與陰影視錐全錯 → S3 |
| `DirectionalLight.dispose()` → `super.dispose()` + `this.shadow.dispose()`;`LightShadow.dispose()` → `this.map.dispose()` / `this.mapPass.dispose()` | `three/src/lights/DirectionalLight.js:81-85`、`LightShadow.js` | **以 JSX 建立的光源,R3F 卸載時會自動 dispose,shadow map 一併釋放** → 不要改用 `<primitive>` 建光源(primitive 不自動 dispose) |
| `LightShadow` 預設 `bias = 0`、`normalBias = 0`、`mapSize = 512×512` | `three/src/lights/LightShadow.js:53,74,104` | 2048 與 bias 都必須顯式設定 |
| drei `<BakeShadows>` = `gl.shadowMap.autoUpdate = false; needsUpdate = true`,cleanup 還原 | `@react-three/drei/core/BakeShadows.js` | 概念正確但**無法在場景變動時重新烘焙**(AI 可在 03 停留時改場景)→ D6 採自寫版本 |

---

## 架構決策

### D1 — 光組定案:1 hemisphere + 3 directional,固定 4 盞,**只有 1 盞 `castShadow`**

**採用配置(全部為固定數量,與物件數完全無關 → 直接滿足「打光成本不隨物件數線性惡化」):**

| # | 光源 | 角色 | 色 | 強度 | castShadow |
| --- | --- | --- | --- | --- | --- |
| L1 | `hemisphereLight` | 天花板漫射 / 地面反彈,消滅暗部死黑 | sky `#e6ecf7` / ground `#8a837c` | 0.45 | ✗ |
| L2 | `directionalLight` | **主光**(展場主燈排,冷白 ~5600K),唯一產生可辨識落地陰影者 | `#f4f7ff` | 2.4 | **✓** |
| L3 | `directionalLight` | 補光(對側燈排,較低仰角),填暗面 | `#e8eefc` | 0.8 | ✗ |
| L4 | `directionalLight` | 逆光/輪廓光(鹵素暖色 ~3200K),讓白模物件與地板分離 | `#ffeedd` | 0.5 | ✗ |
| — | `<Environment>` IBL | 環境反射 + 漫射環境光(D4) | 程序化 | `environmentIntensity` 0.35 | — |

方向以「單位方向向量 × 距離」表示,光源座標 = `場景中心 + dir × D`(即光從 `center + dir*D` 照向 `center`):

- `KEY_DIR = normalize(-0.5, 1.0, 0.5)`(仰角約 55°,主光。仰角刻意不做高過 70°,否則陰影短到看不出來;也不低於 40°,否則 200m 場地陰影拖太長會超出視錐)
- `FILL_DIR = normalize(0.7, 0.6, -0.6)`(對側、較低)
- `RIM_DIR = normalize(-0.8, 0.35, -0.8)`(低角度、來自預設相機的**反方向**。預設相機在 `[fit*0.7, fit*0.9, fit*0.7]` 看向 `[fit/2, 0, fit/2]`,即位於 +x/+z 上方,故逆光取 −x/−z)
- `D = max(bounds.radiusM * 2, 20)`

**為何只有 1 盞投影(這是本任務最重要的效能決策)**:每盞 `castShadow` 光源 = 每次 shadow map 更新時多一整趟場景 render pass。展場實務上天花板燈排確實很多,但視覺上**多方向硬投影會產生交錯的多重影子,室內反而更假**;真實展場的觀感是「一個主導方向的落地影 + 大量漫射補光」。因此:方向性交給 L2 獨佔,「很多盞燈」的觀感交給 L1 + L3 + L4 + IBL 的**無成本**漫射疊加。

**被否決的替代方案:**

1. **多盞 `spotLight` 模擬每盞天花板投射燈** — 否決。每盞需自己的 perspective shadow camera 與 render pass;要覆蓋 200m 場地需要數十盞,成本隨場地面積成長,直接違反效能約束。且 spot 的衰減半徑要隨場地縮放,又是一組要調的參數。
2. **drei `<SoftShadows>`(PCSS)** — 否決。(a) 它**全域改寫 `THREE.ShaderChunk`**,是跨 renderer 的 process 級副作用,和「02/03 互斥掛載、彼此不影響」的架構原則相牴觸;(b) mount/unmount 時 traverse 整個場景 `material.dispose()` + `gl.compile()`,進入 03 會有明顯一次性卡頓,正是驗收條件禁止的;(c) contact-hardening 遠超 orchestrator 指定的「中等品質 PCF」。
3. **drei `<AccumulativeShadows>` + `<RandomizedLight>`** — 否決。它自己產生一塊**方形 plane** 承接累積影,無法對應我們的任意凹多邊形地板(會與 `useFloorGeometry` 的地板 z-fighting,且形狀不符);且需累積數十幀才收斂,場景一變就要重來,與「AI 可在 03 停留時改場景」衝突。
4. **drei `<ContactShadows>`** — 否決。它是每幀把場景壓成一張深度圖貼在矩形 plane 上,只有「物件正下方的接觸陰影」,**沒有方向性落地陰影**,不滿足 AC2。
5. **drei `<Stage>`** — 否決。`Stage` 會 `adjustCamera` 接管相機並 `<Center>` 置中內容,會破壞 03 既有的相機取景與世界座標(場地座標必須與 02 一致)。
6. **維持 `ambientLight` 只調強度** — 否決。`ambientLight` 全向等量,物件所有面同亮 = 白模觀感的根源;`hemisphereLight` 以近乎相同成本提供上下差異,是嚴格的免費升級。

### D2 — 陰影視錐:**依實際場地內容 AABB 動態貼合**(本任務第二重要的決策)

`PLAN_AREA_SIZE_M = 200` 是**可規劃上限**,不是實際場地大小;`DEFAULT_FLOOR` 只有 10m×10m。固定視錐兩頭都輸:以 200m 開,預設場地的 2048 map 只有約 `200/2048 ≈ 10cm/texel`,陰影糊成塊;以 50m 開,200m 場地邊緣直接沒有陰影。

**定案做法**:新增純函式 `planBoundsM(polygon, walls, columns, furniture)`(`src/lib/venue/bounds.ts`,不 import Three),回傳整個場地內容的 AABB 與其外接圓半徑:

- 地板:所有 `polygon` 頂點。
- 牆:`start` / `end` 兩端點各外擴 `WALL_THICKNESS_M / 2`。
- 柱 / 家具:以 `center` 為心、**外接圓半徑 `hypot(w, h) / 2`** 外擴 — 用外接圓而非 `w/2`、`h/2`,如此 `rotationDeg` 為任意角度時都不會漏算(家具可旋轉,AABB 不能只看未旋轉footprint)。
- **必須把牆/柱/家具一起納入**,不能只取地板:`clampColumnCenter` 是 clamp 到 `venueSizeM`(03 傳入 200)而非 clamp 到地板多邊形,物件**可以合法地站在地板之外**;只取地板 AABB 會讓這些物件的陰影被裁掉。
- 回傳 `{ minX, maxX, minY, maxY, centerX, centerY, radiusM }`,其中 `radiusM = 0.5 * hypot(maxX-minX, maxY-minY)`(半對角線 → 主光方位角任意都涵蓋)。
- 退化保護:所有值先過 `Number.isFinite`;`radiusM = Math.max(radiusM, MIN_SHADOW_RADIUS_M = 2)`,避免單點/空集合造成 0 寬視錐與 NaN 投影矩陣。

**視錐參數**(`R = bounds.radiusM + SHADOW_MARGIN_M`,`SHADOW_MARGIN_M = 4`):

- `left/bottom = -R`,`right/top = +R`
- `near = max(0.5, D - R - MAX_OBJECT_HEIGHT_M - 2)`、`far = D + R + 2`,其中 `MAX_OBJECT_HEIGHT_M = max(WALL_HEIGHT_M=3, 所有 FURNITURE_DEFAULTS.height3d 的最大值=2.0) = 3`
- 邊界為何是 4m:主光仰角 55°,3m 高的牆投出的影子長度約 `3 / tan(55°) ≈ 2.1m`,4m 有充足餘裕 → 直接對應 edge case「高瘦物件(bannerStand 2.0m / cabinet 1.8m)陰影不可被 near/far 截斷」。
- **設定後必須顯式呼叫 `keyLight.shadow.camera.updateProjectionMatrix()`**(見事前查證表:three r185 只在 shadow map 首次配置時自動呼叫一次)。這是 AI `resize_floor` 在 03 停留時仍能正確更新陰影的關鍵。

**取捨(必須寫進 PR 與 QA 報告)**:2048 固定解析度下,texel 的世界尺寸 = `2R / 2048`。預設 10m 地板 → `R≈11`,約 **1.1cm/texel**(非常銳利);200m 滿版場地 → `R≈145`,約 **14cm/texel**(陰影邊緣偏鈍但仍連續、不破碎)。這是「解析度鎖 2048」(orchestrator 已定案)下的必然結果,以貼合視錐把常見情境(小場地)的精度最大化,是唯一合理解。

**被否決的替代方案:**

1. **固定視錐(如 ±50m)** — 否決。200m 場地邊緣完全沒有陰影(AC2 失效);10m 場地浪費 5 倍解析度。
2. **以 `venueSizeM`(=200)開視錐** — 否決。等同永遠用最壞情況,預設場地陰影糊成 10cm 方塊,直接違反 AC3「不糊成方塊」。
3. **CSM(cascaded shadow maps,three-stdlib `CSM`)** — 否決。N 個 cascade = N 倍 shadow pass 與 N 張 map,且需每幀跟隨相機更新;03 是俯視、靜態、單一場景,拿不到 CSM 的好處(CSM 解決的是第一人稱視角下近景遠景同時要銳利),成本卻是全額。
4. **依場地大小調整 shadow map 解析度(小場地 1024、大場地 4096)** — 否決。orchestrator 已把 2048 定案並明文禁止 4096/1024;且會讓 AC3「解析度為 2048」變成不可斷言。
5. **只取地板多邊形 AABB(不含物件)** — 否決,理由如上(物件可合法站在地板外)。

### D3 — Tone mapping / color space / 材質明度補償

**現況更正**:R3F v9 的 `Canvas` **預設已經**是 ACESFilmic + sRGB(逐行查證,見上表),步驟 02 也在此設定下。因此本任務不是「開啟 tone mapping」,而是:

1. **顯式化**:`<Canvas gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: REFINED_EXPOSURE }} ...>`。`gl` 物件必須**提升為模組層級常數**(不可在 render 內建立字面量),避免 `applyProps` 每次 re-render 重跑。顯式化的目的是讓意圖對 reviewer 可見、且曝光成為可調旋鈕。
2. **曝光補償**:`REFINED_EXPOSURE = 1.1`。理由:光量從「ambient 0.6 + dir 0.8」變成「hemi 0.45 + dir 2.4/0.8/0.5 + env 0.35」,ACES 的 shoulder 會把亮部壓縮,1.1 把中間調拉回原本的體感亮度而不使高光切平。
3. **材質明度補償 — 只改一處,且只在 03 生效**:

   | 表面 | 02 的值 | 03 的值 | 理由 |
   | --- | --- | --- | --- |
   | 地板 | `#f5f5f4`(albedo≈0.96) | **`#e7e5e4`**(≈0.90) | 0.96 albedo 在新光量下高光會 clip 到純白,**陰影對比會被壓掉** —— 而「陰影看得見」正是 AC2/AC3。降 6% 換回陰影可讀性 |
   | 牆 `#78350f` / 柱 `#78716c` / 家具 `FURNITURE_DEFAULTS[kind].color` | — | **完全不改** | 皆為中間調,在 ACES 下反而更有層次;且顏色一動就會與 2D 編輯器、步驟 02 不一致 |

   **硬性約束**:**不得修改 `src/lib/venue/furniture.ts` 的 `FURNITURE_DEFAULTS[*].color`**,也不得修改 `plan.ts`。那些值同時被 2D Konva 編輯器與步驟 02 使用,一改就同時破壞 AC5(02 維持現況)與步驟 01。03 專屬的顏色一律放在新檔 `refinedLighting.tsx` 的 `REFINED_SURFACE` 常數(目前只有地板一筆),這也是 task 3(PBR)接手的掛載點。

4. **材質 roughness / metalness 純量**(範圍判斷,見 Architecture Notes):地板 `roughness 0.55 / metalness 0`、牆 `0.85 / 0`、柱 `0.7 / 0.05`、家具 `0.6 / 0`。`meshStandardMaterial` 預設 `roughness = 1、metalness = 0`,在 `roughness = 1` 下環境貼圖幾乎不產生任何可見的鏡面反射 —— **不設這幾個純量,requirement 4「讓金屬/粗糙度有東西可反射」在字面上就不成立**。純量參數屬於「光照反應」而非「材質貼圖」,貼圖(map / normalMap / roughnessMap / aoMap)明確留給 task 3。

**被否決**:`flat`(關閉 tone mapping)—— 否決,多光源疊加必然過曝死白,直接違反 AC4。**被否決**:`linear`(關閉 sRGB 輸出)—— 否決,會讓所有顏色變暗且與 02 不一致。**被否決**:`THREE.AgXToneMapping` / `NeutralToneMapping`(r185 有提供)—— 否決,orchestrator 點名 ACESFilmic,且 AgX 更去飽和,白模場景會更死氣沉沉。

### D4 — 環境光 / IBL:**程序化 `<Environment>` + `<Lightformer>`,零下載**(orchestrator 授權 architect 定案)

**定案:採程序化方案。**

```
<Environment frames={1} resolution={128} background={false} environmentIntensity={0.35}>
   ...5 個 <Lightformer>(見 S5)
</Environment>
```

**取捨明列:**

| 方案 | 下載量 | 授權 | 執行期依賴 | 錯誤狀態 | 品質 | 結論 |
| --- | --- | --- | --- | --- | --- | --- |
| A. `<Environment preset="warehouse">` | 每張 HDRI 約 1–4MB,**執行期從 `raw.githack.com` 抓**(`useEnvironment.js:8`) | drei-assets 多為 Poly Haven CC0,但我們是**熱連 githack**,不是自行托管,授權鏈不在我們掌控 | 第三方 CDN,離線/被牆即失效 | 必須做載入失敗降級 + 載入指示 | 最好 | **否決** |
| B. 自行托管 Poly Haven CC0 HDRI(1k) | 進版控約 1–2MB(.hdr) | CC0 ✓(合規) | 自家 static asset | 仍需載入指示與失敗降級 | 好 | **否決** |
| C. **程序化 `<Environment>` + `Lightformer`** | **0** | 不適用 | **無** | **不存在**(不可能載入失敗) | 白模/低金屬度場景下足夠 | **採用** |

否決 A 的關鍵理由:那不是「本地資產」,是**執行期第三方 CDN 依賴**,出現在一個需登入的頁面上;離線或 githack 掛掉就是白畫面或降級路徑,為了一張 128px 就夠用的環境貼圖不值得。
否決 B 的關鍵理由:story 已規劃 task 3(PBR 貼圖)約 3–4MB、task 4(6 個 GLB)約 3–4MB。在**目前這個仍是白模、`metalness` 幾乎全 0** 的階段先花 1–2MB 買一張 HDRI,是把下載預算用在邊際效益最低的地方。orchestrator 第 30 行明文:「若會顯著增加下載量,優先採用程序化/內建的環境光方案」。
否決「完全不用 environment」:requirement 4 明確要求,且沒有 env 時 `meshStandardMaterial` 的鏡面項只剩三盞 directional 的高光點,金屬/粗糙度調整幾乎沒有視覺回饋。

**方案 C 的資源生命週期(已逐行查證,直接滿足 AGENTS.md dispose 規則)**:`EnvironmentPortal` 以 `useMemo` 建 `WebGLCubeRenderTarget(128)`、`useEffect` cleanup `fbo.dispose()`;`setEnvProps` 的 cleanup 會把 `scene.environment` / `background` / `environmentIntensity` **還原為原值**。`frames={1}` 使 `useFrame` 內的 `count < frames` 恆為 false → **不會每幀重渲染**。

**已知小瑕疵(必須知情)**:`EnvironmentPortal` 的 `useLayoutEffect` 依賴陣列含 `children`,JSX children 每次 render 都是新識別 → RefinedScene 每次 re-render 會重跑一次 128px cube 渲染。這正是 **resolution 取 128 而非 256/512** 的理由(cube 渲染成本 ∝ 面積,128 比 256 便宜 4 倍)。不做額外 workaround(memo 化 children 需要繞過 drei 的 API 形狀,得不償失)。

### D5 — 陰影 acne / peter-panning:以 `normalBias` 為主、`bias` 為輔,並讓地板**不投影**

- `shadow.normalBias = 0.03`(公尺)、`shadow.bias = -0.0005`。
- **為何以 `normalBias` 為主**:`bias` 是深度空間偏移,其「消 acne 所需量」與 shadow map texel 的世界尺寸成正比;而本計畫的視錐是動態的(1.1cm/texel ↔ 14cm/texel,差 13 倍)。一個在 10m 場地剛好的 `bias`,到 200m 場地就完全不夠(acne);反之則嚴重 peter-panning。`normalBias` 沿法線方向以**世界單位**位移取樣點,對視錐尺度不敏感,是唯一在兩個極端都成立的旋鈕。0.03m = 3cm,遠小於最小家具尺寸(chair 0.45m)與牆厚(0.2m),不會造成肉眼可見的影子脫離。
- **地板 `castShadow={false}`,只 `receiveShadow`**。地板材質是 `side={THREE.DoubleSide}`,three 會令其 `shadowSide` 亦為 `DoubleSide` → 地板自己會把自己寫進 shadow map,是本場景**唯一真正會產生 acne 的表面**。地板本來就不需要投影(它是最底層),關掉即根除。
- 牆 / 柱 / 家具:`castShadow` + `receiveShadow` 皆開。都是封閉 box、`side` 為預設 `FrontSide` → three 的 `shadowSide` 自動取 `BackSide`,背面寫深度,結構上就幾乎沒有 acne。`receiveShadow` 一併開啟是為了 edge case「家具緊貼牆面」:唯有牆面也接收陰影,貼牆家具的接觸陰影才會出現在牆上,否則會出現「家具浮在牆前」的錯覺 —— 這比 peter-panning 更明顯。
- **驗證方式**:S12 手動檢查表列出「把 cabinet 拖到緊貼一面牆」的具體視覺檢查點(接觸線無亮縫、牆面無條紋雜訊)。若實作後出現殘留 acne,調整順序是**先加大 `normalBias` 到 0.05,再考慮 `bias`**,不得反過來。

### D6 — 效能:陰影**只在場景變動時重烘焙**(`shadowMap.autoUpdate = false`)

03 是唯讀場景:光源靜止、幾何靜止,使用者只轉相機。方向光的 shadow map **與相機無關**,每幀重跑 shadow pass 是純浪費。

定案:mount 時 `gl.shadowMap.autoUpdate = false`,並在 `useLayoutEffect(deps = [polygon, walls, columns, furniture, bounds])` 內 `gl.shadowMap.needsUpdate = true`;cleanup 還原 `autoUpdate = true`。首幀因為 layout effect 先於首次 render 執行,`needsUpdate` 已為 true → 正常烘焙一次。

效果:OrbitControls 旋轉時 shadow pass 次數從「每幀 1 次」降為 **0 次** → 直接對應 AC「數十件家具下仍可流暢旋轉」。

**不直接用 drei `<BakeShadows>`** 的理由:它的 effect 依賴只有 `gl.shadowMap`,場景變動時**不會**重新烘焙。而 03 停留期間場景**可以**變(AI tool call 經 `applyActions` → `PlanEditor` 頂層 state → 03 的 props),陰影會停在舊狀態。自寫版本(約 8 行)才能綁對依賴。此偏離記於 Architecture Notes。

### D7 — 檔案切分與「絕對不能碰」清單

- 光組是 03 專屬,**放在只有 03 會 import 的新檔**。嚴禁做成 `VenueScene` / `RefinedScene` 共用的 `<SceneLighting>` —— 那會讓「02 打光維持現況」變成一個隨時可能被誤改的約定,而不是結構保證。
- 純幾何(AABB)計算不 import Three → 依 AGENTS.md 分層放 `src/lib/venue/bounds.ts`。光組元件與探針元件 import Three → 放 `src/components/venue/`。

**本任務絕對不得修改的檔案**(reviewer 檢查點,diff 內出現即為 🔴):
`src/components/venue/VenueScene.tsx`、`src/components/venue/floorGeometry.ts`、`src/lib/venue/plan.ts`、`src/lib/venue/furniture.ts`、`src/components/venue/PlanEditor.tsx`、`src/components/venue/RefinedSceneLoader.tsx`、`src/components/venue/AiPanel.tsx`、`src/app/**`、`src/proxy.ts`、`src/lib/ai/**`、`src/lib/supabase/**`。

### D8 — 如何讓 Playwright 真的能斷言「陰影開著」:場景內探針元件

3D `<canvas>` 對 Playwright 不透明(既有 spec 檔頭已立此慣例)。**但我們可以讓場景把 renderer 的真實狀態報出來**。

新增 `<RefinedSceneProbe onReport={...}/>`(掛在 `<Canvas>` 內),透過 `useThree` 取 `gl` / `scene`,在**第 2 幀**(`useFrame` + 計數 ref)traverse 一次場景,回報診斷物件;`RefinedScene` 以 `useState` 收下並攤成根 div 的 `data-*`。

**關鍵設計:回報的一律是 renderer/scene 的實際值,不是原始碼裡的字面量。** 特別是:

- `data-shadow-map-allocated-width` 讀的是 **`keyLight.shadow.map?.width`**(不是 `mapSize.width`)。`shadow.map` 這個 `WebGLRenderTarget` **只可能由 `WebGLShadowMap.render()` 配置出來**(`WebGLShadowMap.js:203-255`)。因此這個屬性一旦是 `"2048"`,就同時證明了:shadow map 已啟用、這盞光確實被納入 shadow pass、且實際配置的解析度是 2048(低階 GPU 若被 `maxTextureSize` 夾小,這裡會誠實地顯示較小值)。這是本專案在不讀像素的前提下,對「陰影真的在跑」最強的機器可驗證證據。
- `data-shadow-camera-span-m` 讀的是 `keyLight.shadow.camera.right - left`,四捨五入到整數 → 直接斷言 D2 的動態視錐確實隨場地大小改變。

**防迴圈**:探針把診斷物件 `JSON.stringify` 後與 ref 中的前值比對,相同就不呼叫 `onReport`,避免 `useFrame` 內 setState 造成無限 re-render。props 變動時經 `useLayoutEffect` 重置幀計數 ref 以觸發重新回報。

**被否決的驗證方式:**

1. **像素比對 / `toHaveScreenshot()` 黃金圖** — 否決。本專案 Playwright 跑在真實 dev server + 開發者本機 GPU,WebGL 輸出跨機器/驅動不可能逐像素一致,黃金圖必然 flaky;且既有全部 spec 都明文避開畫布像素。
2. **`gl.readPixels` / `canvas.toDataURL()` 自行算亮度** — 否決。需要在**正式程式碼**開 `preserveDrawingBuffer: true`(等於為了測試永久犧牲效能),而且沒有 PNG decoder 在測試相依內。
3. **只在原始碼層面 grep 斷言** — 否決。那證明不了執行期真的生效(例如 `shadows` prop 打錯字仍會 grep 到)。

**視覺品質**(「像不像展場」)無法自動化,以 S12 的手動檢查表 + Playwright 產出的**非斷言截圖產物**交付人工判讀。

---

## Files to Create

| File path | Purpose |
| --- | --- |
| `src/lib/venue/bounds.ts` | 純函式 `planBoundsM(polygon, walls, columns, furniture)` + `MIN_SHADOW_RADIUS_M`。無 React / DOM / Three import(AGENTS.md 分層) |
| `src/components/venue/refinedLighting.tsx` | `<HallLighting>` 光組元件(D1)+ 陰影視錐設定與 `updateProjectionMatrix`(D2)+ shadow 烘焙控制(D6)+ `<HallEnvironment>` 程序化 IBL(D4)+ `REFINED_SURFACE` / `REFINED_GL` 常數(D3)。**只被 `RefinedScene.tsx` import** |
| `src/components/venue/RefinedSceneProbe.tsx` | `<RefinedSceneProbe>` 場景診斷探針 + `RefinedDiagnostics` 型別(D8) |
| `playwright-tests/venue-refined-lighting.spec.ts` | 本任務驗收 spec |

## Files to Modify

| File path | What changes |
| --- | --- |
| `src/components/venue/RefinedScene.tsx` | `<Canvas>` 加 `shadows="soft"` + `gl={REFINED_GL}`;移除現有兩行 `ambientLight`/`directionalLight`,改掛 `<HallLighting>` + `<HallEnvironment>` + `<RefinedSceneProbe>`;地板改用 `REFINED_SURFACE.floor` 顏色並加 `receiveShadow`(不加 castShadow);牆/柱/家具 mesh 加 `castShadow receiveShadow` 與 roughness/metalness;根 div 增加診斷 `data-*` |
| `playwright-tests/pages/PlanEditorPage.ts` | 新增 03 打光相關的 `data-*` getter(見 S11),不動既有 locator |

**不修改**:見 D7 的「絕對不得修改」清單。

---

## Implementation Steps

> 每一步都必須可獨立完成且不留半成品。步驟 1–2 是純新增(不影響任何既有行為),步驟 3–8 才動 `RefinedScene.tsx`。

### 1. 建立 `src/lib/venue/bounds.ts`(純領域,零 Three)

匯出:

- `export const MIN_SHADOW_RADIUS_M = 2;`
- `export interface PlanBounds { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number; radiusM: number; }`
- `export function planBoundsM(polygon: FloorPolygon, walls: WallSegment[], columns: Column[], furniture: FurnitureItem[]): PlanBounds`

實作要點:
- 以 `polygon` 各頂點初始化 min/max(polygon 保證 ≥3 頂點,`MIN_FLOOR_VERTICES`)。
- 牆:對 `start` / `end` 各以 `WALL_THICKNESS_M / 2` 外擴。
- 柱與家具:以 `center` 為心、`Math.hypot(w, h) / 2`(外接圓)外擴 —— **不可**用 `w/2`、`h/2`,家具 `rotationDeg` 可為任意角度。
- 每個輸入座標先過 `Number.isFinite` 檢查,非有限值一律跳過該筆(不得讓 NaN 汙染 min/max)。
- `centerX/centerY` 取 AABB 中心;`radiusM = Math.max(MIN_SHADOW_RADIUS_M, 0.5 * Math.hypot(maxX - minX, maxY - minY))`。
- **此檔不得 import React / three / 任何 component 層模組**;只 import `./plan` 與 `./furniture` 的型別與常數。

### 2. 建立 `src/components/venue/refinedLighting.tsx`(`"use client"`)

#### 2a. 模組層級常數(全部具名匯出,便於 review 與後續調整)

```
REFINED_EXPOSURE = 1.1
REFINED_GL = { toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: REFINED_EXPOSURE }   // 模組層級單例,不可在 render 內建立
SHADOW_MAP_SIZE = 2048
SHADOW_BIAS = -0.0005
SHADOW_NORMAL_BIAS = 0.03
SHADOW_MARGIN_M = 4
MAX_OBJECT_HEIGHT_M = 3          // = WALL_HEIGHT_M(3) > 最高家具 bannerStand(2.0)
ENV_RESOLUTION = 128
ENV_INTENSITY = 0.35
HEMI_SKY = "#e6ecf7"  HEMI_GROUND = "#8a837c"  HEMI_INTENSITY = 0.45
KEY_COLOR = "#f4f7ff"   KEY_INTENSITY = 2.4    KEY_DIR  = normalize(-0.5, 1.0, 0.5)
FILL_COLOR = "#e8eefc"  FILL_INTENSITY = 0.8   FILL_DIR = normalize(0.7, 0.6, -0.6)
RIM_COLOR = "#ffeedd"   RIM_INTENSITY = 0.5    RIM_DIR  = normalize(-0.8, 0.35, -0.8)
REFINED_SURFACE = {
  floor:     { color: "#e7e5e4", roughness: 0.55, metalness: 0 },   // 03 專屬,見 D3
  wall:      { roughness: 0.85, metalness: 0 },                     // 顏色沿用 02 的 #78350f
  column:    { roughness: 0.7,  metalness: 0.05 },                  // 顏色沿用 02 的 #78716c
  furniture: { roughness: 0.6,  metalness: 0 },                     // 顏色沿用 FURNITURE_DEFAULTS
}
```

`KEY_DIR` 等三個方向向量以 `new THREE.Vector3(...).normalize()` 在**模組層級**建立一次(常數,不隨 render 重建)。

#### 2b. `<HallLighting bounds={...} revision={...} />`

Props:`bounds: PlanBounds`(由 `RefinedScene` 以 `useMemo` 算好傳入)、`revision: number`(用於觸發陰影重烘焙,見 2d)。

結構(**光源一律用 JSX 宣告**,如此 R3F 卸載時會自動呼叫 `light.dispose()` → `shadow.dispose()` → `shadow.map.dispose()`;**不得**改用 `useMemo` + `<primitive>` 建光源,那樣 R3F 不會自動 dispose):

1. `const target = useMemo(() => new THREE.Object3D(), [])` —— 三盞方向光**共用**的照射目標。
2. `<primitive object={target} position={[bounds.centerX, 0, bounds.centerY]} />` —— **必須掛進場景**,否則 `target.matrixWorld` 恆為 identity,`LightShadow.updateMatrices` 會把方向算成「照向世界原點」,而地板通常在 (20,20)–(30,30)(見事前查證表)。`THREE.Object3D` 無 GPU 資源,不需 dispose(此點請在程式碼註解寫明,避免 reviewer 誤判為漏 dispose)。
3. `<hemisphereLight args={[HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY]} />`。
4. 主光:
   ```
   <directionalLight
     ref={keyRef}
     color={KEY_COLOR} intensity={KEY_INTENSITY}
     position={[cx + KEY_DIR.x*D, KEY_DIR.y*D, cy + KEY_DIR.z*D]}
     target={target}
     castShadow
     shadow-mapSize-width={SHADOW_MAP_SIZE} shadow-mapSize-height={SHADOW_MAP_SIZE}
     shadow-bias={SHADOW_BIAS} shadow-normalBias={SHADOW_NORMAL_BIAS}
   />
   ```
   其中 `D = Math.max(bounds.radiusM * 2, 20)`。
5. 補光 / 逆光:同樣傳 `target={target}`,**不加 `castShadow`**,不設任何 shadow-* prop。

#### 2c. 陰影視錐 `useLayoutEffect`(deps: `[bounds]`)

```
const cam = keyRef.current.shadow.camera;      // OrthographicCamera
const R = bounds.radiusM + SHADOW_MARGIN_M;
const D = Math.max(bounds.radiusM * 2, 20);
cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
cam.near = Math.max(0.5, D - R - MAX_OBJECT_HEIGHT_M - 2);
cam.far  = D + R + 2;
cam.updateProjectionMatrix();                  // ← 缺這行,場地尺寸變更後陰影視錐不會更新(見事前查證表)
keyRef.current.target.updateMatrixWorld();
```

#### 2d. 陰影烘焙控制(D6)

- `useEffect(() => { gl.shadowMap.autoUpdate = false; return () => { gl.shadowMap.autoUpdate = true; }; }, [gl])`
- `useLayoutEffect(() => { gl.shadowMap.needsUpdate = true; }, [gl, bounds, revision])`

`revision` 由 `RefinedScene` 提供,值為 `walls.length + columns.length + furniture.length + polygon.length` **不足以**偵測「數量不變但位置改變」(例如 AI `move_item`)。因此 `revision` 改以**props 識別**驅動:`RefinedScene` 用 `useRef` 計數器,在 `useLayoutEffect(deps=[polygon, walls, columns, furniture])` 內遞增。頂層 state 每次更新都會產生新陣列識別(`PlanEditor.handleSceneChange` 一律 `.map()` 產生新陣列),故此法可靠。

#### 2e. `<HallEnvironment />`(D4)

```
<Environment frames={1} resolution={ENV_RESOLUTION} background={false} environmentIntensity={ENV_INTENSITY}>
  {/* 天花板兩條主燈排 */}
  <Lightformer form="rect" intensity={2}   color="#ffffff" scale={[10, 1.2, 1]} position={[0,  6, -3]} rotation-x={Math.PI / 2} />
  <Lightformer form="rect" intensity={2}   color="#ffffff" scale={[10, 1.2, 1]} position={[0,  6,  3]} rotation-x={Math.PI / 2} />
  {/* 兩側牆面反射 */}
  <Lightformer form="rect" intensity={1}   color="#dfe8ff" scale={[1, 4, 1]}    position={[-8, 2, 0]} rotation-y={ Math.PI / 2} />
  <Lightformer form="rect" intensity={1}   color="#dfe8ff" scale={[1, 4, 1]}    position={[ 8, 2, 0]} rotation-y={-Math.PI / 2} />
  {/* 地面暖色反彈 */}
  <Lightformer form="rect" intensity={0.6} color="#f5e3cd" scale={[12, 12, 1]}  position={[0, -4, 0]} rotation-x={-Math.PI / 2} />
</Environment>
```

**關鍵提醒(否則必犯的錯)**:`Lightformer` 位於 `EnvironmentPortal` 的**虛擬場景**中,由一台位於原點、`near 0.1 / far 1000` 的 `cubeCamera` 拍攝。這些座標**與場地的公尺座標系無關**,**不可**乘 `fit` / `bounds.radiusM` 去「配合場地大小」—— 環境貼圖只記錄方向,縮放它不會改變任何結果,只會把燈排推出 `far` 之外。

### 3. 建立 `src/components/venue/RefinedSceneProbe.tsx`(`"use client"`,D8)

- 匯出 `export interface RefinedDiagnostics { ... }`(欄位見 S11 表)與 `export default function RefinedSceneProbe({ onReport }: { onReport: (d: RefinedDiagnostics) => void })`,回傳 `null`。
- 以 `useThree(s => s.gl)` / `useThree(s => s.scene)` 取得實例。
- `useFrame` 內:`frameRef.current += 1;` 當 `frameRef.current < 2` 則 return(確保 shadow pass 已跑過至少一次、`shadow.map` 已配置);之後 traverse 場景收集:
  - `lightCount` = `obj.isLight === true` 的數量
  - `shadowCastingLightCount` = 上述中 `obj.castShadow === true` 的數量
  - `shadowCasterMeshCount` = `obj.isMesh && obj.castShadow` 的數量
  - `keyLight` = 第一個 `isDirectionalLight && castShadow` 的光源
- 組出診斷物件,`JSON.stringify` 與 `lastRef` 比對,**不同才** `onReport(next)`(防 setState 迴圈)。
- 另加 `useLayoutEffect(() => { frameRef.current = 0; }, [resetKey])`,`resetKey` 為 prop,由 `RefinedScene` 傳入 2d 的 revision → 場景變動後重新回報。
- 數值格式化規則(避免測試浮點雜訊):`shadowCameraSpanM` / `shadowCameraNearM` / `shadowCameraFarM` 一律 `Math.round(...)`;`toneMappingExposure` 保留兩位小數字串。
- 列舉映射(不得輸出裸數字):`toneMapping` → `ACESFilmic | Linear | Reinhard | Cineon | AgX | Neutral | None | unknown`;`shadowMapType` → `Basic | PCF | PCFSoft | VSM | unknown`。

### 4. 改 `RefinedScene.tsx` — `<Canvas>` 設定

```
<Canvas shadows="soft" gl={REFINED_GL} camera={{ position: [...], fov: 50 }}>
```

- `shadows="soft"` → R3F 對應 `THREE.PCFSoftShadowMap`(已查證 `events-b389eeca.esm.js:15778`),即 orchestrator 指定的 PCF soft。
- `gl={REFINED_GL}` 必須引用 **2a 的模組層級常數**,不可寫成 inline 物件字面量。
- `camera` / `OrbitControls` / `gridHelper` 的所有參數**一字不動**(取景是 task 1 的成果,不在本任務範圍)。

### 5. 改 `RefinedScene.tsx` — 計算 bounds 與 revision

```
const bounds = useMemo(() => planBoundsM(polygon, walls, columns, furniture), [polygon, walls, columns, furniture]);
```
以及 2d 所述的 revision 計數器。兩者皆傳給 `<HallLighting>`,revision 另傳給 `<RefinedSceneProbe resetKey={revision}>`。

**硬性約束**:`bounds` 只能是 `useMemo` 的衍生值,**不得**存進 `useState` —— AGENTS.md 明訂 `RefinedScene` 不得持有幾何 state。診斷物件 `useState` 是唯一允許的 local state(純視覺/測試用途,非幾何,且是單向由場景回報,不會回寫任何幾何)。

### 6. 改 `RefinedScene.tsx` — 換掉光組

刪除現有的:
```
<ambientLight intensity={0.6} />
<directionalLight position={[25, 40, 25]} intensity={0.8} />
```
換成:
```
<HallLighting bounds={bounds} revision={revision} />
<HallEnvironment />
<RefinedSceneProbe resetKey={revision} onReport={setDiagnostics} />
```

### 7. 改 `RefinedScene.tsx` — 材質與 shadow flag

| Mesh | 變更 |
| --- | --- |
| 地板 `FloorMesh` | `receiveShadow` **加**;`castShadow` **不加**(D5);`<meshStandardMaterial color={REFINED_SURFACE.floor.color} roughness={...} metalness={...} side={THREE.DoubleSide} />`。`useFloorGeometry(polygon)` 與 `rotation` **不動** |
| 牆 | mesh 加 `castShadow receiveShadow`;material 加 `roughness={REFINED_SURFACE.wall.roughness} metalness={...}`,`color="#78350f"` **不變** |
| 柱 | 同上,`color="#78716c"` **不變** |
| 家具 | 同上,`color={defaults.color}` **不變**;`position` / `rotation` / `boxGeometry args` **一律不動**(家具尺寸唯一來源仍是 `FURNITURE_DEFAULTS`,AGENTS.md 硬性約束) |

### 8. 改 `RefinedScene.tsx` — 根 div 新增診斷 `data-*`

既有 7 個 `data-*`(`data-testid` / `data-readonly` / `data-orbit-controls` / 三個 mesh count / `data-floor-vertex-count`)**全部保留不動**(既有 `venue-refined-3d.spec.ts` 12 個案例依賴它們)。新增 S11 表列的 14 個屬性,值一律來自 `diagnostics` state;`diagnostics` 尚未回報時輸出 `data-lighting-ready="false"` 且其餘屬性省略(`undefined`,React 不會渲染該屬性)。

### 9. 靜態檢查

`npx tsc --noEmit` 與 `npm run lint` 全綠。特別注意 `shadow-mapSize-width` 這類巢狀 prop 在 R3F v9 的型別支援;若 TS 抱怨,退回在 2c 的 `useLayoutEffect` 內以 `keyRef.current.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)` 設定(**注意:mapSize 若在 shadow map 已配置後才改,需另設 `keyRef.current.shadow.map = null` 觸發重配**;因此優先走 JSX prop 路徑,退回方案務必在首次 layout effect 就設定完成)。

### 10. Next.js 16 / 版本查核

依 AGENTS.md 開頭規則,動工前查 `node_modules/next/dist/docs/` 確認本任務未觸及任何 Next 16 breaking change(預期為零 —— 本任務全在 `"use client"` 的 R3F 元件內,`RefinedSceneLoader` 的 `ssr:false` 邊界不動)。若有出入,停下來回報而非自行變通。

### 11. 擴充 `playwright-tests/pages/PlanEditorPage.ts`

新增讀取 `[data-testid="refined-scene"]` 屬性的 getter(不動任何既有 locator / helper):

| 方法 | 讀取屬性 | 用途 / 期望 |
| --- | --- | --- |
| `refinedLightingReady()` | `data-lighting-ready` | 等待探針回報完成的門檻 |
| `refinedLightCount()` | `data-light-count` | ≥ 4(多光源,AC1) |
| `refinedShadowCastingLightCount()` | `data-shadow-casting-light-count` | === 1(每盞投影光 = 一趟 pass,D1) |
| `refinedShadowCasterMeshCount()` | `data-shadow-caster-mesh-count` | === walls+columns+furniture(地板不投影) |
| `refinedShadowsEnabled()` | `data-shadows-enabled` | `"true"`(AC2) |
| `refinedShadowMapType()` | `data-shadow-map-type` | `"PCFSoft"`(AC2 柔邊,非硬邊) |
| `refinedShadowMapSize()` | `data-shadow-map-size` | `"2048"`(AC3,設定值) |
| `refinedShadowMapAllocatedWidth()` | `data-shadow-map-allocated-width` | `"2048"`(AC3,**實際配置值** = 陰影真的跑過,D8) |
| `refinedShadowCameraSpanM()` | `data-shadow-camera-span-m` | 動態視錐(edge case 極大/極小場地,D2) |
| `refinedShadowCameraNearM()` / `refinedShadowCameraFarM()` | `data-shadow-camera-near-m` / `-far-m` | near ≥ 0.5 且 far > near(edge case 高瘦物件不被截斷) |
| `refinedToneMapping()` | `data-tone-mapping` | `"ACESFilmic"`(AC4) |
| `refinedToneMappingExposure()` | `data-tone-mapping-exposure` | 有限數值(AC4) |
| `refinedOutputColorSpace()` | `data-output-color-space` | `"srgb"`(AC4) |
| `refinedEnvironmentSet()` | `data-environment-set` | `"true"`(IBL 已套用,requirement 4) |
| `refinedRendererTextures()` / `refinedRendererGeometries()` | `data-renderer-textures` / `-geometries`(取自 `gl.info.memory`) | 往返多次不成長(edge case 資源累積) |

### 12. 新增 `playwright-tests/venue-refined-lighting.spec.ts`

案例見 Test Plan。檔頭註解必須說明:**本 spec 一律讀 `refined-scene` 上由場景探針回報的 `data-*`,那些值取自 renderer / scene 實例而非原始碼字面量;不做像素比對(理由見 D8)**,並註明其中一個測試會產出非斷言用的截圖供人工判讀。

### 13. 迴歸

必須全綠且**零改動**:`venue-refined-3d.spec.ts`(task 1 的 12 案例,尤其唯讀與 AiPanel 隱藏)、`venue-3d-scene.spec.ts`、`venue-objects.spec.ts`、`venue-zoom-pan.spec.ts`、`venue-plan-editor.spec.ts`、`venue-dimensions.spec.ts`、`ai-panel.spec.ts`、`ai-panel-persistent.spec.ts`、`plan-slots.spec.ts`。任何一支需要改動,都必須在 PR 逐條說明理由 —— 本任務理論上不可能影響它們。

### 14. 手動視覺檢查表(見 Test Plan「手動」段)

---

## Data Flow

```
PlanEditor 頂層 state ── props ──▶ RefinedScene
  polygon/walls/columns/furniture         │
                                          ├─ useMemo ─▶ planBoundsM()  (src/lib/venue/bounds.ts, 純函式)
                                          │                 │ PlanBounds{center, radiusM}
                                          │                 ▼
                                          │            <HallLighting>
                                          │              ├ <primitive object={target}> ── 三盞方向光的共用照射目標
                                          │              ├ hemisphereLight            (無陰影)
                                          │              ├ directionalLight KEY  ──castShadow──▶ shadow.camera 依 bounds 動態貼合
                                          │              ├ directionalLight FILL      (無陰影)
                                          │              └ directionalLight RIM       (無陰影)
                                          │
                                          ├─ revision(useRef 計數,props 變動時 +1)
                                          │      └─▶ gl.shadowMap.needsUpdate = true   (autoUpdate 已關,D6)
                                          │
                                          ├─ <HallEnvironment>  ─▶ EnvironmentPortal(虛擬場景 + Lightformer)
                                          │       └ 128px CubeRenderTarget ─▶ scene.environment(卸載時自動還原 + dispose)
                                          │
                                          └─ <RefinedSceneProbe> ─(第2幀 traverse)─▶ onReport ─▶ useState ─▶ 根 div data-*
                                                                                                         └─▶ Playwright 斷言
```

單向:光照設定**只讀** props、**不回寫**任何幾何。診斷 state 只往 DOM 屬性流,不影響渲染內容。

---

## Test Plan

無 unit/integration framework(AGENTS.md)。驗收 = Playwright + 手動視覺檢查表。

### 自動化:`playwright-tests/venue-refined-lighting.spec.ts`

| # | 案例 | 對應 AC / edge case | 斷言 |
| --- | --- | --- | --- |
| 1 | 多光源打光 | AC1 | 進 03 → `data-lighting-ready="true"`;`data-light-count` ≥ 4;`data-shadow-casting-light-count === "1"` |
| 2 | 陰影啟用且為 PCF soft | AC2 | `data-shadows-enabled="true"`、`data-shadow-map-type="PCFSoft"` |
| 3 | 解析度 2048 且陰影確實跑過 | AC3 | `data-shadow-map-size="2048"` **且** `data-shadow-map-allocated-width="2048"`(後者只可能由實際 shadow pass 配置出來,D8) |
| 4 | 投影/受影對象正確 | AC2 | 畫 1 面牆 + 1 根柱 + 放 2 件家具 → `data-shadow-caster-mesh-count === "4"`(地板不在內);`data-floor-receives-shadow="true"` |
| 5 | Tone mapping 與 color space | AC4 | `data-tone-mapping="ACESFilmic"`、`data-output-color-space="srgb"`、exposure 可 parse 為 0.8–1.6 的有限數 |
| 6 | 環境光 / IBL 已套用 | requirement 4 | `data-environment-set="true"`;且整個測試過程 `page.on("requestfailed")` 與 network log 中**無任何對 `raw.githack.com` / 外部 domain 的請求**(證明零下載,D4) |
| 7 | 步驟 02 完全未受影響 | AC5 | 回 02 → `venue-scene` 上 `data-lighting-ready` 屬性為 `null`(探針不存在);既有 `venue-3d-scene.spec.ts` 全綠(步驟 13) |
| 8 | 極小場地:視錐貼合 | edge case 極小場地 | 預設 10m 地板 → 記錄 `data-shadow-camera-span-m`,斷言 < 60(證明沒有拿 200m 開視錐) |
| 9 | 極大場地:視錐擴張 | edge case 極大場地 | 沿用 `venue-dimensions.spec.ts` 的場地尺寸調整流程放大地板 → span 明顯大於案例 8 的值(嚴格遞增),且為有限數 |
| 10 | 高瘦物件不被 near/far 截斷 | edge case 高瘦物件 | 放置 `bannerStand`(2.0m)+ `cabinet`(1.8m)→ `data-shadow-camera-near-m` ≥ 0(不為負)且 `far > near`;`data-shadow-caster-mesh-count === "2"` |
| 11 | 空場景不報錯 | edge case 空場景 | 不畫任何牆/柱/家具 → 03 可進、`data-lighting-ready="true"`、`data-shadow-caster-mesh-count="0"`、`data-shadow-camera-span-m` > 0(`MIN_SHADOW_RADIUS_M` 保護生效)、無 console error |
| 12 | 往返多次不累積資源 | edge case 往返累積 | 02→03→02→03→02→03(3 次)→ 第 3 次的 `data-light-count` / `data-shadow-casting-light-count` / `data-renderer-textures` / `data-renderer-geometries` 與第 1 次**完全相同**;且 03 期間全頁 `canvas` 元素數 === 1(互斥掛載未破) |
| 13 | 唯讀行為未退化 | AC8 | 03 下點擊 canvas 中央,`plan-editor` 的 `data-furniture` JSON 前後不變;`venue-sidebar` / `furniture-place-table` / `reset-view-button` count 皆 0 |
| 14 | 視覺證據產出(**不斷言**) | 人工判讀 | 建一個含牆/柱/多件家具的場景 → `refinedScene.locator("canvas").screenshot({ path: "playwright-report/refined-lighting.png" })`,附於 QA 報告供人工確認「展場實景感」與陰影柔邊 |

流暢度(AC「數十件家具仍可流暢旋轉」)不做 FPS 斷言(在真實 dev server + 開發機 GPU 上必然 flaky),改以**結構性保證 + 手動確認**:`data-shadow-casting-light-count === "1"`(案例 1)+ D6 的 `autoUpdate=false`(旋轉時 shadow pass 為 0)+ 手動檢查表第 5 項。

### 手動視覺檢查表(記入 qa-report.md)

1. 進入 03:畫面**不是**平光白模 —— 物件有明確的亮面/暗面,地板上有可辨識的落地陰影。
2. 陰影邊緣**柔和**、無鋸齒階梯(PCF soft 生效),也未糊成大方塊。
3. 暗部**不死黑** —— 物件背光面仍可看出顏色與形狀(hemisphere + fill + IBL 生效)。
4. 多光重疊處(例如地板正中央)**沒有過曝死白**色塊(ACES + exposure 1.1 生效)。
5. **貼牆家具**:把 `cabinet` 拖到緊貼一面牆 → 家具與牆的接觸線**沒有亮縫**(peter-panning),牆面**沒有條紋雜訊**(acne)。
6. 家具**數十件**(放置 ≥ 30 件)後以 OrbitControls 連續旋轉 10 秒 → 無明顯掉幀/頓挫。
7. 02 → 03 → 02 各兩次:步驟 02 的畫面與本任務動工前**逐項相同**(打光、無陰影、色彩)。
8. 03 停留時用 AI 面板(mock 或真實)移動一件家具 → 該家具的**陰影跟著移動**(證明 D6 的 revision 重烘焙生效,而非停在舊 map)。

---

## Architecture Notes

- **範圍邊界的判斷:roughness / metalness 純量算不算 task 3?** 判定為**本任務範圍內**。理由:orchestrator requirement 4 明文要求「讓 `meshStandardMaterial` 的金屬/粗糙度有東西可反射」,而 `meshStandardMaterial` 預設 `roughness = 1` 會讓環境反射幾乎不可見 —— 不設純量,requirement 4 在字面上就無法成立。純量是「光照反應參數」,貼圖(`map` / `normalMap` / `roughnessMap` / `aoMap`)才是 task 3 的「PBR 材質貼圖」。實作者**不得**在本任務引入任何 texture / 貼圖檔案。
- **顏色只改一處是刻意的**。`REFINED_SURFACE` 目前只有地板一個顏色覆寫。多改任何一個顏色都是純主觀調校,而 03 與 02 的顏色一致性有客觀價值(使用者切步驟時不該覺得換了一個場地)。地板是唯一有客觀理由的:高 albedo 會壓掉陰影對比,而陰影可讀性是本任務的驗收條件。
- **刻意偏離 drei 的兩處**,皆已在 D1 / D6 說明並附上原始碼證據:(a) 不用 `<SoftShadows>`(全域 ShaderChunk 副作用 + 材質重編譯);(b) 不用 `<BakeShadows>`,自寫 8 行版本(drei 版無法在場景變動時重烘焙)。這兩處都必須在程式碼註解裡寫明「為何不用 drei 現成元件」,否則後續維護者會「順手改成 drei 的」。
- **`gridHelper` 保留不動**。它在新打光下會顯得突兀(亮線疊在有陰影的地板上,削弱「展場實景感」),但移除它是視覺結構變更、超出「只做打光與陰影」的範圍。**列為 task 3 的候選項**,本任務不碰。
- **`RefinedScene.tsx` 的 local state**:本任務首次為 03 引入 `useState`(診斷物件)。AGENTS.md 的禁令是「不得持有幾何 `useState`」,診斷物件不是幾何、不回寫、只往 DOM 屬性流,符合原本 plan D1 的「允許的 local state 僅限純視覺/UI」。此點請 reviewer 明確確認而非機械式判定違規。
- **02/03 互斥掛載是本任務的安全網**。因為 02/03 各自有獨立的 `WebGLRenderer`,03 對 `gl.shadowMap.autoUpdate`、`scene.environment`、`toneMappingExposure` 的所有修改都**不可能**外溢到 02。這也是 D1 否決 `<SoftShadows>` 的理由 —— 那是唯一會打破這個隔離的方案(它改的是 `THREE.ShaderChunk`,process 全域)。
- **`PlanEditor.tsx` 不動**。本任務全部落在 03 的元件樹內,完全避開 AGENTS.md 的「PlanEditor 已 1584 行、勿再堆邏輯」熱點。
- **後續 task 的掛載點已預留**:task 3(PBR)接 `REFINED_SURFACE`(把純量換成貼圖 + 純量);task 5(GLB 家具)接 `castShadow/receiveShadow` 的設定位置(匯入模型需 traverse 後逐 mesh 設 flag —— 這點請 task 5 的 architect 注意,GLTF 載入的 mesh 預設 `castShadow = false`);task 7(效能)接 `data-renderer-textures` / `-geometries` 診斷屬性。

## Risks

| 風險 | 影響 | 緩解 |
| --- | --- | --- |
| 忘記 `shadow.camera.updateProjectionMatrix()` | AI `resize_floor` 在 03 停留時改場地後,陰影視錐停在舊值 → 陰影裁切或消失。**且此 bug 在單次進入 03 時完全看不出來** | S2c 明列該行並附 three 原始碼證據;手動檢查表第 8 項;code review 檢查點 |
| 忘記把 `light.target` 掛進場景 | 三盞方向光全部照向世界原點,而地板通常在 (20,20)–(30,30) → 光向與陰影方向全錯,但畫面「看起來有光」不易察覺 | S2b 步驟 2 明列 `<primitive object={target}>`;手動檢查表第 1 項(陰影方向應與主光一致) |
| `normalBias = 0.03` 在 200m 場地仍有殘留 acne | 大場地畫面有條紋雜訊 | D5 已定調調整順序(先加 `normalBias` 到 0.05 再動 `bias`);地板 `castShadow={false}` 已根除最大宗來源;手動檢查表第 5 項 |
| 200m 場地 14cm/texel 陰影偏鈍 | 極大場地陰影品質較差 | 已在 D2 明列為 2048 固定解析度下的必然取捨,寫入 PR 與 QA 報告;非 bug |
| `EnvironmentPortal` 的 `children` 依賴造成每次 re-render 重跑 cube render | AI 頻繁改動場景時多餘成本 | resolution 壓到 128(比 256 便宜 4 倍);已於 D4 記錄為已知瑕疵,不做 workaround |
| 探針在 `useFrame` 內 `setState` 造成無限迴圈 | 頁面卡死 | S3 的 `JSON.stringify` 前值比對 + 幀計數 ref 雙重防護;案例 1–3 若出現 timeout 即為此症狀 |
| `shadow-mapSize-width` 巢狀 prop 型別/行為不如預期 | 解析度未套用 | S9 已備退回方案(layout effect 內 `mapSize.set()`,且**必須在首次 layout effect 完成**,否則需 `shadow.map = null` 觸發重配);案例 3 的 `data-shadow-map-allocated-width` 會直接抓到這個錯 |
| 低階 GPU 的 `maxTextureSize` 把 2048 夾小 | AC3 在該機器上不成立 | `data-shadow-map-allocated-width` 誠實回報實際值 → 測試會 fail 而非靜默降級;若真的發生,回報為環境限制而非程式 bug |
| 實作者順手改了 `FURNITURE_DEFAULTS` 的顏色或 `VenueScene.tsx` | 破壞 AC5 與步驟 01/02 | D7 的「絕對不得修改」清單為 reviewer 硬性檢查點;案例 7 + 步驟 13 的 9 支迴歸 spec 為守門 |
| 「展場實景感」是主觀的,調不到位 | 驗收爭議 | 所有光色/強度都是具名匯出常數,調整成本極低;手動檢查表把主觀感受拆成 4 條可判定的客觀敘述(1–4 項) |

## Security Checklist

- [ ] 無硬編碼 secrets / credentials(本任務不新增任何憑證;Playwright 測試帳號一律走 `.env.playwright.local`)
- [ ] **無新增任何外部網路請求**(D4 定案為零下載;案例 6 以 network 斷言把關,特別是不得打到 `raw.githack.com`)
- [ ] 無新增系統邊界輸入(不新增/修改任何 API 呼叫)
- [ ] Auth / permission:未觸及(不新增 page 路由,`src/proxy.ts` 不動)
- [ ] 不 log 任何 token / session / 敏感資料(探針只讀 renderer 狀態,不 log)
- [ ] 不 import `admin.ts` / service_role 至 client component
- [ ] 不動 `src/lib/ai/` 的 server-only 邊界與凍結系統提示
- [ ] `src/lib/venue/` 維持零 React / DOM / Konva / Three import(`bounds.ts` 為純函式)
- [ ] 新增的 Three 程式碼一律在 `src/components/venue/` 且經既有 `RefinedSceneLoader` 的 `ssr:false` 邊界

## Definition of Done

- [ ] 全部 14 個 Implementation Steps 完成
- [ ] `playwright-tests/venue-refined-lighting.spec.ts` 14 個案例全綠(案例 14 為產出截圖,不斷言)
- [ ] 步驟 13 所列 9 支既有 spec 全綠且**零改動**(有改動須逐條說明)
- [ ] orchestrator-output.md 的 10 條 Clarified Acceptance Criteria 逐條對應到通過的測試或手動檢查表項目
- [ ] 手動視覺檢查表 8 項全數確認並記入 qa-report.md,附案例 14 的截圖
- [ ] `git diff` 中**不存在** D7「絕對不得修改」清單的任何檔案
- [ ] 無 TODO、註解掉的程式碼、debug log
- [ ] `npm run lint` + `npx tsc --noEmit` 通過
- [ ] 符合 AGENTS.md 全部規則(尤其:`src/lib/venue/` 不碰 Three、geometry/material/texture 以 `useMemo` 快取並於卸載 `dispose()`、`RefinedScene` 唯讀無幾何 state、02/03 互斥掛載、`AiPanel` 掛載位置不變、家具尺寸仍唯一來自 `FURNITURE_DEFAULTS`)
- [ ] 本任務**未**引入任何材質貼圖檔、GLB 模型或程序化家具幾何(task 3–6 範圍),未越界
- [ ] Security Checklist 通過
